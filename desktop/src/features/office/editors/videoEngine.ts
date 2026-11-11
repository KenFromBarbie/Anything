// Plays a Video editor project into a canvas: the program monitor, the
// read-only player in Create, and the export (canvas + mixed audio recorded
// in real time).

import { convertFileSrc } from "@tauri-apps/api/core";

import { filterOf } from "./imageEngine";
import {
  fadeAt,
  projectDuration,
  type VideoClip,
  type VideoFile,
  type VideoMedia,
  valueAt,
} from "./videoFormat";

export function mediaUrl(src: string): string {
  return /^(https?:|data:|blob:)/i.test(src) ? src : convertFileSrc(src);
}

type El = HTMLVideoElement | HTMLAudioElement | HTMLImageElement;
type Slot = { el: El; src: string; gain?: GainNode; source?: MediaElementAudioSourceNode };

export class VideoEngine {
  readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private p: VideoFile;
  private slots = new Map<string, Slot>();
  time = 0;
  playing = false;
  private raf = 0;
  private wallStart = 0;
  private timeStart = 0;
  private ac: AudioContext | null = null;
  private master: GainNode | null = null;
  private record: MediaStreamAudioDestinationNode | null = null;
  onTime: (t: number) => void = () => {};
  onStop: () => void = () => {};
  /** Draw a frame overlay (guides) after the picture; preview only. */
  overlay: ((g: CanvasRenderingContext2D) => void) | null = null;
  private exporting = false;

  constructor(canvas: HTMLCanvasElement, project: VideoFile) {
    this.canvas = canvas;
    this.g = canvas.getContext("2d") as CanvasRenderingContext2D;
    this.p = project;
    this.sync();
  }

  get project() {
    return this.p;
  }
  get duration() {
    return projectDuration(this.p);
  }

  setProject(p: VideoFile) {
    this.p = p;
    this.sync();
    if (!this.playing) this.seek(this.time);
  }

  private mediaOf(c: VideoClip): VideoMedia | undefined {
    return c.type === "media" ? this.p.media.find((m) => m.id === c.media) : undefined;
  }

  /** One element per media clip (so overlapping uses of a file each play). */
  private sync() {
    if (this.canvas.width !== this.p.width) this.canvas.width = this.p.width;
    if (this.canvas.height !== this.p.height) this.canvas.height = this.p.height;
    const live = new Set<string>();
    for (const c of this.p.clips) {
      const m = this.mediaOf(c);
      if (!m) continue;
      live.add(c.id);
      const src = mediaUrl(m.src);
      const have = this.slots.get(c.id);
      if (have && have.src === src) continue;
      if (have) this.drop(c.id);
      let el: El;
      if (m.kind === "image") {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => !this.playing && this.render(this.time);
        img.src = src;
        el = img;
      } else {
        const media = document.createElement(m.kind === "audio" ? "audio" : "video") as HTMLVideoElement;
        media.crossOrigin = "anonymous";
        media.preload = "auto";
        media.playsInline = true;
        media.muted = !this.ac; // silent until the audio graph exists
        media.src = src;
        media.addEventListener("seeked", () => !this.playing && this.render(this.time));
        media.addEventListener("loadeddata", () => !this.playing && this.seek(this.time));
        el = media;
      }
      const slot: Slot = { el, src };
      this.slots.set(c.id, slot);
      if (this.ac) this.wire(slot);
    }
    for (const id of [...this.slots.keys()]) if (!live.has(id)) this.drop(id);
  }

  private drop(id: string) {
    const s = this.slots.get(id);
    if (!s) return;
    if (s.el instanceof HTMLMediaElement) {
      s.el.pause();
      s.el.removeAttribute("src");
      s.el.load();
    }
    s.source?.disconnect();
    s.gain?.disconnect();
    this.slots.delete(id);
  }

  /** Audio goes through Web Audio, so the export can record the mix. */
  private ensureAudio() {
    if (this.ac) return;
    this.ac = new AudioContext();
    this.master = this.ac.createGain();
    this.master.connect(this.ac.destination);
    for (const s of this.slots.values()) this.wire(s);
  }

  private wire(s: Slot) {
    if (!this.ac || !this.master || !(s.el instanceof HTMLMediaElement) || s.source) return;
    try {
      s.source = this.ac.createMediaElementSource(s.el);
      s.gain = this.ac.createGain();
      s.source.connect(s.gain);
      s.gain.connect(this.master);
      if (this.record) s.gain.connect(this.record);
      s.el.muted = false;
    } catch {
      // already wired, or the media refused it: plays without the mix
    }
  }

  private active(t: number): VideoClip[] {
    return this.p.clips.filter((c) => t >= c.start && t < c.start + c.dur);
  }

  private trackOf(c: VideoClip) {
    return this.p.tracks.find((t) => t.id === c.track);
  }

