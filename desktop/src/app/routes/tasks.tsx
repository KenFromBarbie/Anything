import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const TasksPage = React.lazy(async () => {
  const module = await import("@/features/tasks/ui/TasksPage");
  return { default: module.TasksPage };
});

export const Route = createFileRoute("/tasks")({
  component: TasksRouteComponent,
});

function TasksRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <TasksPage />
    </React.Suspense>
  );
}
