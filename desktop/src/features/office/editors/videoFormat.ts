// The Video editor's project file (.video.json): a timeline of clips on
// tracks, like a Premiere Pro sequence, with keyframed motion (After Effects
// style), effects, titles and fades. Media stay files; the project points at
// them.

import { type Adjust, NO_ADJUST } from "./imageFormat";

export type MediaKind = "video" | "audio" | "image";
export type VideoMedia = {
  id: string;
  name: string;
  kind: MediaKind;
  /** An absolute file path (inside the office's shared artifacts/_media
   *  folder) or an https URL. */
  src: string;
  /** Seconds (video, audio). */
  duration?: number;
  width?: number;
  height?: number;
  /** A small first frame (data: URL). */
  thumb?: string;
};

export type TrackKind = "video" | "audio";
export type VideoTrack = { id: string; kind: TrackKind; name: string; hidden?: boolean; muted?: boolean; locked?: boolean };

export const ANIM_PROPS = ["x", "y", "scale", "rotation", "opacity"] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];
export type Keyframe = { t: number; v: number };
export type Transform = Record<AnimProp, number>;
export const NO_TRANSFORM: Transform = { x: 0, y: 0, scale: 100, rotation: 0, opacity: 100 };

export type ClipType = "media" | "text" | "color";
export type VideoClip = {
  id: string;
  track: string;
  type: ClipType;
  /** Where it starts on the timeline (s). */
  start: number;
  /** How long it plays (s). */
  dur: number;
  /** Where it starts inside its media (s). */
  in: number;
  media?: string;
  name?: string;
  // titles
  text?: string;
  font?: string;
  size?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  /** A box behind the title ("transparent" = none). */
  box?: string;
  // color matte
  fill?: string;
  /** Motion: x/y offset from the centre (px), scale %, rotation °, opacity %. */
  transform: Transform;
  /** Keyframes per property, times relative to the clip's start. */
  anim?: Partial<Record<AnimProp, Keyframe[]>>;
  effects?: Adjust;
  fadeIn?: number;
  fadeOut?: number;
  /** 0–2 (1 = as recorded). */
  volume?: number;
};

export type VideoFile = {
  type: "video";
  version: 1;
  width: number;
  height: number;
  fps: number;
  background: string;
  media: VideoMedia[];
  tracks: VideoTrack[];
  clips: VideoClip[];
  preview?: string;
};

export function vid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function blankVideo(width = 1920, height = 1080, fps = 30): VideoFile {
  return {
    type: "video",
    version: 1,
    width,
    height,
    fps,
    background: "#000000",
    media: [],
    tracks: [
      { id: "v1", kind: "video", name: "V1" },
      { id: "v2", kind: "video", name: "V2" },
      { id: "v3", kind: "video", name: "V3" },
      { id: "a1", kind: "audio", name: "A1" },
      { id: "a2", kind: "audio", name: "A2" },
    ],
    clips: [],
  };
}

export function projectDuration(p: { clips: VideoClip[] }): number {
  return p.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
}

/** A property's value `local` seconds into a clip (keyframes, linear). */
export function valueAt(clip: VideoClip, prop: AnimProp, local: number): number {
  const keys = clip.anim?.[prop];
  if (!keys?.length) return clip.transform[prop];
  if (local <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (local >= last.t) return last.v;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (local <= b.t) {
      const k = (local - a.t) / Math.max(1e-6, b.t - a.t);
      // ease in-out, like the default keyframe in the pro apps
      const e = k * k * (3 - 2 * k);
      return a.v + (b.v - a.v) * e;
    }
  }
  return last.v;
}

/** 0–1 from the clip's fades. */
export function fadeAt(clip: VideoClip, local: number): number {
  let f = 1;
  if (clip.fadeIn && local < clip.fadeIn) f = Math.min(f, Math.max(0, local / clip.fadeIn));
  if (clip.fadeOut && local > clip.dur - clip.fadeOut) f = Math.min(f, Math.max(0, (clip.dur - local) / clip.fadeOut));
  return f;
}

