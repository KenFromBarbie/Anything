import * as React from "react";

/**
 * What a channel shows in its right-hand panel besides threads: the app's
 * Browser, or one of the Office agents' artifacts. Chat links
 * (`buzz://artifact/<id>`) and the channel header open it; the channel
 * screen draws it (see ChannelRouteScreen).
 */
export type DeskPanel = { kind: "browser" } | { kind: "artifact"; id: string };

let current: DeskPanel | null = null;
const listeners = new Set<() => void>();
let hosts = 0;
/** Where an artifact opens when no channel is on screen (the Research tab). */
let fallback: ((panel: DeskPanel) => void) | null = null;

function emit() {
  for (const listener of listeners) listener();
}

export function openDeskPanel(panel: DeskPanel): void {
  if (hosts === 0 && fallback) {
    fallback(panel);
    return;
  }
  current = panel;
  emit();
}

export function getDeskPanel(): DeskPanel | null {
  return current;
}

export function closeDeskPanel(): void {
  if (!current) return;
  current = null;
  emit();
}

export function toggleBrowserPanel(): void {
  if (current?.kind === "browser") closeDeskPanel();
  else openDeskPanel({ kind: "browser" });
}

export function setDeskPanelFallback(
  handler: ((panel: DeskPanel) => void) | null,
): void {
  fallback = handler;
}

/** The panel to draw, for a screen that can draw it (counted while mounted). */
export function useDeskPanelHost(): DeskPanel | null {
  React.useEffect(() => {
    hosts += 1;
    return () => {
      hosts -= 1;
    };
  }, []);
  return useDeskPanel();
}

export function useDeskPanel(): DeskPanel | null {
  return React.useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}

const ARTIFACT_LINK_RE = /^buzz:\/\/artifact\/([A-Za-z0-9-]{4,64})\/?$/;

/** The artifact id in a `buzz://artifact/<id>` link, or null. */
export function parseArtifactLink(href: string | undefined): string | null {
  return href ? (ARTIFACT_LINK_RE.exec(href.trim())?.[1] ?? null) : null;
}

export function artifactLink(id: string): string {
  return `buzz://artifact/${id}`;
}
