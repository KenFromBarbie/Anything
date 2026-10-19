import * as React from "react";

/**
 * The Office floor as the app's background: the live floor drawn behind the
 * main content panel, which turns see-through by `strength` so the floor
 * shows faintly. View-only — clicks always go to the app. Per-device
 * preference, kept in localStorage.
 */
export type OfficeBackdrop = { enabled: boolean; strength: number };

export const BACKDROP_STRENGTH_MIN = 5;
export const BACKDROP_STRENGTH_MAX = 60;
export const DEFAULT_BACKDROP_STRENGTH = 18;

const STORAGE_KEY = "kenns-harness.office-backdrop";
const DEFAULT: OfficeBackdrop = {
  enabled: true,
  strength: DEFAULT_BACKDROP_STRENGTH,
};

function clamp(value: number): number {
  return Math.min(
    BACKDROP_STRENGTH_MAX,
    Math.max(BACKDROP_STRENGTH_MIN, Math.round(value)),
  );
}

function read(): OfficeBackdrop {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<OfficeBackdrop>;
    return {
      enabled:
        typeof parsed.enabled === "boolean" ? parsed.enabled : DEFAULT.enabled,
      strength:
        typeof parsed.strength === "number"
          ? clamp(parsed.strength)
          : DEFAULT.strength,
    };
  } catch {
    return DEFAULT;
  }
}

let current: OfficeBackdrop = typeof window === "undefined" ? DEFAULT : read();
const subscribers = new Set<() => void>();

export function getOfficeBackdrop(): OfficeBackdrop {
  return current;
}

export function setOfficeBackdrop(patch: Partial<OfficeBackdrop>): void {
  current = {
    enabled: patch.enabled ?? current.enabled,
    strength:
      patch.strength === undefined ? current.strength : clamp(patch.strength),
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Private mode or full storage: the choice lasts for this session.
  }
  for (const notify of subscribers) notify();
}

function subscribe(notify: () => void): () => void {
  subscribers.add(notify);
  return () => subscribers.delete(notify);
}

export function useOfficeBackdrop(): OfficeBackdrop {
  return React.useSyncExternalStore(subscribe, getOfficeBackdrop);
}

/** Before going to the Office page: fade the page out while the background
 *  floor comes forward (the Office page takes over from here, see
 *  OfficeFloorPage). */
export function pullOfficeForward(): Promise<void> {
  const root = document.documentElement;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return Promise.resolve();
  }
  root.setAttribute("data-office-entering", "");
  // If the navigation doesn't happen after all, put the page back.
  setTimeout(() => {
    if (!root.hasAttribute("data-office-focus")) {
      root.removeAttribute("data-office-entering");
    }
  }, 1500);
  return new Promise((resolve) => setTimeout(resolve, 280));
}
