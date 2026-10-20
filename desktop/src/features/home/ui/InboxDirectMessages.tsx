import * as React from "react";
import { ChevronDown, ChevronRight, SquarePen } from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { sortDmChannelsForSidebar } from "@/features/sidebar/lib/dmSidebarSort";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { useIdentityQuery } from "@/shared/api/hooks";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useProtectedVisibleDirectMessages } from "@protected-feature-components";

const COLLAPSED_KEY = "anything.inbox-dms-collapsed";

/**
 * Direct messages, at the top of the Inbox (they're not in the sidebar): every
 * conversation, unread first in recent order, and a new message.
 */
export function InboxDirectMessages() {
  const { data: channels = [] } = useChannelsQuery();
  const { data: identity } = useIdentityQuery();
  const { topLevelUnreadChannelIds } = useAppShell();
  const { goChannel, goNewMessage } = useAppNavigation();
  const [collapsed, setCollapsed] = React.useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const allDms = React.useMemo(
    () =>
      channels
        .filter((c) => c.channelType === "dm" && !c.archivedAt)
        // Tolerate partly-known channels (no participants or name yet).
        .map((c) => ({
          ...c,
          name: typeof c.name === "string" ? c.name : "",
          participantPubkeys: Array.isArray(c.participantPubkeys)
            ? c.participantPubkeys
            : [],
        })),
    [channels],
  );
  const dms = useProtectedVisibleDirectMessages(allDms, identity?.pubkey);
  const { dmChannelLabels, dmParticipantsByChannelId } = useDmSidebarMetadata({
    currentPubkey: identity?.pubkey,
    directMessages: dms,
  });
  const sorted = React.useMemo(
    () => sortDmChannelsForSidebar(dms, dmChannelLabels, "recent"),
    [dms, dmChannelLabels],
  );

  const toggle = () =>
    setCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        // Not remembered without storage.
      }
      return next;
    });

  return (
    <section
      className="grid gap-1.5 border-b border-border/60 px-4 pb-3 pt-2"
      data-testid="inbox-direct-messages"
    >
      <div className="flex items-center justify-between">
        <button
          className="flex items-center gap-1.5 text-left text-sm font-semibold"
          onClick={toggle}
          type="button"
        >
          {collapsed ? (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
          Direct messages
          {sorted.some((c) => topLevelUnreadChannelIds.has(c.id)) ? (
            <span className="h-2 w-2 rounded-full bg-primary" />
          ) : null}
        </button>
        <Button
          aria-label="New message"
          onClick={() => void goNewMessage()}
          size="icon-xs"
          title="New message"
          variant="ghost"
        >
          <SquarePen />
        </Button>
      </div>
      {collapsed ? null : sorted.length === 0 ? (
        <p className="px-1 text-xs text-muted-foreground">
          No conversations yet.
        </p>
      ) : (
        <ul className="grid gap-0.5">
          {sorted.map((channel) => {
            const unread = topLevelUnreadChannelIds.has(channel.id);
            const label = dmChannelLabels[channel.id] ?? channel.name;
            const person = dmParticipantsByChannelId[channel.id]?.[0];
            return (
              <li key={channel.id}>
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60"
                  onClick={() => void goChannel(channel.id)}
                  type="button"
                >
                  <ProfileAvatar
                    avatarUrl={person?.avatarUrl ?? null}
                    className="h-6 w-6 shrink-0 text-[10px]"
                    label={label}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate",
                      unread && "font-semibold",
                    )}
                  >
                    {label}
                  </span>
                  {unread ? (
                    <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
