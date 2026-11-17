import * as React from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";

import { useOfficeAgents } from "@/features/office/lib/officeLink";
import { type EditorFile, type EditorKind, parseFile } from "./formats";

/**
 * Following a file while an agent works on it, like a shared document: the
 * open editor takes each new version in place and shows the agent's cursor
 * (a flag with their name, in their colour) on what they changed.
 *
 * Agents don't type into the editor; they write the file. So the "cursor" is
 * where the new version differs from the one on screen.
 */

export type Follower = { name: string; color: string };

export type FollowState = {
  /** The newest version from disk (null until it changes after opening). */
  file: EditorFile | null;
  /** Counts versions, so editors react once per change. */
  version: number;
  /** Who wrote it, from the Office's presence (or null). */
  by: Follower | null;
};

export const EditorFollowContext = React.createContext<FollowState>({ file: null, version: 0, by: null });

const base = (p: string) => p.split(String.fromCharCode(92)).join("/").split("/").pop()?.toLowerCase() ?? "";
const PALETTE = ["#e8590c", "#1c7ed6", "#2f9e44", "#ae3ec9", "#f08c00", "#0ca678", "#d6336c", "#5f3dc4"];

function colorOf(name: string, accent?: string): string {
  if (accent?.startsWith("#")) return accent;
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/** The agent who last wrote or edited this file (presence steps name it). */
function useWriterOf(path: string | undefined): Follower | null {
  const { agents } = useOfficeAgents();
  return React.useMemo(() => {
    if (!path) return null;
    const name = base(path);
    let best: { at: number; who: Follower } | null = null;
    for (const a of agents) {
      const p = a.presence;
      if (!p) continue;
      for (const s of p.steps) {
        const t = s.text.toLowerCase();
        if ((t.startsWith("edited ") || t.startsWith("wrote ") || t.startsWith("made ")) && t.endsWith(` ${name}`)) {
          if (!best || s.ts > best.at) best = { at: s.ts, who: { name: a.name, color: colorOf(a.name, a.accent) } };
        }
      }
      const shownOnly = !!(p.latest as { fromRead?: boolean } | null)?.fromRead;
      if (p.latest && !shownOnly && base(p.latest.path) === name && (!best || p.latest.mtime > best.at)) {
        best = { at: p.latest.mtime, who: { name: a.name, color: colorOf(a.name, a.accent) } };
      }
    }
    return best?.who ?? null;
  }, [agents, path]);
}

/** Watch `path` (every 1.5 s) and hand over each new version as it lands. */
export function useFileFollow(path: string | undefined, kind: EditorKind | null): FollowState {
  const [state, setState] = React.useState<{ file: EditorFile | null; version: number }>({ file: null, version: 0 });
  const by = useWriterOf(path);
  React.useEffect(() => {
    if (!path || !kind) return;
    let alive = true;
    let last: number | null = null;
    const tick = async () => {
      try {
        const r = await invoke<{ mtime: number }>("office_live_file", { path });
        if (last === null) {
          last = r.mtime;
          return;
        }
        if (r.mtime === last) return;
        last = r.mtime;
        const json = await (await fetch(`${convertFileSrc(path)}?v=${r.mtime}`)).json();
        if (alive) setState((s) => ({ file: parseFile(kind, json), version: s.version + 1 }));
      } catch {
        /* not there (yet), or half-written: next tick */
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [path, kind]);
  return { ...state, by };
}

/**
 * Put an agent's cursor flag on an element for a few seconds: an outline in
 * their colour with their name above it, drawn as its own layer over the
 * element (editors like the document's redraw their own DOM, which would
 * strip anything set on it), following it while you scroll.
 */
export function markForAgent(el: Element | null | undefined, who: Follower | null, ms = 6000): void {
  if (!el || !(el instanceof HTMLElement)) return;
  const name = who?.name ?? "An agent";
  const color = who?.color ?? "#1c7ed6";
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const box = document.createElement("div");
  box.setAttribute("data-agent-mark", name);
  box.className = "agent-mark-layer";
  box.style.setProperty("--agent-color", color);
  Object.assign(box.style, { position: "fixed", pointerEvents: "none", zIndex: "80", borderRadius: "2px" });
  document.body.appendChild(box);
  const end = Date.now() + ms;
  const place = () => {
    if (!el.isConnected || Date.now() > end) {
      box.remove();
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    requestAnimationFrame(place);
  };
  place();
}

/** Flag the element `selector` finds, waiting up to ~1.5 s for it to be drawn
 *  (a clip or layer just added appears a moment after the change lands);
 *  falls back to `fallback`. */
export function markSoon(selector: string | null, who: Follower | null, fallback?: string): void {
  let tries = 0;
  const attempt = () => {
    const el = selector ? document.querySelector(selector) : null;
    if (el && (el as HTMLElement).getBoundingClientRect().width > 0) {
      markForAgent(el, who);
      return;
    }
    if (++tries < 15) {
      setTimeout(attempt, 100);
      return;
    }
    markForAgent(fallback ? document.querySelector(fallback) : el, who);
  };
  requestAnimationFrame(attempt);
}

/** Which entries of two lists differ (by id), for marking what changed. */
export function changedIds<T extends { id: string }>(before: T[], after: T[]): string[] {
  const old = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
  const changed = after.filter((x) => old.get(x.id) !== JSON.stringify(x));
  // New entries first: a part just added is what they're working on.
  return [...changed.filter((x) => !old.has(x.id)), ...changed.filter((x) => old.has(x.id))].map((x) => x.id);
}
