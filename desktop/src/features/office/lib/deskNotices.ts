import * as React from "react";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import {
  getDeskPanel,
  openDeskPanel,
  setBrowsing,
  setDeskPanelFallback,
} from "@/shared/lib/deskPanel";

/** Events from `office_desk.rs` (the pages define the same names). */
const ARTIFACT_EVENT = "office-artifact";
const BROWSER_EVENT = "agent-browser";

/**
 * Wherever you are in the app: a note when an agent shows you something it
 * made (Artifacts) or opens a page for you (Browser), with a way to look.
 * "View" opens it beside the chat in a channel, else in Research's tabs.
 */
export function useDeskNotices(): void {
  const { goArtifacts, goBrowser } = useAppNavigation();
  const nav = React.useRef({ goArtifacts, goBrowser });
  nav.current = { goArtifacts, goBrowser };

  React.useEffect(() => {
    // Outside a channel, links and "View" go to Research's tabs.
    setDeskPanelFallback((panel) => {
      if (panel.kind === "artifact") {
        void nav.current.goArtifacts(panel.id);
        return;
      }
      // A page was opened: Artifacts shows it in the live browser.
      setBrowsing(true);
      void nav.current.goBrowser();
    });
    return () => setDeskPanelFallback(null);
  }, []);

  React.useEffect(() => {
    if (!isTauri()) return;
    const offArtifact = listen<{ id?: string; title?: string; agent?: string }>(
      ARTIFACT_EVENT,
      (e) => {
        const { id, title = "something", agent = "An agent" } = e.payload ?? {};
        toast(`${agent} made ${title}`, {
          action: {
            label: "View",
            onClick: () =>
              id
                ? openDeskPanel({ kind: "artifact", id })
                : void nav.current.goArtifacts(),
          },
        });
      },
    );
    const offBrowser = listen<{ op?: string; url?: string; agent?: string }>(
      BROWSER_EVENT,
      (e) => {
        if (e.payload?.op !== "open" || !e.payload.agent) return;
        // An agent opened a page: Artifacts shows it in the live browser.
        setBrowsing(true);
        // Already looking at the browser (beside a chat, or in Artifacts).
        if (getDeskPanel()?.kind === "browser") return;
        if (/[?&]tab=artifacts\b/.test(window.location.hash)) return;
        toast(`${e.payload.agent} opened a page in the Browser`, {
          description: e.payload.url,
          action: {
            label: "View",
            onClick: () => openDeskPanel({ kind: "browser" }),
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
