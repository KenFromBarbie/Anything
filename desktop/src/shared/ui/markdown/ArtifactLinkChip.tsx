import { Package } from "lucide-react";

import { artifactLink, openDeskPanel } from "@/shared/lib/deskPanel";

/**
 * A `buzz://artifact/<id>` link in chat: something an Office agent made.
 * Opens it in the channel's side panel (or the Research → Artifacts tab).
 */
export function ArtifactLinkChip({ id, label }: { id: string; label: string }) {
  const text = label && label !== artifactLink(id) ? label : "Open artifact";
  return (
    <button
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border/70 bg-muted/50 px-2 py-0.5 align-baseline text-sm font-medium text-foreground transition-colors hover:bg-muted"
      data-artifact-id={id}
      data-testid="artifact-link"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openDeskPanel({ kind: "artifact", id });
      }}
      type="button"
    >
      <Package className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{text}</span>
    </button>
  );
}
