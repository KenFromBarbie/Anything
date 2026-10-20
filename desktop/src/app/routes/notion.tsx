import { createFileRoute, redirect } from "@tanstack/react-router";

/** Notion is read under Tasks → My tasks; old links land there. */
export const Route = createFileRoute("/notion")({
  beforeLoad: () => {
    throw redirect({ to: "/tasks" });
  },
});
