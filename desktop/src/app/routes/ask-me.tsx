import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AskMePage = React.lazy(async () => {
  const module = await import("@/features/tasks/ui/AskMePage");
  return { default: module.AskMePage };
});

export const Route = createFileRoute("/ask-me")({
  component: AskMeRouteComponent,
});

function AskMeRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <AskMePage />
    </React.Suspense>
  );
}
