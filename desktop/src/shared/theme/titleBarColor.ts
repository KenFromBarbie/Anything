import { invokeTauri } from "@/shared/api/tauri";

/** A CSS colour as `#rrggbb` (alpha dropped), via the browser's parser. */
function toHex(css: string): string | null {
  const probe = document.createElement("span");
  probe.style.color = css;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  probe.remove();
  const parts = resolved.match(/[\d.]+/g);
  if (!parts || parts.length < 3) return null;
  return `#${parts
    .slice(0, 3)
    .map((n) => Math.round(Number(n)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/** The Office floor's top edge (its back wall), under the window's top. */
const FLOOR_TOP = [232, 232, 222];

const rgbOf = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hexOf = (rgb: number[]) =>
  `#${rgb.map((n) => Math.round(n).toString(16).padStart(2, "0")).join("")}`;

/** The colour at the top of the window: the Anything gradient's top stop or
 *  the theme's sidebar colour, and with the Office background on, that wash
 *  over the floor's wall (bare wall on the Office page). Text in the theme's
 *  foreground, or dark/light for contrast over the floor. */
function topColors(): { caption: string; text: string } | null {
  const el = document.documentElement;
  const root = getComputedStyle(el);
  const gradient = el.hasAttribute("data-buzz-sidebar")
    ? root.getPropertyValue("--buzz-gradient-top").trim()
    : "";
  const theme = toHex(
    gradient || `hsl(${root.getPropertyValue("--sidebar-background").trim()})`,
  );
  const foreground = toHex(
    `hsl(${root.getPropertyValue("--foreground").trim()})`,
  );
  if (!theme || !foreground) return null;
  if (!el.hasAttribute("data-office-backdrop")) {
    return { caption: theme, text: foreground };
  }
  const wash = el.hasAttribute("data-office-focus")
    ? 0
    : Number(root.getPropertyValue("--office-backdrop-wash")) || 0;
  const tint = rgbOf(theme);
  const mixed = tint.map((c, i) => c * wash + FLOOR_TOP[i] * (1 - wash));
  const light = 0.2126 * mixed[0] + 0.7152 * mixed[1] + 0.0722 * mixed[2] > 140;
  return { caption: hexOf(mixed), text: light ? "#1f2328" : "#f0f0f0" };
}

/** Keep the native title bar (Windows) in the theme's colours. */
export function followThemeWithTitleBar(): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  let last = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  const apply = () => {
    timer = null;
    const colors = topColors();
    if (!colors) return;
    const key = `${colors.caption}/${colors.text}`;
    if (key === last) return;
    last = key;
    void invokeTauri("set_title_bar_colors", colors).catch(() => undefined);
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(apply, 50);
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "data-buzz-sidebar",
      "data-office-backdrop",
      "data-office-focus",
    ],
  });
  schedule();
  return () => {
    observer.disconnect();
    if (timer) clearTimeout(timer);
  };
}
