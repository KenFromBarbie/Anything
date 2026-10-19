import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { Download, Loader2 } from "lucide-react";

import {
  formatMb,
  useStudioActions,
  useStudioProgress,
  useStudioStatus,
} from "@/features/studio/lib/studioInstall";
import { useStudioTheme } from "@/features/studio/lib/studioTheme";
import { Button } from "@/shared/ui/button";
import { PageHeader } from "@/shared/ui/PageHeader";

import { StudioToolPicker } from "./StudioToolPicker";

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
 * The Studio page: the Studio itself once it's installed, or the choice of
 * tools and an Install button before that.
 */
export function StudioScreen() {
  const { data: status, isLoading } = useStudioStatus();
  if (!isTauri()) {
    return (
      <StudioPage>
        <p className="text-sm text-muted-foreground">
          The Studio needs the Kenn’s Harness desktop app.
        </p>
      </StudioPage>
    );
  }
  if (isLoading || !status) {
    return (
      <StudioPage>
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Checking the Studio…
        </p>
      </StudioPage>
    );
  }
  if (!status.installed) {
    return (
      <StudioPage>
        <StudioInstallCard initialTools={status.tools} />
      </StudioPage>
    );
  }
  return <StudioView />;
}

function StudioPage({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 py-6 sm:px-6"
      data-testid="studio-page"
    >
      <PageHeader
        description="Local creative tools: edit images, build 3D scenes, cut video."
        title="Studio"
      />
      {children}
    </div>
  );
}

/** Choosing tools and installing the Studio from GitHub. */
export function StudioInstallCard({
  initialTools,
}: {
  initialTools: string[];
}) {
  const [tools, setTools] = React.useState(initialTools);
  const { install } = useStudioActions();
  const progress = useStudioProgress();
  return (
    <section
      className="grid max-w-3xl gap-4 rounded-2xl border border-border/70 bg-card/40 p-5"
      data-testid="studio-install"
    >
      <div className="grid gap-1">
        <h2 className="text-base font-semibold">Install the Studio</h2>
        <p className="text-sm text-muted-foreground">
          The Studio is optional and isn't included in the app. Pick the tools
          you want; they download together (about 45 MB) from this version's
          release on GitHub, and only the ones you pick appear. You can change
          them, or remove the Studio, in Settings → Studio.
        </p>
      </div>
      <StudioToolPicker
        disabled={install.isPending}
        onChange={setTools}
        value={tools}
      />
      {install.error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {String(install.error)}
        </p>
      ) : null}
      <div className="flex items-center gap-3">
        <Button
          data-testid="studio-install-button"
          disabled={tools.length === 0 || install.isPending}
          onClick={() => install.mutate(tools)}
        >
          {install.isPending ? (
            <Loader2 className="animate-spin" />
          ) : (
            <Download />
          )}
          {install.isPending ? "Installing…" : "Install the Studio"}
        </Button>
        {install.isPending && progress ? (
          <span className="text-sm text-muted-foreground">
            {progress.phase === "installing"
              ? "Unpacking…"
              : progress.total
                ? `${formatMb(progress.received)} of ${formatMb(progress.total)}`
                : formatMb(progress.received)}
          </span>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The installed Studio: ArtCraft. ArtCraft's interface is a native view
 * inside Buzz's window (see `studio.rs`), not part of this page's DOM; this page
 * reserves the area and keeps the view laid over it. The view is created the
 * first time the page shows and hidden, not destroyed, when you leave, so
 * ArtCraft keeps its state.
 */
function StudioView() {
  useStudioTheme();
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
        description="Local creative tools: edit images, build 3D scenes, cut video."
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
