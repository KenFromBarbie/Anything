import * as React from "react";
import { ChevronDown, ChevronRight, SquarePen } from "lucide-react";

import { useAppShell } from "@/app/AppShellContext";
import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useChannelsQuery } from "@/features/channels/hooks";
import { useManagedAgentsQuery } from "@/features/agents/hooks";
import { officeAgentPubkeys } from "@/features/agents/lib/officePersonas";
import {
  useCeoPubkey,
  useStandingAgentPubkeys,
} from "@/features/office/ui/EnsureCeoDm";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { sortDmChannelsForSidebar } from "@/features/sidebar/lib/dmSidebarSort";
import { useDmSidebarMetadata } from "@/features/sidebar/useDmSidebarMetadata";
import { useIdentityQuery } from "@/shared/api/hooks";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { useProtectedVisibleDirectMessages } from "@protected-feature-components";

const COLLAPSED_KEY = "anything.inbox-dms-collapsed";

/** A DM's latest message, for its row. */
export type DmPreview = { at: number; text: string; time: string };

/** The DMs the Direct messages section lists (hidden ones aren't). */
export function useListedDmIds(): Set<string> {
  const { data: channels = [] } = useChannelsQuery();
  const { data: identity } = useIdentityQuery();
  const allDms = React.useMemo(
    () =>
      channels
        .filter((c) => c.channelType === "dm" && !c.archivedAt)
        .map((c) => ({
          ...c,
          name: typeof c.name === "string" ? c.name : "",
          participantPubkeys: Array.isArray(c.participantPubkeys)
            ? c.participantPubkeys
            : [],
        })),
    [channels],
  );
  const listed = useProtectedVisibleDirectMessages(allDms, identity?.pubkey);
  return React.useMemo(() => new Set(listed.map((c) => c.id)), [listed]);
}

/**
 * Direct messages, at the top of the Inbox (they're not in the sidebar): every
 * conversation, unread first in recent order, and a new message.
 */
export function InboxDirectMessages({
  previews,
}: {
  previews?: ReadonlyMap<string, DmPreview>;
}) {
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
  const visible = useProtectedVisibleDirectMessages(allDms, identity?.pubkey);
  // Agents of other servers (and finished floor workers) share names with this
  // server's: their DMs show only once something was said in them.
  const records = useManagedAgentsQuery();
  const standing = useStandingAgentPubkeys();
  const dms = React.useMemo(() => {
    const office = officeAgentPubkeys(records.data ?? []);
    const here = new Set(standing.map((p) => p.toLowerCase()));
    const me = identity?.pubkey?.toLowerCase();
    return visible.filter((c) => {
      const others = c.participantPubkeys
        .map((p) => p.toLowerCase())
        .filter((p) => p !== me);
      const agentOnly = others.length > 0 && others.every((p) => office.has(p));
      if (!agentOnly) return true;
      return others.some((p) => here.has(p)) || !!c.lastMessageAt;
    });
  }, [identity?.pubkey, records.data, standing, visible]);
  const { dmChannelLabels, dmParticipantsByChannelId } = useDmSidebarMetadata({
    currentPubkey: identity?.pubkey,
    directMessages: dms,
  });
  const ceo = useCeoPubkey();
  // The CEO's DM first (it's always there: see EnsureCeoDm), then the rest.
  const sorted = React.useMemo(() => {
    const byRecent = sortDmChannelsForSidebar(dms, dmChannelLabels, "recent");
    if (!ceo) return byRecent;
    const isCeo = (c: (typeof byRecent)[number]) =>
      c.participantPubkeys.length <= 2 && c.participantPubkeys.includes(ceo);
    return [...byRecent.filter(isCeo), ...byRecent.filter((c) => !isCeo(c))];
  }, [ceo, dms, dmChannelLabels]);

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
            const preview = previews?.get(channel.id);
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
                  <span className="grid min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span
                        className={cn(
                          "min-w-0 flex-1 truncate",
                          unread && "font-semibold",
                        )}
                      >
                        {label}
                      </span>
                      {preview ? (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {preview.time}
                        </span>
                      ) : null}
                    </span>
                    {preview ? (
                      <span
                        className={cn(
                          "truncate text-xs",
                          unread ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {preview.text}
                      </span>
                    ) : null}
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
