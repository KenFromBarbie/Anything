import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowLeft, ArrowRight, Globe, RotateCw } from "lucide-react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";

type Placement = {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
};

export type BrowserEvent = {
  op: "open" | "loaded";
  url: string;
  agent?: string;
};

/** The Browser's page events (a page loaded, or an agent opened one). */
export const BROWSER_EVENT = "agent-browser";

/**
 * The Browser: a real web view inside the app where you, and the Office's
 * agents (`buzz-browse`), open pages. Like the Studio, the view itself is a
 * native view laid over this page's area (see `office_desk.rs`); it's hidden,
 * not closed, when you leave, so the page stays where it was.
 */
export function BrowserPage({
  embedded = false,
}: {
  /** Inside another page or a channel's side panel: no header of its own. */
  embedded?: boolean;
}) {
  const areaRef = React.useRef<HTMLDivElement>(null);
  const [address, setAddress] = React.useState("");
  const [title, setTitle] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [lastAgent, setLastAgent] = React.useState<string | null>(null);

  const refresh = React.useCallback(() => {
    void invoke<{ url: string; title: string }>("browser_state").then(
      (s) => {
        setAddress(s.url);
        setTitle(s.title);
      },
      () => {},
    );
  }, []);

  React.useEffect(() => {
    if (!isTauri()) return;
    refresh();
    const off = listen<BrowserEvent>(BROWSER_EVENT, (e) => {
      if (e.payload.agent) setLastAgent(e.payload.agent);
      setAddress(e.payload.url);
      refresh();
    });
    return () => void off.then((f) => f());
  }, [refresh]);

  React.useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area || !isTauri()) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const r = area.getBoundingClientRect();
        const placement: Placement = {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          visible: r.width > 0 && r.height > 0,
        };
        invoke("browser_place", placement).then(
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
      void invoke("browser_place", {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        visible: false,
      });
    };
  }, []);

  const go = (action: "back" | "forward" | "reload") =>
    void invoke("browser_go", { action }).then(
      () => setTimeout(refresh, 800),
      (e) => setError(String(e)),
    );

  const navigate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!address.trim()) return;
    setLastAgent(null);
    invoke<string>("browser_navigate", { url: address }).then(
      (url) => {
        setAddress(url);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        embedded ? "gap-2" : "gap-4 px-4 py-6 sm:px-6",
      )}
      data-testid="browser-page"
    >
      {embedded ? null : (
        <PageHeader
          description="Web pages inside the app. Agents open sites here for you to see, and read them back to check their work."
          title="Browser"
        />
      )}
      <form
        className="flex items-center gap-1.5"
        data-testid="browser-toolbar"
        onSubmit={navigate}
      >
        <Button
          aria-label="Back"
          onClick={() => go("back")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          aria-label="Forward"
          onClick={() => go("forward")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <ArrowRight className="h-4 w-4" />
        </Button>
        <Button
          aria-label="Reload"
          onClick={() => go("reload")}
          size="icon"
          type="button"
          variant="ghost"
        >
          <RotateCw className="h-4 w-4" />
        </Button>
        <div className="relative flex-1">
          <Globe className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            aria-label="Address"
            className="pl-9"
            data-testid="browser-address"
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Type an address, e.g. example.com"
            value={address}
          />
        </div>
        <Button type="submit">Go</Button>
      </form>
      {lastAgent || title ? (
        <p className="-mt-2 truncate text-xs text-muted-foreground">
          {lastAgent ? `Opened by ${lastAgent}` : null}
          {lastAgent && title ? " · " : null}
          {title}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div
        className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-muted/20"
        data-testid="browser-area"
        ref={areaRef}
      >
        {!isTauri() ? (
          <p className="p-4 text-sm text-muted-foreground">
            The Browser needs the Anything desktop app.
          </p>
        ) : null}
      </div>
    </div>
  );
}
