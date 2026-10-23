import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { PhoneOff, Volume2, X } from "lucide-react";

import { useHuddle } from "@/features/huddle/HuddleContext";
import {
  openMeetingDialog,
  useMeetingState,
} from "@/features/office/lib/meetingRoom";
import { cn } from "@/shared/lib/cn";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

/**
 * The Office's meeting room as a voice channel, under Channels, like a voice
 * channel in a chat app: click it to call a meeting (or, during one, to open
 * it); who's in it is listed beneath, you first. During a meeting you can
 * leave it here, and remove an agent from it.
 */
export function MeetingRoomVoiceChannel() {
  const { active, people } = useMeetingState();
  const { activeEphemeralChannelId, leaveHuddle, showHuddleInMainApp } =
    useHuddle();
  const [removing, setRemoving] = React.useState<string | null>(null);
  const inMeeting = active && !!activeEphemeralChannelId;

  async function remove(pubkey: string) {
    if (removing) return;
    setRemoving(pubkey);
    try {
      await invoke("remove_agent_from_huddle", { agentPubkey: pubkey });
    } catch (error) {
      console.error("Failed to remove the agent from the meeting:", error);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <SidebarMenu
      className="px-2 pb-1 group-data-[collapsible=icon]:hidden"
      data-testid="meeting-room-voice-channel"
    >
      <SidebarMenuItem className="group/meeting">
        <SidebarMenuButton
          onClick={() => {
            if (inMeeting && activeEphemeralChannelId) {
              showHuddleInMainApp(activeEphemeralChannelId);
            } else {
              openMeetingDialog();
            }
          }}
          tooltip={inMeeting ? "Open the meeting" : "Join the meeting room"}
          type="button"
        >
          <Volume2
            className={cn(
              "h-4 w-4 shrink-0",
              inMeeting ? "text-primary" : "text-sidebar-foreground/60",
            )}
          />
          <SidebarMenuLabel>Meeting room</SidebarMenuLabel>
        </SidebarMenuButton>
        {inMeeting ? (
          <button
            aria-label="Leave the meeting"
            className="absolute right-1 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-destructive hover:bg-destructive/15"
            onClick={() => void leaveHuddle()}
            title="Leave the meeting"
            type="button"
          >
            <PhoneOff className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </SidebarMenuItem>
      {inMeeting ? (
        <ul
          className="ml-7 grid gap-0.5 pb-1"
          data-testid="meeting-room-people"
        >
          <li className="flex h-6 items-center gap-1.5 text-xs text-sidebar-foreground">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span className="truncate font-medium">You</span>
          </li>
          {people.map((person) => (
            <li
              className="group/person flex h-6 items-center gap-1.5 text-xs text-sidebar-foreground/75"
              key={person.pubkey}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/80" />
              <span className="min-w-0 flex-1 truncate">{person.name}</span>
              <button
                aria-label={`Remove ${person.name} from the meeting`}
                className="mr-1 flex h-5 w-5 items-center justify-center rounded text-sidebar-foreground/50 opacity-0 hover:bg-sidebar-foreground/10 hover:text-sidebar-foreground focus-visible:opacity-100 group-hover/person:opacity-100 disabled:opacity-40"
                disabled={removing === person.pubkey}
                onClick={() => void remove(person.pubkey)}
                title={`Remove ${person.name} from the meeting`}
                type="button"
              >
                <X className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </SidebarMenu>
  );
}
