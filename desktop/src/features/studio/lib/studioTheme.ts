import * as React from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";

/** The app's colour variables ArtCraft shares (shadcn names, HSL parts). */
const SHARED = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
] as const;

/** "r g b" for a colour, as ArtCraft's `--st-*-rgb` variables want it. */
function rgbParts(color: string): string {
  const probe = document.createElement("span");
  probe.style.color = color;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(resolved);
  return match ? `${match[1]} ${match[2]} ${match[3]}` : "128 128 128";
}

/** The app's look as the Studio applies it: the page panel's colours (they
 *  can differ from the window's), its font, and light or dark. */
export function currentStudioTheme() {
  const surface =
    document.querySelector<HTMLElement>("[data-buzz-content-surface]") ??
    document.documentElement;
  const style = getComputedStyle(surface);
  const vars: Record<string, string> = {};
  for (const name of SHARED) {
    const value = style.getPropertyValue(name).trim();
    if (value) vars[name] = value;
  }
  const hsl = (name: string) => `hsl(${vars[name] ?? "0 0% 50%"})`;
  const glass = (name: string, alpha: number) =>
    `hsl(${vars[name] ?? "0 0% 50%"} / ${alpha})`;
  Object.assign(vars, {
    // See-through, like the app's pages: the Office floor shows behind the
    // Studio, with its bars and cards frosted over it.
    "--st-bg": "transparent",
    "--st-panel": glass("--background", 0.78),
    "--st-panel-border": hsl("--border"),
    "--st-modal": hsl("--popover"),
    "--st-controls": hsl("--muted"),
    "--st-controls-rgb": rgbParts(hsl("--muted")),
    "--st-controls-border": hsl("--border"),
    "--st-sunken": glass("--muted", 0.6),
    "--st-fg": hsl("--foreground"),
    "--st-fg-rgb": rgbParts(hsl("--foreground")),
    "--st-divider": hsl("--border"),
  });
  return {
    vars,
    font: getComputedStyle(document.body).fontFamily,
    dark: document.documentElement.classList.contains("dark"),
  };
}

/** Keep the Studio view in the app's look while the Studio page is open. */
export function useStudioTheme(): void {
  React.useEffect(() => {
    if (!isTauri()) return;
    let last = "";
    const send = () => {
      const theme = currentStudioTheme();
      const key = JSON.stringify(theme);
      if (key === last) return;
      last = key;
      void invoke("studio_theme", { theme }).catch(() => undefined);
    };
    send();
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme", "data-buzz-sidebar"],
    });
    return () => observer.disconnect();
  }, []);
}
