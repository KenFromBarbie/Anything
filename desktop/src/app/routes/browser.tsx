import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const BrowserPage = React.lazy(async () => {
  const module = await import("@/features/office/ui/BrowserPage");
  return { default: module.BrowserPage };
});

export const Route = createFileRoute("/browser")({
  component: BrowserPageRouteComponent,
});

function BrowserPageRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <BrowserPage />
    </React.Suspense>
  );
}
