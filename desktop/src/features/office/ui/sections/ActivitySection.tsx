import { useQuery } from "@tanstack/react-query";

import { officeCth, relTime } from "@/features/office/lib/officeCth";
import {
  type OfficeAgent,
  useOfficeAgents,
} from "@/features/office/lib/officeLink";
import { agentLabel } from "@/features/tasks/lib/agentNames";
import { Badge } from "@/shared/ui/badge";
import { Markdown } from "@/shared/ui/markdown";

import { Muted, SectionCard } from "./SectionBits";

type LogEntry = {
  ts?: number;
  kind?: string;
  [key: string]: unknown;
};

function describe(entry: LogEntry, agents: OfficeAgent[]): string {
  const name = (id: unknown) =>
    typeof id === "string" ? agentLabel(id, agents) : String(id ?? "?");
  switch (entry.kind) {
    case "spawn":
      return `${String(entry.name ?? name(entry.agentId))} joined the floor`;
    case "archive":
      return `${name(entry.agentId)} left the floor`;
    case "message":
      return `${name(entry.from)} → ${name(entry.to)}: ${String(entry.subject || entry.act || "message")}`;
    case "drain":
      return `${name(entry.agentId)} picked up ${String(entry.count ?? "")} message(s)`;
    case "escalate":
      return `Escalated to you: ${String(entry.subject ?? "")}`;
    case "approval":
      return entry.approve ? "Approval granted" : "Approval denied";
    case "role":
      return `${name(entry.agentId)}'s role: ${String(entry.role ?? "")}`;
    case "app-start":
      return `The Office started${entry.version ? ` (v${String(entry.version)})` : ""}`;
    default: {
      // Unknown kinds: their most telling field, not a JSON dump.
      const detail = [
        entry.subject,
        entry.name,
        entry.agentId,
        entry.message,
      ].find((v) => typeof v === "string" && v);
      return detail ? String(detail) : String(entry.kind ?? "event");
    }
  }
}

/** What's been happening on the floor, and the board Michael keeps. */
export function ActivitySection() {
  const { agents } = useOfficeAgents();
  const log = useQuery({
    queryKey: ["office", "hive-log", 60],
    queryFn: () => officeCth<LogEntry[]>("hiveLog", 60),
    refetchInterval: 3_000,
  });
  const board = useQuery({
    queryKey: ["office", "hive-board"],
    queryFn: () => officeCth<string>("hiveBoard"),
    refetchInterval: 5_000,
  });
  const entries = [...(log.data ?? [])].reverse();

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="section-activity">
      <SectionCard
        description="Spawns, messages between agents, escalations, approvals."
        title="Activity"
      >
        {entries.length === 0 ? (
          <Muted>{log.isLoading ? "Loading…" : "Nothing yet."}</Muted>
        ) : (
          <ul className="grid max-h-[32rem] gap-1 overflow-y-auto overflow-x-hidden">
            {entries.map((entry, index) => (
              <li
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/40"
                // biome-ignore lint/suspicious/noArrayIndexKey: a log without ids
                key={index}
              >
                <Badge className="mt-0.5 shrink-0" variant="secondary">
                  {entry.kind ?? "event"}
                </Badge>
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                  {describe(entry, agents)}
                </span>
                {entry.ts ? (
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    {relTime(Date.now() - entry.ts)}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
      <SectionCard
        description="Michael's running notes on where the floor stands."
        title="Board"
      >
        {board.data?.trim() ? (
          <div className="max-h-[32rem] overflow-y-auto text-sm">
            <Markdown className="leading-6" content={board.data} />
          </div>
        ) : (
          <Muted>{board.isLoading ? "Loading…" : "The board is empty."}</Muted>
        )}
      </SectionCard>
    </div>
  );
}
