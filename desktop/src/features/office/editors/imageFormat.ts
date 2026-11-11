// The Image editor's file (.image.json): a layered picture, like a
// Photoshop document. Layers are listed bottom first.

export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
] as const;
export type BlendMode = (typeof BLEND_MODES)[number];

/** Non-destructive adjustments (CSS filter units). */
export type Adjust = {
  brightness: number; // %, 100 = unchanged
  contrast: number; // %
  saturation: number; // %
  hue: number; // degrees
  blur: number; // px
  grayscale: number; // %
  sepia: number; // %
  invert: number; // %
};

export const NO_ADJUST: Adjust = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
};

type LayerBase = {
  id: string;
  name: string;
  visible: boolean;
  /** 0–1 */
  opacity: number;
  blend: BlendMode;
  x: number;
  y: number;
  adjust?: Adjust;
};

export type RasterLayer = LayerBase & {
  kind: "raster";
  /** A PNG/JPEG as a data: URL (or https). Drawn at its own size unless
   *  w/h are given. */
  src: string;
  w?: number;
  h?: number;
};
export type TextLayer = LayerBase & {
  kind: "text";
  text: string;
  font: string;
  size: number;
  color: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
};
export type ShapeLayer = LayerBase & {
  kind: "shape";
  shape: "rect" | "ellipse" | "line";
  w: number;
  h: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
};
export type ImageLayer = RasterLayer | TextLayer | ShapeLayer;

export type ImageFile = {
  type: "image";
  version: 1;
  width: number;
  height: number;
  layers: ImageLayer[];
  /** A small flattened copy for Create's cards (data: URL). */
  preview?: string;
};

export const IMAGE_FONTS = ["Inter", "Segoe UI", "Arial", "Georgia", "Times New Roman", "Impact", "Courier New", "Verdana"];

export function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** A white canvas with one empty layer on it. */
export function blankImage(width = 1920, height = 1080): ImageFile {
  const white = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/></svg>`,
  )}`;
  return {
    type: "image",
    version: 1,
    width,
    height,
    layers: [
      { id: newId(), kind: "raster", name: "Background", visible: true, opacity: 1, blend: "normal", x: 0, y: 0, src: white, w: width, h: height },
    ],
  };
}

const num = (v: unknown, d: number, lo = -1e6, hi = 1e6) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const str = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const color = (v: unknown, d: string) => (typeof v === "string" && /^(#[0-9a-f]{3,8}|transparent|rgba?\([\d\s.,%]+\))$/i.test(v.trim()) ? v.trim() : d);
const safeSrc = (v: unknown) => (typeof v === "string" && /^(data:image\/|https:\/\/)/i.test(v) ? v : "");

/** Read a saved (or agent-written) image, filling in what's missing. */
export function parseImage(value: unknown): ImageFile {
  const v = (value ?? {}) as Record<string, unknown>;
  const width = Math.round(num(v.width, 1920, 1, 12000));
  const height = Math.round(num(v.height, 1080, 1, 12000));
  const layers: ImageLayer[] = [];
  for (const raw of Array.isArray(v.layers) ? v.layers : []) {
    const l = (raw ?? {}) as Record<string, unknown>;
    const a = (l.adjust ?? null) as Record<string, unknown> | null;
    const base = {
      id: typeof l.id === "string" && l.id ? l.id : newId(),
      name: str(l.name, "Layer"),
      visible: l.visible !== false,
      opacity: num(l.opacity, 1, 0, 1),
      blend: (BLEND_MODES as readonly string[]).includes(String(l.blend)) ? (l.blend as BlendMode) : "normal",
      x: num(l.x, 0),
      y: num(l.y, 0),
      ...(a
        ? {
            adjust: {
              brightness: num(a.brightness, 100, 0, 300),
              contrast: num(a.contrast, 100, 0, 300),
              saturation: num(a.saturation, 100, 0, 300),
              hue: num(a.hue, 0, -180, 180),
              blur: num(a.blur, 0, 0, 100),
              grayscale: num(a.grayscale, 0, 0, 100),
              sepia: num(a.sepia, 0, 0, 100),
              invert: num(a.invert, 0, 0, 100),
            },
          }
        : {}),
    };
    if (l.kind === "text") {
      layers.push({
        ...base,
        kind: "text",
        text: str(l.text, "Text"),
        font: str(l.font, "Inter"),
        size: num(l.size, 72, 1, 2000),
        color: color(l.color, "#000000"),
        bold: l.bold === true,
        italic: l.italic === true,
        align: l.align === "center" || l.align === "right" ? l.align : "left",
      });
    } else if (l.kind === "shape") {
      layers.push({
        ...base,
        kind: "shape",
        shape: l.shape === "ellipse" || l.shape === "line" ? l.shape : "rect",
        w: num(l.w, 200, -20000, 20000),
        h: num(l.h, 200, -20000, 20000),
        fill: color(l.fill, "#3b82f6"),
        stroke: color(l.stroke, "transparent"),
        strokeWidth: num(l.strokeWidth, 0, 0, 500),
        radius: num(l.radius, 0, 0, 5000),
      });
    } else {
      const src = safeSrc(l.src);
      if (!src) continue;
      layers.push({
        ...base,
        kind: "raster",
        src,
        ...(l.w != null ? { w: num(l.w, width, 1, 20000) } : {}),
        ...(l.h != null ? { h: num(l.h, height, 1, 20000) } : {}),
      });
    }
  }
  return {
    type: "image",
    version: 1,
    width,
    height,
    layers: layers.length ? layers : blankImage(width, height).layers,
    preview: typeof v.preview === "string" && v.preview.startsWith("data:image/") ? v.preview : undefined,
  };
}

export const IMAGE_SPEC =
  'JSON: {"type":"image","version":1,"width":1920,"height":1080,"layers":[…bottom first…]}. Each layer has "id","name","visible":true,"opacity":0–1,"blend":"normal|multiply|screen|overlay|darken|lighten|soft-light|…","x","y" (top-left, px) and optional "adjust":{"brightness":100,"contrast":100,"saturation":100,"hue":0,"blur":0,"grayscale":0,"sepia":0,"invert":0}; then one of: {"kind":"raster","src":"data:image/png;base64,… (or https)","w","h" (optional size)}, {"kind":"text","text":"…","font":"Inter","size":72,"color":"#fff","bold":true,"align":"left|center|right"}, {"kind":"shape","shape":"rect|ellipse|line","w","h","fill":"#hex","stroke":"#hex","strokeWidth":0,"radius":0}. Keep photos as raster layers and titles as text layers so the owner can keep editing them.';
