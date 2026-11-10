import * as React from "react";

import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { useChannelsQuery, useOpenDmMutation } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
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
 * The DM with the CEO is always there: in each server whose Office has a CEO,
 * the DM is opened once (quietly, without switching to it) when it doesn't
 * exist yet. Mounted once, in the app shell.
 */
export function EnsureCeoDm() {
  const ceo = useCeoPubkey();
  const { activeCommunity } = useCommunities();
  const channels = useChannelsQuery();
  const openDm = useOpenDmMutation();
  const tried = React.useRef(new Set<string>());

  React.useEffect(() => {
    if (!ceo || !activeCommunity || !channels.isSuccess) return;
    const key = `${activeCommunity.relayUrl}|${ceo}`;
    if (tried.current.has(key)) return;
    const exists = (channels.data ?? []).some(
      (c) =>
        c.channelType === "dm" &&
        Array.isArray(c.participantPubkeys) &&
        c.participantPubkeys.includes(ceo),
    );
    tried.current.add(key);
    if (!exists) {
      openDm.mutate({ pubkeys: [ceo] });
    }
  }, [activeCommunity, ceo, channels.data, channels.isSuccess, openDm]);

  return null;
}
