import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { managedAgentsQueryKey } from "@/features/agents/hooks";
import { useOfficeAnchor } from "@/features/office/lib/officeAnchor";
import {
  emitFloorAgent,
  openFloorTasks,
  setFloorLocator,
} from "@/features/office/lib/officeFloorEvents";
import {
  relayToMirror,
  setMirrorSource,
} from "@/features/office/lib/officeMirror";
import { runOfficeHostCall } from "@/features/office/lib/officeHostCalls";
import {
  connectOffice,
  setOfficeAgentsState,
  setOfficeOverlay,
  setOfficePanelState,
  settleOfficeCall,
} from "@/features/office/lib/officeLink";
import {
  getOfficeView,
  subscribeOfficeView,
} from "@/features/office/lib/officeView";

type OfficeConnection = { url: string; token: string };

type OfficeState =
  | { status: "starting" }
  | { status: "ready"; conn: OfficeConnection }
  | { status: "error"; message: string };

/** Built Munder Difflin UI (src/sidecar-web in the office runtime), copied to
 *  desktop/public/office-app by `just office-web`. */
const OFFICE_APP_URL = "/office-app/index.html";

/**
 * Buzz's theme where the Office sits, for the Office to adopt (its tokens map
 * onto these). Read from the page around the Office so the content surface's
 * own overrides (Buzz Dark's warmer canvas) are included.
 */
export function hostTheme(context: Element) {
  const css = getComputedStyle(context);
  const token = (name: string) => {
    const value = css.getPropertyValue(name).trim();
    return value ? `hsl(${value})` : "";
  };
  const surface = context.closest("[data-buzz-content-surface]");
  const surfaceFill = surface ? getComputedStyle(surface).backgroundColor : "";
  const painted =
    surfaceFill &&
    surfaceFill !== "transparent" &&
    surfaceFill !== "rgba(0, 0, 0, 0)";
  return {
    dark: document.documentElement.classList.contains("dark"),
    fontFamily: getComputedStyle(document.body).fontFamily,
    colors: {
      background: painted ? surfaceFill : token("--background"),
      foreground: token("--foreground"),
      card: token("--card"),
      muted: token("--muted"),
      mutedForeground: token("--muted-foreground"),
      border: token("--border"),
      primary: token("--primary"),
      primaryForeground: token("--primary-foreground"),
    },
  };
}

/**
 * The Office: Munder Difflin's agent floor, hosted in an isolated iframe and
 * backed by the office sidecar the Tauri side starts on first open. The iframe
 * talks to the sidecar directly over its loopback socket; it only comes back
 * to this window for native capabilities (file pickers, links, notifications).
 */
