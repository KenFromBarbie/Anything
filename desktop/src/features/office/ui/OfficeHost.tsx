import * as React from "react";

import { useOfficeAnchor } from "@/features/office/lib/officeAnchor";
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
  const live = active && anchor !== null;
  const [opened, setOpened] = React.useState(live || openedThisSession);
  const [placement, setPlacement] = React.useState<Placement | null>(null);

  React.useEffect(() => {
    if (live) {
      openedThisSession = true;
      setOpened(true);
    }
  }, [live]);

  React.useEffect(() => {
    const notify = () => setOpened(true);
    startListeners.add(notify);
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
  }, [active, anchor]);

  if (!opened) return null;
  return (
    <div
      aria-hidden={!placement}
      className={
        placement
          ? "fixed z-10 overflow-hidden"
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
