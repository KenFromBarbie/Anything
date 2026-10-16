import type { OfficeAgent } from "@/features/office/lib/officeLink";

/**
 * Display names for the agent ids tasks carry. Tasks outlive agents (a retired
 * worker's tasks stay on the board), so an id that isn't on the floor is named
 * from the id itself: the Office's ids are the name plus a suffix ("pam-mt21tapc"),
 * and Michael's is "god".
 */
export function agentLabel(id: string, agents: OfficeAgent[]): string {
  const agent = agents.find((a) => a.id === id);
  if (agent) return agent.name;
  if (id === "god") {
    return agents.find((a) => a.isGod)?.name ?? "Michael";
  }
  const match = /^([a-z][a-z0-9]*)-[a-z0-9]{6,}$/i.exec(id);
  if (!match) return id;
  return match[1].charAt(0).toUpperCase() + match[1].slice(1);
}

/** The agent a name typed in Notion means: an agent on the floor first, then
 *  Michael by his default name. */
export function agentIdForName(
  name: string,
  agents: OfficeAgent[],
): string | undefined {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return undefined;
  const agent = agents.find((a) => a.name.toLowerCase() === wanted);
  if (agent) return agent.id;
  if (wanted === "michael") return "god";
  return undefined;
}
