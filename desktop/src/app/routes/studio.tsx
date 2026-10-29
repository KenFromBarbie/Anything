import { createFileRoute, redirect } from "@tanstack/react-router";

// The Studio is part of Research → Artifacts now (make something, ask for
// changes); old links land there.
export const Route = createFileRoute("/studio")({
  beforeLoad: () => {
    throw redirect({ to: "/research", search: { tab: "artifacts" } });
  },
});
