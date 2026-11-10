import * as React from "react";

import { bulletLines, type Slide, type SlidesTheme, THEMES } from "./formats";

export const SLIDE_W = 960;
export const SLIDE_H = 540;

function isLight(hex: string): boolean {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160;
}

/** Fits a 960×540 slide into its box, keeping 16:9. */
export function useFitScale(ref: React.RefObject<HTMLElement | null>, fallback = 1) {
  const [scale, setScale] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      const h = el.clientHeight || (w * SLIDE_H) / SLIDE_W;
      setScale(Math.min(w / SLIDE_W, h / SLIDE_H));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return scale;
}

type Edit = {
  onTitle: (v: string) => void;
  onBody: (v: string) => void;
  onRight: (v: string) => void;
};

/**
 * One slide at 960×540, scaled by `scale`. Read-only (thumbnails, Create,
 * Present) or, with `edit`, typed on directly like PowerPoint's placeholders.
 */
export function SlideView({
  slide,
  theme,
  scale,
  edit,
}: {
  slide: Slide;
  theme: SlidesTheme;
  scale: number;
  edit?: Edit;
}) {
  const t = THEMES[theme];
  const section = slide.layout === "section";
  const bg = section ? t.accent : t.bg;
  // On a light accent (Ocean's cyan) white text can't be read: use dark.
  const onAccent = isLight(t.accent) ? "#10202c" : "#ffffff";
  const titleColor = section ? onAccent : t.title;
  const bodyColor = section ? onAccent : t.fg;

  const text = (
    value: string,
    onChange: ((v: string) => void) | undefined,
    placeholder: string,
    style: React.CSSProperties,
    multiline: boolean,
  ) =>
    onChange ? (
      <textarea
        className="w-full resize-none overflow-hidden border border-dashed border-transparent bg-transparent outline-none hover:border-black/25 focus:border-black/40"
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={multiline ? 6 : 1}
        style={{ ...style, color: style.color, fontFamily: "inherit" }}
        value={value}
      />
    ) : (
      <div style={{ ...style, whiteSpace: "pre-wrap" }}>{value}</div>
    );

  const bullets = (value: string, onChange: ((v: string) => void) | undefined, placeholder: string) =>
    onChange ? (
      text(value, onChange, placeholder, { fontSize: 26, lineHeight: 1.5, color: bodyColor, height: 330 }, true)
    ) : (
      <ul style={{ margin: 0, paddingLeft: 30, fontSize: 26, lineHeight: 1.5, color: bodyColor }}>
        {bulletLines(value).map((l, i) => (
          <li key={`${i}-${l}`} style={{ color: bodyColor }}>
            <span style={{ color: bodyColor }}>{l}</span>
          </li>
        ))}
      </ul>
    );

  let content: React.ReactNode;
  if (slide.layout === "title" || section) {
    content = (
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 80px" }}>
        {text(slide.title, edit?.onTitle, "Click to add title", { fontSize: 56, fontWeight: 600, color: titleColor, lineHeight: 1.15 }, false)}
        <div style={{ height: 6, width: 120, background: section ? onAccent : t.accent, margin: "18px 0" }} />
        {text(slide.body, edit?.onBody, "Click to add subtitle", { fontSize: 26, color: section ? onAccent : t.muted, opacity: section ? 0.85 : 1 }, true)}
      </div>
    );
  } else if (slide.layout === "blank") {
    content = (
      <div style={{ position: "absolute", inset: 60 }}>
        {text(slide.body, edit?.onBody, "Click to add text", { fontSize: 28, color: bodyColor, height: 400 }, true)}
      </div>
    );
  } else {
    content = (
      <div style={{ position: "absolute", inset: "44px 64px" }}>
        {text(slide.title, edit?.onTitle, "Click to add title", { fontSize: 40, fontWeight: 600, color: titleColor }, false)}
        <div style={{ height: 4, background: t.accent, margin: "10px 0 24px", width: "100%" }} />
        {slide.layout === "two" ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 40 }}>
            {bullets(slide.body, edit?.onBody, "Click to add text (one point per line)")}
            {bullets(slide.right ?? "", edit?.onRight, "Click to add text")}
          </div>
        ) : (
          bullets(slide.body, edit?.onBody, "Click to add text (one point per line)")
        )}
      </div>
    );
  }

  return (
    <div style={{ width: SLIDE_W * scale, height: SLIDE_H * scale, overflow: "hidden", position: "relative" }}>
      <div
        style={{
          width: SLIDE_W,
          height: SLIDE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          background: bg,
          position: "relative",
          fontFamily: "'Segoe UI', Aptos, Arial, sans-serif",
        }}
      >
        {content}
      </div>
    </div>
  );
}