  /** Draw the frame at `t`. */
  render(t: number) {
    const { g } = this;
    const W = this.p.width;
    const H = this.p.height;
    g.save();
    g.globalAlpha = 1;
    g.filter = "none";
    g.fillStyle = this.p.background;
    g.fillRect(0, 0, W, H);
    g.restore();
    const videoTracks = this.p.tracks.filter((tr) => tr.kind === "video");
    for (const tr of videoTracks) {
      if (tr.hidden) continue;
      for (const c of this.p.clips) {
        if (c.track !== tr.id || t < c.start || t >= c.start + c.dur) continue;
        this.drawClip(c, t);
      }
    }
    if (this.overlay && !this.exporting) this.overlay(g);
  }

  private drawClip(c: VideoClip, t: number) {
    const { g } = this;
    const W = this.p.width;
    const H = this.p.height;
    const local = t - c.start;
    const opacity = (valueAt(c, "opacity", local) / 100) * fadeAt(c, local);
    if (opacity <= 0) return;
    g.save();
    g.globalAlpha = Math.min(1, opacity);
    g.filter = filterOf(c.effects);
    g.translate(W / 2 + valueAt(c, "x", local), H / 2 + valueAt(c, "y", local));
    g.rotate((valueAt(c, "rotation", local) * Math.PI) / 180);
    const k = valueAt(c, "scale", local) / 100;
    g.scale(k, k);
    if (c.type === "color") {
      g.fillStyle = c.fill ?? "#000";
      g.fillRect(-W / 2, -H / 2, W, H);
    } else if (c.type === "text") {
      drawTitle(g, c);
    } else {
      const s = this.slots.get(c.id);
      const el = s?.el;
      if (el) {
        const iw = el instanceof HTMLVideoElement ? el.videoWidth : el instanceof HTMLImageElement ? el.naturalWidth : 0;
        const ih = el instanceof HTMLVideoElement ? el.videoHeight : el instanceof HTMLImageElement ? el.naturalHeight : 0;
        const ready = el instanceof HTMLVideoElement ? el.readyState >= 2 : el instanceof HTMLImageElement ? el.complete : false;
        if (iw && ih && ready) {
          // Fit the frame (like "Set to frame size").
          const f = Math.min(W / iw, H / ih);
          g.drawImage(el as CanvasImageSource, (-iw * f) / 2, (-ih * f) / 2, iw * f, ih * f);
        }
      }
    }
    g.restore();
  }

  /** Bring every playing element to time `t` (and draw it). */
  seek(t: number) {
    this.time = Math.max(0, t);
    for (const c of this.p.clips) {
      const s = this.slots.get(c.id);
      if (!(s?.el instanceof HTMLMediaElement)) continue;
      const inside = this.time >= c.start && this.time < c.start + c.dur;
      const want = c.in + (inside ? this.time - c.start : 0);
      if (Math.abs(s.el.currentTime - want) > 0.02 && s.el.readyState >= 1) s.el.currentTime = want;
    }
    this.render(this.time);
  }

