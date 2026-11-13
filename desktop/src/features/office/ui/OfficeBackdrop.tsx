import * as React from "react";

import { isTauri } from "@tauri-apps/api/core";

import { useOfficeBackdrop } from "@/features/office/lib/officeBackdrop";
import { startOffice } from "@/features/office/ui/OfficeHost";

/**
 * The live Office floor behind the whole window (Settings → Appearance).
 *
 * There is one Office: the main frame (OfficeHost) sits behind the app when no
 * page shows it, so the background costs no second copy. This starts that
 * Office, lets the page panel show it through, and lays the app's background
 * over it, faded by the chosen strength.
 */
export function OfficeBackdrop() {
  const { enabled, strength } = useOfficeBackdrop();

  React.useEffect(() => {
    if (enabled && isTauri()) startOffice();
  }, [enabled]);

  // While it's on, the page panel lets it show through.
  React.useEffect(() => {
    const root = document.documentElement;
    if (!enabled) {
      root.removeAttribute("data-office-backdrop");
      return;
    }
    root.setAttribute("data-office-backdrop", "");
    root.style.setProperty(
      "--office-backdrop-wash",
      String(1 - strength / 100),
    );
    return () => root.removeAttribute("data-office-backdrop");
  }, [enabled, strength]);

  if (!enabled) return null;
  return (
    <div
      aria-hidden
      className="office-backdrop-layer office-backdrop-wash pointer-events-none fixed inset-0 -z-[5]"
      style={{ opacity: 1 - strength / 100 }}
    />
  );
}
