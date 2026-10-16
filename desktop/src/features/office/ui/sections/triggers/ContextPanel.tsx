import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { officeCth } from "@/features/office/lib/officeCth";
import { formatInterval } from "@/features/office/lib/schedule";
import { cn } from "@/shared/lib/cn";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

import { Muted, SECTION_SELECT } from "../SectionBits";

type Rule = {
  enabled: boolean;
  everyMs: number;
  minContextPct: number;
  minContextPctLargeWindow: number;
  message: string;
};
type Config = { compact: Rule; clear: Rule };

const DEFAULTS: Config = {
  compact: {
    enabled: true,
    everyMs: 7_200_000,
    minContextPct: 60,
    minContextPctLargeWindow: 40,
    message:
      "Keep the current task, recent decisions, open questions, and file paths in play. Drop resolved tangents.",
  },
  clear: {
    enabled: false,
    everyMs: 7_200_000,
    minContextPct: 90,
    minContextPctLargeWindow: 80,
    message: "",
  },
};

/** Context cadences: 1 minute … 24 hours, as the Office clamps them. */
const CADENCES = [
  60_000, 300_000, 900_000, 1_800_000, 3_600_000, 7_200_000, 21_600_000,
  43_200_000, 86_400_000,
];

function fill(partial: Partial<Rule> | undefined, fallback: Rule): Rule {
  return {
    enabled: partial?.enabled ?? fallback.enabled,
    everyMs:
      typeof partial?.everyMs === "number" ? partial.everyMs : fallback.everyMs,
    minContextPct:
      typeof partial?.minContextPct === "number"
        ? partial.minContextPct
        : fallback.minContextPct,
    minContextPctLargeWindow:
      typeof partial?.minContextPctLargeWindow === "number"
        ? partial.minContextPctLargeWindow
        : fallback.minContextPctLargeWindow,
    message:
      typeof partial?.message === "string" ? partial.message : fallback.message,
  };
}

function Pct({
  value,
  onChange,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  label: string;
}) {
  const id = React.useId();
  return (
    <label className="grid gap-1.5 text-sm font-medium" htmlFor={id}>
      {label}
      <div className="flex items-center gap-2">
        <Input
          className="w-24"
          id={id}
          max={100}
          min={0}
          onChange={(event) => {
            const n = Math.round(Number(event.target.value));
            if (Number.isFinite(n)) onChange(Math.min(100, Math.max(0, n)));
          }}
          type="number"
          value={value}
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
    </label>
  );
}

function RuleCard({
  title,
  blurb,
  rule,
  messageLabel,
  messageHint,
  placeholder,
  caution,
  onPatch,
}: {
  title: string;
  blurb: string;
  rule: Rule;
  messageLabel: string;
  messageHint: string;
  placeholder: string;
  caution?: string;
  onPatch: (fields: Partial<Rule>) => void;
}) {
  const messageId = React.useId();
  return (
    <div className="grid gap-3 rounded-xl border border-border/70 px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{blurb}</p>
        </div>
        <Switch
          aria-label={`${title} on or off`}
          checked={rule.enabled}
          onCheckedChange={(enabled) => onPatch({ enabled })}
        />
      </div>
      {caution ? (
        <p
          className={cn(
            "rounded-lg px-3 py-2 text-xs",
            rule.enabled
              ? "border border-destructive/30 bg-destructive/10 text-destructive"
              : "bg-muted/50 text-muted-foreground",
          )}
        >
          {caution}
        </p>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="grid gap-1.5 text-sm font-medium">
          No sooner than
          <select
            className={SECTION_SELECT}
            onChange={(event) =>
              onPatch({ everyMs: Number(event.target.value) })
            }
            value={String(rule.everyMs)}
          >
            {CADENCES.includes(rule.everyMs) ? null : (
              <option value={String(rule.everyMs)}>
                {formatInterval(rule.everyMs)}
              </option>
            )}
            {CADENCES.map((ms) => (
              <option key={ms} value={String(ms)}>
                {formatInterval(ms)}
              </option>
            ))}
          </select>
        </label>
        <Pct
          label="Once context is past"
          onChange={(minContextPct) => onPatch({ minContextPct })}
          value={rule.minContextPct}
        />
        <Pct
          label="On ~1M-token windows"
          onChange={(minContextPctLargeWindow) =>
            onPatch({ minContextPctLargeWindow })
          }
          value={rule.minContextPctLargeWindow}
        />
      </div>
      <label className="grid gap-1.5 text-sm font-medium" htmlFor={messageId}>
        {messageLabel}
        <Textarea
          className="min-h-16"
          id={messageId}
          onChange={(event) => onPatch({ message: event.target.value })}
          placeholder={placeholder}
          value={rule.message}
        />
        <span className="text-xs font-normal text-muted-foreground">
          {messageHint}
        </span>
      </label>
    </div>
  );
}

/** Compact or clear an agent as its context fills. */
export function ContextPanel() {
  const loaded = useQuery({
    queryKey: ["office", "context-trigger"],
    queryFn: async () => {
      const raw = await officeCth<Partial<Config> | null>("getContextTrigger");
      return {
        compact: fill(raw?.compact, DEFAULTS.compact),
        clear: fill(raw?.clear, DEFAULTS.clear),
      };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [cfg, setCfg] = React.useState<Config | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (loaded.data && !cfg) setCfg(loaded.data);
  }, [loaded.data, cfg]);
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  if (!cfg) return <Muted>Loading…</Muted>;
  const patch = (key: keyof Config, fields: Partial<Rule>) => {
    const next = { ...cfg, [key]: { ...cfg[key], ...fields } };
    setCfg(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void officeCth("setContextTrigger", next).catch((error: Error) =>
        toast.error(error.message),
      );
    }, 400);
  };

  return (
    <div className="grid gap-3">
      <Muted>
        A rule runs only when both hold: the gap since its last run has passed,
        and that agent's context is at least that full. 0% means the clock
        alone.
      </Muted>
      <RuleCard
        blurb="Summarises the context so the thread keeps going."
        messageHint="Added to the engine's compaction command. Empty sends the bare command."
        messageLabel="Extra focus"
        onPatch={(fields) => patch("compact", fields)}
        placeholder="What the summary must keep…"
        rule={cfg.compact}
        title="Compact"
      />
      <RuleCard
        blurb="Discards the context. Nothing is summarised."
        caution="Clearing throws context away; it isn't a smaller version of compaction. An agent mid-task forgets what it was doing. Leave this off unless you keep context another way."
        messageHint="Sent literally. Empty sends the bare clear command."
        messageLabel="Command"
        onPatch={(fields) => patch("clear", fields)}
        placeholder="/clear"
        rule={cfg.clear}
        title="Clear"
      />
    </div>
  );
}
