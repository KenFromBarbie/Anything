import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { Copy, Minus, Square, X } from "lucide-react";

import { invokeTauri } from "@/shared/api/tauri";
import { cn } from "@/shared/lib/cn";

const isWindows =
  typeof navigator !== "undefined" && /^win/i.test(navigator.platform);

const control = (action: "minimize" | "maximize" | "close" | "state") =>
  invokeTauri<boolean>("window_control", { action });

const BUTTON =
  "flex h-[36px] w-[46px] items-center justify-center text-sidebar-foreground/70 transition-colors hover:text-sidebar-foreground [&_svg]:size-[15px]";

/**
 * Minimize, maximize and close, drawn by the app on Windows (the native
 * title bar is off, see `title_bar.rs`): top right, over the drag band.
 */
export function WindowControls() {
  const [maximized, setMaximized] = React.useState(false);

  React.useEffect(() => {
    if (!isWindows || !isTauri()) return;
    const sync = () => void control("state").then(setMaximized, () => {});
    // Once the resize settles, not on every event of a drag.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(sync, 150);
    };
    sync();
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  if (!isWindows || !isTauri()) return null;

  const run = (action: "minimize" | "maximize" | "close") =>
    void control(action).then(setMaximized, () => {});

  return (
    <div
      className="fixed right-0 top-0 z-[200] flex select-none"
      data-testid="window-controls"
    >
      <button
        aria-label="Minimize"
        className={cn(BUTTON, "hover:bg-sidebar-foreground/10")}
        onClick={() => run("minimize")}
        type="button"
      >
        <Minus />
      </button>
      <button
        aria-label={maximized ? "Restore" : "Maximize"}
        className={cn(BUTTON, "hover:bg-sidebar-foreground/10")}
        onClick={() => run("maximize")}
        type="button"
      >
        {maximized ? (
          <Copy className="-scale-x-100 !size-[13px]" />
        ) : (
          <Square className="!size-[13px]" />
        )}
      </button>
      <button
        aria-label="Close"
        className={cn(BUTTON, "hover:bg-[#c42b1c] hover:text-white")}
        onClick={() => run("close")}
        type="button"
      >
        <X />
      </button>
    </div>
  );
}
