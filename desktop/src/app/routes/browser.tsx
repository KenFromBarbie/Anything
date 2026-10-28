import { createFileRoute, redirect } from "@tanstack/react-router";

// Browser is a tab of Research now; old links land there.
export const Route = createFileRoute("/browser")({
  beforeLoad: () => {
    throw redirect({ to: "/research", search: { tab: "browser" } });
  },
});
