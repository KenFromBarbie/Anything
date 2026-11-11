// Drawing for the Image editor: compositing layers with blend modes and
// adjustments, text and shapes, flood fill and destructive filters.

import type { Adjust, ImageFile, ImageLayer, ShapeLayer, TextLayer } from "./imageFormat";

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function ctx2d(c: HTMLCanvasElement): CanvasRenderingContext2D {
  return c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("couldn't load an image layer"));
    img.src = src;
  });
}

/** A raster layer's pixels in a canvas of its own size. */
export async function rasterCanvas(src: string, w?: number, h?: number): Promise<HTMLCanvasElement> {
  const img = await loadImage(src);
  const c = makeCanvas(w ?? (img.naturalWidth || 1), h ?? (img.naturalHeight || 1));
  ctx2d(c).drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export function filterOf(a: Adjust | undefined): string {
  if (!a) return "none";
  const parts: string[] = [];
  if (a.brightness !== 100) parts.push(`brightness(${a.brightness}%)`);
  if (a.contrast !== 100) parts.push(`contrast(${a.contrast}%)`);
  if (a.saturation !== 100) parts.push(`saturate(${a.saturation}%)`);
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) parts.push(`blur(${a.blur}px)`);
  if (a.grayscale) parts.push(`grayscale(${a.grayscale}%)`);
  if (a.sepia) parts.push(`sepia(${a.sepia}%)`);
  if (a.invert) parts.push(`invert(${a.invert}%)`);
  return parts.length ? parts.join(" ") : "none";
}

export function fontOf(t: TextLayer): string {
  return `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${t.size}px "${t.font}", sans-serif`;
}

/** Where a layer sits, in document pixels. */
export function boundsOf(
  layer: ImageLayer,
  raster?: HTMLCanvasElement,
): { x: number; y: number; w: number; h: number } {
  if (layer.kind === "raster") return { x: layer.x, y: layer.y, w: raster?.width ?? 0, h: raster?.height ?? 0 };
  if (layer.kind === "shape") {
    const x = Math.min(layer.x, layer.x + layer.w);
    const y = Math.min(layer.y, layer.y + layer.h);
    const pad = layer.strokeWidth / 2;
    return { x: x - pad, y: y - pad, w: Math.abs(layer.w) + pad * 2, h: Math.abs(layer.h) + pad * 2 };
  }
  const m = measureText(layer);
  const x = layer.align === "center" ? layer.x - m.w / 2 : layer.align === "right" ? layer.x - m.w : layer.x;
  return { x, y: layer.y, w: m.w, h: m.h };
}

let measurer: CanvasRenderingContext2D | null = null;
export function measureText(t: TextLayer): { w: number; h: number; lines: string[] } {
  measurer ??= ctx2d(makeCanvas(1, 1));
  measurer.font = fontOf(t);
  const lines = t.text.split("\n");
  const w = Math.max(1, ...lines.map((l) => measurer?.measureText(l).width ?? 0));
  return { w, h: lines.length * t.size * 1.2, lines };
}

function drawText(ctx: CanvasRenderingContext2D, t: TextLayer) {
  const { lines } = measureText(t);
  ctx.font = fontOf(t);
  ctx.fillStyle = t.color;
  ctx.textBaseline = "top";
  ctx.textAlign = t.align ?? "left";
  lines.forEach((line, i) => ctx.fillText(line, t.x, t.y + i * t.size * 1.2 + t.size * 0.1));
}

function drawShape(ctx: CanvasRenderingContext2D, s: ShapeLayer) {
  ctx.beginPath();
  if (s.shape === "line") {
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(s.x + s.w, s.y + s.h);
    ctx.lineCap = "round";
    ctx.strokeStyle = s.stroke !== "transparent" ? s.stroke : s.fill;
    ctx.lineWidth = Math.max(1, s.strokeWidth || 4);
    ctx.stroke();
    return;
  }
  const x = Math.min(s.x, s.x + s.w);
  const y = Math.min(s.y, s.y + s.h);
  const w = Math.abs(s.w);
  const h = Math.abs(s.h);
  if (s.shape === "ellipse") ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
  else if (s.radius) ctx.roundRect(x, y, w, h, Math.min(s.radius, w / 2, h / 2));
  else ctx.rect(x, y, w, h);
  if (s.fill !== "transparent") {
    ctx.fillStyle = s.fill;
    ctx.fill();
  }
  if (s.strokeWidth > 0 && s.stroke !== "transparent") {
    ctx.strokeStyle = s.stroke;
    ctx.lineWidth = s.strokeWidth;
    ctx.stroke();
  }
}

