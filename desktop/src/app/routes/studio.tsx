import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const StudioScreen = React.lazy(async () => {
  const module = await import("@/features/studio/ui/StudioScreen");
  return { default: module.StudioScreen };
});

export const Route = createFileRoute("/studio")({
  component: StudioRouteComponent,
});

function StudioRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <StudioScreen />
    </React.Suspense>
  );
}
