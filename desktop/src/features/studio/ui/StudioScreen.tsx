import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

import { PageHeader } from "@/shared/ui/PageHeader";

type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

function place(placement: Placement) {
  return invoke("studio_place", placement);
}

/**
 * The Studio: ArtCraft, built into Buzz. ArtCraft's interface is a native view
 * inside Buzz's window (see `studio.rs`), not part of this page's DOM; this page
 * reserves the area and keeps the view laid over it. The view is created the
 * first time the page shows and hidden, not destroyed, when you leave, so
 * ArtCraft keeps its state.
 */
export function StudioScreen() {
  const areaRef = React.useRef<HTMLDivElement>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    if (!isTauri()) {
      setError("The Studio needs the Kenn’s Harness desktop app.");
      return;
    }
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = area.getBoundingClientRect();
        place({
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          visible: r.width > 0 && r.height > 0,
        }).then(
          () => setError(null),
          (e) => setError(String(e)),
        );
      });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(area);
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", update);
      void place({ x: 0, y: 0, width: 0, height: 0, visible: false });
    };
  }, []);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 px-4 py-6 sm:px-6"
      data-testid="studio-page"
    >
      <PageHeader
        description="Create images, video and 3D scenes with ArtCraft."
        title="Studio"
      />
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-muted/20"
        data-testid="studio-area"
        ref={areaRef}
      >
        {error ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <h2 className="text-lg font-semibold">The Studio didn't open</h2>
            <p className="mt-2 max-w-md break-words text-sm text-muted-foreground">
              {error}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
