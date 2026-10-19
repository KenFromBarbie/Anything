import { createFileRoute, redirect } from "@tanstack/react-router";

/** Ask Me is part of the Inbox now (the agents' questions sit at its top);
 *  old links land there. */
export const Route = createFileRoute("/ask-me")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
