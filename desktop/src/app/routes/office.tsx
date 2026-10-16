import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const OfficeFloorPage = React.lazy(async () => {
  const module = await import("@/features/office/ui/OfficeFloorPage");
  return { default: module.OfficeFloorPage };
});

export const Route = createFileRoute("/office")({
  component: OfficeRouteComponent,
});

function OfficeRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <OfficeFloorPage />
    </React.Suspense>
  );
}
