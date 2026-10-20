import { invoke } from "@tauri-apps/api/core";

import type { ManagedAgentBackend } from "@/shared/api/types";

/** The meeting room: each server's channel for meetings with its Office
 *  agents. A meeting is a call on it (the call channel's name ends in
 *  " call", which is how the Office reads its replies aloud). */
export const MEETING_CHANNEL_NAME = "meeting-room";
export const MEETING_CALL_NAME = "Meeting room call";

export const isMeetingCallName = (name: string | null | undefined) =>
  (name ?? "").trim().toLowerCase() === MEETING_CALL_NAME.toLowerCase();

export type OfficeAgentSummary = {
  pubkey: string;
  name: string;
  status: string;
  avatar_url: string | null;
  backend: ManagedAgentBackend;
};

export const isOfficeAgent = (agent: OfficeAgentSummary) =>
  agent.backend.type === "provider" && agent.backend.id === "office";

/** The Office agents on the floor now (only they can join a meeting). */
export async function listOfficeAgentsOnFloor(): Promise<OfficeAgentSummary[]> {
  const agents = await invoke<OfficeAgentSummary[]>("list_managed_agents");
  return agents.filter((a) => isOfficeAgent(a) && a.status === "deployed");
}

/** Calls started as meetings in this session (their channel may not be
 *  listed yet when the floor needs to know). */
let meetingPending = false;
const meetingCalls = new Set<string>();
export const markMeetingStarting = () => {
  meetingPending = true;
};
/** Whether this active call is a meeting: a call that came up right after a
 *  meeting was started, or one on the meeting room's call channel. */
export function isMeetingCall(
  ephemeralChannelId: string | null,
  channelName: string | null | undefined,
): boolean {
  if (!ephemeralChannelId) {
    return false;
  }
  if (meetingPending) {
    meetingPending = false;
    meetingCalls.add(ephemeralChannelId);
  }
  return meetingCalls.has(ephemeralChannelId) || isMeetingCallName(channelName);
}

/** Opens the meeting dialog from anywhere (the Office page's button, a click
 *  on the conference table). */
const OPEN_EVENT = "anything:open-meeting";
export const openMeetingDialog = () =>
  window.dispatchEvent(new CustomEvent(OPEN_EVENT));
export function onOpenMeetingDialog(handler: () => void): () => void {
  window.addEventListener(OPEN_EVENT, handler);
  return () => window.removeEventListener(OPEN_EVENT, handler);
}
