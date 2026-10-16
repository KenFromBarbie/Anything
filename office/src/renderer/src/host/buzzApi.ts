/**
 * The Office's API for Buzz pages that show its data in Buzz's own UI: the
 * Tasks page (the agents' board, dispatch, the Notion sync) and the Agents page
 * (agent cards, header, queue, monitor).
 *
 * Buzz sends `{type:'api', id, op, args}`; the result comes back as
 * `{type:'api-result', id, ok, value | error}`. The Office also pushes a
 * compact snapshot of its agents (`{type:'state'}`) whenever they change.
 * Only the operations below exist, and they do what the Office's own controls
 * do (the same hive calls, the same store actions).
 */
import i18n from '@/i18n';
import { useStore, type Agent } from '@/store/store';
import { openQuestion, parseTasks, type HiveTask, type HumanQA } from '@/components/TasksKanban';
import { disposeTerminal } from '@/components/terminalPool';
import { sectionOps } from '@/host/buzzSectionsApi';
import { OFFICE_CAST, DEFAULT_CHARACTER, type OfficeCharacterName } from '@/scene/office/cast';
import type { AccentColorName } from '@/design/tokens';
import {
  AGENT_PROVIDER_PRESETS,
  buildSpawnCommand,
  inferAgentProvider,
  isClaudeProvider,
  modelsForProvider,
  tokenizeCommand,
  type AgentProvider,
  type HarnessConfig
} from '@/store/config';

const HIRE_ACCENTS: AccentColorName[] = ['coral', 'mint', 'sky', 'lemon', 'lilac', 'peach'];

function defaultModelFor(config: HarnessConfig, provider: AgentProvider): string | undefined {
  return isClaudeProvider(provider) ? config.defaultModel : config.providerDefaultModels?.[provider];
}

/** Buzz's Edit button for a worker (AgentDetailPanel opens its editor). */
export const EDIT_AGENT_EVENT = 'cth:edit-agent';

const STATUSES: HiveTask['status'][] = ['todo', 'doing', 'blocked', 'done'];
const TASK_FIELDS = ['title', 'description', 'status', 'assignee', 'priority'] as const;

type Args = Record<string, unknown>;
type Op = (args: Args) => Promise<unknown> | unknown;

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function newTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function checked<T extends { ok: boolean; error?: string }>(result: T, what: string): T {
  if (!result.ok) throw new Error(result.error ?? `${what} failed`);
  return result;
}

/**
 * Resolve the open question on a task, as the Office's Ask Me does: re-read the
 * ledger (never write a stale copy), find the question by its text so an
 * answer can't land on a different one the god swapped in, and patch only that
 * card's humanQA.
 */
async function resolveOpenQuestion(
  taskId: string,
  question: string,
  change: (entry: HumanQA) => HumanQA
): Promise<HiveTask> {
  const task = parseTasks(await window.cth.hiveTasks()).find((x) => x.id === taskId);
  if (!task) throw new Error('that task is gone');
  const open = openQuestion(task);
  if (!open || open.q !== question) throw new Error('the question changed; refresh and try again');
  const humanQA = (task.humanQA ?? []).map((e) => (e === open ? change(e) : e));
  checked(await window.cth.hivePatchTask(task.id, { humanQA }), 'saving the answer');
  return task;
}

/** The agent fields Buzz's Agents page shows. */
type QueueItem = { id: string; text: string; ts: number };

export function agentSummary(a: Agent, extra: { queue?: QueueItem[]; toolCalls?: number } = {}) {
  return {
    id: a.id,
    name: a.name,
    isGod: !!a.isGod,
    status: a.status,
    action: a.action,
    description: a.description,
    accent: a.accent,
    character: a.character,
    provider: a.provider ?? 'claude',
    model: a.model ?? null,
    progress: a.progress,
    hasTerminal: !!a.ptyId,
    cwd: a.cwd,
    contextTokens: a.contextTokens ?? null,
    contextLimit: a.contextLimit ?? null,
    project: a.project ?? '',
    onHold: !!a.onHold,
    queue: extra.queue ?? [],
    toolCalls: extra.toolCalls ?? 0
  };
}

function liveAgent(id: unknown): Agent {
  const agent = useStore.getState().agents.find((x) => x.id === id);
  if (!agent) throw new Error('no such agent');
  return agent;
}

function snapshotOf(s: ReturnType<typeof useStore.getState>) {
  return {
    agents: s.agents.map((a) =>
      agentSummary(a, {
        queue: (s.messageQueues[a.id] ?? []).map((m) => ({ id: m.id, text: m.text, ts: m.ts })),
        toolCalls: s.toolCounts[a.id] ?? 0
      })
    ),
    selectedId: s.selectedId
  };
}