/** Draw one layer's own content (no opacity/blend/filter). */
export function drawContent(ctx: CanvasRenderingContext2D, layer: ImageLayer, raster?: CanvasImageSource) {
  if (layer.kind === "raster") {
    if (raster) ctx.drawImage(raster, layer.x, layer.y);
  } else if (layer.kind === "text") drawText(ctx, layer);
  else drawShape(ctx, layer);
}

/** Draw one layer onto the composite with its opacity, blend and
 *  adjustments. `extra` paints on top of the layer's content first (a
 *  brush stroke in progress). */
export function drawLayer(
  ctx: CanvasRenderingContext2D,
  layer: ImageLayer,
  raster: HTMLCanvasElement | undefined,
  extra?: (c: CanvasRenderingContext2D) => void,
) {
  if (!layer.visible || layer.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.globalCompositeOperation = layer.blend === "normal" ? "source-over" : layer.blend;
  ctx.filter = filterOf(layer.adjust);
  if (extra) {
    // The layer plus the stroke, flattened first so the blend applies once.
    const tmp = makeCanvas(ctx.canvas.width, ctx.canvas.height);
    const t = ctx2d(tmp);
    drawContent(t, layer, raster);
    extra(t);
    ctx.drawImage(tmp, 0, 0);
  } else {
    drawContent(ctx, layer, raster);
  }
  ctx.restore();
}

export function composite(
  ctx: CanvasRenderingContext2D,
  layers: ImageLayer[],
  rasters: Map<string, HTMLCanvasElement>,
  live?: { id: string; paint: (c: CanvasRenderingContext2D) => void },
) {
  for (const layer of layers) {
    drawLayer(ctx, layer, rasters.get(layer.id), live?.id === layer.id ? live.paint : undefined);
  }
}

/** Load every raster layer of a file. */
export async function loadRasters(file: ImageFile): Promise<Map<string, HTMLCanvasElement>> {
  const out = new Map<string, HTMLCanvasElement>();
  await Promise.all(
    file.layers.map(async (l) => {
      if (l.kind !== "raster") return;
      try {
        out.set(l.id, await rasterCanvas(l.src, l.w, l.h));
      } catch {
        out.set(l.id, makeCanvas(l.w ?? 1, l.h ?? 1));
      }
    }),
  );
  return out;
}

/** The whole picture, flattened. */
export async function renderImageFile(file: ImageFile, maxSide = 0): Promise<HTMLCanvasElement> {
  const rasters = await loadRasters(file);
  const full = makeCanvas(file.width, file.height);
  composite(ctx2d(full), file.layers, rasters);
  return maxSide ? scaledCopy(full, maxSide) : full;
}

export function scaledCopy(src: HTMLCanvasElement, maxSide: number): HTMLCanvasElement {
  const k = Math.min(1, maxSide / Math.max(src.width, src.height));
  const out = makeCanvas(src.width * k, src.height * k);
  const c = ctx2d(out);
  c.imageSmoothingQuality = "high";
  c.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

// ---- pixel tools -------------------------------------------------------

export function parseColor(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = Number.parseInt(h.slice(0, 6), 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Paint-bucket fill from (x, y) over similar colours. */
export function floodFill(
  c: HTMLCanvasElement,
  x: number,
  y: number,
  fill: string,
  tolerance: number,
  clip?: { x: number; y: number; w: number; h: number } | null,
) {
  const g = ctx2d(c);
  const { width: W, height: H } = c;
  x = Math.floor(x);
  y = Math.floor(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return false;
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const i0 = (y * W + x) * 4;
  const [r0, g0, b0, a0] = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
  const [fr, fg, fb] = parseColor(fill);
  const tol = tolerance * 4;
  const x0 = clip ? Math.max(0, Math.floor(clip.x)) : 0;
  const y0 = clip ? Math.max(0, Math.floor(clip.y)) : 0;
  const x1 = clip ? Math.min(W, Math.ceil(clip.x + clip.w)) : W;
  const y1 = clip ? Math.min(H, Math.ceil(clip.y + clip.h)) : H;
  if (x < x0 || y < y0 || x >= x1 || y >= y1) return false;
  const seen = new Uint8Array(W * H);
  const stack = [x, y];
  const like = (i: number) =>
    Math.abs(d[i] - r0) + Math.abs(d[i + 1] - g0) + Math.abs(d[i + 2] - b0) + Math.abs(d[i + 3] - a0) <= tol;
  while (stack.length) {
    const py = stack.pop() as number;
    const px = stack.pop() as number;
    if (px < x0 || py < y0 || px >= x1 || py >= y1) continue;
    const p = py * W + px;
    if (seen[p]) continue;
    seen[p] = 1;
    const i = p * 4;
    if (!like(i)) continue;
    d[i] = fr;
    d[i + 1] = fg;
    d[i + 2] = fb;
    d[i + 3] = 255;
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
  g.putImageData(img, 0, 0);
  return true;
}

export type FilterName = "blur" | "sharpen" | "noise" | "posterize" | "emboss" | "grayscale" | "invert" | "sepia";

function convolve(c: HTMLCanvasElement, k: number[], bias = 0) {
  const g = ctx2d(c);
  const { width: W, height: H } = c;
  const src = g.getImageData(0, 0, W, H);
  const out = g.createImageData(W, H);
  const s = src.data;
  const o = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let acc = 0;
        for (let ky = -1; ky <= 1; ky++) {
          const yy = Math.min(H - 1, Math.max(0, y + ky));
          for (let kx = -1; kx <= 1; kx++) {
            const xx = Math.min(W - 1, Math.max(0, x + kx));
            acc += s[(yy * W + xx) * 4 + ch] * k[(ky + 1) * 3 + kx + 1];
          }
        }
        o[i + ch] = acc + bias;
      }
      o[i + 3] = s[i + 3];
    }
  }
  g.putImageData(out, 0, 0);
}

/** Apply a filter to a raster layer's pixels (destructive, like
 *  Photoshop's Filter menu). */
export function applyFilter(c: HTMLCanvasElement, name: FilterName, amount = 4) {
  const g = ctx2d(c);
  if (name === "blur" || name === "grayscale" || name === "invert" || name === "sepia") {
    const copy = makeCanvas(c.width, c.height);
    ctx2d(copy).drawImage(c, 0, 0);
    g.save();
    g.clearRect(0, 0, c.width, c.height);
    g.filter = name === "blur" ? `blur(${amount}px)` : `${name}(100%)`;
    g.drawImage(copy, 0, 0);
    g.restore();
    return;
  }
  if (name === "sharpen") return convolve(c, [0, -1, 0, -1, 5, -1, 0, -1, 0]);
  if (name === "emboss") return convolve(c, [-2, -1, 0, -1, 1, 1, 0, 1, 2], 0);
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data;
  if (name === "noise") {
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * 50;
      d[i] += n;
      d[i + 1] += n;
      d[i + 2] += n;
    }
  } else {
    const levels = 5;
    const step = 255 / (levels - 1);
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(d[i] / step) * step;
      d[i + 1] = Math.round(d[i + 1] / step) * step;
      d[i + 2] = Math.round(d[i + 2] / step) * step;
    }
  }
  g.putImageData(img, 0, 0);
}

/** A soft or hard round brush dab. */
export function dab(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  hardness: number,
  color: string,
) {
  const r = Math.max(0.5, size / 2);
  if (hardness >= 0.99) {
    g.fillStyle = color;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    return;
  }
  const [cr, cg, cb] = parseColor(color);
  const grad = g.createRadialGradient(x, y, 0, x, y, r);
  grad.addColorStop(0, `rgba(${cr},${cg},${cb},1)`);
  grad.addColorStop(Math.max(0, Math.min(0.99, hardness)), `rgba(${cr},${cg},${cb},1)`);
  grad.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}

/** Dabs along a segment, spaced by a quarter of the brush. */
export function strokeSegment(
  g: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  size: number,
  hardness: number,
  color: string,
) {
  const dist = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(1, size / 4);
  const n = Math.max(1, Math.ceil(dist / step));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    dab(g, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, size, hardness, color);
  }
}
