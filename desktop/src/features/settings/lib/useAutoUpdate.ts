import * as React from "react";
import { toast } from "sonner";

import {
  checkForUpdate,
  getUpdaterSettings,
  installUpdate,
} from "@/features/settings/lib/updater";

/** How long after launch the check runs, and how long "Not now" is offered. */
const CHECK_AFTER_MS = 20_000;
const COUNTDOWN_S = 15;

/**
 * Updating automatically, when the owner turned it on (Settings → Updates):
 * once per launch, a little after the app starts, it checks for a new release
 * and, unless they say "Not now" or are in a call, installs it (the app
 * restarts into it).
 */
export function useAutoUpdate(inCall: boolean): void {
  const inCallRef = React.useRef(inCall);
  inCallRef.current = inCall;

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const { auto } = await getUpdaterSettings();
        if (!auto || cancelled) return;
        const info = await checkForUpdate();
        if (!info.available || !info.asset || cancelled) return;
        if (inCallRef.current) {
          toast(
            `Version ${info.latest} is ready: update in Settings → Updates when you're done.`,
          );
          return;
        }
        let declined = false;
        const id = toast(
          `Updating to version ${info.latest} in ${COUNTDOWN_S} s`,
          {
            description: "Anything restarts into the new version.",
            duration: COUNTDOWN_S * 1000,
            action: {
              label: "Not now",
              onClick: () => {
                declined = true;
              },
            },
          },
        );
        window.setTimeout(async () => {
          if (declined || cancelled || inCallRef.current) return;
          toast.dismiss(id);
          toast(`Downloading version ${info.latest}…`);
          try {
            await installUpdate();
          } catch (error) {
            toast.error(
              `The update didn't install: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }, COUNTDOWN_S * 1000);
      } catch {
        // Offline or GitHub unreachable: try again next launch.
      }
    }, CHECK_AFTER_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);
}
