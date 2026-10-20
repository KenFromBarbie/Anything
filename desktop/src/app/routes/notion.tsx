import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const NotionPage = React.lazy(async () => {
  const module = await import("@/features/notion/ui/NotionPage");
  return { default: module.NotionPage };
});

export const Route = createFileRoute("/notion")({
  component: NotionRouteComponent,
});

function NotionRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <NotionPage />
    </React.Suspense>
  );
}
