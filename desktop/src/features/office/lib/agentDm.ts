import * as React from "react";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { isOfficeAgent } from "@/features/agents/lib/officePersonas";
import { useOpenDmMutation } from "@/features/channels/hooks";
import { useCommunities } from "@/features/communities/useCommunities";
import type { OfficeAgent } from "@/features/office/lib/officeLink";
import type { ManagedAgent } from "@/shared/api/types";

/**
 * An Office agent's Buzz identity in the active server: its managed record
 * names the Office agent it is (`officeAgentId`; Michael's has none) and the
 * server it belongs to.
 */
export function officeAgentPubkey(
  agent: Pick<OfficeAgent, "id" | "isGod">,
  records: readonly ManagedAgent[],
  community: string | undefined,
): string | null {
  const match = records.find((record) => {
    if (!isOfficeAgent(record) || record.backend.type !== "provider")
      return false;
    const config = record.backend.config as {
      officeAgentId?: string;
      officeCommunity?: string;
    };
    if (
      community &&
      config.officeCommunity &&
      config.officeCommunity !== community
    )
      return false;
    return agent.isGod
      ? !config.officeAgentId
      : config.officeAgentId === agent.id;
  });
  return match?.pubkey ?? null;
}

/** Chat with an Office agent: its DM in the Inbox, made if there isn't one. */
export function useOpenAgentDm(): {
  open: (agent: OfficeAgent) => Promise<void>;
  pending: boolean;
} {
  const records = useManagedAgentsQuery();
  const { activeCommunity } = useCommunities();
  const openDm = useOpenDmMutation();
  const { goChannel } = useAppNavigation();
  const open = React.useCallback(
    async (agent: OfficeAgent) => {
      const pubkey = officeAgentPubkey(
        agent,
        records.data ?? [],
        activeCommunity?.relayUrl,
      );
      if (!pubkey) {
        toast.error(`${agent.name} has no chat identity on this server yet.`);
        return;
      }
      try {
        const dm = await openDm.mutateAsync({ pubkeys: [pubkey] });
        await goChannel(dm.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error));
      }
    },
    [activeCommunity?.relayUrl, goChannel, openDm, records.data],
  );
  return { open, pending: openDm.isPending };
}
