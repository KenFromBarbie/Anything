/**
 * The Office's API for Buzz's own versions of the Command Center sections —
 * Models & budgets, Triggers (+ history), Memory, Graph, Activity, Skills and
 * Workers. Merged into `host/buzzApi`'s operations.
 *
 * Plain data reads and writes go through `cth` (an allowlist of the same
 * preload calls the Office's sections make). Anything that would hand Buzz the
 * whole harness config, or must also update the Office's own store mirrors,
 * has its own operation.
 */
import { useStore, type Agent } from '@/store/store';
import {
  AGENT_PROVIDER_PRESETS,
  modelsForProvider,
  type AgentProvider
} from '@/store/config';
import { restartAgent } from '@/components/agentRestart';
import { buildGraph, type MessageLogEntry } from '@/components/memoryGraph/buildGraph';
import type { OrgTriggerConfig, WebhookTrigger } from '@shared/triggers';

type Args = Record<string, unknown>;
type Op = (args: Args) => Promise<unknown> | unknown;

/** Preload calls Buzz may make directly, with positional arguments. */
const CTH_ALLOWED = new Set([
  // Memory, Activity, Graph
  'hiveMemory', 'searchMemory', 'textSearch', 'hiveLog', 'hiveBoard',
  // Workers
  'listWorkers', 'stopWorker',
  // Models & budgets: folders and issues
  'openTerminalAt', 'githubIssues',
  // Skills
  'skillsCatalog', 'skillsLocal', 'skillsInstall', 'skillsUninstall', 'skillsReveal',
  // Triggers
  'listMissions', 'saveMissions', 'getContextTrigger', 'setContextTrigger',
  'listWebhooks', 'webhooksStatus', 'generateWebhookSecret', 'getOrgTrigger',
  'listTriggerHistory', 'decideTriggerHistory', 'clearTriggerHistory'
]);

function liveAgent(id: unknown): Agent {
  const agent = useStore.getState().agents.find((x) => x.id === id);
  if (!agent) throw new Error('no such agent');
  return agent;
}

// ─── Fleet telemetry (what the Office's monitor folds from its collector) ────

interface UsageSample {
  agentId: string; ts: number; input: number; output: number;
  cacheRead: number; cacheCreation: number; model: string; usd: number;
}
interface Breaker { agentId: string; level: string; reason: string; ts: number }

const SPARK_LEN = 24;
const telemetry = {
  started: false,
  samples: {} as Record<string, UsageSample>,
  spark: {} as Record<string, number[]>,
  rate: {} as Record<string, number>,
  lastTool: {} as Record<string, string>,
  breakers: {} as Record<string, Breaker>,
  track: {} as Record<string, { firstTs: number; firstTotal: number; lastTotal: number }>
};
const total = (s: UsageSample) => s.input + s.output + s.cacheRead + s.cacheCreation;

function foldUsage(s: UsageSample): void {
  telemetry.samples[s.agentId] = s;
  const t = total(s);
  const r = telemetry.track[s.agentId];
  if (!r) {
    telemetry.track[s.agentId] = { firstTs: s.ts, firstTotal: t, lastTotal: t };
    return;
  }
  telemetry.spark[s.agentId] = [...(telemetry.spark[s.agentId] ?? []), Math.max(0, t - r.lastTotal)].slice(-SPARK_LEN);
  r.lastTotal = t;
  const minutes = Math.max(1 / 60, (s.ts - r.firstTs) / 60000);
  telemetry.rate[s.agentId] = (t - r.firstTotal) / minutes;
}

function startTelemetry(): void {
  if (telemetry.started) return;
  telemetry.started = true;
  window.cth.telemetrySnapshot?.().then((snap) => {
    for (const s of snap?.usage ?? []) foldUsage(s as UsageSample);
    for (const [id, spans] of Object.entries(snap?.spans ?? {})) {
      const list = spans as { tool: string }[];
      if (list.length && !telemetry.lastTool[id]) telemetry.lastTool[id] = list[list.length - 1].tool;
    }
  }).catch(() => { /* collector not up */ });
  window.cth.onTelemetryEvent?.((e: { kind: string; sample?: UsageSample; span?: { agentId: string; tool: string } }) => {
    if (e.kind === 'usage' && e.sample) foldUsage(e.sample);
    else if (e.kind === 'tool_result' && e.span) telemetry.lastTool[e.span.agentId] = e.span.tool;
  });
  window.cth.onBreakerState?.((s: Breaker) => { telemetry.breakers[s.agentId] = s; });
}

// ─── Operations ──────────────────────────────────────────────────────────────

