import { createFileRoute, redirect } from "@tanstack/react-router";

// Artifacts is a tab of Research now; old links land there.
export const Route = createFileRoute("/artifacts")({
  beforeLoad: () => {
    throw redirect({ to: "/research", search: { tab: "artifacts" } });
  },
});
