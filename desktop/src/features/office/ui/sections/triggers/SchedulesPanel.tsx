import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { officeCth, relTime } from "@/features/office/lib/officeCth";
import { useOfficeAgents } from "@/features/office/lib/officeLink";
import {
  formatInterval,
  formatMinute,
  formatWeekly,
  INTERVALS,
  nextWeeklyFireMs,
  normalizeWeekly,
  WEEKDAYS,
  type Weekly,
} from "@/features/office/lib/schedule";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Switch } from "@/shared/ui/switch";
import { Textarea } from "@/shared/ui/textarea";

import { Muted, SECTION_SELECT } from "../SectionBits";

/** Mirrors the Office's ScheduledMission. */
type Mission = {
  id: string;
  label: string;
  intervalMs: number;
  to: string;
  body: string;
  enabled: boolean;
  autoCompact?: boolean;
  lastFiredAt?: number;
  kind?: "dispatch" | "heartbeat" | "compact";
  quietThresholdMs?: number;
  weekly?: Weekly;
};

const KEY = ["office", "missions"] as const;

function When({
  intervalMs,
  weekly,
  onInterval,
  onWeekly,
  intervalOnly,
}: {
  intervalMs: number;
  weekly: Weekly | null;
  onInterval: (ms: number) => void;
  onWeekly: (w: Weekly | null) => void;
  intervalOnly?: boolean;
}) {
  const preset = INTERVALS.some((i) => i.ms === intervalMs);
  return (
    <div className="grid gap-2">
      {intervalOnly ? null : (
        <div className="flex gap-1">
          {(["interval", "weekly"] as const).map((kind) => (
            <Button
              key={kind}
              onClick={() =>
                onWeekly(
                  kind === "weekly"
                    ? (weekly ?? { days: [1, 2, 3, 4, 5], minute: 9 * 60 })
                    : null,
                )
              }
              size="xs"
              type="button"
              variant={(kind === "weekly") === !!weekly ? "secondary" : "ghost"}
            >
              {kind === "interval" ? "Repeating" : "On days"}
            </Button>
          ))}
        </div>
      )}
      {weekly && !intervalOnly ? (
        <div className="flex flex-wrap items-center gap-2">
          {WEEKDAYS.map((label, day) => {
            const on = weekly.days.includes(day);
            return (
              <button
                aria-pressed={on}
                className={cn(
                  "h-8 w-11 rounded-lg border text-xs font-medium transition-colors",
                  on
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input/40 hover:bg-muted/60",
                )}
                key={label}
                onClick={() =>
                  onWeekly({
                    ...weekly,
                    days: on
                      ? weekly.days.filter((d) => d !== day)
                      : [...weekly.days, day],
                  })
                }
                type="button"
              >
                {label}
              </button>
            );
          })}
          <Input
            aria-label="Time of day"
            className="h-8 w-28"
            onChange={(event) => {
              const [h, m] = event.target.value.split(":").map(Number);
              if (Number.isFinite(h) && Number.isFinite(m)) {
                onWeekly({ ...weekly, minute: h * 60 + m });
              }
            }}
            type="time"
            value={formatMinute(weekly.minute)}
          />
        </div>
      ) : (
        <select
          aria-label="How often"
          className={SECTION_SELECT}
          onChange={(event) => onInterval(Number(event.target.value))}
          value={String(intervalMs)}
        >
          {preset ? null : (
            <option value={String(intervalMs)}>
              {formatInterval(intervalMs)}
            </option>
          )}
          {INTERVALS.map((i) => (
            <option key={i.ms} value={String(i.ms)}>
              {i.label}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

function MissionEditor({
  initial,
  agents,
  michaelName,
  submitLabel,
  heartbeat,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial: Pick<Mission, "label" | "to" | "intervalMs" | "body"> & {
    weekly: Weekly | null;
  };
  agents: { id: string; name: string; isGod: boolean }[];
  michaelName: string;
  submitLabel: string;
  heartbeat?: boolean;
  onSubmit: (
    fields: Pick<Mission, "label" | "to" | "intervalMs" | "body"> & {
      weekly: Weekly | null;
    },
  ) => void;
  onCancel?: () => void;
  onDelete?: () => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  const formId = React.useId();
  const usable = !draft.weekly || normalizeWeekly(draft.weekly) !== null;
  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!draft.label.trim() || !draft.body.trim() || !usable) return;
        onSubmit({ ...draft, label: draft.label.trim() });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label
          className="grid gap-1.5 text-sm font-medium"
          htmlFor={`${formId}-name`}
        >
          Name
          <Input
            id={`${formId}-name`}
            onChange={(event) =>
              setDraft({ ...draft, label: event.target.value })
            }
            placeholder="Morning stand-up"
            value={draft.label}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Goes to
          <select
            className={SECTION_SELECT}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
            value={draft.to}
          >
            <option value="broadcast">Everyone</option>
            <option value="god">{michaelName}</option>
            {agents
              .filter((a) => !a.isGod)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <div className="grid gap-1.5">
        <span className="text-sm font-medium">When</span>
        <When
          intervalMs={draft.intervalMs}
          intervalOnly={heartbeat}
          onInterval={(intervalMs) => setDraft({ ...draft, intervalMs })}
          onWeekly={(weekly) => setDraft({ ...draft, weekly })}
          weekly={draft.weekly}
        />
        {heartbeat ? (
          <p className="text-xs text-muted-foreground">
            The heartbeat adapts to how busy the floor is; this is its longest
            gap.
          </p>
        ) : null}
      </div>
      <label
        className="grid gap-1.5 text-sm font-medium"
        htmlFor={`${formId}-prompt`}
      >
        Prompt
        <Textarea
          id={`${formId}-prompt`}
          className="min-h-20"
          onChange={(event) => setDraft({ ...draft, body: event.target.value })}
          placeholder="What should happen each time"
          value={draft.body}
        />
      </label>
      <div className="flex items-center gap-2">
        <Button
          disabled={!draft.label.trim() || !draft.body.trim() || !usable}
          size="sm"
          type="submit"
        >
          {submitLabel}
        </Button>
        {onCancel ? (
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            Cancel
          </Button>
        ) : null}
        <span className="flex-1" />
        {onDelete ? (
          <Button onClick={onDelete} size="sm" type="button" variant="ghost">
            <Trash2 />
            Delete
          </Button>
        ) : null}
      </div>
    </form>
  );
}

/** Recurring missions: a prompt sent on a clock. */
export function SchedulesPanel() {
  const client = useQueryClient();
  const { agents } = useOfficeAgents();
  const michaelName = agents.find((a) => a.isGod)?.name ?? "Michael";
  const missions = useQuery({
    queryKey: KEY,
    queryFn: () => officeCth<Mission[]>("listMissions"),
    refetchInterval: 10_000,
  });
  const [openId, setOpenId] = React.useState<string | null>(null);
  const [adding, setAdding] = React.useState(false);
  const list = missions.data ?? [];

  const persist = (next: Mission[]) => {
    client.setQueryData(KEY, next);
    void officeCth("saveMissions", next).catch((error: Error) => {
      toast.error(error.message);
      void client.invalidateQueries({ queryKey: KEY });
    });
  };
  const target = (to: string) =>
    to === "broadcast"
      ? "everyone"
      : to === "god"
        ? michaelName
        : (agents.find((a) => a.id === to)?.name ?? to);

  return (
    <div className="grid gap-3">
      <Muted>Run a prompt on a repeating clock.</Muted>
      {list.length === 0 && !missions.isLoading ? (
        <Muted>Nothing scheduled.</Muted>
      ) : null}
      <ul className="grid gap-2">
        {list.map((mission) => {
          const weekly = normalizeWeekly(mission.weekly);
          const heartbeat = mission.kind === "heartbeat";
          const nextAt = weekly
            ? nextWeeklyFireMs(weekly, Date.now())
            : mission.lastFiredAt
              ? mission.lastFiredAt + mission.intervalMs
              : null;
          const open = openId === mission.id;
          return (
            <li
              className="grid gap-2 rounded-xl border border-border/70 px-3 py-2"
              key={mission.id}
            >
              <div className="flex items-center gap-2">
                <button
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  onClick={() => setOpenId(open ? null : mission.id)}
                  type="button"
                >
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <Badge variant={mission.enabled ? "default" : "secondary"}>
                    {heartbeat
                      ? "Heartbeat"
                      : weekly
                        ? formatWeekly(weekly)
                        : formatInterval(mission.intervalMs)}
                  </Badge>
                  <span className="truncate font-medium">{mission.label}</span>
                </button>
                <Switch
                  aria-label={mission.enabled ? "Turn off" : "Turn on"}
                  checked={mission.enabled}
                  onCheckedChange={(enabled) =>
                    persist(
                      list.map((m) =>
                        m.id === mission.id ? { ...m, enabled } : m,
                      ),
                    )
                  }
                />
              </div>
              <p className="pl-6 text-xs text-muted-foreground">
                → {target(mission.to)} ·{" "}
                {mission.lastFiredAt
                  ? `ran ${relTime(Date.now() - mission.lastFiredAt)}`
                  : "hasn't run yet"}
                {mission.enabled && nextAt
                  ? ` · next ${relTime(Date.now() - nextAt)}`
                  : ""}
              </p>
              {open ? (
                <div className="pl-6">
                  <MissionEditor
                    agents={agents}
                    heartbeat={heartbeat}
                    initial={{ ...mission, weekly }}
                    michaelName={michaelName}
                    onDelete={() => {
                      persist(list.filter((m) => m.id !== mission.id));
                      setOpenId(null);
                      toast("Schedule deleted.");
                    }}
                    onSubmit={(fields) => {
                      persist(
                        list.map((m) =>
                          m.id === mission.id
                            ? {
                                ...m,
                                ...fields,
                                weekly: fields.weekly ?? undefined,
                              }
                            : m,
                        ),
                      );
                      toast.success("Saved.");
                    }}
                    submitLabel="Save"
                  />
                </div>
              ) : (
                <p className="truncate pl-6 font-mono text-xs text-muted-foreground">
                  {mission.body.trim() || "(no prompt)"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
      {adding ? (
        <div className="rounded-xl border border-border/70 px-3 py-3">
          <MissionEditor
            agents={agents}
            initial={{
              label: "",
              to: "god",
              intervalMs: 3_600_000,
              body: "",
              weekly: null,
            }}
            michaelName={michaelName}
            onCancel={() => setAdding(false)}
            onSubmit={(fields) => {
              persist([
                ...list,
                {
                  id: `m_${Date.now().toString(36)}`,
                  ...fields,
                  weekly: fields.weekly ?? undefined,
                  enabled: true,
                },
              ]);
              setAdding(false);
            }}
            submitLabel="Add schedule"
          />
        </div>
      ) : (
        <div>
          <Button onClick={() => setAdding(true)} size="sm" variant="outline">
            <Plus />
            Add schedule
          </Button>
        </div>
      )}
    </div>
  );
}
