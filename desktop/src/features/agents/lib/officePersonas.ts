// The Office's agents (Michael and his floor) are already running: in
// "Add agent" they are added to a channel as themselves, never re-created
// as new local agents from their persona.

import type { AgentPersona, ManagedAgent } from "@/shared/api/types";

/** A managed agent the Office runs (its identity, not a local process). */
export function isOfficeAgent(agent: Pick<ManagedAgent, "backend">): boolean {
  return agent.backend.type === "provider" && agent.backend.id === "office";
}

/** An Office agent's persona carries the agent's own pubkey as its id. */
export function officeAgentPubkeys(
  agents: readonly Pick<ManagedAgent, "backend" | "pubkey">[],
): Set<string> {
  return new Set(
    agents.filter(isOfficeAgent).map((agent) => agent.pubkey.toLowerCase()),
  );
}

const baseName = (name: string) =>
  name
    .replace(/\s*\(office\)\s*$/i, "")
    .trim()
    .toLowerCase();

/**
 * The personas to offer: an Office agent's own persona stays, but leftovers
 * of earlier Office identities (same name, or "Name (Office)", with another
 * id) are dropped. Picking one of those made a second, silent copy that
 * mentions then went to instead of the real agent.
 */
export function withoutStaleOfficePersonas<
  P extends Pick<AgentPersona, "id" | "displayName">,
>(
  personas: readonly P[],
  agents: readonly Pick<ManagedAgent, "backend" | "pubkey" | "name">[],
): P[] {
  const live = officeAgentPubkeys(agents);
  const liveNames = new Set(
    agents.filter(isOfficeAgent).map((agent) => baseName(agent.name)),
  );
  return personas.filter(
    (persona) =>
      live.has(persona.id.toLowerCase()) ||
      !liveNames.has(baseName(persona.displayName)),
  );
}
