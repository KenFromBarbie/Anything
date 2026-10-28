import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

export type ResearchTab = "projects" | "artifacts" | "browser";

type ResearchRouteSearch = {
  project?: string;
  tab?: ResearchTab;
  artifact?: string;
};

function validateResearchSearch(
  search: Record<string, unknown>,
): ResearchRouteSearch {
  const text = (value: unknown) =>
    typeof value === "string" && value.length > 0 ? value : undefined;
  const tab = text(search.tab);
  return {
    project: text(search.project),
    tab:
      tab === "artifacts" || tab === "browser" || tab === "projects"
        ? tab
        : undefined,
    artifact: text(search.artifact),
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
  const { project, tab, artifact } = Route.useSearch();
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <ResearchPage
        artifactId={artifact ?? null}
        projectId={project ?? null}
        tab={tab ?? "projects"}
      />
    </React.Suspense>
  );
}
