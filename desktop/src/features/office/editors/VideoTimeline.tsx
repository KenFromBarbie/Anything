import * as React from "react";
import { Eye, EyeOff, Lock, Magnet, MousePointer2, Scissors, Unlock, Volume2, VolumeX } from "lucide-react";

import { cn } from "@/shared/lib/cn";

import { ANIM_PROPS, timecode, type VideoClip, type VideoFile, type VideoTrack } from "./videoFormat";

export type TimelineTool = "select" | "razor";

const HEAD = 132; // track header width
const RULER = 26;
const ROW: Record<VideoTrack["kind"], number> = { video: 54, audio: 46 };

type Drag =
  | { mode: "move"; id: string; x0: number; start0: number; track0: string; moved: boolean }
  | { mode: "trimL" | "trimR"; id: string; x0: number; start0: number; dur0: number; in0: number }
  | { mode: "scrub" };

/**
 * The timeline: a time ruler with the playhead, video tracks (top = drawn
 * on top) then audio tracks, clips you drag, trim at their edges and cut with
 * the razor, snapping to the playhead and other clips' edges.
 */
export function VideoTimeline({
  project,
  time,
  pps,
  onPps,
  selected,
  onSelect,
  onChange,
  onCommit,
  onSeek,
  tool,
  onTool,
  snapping,
  onSnapping,
  onDropMedia,
  onSplit,
}: {
  project: VideoFile;
  time: number;
  pps: number;
  onPps: (v: number) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onChange: (p: VideoFile) => void;
  onCommit: (label: string) => void;
  onSeek: (t: number) => void;
  tool: TimelineTool;
  onTool: (t: TimelineTool) => void;
  snapping: boolean;
  onSnapping: (v: boolean) => void;
  onDropMedia: (mediaId: string, trackId: string, t: number) => void;
  onSplit: (clipId: string, t: number) => void;
}) {
  const scroller = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<Drag | null>(null);
  const projRef = React.useRef(project);
  projRef.current = project;
  const [hoverX, setHoverX] = React.useState<number | null>(null);

  const order = [
    ...project.tracks.filter((t) => t.kind === "video").reverse(),
    ...project.tracks.filter((t) => t.kind === "audio"),
  ];
  const end = project.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0);
  const width = Math.max(end + 30, 60) * pps;

  const timeAt = (clientX: number) => {
    const s = scroller.current;
    if (!s) return 0;
    const r = s.getBoundingClientRect();
    return Math.max(0, (clientX - r.left - HEAD + s.scrollLeft) / pps);
  };

  const snap = (t: number, ignore: string): number => {
    if (!snapping) return t;
    const tol = 8 / pps;
    const points = [0, time];
    for (const c of projRef.current.clips) {
      if (c.id === ignore) continue;
      points.push(c.start, c.start + c.dur);
    }
    let best = t;
    let d = tol;
    for (const p of points) {
      if (Math.abs(p - t) < d) {
        d = Math.abs(p - t);
        best = p;
      }
    }
    return best;
  };

  const mediaDur = (c: VideoClip) => {
    if (c.type !== "media") return Number.POSITIVE_INFINITY;
    const m = projRef.current.media.find((x) => x.id === c.media);
    return m?.kind === "image" ? Number.POSITIVE_INFINITY : (m?.duration ?? Number.POSITIVE_INFINITY);
  };

  const update = (id: string, patch: Partial<VideoClip>) => {
    const p = projRef.current;
    onChange({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "scrub") return onSeek(timeAt(e.clientX));
    const c = projRef.current.clips.find((x) => x.id === d.id);
    if (!c) return;
    const dt = (e.clientX - d.x0) / pps;
    const minDur = 1 / projRef.current.fps;
    if (d.mode === "move") {
      if (Math.abs(e.clientX - d.x0) > 2) d.moved = true;
      if (!d.moved) return;
      let start = Math.max(0, d.start0 + dt);
      // Snap whichever edge is closer to a snap point.
      const a = snap(start, c.id);
      const b = snap(start + c.dur, c.id) - c.dur;
      start = Math.abs(a - start) <= Math.abs(b - start) ? a : b;
      const lane = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-track]");
      const tr = projRef.current.tracks.find((t) => t.id === lane?.dataset.track);
      const cur = projRef.current.tracks.find((t) => t.id === c.track);
      const track = tr && !tr.locked && tr.kind === cur?.kind ? tr.id : c.track;
      update(c.id, { start: Math.max(0, start), track });
    } else if (d.mode === "trimL") {
      let start = snap(Math.max(0, d.start0 + dt), c.id);
      let delta = start - d.start0;
      if (c.type === "media") delta = Math.max(delta, -d.in0);
      delta = Math.min(delta, d.dur0 - minDur);
      start = d.start0 + delta;
      update(c.id, { start, dur: d.dur0 - delta, in: c.type === "media" ? d.in0 + delta : c.in });
    } else {
      const endT = snap(d.start0 + d.dur0 + dt, c.id);
      const dur = Math.min(Math.max(minDur, endT - d.start0), mediaDur(c) - d.in0);
      update(c.id, { dur });
    }
  };

  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (!d || d.mode === "scrub") return;
    if (d.mode === "move" && !d.moved) return;
    onCommit(d.mode === "move" ? "Move clip" : "Trim clip");
  };

  const begin = (d: Drag) => {
    drag.current = d;
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Ctrl + wheel zooms the timeline.
  React.useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.altKey) return;
      e.preventDefault();
      onPps(Math.min(600, Math.max(4, pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2))));
    };
    s.addEventListener("wheel", wheel, { passive: false });
    return () => s.removeEventListener("wheel", wheel);
  }, [pps, onPps]);

  // Keep the playhead in view while playing.
  React.useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const x = time * pps;
    if (x > s.scrollLeft + s.clientWidth - HEAD - 40) s.scrollLeft = x - 80;
    else if (x < s.scrollLeft) s.scrollLeft = Math.max(0, x - 80);
  }, [time, pps]);

  const steps = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find((s) => s * pps >= 70) ?? 600;
  const ticks: number[] = [];
  for (let t = 0; t * pps <= width; t += step) ticks.push(t);

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-black/60 bg-[#232323]">
      {/* timeline toolbar */}
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-black/60 bg-[#2b2b2b] px-2 text-[11px]">
        <span className="mr-2 font-mono text-[13px] text-[#4aa3ff]">{timecode(time, project.fps)}</span>
        <ToolBtn active={tool === "select"} label="Selection (V)" onClick={() => onTool("select")}>
          <MousePointer2 className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn active={tool === "razor"} label="Razor (C)" onClick={() => onTool("razor")}>
          <Scissors className="h-3.5 w-3.5" />
        </ToolBtn>
        <ToolBtn active={snapping} label="Snap (S)" onClick={() => onSnapping(!snapping)}>
          <Magnet className="h-3.5 w-3.5" />
        </ToolBtn>
        <span className="flex-1" />
        <span className="text-[#8a8a8a]">Zoom</span>
        <input
          aria-label="Timeline zoom"
          className="w-28 accent-[#4aa3ff]"
          max={Math.log(600)}
          min={Math.log(4)}
          onChange={(e) => onPps(Math.exp(Number(e.target.value)))}
          step={0.01}
          type="range"
          value={Math.log(pps)}
        />
      </div>
      <div className="relative min-h-0 flex-1 overflow-auto" ref={scroller}>
        <div style={{ width: width + HEAD, minHeight: "100%" }}>
          {/* ruler */}
          <div className="sticky top-0 z-20 flex" style={{ height: RULER }}>
            <div className="sticky left-0 z-30 shrink-0 border-b border-r border-black/60 bg-[#2b2b2b]" style={{ width: HEAD }} />
            <div
              className="relative flex-1 cursor-pointer border-b border-black/60 bg-[#2b2b2b]"
              onPointerDown={(e) => {
                onSeek(timeAt(e.clientX));
                begin({ mode: "scrub" });
              }}
            >
              {ticks.map((t) => (
                <div className="absolute bottom-0 top-2 border-l border-white/20" key={t} style={{ left: t * pps }}>
                  <span className="absolute left-1 top-0 whitespace-nowrap text-[10px] text-[#9a9a9a]">
                    {formatTick(t, step, project.fps)}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {/* tracks */}
          {order.map((tr, i) => {
            const firstAudio = tr.kind === "audio" && order[i - 1]?.kind === "video";
            return (
              <div className={cn("flex", firstAudio && "border-t-2 border-black/70")} key={tr.id} style={{ height: ROW[tr.kind] }}>
                <TrackHeader
                  onChange={(patch) => {
                    const p = projRef.current;
                    onChange({ ...p, tracks: p.tracks.map((t) => (t.id === tr.id ? { ...t, ...patch } : t)) });
                    onCommit("Track");
                  }}
                  track={tr}
                />
                <div
                  className={cn(
                    "relative flex-1 border-b border-black/50",
                    tr.kind === "video" ? "bg-[#262626]" : "bg-[#242826]",
                    tr.locked && "bg-[repeating-linear-gradient(45deg,#262626_0_6px,#2c2c2c_6px_12px)]",
                  )}
                  data-track={tr.id}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData("application/x-video-media");
                    if (id && !tr.locked) onDropMedia(id, tr.id, snap(timeAt(e.clientX), ""));
                  }}
                  onPointerDown={(e) => {
                    if (e.target === e.currentTarget) {
                      onSelect(null);
                      onSeek(timeAt(e.clientX));
                    }
                  }}
                  onPointerLeave={() => setHoverX(null)}
                  onPointerMove={(e) => tool === "razor" && setHoverX(timeAt(e.clientX))}
                >
                  {project.clips
                    .filter((c) => c.track === tr.id)
                    .map((c) => (
                      <ClipBox
                        clip={c}
                        key={c.id}
                        locked={!!tr.locked}
                        media={project.media.find((m) => m.id === c.media)}
                        onPointerDown={(e, edge) => {
                          e.stopPropagation();
                          if (tr.locked) return;
                          onSelect(c.id);
                          if (tool === "razor") {
                            onSplit(c.id, snap(timeAt(e.clientX), c.id));
                            return;
                          }
                          if (edge === "l") begin({ mode: "trimL", id: c.id, x0: e.clientX, start0: c.start, dur0: c.dur, in0: c.in });
                          else if (edge === "r") begin({ mode: "trimR", id: c.id, x0: e.clientX, start0: c.start, dur0: c.dur, in0: c.in });
                          else begin({ mode: "move", id: c.id, x0: e.clientX, start0: c.start, track0: c.track, moved: false });
                        }}
                        pps={pps}
                        razor={tool === "razor"}
                        selected={selected === c.id}
                      />
                    ))}
                </div>
              </div>
            );
          })}
        </div>
        {/* playhead */}
        <div
          className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-[#4aa3ff]"
          style={{ left: HEAD + time * pps, height: "100%" }}
        >
          <div className="sticky top-0 -ml-[6px] h-3 w-[13px] bg-[#4aa3ff] [clip-path:polygon(0_0,100%_0,100%_55%,50%_100%,0_55%)]" />
        </div>
        {hoverX != null && tool === "razor" ? (
          <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-px bg-red-400/80" style={{ left: HEAD + hoverX * pps }} />
        ) : null}
      </div>
    </div>
  );
}

function formatTick(t: number, step: number, fps: number) {
  if (step < 1) return timecode(t, fps).slice(3);
  const m = Math.floor(t / 60);
  const s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ToolBtn({ active, label, onClick, children }: { active: boolean; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={cn("flex h-6 w-6 items-center justify-center rounded", active ? "bg-[#4a4a4a] text-white" : "text-[#bdbdbd] hover:bg-[#3a3a3a]")}
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

function TrackHeader({ track, onChange }: { track: VideoTrack; onChange: (p: Partial<VideoTrack>) => void }) {
  const btn = "flex h-5 w-5 items-center justify-center rounded text-[#bdbdbd] hover:bg-[#3d3d3d]";
  return (
    <div
      className="sticky left-0 z-10 flex shrink-0 items-center gap-1 border-b border-r border-black/60 bg-[#2b2b2b] px-2 text-[11px]"
      style={{ width: HEAD }}
    >
      <span className="w-6 font-semibold text-[#d4d4d4]">{track.name}</span>
      {track.kind === "video" ? (
        <button className={btn} onClick={() => onChange({ hidden: !track.hidden })} title={track.hidden ? "Show track" : "Hide track"} type="button">
          {track.hidden ? <EyeOff className="h-3 w-3 opacity-60" /> : <Eye className="h-3 w-3" />}
        </button>
      ) : null}
      <button className={btn} onClick={() => onChange({ muted: !track.muted })} title={track.muted ? "Unmute" : "Mute"} type="button">
        {track.muted ? <VolumeX className="h-3 w-3 text-red-400" /> : <Volume2 className="h-3 w-3" />}
      </button>
      <button className={btn} onClick={() => onChange({ locked: !track.locked })} title={track.locked ? "Unlock track" : "Lock track"} type="button">
        {track.locked ? <Lock className="h-3 w-3 text-amber-400" /> : <Unlock className="h-3 w-3 opacity-50" />}
      </button>
    </div>
  );
}

const TONE: Record<string, string> = {
  video: "bg-[#3b6aa8] border-[#5b8ad0]",
  image: "bg-[#2f7d7a] border-[#4aa5a1]",
  audio: "bg-[#3d7a45] border-[#5aa564]",
  text: "bg-[#7a4aa3] border-[#9b6ccb]",
  color: "bg-[#6b6b6b] border-[#8d8d8d]",
};

function ClipBox({
  clip,
  media,
  pps,
  selected,
  locked,
  razor,
  onPointerDown,
}: {
  clip: VideoClip;
  media?: VideoFile["media"][number];
  pps: number;
  selected: boolean;
  locked: boolean;
  razor: boolean;
  onPointerDown: (e: React.PointerEvent, edge: "l" | "r" | null) => void;
}) {
  const tone = clip.type === "media" ? (media?.kind ?? "video") : clip.type;
  const name = clip.name || (clip.type === "text" ? (clip.text ?? "Title").split("\n")[0] : clip.type === "color" ? "Color Matte" : (media?.name ?? "Media"));
  const keys = new Set<number>();
  for (const p of ANIM_PROPS) for (const k of clip.anim?.[p] ?? []) keys.add(k.t);
  return (
    <div
      className={cn(
        "absolute bottom-[3px] top-[3px] overflow-hidden rounded-[3px] border text-[10px] text-white",
        TONE[tone],
        selected && "outline outline-2 outline-white",
        razor ? "cursor-[crosshair]" : locked ? "cursor-not-allowed" : "cursor-grab",
      )}
      onPointerDown={(e) => onPointerDown(e, null)}
      style={{ left: clip.start * pps, width: Math.max(2, clip.dur * pps) }}
      title={name}
    >
      {media?.thumb && tone !== "audio" ? (
        <div
          className="absolute inset-0 opacity-35"
          style={{ backgroundImage: `url(${media.thumb})`, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }}
        />
      ) : null}
      {tone === "audio" || (tone === "video" && clip.volume !== 0) ? (
        <div className="absolute inset-x-0 bottom-0 h-1/2 opacity-30 [background:repeating-linear-gradient(90deg,transparent_0_2px,#d6ffd9_2px_3px)] [mask-image:linear-gradient(to_top,black,transparent)]" />
      ) : null}
      <div className="relative truncate px-1.5 pt-0.5 font-medium drop-shadow">{name}</div>
      {clip.fadeIn ? (
        <div className="absolute left-0 top-0 h-full bg-gradient-to-r from-black/50 to-transparent" style={{ width: clip.fadeIn * pps }} />
      ) : null}
      {clip.fadeOut ? (
        <div className="absolute right-0 top-0 h-full bg-gradient-to-l from-black/50 to-transparent" style={{ width: clip.fadeOut * pps }} />
      ) : null}
      {[...keys].map((t) => (
        <span className="absolute bottom-0.5 h-2 w-2 -translate-x-1 rotate-45 border border-black/60 bg-[#ffd75e]" key={t} style={{ left: t * pps }} />
      ))}
      {!razor && !locked ? (
        <>
          <div className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/40" onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, "l"); }} />
          <div className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/40" onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, "r"); }} />
        </>
      ) : null}
    </div>
  );
}
