import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ArtifactsPage = React.lazy(async () => {
  const module = await import("@/features/office/ui/ArtifactsPage");
  return { default: module.ArtifactsPage };
});

export const Route = createFileRoute("/artifacts")({
  component: ArtifactsPageRouteComponent,
});

function ArtifactsPageRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <ArtifactsPage />
    </React.Suspense>
  );
}