export const sectionOps: Record<string, Op> = {
  /** One allowlisted preload call. */
  cth: async (a) => {
    const method = typeof a.method === 'string' ? a.method : '';
    if (!CTH_ALLOWED.has(method)) throw new Error(`not available to Buzz: ${method}`);
    const fn = (window.cth as unknown as Record<string, unknown>)[method];
    if (typeof fn !== 'function') throw new Error(`not in this build: ${method}`);
    const args = Array.isArray(a.args) ? a.args : [];
    return (fn as (...x: unknown[]) => unknown)(...args);
  },

  /** Live usage per agent: latest sample, recent per-update deltas, tokens per
   *  minute, last tool, and the circuit breaker's state. */
  telemetry: () => {
    startTelemetry();
    const { samples, spark, rate, lastTool, breakers } = telemetry;
    return { samples, spark, rate, lastTool, breakers, toolCounts: useStore.getState().toolCounts };
  },

  /** The budget and engine settings the Models & budgets section shows. */
  'floor.settings': async () => {
    const c = await window.cth.getConfig();
    return {
      tokenCap: c.costCapTokens ?? null,
      agentTokenCaps: c.agentTokenCaps ?? {},
      repos: c.registeredRepos ?? [],
      godProvider: c.godProvider ?? null,
      godModel: c.godModel ?? null,
      defaultModel: c.defaultModel ?? null
    };
  },
  /** Set or clear one agent's token limit; returns every agent's limit. */
  'floor.setAgentCap': async (a) => {
    const id = liveAgent(a.id).id;
    const tokens = typeof a.tokens === 'number' && Number.isFinite(a.tokens) && a.tokens > 0 ? a.tokens : undefined;
    const updated = await window.cth.setAgentTokenCap(id, tokens);
    return updated.agentTokenCaps ?? {};
  },
  /** Engines and their models, for the model pickers. */
  'models.options': () =>
    AGENT_PROVIDER_PRESETS.filter((p) => p.supportsModel).map((p) => ({
      id: p.id,
      label: p.label,
      canOrchestrate: !!p.canReceiveInbox,
      recommendedOrchestratorModel: p.recommendedOrchestratorModel ?? null,
      resumable: p.id === 'claude' || !!p.resumeFlag || !!p.resumeSubcommand,
      models: modelsForProvider(p.id).map((m) => ({ id: m.id ?? null, label: m.label }))
    })),
  /** Restart an agent onto a model (and engine), or Restart & Continue. */
  'agent.restart': async (a) => {
    const agent = liveAgent(a.id);
    const provider = AGENT_PROVIDER_PRESETS.find((p) => p.id === a.provider)?.id as AgentProvider | undefined;
    const model = typeof a.model === 'string' && a.model ? a.model : undefined;
    await restartAgent(agent, model, {
      provider,
      resume: a.resume === true,
      resumeOptional: a.resumeOptional === true
    });
    return true;
  },
  /** Switch Michael's engine and model (saved for future launches too). */
  'floor.setGodEngine': async (a) => {
    const god = useStore.getState().agents.find((x) => x.isGod);
    if (!god) throw new Error("Michael isn't on the floor");
    const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === a.provider && p.canReceiveInbox);
    if (!preset) throw new Error('that engine cannot run the floor');
    const model = typeof a.model === 'string' && a.model ? a.model : undefined;
    await window.cth.updateConfig({ godProvider: preset.id, godModel: model });
    await restartAgent(god, model, { provider: preset.id, resume: false });
    return true;
  },

  /** Agents whose terminals were closed. */
  'agents.archived': () =>
    useStore.getState().archivedAgents.map((x) => ({ id: x.id, name: x.name, accent: x.accent, cwd: x.cwd })),
  'agents.archived.remove': (a) => {
    useStore.getState().removeArchivedAgent(String(a.id ?? ''));
    return true;
  },

  /** Webhook and organisation triggers, kept in step with the Office's mirrors. */
  'triggers.webhooks.save': async (a) => {
    const list = Array.isArray(a.list) ? (a.list as WebhookTrigger[]) : [];
    const canonical = await window.cth.saveWebhooks(list);
    if (canonical) useStore.getState().setWebhookTriggers(canonical);
    return canonical;
  },
  'triggers.webhooks.delete': async (a) => {
    const canonical = await window.cth.deleteWebhook(String(a.id ?? ''));
    if (canonical) useStore.getState().setWebhookTriggers(canonical);
    return canonical;
  },
  'triggers.org.set': async (a) => {
    const cfg = a.config as OrgTriggerConfig;
    useStore.getState().setOrgTrigger(cfg);
    return window.cth.setOrgTrigger(cfg);
  },

  /** The memory graph: agents, who messages whom, and optional topics. */
  'graph.data': async (a) => {
    const agents = useStore.getState().agents;
    const log = (await window.cth.hiveLog(200)) as MessageLogEntry[];
    let memories: Record<string, string> = {};
    if (a.topics === true) {
      const pairs = await Promise.all(
        agents.map((x) => window.cth.hiveMemory(x.id).then((m) => [x.id, m ?? ''] as const, () => [x.id, ''] as const))
      );
      memories = Object.fromEntries(pairs);
    }
    return buildGraph(agents, log, { showTopics: a.topics === true, memories });
  }
};
