import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";

/** Events from `office_desk.rs` (the pages define the same names). */
const ARTIFACT_EVENT = "office-artifact";
const BROWSER_EVENT = "agent-browser";

/**
 * Wherever you are in the app: a note when an agent shows you something it
 * made (Artifacts) or opens a page for you (Browser), with a way to look.
 */
export function useDeskNotices(): void {
  const { goArtifacts, goBrowser } = useAppNavigation();
  const nav = React.useRef({ goArtifacts, goBrowser });
  nav.current = { goArtifacts, goBrowser };

  React.useEffect(() => {
    if (!isTauri()) return;
    const offArtifact = listen<{ title?: string; agent?: string }>(
      ARTIFACT_EVENT,
      (e) => {
        const { title = "something", agent = "An agent" } = e.payload ?? {};
        toast(`${agent} made ${title}`, {
          action: {
            label: "View",
            onClick: () => void nav.current.goArtifacts(),
          },
        });
      },
    );
    const offBrowser = listen<{ op?: string; url?: string; agent?: string }>(
      BROWSER_EVENT,
      (e) => {
        if (e.payload?.op !== "open" || !e.payload.agent) return;
        if (window.location.pathname === "/browser") return;
        toast(`${e.payload.agent} opened a page in the Browser`, {
          description: e.payload.url,
          action: {
            label: "View",
            onClick: () => void nav.current.goBrowser(),
          },
        });
      },
    );
    return () => {
      void offArtifact.then((f) => f());
      void offBrowser.then((f) => f());
    };
  }, []);
}
