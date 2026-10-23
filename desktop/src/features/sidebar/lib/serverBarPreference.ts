import * as React from "react";

/**
 * Where the server bar (the column of servers at the far left) sits.
 *
 * - `pinned` — always shown, as a column on the left.
 * - `hover` — tucked away; it slides out over the app while the pointer is
 *   at the window's left edge, and hides again when it leaves.
 * - `top` — a horizontal row of servers along the top bar.
 *
 * Persisted in localStorage: a device-level layout choice, like the thread
 * layout, not community data.
 */
export type ServerBarMode = "pinned" | "hover" | "top";

const STORAGE_KEY = "anything.sidebar.serverBarMode";
const DEFAULT_MODE: ServerBarMode = "pinned";

const listeners = new Set<() => void>();

function parse(value: string | null | undefined): ServerBarMode {
  return value === "hover" || value === "top" || value === "pinned"
    ? value
    : DEFAULT_MODE;
}

function readStored(): ServerBarMode {
  try {
    return parse(globalThis.localStorage?.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_MODE;
  }
}

let mode = readStored();

export function getServerBarMode(): ServerBarMode {
  return mode;
}

export function setServerBarMode(next: ServerBarMode): void {
  if (next === mode) return;
  mode = next;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, next);
  } catch {
    // Storage off: the choice holds for this session only.
  }
  for (const listener of listeners) listener();
}

export function useServerBarMode(): ServerBarMode {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => mode,
    () => DEFAULT_MODE,
  );
}
