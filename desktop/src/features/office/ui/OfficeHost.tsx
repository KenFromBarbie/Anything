import * as React from "react";

import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import {
  callOffice,
  resetOfficeSession,
} from "@/features/office/lib/officeLink";
import { clearMirrorSnapshot } from "@/features/office/lib/officeMirror";
import {
  useOfficeAnchor,
  useOfficeFullWindow,
} from "@/features/office/lib/officeAnchor";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const OfficeScreen = React.lazy(async () => {
  const module = await import("@/features/office/ui/OfficeScreen");
  return { default: module.OfficeScreen };
});

/** Survives AppShell remounts (e.g. switching communities) within a session. */
let openedThisSession = false;
const startListeners = new Set<() => void>();

/**
 * Start the Office without showing it: pages that show its data in Buzz's own
 * UI (Tasks) and the Notion sync need it running. It stays parked off-screen
 * until a page pins it.
 */
export function startOffice(): void {
  if (openedThisSession) return;
  openedThisSession = true;
  for (const notify of startListeners) notify();
}

type Placement = {
  left: number;
  top: number;
  width: number;
  height: number;
  /** clip-path keeping only the part inside the scroll area. */
  clip: string;
  radius: string;
};

/** Nearest ancestor that scrolls vertically: the page the anchor sits in. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * Keeps the Office running once it has been opened. The office UI runs the
 * hive's delivery loop (it wakes an idle Michael when a Buzz message lands in
 * his inbox), so it must keep running while the user is elsewhere in Buzz,
 * including Settings, which replaces the whole content area.
 *
 * So it is mounted once, outside that area, and never moves in the DOM (moving
 * an iframe reloads it). When the Agents page's Office section is on screen it
 * is pinned over that section's embed area, following scroll and clipped to the
 * visible part of the page; otherwise it sits off-screen at a real size rather
 * than display:none, so its timers and canvas keep working, and
 * visibility:hidden keeps it out of the tab order and the accessibility tree.
 */
export function OfficeHost({ active }: { active: boolean }) {
  const anchor = useOfficeAnchor();
  const fullWindow = useOfficeFullWindow();
  const live = active && anchor !== null;
  // On the Office page the frame fades in over the background floor it lines
  // up with, so the background seems to come forward.
  const [shown, setShown] = React.useState(!fullWindow);
  React.useEffect(() => {
    if (!fullWindow) {
      setShown(true);
      return;
    }
    setShown(false);
    const timer = setTimeout(() => setShown(true), 260);
    return () => clearTimeout(timer);
  }, [fullWindow]);
  const [opened, setOpened] = React.useState(live || openedThisSession);
  const [placement, setPlacement] = React.useState<Placement | null>(null);

  React.useEffect(() => {
    if (live) {
      openedThisSession = true;
      setOpened(true);
    }
  }, [live]);

  // Unmounted only when the app shell is (switching community): that
  // community's Office replaces this one, so forget this one's state.
  React.useEffect(
    () => () => {
      resetOfficeSession();
      clearMirrorSnapshot();
    },
    [],
  );

  // An AI account switched (Settings → AI accounts, or the usage guard):
  // agents read their account only when they start, so this Office restarts
  // that engine's agents onto it (busy ones once they're between steps).
  React.useEffect(() => {
    let stop: (() => void) | undefined;
    let gone = false;
    void listen<string>("ai-account-switched", (event) => {
      if (!openedThisSession) return; // not started: agents start on the new one
      void callOffice<{ restarted: number; waiting: number }>(
        "agents.accountChanged",
        { engine: event.payload },
      )
        .then(({ restarted, waiting }) => {
          if (restarted + waiting === 0) return;
          toast(
            waiting
              ? `Switching ${restarted + waiting} agents to the new account (${waiting} when they finish their current step).`
              : `Restarted ${restarted} agents on the new account.`,
          );
        })
        .catch((error) =>
          toast.error(
            `Couldn't move the agents to the new account: ${error instanceof Error ? error.message : String(error)}. Restart them from the Agents page.`,
          ),
        );
    }).then((unlisten) => {
      if (gone) unlisten();
      else stop = unlisten;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  React.useEffect(() => {
    const notify = () => setOpened(true);
    startListeners.add(notify);
    // A start asked for before this listener existed (e.g. by the background).
    if (openedThisSession) setOpened(true);
    return () => {
      startListeners.delete(notify);
    };
  }, []);

  React.useLayoutEffect(() => {
    if (!active || !anchor) {
      setPlacement(null);
      return;
    }
    const scroller = scrollParent(anchor);
    const update = () => {
      const a = anchor.getBoundingClientRect();
      if (fullWindow) {
        setPlacement({
          left: 0,
          top: 0,
          width: window.innerWidth,
          height: window.innerHeight,
          clip: `inset(${Math.max(0, a.top)}px 0 0 ${Math.max(0, a.left)}px)`,
          radius: "0",
        });
        return;
      }
      const view = scroller?.getBoundingClientRect() ?? {
        top: 0,
        left: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };
      const top = Math.max(0, view.top - a.top);
      const bottom = Math.max(0, a.bottom - view.bottom);
      const left = Math.max(0, view.left - a.left);
      const right = Math.max(0, a.right - view.right);
      // Scrolled fully out of view: park it like when inactive.
      if (top + bottom >= a.height || left + right >= a.width) {
        setPlacement(null);
        return;
      }
      setPlacement({
        left: a.left,
        top: a.top,
        width: a.width,
        height: a.height,
        clip: `inset(${top}px ${right}px ${bottom}px ${left}px)`,
        radius: getComputedStyle(anchor).borderTopLeftRadius,
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(anchor);
    if (scroller) observer.observe(scroller);
    // Capture phase: scroll doesn't bubble, and the page scrolls in a div.
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", update, true);
      window.removeEventListener("resize", update);
    };
  }, [active, anchor, fullWindow]);

  if (!opened) return null;
  return (
    <div
      aria-hidden={!placement}
      className={
        placement
          ? `fixed z-10 overflow-hidden transition-opacity duration-500 ease-out ${shown ? "opacity-100" : "opacity-0"}`
          : "pointer-events-none invisible fixed -left-[10000px] top-0 h-[800px] w-[1280px]"
      }
      data-testid="office-host"
      style={
        placement
          ? {
              left: placement.left,
              top: placement.top,
              width: placement.width,
              height: placement.height,
              clipPath: placement.clip,
              borderRadius: placement.radius,
            }
          : undefined
      }
    >
      <React.Suspense
        fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
      >
        <OfficeScreen />
      </React.Suspense>
    </div>
  );
}
