import { createFileRoute, redirect } from "@tanstack/react-router";

// The browser opens from Research → Artifacts now; old links land there.
export const Route = createFileRoute("/browser")({
  beforeLoad: () => {
    throw redirect({ to: "/research", search: { tab: "artifacts" } });
  },
});
