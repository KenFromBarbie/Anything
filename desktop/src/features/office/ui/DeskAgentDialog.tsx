import * as React from "react";

import { AgentFormDialog } from "./agents/AgentFormDialog";

/** A desk's computer was clicked on the Office floor: its agent's id, or
 *  null for a free desk. */
const DESK_EVENT = "anything:office-desk";

export function openDeskAgent(agentId: string | null) {
  window.dispatchEvent(
    new CustomEvent<{ agentId: string | null }>(DESK_EVENT, {
      detail: { agentId },
    }),
  );
}

/**
 * Manage the Office from its desks: clicking a computer opens that desk's
 * agent to edit (name, role, model, instructions), or, at a free desk, the
 * form to hire an agent onto the floor. The same forms as the Agents page.
 */
export function DeskAgentDialog() {
  const [target, setTarget] = React.useState<{
    agentId: string | null;
  } | null>(null);

  React.useEffect(() => {
    const onDesk = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId: string | null }>)
        .detail;
      setTarget({ agentId: detail?.agentId ?? null });
    };
    window.addEventListener(DESK_EVENT, onDesk);
    return () => window.removeEventListener(DESK_EVENT, onDesk);
  }, []);

  if (!target) return null;
  return (
    <AgentFormDialog
      agentId={target.agentId ?? undefined}
      key={target.agentId ?? "new"}
      mode={target.agentId ? "edit" : "add"}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
      open
    />
  );
}
