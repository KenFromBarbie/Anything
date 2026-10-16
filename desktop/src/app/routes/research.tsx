import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type ResearchRouteSearch = { project?: string };

function validateResearchSearch(
  search: Record<string, unknown>,
): ResearchRouteSearch {
  return {
    project:
      typeof search.project === "string" && search.project.length > 0
        ? search.project
        : undefined,
  };
}

const ResearchPage = React.lazy(async () => {
  const module = await import("@/features/research/ui/ResearchPage");
  return { default: module.ResearchPage };
});

export const Route = createFileRoute("/research")({
  validateSearch: validateResearchSearch,
  component: ResearchRouteComponent,
});

function ResearchRouteComponent() {
  const { project } = Route.useSearch();
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <ResearchPage projectId={project ?? null} />
    </React.Suspense>
  );
}
