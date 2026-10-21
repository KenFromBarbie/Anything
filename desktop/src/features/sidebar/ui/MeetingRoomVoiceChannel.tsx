import { Volume2 } from "lucide-react";

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
 * The Office's meeting room as a voice channel, under Channels: click it to
 * call a meeting (or, during one, to open it). Who's in the meeting is listed
 * beneath it, as in a voice channel.
 */
export function MeetingRoomVoiceChannel() {
  const { active, names } = useMeetingState();
  const { activeEphemeralChannelId, viewHuddleChannel } = useHuddle();

  return (
    <SidebarMenu
      className="px-2 pb-1 group-data-[collapsible=icon]:hidden"
      data-testid="meeting-room-voice-channel"
    >
      <SidebarMenuItem>
        <SidebarMenuButton
          onClick={() => {
            if (active && activeEphemeralChannelId) {
              viewHuddleChannel(activeEphemeralChannelId);
            } else {
              openMeetingDialog();
            }
          }}
          tooltip={active ? "Open the meeting" : "Call a meeting"}
          type="button"
        >
          <Volume2
            className={cn(
              "h-4 w-4 shrink-0",
              active ? "text-primary" : "text-sidebar-foreground/60",
            )}
          />
          <SidebarMenuLabel>Meeting room</SidebarMenuLabel>
          {active ? (
            <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
          ) : null}
        </SidebarMenuButton>
        {active && names.length > 0 ? (
          <ul className="ml-7 mt-0.5 grid gap-0.5 pb-1">
            {names.map((name) => (
              <li
                className="flex items-center gap-1.5 truncate text-xs text-sidebar-foreground/70"
                key={name}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500/80" />
                {name}
              </li>
            ))}
          </ul>
        ) : null}
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