  play(from = this.time) {
    this.ensureAudio();
    void this.ac?.resume();
    if (from >= this.duration - 0.01) from = 0;
    this.time = from;
    this.timeStart = from;
    this.wallStart = performance.now();
    this.playing = true;
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (!this.playing) return;
      const t = this.timeStart + (performance.now() - this.wallStart) / 1000;
      this.time = t;
      this.drive(t);
      this.render(t);
      this.onTime(t);
      if (t >= this.duration) {
        this.pause();
        this.onStop();
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Keep media elements playing in step with the timeline. */
  private drive(t: number) {
    const on = new Set(this.active(t).map((c) => c.id));
    for (const c of this.p.clips) {
      const s = this.slots.get(c.id);
      if (!(s?.el instanceof HTMLMediaElement)) continue;
      const el = s.el;
      if (!on.has(c.id)) {
        if (!el.paused) el.pause();
        continue;
      }
      const want = c.in + (t - c.start);
      if (el.paused) {
        el.currentTime = want;
        void el.play().catch(() => {});
      } else if (Math.abs(el.currentTime - want) > 0.25) {
        el.currentTime = want;
      }
      const tr = this.trackOf(c);
      const audible = !(tr?.muted ?? false) && !(tr?.kind === "video" && tr.hidden);
      const vol = audible ? (c.volume ?? 1) * fadeAt(c, t - c.start) : 0;
      if (s.gain) s.gain.gain.value = vol;
      else el.volume = Math.min(1, vol);
    }
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    for (const s of this.slots.values()) if (s.el instanceof HTMLMediaElement && !s.el.paused) s.el.pause();
  }

  /** Record the whole timeline in real time. */
  async export(onProgress: (k: number) => void, signal?: AbortSignal): Promise<{ blob: Blob; ext: string }> {
    this.pause();
    this.ensureAudio();
    await this.ac?.resume();
    const ac = this.ac as AudioContext;
    this.record = ac.createMediaStreamDestination();
    for (const s of this.slots.values()) {
      this.wire(s);
      s.gain?.connect(this.record);
    }
    const stream = this.canvas.captureStream(this.p.fps);
    for (const track of this.record.stream.getAudioTracks()) stream.addTrack(track);
    const types = [
      ["video/mp4;codecs=avc1.640028,mp4a.40.2", "mp4"],
      ["video/mp4", "mp4"],
      ["video/webm;codecs=vp9,opus", "webm"],
      ["video/webm", "webm"],
    ] as const;
    const [mime, ext] = types.find(([m]) => MediaRecorder.isTypeSupported(m)) ?? ["", "webm"];
    const rec = new MediaRecorder(stream, {
      ...(mime ? { mimeType: mime } : {}),
      videoBitsPerSecond: Math.round(this.p.width * this.p.height * this.p.fps * 0.12),
    });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((r) => {
      rec.onstop = () => r();
    });
    this.exporting = true;
    // Let every clip at 0 settle first.
    this.seek(0);
    await new Promise((r) => setTimeout(r, 400));
    const total = this.duration;
    const prevStop = this.onStop;
    const prevTime = this.onTime;
    const finished = new Promise<void>((r) => {
      this.onStop = () => r();
      this.onTime = (t) => onProgress(Math.min(1, t / Math.max(0.001, total)));
      signal?.addEventListener("abort", () => {
        this.pause();
        r();
      });
    });
    rec.start(250);
    this.play(0);
    await finished;
    rec.stop();
    await done;
    this.exporting = false;
    this.onStop = prevStop;
    this.onTime = prevTime;
    for (const s of this.slots.values()) {
      try {
        s.gain?.disconnect(this.record);
      } catch {
        /* not connected */
      }
    }
    this.record = null;
    for (const t of stream.getTracks()) t.stop();
    if (signal?.aborted) throw new Error("Export cancelled");
    return { blob: new Blob(chunks, { type: mime || "video/webm" }), ext };
  }

  dispose() {
    this.pause();
    for (const id of [...this.slots.keys()]) this.drop(id);
    void this.ac?.close();
    this.ac = null;
  }
}

export function titleFont(c: VideoClip): string {
  return `${c.italic ? "italic " : ""}${c.bold ? "bold " : ""}${c.size ?? 96}px "${c.font ?? "Inter"}", sans-serif`;
}

/** A title, centred on (0, 0). */
export function drawTitle(g: CanvasRenderingContext2D, c: VideoClip) {
  const size = c.size ?? 96;
  const lines = (c.text ?? "").split("\n");
  g.font = titleFont(c);
  g.textBaseline = "middle";
  const widths = lines.map((l) => g.measureText(l).width);
  const w = Math.max(1, ...widths);
  const lh = size * 1.2;
  const h = lines.length * lh;
  const align = c.align ?? "center";
  if (c.box && c.box !== "transparent") {
    const pad = size * 0.35;
    g.fillStyle = c.box;
    g.fillRect(-w / 2 - pad, -h / 2 - pad * 0.6, w + pad * 2, h + pad * 1.2);
  }
  g.fillStyle = c.color ?? "#ffffff";
  g.textAlign = align;
  const x = align === "left" ? -w / 2 : align === "right" ? w / 2 : 0;
  lines.forEach((l, i) => g.fillText(l, x, -h / 2 + lh * (i + 0.5)));
}

/** Read a picked file's length, size and a first frame. */
export async function probeMedia(src: string, kind: VideoMedia["kind"]): Promise<Partial<VideoMedia>> {
  const url = mediaUrl(src);
  if (kind === "image") {
    const img = new Image();
    img.crossOrigin = "anonymous";
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = url;
    });
    return { width: img.naturalWidth, height: img.naturalHeight, thumb: thumbOf(img, img.naturalWidth, img.naturalHeight) };
  }
  const el = document.createElement(kind === "audio" ? "audio" : "video") as HTMLVideoElement;
  el.crossOrigin = "anonymous";
  el.preload = "auto";
  el.muted = true;
  el.src = url;
  await new Promise((res, rej) => {
    el.onloadedmetadata = res;
    el.onerror = () => rej(new Error("this file can't be played here"));
  });
  if (!Number.isFinite(el.duration)) {
    // Some recordings (WebM from a recorder) don't say how long they are
    // until you seek past the end.
    el.currentTime = 1e9;
    await new Promise((res) => {
      el.ondurationchange = res;
      el.onseeked = res;
      setTimeout(res, 3000);
    });
  }
  const out: Partial<VideoMedia> = { duration: Number.isFinite(el.duration) ? el.duration : 0 };
  if (kind === "video") {
    out.width = el.videoWidth;
    out.height = el.videoHeight;
    el.currentTime = Math.min(0.5, (el.duration || 1) / 2);
    await new Promise((res) => {
      el.onseeked = res;
      setTimeout(res, 3000);
    });
    try {
      out.thumb = thumbOf(el, el.videoWidth, el.videoHeight);
    } catch {
      /* no frame */
    }
  }
  el.removeAttribute("src");
  el.load();
  return out;
}

function thumbOf(src: CanvasImageSource, w: number, h: number): string | undefined {
  if (!w || !h) return undefined;
  const k = 160 / Math.max(w, h);
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext("2d")?.drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}
