import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { Gauge, Loader2, Pause, Play, Snowflake } from "lucide-react";
import { toast } from "sonner";

import {
  type AccountUsage,
  type AiAccount,
  type AtCap,
  aiAccountUsage,
  type Engine,
  freezeEngine,
  getUsageGuard,
  ruleKey,
  setUsageRule,
  type UsageRule,
  windowTotal,
} from "@/features/settings/lib/aiAccounts";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";

/**
 * The smart layer over the AI accounts (Rust: `ai_accounts::guard`): caps
 * per account, what happens when one is reached (switch accounts, freeze the
 * agents, or warn), freezing an engine's agents by hand, and what the guard
 * has done. Checked once a minute in the app, for every server's Office.
 */

export const GUARD_KEY = ["ai-accounts", "guard"] as const;

export function useUsageGuard() {
  const client = useQueryClient();
  React.useEffect(() => {
    let off: (() => void) | undefined;
    void listen("ai-usage-guard", () => {
      void client.invalidateQueries({ queryKey: GUARD_KEY });
      void client.invalidateQueries({ queryKey: ["ai-accounts"] });
    }).then((unlisten) => {
      off = unlisten;
    });
    return () => off?.();
  }, [client]);
  return useQuery({
    queryKey: GUARD_KEY,
    queryFn: getUsageGuard,
    refetchInterval: 30_000,
  });
}

/** Shows what the guard did (switched, froze, warned) wherever you are. */
export function useUsageAlerts() {
  React.useEffect(() => {
    let off: (() => void) | undefined;
    void listen<string>("ai-usage-alert", (event) => {
      toast(event.payload, { duration: 10_000 });
    }).then((unlisten) => {
      off = unlisten;
    });
    return () => off?.();
  }, []);
}

const AT_CAP_OPTIONS: { value: AtCap; label: string; hint: string }[] = [
  {
    value: "switch",
    label: "Switch account",
    hint: "Move the agents to the next account under its caps; freeze if there's none.",
  },
  {
    value: "freeze",
    label: "Freeze agents",
    hint: "Pause the agents until the usage drops back under the cap.",
  },
  {
    value: "warn",
    label: "Just warn",
    hint: "Tell me, and keep going.",
  },
];

const EMPTY_RULE: UsageRule = {
  cap5h: null,
  capDay: null,
  capWeek: null,
  capPercent: null,
  atCap: "switch",
};

/** Millions of tokens in the field; whole tokens in the rule. */
const toField = (tokens: number | null) =>
  tokens ? String(+(tokens / 1e6).toFixed(2)) : "";
const fromField = (text: string) => {
  const n = Number.parseFloat(text);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6) : null;
};