export function OfficeScreen() {
  const [state, setState] = React.useState<OfficeState>({ status: "starting" });
  const frameRef = React.useRef<HTMLIFrameElement>(null);
  const queryClient = useQueryClient();
  const anchor = useOfficeAnchor();
  const disconnectRef = React.useRef<(() => void) | null>(null);

  const postToOffice = React.useCallback((message: Record<string, unknown>) => {
    frameRef.current?.contentWindow?.postMessage(
      { source: "buzz-office-host", ...message },
      window.location.origin,
    );
  }, []);
  const sendView = React.useCallback(
    () => postToOffice({ type: "view", view: getOfficeView() }),
    [postToOffice],
  );
  const sendTheme = React.useCallback(() => {
    postToOffice({
      type: "theme",
      theme: hostTheme(anchor ?? document.documentElement),
    });
  }, [anchor, postToOffice]);

  const start = React.useCallback(() => {
    setState({ status: "starting" });
    if (!isTauri()) {
      setState({
        status: "error",
        message: "The Office needs the Anything desktop app.",
      });
      return;
    }
    invoke<OfficeConnection>("office_connect").then(
      (conn) => {
        setState({ status: "ready", conn });
        // Starting the office can create Michael's agent record and marks it
        // deployed; refresh the Agents page's list.
        void queryClient.invalidateQueries({ queryKey: managedAgentsQueryKey });
      },
      (error) => setState({ status: "error", message: String(error) }),
    );
  }, [queryClient]);

  React.useEffect(start, [start]);

  React.useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      if (event.origin !== window.location.origin) return;
      const msg = event.data;
      if (msg?.source !== "buzz-office") return;
      if (msg.type === "host-ready") {
        sendView();
        sendTheme();
        // Pages' commands (sections, Add agent) flow from here on, starting
        // with any queued while the Office loaded.
        disconnectRef.current?.();
        disconnectRef.current = connectOffice((command) =>
          postToOffice(command),
        );
        postToOffice({ type: "panel-state-request" });
        postToOffice({ type: "state-request" });
        setOfficeOverlay(false);
        return;
      }
      if (msg.type === "mirror") {
        relayToMirror(msg.snapshot);
        return;
      }
      if (msg.type === "api-result") {
        settleOfficeCall(msg);
        return;
      }
      if (msg.type === "state") {
        setOfficeAgentsState(msg);
        return;
      }
      if (msg.type === "overlay") {
        setOfficeOverlay(msg.open === true);
        return;
      }
      if (msg.type === "panel-state") {
        setOfficePanelState({
          tabs: Array.isArray(msg.tabs) ? msg.tabs : [],
          tab: typeof msg.tab === "string" ? msg.tab : null,
          agentName: typeof msg.agentName === "string" ? msg.agentName : null,
        });
        return;
      }
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
      if (msg.type === "navigate") {
        if (msg.page === "tasks" && openFloorTasks()) return;
        const to = { tasks: "#/tasks", askme: "#/" }[String(msg.page)];
        if (to) window.location.hash = to;
        return;
      }
      if (msg.type === "roster-changed") {
        // The office reports the floor to Buzz (which creates or marks the
        // agents' identities) on its own poll; refresh once that has run.
        for (const delay of [2000, 8000]) {
          setTimeout(() => {
            void queryClient.invalidateQueries({
              queryKey: managedAgentsQueryKey,
            });
          }, delay);
        }
        return;
      }
      if (msg.type !== "host-call") return;
      const reply = (body: Record<string, unknown>) =>
        frame.contentWindow?.postMessage(
          {
            source: "buzz-office-host",
            type: "host-result",
            id: msg.id,
            ...body,
          },
          window.location.origin,
        );
      runOfficeHostCall(
        String(msg.op),
        Array.isArray(msg.args) ? msg.args : [],
      ).then(
        (value) => reply({ ok: true, value }),
        (error) =>
          reply({
            ok: false,
            error: { message: String(error?.message ?? error) },
          }),
      );
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [postToOffice, queryClient, sendTheme, sendView]);

  // No commands to a frame that is gone.
  React.useEffect(() => () => disconnectRef.current?.(), []);

  // The Office page asks where an agent stands (to put a chat above them).
  React.useEffect(() => {
    setFloorLocator((id) => postToOffice({ type: "locate-agent", id }));
    return () => setFloorLocator(null);
  }, [postToOffice]);

  // The background mirror asks this frame for the floor's state.
  React.useEffect(() => {
    setMirrorSource(() => postToOffice({ type: "mirror-request" }));
    return () => setMirrorSource(null);
  }, [postToOffice]);

  // The Agents and Office pages pick which part of the Office shows.
  React.useEffect(() => subscribeOfficeView(sendView), [sendView]);

  // Follow Buzz's theme: it lives in classes and attributes on <html>.
  React.useEffect(() => {
    sendTheme();
    const observer = new MutationObserver(() => sendTheme());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-buzz-sidebar"],
    });
    return () => observer.disconnect();
  }, [sendTheme]);

  if (state.status === "starting") {
    return (
      <OfficeMessage
        title="Opening the office…"
        detail="Starting Michael and the floor."
      />
    );
  }
  if (state.status === "error") {
    return (
      <OfficeMessage title="The office didn't start" detail={state.message}>
        <button
          className="mt-4 rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
          onClick={start}
          type="button"
        >
          Try again
        </button>
      </OfficeMessage>
    );
  }

  const hash = new URLSearchParams({
    sidecarUrl: state.conn.url,
    sidecarToken: state.conn.token,
    view: getOfficeView(),
  }).toString();
  return (
    <iframe
      className="h-full w-full border-0"
      data-testid="office-frame"
      ref={frameRef}
      src={`${OFFICE_APP_URL}#${hash}`}
      title="Office"
      allow="clipboard-read; clipboard-write; microphone"
    />
  );
}

function OfficeMessage({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-2 max-w-md break-words text-sm text-muted-foreground">
        {detail}
      </p>
      {children}
    </div>
  );
}
