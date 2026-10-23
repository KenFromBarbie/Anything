import * as React from "react";

import { cn } from "@/shared/lib/cn";

/**
 * The server bar tucked away (Settings → Appearance → Server bar: on hover).
 * A thin strip at the window's left edge, below the top bar, slides the bar
 * out over the app; it hides again shortly after the pointer leaves, unless a
 * menu or dialog opened from it is still up.
 */
export function HoverServerBar({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const hideTimer = React.useRef<number | null>(null);

  const cancelHide = React.useCallback(() => {
    if (hideTimer.current !== null) {
      window.clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const show = React.useCallback(() => {
    cancelHide();
    setOpen(true);
  }, [cancelHide]);
  const scheduleHide = React.useCallback(() => {
    cancelHide();
    hideTimer.current = window.setTimeout(() => {
      // A context menu or dialog opened from a server keeps the bar out.
      const portalOpen = document.querySelector(
        '[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"]',
      );
      if (portalOpen) {
        scheduleHide();
        return;
      }
      setOpen(false);
    }, 300);
  }, [cancelHide]);

  React.useEffect(() => cancelHide, [cancelHide]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only reveal edge; keyboard users reach the bar's buttons by focus (onFocusCapture below) */}
      <div
        aria-hidden
        className="fixed bottom-0 left-0 top-(--buzz-top-chrome-height,40px) z-50 w-2"
        data-testid="server-bar-hover-edge"
        onMouseEnter={show}
      />
      {/* biome-ignore lint/a11y/noStaticElementInteractions: hover keeps the bar out; its controls are the buttons inside */}
      <div
        className={cn(
          "fixed bottom-0 left-0 top-(--buzz-top-chrome-height,40px) z-50 flex transition-transform duration-200 ease-out motion-reduce:transition-none",
          open
            ? "translate-x-0 shadow-xl"
            : "pointer-events-none -translate-x-full",
        )}
        data-open={open}
        data-testid="server-bar-hover-panel"
        onFocusCapture={show}
        onMouseEnter={show}
        onMouseLeave={scheduleHide}
      >
        {children}
      </div>
    </>
  );
}
