import { openExportFiles } from "@/features/files/ui/ExportFilesDialog";
import { openCustomizeOffice } from "@/features/office/ui/CustomizeOfficeDialog";
import * as React from "react";
import { createPortal } from "react-dom";

import { useOfficeThemeSync } from "@/features/office/lib/officeThemeSync";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { openMeetingDialog } from "@/features/office/lib/meetingRoom";
import { openDeskAgent } from "@/features/office/ui/DeskAgentDialog";
import {
  useOfficeBackdrop,
  useOfficeBackdropSuppressed,
} from "@/features/office/lib/officeBackdrop";
import { useOfficeStage } from "@/features/office/lib/officeAnchor";
import {
  emitFloorAgent,
  openFloorTasks,
  setFloorChannel,
} from "@/features/office/lib/officeFloorEvents";
import { setMirrorTarget } from "@/features/office/lib/officeMirror";
import { PausedAgentsBanner } from "@/features/office/ui/PausedAgentsBanner";
import { startOffice } from "@/features/office/ui/OfficeHost";
import { hostTheme } from "@/features/office/ui/OfficeScreen";

const OFFICE_APP_URL = "/office-app/index.html";

type Connection = { url: string; token: string };

/**
 * The live Office floor behind the whole window (Settings → Appearance).
 *
 * It is its own frame, separate from the main Office frame the Office and
 * Agents pages use, so switching pages never moves, resizes or redraws it. It
 * runs the Office's draw-only "mirror" mode: the floor, with its state copied
 * from the main frame (see officeMirror), and none of the Office's own work.
 * Click-through, under a wash of the app's background; the page panel is
 * see-through to match, all faded by the chosen strength.
 */
