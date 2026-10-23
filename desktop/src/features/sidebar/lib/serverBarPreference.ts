import * as React from "react";

/**
 * How the server bar (your servers) is shown: where it sits, and whether it
 * hides until hovered. Two separate choices in Settings → Appearance.
 *
 * - `position: "left"` — a column at the window's left; `"top"` — a row in
 *   the top bar.
 * - `autoHide` — tucked away until the pointer reaches it: the left edge for
 *   the column, the top bar for the row.
 *
 * Persisted in localStorage: a device-level layout choice, like the thread
 * layout, not community data.
 */
export type ServerBarPosition = "left" | "top";
export type ServerBarPrefs = { position: ServerBarPosition; autoHide: boolean };

const STORAGE_KEY = "anything.sidebar.serverBar";
/** The single setting this replaced ("pinned" | "hover" | "top"). */
const LEGACY_KEY = "anything.sidebar.serverBarMode";
const DEFAULT: ServerBarPrefs = { position: "left", autoHide: false };

const listeners = new Set<() => void>();

function readStored(): ServerBarPrefs {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ServerBarPrefs>;
      return {
        position: parsed.position === "top" ? "top" : "left",
        autoHide: parsed.autoHide === true,
      };
    }
    const legacy = globalThis.localStorage?.getItem(LEGACY_KEY);
    if (legacy === "hover") return { position: "left", autoHide: true };
    if (legacy === "top") return { position: "top", autoHide: false };
  } catch {
    // Storage off or unreadable: the default.
  }
  return DEFAULT;
}

let prefs = readStored();

export function getServerBarPrefs(): ServerBarPrefs {
  return prefs;
}

export function setServerBarPrefs(change: Partial<ServerBarPrefs>): void {
  const next = { ...prefs, ...change };
  if (next.position === prefs.position && next.autoHide === prefs.autoHide) {
    return;
  }
  prefs = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    globalThis.localStorage?.removeItem(LEGACY_KEY);
  } catch {
    // Storage off: the choice holds for this session only.
  }
  for (const listener of listeners) listener();
}

export function useServerBarPrefs(): ServerBarPrefs {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => prefs,
    () => DEFAULT,
  );
}
