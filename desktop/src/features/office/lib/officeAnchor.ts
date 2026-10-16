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