export function timecode(t: number, fps: number): string {
  const s = Math.max(0, t);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps + 1e-6);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(h)}:${p(m)}:${p(sec)}:${p(f)}`;
}

const num = (v: unknown, d: number, lo = -1e6, hi = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const color = (v: unknown, d: string) =>
  typeof v === "string" && /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i.test(v.trim()) ? v.trim() : d;

/** Read a saved (or agent-written) project, filling in what's missing. */
export function parseVideo(value: unknown): VideoFile {
  const v = (value ?? {}) as Record<string, unknown>;
  const base = blankVideo(
    Math.round(num(v.width, 1920, 16, 7680)),
    Math.round(num(v.height, 1080, 16, 7680)),
    Math.round(num(v.fps, 30, 1, 120)),
  );
  const media: VideoMedia[] = [];
  for (const raw of Array.isArray(v.media) ? v.media : []) {
    const m = (raw ?? {}) as Record<string, unknown>;
    const src = str(m.src, "");
    if (!src || /^(javascript|file):/i.test(src)) continue;
    const kind = m.kind === "audio" || m.kind === "image" ? m.kind : "video";
    media.push({
      id: str(m.id, vid()) || vid(),
      name: str(m.name, src.split(/[\\/]/).pop() ?? "Media"),
      kind,
      src,
      ...(m.duration != null ? { duration: num(m.duration, 0, 0, 86400) } : {}),
      ...(m.width != null ? { width: num(m.width, 0, 0, 20000) } : {}),
      ...(m.height != null ? { height: num(m.height, 0, 0, 20000) } : {}),
      ...(typeof m.thumb === "string" && m.thumb.startsWith("data:image/") ? { thumb: m.thumb } : {}),
    });
  }
  let tracks: VideoTrack[] = [];
  for (const raw of Array.isArray(v.tracks) ? v.tracks : []) {
    const t = (raw ?? {}) as Record<string, unknown>;
    tracks.push({
      id: str(t.id, vid()) || vid(),
      kind: t.kind === "audio" ? "audio" : "video",
      name: str(t.name, t.kind === "audio" ? "A" : "V"),
      hidden: t.hidden === true,
      muted: t.muted === true,
      locked: t.locked === true,
    });
  }
  if (!tracks.some((t) => t.kind === "video")) tracks = [...base.tracks.filter((t) => t.kind === "video"), ...tracks];
  if (!tracks.some((t) => t.kind === "audio")) tracks = [...tracks, ...base.tracks.filter((t) => t.kind === "audio")];
  const trackIds = new Set(tracks.map((t) => t.id));
  const mediaIds = new Set(media.map((m) => m.id));
  const firstVideo = tracks.find((t) => t.kind === "video")?.id ?? "v1";
  const clips: VideoClip[] = [];
  for (const raw of Array.isArray(v.clips) ? v.clips : []) {
    const c = (raw ?? {}) as Record<string, unknown>;
    const type: ClipType = c.type === "text" || c.type === "color" ? c.type : "media";
    if (type === "media" && !mediaIds.has(String(c.media))) continue;
    const tr = (c.transform ?? {}) as Record<string, unknown>;
    const anim: Partial<Record<AnimProp, Keyframe[]>> = {};
    const rawAnim = (c.anim ?? {}) as Record<string, unknown>;
    for (const p of ANIM_PROPS) {
      const keys = rawAnim[p];
      if (Array.isArray(keys) && keys.length) {
        anim[p] = keys
          .map((k) => ({ t: num((k as Keyframe)?.t, 0, 0, 86400), v: num((k as Keyframe)?.v, NO_TRANSFORM[p]) }))
          .sort((a, b) => a.t - b.t);
      }
    }
    const fx = c.effects as Record<string, unknown> | undefined;
    clips.push({
      id: str(c.id, vid()) || vid(),
      track: trackIds.has(String(c.track)) ? String(c.track) : firstVideo,
      type,
      start: num(c.start, 0, 0, 86400),
      dur: num(c.dur, 5, 1 / 120, 86400),
      in: num(c.in, 0, 0, 86400),
      ...(type === "media" ? { media: String(c.media) } : {}),
      ...(c.name != null ? { name: str(c.name, "") } : {}),
      ...(type === "text"
        ? {
            text: str(c.text, "Title"),
            font: str(c.font, "Inter"),
            size: num(c.size, 96, 4, 1000),
            color: color(c.color, "#ffffff"),
            bold: c.bold !== false,
            italic: c.italic === true,
            align: c.align === "left" || c.align === "right" ? c.align : "center",
            box: color(c.box, "transparent"),
          }
        : {}),
      ...(type === "color" ? { fill: color(c.fill, "#000000") } : {}),
      transform: {
        x: num(tr.x, 0),
        y: num(tr.y, 0),
        scale: num(tr.scale, 100, 0, 5000),
        rotation: num(tr.rotation, 0, -36000, 36000),
        opacity: num(tr.opacity, 100, 0, 100),
      },
      ...(Object.keys(anim).length ? { anim } : {}),
      ...(fx
        ? {
            effects: Object.fromEntries(
              Object.entries(NO_ADJUST).map(([k, d]) => [k, num(fx[k], d, -360, 500)]),
            ) as Adjust,
          }
        : {}),
      ...(c.fadeIn != null ? { fadeIn: num(c.fadeIn, 0, 0, 600) } : {}),
      ...(c.fadeOut != null ? { fadeOut: num(c.fadeOut, 0, 0, 600) } : {}),
      ...(c.volume != null ? { volume: num(c.volume, 1, 0, 2) } : {}),
    });
  }
  return {
    ...base,
    background: color(v.background, "#000000"),
    media,
    tracks,
    clips,
    preview: typeof v.preview === "string" && v.preview.startsWith("data:image/") ? v.preview : undefined,
  };
}

export const VIDEO_SPEC =
  'JSON: {"type":"video","version":1,"width":1920,"height":1080,"fps":30,"background":"#000000","media":[{"id":"m1","name":"intro.mp4","kind":"video|audio|image","src":"<absolute path of a file you copied into the shared workspace\'s artifacts/_media folder, or an https URL>","duration":12.5}],"tracks":[{"id":"v1","kind":"video","name":"V1"},{"id":"v2","kind":"video","name":"V2"},{"id":"a1","kind":"audio","name":"A1"}],"clips":[…]}. Video tracks listed first draw at the bottom. A clip: {"id","track","type":"media|text|color","start":seconds on the timeline,"dur":seconds,"in":seconds into the media,"media":"m1" (media clips),"text","font","size","color","bold","align","box":"#000000aa" (titles),"fill" (colour mattes),"transform":{"x":0,"y":0,"scale":100,"rotation":0,"opacity":100} (x/y from the centre, px),"anim":{"opacity":[{"t":0,"v":0},{"t":0.5,"v":100}]} (keyframes, t from the clip\'s start),"effects":{"brightness":100,"contrast":100,"saturation":100,"hue":0,"blur":0,"grayscale":0,"sepia":0,"invert":0},"fadeIn":0.5,"fadeOut":0.5,"volume":1}. Keep footage, titles and music as separate clips so the owner can keep editing them.';
