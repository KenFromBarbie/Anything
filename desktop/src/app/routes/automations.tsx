import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AutomationsPage = React.lazy(async () => {
  const module = await import("@/features/office/ui/AutomationsPage");
  return { default: module.AutomationsPage };
});

export const Route = createFileRoute("/automations")({
  component: AutomationsRouteComponent,
});

function AutomationsRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <AutomationsPage />
    </React.Suspense>
  );
}
