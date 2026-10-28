import * as React from "react";

import { openDeskPanel } from "@/shared/lib/deskPanel";

const ArtifactPanel = React.lazy(async () => ({
  default: (await import("@/features/office/ui/ArtifactsPage")).ArtifactPanel,
}));

/**
 * A `buzz://artifact/<id>` link in chat (something an Office agent made):
 * the artifact itself, shown right in the message. Its expand button opens it
 * larger in the channel's side pane. A span: the link sits inside a
 * paragraph or list item.
 */
export function ArtifactLinkChip({ id }: { id: string; label: string }) {
  return (
    <span
      className="my-2 block h-[26rem] w-full max-w-2xl overflow-hidden rounded-xl border border-border/70 bg-background/60 align-top"
      data-artifact-id={id}
      data-testid="artifact-embed"
    >
      <React.Suspense fallback={null}>
        <ArtifactPanel
          id={id}
          onExpand={() => openDeskPanel({ kind: "artifact", id })}
        />
      </React.Suspense>
    </span>
  );
}
