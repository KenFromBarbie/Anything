import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, LoaderCircle, Users } from "lucide-react";

import {
  useChannelsQuery,
  useCreateChannelMutation,
} from "@/features/channels/hooks";
import { useHuddle } from "@/features/huddle/HuddleContext";
import { callOffice } from "@/features/office/lib/officeLink";
import {
  MEETING_CALL_NAME,
  MEETING_CHANNEL_NAME,
  isMeetingCall,
  markMeetingStarting,
  listOfficeAgentsOnFloor,
  onOpenMeetingDialog,
  setMeetingState,
  type OfficeAgentSummary,
} from "@/features/office/lib/meetingRoom";
import { ProfileAvatar } from "@/features/profile/ui/ProfileAvatar";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { ChooserDialogContent } from "@/shared/ui/chooser-dialog-content";
import { Dialog } from "@/shared/ui/dialog";

/**
 * The Office's meeting room: pick who to meet with and start a call on the
 * server's meeting-room channel. Speech goes to the attendees; whoever is
 * named answers aloud (no name: the chair, Michael). More can be called in
 * during the meeting with the call's "Add agent".
 */
export function MeetingDialog() {
  const [open, setOpen] = React.useState(false);
  const [agents, setAgents] = React.useState<OfficeAgentSummary[] | null>(
    null,
  );
  const [picked, setPicked] = React.useState<Set<string>>(new Set());
  const [starting, setStarting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const { data: channels = [] } = useChannelsQuery();
  const createChannel = useCreateChannelMutation();
  const { startHuddle, activeEphemeralChannelId } = useHuddle();

  React.useEffect(() => onOpenMeetingDialog(() => setOpen(true)), []);

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAgents(null);
    setError(null);
    listOfficeAgentsOnFloor().then(
      (list) => {
        if (cancelled) return;
        setAgents(list);
        // Everyone by default; untick who isn't needed.
        setPicked(new Set(list.map((a) => a.pubkey)));
      },
      (e: unknown) => {
        if (!cancelled) setError(String(e));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  const toggle = (pubkey: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });

  async function start() {
    if (starting || picked.size === 0) return;
    setStarting(true);
    setError(null);
    try {
      const room =
        channels.find(
          (c) =>
            c.channelType === "stream" &&
            c.name === MEETING_CHANNEL_NAME &&
            !c.archivedAt,
        ) ??
        (await createChannel.mutateAsync({
          name: MEETING_CHANNEL_NAME,
          channelType: "stream",
          visibility: "private",
          description: "Meetings with the Office's agents.",
        }));
      markMeetingStarting();
      await startHuddle(room.id, [...picked], MEETING_CALL_NAME);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  const inCall = !!activeEphemeralChannelId;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <ChooserDialogContent
        className="max-w-md"
        data-testid="meeting-dialog"
        footer={
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {inCall
                ? "Leave your current call first."
                : "Say a name to ask someone; with no name, Michael answers."}
            </p>
            <Button
              disabled={starting || picked.size === 0 || inCall}
              onClick={() => void start()}
              size="sm"
            >
              {starting ? <LoaderCircle className="animate-spin" /> : <Users />}
              Start meeting
            </Button>
          </div>
        }
        headerSubtitle="Who's in the meeting? They gather at the conference table."
        title="Meeting room"
      >
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {agents === null ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Loading the floor…
          </p>
        ) : agents.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No agents are on the floor right now.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {agents.map((agent) => {
              const on = picked.has(agent.pubkey);
              return (
                <li key={agent.pubkey}>
                  <button
                    aria-pressed={on}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground"
                    onClick={() => toggle(agent.pubkey)}
                    type="button"
                  >
                    <ProfileAvatar
                      avatarUrl={agent.avatar_url}
                      className="h-9 w-9 shrink-0 text-xs"
                      label={agent.name}
                      shape="squircle"
                    />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {agent.name}
                    </span>
                    <span
                      className={cn(
                        "flex h-5 w-5 items-center justify-center rounded-md border",
                        on
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border",
                      )}
                    >
                      {on ? <Check className="h-3.5 w-3.5" /> : null}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </ChooserDialogContent>
    </Dialog>
  );
}

/**
 * Keeps the Office floor in step with the meeting: while a meeting room call
 * is on, its agents sit at the conference table; when it ends (or someone
 * leaves) they go back to their desks.
 */
export function MeetingFloorSync() {
  const { activeEphemeralChannelId } = useHuddle();
  const { data: channels = [] } = useChannelsQuery();
  const callName = channels.find(
    (c) => c.id === activeEphemeralChannelId,
  )?.name;
  const meeting = isMeetingCall(activeEphemeralChannelId, callName);
  const lastSent = React.useRef<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const send = (names: string[]) => {
      const key = names.slice().sort().join("|");
      if (key === lastSent.current) return;
      lastSent.current = key;
      void callOffice("floor.meeting", { names }).catch(() => {
        lastSent.current = null; // the Office isn't up yet: try again
      });
    };
    if (!meeting) {
      setMeetingState({ active: false, names: [] });
      if (lastSent.current) send([]);
      return;
    }
    setMeetingState({ active: true, names: [] });
    const tick = async () => {
      try {
        const [pubkeys, agents] = await Promise.all([
          invoke<string[]>("get_huddle_agent_pubkeys"),
          listOfficeAgentsOnFloor(),
        ]);
        if (cancelled) return;
        const inCall = new Set(pubkeys.map((p) => p.toLowerCase()));
        const names = agents
          .filter((a) => inCall.has(a.pubkey.toLowerCase()))
          .map((a) => a.name);
        setMeetingState({ active: true, names });
        send(names);
      } catch {
        // Next tick.
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [meeting]);

  return null;
}
