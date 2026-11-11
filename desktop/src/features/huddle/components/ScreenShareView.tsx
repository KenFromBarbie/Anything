import * as React from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, MonitorOff } from "lucide-react";

import { cn } from "@/shared/lib/cn";

import { stopScreenShare, useScreenShare } from "../lib/screenShare";

function useElapsed(since: number | null): string {
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    if (!since) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [since]);
  if (!since) return "";
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * What's being shared, live, while sharing: a small window in the corner
 * (drag it anywhere) or big over the app. Shows that agents can see it.
 */
export function ScreenShareView() {
  const share = useScreenShare();
  const ref = React.useRef<HTMLVideoElement>(null);
  const [big, setBig] = React.useState(false);
  const [pos, setPos] = React.useState<{ x: number; y: number } | null>(null);
  const elapsed = useElapsed(share.startedAt);

  React.useEffect(() => {
    if (ref.current && ref.current.srcObject !== share.stream) {
      ref.current.srcObject = share.stream;
      if (share.stream) void ref.current.play().catch(() => undefined);
    }
  }, [share.stream, big]);

  if (!share.stream) return null;

  const drag = (e: React.PointerEvent) => {
    if (big || (e.target as HTMLElement).closest("button")) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const dx = e.clientX - box.left;
    const dy = e.clientY - box.top;
    const move = (ev: PointerEvent) =>
      setPos({
        x: Math.min(window.innerWidth - box.width, Math.max(0, ev.clientX - dx)),
        y: Math.min(window.innerHeight - box.height, Math.max(0, ev.clientY - dy)),
      });
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const view = (
    <div
      className={cn(
        "fixed z-[70] flex flex-col overflow-hidden rounded-xl border border-black/40 bg-[#111214] text-white shadow-2xl",
        big ? "inset-6" : "w-[380px] cursor-grab active:cursor-grabbing",
      )}
      data-testid="screen-share-view"
      onPointerDown={drag}
      style={big ? undefined : pos ? { left: pos.x, top: pos.y } : { right: 20, bottom: 96 }}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <span className="rounded bg-[#ed4245] px-1.5 py-0.5 text-[10px] font-bold tracking-wide">LIVE</span>
        <span className="font-medium">Sharing your screen</span>
        <span className="tabular-nums text-[#3ba55d]">{elapsed}</span>
        <span className="flex-1" />
        <button
          aria-label={big ? "Smaller" : "Bigger"}
          className="flex h-6 w-6 items-center justify-center rounded hover:bg-white/10"
          onClick={() => setBig((v) => !v)}
          type="button"
        >
          {big ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
        </button>
      </div>
      <video className={cn("w-full bg-black object-contain", big ? "min-h-0 flex-1" : "aspect-video")} muted playsInline ref={ref} />
      <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-white/70">
        <span className="min-w-0 flex-1 truncate">
          {share.error
            ? `Couldn't save a snapshot for the agents: ${share.error}`
            : share.frames
              ? `Agents in the call can see it · ${share.frames} snapshot${share.frames === 1 ? "" : "s"}`
              : "Getting the first snapshot…"}
        </span>
        <button
          className="flex items-center gap-1.5 rounded-md bg-[#ed4245] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#d83c3e]"
          onClick={() => void stopScreenShare()}
          type="button"
        >
          <MonitorOff className="h-3.5 w-3.5" /> Stop sharing
        </button>
      </div>
    </div>
  );
  return createPortal(view, document.body);
}
