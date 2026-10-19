import * as React from "react";

/**
 * Where the Office should appear: the element the Office tab renders under its
 * tab bar. OfficeHost (mounted once in AppShell) pins itself over this element
 * while it's on screen, so the office frame never moves in the DOM.
 */

let anchor: HTMLElement | null = null;
const subscribers = new Set<() => void>();

/** Callback ref for the element the Office should cover. */
export function setOfficeAnchor(element: HTMLElement | null): void {
  if (element === anchor) return;
  anchor = element;
  for (const notify of subscribers) notify();
}

export function useOfficeAnchor(): HTMLElement | null {
  return React.useSyncExternalStore(
    (notify) => {
      subscribers.add(notify);
      return () => subscribers.delete(notify);
    },
    () => anchor,
    () => null,
  );
}

// The Office page shows the floor across the whole window (lined up with the
// background floor behind the app), cut away under the app's title bar and
// sidebar; the Agents page shows it in its section only.
let fullWindow = false;
const fullWindowSubscribers = new Set<() => void>();

export function setOfficeFullWindow(value: boolean): void {
  if (value === fullWindow) return;
  fullWindow = value;
  for (const notify of fullWindowSubscribers) notify();
}

export function useOfficeFullWindow(): boolean {
  return React.useSyncExternalStore(
    (notify) => {
      fullWindowSubscribers.add(notify);
      return () => fullWindowSubscribers.delete(notify);
    },
    () => fullWindow,
    () => false,
  );
}
