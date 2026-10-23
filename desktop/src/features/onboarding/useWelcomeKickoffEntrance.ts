import * as React from "react";

import type { Channel, RelayEvent } from "@/shared/api/types";

/**
 * Tracks the one-shot entrance animation for a newly posted Welcome opener.
 * The starter-team kickoff that used to post one is gone (no bee team), so
 * this only clears with the channel.
 *
 * The opener lands in the main timeline with a one-shot entrance; the user
 * opens the thread themselves. Auto-opening it caused a cascade of loading
 * states (thread skeleton, "No replies" flash) on first run.
 */
export function useWelcomeKickoffEntrance(
  activeChannel: Channel | null,
  resolvedMessages: readonly RelayEvent[],
  threadReplyEvents: readonly RelayEvent[],
) {
  void resolvedMessages;
  void threadReplyEvents;
  const [entranceMessageId, setEntranceMessageId] = React.useState<
    string | null
  >(null);
  React.useEffect(() => {
    void activeChannel?.id;
    setEntranceMessageId(null);
  }, [activeChannel?.id]);
  const handleEntranceComplete = React.useCallback((eventId: string) => {
    setEntranceMessageId((current) => (current === eventId ? null : current));
  }, []);

  return { entranceMessageId, handleEntranceComplete };
}
