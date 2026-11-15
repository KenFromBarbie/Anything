import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import { useOfficeAgents } from "@/features/office/lib/officeLink";
import { officeAgentPubkey } from "@/features/office/lib/agentDm";

/** The CEO's chat identity in the active server, or null. */
export function useCeoPubkey(): string | null {
  const records = useManagedAgentsQuery();
  const { activeCommunity } = useCommunities();
  return officeAgentPubkey(
    { id: "god", isGod: true },
    records.data ?? [],
    activeCommunity?.relayUrl,
  );
}

/**
 * The Office's standing agents in the active server (the CEO and the
 * executives, not the floor workers they hire for a job): their chat ids.
 */
export function useStandingAgentPubkeys(): string[] {
  const records = useManagedAgentsQuery();
  const { activeCommunity } = useCommunities();
  const { agents, restorable } = useOfficeAgents();
  const community = activeCommunity?.relayUrl;
  return React.useMemo(() => {
    const out = new Set<string>();
    // On the floor, or waiting to be brought back after a restart.
    const ids = [
      ...agents.map((a) => ({ id: a.id, isGod: a.isGod })),
      ...restorable.map((a) => ({ id: a.id, isGod: a.id === "god" })),
    ];
    for (const agent of ids) {
      if (agent.id.startsWith("worker-")) continue;
      const pubkey = officeAgentPubkey(agent, records.data ?? [], community);
      if (pubkey) out.add(pubkey);
    }
    return [...out];
  }, [agents, community, records.data, restorable]);
}

/**
 * A DM with each standing agent is always there, so every conversation is in
 * the Inbox from the start: in each server, a missing one is opened once
 * (quietly, without switching to it). Mounted once, in the app shell.
 */
export function EnsureCeoDm() {
  const agents = useStandingAgentPubkeys();
  const { activeCommunity } = useCommunities();
  const channels = useChannelsQuery();
  const openDm = useOpenDmMutation();
  const tried = React.useRef(new Set<string>());

  React.useEffect(() => {
    if (!activeCommunity || !channels.isSuccess) return;
    for (const pubkey of agents) {
      const key = `${activeCommunity.relayUrl}|${pubkey}`;
      if (tried.current.has(key)) continue;
      tried.current.add(key);
      const exists = (channels.data ?? []).some(
        (c) =>
          c.channelType === "dm" &&
          Array.isArray(c.participantPubkeys) &&
          c.participantPubkeys.length <= 2 &&
          c.participantPubkeys.includes(pubkey),
      );
      if (!exists) openDm.mutate({ pubkeys: [pubkey] });
    }
  }, [activeCommunity, agents, channels.data, channels.isSuccess, openDm]);

  return null;
}
