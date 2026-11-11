// Screen sharing in a call (the meeting room): the owner picks a screen or
// window; it's shown in the call, and a snapshot is saved to the Office's
// shared folder whenever the picture changes (at most every couple of
// seconds) so agents in the meeting can look at what's being shown.
//
// Everyone in a meeting is on this computer (the owner and the Office's
// agents), so nothing is streamed over the network: agents read the latest
// frame from disk when the owner refers to the screen.

import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";

import { sendChannelMessage } from "@/shared/api/tauriMessages";

export type ScreenShareState = {
  stream: MediaStream | null;
  /** The call channel it was announced in. */
  channelId: string | null;
  /** Where agents read the latest frame. */
  framePath: string | null;
  startedAt: number | null;
  frames: number;
  error: string | null;
};

let state: ScreenShareState = { stream: null, channelId: null, framePath: null, startedAt: null, frames: 0, error: null };
const listeners = new Set<() => void>();
const set = (patch: Partial<ScreenShareState>) => {
  state = { ...state, ...patch };
  for (const l of listeners) l();
};

export function useScreenShare(): ScreenShareState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const EVERY_MS = 2000;
const MAX_SIDE = 1600;
let timer: number | null = null;
let video: HTMLVideoElement | null = null;
let lastSig: Uint8Array | null = null;
let busy = false;

/** A tiny grey thumbnail: frames are only saved when it changes. */
function signature(src: CanvasImageSource, w: number, h: number): Uint8Array {
  const c = document.createElement("canvas");
  c.width = 48;
  c.height = Math.max(1, Math.round((48 * h) / w));
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return new Uint8Array();
  g.drawImage(src, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const out = new Uint8Array(d.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return out;
}

/** Share of thumbnail pixels that changed noticeably. */
export function changed(a: Uint8Array | null, b: Uint8Array): number {
  if (!a || a.length !== b.length) return 1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 12) n++;
  return n / Math.max(1, a.length);
}

async function capture(force = false) {
  if (busy || !video || video.readyState < 2) return;
  const w = video.videoWidth;
  const h = video.videoHeight;
  if (!w || !h) return;
  busy = true;
  try {
    const sig = signature(video, w, h);
    if (!force && changed(lastSig, sig) < 0.004) return;
    lastSig = sig;
    const k = Math.min(1, MAX_SIDE / Math.max(w, h));
    const c = document.createElement("canvas");
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    c.getContext("2d")?.drawImage(video, 0, 0, c.width, c.height);
    const jpeg = c.toDataURL("image/jpeg", 0.8).split(",")[1] ?? "";
    const path = await invoke<string>("office_screen_frame", { jpegBase64: jpeg });
    set({ framePath: path, frames: state.frames + 1 });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  } finally {
    busy = false;
  }
}

async function announce(channelId: string, text: string) {
  try {
    await sendChannelMessage(channelId, text);
  } catch {
    // The call may have ended; sharing still works for the owner.
  }
}

/** Ask for a screen or window and start sharing it into this call. */
export async function startScreenShare(channelId: string | null): Promise<void> {
  if (state.stream) return;
  set({ error: null });
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Cancelling the picker isn't an error worth showing.
    if (!/denied|abort|cancel/i.test(msg)) set({ error: msg });
    return;
  }
  video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => undefined);
  lastSig = null;
  set({ stream, channelId, startedAt: Date.now(), frames: 0, framePath: null });
  for (const t of stream.getVideoTracks()) t.addEventListener("ended", () => void stopScreenShare());
  // First frame right away, then whenever the picture changes.
  await new Promise((r) => setTimeout(r, 400));
  await capture(true);
  timer = window.setInterval(() => void capture(), EVERY_MS);
  if (channelId && state.framePath) {
    await announce(
      channelId,
      `[screen share] I'm sharing my screen. What I'm showing is always at ${state.framePath} (updated within a couple of seconds of it changing; the last 30 snapshots are next to it as frame-<time>.jpg). Look at it whenever I refer to the screen ("this", "here", "look at…"). No reply needed to this message.`,
    );
  }
}

export async function stopScreenShare(): Promise<void> {
  const { stream, channelId } = state;
  if (!stream) return;
  if (timer != null) window.clearInterval(timer);
  timer = null;
  for (const t of stream.getTracks()) t.stop();
  if (video) video.srcObject = null;
  video = null;
  set({ stream: null, startedAt: null, framePath: null });
  await invoke("office_screen_frame", { jpegBase64: "" }).catch(() => undefined);
  if (channelId) await announce(channelId, "[screen share] I've stopped sharing my screen. No reply needed.");
  set({ channelId: null });
}

/** Save a snapshot now (e.g. right before the owner asks something). */
export const snapshotScreenNow = () => capture(true);
