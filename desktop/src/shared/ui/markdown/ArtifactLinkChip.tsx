import * as React from "react";

import { openDeskPanel } from "@/shared/lib/deskPanel";

const ArtifactPanel = React.lazy(async () => ({
  default: (await import("@/features/office/ui/ArtifactsPage")).ArtifactPanel,
}));

/**
 * A `buzz://artifact/<id>` link in chat (something an Office agent made):
 * the artifact itself, in the message at full width — a live page, the PDF,
 * the picture or video — with Open and expand over its corner. A span: the
 * link sits inside a paragraph or list item.
 */
export function ArtifactLinkChip({ id }: { id: string; label: string }) {
  return (
    <span
      className="my-2 block w-full max-w-3xl align-top"
      data-artifact-id={id}
      data-testid="artifact-embed"
    >
      <React.Suspense fallback={null}>
        <ArtifactPanel
          bare
          id={id}
          onExpand={() => openDeskPanel({ kind: "artifact", id })}
        />
      </React.Suspense>
    </span>
  );
}