export function OfficeBackdrop({ community }: { community?: string }) {
  const { enabled: chosen, strength } = useOfficeBackdrop();
  const suppressed = useOfficeBackdropSuppressed();
  // Mounted once for the whole app (not per server): switching servers keeps
  // this floor, and the new server's agents walk in while the others walk out.
  // In a call room it is only hidden, so it doesn't load again afterwards.
  const enabled = chosen;
  const [conn, setConn] = React.useState<Connection | null>(null);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const firstHash = React.useRef<string | null>(null);
  useOfficeThemeSync(frameRef);
  const stageEl = useOfficeStage();

  // The mirror needs the main Office running (it copies its state). It reads
  // the board and the mail from an Office too, so on a server switch it moves
  // to that server's Office: the same frame, a new connection (no reload).
  React.useEffect(() => {
    if (!enabled || !isTauri()) return;
    startOffice();
    let cancelled = false;
    invoke<Connection>("office_connect").then(
      (c) => {
        if (cancelled) return;
        setConn((prev) => {
          if (prev && prev.url !== c.url) {
            const win = frameRef.current?.contentWindow as
              | (Window & {
                  __mdReconnect?: (url: string, token: string) => void;
                })
              | null
              | undefined;
            try {
              win?.__mdReconnect?.(c.url, c.token);
            } catch {
              // Not loaded yet: it reads the new details when it starts.
            }
            // Keep the frame (its src stays the first one, so React doesn't
            // reload it); only the live connection moved. Remember the new
            // one so the next switch compares against it.
            return c;
          }
          return prev ?? c;
        });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, community]);

  // While it's on, the page panel lets it show through.
  React.useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      root.removeAttribute("data-office-backdrop");
      return;
    }
    root.setAttribute("data-office-backdrop", "");
    root.style.setProperty(
      "--office-backdrop-wash",
      String(1 - strength / 100),
    );
    return () => root.removeAttribute("data-office-backdrop");
  }, [enabled, strength]);

  // The mirror says when it's listening; then it gets the theme and the state.
  React.useEffect(() => {
    if (!enabled) return;
    const sendTheme = () =>
      frameRef.current?.contentWindow?.postMessage(
        {
          source: "buzz-office-host",
          type: "theme",
          theme: hostTheme(document.documentElement),
        },
        window.location.origin,
      );
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      if (event.data?.source !== "buzz-office") return;
      const msg = event.data;
      if (msg.type === "mirror-ready") {
        sendTheme();
        setMirrorTarget(frame.contentWindow);
        return;
      }
      // On the Office page this floor is the Office: clicks on characters,
      // where they stand, and the task board come from here.
      if (msg.type === "agent-click" || msg.type === "agent-anchor") {
        const box = frame.getBoundingClientRect();
        const at =
          typeof msg.at?.x === "number" && typeof msg.at?.y === "number"
            ? { x: box.left + msg.at.x, y: box.top + msg.at.y }
            : null;
        emitFloorAgent({
          kind: msg.type === "agent-click" ? "click" : "anchor",
          id: String(msg.id),
          at,
        });
        return;
      }
      if (msg.type === "navigate" && msg.page === "tasks") openFloorTasks();
      if (msg.type === "navigate" && msg.page === "meeting")
        openMeetingDialog();
      if (msg.type === "desk-click") {
        openDeskAgent(typeof msg.id === "string" ? msg.id : null);
      }
      if (msg.type === "prop-click" && msg.prop === "printer") openExportFiles();
      if (msg.type === "prop-click" && msg.prop === "ceo-desk") openCustomizeOffice();
      if (msg.type === "navigate" && msg.page === "settings") {
        window.location.hash = "#/settings?section=ai-accounts";
      }
    }
    const post = (message: Record<string, unknown>) =>
      frameRef.current?.contentWindow?.postMessage(
        { source: "buzz-office-host", ...message },
        window.location.origin,
      );
    setFloorChannel("mirror", {
      locate: (id) => post({ type: "locate-agent", id }),
      track: (id) => post({ type: "track-agent", id }),
    });
    window.addEventListener("message", onMessage);
    const observer = new MutationObserver(sendTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-buzz-sidebar"],
    });
    return () => {
      window.removeEventListener("message", onMessage);
      observer.disconnect();
      setMirrorTarget(null);
      setFloorChannel("mirror", null);
    };
  }, [enabled]);

  if (!enabled || !conn) return null;
  // The frame's address stays the first one: changing it would reload the
  // floor. Later servers' Offices reach it through __mdReconnect.
  firstHash.current ??= mirrorHash(conn);
  const hash = firstHash.current;
  return (
    <>
      <PausedAgentsBanner />
      <div
        aria-hidden
        className="office-backdrop-layer pointer-events-none fixed inset-0 z-0 overflow-hidden"
        data-office-backdrop-frame
        style={suppressed ? { visibility: "hidden" } : undefined}
      >
        <iframe
          className="h-full w-full border-0"
          ref={frameRef}
          src={`${OFFICE_APP_URL}#${hash}`}
          tabIndex={-1}
          title="Office background"
        />
      </div>
      {/* Clicks on the Office page reach the floor through a layer inside the
          page's floor area (the floor itself lives outside the app, under it). */}
      {stageEl && !suppressed
        ? createPortal(<FloorClickLayer frame={frameRef} />, stageEl)
        : null}
      {/* The app's own background, faded by the chosen strength, over the
          floor: the whole window shows the floor evenly. */}
      <div
        aria-hidden
        className="office-backdrop-layer office-backdrop-wash pointer-events-none fixed inset-0 z-0"
        style={{
          opacity: 1 - strength / 100,
          ...(suppressed ? { visibility: "hidden" as const } : {}),
        }}
      />
    </>
  );
}

function mirrorHash(conn: Connection): string {
  return new URLSearchParams({
    sidecarUrl: conn.url,
    sidecarToken: conn.token,
    view: "office",
    role: "mirror",
  }).toString();
}

/**
 * On the Office page the floor takes clicks: a see-through layer over the
 * page's area passes them into the floor (the floor itself stays where it is,
 * drawn whole behind the app, so nothing moves or reappears).
 */
function FloorClickLayer({
  frame,
}: {
  frame: React.RefObject<HTMLIFrameElement | null>;
}) {
  const send = (event: React.PointerEvent, type: string) => {
    frame.current?.contentWindow?.postMessage(
      {
        source: "buzz-office-host",
        type: "pointer",
        event: type,
        x: event.clientX,
        y: event.clientY,
        button: event.button,
        buttons: event.buttons,
      },
      window.location.origin,
    );
  };
  return (
    <div
      className="absolute inset-0 z-[1]"
      data-testid="office-floor-clicks"
      onPointerDown={(event) => send(event, "pointerdown")}
      onPointerMove={(event) => send(event, "pointermove")}
      onPointerUp={(event) => send(event, "pointerup")}
      onWheel={(event) =>
        frame.current?.contentWindow?.postMessage(
          { source: "buzz-office-host", type: "wheel", x: event.clientX, y: event.clientY, deltaX: event.deltaX, deltaY: event.deltaY },
          window.location.origin,
        )
      }
    />
  );
}
