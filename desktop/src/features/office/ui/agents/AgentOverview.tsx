import { MessageSquare, Settings2 } from "lucide-react";

import type { OfficeAgent } from "@/features/office/lib/officeLink";
import { SubsectionLabel } from "@/shared/ui/PageHeader";

import { AgentChat } from "./AgentChat";

function contextText(agent: OfficeAgent): string {
  if (agent.contextTokens == null) return "—";
  const used = `${Math.round(agent.contextTokens / 1000)}k`;
  if (!agent.contextLimit) return used;
  const pct = Math.round((agent.contextTokens / agent.contextLimit) * 100);
  return `${used} of ${Math.round(agent.contextLimit / 1000)}k (${pct}%)`;
}

/**
 * A floor agent at a glance: a chat with them, and how they're set up. Their
 * controls (pause, stop, 1:1, edit, restart, archive) sit in the header above;
 * the terminal and the Office's other panels are tabs, opened when wanted.
 */
export function AgentOverview({ agent }: { agent: OfficeAgent }) {
  const rows: [string, string][] = [
    ["Status", agent.action || agent.status],
    ["Runs on", [agent.provider, agent.model].filter(Boolean).join(" · ")],
    ["Project", agent.project || "—"],
    ["Workspace", agent.cwd || "—"],
    ["Context", contextText(agent)],
    [
      "Queued",
      agent.queue.length ? `${agent.queue.length} message(s)` : "none",
    ],
    ["Michael", agent.onHold ? "on hold (1:1 with you)" : "can hand them work"],
  ];
  return (
    <div
      className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
      data-testid="agent-overview"
    >
      <section className="grid content-start gap-2">
        <SubsectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" />
            Chat
          </span>
        </SubsectionLabel>
        <AgentChat agent={agent} />
      </section>
      <section className="grid content-start gap-2">
        <SubsectionLabel>
          <span className="inline-flex items-center gap-1.5">
            <Settings2 className="h-3.5 w-3.5" />
            Setup
          </span>
        </SubsectionLabel>
        <dl className="grid gap-1.5 rounded-xl border border-border/70 p-3 text-sm">
          {rows.map(([label, value]) => (
            <div
              className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2"
              key={label}
            >
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="truncate" title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>
        {agent.description ? (
          <p className="text-xs text-muted-foreground">{agent.description}</p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Pause, stop, take aside for a 1:1, edit or restart from the buttons
          above. The terminal is under its own tab.
        </p>
      </section>
    </div>
  );
}
