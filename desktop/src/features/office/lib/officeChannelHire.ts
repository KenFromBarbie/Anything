import { isOfficeWorker } from "@/features/agents/lib/managedAgentControlActions";
import { openAddAgent } from "@/features/office/lib/officeLink";
import { addChannelMembers, listManagedAgents } from "@/shared/api/tauri";

const POLL_MS = 3000;
const GIVE_UP_MS = 15 * 60 * 1000;

let pending: { channelId: string; known: Set<string>; until: number } | null =
  null;
let timer: ReturnType<typeof setTimeout> | null = null;

async function officeWorkerPubkeys(): Promise<Set<string>> {
  const agents = await listManagedAgents();
  return new Set(agents.filter(isOfficeWorker).map((agent) => agent.pubkey));
}

async function checkForNewAgent(): Promise<void> {
  timer = null;
  const current = pending;
  if (!current) return;
  if (Date.now() > current.until) {
    pending = null;
    return;
  }
  try {
    const added = [...(await officeWorkerPubkeys())].filter(
      (pubkey) => !current.known.has(pubkey),
    );
    if (added.length > 0 && pending === current) {
      pending = null;
      await addChannelMembers({ channelId: current.channelId, pubkeys: added });
      return;
    }
  } catch (error) {
    console.warn("office: could not add the new agent to its channel", error);
  }
  if (pending === current) timer = setTimeout(checkForNewAgent, POLL_MS);
}

/**
 * "New Office agent" from a channel: open the Add agent dialog on the Agents
 * page, and when the agent hired there gets its Buzz identity (Buzz
 * creates one for every agent on the floor), add it to the channel. Nothing is
 * hired until the form is confirmed; a newer request replaces an older one.
 */
export async function startNewAgentForChannel(
  channelId: string,
): Promise<void> {
  pending = {
    channelId,
    known: await officeWorkerPubkeys(),
    until: Date.now() + GIVE_UP_MS,
  };
  if (timer) clearTimeout(timer);
  timer = setTimeout(checkForNewAgent, POLL_MS);
  window.location.hash = "#/agents";
  openAddAgent();
}
