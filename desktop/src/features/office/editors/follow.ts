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
      if (p.latest && base(p.latest.path) === name && (!best || p.latest.mtime > best.at)) {
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
 * their colour and their name above it (see `[data-agent-mark]` in the
 * editors' CSS), scrolled into view.
 */
export function markForAgent(el: Element | null | undefined, who: Follower | null, ms = 6000): void {
  if (!el || !(el instanceof HTMLElement)) return;
  const name = who?.name ?? "An agent";
  el.setAttribute("data-agent-mark", name);
  el.style.setProperty("--agent-color", who?.color ?? "#1c7ed6");
  el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const prev = (el as HTMLElement & { __agentMark?: number }).__agentMark;
  if (prev) clearTimeout(prev);
  (el as HTMLElement & { __agentMark?: number }).__agentMark = window.setTimeout(() => {
    el.removeAttribute("data-agent-mark");
  }, ms);
}

/** Which entries of two lists differ (by id), for marking what changed. */
export function changedIds<T extends { id: string }>(before: T[], after: T[]): string[] {
  const old = new Map(before.map((x) => [x.id, JSON.stringify(x)]));
  return after.filter((x) => old.get(x.id) !== JSON.stringify(x)).map((x) => x.id);
}
