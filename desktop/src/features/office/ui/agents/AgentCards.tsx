import { Plus } from "lucide-react";

import { engineLabel } from "@/features/office/lib/agentStatus";
import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { cn } from "@/shared/lib/cn";
import { Badge } from "@/shared/ui/badge";

import { AgentAvatar, AgentStatusPill, ContextMeter } from "./AgentBits";

/** The floor's agents as cards: Michael first, then his workers. */
export function AgentCards({
  agents,
  selectedId,
  onSelect,
  onAdd,
}: {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const ordered = [...agents].sort((a, b) => Number(b.isGod) - Number(a.isGod));
  return (
    <div
      className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3"
      data-testid="agents-cards"
    >
      {ordered.map((agent) => {
        const selected = agent.id === selectedId;
        return (
          <button
            aria-pressed={selected}
            className={cn(
              "flex min-w-0 items-start gap-3 rounded-2xl border bg-card/80 p-3 text-left shadow-xs transition-colors hover:bg-muted/40",
              selected
                ? "border-primary/50 ring-1 ring-primary/25"
                : "border-border/70",
            )}
            data-testid={`agents-card-${agent.id}`}
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            type="button"
          >
            <AgentAvatar agent={agent} />
            <div className="grid min-w-0 flex-1 gap-1">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate font-medium">{agent.name}</span>
                {agent.isGod ? <Badge variant="outline">Lead</Badge> : null}
                {agent.onHold ? <Badge variant="warning">1:1</Badge> : null}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {agent.isGod
                  ? "Runs the floor"
                  : engineLabel(agent.provider, agent.model)}
              </p>
              <div className="mt-1 flex min-w-0 items-center gap-2">
                <AgentStatusPill status={agent.status} />
                <span className="truncate text-xs text-muted-foreground">
                  {agent.action}
                </span>
              </div>
              <ContextMeter agent={agent} />
            </div>
          </button>
        );
      })}
      <button
        className="flex min-h-24 items-center justify-center gap-2 rounded-2xl border border-dashed border-border/70 p-3 text-sm text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
        data-testid="agents-card-add"
        onClick={onAdd}
        type="button"
      >
        <Plus className="h-4 w-4" />
        Add agent
      </button>
    </div>
  );
}
