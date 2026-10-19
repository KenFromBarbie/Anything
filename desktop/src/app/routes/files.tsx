import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const FilesPage = React.lazy(async () => {
  const module = await import("@/features/files/ui/FilesPage");
  return { default: module.FilesPage };
});

export const Route = createFileRoute("/files")({
  component: FilesRouteComponent,
});

function FilesRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <FilesPage />
    </React.Suspense>
  );
}
