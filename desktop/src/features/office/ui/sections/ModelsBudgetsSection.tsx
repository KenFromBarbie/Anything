import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  GitPullRequestArrow,
  Loader2,
  RotateCcw,
  Send,
  SquareTerminal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { contextShare } from "@/features/office/lib/agentStatus";
import { fmtTokens, officeCth } from "@/features/office/lib/officeCth";
import {
  callOffice,
  type OfficeAgent,
  useOfficeAgents,
} from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

import { AgentAvatar, AgentStatusPill } from "../agents/AgentBits";
import { ErrorLine, Muted, SECTION_SELECT, SectionCard } from "./SectionBits";

const DEFAULT_TOKEN_CAP = 1_000_000;

type Usage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  model: string;
  usd: number;
};
type Telemetry = {
  samples: Record<string, Usage>;
  spark: Record<string, number[]>;
  rate: Record<string, number>;
  lastTool: Record<string, string>;
  breakers: Record<string, { level: string; reason: string }>;
  toolCounts: Record<string, number>;
};
type FloorSettings = {
  tokenCap: number | null;
  agentTokenCaps: Record<string, number>;
  repos: string[];
  godProvider: string | null;
  godModel: string | null;
  defaultModel: string | null;
};
type EngineOption = {
  id: string;
  label: string;
  canOrchestrate: boolean;
  recommendedOrchestratorModel: string | null;
  resumable: boolean;
  models: { id: string | null; label: string }[];
};
type Issue = {
  number: number;
  title: string;
  body: string;
  url: string;
  labels: string[];
};

const SETTINGS_KEY = ["office", "floor-settings"] as const;
const encode = (provider: string, model: string | null | undefined) =>
  `${provider}::${model ?? ""}`;
const decode = (value: string) => {
  const [provider, model] = value.split("::");
  return { provider, model: model || null };
};

function Meter({
  share,
  danger,
  label,
  title,
}: {
  share: number;
  danger?: boolean;
  label: string;
  title: string;
}) {
  const percent = Math.min(100, Math.round(share * 100));
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2" title={title}>
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <div className="h-1.5 min-w-16 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            danger || percent >= 90
              ? "bg-destructive"
              : percent >= 60
                ? "bg-amber-500"
                : "bg-emerald-500",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-10 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {percent}%
      </span>
    </div>
  );
}

function Sparkline({ series }: { series: number[] }) {
  if (!series.some((v) => v > 0)) return null;
  const max = Math.max(1, ...series);
  const points = series
    .map(
      (v, i) =>
        `${(i / Math.max(1, series.length - 1)) * 100},${20 - (v / max) * 18}`,
    )
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      className="h-5 w-24 shrink-0 text-sky-500"
      preserveAspectRatio="none"
      viewBox="0 0 100 20"
    >
      <polyline
        fill="none"
        points={points}
        stroke="currentColor"
        strokeLinejoin="round"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function TokenLimit({
  value,
  onSet,
}: {
  value?: number;
  onSet: (tokens: number | null) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [text, setText] = React.useState("");
  if (!editing) {
    return (
      <Button
        onClick={() => {
          setText(value ? String(value) : "");
          setEditing(true);
        }}
        size="xs"
        title="A per-agent token limit; the circuit breaker steers, then stops the agent near it."
        variant={value ? "secondary" : "ghost"}
      >
        {value ? `Limit ${fmtTokens(value)}` : "Set limit"}
      </Button>
    );
  }
  const commit = () => {
    const n = Number(text.trim());
    onSet(text.trim() && Number.isFinite(n) && n > 0 ? n : null);
    setEditing(false);
  };
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        commit();
      }}
    >
      <Input
        autoFocus
        className="h-7 w-28 text-xs"
        min={0}
        onBlur={commit}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setEditing(false);
        }}
        placeholder="tokens"
        step={100_000}
        type="number"
        value={text}
      />
    </form>
  );
}

