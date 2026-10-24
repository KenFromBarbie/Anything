import * as React from "react";
import {
  createHashHistory,
  createRouter,
  useNavigate,
} from "@tanstack/react-router";

import { routeTree } from "@/app/routeTree.gen";

/** An address the app doesn't have (a page from an older version, a link
 *  that's gone): back to the Inbox rather than a bare "Not Found". */
function GoHome() {
  const navigate = useNavigate();
  React.useEffect(() => {
    void navigate({ to: "/", replace: true });
  }, [navigate]);
  return null;
}

export const router = createRouter({
  routeTree,
  history: createHashHistory(),
  scrollRestoration: true,
  getScrollRestorationKey: (location: { pathname: string }) =>
    location.pathname,
  defaultNotFoundComponent: GoHome,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
