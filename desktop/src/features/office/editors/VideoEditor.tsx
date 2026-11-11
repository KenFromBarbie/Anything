import * as React from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronLeft,
  ChevronRight,
  Diamond,
  Film,
  ImageIcon,
  Music,
  Pause,
  Play,
  Plus,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Timer,
  Type,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import { CreativeShell, isTyping, type Menu, NumberField, Panel, Slider } from "./CreativeShell";
import { closeEditor, exportFile, saveToCreate } from "./editorStore";
import { type Adjust, IMAGE_FONTS, NO_ADJUST } from "./imageFormat";
import { toSix } from "./ImagePanels";
import { probeMedia, VideoEngine } from "./videoEngine";
import {
  type AnimProp,
  NO_TRANSFORM,
  projectDuration,
  timecode,
  type VideoClip,
  type VideoFile,
  type VideoMedia,
  vid,
  valueAt,
} from "./videoFormat";
import { type TimelineTool, VideoTimeline } from "./VideoTimeline";
import { editorRequest } from "./requests";

const SEQ_PRESETS = [
  { label: "HD 1080p · 16:9", w: 1920, h: 1080 },
  { label: "4K UHD · 16:9", w: 3840, h: 2160 },
  { label: "720p · 16:9", w: 1280, h: 720 },
  { label: "Vertical · 9:16 (Reels, TikTok, Shorts)", w: 1080, h: 1920 },
  { label: "Square · 1:1", w: 1080, h: 1080 },
  { label: "Portrait · 4:5", w: 1080, h: 1350 },
];

type Preset = { label: string; apply: (c: VideoClip) => Partial<VideoClip> };
/** Animation presets (After Effects-style), applied to the selected clip. */
const ANIM_PRESETS: Preset[] = [
  { label: "Fade in & out", apply: (c) => ({ fadeIn: Math.min(0.5, c.dur / 3), fadeOut: Math.min(0.5, c.dur / 3) }) },
  {
    label: "Slide in from left",
    apply: (c) => ({ anim: { ...c.anim, x: [{ t: 0, v: c.transform.x - 1200 }, { t: Math.min(0.6, c.dur / 2), v: c.transform.x }] } }),
  },
  {
    label: "Rise up",
    apply: (c) => ({
      anim: {
        ...c.anim,
        y: [{ t: 0, v: c.transform.y + 120 }, { t: Math.min(0.6, c.dur / 2), v: c.transform.y }],
        opacity: [{ t: 0, v: 0 }, { t: Math.min(0.6, c.dur / 2), v: c.transform.opacity }],
      },
    }),
  },
  {
    label: "Pop in",
    apply: (c) => ({
      anim: { ...c.anim, scale: [{ t: 0, v: 0 }, { t: Math.min(0.25, c.dur / 3), v: c.transform.scale * 1.12 }, { t: Math.min(0.4, c.dur / 2), v: c.transform.scale }] },
    }),
  },
  {
    label: "Slow zoom (Ken Burns)",
    apply: (c) => ({ anim: { ...c.anim, scale: [{ t: 0, v: c.transform.scale }, { t: c.dur, v: c.transform.scale * 1.15 }] } }),
  },
  { label: "Spin in", apply: (c) => ({ anim: { ...c.anim, rotation: [{ t: 0, v: -180 }, { t: Math.min(0.6, c.dur / 2), v: 0 }], scale: [{ t: 0, v: 0 }, { t: Math.min(0.6, c.dur / 2), v: c.transform.scale }] } }) },
  { label: "Remove animation", apply: () => ({ anim: undefined, fadeIn: 0, fadeOut: 0 }) },
];
const LOOKS: { label: string; fx: Partial<Adjust> }[] = [
  { label: "Black & White", fx: { grayscale: 100, contrast: 115 } },
  { label: "Warm", fx: { sepia: 25, saturation: 120, brightness: 103 } },
  { label: "Cool", fx: { hue: 190, saturation: 85 } },
  { label: "Vintage", fx: { sepia: 45, contrast: 90, brightness: 105, saturation: 80 } },
  { label: "Punchy", fx: { contrast: 125, saturation: 135 } },
  { label: "Dreamy blur", fx: { blur: 3, brightness: 110 } },
  { label: "No look", fx: {} },
];
const TITLES: { label: string; make: (p: VideoFile) => Partial<VideoClip> }[] = [
  { label: "Title", make: () => ({ text: "Your Title", size: 120, bold: true, box: "transparent" }) },
  {
    label: "Lower third",
    make: (p) => ({ text: "Name Surname\nRole", size: 54, bold: true, align: "left", box: "#000000b3", transform: { ...NO_TRANSFORM, x: -p.width / 2 + 380, y: p.height / 2 - 170 } }),
  },
  { label: "Subtitle", make: (p) => ({ text: "Subtitle text", size: 52, bold: false, box: "#00000099", transform: { ...NO_TRANSFORM, y: p.height / 2 - 110 } }) },
  { label: "End card", make: () => ({ text: "Thanks for watching", size: 96, bold: true, box: "transparent" }) },
];

