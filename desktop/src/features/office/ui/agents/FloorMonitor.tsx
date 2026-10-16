import { engineLabel } from "@/features/office/lib/agentStatus";
import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
import { SectionHeader } from "@/shared/ui/PageHeader";

import { AgentAvatar, AgentStatusPill, ContextMeter } from "./AgentBits";

/** Every agent on the floor at a glance, under Michael's terminal. */
export function FloorMonitor({
  agents,
  selectedId,
  onSelect,
}: {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const ordered = [...agents].sort((a, b) => Number(b.isGod) - Number(a.isGod));
  return (
    <section
      className="grid gap-3 rounded-2xl border border-border/70 bg-card/80 p-4 shadow-xs"
      data-testid="agents-monitor"
    >
      <SectionHeader
        description="Every agent on the floor, live."
        title="Monitor"
      />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="pb-2 pr-3 font-medium">Agent</th>
              <th className="pb-2 pr-3 font-medium">Status</th>
              <th className="pb-2 pr-3 font-medium">Doing</th>
              <th className="pb-2 pr-3 text-right font-medium">Queued</th>
              <th className="pb-2 pr-3 text-right font-medium">Tool calls</th>
              <th className="w-40 pb-2 font-medium">Context</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((agent) => (
              <tr
                className={cn(
                  "border-t border-border/60",
                  agent.id === selectedId && "bg-muted/40",
                )}
                key={agent.id}
              >
                <td className="py-2 pr-3">
                  <button
                    className="flex min-w-0 items-center gap-2 text-left hover:underline"
                    onClick={() => onSelect(agent.id)}
                    type="button"
                  >
                    <AgentAvatar agent={agent} size="sm" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {agent.name}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {engineLabel(agent.provider, agent.model)}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="py-2 pr-3">
                  <AgentStatusPill status={agent.status} />
                </td>
                <td className="max-w-64 truncate py-2 pr-3 text-muted-foreground">
                  {agent.action || "—"}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {agent.queue.length}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {agent.toolCalls}
                </td>
                <td className="py-2">
                  <ContextMeter agent={agent} showLabel />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
