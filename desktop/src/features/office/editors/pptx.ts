import { bulletLines, type SlidesFile, THEMES } from "./formats";

const hex = (c: string) => c.replace("#", "").slice(0, 6).toUpperCase();

function isLight(c: string): boolean {
  const n = Number.parseInt(c.slice(1, 7), 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 160;
}

/**
 * The deck as a real PowerPoint file (base64): each slide rebuilt from its
 * layout with PowerPoint text boxes and bullets in the theme's colours, so
 * it stays editable there. Speaker notes come along. (pptxgenjs is loaded
 * only when exporting.)
 */
export async function slidesToPptx(title: string, deck: SlidesFile): Promise<string> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9"; // 10 × 5.625 in
  pptx.title = title || "Presentation";
  const t = THEMES[deck.theme];
  const font = "Segoe UI";

  for (const s of deck.slides) {
    const slide = pptx.addSlide();
    const section = s.layout === "section";
    const onAccent = isLight(t.accent) ? "10202C" : "FFFFFF";
    slide.background = { color: hex(section ? t.accent : t.bg) };
    const titleColor = section ? onAccent : hex(t.title);
    const bodyColor = section ? onAccent : hex(t.fg);
    const bullets = (text: string) =>
      bulletLines(text).map((line) => ({
        text: line,
        options: { bullet: { indent: 18 }, color: bodyColor, breakLine: true },
      }));

    if (s.layout === "title" || section) {
      slide.addText(s.title || " ", { x: 0.8, y: 1.6, w: 8.4, h: 1.3, fontFace: font, fontSize: 40, bold: true, color: titleColor });
      slide.addShape(pptx.ShapeType.rect, { x: 0.8, y: 2.95, w: 1.25, h: 0.06, fill: { color: section ? onAccent : hex(t.accent) }, line: { type: "none" } });
      if (s.body.trim()) {
        slide.addText(s.body, { x: 0.8, y: 3.15, w: 8.4, h: 1.2, fontFace: font, fontSize: 20, color: section ? onAccent : hex(t.muted) });
      }
    } else if (s.layout === "blank") {
      if (s.body.trim()) slide.addText(s.body, { x: 0.6, y: 0.6, w: 8.8, h: 4.4, fontFace: font, fontSize: 20, color: bodyColor, valign: "top" });
    } else {
      slide.addText(s.title || " ", { x: 0.6, y: 0.35, w: 8.8, h: 0.8, fontFace: font, fontSize: 30, bold: true, color: titleColor });
      slide.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.15, w: 8.8, h: 0.04, fill: { color: hex(t.accent) }, line: { type: "none" } });
      if (s.layout === "two") {
        const left = bullets(s.body);
        const right = bullets(s.right ?? "");
        if (left.length) slide.addText(left, { x: 0.6, y: 1.35, w: 4.25, h: 3.8, fontFace: font, fontSize: 18, valign: "top" });
        if (right.length) slide.addText(right, { x: 5.15, y: 1.35, w: 4.25, h: 3.8, fontFace: font, fontSize: 18, valign: "top" });
      } else {
        const list = bullets(s.body);
        if (list.length) slide.addText(list, { x: 0.6, y: 1.35, w: 8.8, h: 3.9, fontFace: font, fontSize: 20, valign: "top" });
      }
    }
    if (s.notes?.trim()) slide.addNotes(s.notes);
  }
  return (await pptx.write({ outputType: "base64" })) as string;
}