export function VideoEditor({
  title: initialTitle,
  file,
  series: initialSeries,
  path,
  artifactId,
}: {
  title: string;
  file: VideoFile;
  series?: string;
  path?: string;
  artifactId?: string;
}) {
  const [title, setTitle] = React.useState(initialTitle);
  const [series, setSeries] = React.useState(initialSeries);
  const [saved, setSaved] = React.useState<{ id: string; path?: string } | null>(artifactId ? { id: artifactId, path } : null);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [askSeq, setAskSeq] = React.useState<"new" | "settings" | null>(artifactId ? null : "new");
  const [project, setProjectState] = React.useState<VideoFile>(file);
  const projRef = React.useRef(project);
  const setProject = React.useCallback((p: VideoFile) => {
    projRef.current = p;
    setProjectState(p);
  }, []);
  const [sel, setSel] = React.useState<string | null>(null);
  const [time, setTimeState] = React.useState(0);
  // The latest time for key handlers fired before a re-render.
  const timeRef = React.useRef(0);
  const setTime = React.useCallback((t: number) => {
    timeRef.current = t;
    setTimeState(t);
  }, []);
  const [playing, setPlaying] = React.useState(false);
  const [pps, setPps] = React.useState(40);
  const [tool, setTool] = React.useState<TimelineTool>("select");
  const [snapping, setSnapping] = React.useState(true);
  const [binTab, setBinTab] = React.useState("Project");
  const [safe, setSafe] = React.useState(false);
  const [exporting, setExporting] = React.useState<{ k: number; abort: AbortController } | null>(null);
  const clipboard = React.useRef<VideoClip | null>(null);

  const canvas = React.useRef<HTMLCanvasElement>(null);
  const engine = React.useRef<VideoEngine | null>(null);
  const monitor = React.useRef<HTMLDivElement>(null);
  const [fitBox, setFitBox] = React.useState({ w: 640, h: 360 });

  // ---- history ---------------------------------------------------------
  const hist = React.useRef<{ label: string; p: VideoFile }[]>([{ label: "Open", p: file }]);
  const hi = React.useRef(0);
  const [, setHv] = React.useState(0);
  const commit = React.useCallback((label: string) => {
    hist.current = hist.current.slice(0, hi.current + 1);
    hist.current.push({ label, p: projRef.current });
    if (hist.current.length > 100) hist.current.shift();
    hi.current = hist.current.length - 1;
    setHv((v) => v + 1);
    setDirty(true);
  }, []);
  const restore = (i: number) => {
    const h = hist.current[i];
    if (!h) return;
    hi.current = i;
    setProject(h.p);
    setDirty(true);
    setHv((v) => v + 1);
  };
  const change = (p: VideoFile, label?: string) => {
    setProject(p);
    if (label) commit(label);
  };

  // ---- engine ----------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: create once
  React.useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const e = new VideoEngine(c, projRef.current);
    e.onTime = (t) => setTime(t);
    e.onStop = () => setPlaying(false);
    engine.current = e;
    e.seek(0);
    return () => e.dispose();
  }, []);
  React.useEffect(() => {
    engine.current?.setProject(project);
  }, [project]);
  React.useEffect(() => {
    const e = engine.current;
    if (!e) return;
    e.overlay = safe
      ? (g) => {
          const W = project.width;
          const H = project.height;
          g.save();
          g.strokeStyle = "rgba(255,255,255,0.5)";
          g.lineWidth = Math.max(1, W / 960);
          g.setLineDash([W / 120, W / 120]);
          g.strokeRect(W * 0.05, H * 0.05, W * 0.9, H * 0.9);
          g.strokeRect(W * 0.1, H * 0.1, W * 0.8, H * 0.8);
          g.restore();
        }
      : null;
    if (!e.playing) e.render(e.time);
  }, [safe, project.width, project.height]);

  React.useEffect(() => {
    const m = monitor.current;
    if (!m) return;
    const ro = new ResizeObserver(() => {
      const k = Math.min((m.clientWidth - 24) / project.width, (m.clientHeight - 24) / project.height);
      setFitBox({ w: Math.max(10, project.width * k), h: Math.max(10, project.height * k) });
    });
    ro.observe(m);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  const duration = projectDuration(project);
  const fps = project.fps;
  const seek = (t: number) => {
    const e = engine.current;
    const tt = Math.max(0, Math.min(t, Math.max(duration, 0)));
    if (e?.playing) e.play(tt);
    else e?.seek(tt);
    setTime(tt);
  };
  const togglePlay = () => {
    const e = engine.current;
    if (!e) return;
    if (e.playing) {
      e.pause();
      setPlaying(false);
    } else if (duration > 0) {
      e.play(time);
      setPlaying(true);
    }
  };

  // ---- clips -----------------------------------------------------------
  const clip = project.clips.find((c) => c.id === sel);
  const updateClip = (id: string, patch: Partial<VideoClip>, label?: string) =>
    change({ ...projRef.current, clips: projRef.current.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }, label);

  const trackFor = (kind: "video" | "audio", at: number, dur: number): string => {
    const p = projRef.current;
    const tracks = p.tracks.filter((t) => t.kind === kind && !t.locked);
    const free = tracks.find((t) => !p.clips.some((c) => c.track === t.id && c.start < at + dur && c.start + c.dur > at));
    return (free ?? tracks[0])?.id ?? p.tracks[0].id;
  };

  const addClip = (c: Omit<VideoClip, "id" | "track"> & { track?: string }, label: string) => {
    const kind = c.type === "media" && projRef.current.media.find((m) => m.id === c.media)?.kind === "audio" ? "audio" : "video";
    const full: VideoClip = { ...c, id: vid(), track: c.track ?? trackFor(kind, c.start, c.dur) } as VideoClip;
    change({ ...projRef.current, clips: [...projRef.current.clips, full] }, label);
    setSel(full.id);
    return full;
  };

  const addMedia = (mediaId: string, trackId?: string, at = time) => {
    const m = projRef.current.media.find((x) => x.id === mediaId);
    if (!m) return;
    const dur = m.kind === "image" ? 5 : Math.max(0.1, m.duration ?? 5);
    let track = trackId;
    const tr = projRef.current.tracks.find((t) => t.id === trackId);
    const want = m.kind === "audio" ? "audio" : "video";
    if (tr && tr.kind !== want) track = undefined;
    addClip({ type: "media", media: m.id, start: at, dur, in: 0, transform: { ...NO_TRANSFORM } }, `Add ${m.name}`);
    if (track) {
      const last = projRef.current.clips.at(-1);
      if (last) updateClip(last.id, { track });
    }
  };

  const addTitle = (i: number) => {
    const t = TITLES[i].make(projRef.current);
    addClip(
      {
        type: "text",
        start: time,
        dur: 4,
        in: 0,
        font: "Inter",
        color: "#ffffff",
        align: "center",
        ...t,
        transform: { ...NO_TRANSFORM, ...(t.transform ?? {}) },
        fadeIn: 0.3,
        fadeOut: 0.3,
      },
      `New ${TITLES[i].label.toLowerCase()}`,
    );
  };

  const addMatte = () =>
    addClip({ type: "color", fill: "#1d4ed8", start: time, dur: 4, in: 0, transform: { ...NO_TRANSFORM } }, "New colour matte");

  const split = (id: string, at: number) => {
    const p = projRef.current;
    const c = p.clips.find((x) => x.id === id);
    if (!c || at <= c.start + 1 / fps || at >= c.start + c.dur - 1 / fps) return;
    const cut = at - c.start;
    const shift = (keys?: { t: number; v: number }[]) => keys?.map((k) => ({ ...k, t: k.t - cut }));
    const anim2 = c.anim
      ? (Object.fromEntries(Object.entries(c.anim).map(([k, v]) => [k, shift(v)])) as VideoClip["anim"])
      : undefined;
    const a: VideoClip = { ...c, dur: cut, fadeOut: 0 };
    const b: VideoClip = { ...c, id: vid(), start: at, dur: c.dur - cut, in: c.in + cut, fadeIn: 0, anim: anim2 };
    change({ ...p, clips: p.clips.flatMap((x) => (x.id === id ? [a, b] : [x])) }, "Razor");
    setSel(b.id);
  };

  const splitAtPlayhead = () => {
    const p = projRef.current;
    const targets = sel ? p.clips.filter((c) => c.id === sel) : p.clips.filter((c) => !p.tracks.find((t) => t.id === c.track)?.locked);
    for (const c of targets) if (time > c.start && time < c.start + c.dur) split(c.id, time);
  };

  const remove = (ripple: boolean) => {
    const p = projRef.current;
    const c = p.clips.find((x) => x.id === sel);
    if (!c) return;
    const clips = p.clips
      .filter((x) => x.id !== c.id)
      .map((x) => (ripple && x.track === c.track && x.start >= c.start + c.dur - 1e-6 ? { ...x, start: x.start - c.dur } : x));
    change({ ...p, clips }, ripple ? "Ripple delete" : "Delete clip");
    setSel(null);
  };

  const paste = () => {
    const c = clipboard.current;
    if (!c) return;
    addClip({ ...structuredClone(c), start: time, track: c.track }, "Paste");
  };

  // ---- keyframed properties --------------------------------------------
  const local = clip ? Math.max(0, Math.min(clip.dur, time - clip.start)) : 0;
  const setProp = (prop: AnimProp, v: number, commitLabel?: string) => {
    if (!clip) return;
    const keys = clip.anim?.[prop];
    if (keys?.length) {
      const tol = 0.5 / fps;
      const others = keys.filter((k) => Math.abs(k.t - local) > tol);
      const next = [...others, { t: local, v }].sort((a, b) => a.t - b.t);
      updateClip(clip.id, { anim: { ...clip.anim, [prop]: next } }, commitLabel);
    } else {
      updateClip(clip.id, { transform: { ...clip.transform, [prop]: v } }, commitLabel);
    }
  };
  const toggleAnim = (prop: AnimProp) => {
    if (!clip) return;
    const anim = { ...(clip.anim ?? {}) };
    if (anim[prop]?.length) {
      const v = valueAt(clip, prop, local);
      delete anim[prop];
      updateClip(clip.id, { anim: Object.keys(anim).length ? anim : undefined, transform: { ...clip.transform, [prop]: v } }, "Stop animating");
    } else {
      anim[prop] = [{ t: local, v: clip.transform[prop] }];
      updateClip(clip.id, { anim }, "Add keyframe");
    }
  };
  const jumpKey = (prop: AnimProp, dir: 1 | -1) => {
    if (!clip) return;
    const keys = clip.anim?.[prop] ?? [];
    const k = dir > 0 ? keys.find((x) => x.t > local + 1e-3) : [...keys].reverse().find((x) => x.t < local - 1e-3);
    if (k) seek(clip.start + k.t);
  };

  // ---- media import ----------------------------------------------------
  const importMedia = async (paths?: string[]) => {
    let picked = paths;
    if (!picked) {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const r = await open({
        multiple: true,
        filters: [
          { name: "Media", extensions: ["mp4", "webm", "mov", "m4v", "mkv", "mp3", "wav", "ogg", "m4a", "aac", "flac", "png", "jpg", "jpeg", "webp", "gif"] },
        ],
      });
      picked = Array.isArray(r) ? r : typeof r === "string" ? [r] : [];
    }
    for (const p of picked) {
      try {
        const r = await invoke<{ path: string; name: string; kind: VideoMedia["kind"] }>("office_media_import", { path: p });
        const info = await probeMedia(r.path, r.kind).catch(() => ({}) as Partial<VideoMedia>);
        const m: VideoMedia = { id: vid(), name: r.name, kind: r.kind, src: r.path, ...info };
        change({ ...projRef.current, media: [...projRef.current.media, m] }, `Import ${m.name}`);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(/not found|unknown command|office_media_import/i.test(msg) ? "Importing needs the app to restart once (it was just added)." : msg);
      }
    }
  };

  // Files dropped onto the app window (Tauri gives their paths).
  // biome-ignore lint/correctness/useExhaustiveDependencies: register once
  React.useEffect(() => {
    let off: (() => void) | undefined;
    let alive = true;
    void import("@tauri-apps/api/webview")
      .then(({ getCurrentWebview }) =>
        getCurrentWebview().onDragDropEvent((ev) => {
          if (ev.payload.type === "drop" && ev.payload.paths.length) void importMedia(ev.payload.paths);
        }),
      )
      .then((u) => {
        if (alive) off = u;
        else u();
      })
      .catch(() => {});
    return () => {
      alive = false;
      off?.();
    };
  }, []);

  // ---- save / export ---------------------------------------------------
  const snapshot = (): string | undefined => {
    const e = engine.current;
    const c = canvas.current;
    if (!e || !c) return undefined;
    const at = duration > 0 ? Math.min(duration - 0.01, Math.max(time, Math.min(1, duration / 3))) : 0;
    e.render(at);
    try {
      const k = 480 / Math.max(c.width, c.height);
      const s = document.createElement("canvas");
      s.width = Math.round(c.width * k);
      s.height = Math.round(c.height * k);
      s.getContext("2d")?.drawImage(c, 0, 0, s.width, s.height);
      return s.toDataURL("image/jpeg", 0.8);
    } catch {
      return undefined;
    } finally {
      e.render(e.time);
    }
  };

  const save = async (): Promise<{ id: string; path?: string } | null> => {
    setSaving(true);
    try {
      const preview = snapshot();
      const r = await saveToCreate("video", title, { ...projRef.current, ...(preview ? { preview } : {}) }, series);
      setSeries(r.series);
      setSaved({ id: r.id, path: r.path });
      setDirty(false);
      return { id: r.id, path: r.path };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const exportVideo = async () => {
    const e = engine.current;
    if (!e || duration <= 0) return toast.message("Put something on the timeline first");
    const abort = new AbortController();
    setExporting({ k: 0, abort });
    setPlaying(false);
    try {
      const { blob, ext } = await e.export((k) => setExporting((x) => (x ? { ...x, k } : x)), abort.signal);
      const data = await new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.onerror = () => rej(r.error);
        r.readAsDataURL(blob);
      });
      setExporting(null);
      const ok = await exportFile(`${title.trim() || "Untitled"}.${ext}`, data, ext, `${ext.toUpperCase()} video`, true);
      if (ok) toast.success("Exported");
    } catch (err) {
      setExporting(null);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== "Export cancelled") toast.error(msg);
    } finally {
      e.seek(time);
    }
  };

  const exportFrame = async () => {
    const e = engine.current;
    const c = canvas.current;
    if (!e || !c) return;
    e.overlay = null;
    e.render(time);
    try {
      const ok = await exportFile(`${title.trim() || "Frame"} ${timecode(time, fps).replace(/:/g, "-")}.png`, c.toDataURL("image/png"), "png", "PNG image", true);
      if (ok) toast.success("Exported");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSafe((s) => s); // overlay restored by its effect on next change
      e.render(time);
    }
  };

  // ---- keyboard --------------------------------------------------------
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || exporting) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === " ") return (e.preventDefault(), togglePlay());
      if (mod && k === "z") return (e.preventDefault(), e.shiftKey ? restore(hi.current + 1) : restore(hi.current - 1));
      if (mod && k === "y") return (e.preventDefault(), restore(hi.current + 1));
      if (mod && k === "k") return (e.preventDefault(), splitAtPlayhead());
      if (mod && k === "c" && clip) return (clipboard.current = clip);
      if (mod && k === "v") return (e.preventDefault(), paste());
      if (mod && (k === "=" || k === "+")) return (e.preventDefault(), setPps((p) => Math.min(600, p * 1.25)));
      if (mod && k === "-") return (e.preventDefault(), setPps((p) => Math.max(4, p / 1.25)));
      if (mod) return;
      if (e.key === "Delete" || e.key === "Backspace") return remove(e.shiftKey);
      if (e.key === "Home") return seek(0);
      if (e.key === "End") return seek(duration);
      if (e.key === "ArrowLeft") return (e.preventDefault(), seek(timeRef.current - (e.shiftKey ? 1 : 1 / fps)));
      if (e.key === "ArrowRight") return (e.preventDefault(), seek(timeRef.current + (e.shiftKey ? 1 : 1 / fps)));
      if (k === "v") return setTool("select");
      if (k === "c") return setTool("razor");
      if (k === "s") return setSnapping((s) => !s);
      if (k === "k") return engine.current?.playing && togglePlay();
      if (k === "l") return !engine.current?.playing && togglePlay();
      if (k === "j") return seek(timeRef.current - 5);
    };
    window.addEventListener("keydown", down);
    return () => window.removeEventListener("keydown", down);
  });

  // ---- drag in the program monitor moves the selected clip -------------
  const monDrag = React.useRef<{ x0: number; y0: number; ox: number; oy: number } | null>(null);
  const onMonDown = (e: React.PointerEvent) => {
    if (!clip || clip.type === "media" && project.media.find((m) => m.id === clip.media)?.kind === "audio") return;
    if (time < clip.start || time >= clip.start + clip.dur) return;
    monDrag.current = { x0: e.clientX, y0: e.clientY, ox: valueAt(clip, "x", local), oy: valueAt(clip, "y", local) };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  };
  const onMonMove = (e: React.PointerEvent) => {
    const d = monDrag.current;
    if (!d || !clip) return;
    const k = project.width / fitBox.w;
    const x = Math.round(d.ox + (e.clientX - d.x0) * k);
    const y = Math.round(d.oy + (e.clientY - d.y0) * k);
    let next = clip;
    for (const [prop, v] of [["x", x], ["y", y]] as const) {
      const keys = next.anim?.[prop];
      if (keys?.length) {
        const others = keys.filter((kk) => Math.abs(kk.t - local) > 0.5 / fps);
        next = { ...next, anim: { ...next.anim, [prop]: [...others, { t: local, v }].sort((a, b) => a.t - b.t) } };
      } else next = { ...next, transform: { ...next.transform, [prop]: v } };
    }
    change({ ...projRef.current, clips: projRef.current.clips.map((c) => (c.id === clip.id ? next : c)) });
  };
  const onMonUp = () => {
    if (monDrag.current) commit("Position");
    monDrag.current = null;
  };

  // ---- menus -----------------------------------------------------------
  const addTrack = (kind: "video" | "audio") => {
    const p = projRef.current;
    const n = p.tracks.filter((t) => t.kind === kind).length + 1;
    const t = { id: vid(), kind, name: `${kind === "video" ? "V" : "A"}${n}` };
    const tracks = kind === "video" ? [...p.tracks.filter((x) => x.kind === "video"), t, ...p.tracks.filter((x) => x.kind === "audio")] : [...p.tracks, t];
    change({ ...p, tracks }, `Add ${kind} track`);
  };

  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "Save to Create", run: () => void save(), shortcut: "Ctrl+S" },
        { label: "Import Media…", run: () => void importMedia(), shortcut: "or drop files" },
        "-",
        { label: "Export Video…", run: () => void exportVideo() },
        { label: "Export Frame as PNG…", run: () => void exportFrame() },
        "-",
        { label: "Close", run: () => closeEditor() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: `Undo ${hist.current[hi.current]?.label ?? ""}`.trim(), run: () => restore(hi.current - 1), shortcut: "Ctrl+Z", disabled: hi.current <= 0 },
        { label: "Redo", run: () => restore(hi.current + 1), shortcut: "Ctrl+Shift+Z", disabled: hi.current >= hist.current.length - 1 },
        "-",
        { label: "Copy", run: () => (clipboard.current = clip ?? null), shortcut: "Ctrl+C", disabled: !clip },
        { label: "Paste at Playhead", run: paste, shortcut: "Ctrl+V" },
        { label: "Delete", run: () => remove(false), shortcut: "Delete", disabled: !clip },
        { label: "Ripple Delete", run: () => remove(true), shortcut: "Shift+Delete", disabled: !clip },
      ],
    },
    {
      label: "Clip",
      items: [
        { label: "Split at Playhead", run: splitAtPlayhead, shortcut: "Ctrl+K" },
        { label: "Fade In & Out", run: () => clip && updateClip(clip.id, ANIM_PRESETS[0].apply(clip), "Fades"), disabled: !clip },
        { label: "Remove Animation", run: () => clip && updateClip(clip.id, { anim: undefined, fadeIn: 0, fadeOut: 0 }, "Remove animation"), disabled: !clip },
        { label: "Mute Clip", run: () => clip && updateClip(clip.id, { volume: clip.volume === 0 ? 1 : 0 }, "Mute clip"), disabled: !clip, checked: clip?.volume === 0 },
      ],
    },
    {
      label: "Sequence",
      items: [
        { label: "Sequence Settings…", run: () => setAskSeq("settings") },
        { label: "Add Video Track", run: () => addTrack("video") },
        { label: "Add Audio Track", run: () => addTrack("audio") },
        "-",
        { label: "Go to Start", run: () => seek(0), shortcut: "Home" },
        { label: "Go to End", run: () => seek(duration), shortcut: "End" },
      ],
    },
    {
      label: "Graphics",
      items: [...TITLES.map((t, i) => ({ label: `New ${t.label}`, run: () => addTitle(i) })), { label: "New Colour Matte", run: addMatte }],
    },
    {
      label: "View",
      items: [
        { label: "Safe Margins", run: () => setSafe((s) => !s), checked: safe },
        { label: "Zoom Timeline In", run: () => setPps((p) => Math.min(600, p * 1.25)), shortcut: "Ctrl++" },
        { label: "Zoom Timeline Out", run: () => setPps((p) => Math.max(4, p / 1.25)), shortcut: "Ctrl+-" },
        { label: "Fit Timeline", run: () => setPps(Math.max(4, Math.min(600, 900 / Math.max(1, duration)))) },
      ],
    },
  ];

  const fileMedia = (m: VideoMedia) => (m.kind === "audio" ? Music : m.kind === "image" ? ImageIcon : Film);

  return (
    <CreativeShell
      ask={{
        placeholder: "e.g. Cut my clips into a 30-second promo with titles and music, or add captions",
        build: async (text) => {
          const s = dirty || !saved ? await save() : saved;
          return editorRequest("video", title, text, s);
        },
      }}
      badge="Vi"
      dirty={dirty}
      isNew={!saved}
      kind="video"
      menus={menus}
      onClose={() => closeEditor()}
      onSave={() => void save()}
      onTitle={(t) => {
        setTitle(t);
        setDirty(true);
      }}
      saving={saving}
      status={
        <>
          <span>
            {project.width} × {project.height} · {project.fps} fps
          </span>
          <span>Duration {timecode(duration, fps)}</span>
          <span>{project.clips.length} clips</span>
          <span className="ml-auto">Space play · C razor · V select · Ctrl+K split · Shift+Delete ripple delete</span>
        </>
      }
      title={title}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-[1.35]">
          {/* Project / Effects */}
          <Panel className="w-64 shrink-0 border-r border-black/60" onTab={setBinTab} tab={binTab} tabs={["Project", "Effects"]}>
            {binTab === "Project" ? (
              <div className="p-2">
                <button
                  className="mb-2 flex w-full items-center justify-center gap-1.5 rounded bg-[#2f6fd6] py-1.5 text-[12px] text-white hover:bg-[#3b7be0]"
                  onClick={() => void importMedia()}
                  type="button"
                >
                  <Plus className="h-3.5 w-3.5" /> Import media
                </button>
                {project.media.length === 0 ? (
                  <p className="px-1 text-[11px] leading-relaxed text-[#8a8a8a]">
                    Import videos, music and pictures (or drop them on the window), then drag them onto the timeline.
                  </p>
                ) : null}
                <div className="grid grid-cols-2 gap-1.5">
                  {project.media.map((m) => {
                    const Icon = fileMedia(m);
                    return (
                      <div
                        className="group cursor-grab rounded border border-black/50 bg-[#1e1e1e] hover:border-[#4aa3ff]"
                        draggable
                        key={m.id}
                        onDoubleClick={() => addMedia(m.id)}
                        onDragStart={(e) => e.dataTransfer.setData("application/x-video-media", m.id)}
                        title={`${m.name} — double-click to add at the playhead`}
                      >
                        <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-black">
                          {m.thumb ? <img alt="" className="h-full w-full object-cover" src={m.thumb} /> : <Icon className="h-6 w-6 text-[#777]" />}
                          {m.duration ? (
                            <span className="absolute bottom-0.5 right-1 rounded bg-black/70 px-1 text-[9px]">{timecode(m.duration, fps).slice(3, 8)}</span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 truncate px-1 py-0.5 text-[10px]">
                          <Icon className="h-2.5 w-2.5 shrink-0 opacity-60" />
                          <span className="truncate">{m.name}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-3 p-2 text-[12px]">
                <Group label="Titles (Essential Graphics)">
                  {TITLES.map((t, i) => (
                    <PresetBtn icon={Type} key={t.label} label={t.label} onClick={() => addTitle(i)} />
                  ))}
                  <PresetBtn icon={Plus} label="Colour matte" onClick={addMatte} />
                </Group>
                <Group label={`Animation presets${clip ? "" : " (select a clip)"}`}>
                  {ANIM_PRESETS.map((p) => (
                    <PresetBtn disabled={!clip} key={p.label} label={p.label} onClick={() => clip && updateClip(clip.id, p.apply(clip), p.label)} />
                  ))}
                </Group>
                <Group label={`Looks${clip ? "" : " (select a clip)"}`}>
                  {LOOKS.map((l) => (
                    <PresetBtn disabled={!clip} key={l.label} label={l.label} onClick={() => clip && updateClip(clip.id, { effects: { ...NO_ADJUST, ...l.fx } }, l.label)} />
                  ))}
                </Group>
              </div>
            )}
          </Panel>

          {/* Program monitor */}
          <div className="flex min-w-0 flex-1 flex-col bg-[#1b1b1b]">
            <div className="flex h-7 shrink-0 items-center border-b border-black/60 bg-[#262626] px-3 text-[11px] text-[#cfcfcf]">
              Program: {title.trim() || "Untitled"}
            </div>
            <div className="relative min-h-0 flex-1" ref={monitor}>
              <div className="absolute inset-0 flex items-center justify-center">
                <canvas
                  className={cn("bg-black shadow-[0_0_0_1px_rgba(0,0,0,0.7)]", clip && clip.type !== "media" ? "cursor-move" : clip ? "cursor-move" : "")}
                  onPointerDown={onMonDown}
                  onPointerMove={onMonMove}
                  onPointerUp={onMonUp}
                  ref={canvas}
                  style={{ width: fitBox.w, height: fitBox.h }}
                />
              </div>
              {exporting ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/60">
                  <div className="w-72 rounded-lg border border-black/60 bg-[#2f2f2f] p-4 text-[12px] shadow-2xl">
                    <div className="mb-2 font-semibold text-white">Exporting video…</div>
                    <div className="h-2 overflow-hidden rounded bg-black/50">
                      <div className="h-full bg-[#4aa3ff]" style={{ width: `${Math.round(exporting.k * 100)}%` }} />
                    </div>
                    <div className="mt-1.5 text-[#9a9a9a]">Recorded in real time · {Math.round(exporting.k * 100)}%</div>
                    <button className="mt-3 rounded bg-[#3a3a3a] px-3 py-1 hover:bg-[#454545]" onClick={() => exporting.abort.abort()} type="button">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            {/* transport */}
            <div className="flex h-10 shrink-0 items-center gap-1 border-t border-black/60 bg-[#262626] px-3">
              <span className="w-28 font-mono text-[13px] text-[#4aa3ff]">{timecode(time, fps)}</span>
              <span className="flex-1" />
              <Tr label="Go to start (Home)" onClick={() => seek(0)}><SkipBack className="h-4 w-4" /></Tr>
              <Tr label="Back one frame (←)" onClick={() => seek(time - 1 / fps)}><StepBack className="h-4 w-4" /></Tr>
              <button
                aria-label={playing ? "Pause (Space)" : "Play (Space)"}
                className="mx-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#3a3a3a] hover:bg-[#4a4a4a]"
                onClick={togglePlay}
                title={playing ? "Pause (Space)" : "Play (Space)"}
                type="button"
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </button>
              <Tr label="Forward one frame (→)" onClick={() => seek(time + 1 / fps)}><StepForward className="h-4 w-4" /></Tr>
              <Tr label="Go to end (End)" onClick={() => seek(duration)}><SkipForward className="h-4 w-4" /></Tr>
              <span className="flex-1" />
              <span className="w-28 text-right font-mono text-[12px] text-[#9a9a9a]">{timecode(duration, fps)}</span>
            </div>
          </div>

          {/* Effect Controls */}
          <Panel className="w-80 shrink-0 border-l border-black/60" title="Effect Controls">
            {clip ? (
              <EffectControls
                clip={clip}
                local={local}
                media={project.media.find((m) => m.id === clip.media)}
                onAnim={toggleAnim}
                onChange={(patch, label) => updateClip(clip.id, patch, label)}
                onCommit={(label) => commit(label)}
                onJump={jumpKey}
                onProp={setProp}
              />
            ) : (
              <p className="p-3 text-[11px] text-[#8a8a8a]">Select a clip on the timeline to change its motion, opacity, look, title and sound.</p>
            )}
          </Panel>
        </div>

        <VideoTimeline
          onChange={(p) => change(p)}
          onCommit={commit}
          onDropMedia={(id, track, t) => addMedia(id, track, t)}
          onPps={setPps}
          onSeek={seek}
          onSelect={setSel}
          onSnapping={setSnapping}
          onSplit={split}
          onTool={setTool}
          pps={pps}
          project={project}
          selected={sel}
          snapping={snapping}
          time={time}
          tool={tool}
        />
      </div>
      {askSeq ? (
        <SequenceDialog
          fps={project.fps}
          height={project.height}
          isNew={askSeq === "new"}
          onCancel={() => setAskSeq(null)}
          onOk={(w, h, f) => {
            setAskSeq(null);
            change({ ...projRef.current, width: w, height: h, fps: f }, askSeq === "new" ? undefined : "Sequence settings");
            if (askSeq === "new") setDirty(false);
          }}
          width={project.width}
        />
      ) : null}
    </CreativeShell>
  );
}

function Tr({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-label={label} className="flex h-7 w-7 items-center justify-center rounded text-[#cfcfcf] hover:bg-[#3a3a3a]" onClick={onClick} title={label} type="button">
      {children}
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#8a8a8a]">{label}</div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  );
}

function PresetBtn({ label, onClick, icon: Icon, disabled }: { label: string; onClick: () => void; icon?: typeof Type; disabled?: boolean }) {
  return (
    <button
      className="flex items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-[#3a3a3a] disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {Icon ? <Icon className="h-3.5 w-3.5 opacity-70" /> : <span className="h-1.5 w-1.5 rounded-full bg-[#4aa3ff]" />}
      {label}
    </button>
  );
}

const PROPS: { prop: AnimProp; label: string; min: number; max: number; unit: string }[] = [
  { prop: "x", label: "Position X", min: -4000, max: 4000, unit: "px" },
  { prop: "y", label: "Position Y", min: -4000, max: 4000, unit: "px" },
  { prop: "scale", label: "Scale", min: 0, max: 400, unit: "%" },
  { prop: "rotation", label: "Rotation", min: -360, max: 360, unit: "°" },
  { prop: "opacity", label: "Opacity", min: 0, max: 100, unit: "%" },
];
const FX: { key: keyof Adjust; label: string; min: number; max: number }[] = [
  { key: "brightness", label: "Brightness", min: 0, max: 200 },
  { key: "contrast", label: "Contrast", min: 0, max: 200 },
  { key: "saturation", label: "Saturation", min: 0, max: 300 },
  { key: "hue", label: "Hue", min: -180, max: 180 },
  { key: "blur", label: "Blur", min: 0, max: 40 },
  { key: "grayscale", label: "Black & White", min: 0, max: 100 },
  { key: "sepia", label: "Sepia", min: 0, max: 100 },
  { key: "invert", label: "Invert", min: 0, max: 100 },
];

function EffectControls({
  clip,
  media,
  local,
  onProp,
  onAnim,
  onJump,
  onChange,
  onCommit,
}: {
  clip: VideoClip;
  media?: VideoMedia;
  local: number;
  onProp: (p: AnimProp, v: number, label?: string) => void;
  onAnim: (p: AnimProp) => void;
  onJump: (p: AnimProp, dir: 1 | -1) => void;
  onChange: (patch: Partial<VideoClip>, label?: string) => void;
  onCommit: (label: string) => void;
}) {
  const visual = !(clip.type === "media" && media?.kind === "audio");
  const sound = clip.type === "media" && media?.kind !== "image";
  const fx = clip.effects ?? NO_ADJUST;
  const head = "border-b border-black/50 bg-[#262626] px-3 py-1 text-[11px] font-semibold text-[#cfcfcf]";
  return (
    <div className="pb-4 text-[11px]">
      <div className="px-3 py-2">
        <div className="truncate text-[12px] font-semibold text-white">
          {clip.name || (clip.type === "text" ? "Title" : clip.type === "color" ? "Colour Matte" : (media?.name ?? "Clip"))}
        </div>
        <div className="text-[#8a8a8a]">
          {clip.dur.toFixed(2)} s · at {clip.start.toFixed(2)} s
        </div>
      </div>
      {visual ? (
        <>
          <div className={head}>Motion</div>
          {PROPS.map((p) => {
            const animated = !!clip.anim?.[p.prop]?.length;
            const onKey = clip.anim?.[p.prop]?.some((k) => Math.abs(k.t - local) < 0.02);
            return (
              <div className="flex items-center gap-1 px-1.5 py-0.5" key={p.prop}>
                <button
                  aria-label={animated ? "Stop animating" : "Animate (add a keyframe)"}
                  className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded hover:bg-[#3d3d3d]", animated ? "text-[#4aa3ff]" : "text-[#777]")}
                  onClick={() => onAnim(p.prop)}
                  title={animated ? "Stop animating" : "Animate: keyframes are set as you change it over time"}
                  type="button"
                >
                  <Timer className="h-3.5 w-3.5" />
                </button>
                <div className="min-w-0 flex-1">
                  <Slider
                    label={p.label}
                    max={p.max}
                    min={p.min}
                    onChange={(v) => onProp(p.prop, v)}
                    onCommit={() => onCommit(p.label)}
                    unit={p.unit}
                    value={valueAt(clip, p.prop, local)}
                  />
                </div>
                {animated ? (
                  <div className="flex shrink-0 items-center">
                    <button className="text-[#9a9a9a] hover:text-white" onClick={() => onJump(p.prop, -1)} title="Previous keyframe" type="button">
                      <ChevronLeft className="h-3 w-3" />
                    </button>
                    <button
                      className={onKey ? "text-[#ffd75e]" : "text-[#777] hover:text-white"}
                      onClick={() => onProp(p.prop, valueAt(clip, p.prop, local), "Add keyframe")}
                      title="Add a keyframe here"
                      type="button"
                    >
                      <Diamond className={cn("h-3 w-3", onKey && "fill-current")} />
                    </button>
                    <button className="text-[#9a9a9a] hover:text-white" onClick={() => onJump(p.prop, 1)} title="Next keyframe" type="button">
                      <ChevronRight className="h-3 w-3" />
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      ) : null}
      {clip.type === "text" ? (
        <>
          <div className={cn(head, "mt-2")}>Text</div>
          <div className="space-y-1.5 px-3 py-2">
            <textarea
              className="h-16 w-full resize-none rounded border border-black/50 bg-[#1e1e1e] p-1.5 text-[12px]"
              onBlur={() => onCommit("Edit title")}
              onChange={(e) => onChange({ text: e.target.value })}
              value={clip.text ?? ""}
            />
            <div className="flex items-center gap-1.5">
              <select className="min-w-0 flex-1 rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => onChange({ font: e.target.value }, "Font")} value={clip.font ?? "Inter"}>
                {IMAGE_FONTS.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
              <NumberField label="" min={4} onChange={(size) => onChange({ size })} unit="px" value={clip.size ?? 96} />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1">
                Fill
                <input className="h-5 w-7 cursor-pointer rounded border border-black/50 bg-transparent" onBlur={() => onCommit("Text colour")} onChange={(e) => onChange({ color: e.target.value })} type="color" value={toSix(clip.color ?? "#ffffff")} />
              </label>
              <label className="flex items-center gap-1">
                <input checked={!!clip.bold} onChange={(e) => onChange({ bold: e.target.checked }, "Bold")} type="checkbox" /> Bold
              </label>
              <select className="rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => onChange({ align: e.target.value as VideoClip["align"] }, "Align")} value={clip.align ?? "center"}>
                <option value="left">Left</option>
                <option value="center">Centre</option>
                <option value="right">Right</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span>Background</span>
              <input
                className="h-5 w-7 cursor-pointer rounded border border-black/50 bg-transparent disabled:opacity-30"
                disabled={!clip.box || clip.box === "transparent"}
                onChange={(e) => onChange({ box: `${e.target.value}b3` }, "Title background")}
                type="color"
                value={toSix((clip.box ?? "#000000").slice(0, 7))}
              />
              <label className="flex items-center gap-1">
                <input
                  checked={!!clip.box && clip.box !== "transparent"}
                  onChange={(e) => onChange({ box: e.target.checked ? "#000000b3" : "transparent" }, "Title background")}
                  type="checkbox"
                />
                Show
              </label>
            </div>
          </div>
        </>
      ) : null}
      {clip.type === "color" ? (
        <>
          <div className={cn(head, "mt-2")}>Colour</div>
          <div className="px-3 py-2">
            <input className="h-6 w-10 cursor-pointer rounded border border-black/50 bg-transparent" onBlur={() => onCommit("Matte colour")} onChange={(e) => onChange({ fill: e.target.value })} type="color" value={toSix(clip.fill ?? "#000000")} />
          </div>
        </>
      ) : null}
      {visual ? (
        <>
          <div className={cn(head, "mt-2")}>Lumetri-style colour</div>
          {FX.map((f) => (
            <Slider
              key={f.key}
              label={f.label}
              max={f.max}
              min={f.min}
              onChange={(v) => onChange({ effects: { ...fx, [f.key]: v } })}
              onCommit={() => onCommit(f.label)}
              value={fx[f.key]}
            />
          ))}
        </>
      ) : null}
      <div className={cn(head, "mt-2")}>Transitions</div>
      <Slider label="Fade in" max={Math.min(5, clip.dur)} min={0} onChange={(fadeIn) => onChange({ fadeIn })} onCommit={() => onCommit("Fade in")} step={0.05} unit="s" value={clip.fadeIn ?? 0} />
      <Slider label="Fade out" max={Math.min(5, clip.dur)} min={0} onChange={(fadeOut) => onChange({ fadeOut })} onCommit={() => onCommit("Fade out")} step={0.05} unit="s" value={clip.fadeOut ?? 0} />
      {sound ? (
        <>
          <div className={cn(head, "mt-2")}>Audio</div>
          <Slider label="Volume" max={200} min={0} onChange={(v) => onChange({ volume: v / 100 })} onCommit={() => onCommit("Volume")} unit="%" value={Math.round((clip.volume ?? 1) * 100)} />
        </>
      ) : null}
      {clip.type === "media" && media ? (
        <p className="px-3 pt-2 text-[10px] text-[#777]" title={media.src}>
          Source: {media.name} · from {clip.in.toFixed(2)} s{media.duration ? ` of ${media.duration.toFixed(1)} s` : ""}
        </p>
      ) : null}
    </div>
  );
}

function SequenceDialog({
  width,
  height,
  fps,
  isNew,
  onOk,
  onCancel,
}: {
  width: number;
  height: number;
  fps: number;
  isNew: boolean;
  onOk: (w: number, h: number, fps: number) => void;
  onCancel: () => void;
}) {
  const [w, setW] = React.useState(width);
  const [h, setH] = React.useState(height);
  const [f, setF] = React.useState(fps);
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/55">
      <div className="w-[28rem] rounded-lg border border-black/60 bg-[#2f2f2f] p-4 text-[13px] shadow-2xl">
        <h3 className="mb-3 text-[15px] font-semibold text-white">{isNew ? "New sequence" : "Sequence settings"}</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {SEQ_PRESETS.map((p) => (
            <button
              className={cn(
                "rounded border px-2 py-2 text-left hover:bg-[#404040]",
                p.w === w && p.h === h ? "border-[#4aa3ff] bg-[#3a3a3a]" : "border-black/50 bg-[#3a3a3a]",
              )}
              key={p.label}
              onClick={() => {
                setW(p.w);
                setH(p.h);
              }}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <NumberField label="Width" max={7680} min={16} onChange={setW} unit="px" value={w} width="w-20" />
          <NumberField label="Height" max={7680} min={16} onChange={setH} unit="px" value={h} width="w-20" />
          <label className="flex items-center gap-1.5 text-[12px]">
            <span className="text-[#a8a8a8]">Frame rate</span>
            <select className="rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5" onChange={(e) => setF(Number(e.target.value))} value={f}>
              {[24, 25, 30, 50, 60].map((x) => (
                <option key={x} value={x}>
                  {x} fps
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded bg-[#3a3a3a] px-3 py-1 hover:bg-[#454545]" onClick={onCancel} type="button">
            {isNew ? "Keep 1080p" : "Cancel"}
          </button>
          <button
            className="rounded bg-[#2f6fd6] px-3 py-1 text-white hover:bg-[#3b7be0]"
            onClick={() => onOk(Math.max(16, Math.min(7680, Math.round(w))), Math.max(16, Math.min(7680, Math.round(h))), f)}
            type="button"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
