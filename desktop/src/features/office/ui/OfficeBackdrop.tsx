import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { useOfficeBackdrop } from "@/features/office/lib/officeBackdrop";
import { useOfficeStage } from "@/features/office/lib/officeAnchor";
import {
  emitFloorAgent,
  openFloorTasks,
  setFloorChannel,
} from "@/features/office/lib/officeFloorEvents";
import { setMirrorTarget } from "@/features/office/lib/officeMirror";
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
export function OfficeBackdrop() {
  const { enabled, strength } = useOfficeBackdrop();
  const [conn, setConn] = React.useState<Connection | null>(null);
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const stage = useStageRect(useOfficeStage());

  // The mirror needs the main Office running (it copies its state).
  React.useEffect(() => {
    if (!enabled || !isTauri()) return;
    startOffice();
    let cancelled = false;
    invoke<Connection>("office_connect").then(
      (c) => {
        if (!cancelled) setConn(c);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [enabled]);

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
  const hash = new URLSearchParams({
    sidecarUrl: conn.url,
    sidecarToken: conn.token,
    view: "office",
    role: "mirror",
  }).toString();
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
        data-office-backdrop-frame
      >
        <iframe
          className="h-full w-full border-0"
          ref={frameRef}
          src={`${OFFICE_APP_URL}#${hash}`}
          tabIndex={-1}
          title="Office background"
        />
      </div>
      {stage ? <FloorClickLayer frame={frameRef} rect={stage} /> : null}
      {/* The app's own background, faded by the chosen strength, over the
          floor: the whole window shows the floor evenly. */}
      <div
        aria-hidden
        className="office-backdrop-wash pointer-events-none fixed inset-0 -z-[5]"
        style={{ opacity: 1 - strength / 100 }}
      />
    </>
  );
}

type StageRect = { left: number; top: number; width: number; height: number };

/**
 * On the Office page the floor takes clicks: a see-through layer over the
 * page's area passes them into the floor (the floor itself stays where it is,
 * drawn whole behind the app, so nothing moves or reappears).
 */
function FloorClickLayer({
  frame,
  rect,
}: {
  frame: React.RefObject<HTMLIFrameElement | null>;
  rect: StageRect;
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
      className="fixed z-10"
      data-testid="office-floor-clicks"
      onPointerDown={(event) => send(event, "pointerdown")}
      onPointerMove={(event) => send(event, "pointermove")}
      onPointerUp={(event) => send(event, "pointerup")}
      style={rect}
    />
  );
}

function useStageRect(stage: HTMLElement | null): StageRect | null {
  const [rect, setRect] = React.useState<StageRect | null>(null);
  React.useLayoutEffect(() => {
    if (!stage) {
      setRect(null);
      return;
    }
    const update = () => {
      const box = stage.getBoundingClientRect();
      setRect({
        left: box.left,
        top: box.top,
        width: box.width,
        height: box.height,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [stage]);
  return rect;
}
