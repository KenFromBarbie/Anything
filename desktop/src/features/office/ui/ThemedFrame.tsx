import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { cn } from "@/shared/lib/cn";
import { useTheme } from "@/shared/theme/ThemeProvider";

/** The app's look, for a page an agent made: dark or light, its accent and
 *  font. Posted to the page as `{ type: "buzz-theme", … }` when it loads and
 *  when the theme changes. */
function themeMessage(dark: boolean) {
  const css = getComputedStyle(document.documentElement);
  const hsl = (name: string) => {
    const v = css.getPropertyValue(name).trim();
    return v ? `hsl(${v})` : null;
  };
  return {
    type: "buzz-theme",
    dark,
    accent: hsl("--primary"),
    foreground: hsl("--foreground"),
    muted: hsl("--muted-foreground"),
    border: hsl("--border"),
    font: css.fontFamily,
  };
}

/** The page with the app's scheme declared, so the browser draws it on the
 *  app's surface instead of a white canvas (a frame whose page doesn't say it
 *  supports the frame's scheme is painted opaque), and a base so its own
 *  files still load. */
export function withScheme(html: string, src: string, dark: boolean): string {
  const base = src.slice(0, src.lastIndexOf("/") + 1);
  const head = `<base href="${base}"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><style>html,body{background:transparent}</style>`;
  return /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, (tag) => `${tag}${head}`)
    : `${head}${html}`;
}

/**
 * An agent-made HTML page shown in the app's own surface: no white page
 * behind it, the app's light or dark scheme (so `prefers-color-scheme` inside
 * matches the app, not the computer), and the theme handed over for pages that
 * want the accent too.
 */
export const ThemedFrame = React.forwardRef<
  HTMLIFrameElement,
  { src: string; title: string; className?: string } & Pick<
    React.IframeHTMLAttributes<HTMLIFrameElement>,
    "loading" | "tabIndex"
  >
>(function ThemedFrame({ src, title, className, ...rest }, ref) {
  const { isDark } = useTheme();
  const own = React.useRef<HTMLIFrameElement | null>(null);
  const setRef = (node: HTMLIFrameElement | null) => {
    own.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };
  const page = useQuery({
    queryKey: ["office", "themed-frame", src],
    queryFn: async () => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`${response.status}`);
      return response.text();
    },
    staleTime: 60_000,
    retry: false,
  });
  const post = React.useCallback(() => {
    own.current?.contentWindow?.postMessage(themeMessage(isDark), "*");
  }, [isDark]);
  React.useEffect(post, [post]);
  if (page.isPending) return null;
  return (
    <iframe
      {...rest}
      className={cn("border-0 bg-transparent", className)}
      onLoad={post}
      ref={setRef}
      sandbox="allow-scripts"
      // Couldn't read it: show it as it is.
      src={page.data === undefined ? src : undefined}
      srcDoc={
        page.data === undefined ? undefined : withScheme(page.data, src, isDark)
      }
      style={{ colorScheme: isDark ? "dark" : "light" }}
      title={title}
    />
  );
});