function AgentRow({
  agent,
  telemetry,
  settings,
  engines,
  michaelName,
}: {
  agent: OfficeAgent;
  telemetry: Telemetry | undefined;
  settings: FloorSettings | undefined;
  engines: EngineOption[];
  michaelName: string;
}) {
  const client = useQueryClient();
  const [confirmEngine, setConfirmEngine] = React.useState(false);
  const [engine, setEngine] = React.useState(
    () => settings?.godProvider ?? agent.provider,
  );
  const [engineModel, setEngineModel] = React.useState<string | null>(
    () => settings?.godModel ?? agent.model,
  );
  const restart = useMutation({
    mutationFn: (args: {
      model: string | null;
      provider?: string;
      resume?: boolean;
      resumeOptional?: boolean;
    }) =>
      callOffice("agent.restart", {
        id: agent.id,
        ...args,
        model: args.model ?? "",
      }),
    onError: (error) => toast.error(error.message),
  });
  const godEngine = useMutation({
    mutationFn: () =>
      callOffice("floor.setGodEngine", {
        provider: engine,
        model: engineModel ?? "",
      }),
    onSuccess: () => {
      toast(`${agent.name} is restarting on the new engine.`);
      void client.invalidateQueries({ queryKey: SETTINGS_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  const setCap = useMutation({
    mutationFn: (tokens: number | null) =>
      callOffice<Record<string, number>>("floor.setAgentCap", {
        id: agent.id,
        tokens: tokens ?? 0,
      }),
    onSuccess: (caps) =>
      client.setQueryData<FloorSettings>(SETTINGS_KEY, (current) =>
        current ? { ...current, agentTokenCaps: caps } : current,
      ),
    onError: (error) => toast.error(error.message),
  });

  const sample = telemetry?.samples[agent.id];
  const breaker = telemetry?.breakers[agent.id];
  const armed =
    breaker?.level === "constrained" || breaker?.level === "stopped";
  const tokens = sample
    ? sample.input + sample.output + sample.cacheRead + sample.cacheCreation
    : 0;
  // The per-agent limit counts work tokens (cache reads excluded), the floor
  // budget all tokens — the same as the Office's monitor.
  const workTokens = sample
    ? sample.input + sample.output + sample.cacheCreation
    : 0;
  const cap = settings?.agentTokenCaps[agent.id];
  const denom = cap || settings?.tokenCap || DEFAULT_TOKEN_CAP;
  const used = cap ? workTokens : tokens;
  const ctx = contextShare(agent.contextTokens, agent.contextLimit);
  const rate = Math.round(telemetry?.rate[agent.id] ?? 0);
  const current = engines.find((e) => e.id === agent.provider);
  const busy = restart.isPending || godEngine.isPending;
  const currentKnown = current?.models.some((m) => m.id === agent.model);
  const orchestrators = engines.filter((e) => e.canOrchestrate);
  const engineOption = engines.find((e) => e.id === engine);

  return (
    <li
      className={cn(
        "grid gap-2 rounded-xl border px-3 py-3",
        armed ? "border-destructive/40 bg-destructive/5" : "border-border/70",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <AgentAvatar agent={agent} size="sm" />
        <span className="font-medium">{agent.name}</span>
        <AgentStatusPill status={armed ? "looping" : agent.status} />
        {armed ? (
          <span
            className="inline-flex items-center gap-1 text-xs text-destructive"
            title={breaker?.reason}
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {breaker?.level === "stopped" ? "Stopped by budget" : "Constrained"}
          </span>
        ) : null}
        <span className="flex-1" />
        {telemetry?.lastTool[agent.id] ? (
          <Badge variant="outline">{telemetry.lastTool[agent.id]}</Badge>
        ) : null}
        <span className="text-xs tabular-nums text-muted-foreground">
          {telemetry?.toolCounts[agent.id] ?? agent.toolCalls} tool calls
        </span>
        <TokenLimit onSet={(t) => setCap.mutate(t)} value={cap} />
      </div>
      <p className="break-all text-xs text-muted-foreground">{agent.cwd}</p>
      <div className="grid gap-1.5">
        <div className="flex items-center gap-2">
          <Meter
            label="Budget"
            share={used / denom}
            title={`${used.toLocaleString()} of ${denom.toLocaleString()} tokens (${cap ? "this agent's limit" : "floor budget"})`}
            danger={armed}
          />
          <span className="w-14 shrink-0 text-right text-xs tabular-nums">
            {fmtTokens(tokens)}
          </span>
        </div>
        {ctx !== null ? (
          <Meter
            label="Context"
            share={ctx}
            title={`${(agent.contextTokens ?? 0).toLocaleString()} of ${(agent.contextLimit ?? 0).toLocaleString()} tokens in the context window`}
          />
        ) : (
          <p className="text-xs text-muted-foreground">
            Context: no reading yet
          </p>
        )}
        {rate > 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="w-16 shrink-0">Rate</span>
            <Sparkline series={telemetry?.spark[agent.id] ?? []} />
            <span className="tabular-nums">{fmtTokens(rate)}/min</span>
          </div>
        ) : null}
      </div>

      {agent.isGod ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <span className="text-sm text-muted-foreground">Engine</span>
          <select
            aria-label="Michael's engine"
            className={SECTION_SELECT}
            disabled={busy}
            onChange={(event) => {
              const next = orchestrators.find(
                (e) => e.id === event.target.value,
              );
              setEngine(event.target.value);
              setEngineModel(next?.recommendedOrchestratorModel ?? null);
            }}
            value={engine}
          >
            {orchestrators.map((e) => (
              <option key={e.id} value={e.id}>
                {e.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Michael's model"
            className={SECTION_SELECT}
            disabled={busy}
            onChange={(event) => setEngineModel(event.target.value || null)}
            value={engineModel ?? ""}
          >
            {engineOption?.models.map((m) => (
              <option key={m.label} value={m.id ?? ""}>
                {m.label}
              </option>
            ))}
          </select>
          <Button
            disabled={busy}
            onClick={() => {
              if (engine !== agent.provider) setConfirmEngine(true);
              else godEngine.mutate();
            }}
            size="sm"
            variant="outline"
          >
            {godEngine.isPending ? <Loader2 className="animate-spin" /> : null}
            Apply
          </Button>
          <Button
            disabled={busy}
            onClick={() => restart.mutate({ model: agent.model, resume: true })}
            size="sm"
            title={`Restart ${agent.name}'s terminal and pick the conversation back up (for a garbled screen).`}
            variant="ghost"
          >
            <RotateCcw />
            Restart & continue
          </Button>
        </div>
      ) : agent.hasTerminal ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2">
          <select
            aria-label={`${agent.name}'s model`}
            className={SECTION_SELECT}
            disabled={busy}
            onChange={(event) => {
              const choice = decode(event.target.value);
              // Same engine: switch model and keep the conversation.
              restart.mutate({
                model: choice.model,
                provider: choice.provider,
                resume: choice.provider === agent.provider,
                resumeOptional: true,
              });
            }}
            value={encode(agent.provider, agent.model)}
          >
            {!currentKnown ? (
              <option value={encode(agent.provider, agent.model)}>
                {current?.label ?? agent.provider} · {agent.model ?? "current"}
              </option>
            ) : null}
            {engines.map((e) => (
              <optgroup key={e.id} label={e.label}>
                {e.models.map((m) => (
                  <option
                    key={`${e.id}:${m.id ?? "default"}`}
                    value={encode(e.id, m.id)}
                  >
                    {m.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">
            {restart.isPending
              ? "Restarting…"
              : "Changing the model restarts the agent."}
          </span>
          <span className="flex-1" />
          {current?.resumable ? (
            <Button
              disabled={busy}
              onClick={() =>
                restart.mutate({ model: agent.model, resume: true })
              }
              size="sm"
              variant="ghost"
            >
              <RotateCcw />
              Restart & continue
            </Button>
          ) : null}
        </div>
      ) : null}

      <AlertDialog onOpenChange={setConfirmEngine} open={confirmEngine}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch {agent.name}'s engine?</AlertDialogTitle>
            <AlertDialogDescription>
              {agent.name} restarts on {engineOption?.label ?? engine} with a
              fresh session; the current conversation doesn't carry over to a
              different engine.{" "}
              {michaelName === agent.name ? "The floor keeps running." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => godEngine.mutate()}>
              Switch and restart
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/** Models, token budgets and restarts for the floor, plus its folders, issues
 *  and closed agents. */
export function ModelsBudgetsSection() {
  const client = useQueryClient();
  const { agents } = useOfficeAgents();
  const michaelName = agents.find((agent) => agent.isGod)?.name ?? "Michael";
  const ordered = [...agents].sort((a, b) => Number(b.isGod) - Number(a.isGod));
  const telemetry = useQuery({
    queryKey: ["office", "telemetry"],
    queryFn: () => callOffice<Telemetry>("telemetry"),
    refetchInterval: 3_000,
  });
  const settings = useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => callOffice<FloorSettings>("floor.settings"),
    refetchInterval: 15_000,
  });
  const engines = useQuery({
    queryKey: ["office", "models-options"],
    queryFn: () => callOffice<EngineOption[]>("models.options"),
    staleTime: 5 * 60_000,
  });
  const archived = useQuery({
    queryKey: ["office", "archived"],
    queryFn: () =>
      callOffice<{ id: string; name: string; accent: string; cwd: string }[]>(
        "agents.archived",
      ),
    refetchInterval: 10_000,
  });
  const [issueRepo, setIssueRepo] = React.useState("");
  const [forget, setForget] = React.useState<{
    id: string;
    name: string;
  } | null>(null);
  const issues = useMutation({
    mutationFn: (repo: string) =>
      officeCth<{ ok: boolean; issues?: Issue[]; error?: string }>(
        "githubIssues",
        repo,
      ),
  });
  const dispatchIssue = useMutation({
    mutationFn: (issue: Issue) =>
      callOffice("dispatch", {
        text: `GitHub issue #${issue.number}: ${issue.title}\n\n${(issue.body ?? "").slice(0, 600)}\n\nURL: ${issue.url}`,
      }),
    onSuccess: () => toast.success(`Sent to ${michaelName}.`),
    onError: (error) => toast.error(error.message),
  });
  const removeArchived = useMutation({
    mutationFn: (id: string) => callOffice("agents.archived.remove", { id }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: ["office", "archived"] }),
  });

  let sumTokens = 0;
  let sumInput = 0;
  let sumCache = 0;
  let sumRate = 0;
  for (const agent of agents) {
    const s = telemetry.data?.samples[agent.id];
    if (s) {
      sumTokens += s.input + s.output + s.cacheRead + s.cacheCreation;
      sumInput += s.input + s.cacheRead + s.cacheCreation;
      sumCache += s.cacheRead;
    }
    sumRate += telemetry.data?.rate[agent.id] ?? 0;
  }
  const repos = settings.data?.repos ?? [];
  const floorCap = settings.data?.tokenCap || DEFAULT_TOKEN_CAP;

  return (
    <div className="grid gap-4" data-testid="section-models">
      <SectionCard
        description={`Spend, context and engine for each agent. Bars measure against the agent's own limit, else the floor budget (${fmtTokens(floorCap)}${settings.data?.tokenCap ? "" : ", the default; set yours in the Office's Settings"}).`}
        title="Agents"
      >
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl bg-muted/40 px-3 py-2 text-sm">
          <span>
            Total{" "}
            <strong className="tabular-nums">{fmtTokens(sumTokens)}</strong>{" "}
            tokens
          </span>
          <span className="text-muted-foreground">
            Inputs {fmtTokens(sumInput)} ·{" "}
            {sumInput > 0 ? Math.round((sumCache / sumInput) * 100) : 0}% from
            cache
          </span>
          <span className="text-muted-foreground">
            {Math.round(sumRate).toLocaleString()} tokens/min
          </span>
        </div>
        <ul className="grid gap-2">
          {ordered.map((agent) => (
            <AgentRow
              agent={agent}
              engines={engines.data ?? []}
              key={`${agent.id}:${settings.data ? "s" : "-"}`}
              michaelName={michaelName}
              settings={settings.data}
              telemetry={telemetry.data}
            />
          ))}
        </ul>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard description="Projects the agents work in." title="Folders">
          {repos.length === 0 ? (
            <Muted>
              No folders yet. They appear as agents are hired into them.
            </Muted>
          ) : (
            <ul className="grid gap-1">
              {repos.map((repo) => (
                <li className="flex items-center gap-2 text-sm" key={repo}>
                  <span className="min-w-0 flex-1 break-all">{repo}</span>
                  <Button
                    aria-label={`Open a terminal in ${repo}`}
                    onClick={() =>
                      void officeCth("openTerminalAt", repo).catch(
                        (error: Error) => toast.error(error.message),
                      )
                    }
                    size="icon-xs"
                    title="Open a system terminal here"
                    variant="ghost"
                  >
                    <SquareTerminal />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          description={`Open issues from a folder's GitHub repo; send one to ${michaelName} as work.`}
          title="GitHub issues"
        >
          {repos.length === 0 ? (
            <Muted>No folders yet.</Muted>
          ) : (
            <>
              <div className="flex gap-2">
                <select
                  aria-label="Repository"
                  className={cn(SECTION_SELECT, "min-w-0 flex-1")}
                  onChange={(event) => setIssueRepo(event.target.value)}
                  value={issueRepo || repos[0]}
                >
                  {repos.map((repo) => (
                    <option key={repo} value={repo}>
                      {repo}
                    </option>
                  ))}
                </select>
                <Button
                  disabled={issues.isPending}
                  onClick={() => issues.mutate(issueRepo || repos[0])}
                  variant="outline"
                >
                  {issues.isPending ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <GitPullRequestArrow />
                  )}
                  Fetch
                </Button>
              </div>
              <ErrorLine
                error={
                  issues.error ??
                  (issues.data && !issues.data.ok ? issues.data.error : null)
                }
              />
              {issues.data?.ok ? (
                (issues.data.issues ?? []).length === 0 ? (
                  <Muted>No open issues.</Muted>
                ) : (
                  <ul className="grid gap-2">
                    {(issues.data.issues ?? []).slice(0, 10).map((issue) => (
                      <li
                        className="grid gap-1 rounded-xl border border-border/70 px-3 py-2"
                        key={issue.number}
                      >
                        <div className="flex items-start gap-2">
                          <span className="min-w-0 flex-1 text-sm">
                            <strong>#{issue.number}</strong> {issue.title}
                          </span>
                          <Button
                            disabled={dispatchIssue.isPending}
                            onClick={() => dispatchIssue.mutate(issue)}
                            size="xs"
                            variant="outline"
                          >
                            <Send />
                            Send to {michaelName}
                          </Button>
                        </div>
                        {issue.labels.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {issue.labels.map((label) => (
                              <Badge key={label} variant="secondary">
                                {label}
                              </Badge>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}
        </SectionCard>
      </div>

      {(archived.data ?? []).length > 0 ? (
        <SectionCard
          description="Agents whose terminals were closed."
          title={`Closed agents · ${archived.data?.length ?? 0}`}
        >
          <ul className="grid gap-1">
            {archived.data?.map((agent) => (
              <li
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm opacity-80 hover:bg-muted/40"
                key={agent.id}
              >
                <AgentAvatar agent={agent} size="sm" />
                <span className="font-medium">{agent.name}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {agent.cwd}
                </span>
                <Button
                  aria-label={`Forget ${agent.name}`}
                  onClick={() => setForget({ id: agent.id, name: agent.name })}
                  size="icon-xs"
                  title="Remove from this list"
                  variant="ghost"
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </SectionCard>
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setForget(null);
        }}
        open={!!forget}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {forget?.name} from closed agents?
            </AlertDialogTitle>
            <AlertDialogDescription>
              They come off this list. Their memory and history in the hive
              stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (forget) removeArchived.mutate(forget.id);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
