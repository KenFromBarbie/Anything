import * as React from "react";
import { Globe } from "lucide-react";

import {
  type DeskPanel,
  toggleBrowserPanel,
  useDeskPanel,
} from "@/shared/lib/deskPanel";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

const BrowserPage = React.lazy(async () => ({
  default: (await import("./BrowserPage")).BrowserPage,
}));
const ArtifactPanel = React.lazy(async () => ({
  default: (await import("./ArtifactsPage")).ArtifactPanel,
}));

/** A channel's right-hand panel: the Browser, or an artifact from chat. */
export function DeskSidePanel({ panel }: { panel: DeskPanel }) {
  return (
    <div
      className="flex h-full min-h-0 flex-col p-3"
      data-testid={`desk-side-panel-${panel.kind}`}
    >
      <React.Suspense fallback={null}>
        {panel.kind === "browser" ? (
          <BrowserPage embedded />
        ) : (
          <ArtifactPanel id={panel.id} key={panel.id} />
        )}
      </React.Suspense>
    </div>
  );
}

export function deskPanelTitle(panel: DeskPanel): string {
  return panel.kind === "browser" ? "Browser" : "Artifact";
}

/** The channel header's button that opens the Browser beside the chat. */
export function BrowserPanelButton() {
  const panel = useDeskPanel();
  const open = panel?.kind === "browser";
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <Button
          aria-label={open ? "Close the Browser" : "Open the Browser"}
          aria-pressed={open}
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          data-testid="channel-browser-toggle"
          onClick={toggleBrowserPanel}
          size="icon"
          variant={open ? "secondary" : "ghost"}
        >
          <Globe className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Browser</TooltipContent>
    </Tooltip>
  );
}
