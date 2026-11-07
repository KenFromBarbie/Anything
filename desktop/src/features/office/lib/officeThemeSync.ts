import * as React from "react";

import { themeMessage } from "@/features/office/ui/ThemedFrame";
import { useTheme } from "@/shared/theme/ThemeProvider";

/** Keep an Office frame in the app's colours: the theme is posted when the
 *  frame loads (it may mount later than this hook) and whenever the app
 *  switches light/dark. */
export function useOfficeThemeSync(
  frame: React.RefObject<HTMLIFrameElement | null>,
) {
  const { isDark } = useTheme();
  React.useEffect(() => {
    const post = () =>
      frame.current?.contentWindow?.postMessage(themeMessage(isDark), "*");
    post();
    // Frame load events don't bubble, but they can be caught on the way down.
    const onLoad = (event: Event) => {
      if (event.target === frame.current) post();
    };
    // The floor loads after the frame and asks for the theme when it's ready.
    const onRequest = (event: MessageEvent) => {
      const data = event.data as { type?: unknown } | null;
      if (
        data?.type === "buzz-theme-request" &&
        event.source === frame.current?.contentWindow
      ) {
        post();
      }
    };
    window.addEventListener("load", onLoad, true);
    window.addEventListener("message", onRequest);
    return () => {
      window.removeEventListener("load", onLoad, true);
      window.removeEventListener("message", onRequest);
    };
  }, [frame, isDark]);
}