function CapBar({
  label,
  used,
  cap,
}: {
  label: string;
  used: number;
  cap: number | null;
}) {
  if (!cap) return null;
  const percent = Math.min(100, (used / cap) * 100);
  return (
    <div className="grid gap-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {(used / 1e6).toFixed(1)}M of {(cap / 1e6).toFixed(1)}M
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full",
            percent >= 100
              ? "bg-destructive"
              : percent >= 80
                ? "bg-amber-500"
                : "bg-sky-500",
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/** One account's caps: set them, and see usage against them. */
export function UsageRulesPanel({
  engine,
  account,
}: {
  engine: Engine;
  account: AiAccount;
}) {
  const client = useQueryClient();
  const guard = useUsageGuard();
  const saved = guard.data?.rules[ruleKey(engine, account.id)] ?? null;
  const usage = useQuery({
    queryKey: ["ai-accounts", "usage", engine, account.id],
    queryFn: () => aiAccountUsage(engine, account.id),
    refetchInterval: 60_000,
  });
  const data: AccountUsage | undefined = usage.data;
  const [draft, setDraft] = React.useState<UsageRule>(saved ?? EMPTY_RULE);
  const [fields, setFields] = React.useState(() => ({
    cap5h: toField(saved?.cap5h ?? null),
    capDay: toField(saved?.capDay ?? null),
    capWeek: toField(saved?.capWeek ?? null),
    capPercent: saved?.capPercent ? String(saved.capPercent) : "",
  }));
  const savedJson = JSON.stringify(saved);
  // Follow what's saved (another window, or the guard) until edited here.
  const [touched, setTouched] = React.useState(false);
  React.useEffect(() => {
    if (touched) return;
    const rule = savedJson ? (JSON.parse(savedJson) as UsageRule | null) : null;
    setDraft(rule ?? EMPTY_RULE);
    setFields({
      cap5h: toField(rule?.cap5h ?? null),
      capDay: toField(rule?.capDay ?? null),
      capWeek: toField(rule?.capWeek ?? null),
      capPercent: rule?.capPercent ? String(rule.capPercent) : "",
    });
  }, [savedJson, touched]);

  const next: UsageRule = {
    ...draft,
    cap5h: fromField(fields.cap5h),
    capDay: fromField(fields.capDay),
    capWeek: fromField(fields.capWeek),
    capPercent: (() => {
      const n = Number.parseFloat(fields.capPercent);
      return Number.isFinite(n) && n > 0 ? Math.min(100, n) : null;
    })(),
  };
  const hasCaps =
    next.cap5h !== null ||
    next.capDay !== null ||
    next.capWeek !== null ||
    next.capPercent !== null;
  const dirty = JSON.stringify(hasCaps ? next : null) !== savedJson;

  const save = useMutation({
    mutationFn: () => setUsageRule(engine, account.id, hasCaps ? next : null),
    onSuccess: () => {
      setTouched(false);
      toast.success(hasCaps ? "Usage caps saved." : "Usage caps removed.");
      void client.invalidateQueries({ queryKey: GUARD_KEY });
    },
    onError: (error) => toast.error(error.message),
  });

  const field = (
    key: keyof typeof fields,
    label: string,
    unit: string,
    placeholder: string,
  ) => (
    <label
      className="grid gap-1 text-xs text-muted-foreground"
      htmlFor={`cap-${engine}-${account.id}-${key}`}
    >
      {label}
      <span className="flex items-center gap-1.5">
        <Input
          className="h-8 w-24 tabular-nums"
          id={`cap-${engine}-${account.id}-${key}`}
          inputMode="decimal"
          onChange={(event) => {
            setTouched(true);
            setFields((f) => ({ ...f, [key]: event.target.value }));
          }}
          placeholder={placeholder}
          value={fields[key]}
        />
        <span>{unit}</span>
      </span>
    </label>
  );

  const option = AT_CAP_OPTIONS.find((o) => o.value === draft.atCap);
  return (
    <div
      className="grid gap-3 rounded-xl border border-border/60 bg-muted/20 p-3"
      data-testid={`ai-usage-rules-${engine}-${account.id}`}
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        <Gauge className="h-4 w-4 text-muted-foreground" />
        Usage caps
        {saved ? (
          <span className="text-xs font-normal text-muted-foreground">
            · watched every minute
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-4">
        {field("cap5h", "Last 5 hours", "M tokens", "no cap")}
        {field("capDay", "Today", "M tokens", "no cap")}
        {field("capWeek", "Last 7 days", "M tokens", "no cap")}
        {data?.limits.length
          ? field("capPercent", "Plan limit", "% used", "no cap")
          : null}
      </div>
      {data && saved ? (
        <div className="grid gap-2">
          <CapBar
            cap={saved.cap5h}
            label="Last 5 hours"
            used={windowTotal(data.last5h)}
          />
          <CapBar
            cap={saved.capDay}
            label="Today"
            used={windowTotal(data.today)}
          />
          <CapBar
            cap={saved.capWeek}
            label="Last 7 days"
            used={windowTotal(data.week)}
          />
        </div>
      ) : null}
      <div className="grid gap-1.5">
        <span className="text-xs text-muted-foreground">
          When a cap is reached
        </span>
        <div className="flex w-fit flex-wrap gap-1 rounded-lg bg-muted/60 p-1 text-sm">
          {AT_CAP_OPTIONS.map((o) => (
            <button
              aria-pressed={draft.atCap === o.value}
              className={cn(
                "rounded-md px-3 py-1",
                draft.atCap === o.value
                  ? "bg-background font-medium shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
              key={o.value}
              onClick={() => {
                setTouched(true);
                setDraft((d) => ({ ...d, atCap: o.value }));
              }}
              type="button"
            >
              {o.label}
            </button>
          ))}
        </div>
        {option ? (
          <p className="text-xs text-muted-foreground">{option.hint}</p>
        ) : null}
      </div>
      {dirty ? (
        <div className="flex gap-2">
          <Button
            disabled={save.isPending}
            onClick={() => save.mutate()}
            size="sm"
          >
            {save.isPending ? <Loader2 className="animate-spin" /> : null}
            {hasCaps ? "Save caps" : "Remove caps"}
          </Button>
          <Button
            onClick={() => setTouched(false)}
            size="sm"
            type="button"
            variant="ghost"
          >
            Discard
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** Freeze or unfreeze an engine's agents by hand. */
export function FreezeButton({
  engine,
  label,
}: {
  engine: Engine;
  label: string;
}) {
  const client = useQueryClient();
  const guard = useUsageGuard();
  const frozen = guard.data?.frozen[engine];
  const toggle = useMutation({
    mutationFn: () => freezeEngine(engine, !frozen),
    onSuccess: () => {
      toast(
        frozen
          ? `${label} agents unfrozen.`
          : `${label} agents frozen: they stop at their next step.`,
      );
      void client.invalidateQueries({ queryKey: GUARD_KEY });
    },
    onError: (error) => toast.error(error.message),
  });
  return (
    <Button
      disabled={toggle.isPending}
      onClick={() => toggle.mutate()}
      size="sm"
      variant={frozen ? "default" : "outline"}
    >
      {frozen ? <Play /> : <Pause />}
      {frozen ? "Unfreeze" : "Freeze agents"}
    </Button>
  );
}

/** The engine's agents are frozen: why, and since when. */
export function FrozenBanner({
  engine,
  label,
}: {
  engine: Engine;
  label: string;
}) {
  const guard = useUsageGuard();
  const frozen = guard.data?.frozen[engine];
  if (!frozen) return null;
  return (
    <div className="mx-4 my-3 flex items-start gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sm">
      <Snowflake className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
      <div className="min-w-0">
        <p className="font-medium">
          {label} agents are frozen
          <span className="font-normal text-muted-foreground">
            {" "}
            since{" "}
            {new Date(frozen.since).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </p>
        <p className="text-xs text-muted-foreground">
          {frozen.manual
            ? "Frozen by hand: they stay paused until you unfreeze them."
            : `${frozen.reason[0]?.toUpperCase() ?? ""}${frozen.reason.slice(1)}. They unfreeze on their own once usage is back under the cap.`}
        </p>
      </div>
    </div>
  );
}

/** What the guard has done lately. */
export function UsageActivity() {
  const guard = useUsageGuard();
  const log = guard.data?.log ?? [];
  if (log.length === 0) return null;
  return (
    <div className="grid gap-1.5 px-4 py-3" data-testid="ai-usage-activity">
      {log.slice(0, 12).map((entry) => (
        <div className="flex gap-3 text-sm" key={`${entry.at}-${entry.text}`}>
          <span className="w-24 shrink-0 tabular-nums text-xs leading-5 text-muted-foreground">
            {new Date(entry.at).toLocaleString([], {
              month: "short",
              day: "numeric",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          <span className="min-w-0">{entry.text}</span>
        </div>
      ))}
    </div>
  );
}