const ops: Record<string, Op> = {
  'tasks.list': async () => parseTasks(await window.cth.hiveTasks()),

  'tasks.add': async (a) => {
    const title = text(a.title, 300);
    if (!title) throw new Error('a task needs a title');
    const status = STATUSES.includes(a.status as HiveTask['status']) ? (a.status as HiveTask['status']) : 'todo';
    const task: HiveTask = {
      id: text(a.id, 80) || newTaskId(),
      title,
      description: text(a.description, 4000) || undefined,
      assignee: text(a.assignee, 80) || undefined,
      status,
      dependsOn: [],
      priority: typeof a.priority === 'number' ? a.priority : 3,
      createdAt: new Date().toISOString()
    };
    checked(await window.cth.hiveAddTask(task), 'adding the task');
    return task;
  },

  'tasks.patch': async (a) => {
    const id = text(a.id, 80);
    const raw = (a.patch ?? {}) as Args;
    const patch: Partial<HiveTask> = {};
    for (const key of TASK_FIELDS) {
      if (!(key in raw)) continue;
      if (key === 'status') {
        if (!STATUSES.includes(raw.status as HiveTask['status'])) throw new Error('unknown status');
        patch.status = raw.status as HiveTask['status'];
      } else if (key === 'priority') {
        if (typeof raw.priority === 'number') patch.priority = raw.priority;
      } else {
        (patch as Args)[key] = text(raw[key], key === 'description' ? 4000 : 300) || undefined;
      }
    }
    checked(await window.cth.hivePatchTask(id, patch), 'updating the task');
    return true;
  },

  'tasks.delete': async (a) => {
    checked(await window.cth.hiveDeleteTask(text(a.id, 80)), 'deleting the task');
    return true;
  },

  /** Work for the floor goes through Michael, as from the Office's dispatch box:
   *  a picked agent is passed on as a suggestion he may follow. */
  dispatch: async (a) => {
    const body = text(a.text, 8000);
    if (!body) throw new Error('describe the task');
    const suggested = useStore.getState().agents.find((x) => x.id === a.suggestedId && !x.isGod);
    const full = suggested
      ? `${body}\n\n${i18n.t('commandCenter.dispatchSuggestion', { name: suggested.name, id: suggested.id })}`
      : body;
    checked(
      await window.cth.hiveSend({ to: 'god', act: 'request', subject: i18n.t('commandCenter.taskFromHuman'), body: full }, 'human'),
      'dispatching'
    );
    return true;
  },

  /** Answer an agent's open question (Ask Me): recorded on the card, and
   *  Michael is told so he unblocks it and the work continues. */
  'askme.answer': async (a) => {
    const answer = text(a.text, 8000);
    if (!answer) throw new Error('write an answer');
    const question = typeof a.q === 'string' ? a.q : '';
    const task = await resolveOpenQuestion(text(a.taskId, 80), question, (e) => ({
      ...e, a: answer, answeredAt: new Date().toISOString()
    }));
    checked(
      await window.cth.hiveSend({
        to: 'god',
        act: 'inform',
        subject: `HUMAN ANSWER on task "${task.title}"`,
        body: [
          `The human answered the open question on task ${task.id} ("${task.title}"):`,
          `Q: ${question}`,
          `A: ${answer}`,
          "The answer is also recorded in the card's humanQA. Act on it, unblock the card, and continue the work."
        ].join('\n')
      }, 'human'),
      'telling Michael'
    );
    return true;
  },
  /** Take an ask off Ask Me without answering; the question stays on the card. */
  'askme.dismiss': async (a) => {
    await resolveOpenQuestion(text(a.taskId, 80), typeof a.q === 'string' ? a.q : '', (e) => ({
      ...e, dismissedAt: new Date().toISOString()
    }));
    return true;
  },

  'agents.select': (a) => {
    const id = text(a.id, 80);
    if (!useStore.getState().agents.some((x) => x.id === id)) throw new Error('no such agent');
    useStore.getState().select(id);
    return true;
  },

  // ── One agent, as its panel's controls do ──────────────────────────────────

  /** Queue a message for the agent, as from its queue composer. */
  'agent.message': (a) => {
    const agent = liveAgent(a.id);
    const body = text(a.text, 16000);
    if (!body) throw new Error('write a message');
    useStore.getState().enqueueMessage(agent.id, body);
    void window.cth.trackMessageSent('composer');
    return true;
  },
  'agent.queue.remove': (a) => {
    const agent = liveAgent(a.id);
    useStore.getState().removeQueuedMessage(agent.id, text(a.messageId, 80));
    return true;
  },
  /** Pause (deny tools at the next boundary), halt after this step, steer, and
   *  the control state they report. */
  'agent.control': async (a) => window.cth.controlSnapshot(liveAgent(a.id).id),
  'agent.pause': async (a) => {
    const id = liveAgent(a.id).id;
    return a.on ? window.cth.controlPause(id, true) : window.cth.controlResume(id);
  },
  'agent.halt': async (a) => window.cth.controlHalt(liveAgent(a.id).id),
  'agent.steer': async (a) => {
    const body = text(a.text, 8000);
    if (!body) throw new Error('write what to steer with');
    return window.cth.controlSteer(liveAgent(a.id).id, body);
  },
  /** Take a worker aside (Michael stops handing them work) or release them. */
  'agent.hold': async (a) => {
    const agent = liveAgent(a.id);
    if (agent.isGod) throw new Error('Michael is never taken aside');
    const on = !!a.on;
    const result = await window.cth.hiveSetAgentHold(agent.id, on);
    if (!result?.ok) throw new Error(result?.error ?? 'could not set the hold');
    useStore.getState().updateAgent(agent.id, { onHold: on });
    return true;
  },
  'agent.ide': (a) => {
    useStore.getState().setIdeOpen(true, liveAgent(a.id).id);
    return true;
  },
  'agent.edit': (a) => {
    const agent = liveAgent(a.id);
    if (agent.isGod) throw new Error("Michael's settings are in the Office's Settings");
    useStore.getState().select(agent.id);
    setTimeout(() => window.dispatchEvent(new CustomEvent(EDIT_AGENT_EVENT, { detail: agent.id })), 0);
    return true;
  },
  /** Open a system terminal in the agent's folder. */
  'agent.openTerminal': async (a) => {
    const result = await window.cth.openTerminalAt(liveAgent(a.id).cwd);
    if (!result.ok) throw new Error(result.error ?? 'could not open a terminal');
    return true;
  },
  /** Close a worker's terminal and archive them (Buzz confirmed first). */
  'agent.archive': async (a) => {
    const agent = liveAgent(a.id);
    if (agent.isGod) throw new Error('Michael runs the floor and is never archived');
    if (agent.ptyId) {
      await window.cth.killPty(agent.ptyId);
      disposeTerminal(agent.ptyId);
    }
    useStore.getState().archiveAgent(agent.id);
    return true;
  },

  // ── Hiring and editing agents (Buzz's Add agent / Edit agent dialogs) ─────

  /** What the hire form offers: engines and their models, recent folders, the
   *  floor's cast and colors. */
  'hire.options': async () => {
    const config = await window.cth.getConfig();
    const initial = inferAgentProvider(config.defaultCommand);
    return {
      providers: AGENT_PROVIDER_PRESETS.filter((p) => p.id !== 'custom').map((p) => ({
        id: p.id,
        label: p.label,
        defaultModel: defaultModelFor(config, p.id) ?? null,
        models: p.supportsModel
          ? modelsForProvider(p.id)
            .filter((m): m is { id: string; label: string } => typeof m.id === 'string')
            .map((m) => ({ id: m.id, label: m.label }))
          : []
      })),
      defaultProvider: initial === 'custom' ? 'claude' : initial,
      repos: config.registeredRepos ?? [],
      characters: OFFICE_CAST.map((c) => ({ name: c.name, displayName: c.displayName })),
      accents: HIRE_ACCENTS
    };
  },
  /** The system folder picker; null when cancelled. */
  'hire.chooseFolder': async () => {
    const result = await window.cth.chooseFolder();
    if (result.ok) return result.path;
    if (result.error === 'cancelled') return null;
    throw new Error(result.error);
  },
  /** Hire an agent onto the floor, as the Office's Add Agent form does. */
  'agents.hire': async (a) => {
    const config = await window.cth.getConfig();
    const name = text(a.name, 60);
    const cwd = text(a.cwd, 1000);
    if (!name) throw new Error('give the agent a name');
    if (!cwd) throw new Error('pick a folder for the agent to work in');
    const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === a.provider && p.id !== 'custom');
    if (!preset) throw new Error('pick an engine');
    const provider = preset.id as AgentProvider;
    const model = text(a.model, 120) || undefined;
    const character = OFFICE_CAST.some((c) => c.name === a.character)
      ? (a.character as OfficeCharacterName)
      : DEFAULT_CHARACTER;
    const accent = HIRE_ACCENTS.includes(a.accent as AccentColorName) ? (a.accent as AccentColorName) : 'sky';
    const description = text(a.description, 300) || 'a fresh harness';
    const goal = text(a.goal, 4000) || undefined;
    const isolate = a.isolate === true;

    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`;
    const ptyId = `pty-${id}`;
    const command = buildSpawnCommand(config, model, provider);
    const [exe, ...args] = tokenizeCommand(command.trim());
    const spawned = await window.cth.spawnPty({
      id: ptyId, cwd, command: exe, provider, args, cols: 100, rows: 30, isolate,
      hive: { id, name, provider, cwd, role: description }
    });
    if (!spawned.ok) throw new Error(spawned.error ?? 'the agent could not start');
    const spawnedCwd = spawned.cwd || cwd;
    const projectCwd = isolate ? cwd : spawnedCwd;
    const agent: Agent = {
      id, name, character, accent, description,
      project: projectCwd.split(/[\/]/).filter(Boolean).pop() ?? projectCwd,
      tmuxTarget: '', cwd: spawnedCwd, goal,
      status: 'idle', action: 'starting up', progress: 0, currentStation: 'desk',
      ptyId, command: command.trim(), provider, model,
      worktreePath: spawned.worktreePath, seedPrompt: spawned.seedPrompt, recentTextTs: Date.now()
    };
    useStore.getState().addAgent(agent);
    useStore.getState().select(id);
    const repos = config.registeredRepos ?? [];
    if (repos[0] !== projectCwd) {
      await window.cth
        .updateConfig({ registeredRepos: [projectCwd, ...repos.filter((r) => r !== projectCwd && r !== cwd)] })
        .catch(() => null);
    }
    return { id };
  },
  /** An agent's editable details (name, look, briefing, engine). */
  'agent.details': (a) => {
    const agent = liveAgent(a.id);
    return {
      name: agent.name,
      character: agent.character,
      accent: agent.accent,
      description: agent.description,
      goal: agent.goal ?? '',
      provider: inferAgentProvider(agent.command, agent.provider),
      model: agent.model ?? null
    };
  },
  /** Save an agent's details, as the Office's Edit Agent form does (an engine
   *  change applies on the agent's next restart). */
  'agent.update': async (a) => {
    const agent = liveAgent(a.id);
    const config = await window.cth.getConfig();
    const preset = AGENT_PROVIDER_PRESETS.find((p) => p.id === a.provider);
    const provider = (preset?.id ?? inferAgentProvider(agent.command, agent.provider)) as AgentProvider;
    const model = typeof a.model === 'string' ? text(a.model, 120) || undefined : agent.model;
    useStore.getState().updateAgent(agent.id, {
      name: text(a.name, 60) || agent.name,
      character: OFFICE_CAST.some((c) => c.name === a.character) ? (a.character as OfficeCharacterName) : agent.character,
      accent: HIRE_ACCENTS.includes(a.accent as AccentColorName) ? (a.accent as AccentColorName) : agent.accent,
      provider,
      model,
      command: provider === 'custom' ? agent.command : buildSpawnCommand(config, model, provider),
      description: text(a.description, 300) || 'a fresh harness',
      goal: text(a.goal, 4000) || undefined
    });
    return true;
  },

  // ── The floor ──────────────────────────────────────────────────────────────

  /** Floor-wide auto-delivery of queued messages (one switch for every agent). */
  'floor.delivery': async () => {
    const god = useStore.getState().agents.find((x) => x.isGod) ?? useStore.getState().agents[0];
    if (!god) return { paused: false };
    const snap = await window.cth.controlSnapshot(god.id);
    return { paused: !!snap?.autoDeliveryPaused };
  },
  'floor.delivery.set': async (a) => {
    const paused = !!a.paused;
    await Promise.all(
      useStore.getState().agents.map((x) => window.cth.controlAutoDelivery(x.id, paused).catch(() => null))
    );
    return { paused };
  }
};

/** Run one API call from Buzz. */
export async function runBuzzApi(op: string, args: Args): Promise<unknown> {
  const fn = Object.prototype.hasOwnProperty.call(ops, op)
    ? ops[op]
    : Object.prototype.hasOwnProperty.call(sectionOps, op) ? sectionOps[op] : undefined;
  if (!fn) throw new Error(`unknown office operation: ${op}`);
  return fn(args ?? {});
}

/** Push the agents snapshot to Buzz now and whenever it changes (throttled). */
export function startStatePush(post: (message: Record<string, unknown>) => void): () => void {
  let last = '';
  let timer: ReturnType<typeof setTimeout> | null = null;
  const push = () => {
    timer = null;
    const message = snapshotOf(useStore.getState());
    const json = JSON.stringify(message);
    if (json === last) return;
    last = json;
    post({ type: 'state', ...message });
  };
  push();
  const unsubscribe = useStore.subscribe(() => {
    if (!timer) timer = setTimeout(push, 250);
  });
  return () => {
    unsubscribe();
    if (timer) clearTimeout(timer);
  };
}

/** Send the current snapshot even if it hasn't changed (Buzz asked for it). */
export function stateNow(): Record<string, unknown> {
  return { type: 'state', ...snapshotOf(useStore.getState()) };
}
