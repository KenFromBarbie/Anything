import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  installLessonVoice,
  lessonVoices,
  SPEECH_SHIM,
  speak,
  stopSpeaking,
} from "@/features/learn/lib/lessonVoice";
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

/** Offer the voice a lesson needs, once per language per session. */
const offered = new Set<string>();
async function offerVoice(lang: string) {
  const base = lang.split(/[-_]/)[0]?.toLowerCase() ?? "";
  if (offered.has(base)) return;
  offered.add(base);
  const voice = (await lessonVoices()).find((v) => v.lang === base);
  if (!voice) {
    toast(`The app has no voice for "${lang}" yet.`);
    return;
  }
  toast(`Get the app's ${voice.label} voice?`, {
    description:
      "Lessons are read aloud with it. About 65 MB, downloaded once.",
    duration: 15_000,
    action: {
      label: "Download",
      onClick: () => {
        const id = toast.loading(`Downloading the ${voice.label} voice…`);
        void installLessonVoice(
          base,
          (share) =>
            toast.loading(
              `Downloading the ${voice.label} voice… ${Math.round(share * 100)}%`,
              { id },
            ),
          () =>
            toast.loading(
              `Unpacking the ${voice.label} voice… (a minute or two)`,
              { id },
            ),
        )
          .then(() =>
            toast.success(`${voice.label} voice ready. Press Listen again.`, {
              id,
            }),
          )
          .catch((e: unknown) => {
            offered.delete(base);
            toast.error(e instanceof Error ? e.message : String(e), { id });
          });
      },
    },
  });
}

/** The page with the app's scheme declared, so the browser draws it on the
 *  app's surface instead of a white canvas (a frame whose page doesn't say it
 *  supports the frame's scheme is painted opaque), and a base so its own
 *  files still load. */
export function withScheme(html: string, src: string, dark: boolean): string {
  const base = src.slice(0, src.lastIndexOf("/") + 1);
  const head = `<base href="${base}"><meta name="color-scheme" content="${dark ? "dark" : "light"}"><style>html,body{background:transparent}</style>${SPEECH_SHIM}`;
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
  // The page asks the app to read aloud (its speechSynthesis is the app's).
  React.useEffect(() => {
    const reply = (message: Record<string, unknown>) =>
      own.current?.contentWindow?.postMessage(message, "*");
    // Only this page's speech is stopped when it goes.
    let spoke = false;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== own.current?.contentWindow) return;
      const d = event.data as Record<string, unknown> | null;
      if (d?.type === "buzz-speak-stop") stopSpeaking();
      if (d?.type !== "buzz-speak") return;
      const lang = String(d.lang ?? "en");
      spoke = true;
      speak(String(d.text ?? ""), lang, Number(d.rate) || 1)
        .then(() => reply({ type: "buzz-spoken", id: d.id }))
        .catch((e: unknown) => {
          const error = e instanceof Error ? e.message : String(e);
          if (/not-installed|no-voice/.test(error)) void offerVoice(lang);
          reply({ type: "buzz-spoken", id: d.id, error });
        });
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      if (spoke) stopSpeaking();
    };
  }, []);
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
