import * as React from "react";
import {
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  ArrowLeftRight,
  Blend,
  Brush,
  Crop,
  Eraser,
  Hand,
  type LucideIcon,
  Move,
  PaintBucket,
  Pipette,
  Shapes,
  SquareDashed,
  Type,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/shared/lib/cn";

import { CreativeShell, isTyping, type Menu, NumberField, Panel } from "./CreativeShell";
import { closeEditor, exportFile, saveToCreate } from "./editorStore";
import {
  applyFilter,
  boundsOf,
  composite,
  ctx2d,
  dab,
  drawContent,
  drawLayer,
  type FilterName,
  floodFill,
  fontOf,
  loadRasters,
  makeCanvas,
  measureText,
  rasterCanvas,
  scaledCopy,
  strokeSegment,
  toHex,
} from "./imageEngine";
import {
  type Adjust,
  IMAGE_FONTS,
  type ImageFile,
  type ImageLayer,
  newId,
  type ShapeLayer,
  type TextLayer,
} from "./imageFormat";
import { AdjustmentsPanel, ColorPanel, HistoryPanel, LayersPanel, PropertiesPanel } from "./ImagePanels";
import { editorRequest } from "./requests";

type Tool =
  | "move"
  | "marquee"
  | "brush"
  | "eraser"
  | "fill"
  | "gradient"
  | "eyedropper"
  | "text"
  | "shape"
  | "crop"
  | "hand"
  | "zoom";

const TOOLS: { id: Tool; icon: LucideIcon; label: string; key: string }[] = [
  { id: "move", icon: Move, label: "Move", key: "V" },
  { id: "marquee", icon: SquareDashed, label: "Rectangular Marquee", key: "M" },
  { id: "crop", icon: Crop, label: "Crop", key: "C" },
  { id: "eyedropper", icon: Pipette, label: "Eyedropper", key: "I" },
  { id: "brush", icon: Brush, label: "Brush", key: "B" },
  { id: "eraser", icon: Eraser, label: "Eraser", key: "E" },
  { id: "fill", icon: PaintBucket, label: "Paint Bucket", key: "G" },
  { id: "gradient", icon: Blend, label: "Gradient", key: "Shift+G" },
  { id: "text", icon: Type, label: "Type", key: "T" },
  { id: "shape", icon: Shapes, label: "Shape", key: "U" },
  { id: "hand", icon: Hand, label: "Hand", key: "H" },
  { id: "zoom", icon: ZoomIn, label: "Zoom", key: "Z" },
];

const CURSOR: Record<Tool, string> = {
  move: "move",
  marquee: "crosshair",
  brush: "none",
  eraser: "none",
  fill: "crosshair",
  gradient: "crosshair",
  eyedropper: "crosshair",
  text: "text",
  shape: "crosshair",
  crop: "crosshair",
  hand: "grab",
  zoom: "zoom-in",
};

const PRESETS = [
  { label: "HD 1920 × 1080", w: 1920, h: 1080 },
  { label: "Square 1080 × 1080", w: 1080, h: 1080 },
  { label: "Story 1080 × 1920", w: 1080, h: 1920 },
  { label: "Banner 1200 × 628", w: 1200, h: 628 },
  { label: "Thumbnail 1280 × 720", w: 1280, h: 720 },
  { label: "A4 print 2480 × 3508", w: 2480, h: 3508 },
  { label: "Icon 512 × 512", w: 512, h: 512 },
];

type Doc = { width: number; height: number; layers: ImageLayer[] };
type Rect = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };
type Snap = { label: string; doc: Doc; pixels: Map<string, ImageData> };
type Drag =
  | { tool: "move"; id: string; start: Pt; orig: Pt }
  | { tool: "marquee" | "crop"; start: Pt }
  | { tool: "brush" | "eraser"; id: string; last: Pt; stroke: HTMLCanvasElement }
  | { tool: "gradient"; id: string; start: Pt; end: Pt }
  | { tool: "shape"; id: string; start: Pt }
  | { tool: "hand"; client: Pt; scroll: Pt };

const norm = (a: Pt, b: Pt): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  w: Math.abs(b.x - a.x),
  h: Math.abs(b.y - a.y),
});

export function ImageEditor({
  title: initialTitle,
  file,
  series: initialSeries,
  path,
  artifactId,
}: {
  title: string;
  file: ImageFile;
  series?: string;
  path?: string;
  artifactId?: string;
}) {
  const [title, setTitle] = React.useState(initialTitle);
  const [series, setSeries] = React.useState(initialSeries);
  const [saved, setSaved] = React.useState<{ id: string; path?: string } | null>(
    artifactId ? { id: artifactId, path } : null,
  );
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [ready, setReady] = React.useState(false);
  const [askSize, setAskSize] = React.useState(!artifactId);
  const [dialog, setDialog] = React.useState<null | "image-size" | "canvas-size">(null);

  const strip = (l: ImageLayer): ImageLayer => (l.kind === "raster" ? { ...l, src: "", w: undefined, h: undefined } : l);
  const [doc, setDocState] = React.useState<Doc>(() => ({
    width: file.width,
    height: file.height,
    layers: file.layers.map(strip),
  }));
  const docRef = React.useRef(doc);
  const setDoc = React.useCallback((next: Doc | ((d: Doc) => Doc)) => {
    const v = typeof next === "function" ? next(docRef.current) : next;
    docRef.current = v;
    setDocState(v);
  }, []);
  const rasters = React.useRef(new Map<string, HTMLCanvasElement>());
  const [tick, setTick] = React.useState(0);
  const bump = () => setTick((t) => t + 1);

  const [active, setActiveState] = React.useState(file.layers.at(-1)?.id ?? "");
  const activeRef = React.useRef(active);
  const setActive = (id: string) => {
    activeRef.current = id;
    setActiveState(id);
  };

  const [tool, setTool] = React.useState<Tool>("brush");
  const [fg, setFg] = React.useState("#000000");
  const [bg, setBg] = React.useState("#ffffff");
  const [brush, setBrush] = React.useState({ size: 24, hardness: 80, opacity: 100 });
  const [tolerance, setTolerance] = React.useState(32);
  const [gradientKind, setGradientKind] = React.useState<"linear" | "radial">("linear");
  const [shapeKind, setShapeKind] = React.useState<ShapeLayer["shape"]>("rect");
  const [shapeStroke, setShapeStroke] = React.useState({ color: "transparent", width: 0, radius: 0 });
  const [typeOpts, setTypeOpts] = React.useState({ font: "Inter", size: 96, bold: false, italic: false });
  const [autoSelect, setAutoSelect] = React.useState(true);
  const [sel, setSelState] = React.useState<Rect | null>(null);
  const selRef = React.useRef<Rect | null>(null);
  const setSel = (r: Rect | null) => {
    selRef.current = r;
    setSelState(r);
  };
  const [cropRect, setCropRect] = React.useState<Rect | null>(null);
  const [zoom, setZoom] = React.useState(0.5);
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  const [editingText, setEditingText] = React.useState<string | null>(null);
  const editingRef = React.useRef<string | null>(null);
  editingRef.current = editingText;
  const [midTab, setMidTab] = React.useState("Properties");
  const [cursorPos, setCursorPos] = React.useState<Pt | null>(null);
  const space = React.useRef(false);
  const [spaceHeld, setSpaceHeld] = React.useState(false);

  const view = React.useRef<HTMLCanvasElement>(null);
  const stage = React.useRef<HTMLDivElement>(null);
  const scroller = React.useRef<HTMLDivElement>(null);
  const brushCursor = React.useRef<HTMLDivElement>(null);
  const placeInput = React.useRef<HTMLInputElement>(null);
  const drag = React.useRef<Drag | null>(null);
  const live = React.useRef<{ id: string; paint: (c: CanvasRenderingContext2D) => void } | null>(null);

  // ---- history ---------------------------------------------------------
  const hist = React.useRef<Snap[]>([]);
  const hIndex = React.useRef(-1);
  const [, setHistVersion] = React.useState(0);

  const commit = React.useCallback(
    (label: string, changed?: string[]) => {
      const d = docRef.current;
      const prev = hist.current[hIndex.current];
      const pixels = new Map<string, ImageData>();
      for (const l of d.layers) {
        if (l.kind !== "raster") continue;
        const c = rasters.current.get(l.id);
        if (!c) continue;
        const reuse = prev?.pixels.get(l.id);
        if (reuse && changed && !changed.includes(l.id) && reuse.width === c.width && reuse.height === c.height) {
          pixels.set(l.id, reuse);
        } else {
          pixels.set(l.id, ctx2d(c).getImageData(0, 0, c.width, c.height));
        }
      }
      hist.current = hist.current.slice(0, hIndex.current + 1);
      hist.current.push({ label, doc: d, pixels });
      if (hist.current.length > 40) hist.current.shift();
      hIndex.current = hist.current.length - 1;
      setHistVersion((v) => v + 1);
      if (label !== "Open") setDirty(true);
    },
    [],
  );

  const restore = (i: number) => {
    const s = hist.current[i];
    if (!s) return;
    hIndex.current = i;
    for (const [id, data] of s.pixels) {
      let c = rasters.current.get(id);
      if (!c || c.width !== data.width || c.height !== data.height) {
        c = makeCanvas(data.width, data.height);
        rasters.current.set(id, c);
      }
      ctx2d(c).putImageData(data, 0, 0);
    }
    setDoc(s.doc);
    if (!s.doc.layers.some((l) => l.id === activeRef.current)) setActive(s.doc.layers.at(-1)?.id ?? "");
    setSel(null);
    setEditingText(null);
    setDirty(true);
    bump();
    setHistVersion((v) => v + 1);
  };
  const undo = () => restore(hIndex.current - 1);
  const redo = () => restore(hIndex.current + 1);

  // Commit a burst of edits (typing in a panel) as one step.
  const pendingCommit = React.useRef<number | null>(null);
  const commitSoon = (label: string) => {
    if (pendingCommit.current) window.clearTimeout(pendingCommit.current);
    pendingCommit.current = window.setTimeout(() => {
      pendingCommit.current = null;
      commit(label, []);
    }, 350);
  };

  // ---- loading ---------------------------------------------------------
  // biome-ignore lint/correctness/useExhaustiveDependencies: load once
  React.useEffect(() => {
    let alive = true;
    loadRasters(file).then((m) => {
      if (!alive) return;
      rasters.current = m;
      setReady(true);
      commit("Open");
      requestAnimationFrame(fit);
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---- drawing ---------------------------------------------------------
  const scheduled = React.useRef(false);
  const draw = React.useCallback(() => {
    const c = view.current;
    if (!c) return;
    const d = docRef.current;
    if (c.width !== d.width) c.width = d.width;
    if (c.height !== d.height) c.height = d.height;
    const g = ctx2d(c);
    g.clearRect(0, 0, c.width, c.height);
    const layers = editingRef.current ? d.layers.filter((l) => l.id !== editingRef.current) : d.layers;
    composite(g, layers, rasters.current, live.current ?? undefined);
  }, []);
  const requestDraw = React.useCallback(() => {
    if (scheduled.current) return;
    scheduled.current = true;
    requestAnimationFrame(() => {
      scheduled.current = false;
      draw();
    });
  }, [draw]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: redraw on any change
  React.useEffect(() => {
    if (ready) requestDraw();
  }, [doc, tick, ready, editingText, requestDraw]);

  const fit = () => {
    const s = scroller.current;
    if (!s) return;
    const d = docRef.current;
    const z = Math.min(1, (s.clientWidth - 96) / d.width, (s.clientHeight - 96) / d.height);
    setZoom(Math.max(0.02, z));
  };
  const zoomBy = (k: number) => setZoom((z) => Math.min(32, Math.max(0.02, z * k)));

  // ---- layer helpers ---------------------------------------------------
  const layerOf = (id: string) => docRef.current.layers.find((l) => l.id === id);
  const activeLayer = doc.layers.find((l) => l.id === active);

  const updateLayer = (id: string, patch: Partial<ImageLayer>) =>
    setDoc((d) => ({ ...d, layers: d.layers.map((l) => (l.id === id ? ({ ...l, ...patch } as ImageLayer) : l)) }));

  const insertAbove = (layer: ImageLayer, canvas?: HTMLCanvasElement, label = "New layer") => {
    if (canvas) rasters.current.set(layer.id, canvas);
    setDoc((d) => {
      const i = d.layers.findIndex((l) => l.id === activeRef.current);
      const layers = [...d.layers];
      layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
      return { ...d, layers };
    });
    setActive(layer.id);
    commit(label, canvas ? [layer.id] : []);
    bump();
  };

  const emptyRaster = (name?: string): RasterLayerMeta => ({
    id: newId(),
    kind: "raster",
    name: name ?? `Layer ${docRef.current.layers.length}`,
    visible: true,
    opacity: 1,
    blend: "normal",
    x: 0,
    y: 0,
    src: "",
  });
  const addLayer = () => {
    const d = docRef.current;
    insertAbove(emptyRaster(), makeCanvas(d.width, d.height));
  };

  /** The active layer's pixels, making a new pixel layer when the active one
   *  is type or a shape (so painting never changes those). */
  const paintTarget = (forErase = false): { id: string; layer: ImageLayer; canvas: HTMLCanvasElement } | null => {
    const l = layerOf(activeRef.current);
    if (l?.kind === "raster") {
      const c = rasters.current.get(l.id);
      if (c) {
        if (!l.visible) toast.message("That layer is hidden");
        return { id: l.id, layer: l, canvas: c };
      }
    }
    if (forErase) {
      toast.message("Rasterize the layer first (Layer → Rasterize) to erase it");
      return null;
    }
    const d = docRef.current;
    const layer = emptyRaster();
    const canvas = makeCanvas(d.width, d.height);
    rasters.current.set(layer.id, canvas);
    const layers = [...d.layers];
    const i = layers.findIndex((x) => x.id === activeRef.current);
    layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
    setDoc({ ...d, layers });
    setActive(layer.id);
    return { id: layer.id, layer, canvas };
  };

  const duplicate = () => {
    const l = layerOf(activeRef.current);
    if (!l) return;
    const copy = { ...l, id: newId(), name: `${l.name} copy` } as ImageLayer;
    let canvas: HTMLCanvasElement | undefined;
    const src = rasters.current.get(l.id);
    if (l.kind === "raster" && src) {
      canvas = makeCanvas(src.width, src.height);
      ctx2d(canvas).drawImage(src, 0, 0);
    }
    insertAbove(copy, canvas, "Duplicate layer");
  };

  const deleteLayer = () => {
    const d = docRef.current;
    if (d.layers.length <= 1) return;
    const i = d.layers.findIndex((l) => l.id === activeRef.current);
    if (i < 0) return;
    const layers = d.layers.filter((_, j) => j !== i);
    setDoc({ ...d, layers });
    setActive(layers[Math.max(0, i - 1)].id);
    commit("Delete layer", []);
  };

  const moveLayer = (dir: 1 | -1) => {
    const d = docRef.current;
    const i = d.layers.findIndex((l) => l.id === activeRef.current);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= d.layers.length) return;
    const layers = [...d.layers];
    [layers[i], layers[j]] = [layers[j], layers[i]];
    setDoc({ ...d, layers });
    commit(dir > 0 ? "Bring forward" : "Send backward", []);
  };

  const mergeDown = () => {
    const d = docRef.current;
    const i = d.layers.findIndex((l) => l.id === activeRef.current);
    if (i <= 0) return;
    const top = d.layers[i];
    const below = d.layers[i - 1];
    const c = makeCanvas(d.width, d.height);
    const g = ctx2d(c);
    drawLayer(g, below, rasters.current.get(below.id));
    drawLayer(g, top, rasters.current.get(top.id));
    const merged: ImageLayer = { ...emptyRaster(below.name), visible: true };
    rasters.current.set(merged.id, c);
    const layers = [...d.layers];
    layers.splice(i - 1, 2, merged);
    setDoc({ ...d, layers });
    setActive(merged.id);
    commit("Merge down", [merged.id]);
    bump();
  };

  const flatten = () => {
    const d = docRef.current;
    const c = makeCanvas(d.width, d.height);
    const g = ctx2d(c);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, c.width, c.height);
    composite(g, d.layers, rasters.current);
    const layer = emptyRaster("Background");
    rasters.current.set(layer.id, c);
    setDoc({ ...d, layers: [layer] });
    setActive(layer.id);
    commit("Flatten image", [layer.id]);
    bump();
  };

  const rasterize = () => {
    const d = docRef.current;
    const l = layerOf(activeRef.current);
    if (!l || l.kind === "raster") return;
    const c = makeCanvas(d.width, d.height);
    drawContent(ctx2d(c), l);
    const r: ImageLayer = {
      ...emptyRaster(l.name),
      visible: l.visible,
      opacity: l.opacity,
      blend: l.blend,
      ...(l.adjust ? { adjust: l.adjust } : {}),
    };
    rasters.current.set(r.id, c);
    setDoc({ ...d, layers: d.layers.map((x) => (x.id === l.id ? r : x)) });
    setActive(r.id);
    commit("Rasterize layer", [r.id]);
    bump();
  };

  // ---- whole-image operations -----------------------------------------
  const transformAll = (
    label: string,
    w: number,
    h: number,
    point: (p: Pt) => Pt,
    raster: (c: HTMLCanvasElement, l: ImageLayer) => { canvas: HTMLCanvasElement; x: number; y: number },
    scaleText = 1,
  ) => {
    const d = docRef.current;
    const layers = d.layers.map((l): ImageLayer => {
      if (l.kind === "raster") {
        const c = rasters.current.get(l.id);
        if (!c) return l;
        const r = raster(c, l);
        rasters.current.set(l.id, r.canvas);
        return { ...l, x: r.x, y: r.y };
      }
      if (l.kind === "shape") {
        const a = point({ x: l.x, y: l.y });
        const b = point({ x: l.x + l.w, y: l.y + l.h });
        return {
          ...l,
          x: a.x,
          y: a.y,
          w: b.x - a.x,
          h: b.y - a.y,
          strokeWidth: l.strokeWidth * scaleText,
          radius: (l.radius ?? 0) * scaleText,
        };
      }
      const sized = { ...l, size: l.size * scaleText };
      const b = boundsOf(l);
      const c = point({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
      const m = measureText(sized);
      const x = sized.align === "center" ? c.x : sized.align === "right" ? c.x + m.w / 2 : c.x - m.w / 2;
      return { ...sized, x, y: c.y - m.h / 2 };
    });
    setDoc({ width: Math.round(w), height: Math.round(h), layers });
    setSel(null);
    setCropRect(null);
    commit(label);
    bump();
    requestAnimationFrame(fit);
  };

  const rotate = (cw: boolean) => {
    const { width: W, height: H } = docRef.current;
    transformAll(
      cw ? "Rotate 90° clockwise" : "Rotate 90° counter-clockwise",
      H,
      W,
      (p) => (cw ? { x: H - p.y, y: p.x } : { x: p.y, y: W - p.x }),
      (c, l) => {
        const out = makeCanvas(c.height, c.width);
        const g = ctx2d(out);
        if (cw) {
          g.translate(c.height, 0);
          g.rotate(Math.PI / 2);
        } else {
          g.translate(0, c.width);
          g.rotate(-Math.PI / 2);
        }
        g.drawImage(c, 0, 0);
        return cw ? { canvas: out, x: H - (l.y + c.height), y: l.x } : { canvas: out, x: l.y, y: W - (l.x + c.width) };
      },
    );
  };

  const flipCanvas = (horizontal: boolean) => {
    const { width: W, height: H } = docRef.current;
    transformAll(
      horizontal ? "Flip canvas horizontal" : "Flip canvas vertical",
      W,
      H,
      (p) => (horizontal ? { x: W - p.x, y: p.y } : { x: p.x, y: H - p.y }),
      (c, l) => {
        const out = flipped(c, horizontal);
        return horizontal ? { canvas: out, x: W - (l.x + c.width), y: l.y } : { canvas: out, x: l.x, y: H - (l.y + c.height) };
      },
    );
  };

  const resizeImage = (w: number, h: number) => {
    const { width: W, height: H } = docRef.current;
    const kx = w / W;
    const ky = h / H;
    transformAll(
      "Image size",
      w,
      h,
      (p) => ({ x: p.x * kx, y: p.y * ky }),
      (c, l) => {
        const out = makeCanvas(c.width * kx, c.height * ky);
        const g = ctx2d(out);
        g.imageSmoothingQuality = "high";
        g.drawImage(c, 0, 0, out.width, out.height);
        return { canvas: out, x: l.x * kx, y: l.y * ky };
      },
      (kx + ky) / 2,
    );
  };

  const canvasSize = (w: number, h: number) => {
    const { width: W, height: H } = docRef.current;
    const dx = Math.round((w - W) / 2);
    const dy = Math.round((h - H) / 2);
    transformAll(
      "Canvas size",
      w,
      h,
      (p) => ({ x: p.x + dx, y: p.y + dy }),
      (c, l) => ({ canvas: c, x: l.x + dx, y: l.y + dy }),
    );
  };

  const cropTo = (r: Rect) => {
    const rr = { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) };
    if (rr.w < 2 || rr.h < 2) return;
    transformAll(
      "Crop",
      rr.w,
      rr.h,
      (p) => ({ x: p.x - rr.x, y: p.y - rr.y }),
      (c, l) => {
        // Keep only what's inside the new canvas.
        const x0 = Math.max(l.x, rr.x);
        const y0 = Math.max(l.y, rr.y);
        const x1 = Math.min(l.x + c.width, rr.x + rr.w);
        const y1 = Math.min(l.y + c.height, rr.y + rr.h);
        if (x1 <= x0 || y1 <= y0) return { canvas: makeCanvas(1, 1), x: 0, y: 0 };
        const out = makeCanvas(x1 - x0, y1 - y0);
        ctx2d(out).drawImage(c, l.x - x0, l.y - y0);
        return { canvas: out, x: x0 - rr.x, y: y0 - rr.y };
      },
    );
  };

  const newDocument = (w: number, h: number) => {
    const c = makeCanvas(w, h);
    const g = ctx2d(c);
    g.fillStyle = "#ffffff";
    g.fillRect(0, 0, w, h);
    const layer = emptyRaster("Background");
    rasters.current = new Map([[layer.id, c]]);
    setDoc({ width: w, height: h, layers: [layer] });
    setActive(layer.id);
    hist.current = [];
    hIndex.current = -1;
    commit("New");
    setDirty(false);
    setAskSize(false);
    bump();
    requestAnimationFrame(fit);
  };

  const flipLayer = (horizontal: boolean) => {
    const l = layerOf(activeRef.current);
    const c = l && rasters.current.get(l.id);
    if (!l || l.kind !== "raster" || !c) return toast.message("Flip works on pixel layers");
    rasters.current.set(l.id, flipped(c, horizontal));
    commit(horizontal ? "Flip layer horizontal" : "Flip layer vertical", [l.id]);
    bump();
  };

  const filter = (name: FilterName, label: string, amount?: number) => {
    const l = layerOf(activeRef.current);
    const c = l && rasters.current.get(l.id);
    if (!l || l.kind !== "raster" || !c) return toast.message("Filters work on pixel layers (Layer → Rasterize)");
    applyFilter(c, name, amount);
    commit(label, [l.id]);
    bump();
  };

  const fillSelection = (color: string, label = "Fill") => {
    const t = paintTarget();
    if (!t) return;
    const r = selRef.current ?? { x: 0, y: 0, w: docRef.current.width, h: docRef.current.height };
    const g = ctx2d(t.canvas);
    g.fillStyle = color;
    g.fillRect(r.x - t.layer.x, r.y - t.layer.y, r.w, r.h);
    commit(label, [t.id]);
    bump();
  };

  const clearSelection = () => {
    const l = layerOf(activeRef.current);
    const c = l && rasters.current.get(l.id);
    const r = selRef.current;
    if (!l || !c || l.kind !== "raster") return;
    if (!r) return toast.message("Select an area first (M)");
    ctx2d(c).clearRect(r.x - l.x, r.y - l.y, r.w, r.h);
    commit("Clear", [l.id]);
    bump();
  };

  const align = (where: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom") => {
    const l = layerOf(activeRef.current);
    if (!l) return;
    const d = docRef.current;
    const area = selRef.current ?? { x: 0, y: 0, w: d.width, h: d.height };
    const b = boundsOf(l, rasters.current.get(l.id));
    let dx = 0;
    let dy = 0;
    if (where === "left") dx = area.x - b.x;
    if (where === "hcenter") dx = area.x + area.w / 2 - (b.x + b.w / 2);
    if (where === "right") dx = area.x + area.w - (b.x + b.w);
    if (where === "top") dy = area.y - b.y;
    if (where === "vcenter") dy = area.y + area.h / 2 - (b.y + b.h / 2);
    if (where === "bottom") dy = area.y + area.h - (b.y + b.h);
    updateLayer(l.id, { x: l.x + dx, y: l.y + dy });
    commit("Align", []);
  };

  // ---- placing pictures ------------------------------------------------
  const place = async (src: string, name: string) => {
    try {
      let c = await rasterCanvas(src);
      const d = docRef.current;
      const k = Math.min(1, d.width / c.width, d.height / c.height);
      if (k < 1) c = scaledCopy(c, Math.max(c.width, c.height) * k);
      const layer: ImageLayer = {
        ...emptyRaster(name.replace(/\.[a-z0-9]+$/i, "").slice(0, 40) || "Picture"),
        x: Math.round((d.width - c.width) / 2),
        y: Math.round((d.height - c.height) / 2),
      };
      insertAbove(layer, c, "Place");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };
  const placeFile = (f: File) => {
    if (!f.type.startsWith("image/")) return toast.error("That isn't a picture");
    const r = new FileReader();
    r.onload = () => void place(String(r.result), f.name);
    r.readAsDataURL(f);
  };

  React.useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (isTyping(e)) return;
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith("image/"));
      if (f) {
        e.preventDefault();
        placeFile(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  // ---- pointer ---------------------------------------------------------
  const docPoint = (e: { clientX: number; clientY: number }): Pt => {
    const r = view.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (e.clientX - r.left) / zoomRef.current, y: (e.clientY - r.top) / zoomRef.current };
  };

  const hitLayer = (p: Pt): string | null => {
    const layers = docRef.current.layers;
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.visible) continue;
      const c = rasters.current.get(l.id);
      const b = boundsOf(l, c);
      if (p.x < b.x || p.y < b.y || p.x > b.x + b.w || p.y > b.y + b.h) continue;
      if (l.kind === "raster" && c) {
        const px = Math.floor(p.x - l.x);
        const py = Math.floor(p.y - l.y);
        if (px < 0 || py < 0 || px >= c.width || py >= c.height) continue;
        if (ctx2d(c).getImageData(px, py, 1, 1).data[3] < 10) continue;
      }
      return l.id;
    }
    return null;
  };

  const clipToSel = (g: CanvasRenderingContext2D, offset: Pt = { x: 0, y: 0 }) => {
    const r = selRef.current;
    if (!r) return;
    g.beginPath();
    g.rect(r.x - offset.x, r.y - offset.y, r.w, r.h);
    g.clip();
  };

  const gradientOf = (g: CanvasRenderingContext2D, a: Pt, b: Pt) => {
    const grad =
      gradientKind === "radial"
        ? g.createRadialGradient(a.x, a.y, 0, a.x, a.y, Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)))
        : g.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, fg);
    grad.addColorStop(1, bg);
    return grad;
  };

  const effTool: Tool = spaceHeld ? "hand" : tool;

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !ready) return;
    if (editingRef.current) {
      finishText();
      if (effTool === "text") return;
    }
    const p = docPoint(e);
    const t = effTool;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // not a live pointer (synthetic event)
    }
    if (t === "hand") {
      const s = scroller.current;
      drag.current = { tool: "hand", client: { x: e.clientX, y: e.clientY }, scroll: { x: s?.scrollLeft ?? 0, y: s?.scrollTop ?? 0 } };
      return;
    }
    if (t === "zoom") {
      zoomBy(e.altKey ? 1 / 1.5 : 1.5);
      return;
    }
    if (t === "eyedropper") {
      const c = view.current;
      if (!c) return;
      const px = ctx2d(c).getImageData(Math.floor(p.x), Math.floor(p.y), 1, 1).data;
      const hex = toHex(px[0], px[1], px[2]);
      if (e.altKey) setBg(hex);
      else setFg(hex);
      return;
    }
    if (t === "move") {
      let id = activeRef.current;
      if (autoSelect) {
        const hit = hitLayer(p);
        if (hit) {
          id = hit;
          setActive(hit);
        }
      }
      const l = layerOf(id);
      if (!l) return;
      drag.current = { tool: "move", id, start: p, orig: { x: l.x, y: l.y } };
      return;
    }
    if (t === "marquee" || t === "crop") {
      drag.current = { tool: t, start: p };
      if (t === "marquee") setSel(null);
      else setCropRect(null);
      return;
    }
    if (t === "brush" || t === "eraser") {
      const target = paintTarget(t === "eraser");
      if (!target) return;
      const d = docRef.current;
      const stroke = makeCanvas(d.width, d.height);
      const g = ctx2d(stroke);
      clipToSel(g);
      dab(g, p.x, p.y, brush.size, brush.hardness / 100, fg);
      drag.current = { tool: t, id: target.id, last: p, stroke };
      const alpha = brush.opacity / 100;
      live.current = {
        id: target.id,
        paint: (c) => {
          c.save();
          c.globalAlpha = alpha;
          if (t === "eraser") c.globalCompositeOperation = "destination-out";
          c.drawImage(stroke, 0, 0);
          c.restore();
        },
      };
      requestDraw();
      return;
    }
    if (t === "fill") {
      const target = paintTarget();
      if (!target) return;
      const r = selRef.current;
      const ok = floodFill(
        target.canvas,
        p.x - target.layer.x,
        p.y - target.layer.y,
        fg,
        tolerance,
        r ? { x: r.x - target.layer.x, y: r.y - target.layer.y, w: r.w, h: r.h } : null,
      );
      if (ok) {
        commit("Paint bucket", [target.id]);
        bump();
      }
      return;
    }
    if (t === "gradient") {
      const target = paintTarget();
      if (!target) return;
      drag.current = { tool: "gradient", id: target.id, start: p, end: p };
      return;
    }
    if (t === "text") {
      const hit = hitLayer(p);
      const hl = hit ? layerOf(hit) : undefined;
      if (hl?.kind === "text") {
        setActive(hl.id);
        setEditingText(hl.id);
        return;
      }
      const layer: TextLayer = {
        id: newId(),
        kind: "text",
        name: "Text",
        visible: true,
        opacity: 1,
        blend: "normal",
        x: p.x,
        y: p.y - typeOpts.size * 0.6,
        text: "",
        font: typeOpts.font,
        size: typeOpts.size,
        color: fg,
        bold: typeOpts.bold,
        italic: typeOpts.italic,
        align: "left",
      };
      setDoc((d) => {
        const i = d.layers.findIndex((l) => l.id === activeRef.current);
        const layers = [...d.layers];
        layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
        return { ...d, layers };
      });
      setActive(layer.id);
      setEditingText(layer.id);
      return;
    }
    if (t === "shape") {
      const layer: ShapeLayer = {
        id: newId(),
        kind: "shape",
        name: shapeKind === "rect" ? "Rectangle" : shapeKind === "ellipse" ? "Ellipse" : "Line",
        visible: true,
        opacity: 1,
        blend: "normal",
        x: p.x,
        y: p.y,
        w: 0,
        h: 0,
        shape: shapeKind,
        fill: shapeKind === "line" ? "transparent" : fg,
        stroke: shapeKind === "line" ? fg : shapeStroke.color,
        strokeWidth: shapeKind === "line" ? Math.max(2, shapeStroke.width || 6) : shapeStroke.width,
        radius: shapeStroke.radius,
      };
      setDoc((d) => {
        const i = d.layers.findIndex((l) => l.id === activeRef.current);
        const layers = [...d.layers];
        layers.splice(i < 0 ? layers.length : i + 1, 0, layer);
        return { ...d, layers };
      });
      setActive(layer.id);
      drag.current = { tool: "shape", id: layer.id, start: p };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = docPoint(e);
    setCursorPos({ x: Math.round(p.x), y: Math.round(p.y) });
    const bc = brushCursor.current;
    if (bc) {
      const r = view.current?.getBoundingClientRect();
      const sr = stage.current?.getBoundingClientRect();
      if (r && sr) {
        const size = brush.size * zoomRef.current;
        bc.style.width = `${size}px`;
        bc.style.height = `${size}px`;
        bc.style.transform = `translate(${e.clientX - sr.left - size / 2}px, ${e.clientY - sr.top - size / 2}px)`;
      }
    }
    const d = drag.current;
    if (!d) return;
    if (d.tool === "hand") {
      const s = scroller.current;
      if (s) {
        s.scrollLeft = d.scroll.x - (e.clientX - d.client.x);
        s.scrollTop = d.scroll.y - (e.clientY - d.client.y);
      }
    } else if (d.tool === "move") {
      updateLayer(d.id, { x: Math.round(d.orig.x + p.x - d.start.x), y: Math.round(d.orig.y + p.y - d.start.y) });
    } else if (d.tool === "marquee") {
      setSel(clampRect(norm(d.start, p)));
    } else if (d.tool === "crop") {
      setCropRect(clampRect(norm(d.start, p)));
    } else if (d.tool === "brush" || d.tool === "eraser") {
      strokeSegment(ctx2d(d.stroke), d.last, p, brush.size, brush.hardness / 100, fg);
      d.last = p;
      requestDraw();
    } else if (d.tool === "gradient") {
      d.end = p;
      const a = d.start;
      live.current = {
        id: d.id,
        paint: (c) => {
          c.save();
          clipToSel(c);
          c.fillStyle = gradientOf(c, a, p);
          c.fillRect(0, 0, c.canvas.width, c.canvas.height);
          c.restore();
        },
      };
      requestDraw();
    } else if (d.tool === "shape") {
      let w = p.x - d.start.x;
      let h = p.y - d.start.y;
      if (e.shiftKey) {
        const s = Math.max(Math.abs(w), Math.abs(h));
        w = Math.sign(w || 1) * s;
        h = Math.sign(h || 1) * s;
      }
      updateLayer(d.id, { w, h } as Partial<ImageLayer>);
    }
  };

  const clampRect = (r: Rect): Rect => {
    const { width: W, height: H } = docRef.current;
    const x = Math.max(0, Math.round(r.x));
    const y = Math.max(0, Math.round(r.y));
    return { x, y, w: Math.min(W, Math.round(r.x + r.w)) - x, h: Math.min(H, Math.round(r.y + r.h)) - y };
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.tool === "move") {
      const l = layerOf(d.id);
      if (l && (l.x !== d.orig.x || l.y !== d.orig.y)) commit("Move", []);
    } else if (d.tool === "marquee") {
      if (selRef.current && (selRef.current.w < 2 || selRef.current.h < 2)) setSel(null);
    } else if (d.tool === "crop") {
      setCropRect((r) => (r && r.w >= 2 && r.h >= 2 ? r : null));
    } else if (d.tool === "brush" || d.tool === "eraser") {
      const l = layerOf(d.id);
      const c = rasters.current.get(d.id);
      if (l && c) {
        const g = ctx2d(c);
        g.save();
        g.globalAlpha = brush.opacity / 100;
        if (d.tool === "eraser") g.globalCompositeOperation = "destination-out";
        g.drawImage(d.stroke, -l.x, -l.y);
        g.restore();
      }
      live.current = null;
      commit(d.tool === "brush" ? "Brush" : "Eraser", [d.id]);
      bump();
    } else if (d.tool === "gradient") {
      live.current = null;
      const l = layerOf(d.id);
      const c = rasters.current.get(d.id);
      if (l && c && Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y) > 2) {
        const g = ctx2d(c);
        g.save();
        g.translate(-l.x, -l.y);
        clipToSel(g);
        g.fillStyle = gradientOf(g, d.start, d.end);
        g.fillRect(0, 0, docRef.current.width, docRef.current.height);
        g.restore();
        commit("Gradient", [d.id]);
      }
      bump();
    } else if (d.tool === "shape") {
      const l = layerOf(d.id) as ShapeLayer | undefined;
      if (l && Math.abs(l.w) < 3 && Math.abs(l.h) < 3) {
        setDoc((doc0) => ({ ...doc0, layers: doc0.layers.filter((x) => x.id !== d.id) }));
        setActive(docRef.current.layers.at(-1)?.id ?? "");
      } else commit("Shape", []);
    }
  };

  const finishText = () => {
    const id = editingRef.current;
    if (!id) return;
    setEditingText(null);
    const l = layerOf(id) as TextLayer | undefined;
    if (!l) return;
    if (!l.text.trim()) {
      setDoc((d) => ({ ...d, layers: d.layers.filter((x) => x.id !== id) }));
      setActive(docRef.current.layers.at(-1)?.id ?? "");
      return;
    }
    updateLayer(id, { name: l.text.split("\n")[0].slice(0, 30) || "Text" });
    commit("Type", []);
  };

  // Ctrl + wheel zooms, like the pro apps.
  React.useEffect(() => {
    const s = scroller.current;
    if (!s) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.altKey) return;
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };
    s.addEventListener("wheel", onWheel, { passive: false });
    return () => s.removeEventListener("wheel", onWheel);
  }, []);

  // ---- keyboard --------------------------------------------------------
  React.useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      const k = e.key.toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === " " && !space.current) {
        space.current = true;
        setSpaceHeld(true);
        e.preventDefault();
        return;
      }
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && k === "y") return (e.preventDefault(), redo());
      if (mod && k === "a") return (e.preventDefault(), setSel({ x: 0, y: 0, w: docRef.current.width, h: docRef.current.height }));
      if (mod && k === "d") return (e.preventDefault(), setSel(null));
      if (mod && k === "j") return (e.preventDefault(), duplicate());
      if (mod && k === "e") return (e.preventDefault(), mergeDown());
      if (mod && e.shiftKey && k === "n") return (e.preventDefault(), addLayer());
      if (mod && (k === "=" || k === "+")) return (e.preventDefault(), zoomBy(1.25));
      if (mod && k === "-") return (e.preventDefault(), zoomBy(0.8));
      if (mod && k === "0") return (e.preventDefault(), fit());
      if (mod && k === "1") return (e.preventDefault(), setZoom(1));
      if (mod) return;
      if (e.key === "Enter" && cropRect) return cropTo(cropRect), setCropRect(null);
      if (e.key === "Escape") {
        setCropRect(null);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") return clearSelection();
      if (e.key === "[") return setBrush((b) => ({ ...b, size: Math.max(1, Math.round(b.size / 1.2)) }));
      if (e.key === "]") return setBrush((b) => ({ ...b, size: Math.min(1000, Math.round(b.size * 1.2) + 1) }));
      if (k === "x") return (setFg(bg), setBg(fg));
      if (k === "d") return (setFg("#000000"), setBg("#ffffff"));
      if (k === "g" && e.shiftKey) return setTool("gradient");
      const t = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (t) setTool(t.id);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === " ") {
        space.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  });

  // ---- save / export ---------------------------------------------------
  const flat = (background?: string) => {
    const d = docRef.current;
    const c = makeCanvas(d.width, d.height);
    const g = ctx2d(c);
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, c.width, c.height);
    }
    composite(g, d.layers, rasters.current);
    return c;
  };

  const toFile = (): ImageFile => {
    const d = docRef.current;
    return {
      type: "image",
      version: 1,
      width: d.width,
      height: d.height,
      layers: d.layers.map((l) => {
        if (l.kind !== "raster") return l;
        const c = rasters.current.get(l.id);
        return { ...l, src: c ? c.toDataURL("image/png") : "" };
      }),
      preview: scaledCopy(flat(), 480).toDataURL("image/webp", 0.85),
    };
  };

  const save = async (): Promise<{ id: string; path?: string } | null> => {
    if (editingRef.current) finishText();
    setSaving(true);
    try {
      const r = await saveToCreate("image", title, toFile(), series);
      setSeries(r.series);
      setSaved({ id: r.id, path: r.path });
      setDirty(false);
      return { id: r.id, path: r.path };
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setSaving(false);
    }
  };

  const exportAs = async (ext: "png" | "jpg" | "webp") => {
    const mime = ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    const data = flat(ext === "jpg" ? "#ffffff" : undefined).toDataURL(mime, 0.92);
    try {
      const ok = await exportFile(`${title.trim() || "Untitled"}.${ext}`, data, ext, `${ext.toUpperCase()} image`, true);
      if (ok) toast.success("Exported");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  // ---- menus -----------------------------------------------------------
  const isRaster = activeLayer?.kind === "raster";
  const menus: Menu[] = [
    {
      label: "File",
      items: [
        { label: "New…", run: () => setAskSize(true) },
        { label: "Save to Create", run: () => void save(), shortcut: "Ctrl+S" },
        { label: "Place picture…", run: () => placeInput.current?.click(), shortcut: "Ctrl+V pastes" },
        "-",
        { label: "Export as PNG…", run: () => void exportAs("png") },
        { label: "Export as JPEG…", run: () => void exportAs("jpg") },
        { label: "Export as WebP…", run: () => void exportAs("webp") },
        "-",
        { label: "Close", run: () => closeEditor() },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: `Undo ${hist.current[hIndex.current]?.label ?? ""}`.trim(), run: undo, shortcut: "Ctrl+Z", disabled: hIndex.current <= 0 },
        { label: "Redo", run: redo, shortcut: "Ctrl+Shift+Z", disabled: hIndex.current >= hist.current.length - 1 },
        "-",
        { label: "Fill with foreground", run: () => fillSelection(fg) },
        { label: "Fill with background", run: () => fillSelection(bg) },
        { label: "Clear", run: clearSelection, shortcut: "Delete", disabled: !isRaster || !sel },
      ],
    },
    {
      label: "Image",
      items: [
        { label: "Image Size…", run: () => setDialog("image-size") },
        { label: "Canvas Size…", run: () => setDialog("canvas-size") },
        { label: "Crop to Selection", run: () => sel && cropTo(sel), disabled: !sel },
        "-",
        { label: "Rotate 90° Clockwise", run: () => rotate(true) },
        { label: "Rotate 90° Counter-clockwise", run: () => rotate(false) },
        { label: "Flip Canvas Horizontal", run: () => flipCanvas(true) },
        { label: "Flip Canvas Vertical", run: () => flipCanvas(false) },
      ],
    },
    {
      label: "Layer",
      items: [
        { label: "New Layer", run: addLayer, shortcut: "Ctrl+Shift+N" },
        { label: "Duplicate Layer", run: duplicate, shortcut: "Ctrl+J" },
        { label: "Delete Layer", run: deleteLayer, disabled: doc.layers.length <= 1 },
        "-",
        { label: "Rasterize", run: rasterize, disabled: !activeLayer || isRaster },
        { label: "Flip Layer Horizontal", run: () => flipLayer(true), disabled: !isRaster },
        { label: "Flip Layer Vertical", run: () => flipLayer(false), disabled: !isRaster },
        "-",
        { label: "Merge Down", run: mergeDown, shortcut: "Ctrl+E" },
        { label: "Flatten Image", run: flatten },
      ],
    },
    {
      label: "Select",
      items: [
        { label: "All", run: () => setSel({ x: 0, y: 0, w: doc.width, h: doc.height }), shortcut: "Ctrl+A" },
        { label: "Deselect", run: () => setSel(null), shortcut: "Ctrl+D", disabled: !sel },
        {
          label: "Layer Bounds",
          run: () => activeLayer && setSel(clampRect(boundsOf(activeLayer, rasters.current.get(activeLayer.id)))),
          disabled: !activeLayer,
        },
      ],
    },
    {
      label: "Filter",
      items: [
        { label: "Blur", run: () => filter("blur", "Blur", 2), disabled: !isRaster },
        { label: "Gaussian Blur (strong)", run: () => filter("blur", "Gaussian blur", 8), disabled: !isRaster },
        { label: "Sharpen", run: () => filter("sharpen", "Sharpen"), disabled: !isRaster },
        { label: "Add Noise", run: () => filter("noise", "Add noise"), disabled: !isRaster },
        { label: "Posterize", run: () => filter("posterize", "Posterize"), disabled: !isRaster },
        { label: "Emboss", run: () => filter("emboss", "Emboss"), disabled: !isRaster },
        "-",
        { label: "Black & White", run: () => filter("grayscale", "Black & white"), disabled: !isRaster },
        { label: "Sepia", run: () => filter("sepia", "Sepia"), disabled: !isRaster },
        { label: "Invert", run: () => filter("invert", "Invert"), disabled: !isRaster },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Zoom In", run: () => zoomBy(1.25), shortcut: "Ctrl++" },
        { label: "Zoom Out", run: () => zoomBy(0.8), shortcut: "Ctrl+-" },
        { label: "Fit on Screen", run: fit, shortcut: "Ctrl+0" },
        { label: "100%", run: () => setZoom(1), shortcut: "Ctrl+1" },
      ],
    },
  ];

  // ---- options bar -----------------------------------------------------
  const sep = <span className="h-5 w-px shrink-0 bg-white/10" />;
  const options = (
    <>
      <span className="shrink-0 text-[12px] font-semibold text-[#cfcfcf]">{TOOLS.find((x) => x.id === effTool)?.label}</span>
      {sep}
      {effTool === "move" ? (
        <>
          <label className="flex shrink-0 items-center gap-1.5 text-[12px]">
            <input checked={autoSelect} onChange={(e) => setAutoSelect(e.target.checked)} type="checkbox" />
            Auto-select layer
          </label>
          {sep}
          <span className="text-[12px] text-[#a8a8a8]">Align to {sel ? "selection" : "canvas"}</span>
          {(
            [
              ["left", AlignStartVertical],
              ["hcenter", AlignHorizontalJustifyCenter],
              ["right", AlignEndVertical],
              ["top", AlignStartHorizontal],
              ["vcenter", AlignVerticalJustifyCenter],
              ["bottom", AlignEndHorizontal],
            ] as const
          ).map(([w, Icon]) => (
            <button className="flex h-7 w-7 shrink-0 items-center justify-center rounded hover:bg-[#454545]" key={w} onClick={() => align(w)} title={`Align ${w}`} type="button">
              <Icon className="h-4 w-4" />
            </button>
          ))}
        </>
      ) : null}
      {effTool === "brush" || effTool === "eraser" ? (
        <>
          <NumberField label="Size" max={1000} min={1} onChange={(size) => setBrush((b) => ({ ...b, size }))} unit="px" value={brush.size} />
          <input className="w-24 accent-[#2f80ed]" max={400} min={1} onChange={(e) => setBrush((b) => ({ ...b, size: Number(e.target.value) }))} type="range" value={brush.size} />
          <NumberField label="Hardness" max={100} min={0} onChange={(hardness) => setBrush((b) => ({ ...b, hardness }))} unit="%" value={brush.hardness} />
          <NumberField label="Opacity" max={100} min={1} onChange={(opacity) => setBrush((b) => ({ ...b, opacity }))} unit="%" value={brush.opacity} />
          <span className="text-[11px] text-[#8a8a8a]">[ ] change size</span>
        </>
      ) : null}
      {effTool === "fill" ? <NumberField label="Tolerance" max={255} min={0} onChange={setTolerance} value={tolerance} /> : null}
      {effTool === "gradient" ? (
        <>
          <span className="h-5 w-28 shrink-0 rounded border border-black/60" style={{ background: `linear-gradient(90deg, ${fg}, ${bg})` }} />
          <select className="rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-[12px]" onChange={(e) => setGradientKind(e.target.value as "linear" | "radial")} value={gradientKind}>
            <option value="linear">Linear</option>
            <option value="radial">Radial</option>
          </select>
          <span className="text-[11px] text-[#8a8a8a]">Drag across the canvas · foreground → background</span>
        </>
      ) : null}
      {effTool === "text" ? (
        <>
          <select className="rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-[12px]" onChange={(e) => setTypeOpts((o) => ({ ...o, font: e.target.value }))} value={typeOpts.font}>
            {IMAGE_FONTS.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
          <NumberField label="Size" min={1} onChange={(size) => setTypeOpts((o) => ({ ...o, size }))} unit="px" value={typeOpts.size} />
          <label className="flex shrink-0 items-center gap-1 text-[12px]">
            <input checked={typeOpts.bold} onChange={(e) => setTypeOpts((o) => ({ ...o, bold: e.target.checked }))} type="checkbox" /> Bold
          </label>
          <label className="flex shrink-0 items-center gap-1 text-[12px]">
            <input checked={typeOpts.italic} onChange={(e) => setTypeOpts((o) => ({ ...o, italic: e.target.checked }))} type="checkbox" /> Italic
          </label>
          <span className="text-[11px] text-[#8a8a8a]">Click to add text · click text to edit it</span>
        </>
      ) : null}
      {effTool === "shape" ? (
        <>
          <select className="rounded border border-black/50 bg-[#1e1e1e] px-1 py-0.5 text-[12px]" onChange={(e) => setShapeKind(e.target.value as ShapeLayer["shape"])} value={shapeKind}>
            <option value="rect">Rectangle</option>
            <option value="ellipse">Ellipse</option>
            <option value="line">Line</option>
          </select>
          <span className="text-[12px] text-[#a8a8a8]">Fill</span>
          <span className="h-5 w-5 shrink-0 rounded-sm border border-black/60" style={{ background: fg }} />
          <span className="text-[12px] text-[#a8a8a8]">Stroke</span>
          <input
            className="h-6 w-7 cursor-pointer rounded border border-black/50 bg-transparent"
            onChange={(e) => setShapeStroke((s) => ({ ...s, color: e.target.value, width: s.width || 4 }))}
            type="color"
            value={shapeStroke.color === "transparent" ? "#000000" : shapeStroke.color}
          />
          <NumberField label="Width" min={0} onChange={(width) => setShapeStroke((s) => ({ ...s, width, color: s.color === "transparent" && width ? "#000000" : s.color }))} unit="px" value={shapeStroke.width} />
          {shapeKind === "rect" ? <NumberField label="Radius" min={0} onChange={(radius) => setShapeStroke((s) => ({ ...s, radius }))} unit="px" value={shapeStroke.radius} /> : null}
          <span className="text-[11px] text-[#8a8a8a]">Shift: square / circle</span>
        </>
      ) : null}
      {effTool === "marquee" ? (
        <>
          <span className="text-[12px] text-[#a8a8a8]">{sel ? `${sel.w} × ${sel.h} px at ${sel.x}, ${sel.y}` : "Drag to select an area"}</span>
          {sel ? (
            <button className="rounded bg-[#3a3a3a] px-2 py-0.5 text-[12px] hover:bg-[#454545]" onClick={() => setSel(null)} type="button">
              Deselect
            </button>
          ) : null}
        </>
      ) : null}
      {effTool === "crop" ? (
        cropRect ? (
          <>
            <span className="text-[12px] text-[#a8a8a8]">{cropRect.w} × {cropRect.h} px</span>
            <button className="rounded bg-[#2f6fd6] px-3 py-0.5 text-[12px] text-white hover:bg-[#3b7be0]" onClick={() => (cropTo(cropRect), setCropRect(null))} type="button">
              Crop (Enter)
            </button>
            <button className="rounded bg-[#3a3a3a] px-2 py-0.5 text-[12px] hover:bg-[#454545]" onClick={() => setCropRect(null)} type="button">
              Cancel
            </button>
          </>
        ) : (
          <span className="text-[12px] text-[#a8a8a8]">Drag the area to keep</span>
        )
      ) : null}
      {effTool === "eyedropper" ? <span className="text-[12px] text-[#a8a8a8]">Click to pick the foreground colour · Alt-click: background</span> : null}
      {effTool === "hand" || effTool === "zoom" ? (
        <>
          <button className="rounded bg-[#3a3a3a] px-2 py-0.5 text-[12px] hover:bg-[#454545]" onClick={() => setZoom(1)} type="button">100%</button>
          <button className="rounded bg-[#3a3a3a] px-2 py-0.5 text-[12px] hover:bg-[#454545]" onClick={fit} type="button">Fit Screen</button>
          {effTool === "zoom" ? <span className="text-[11px] text-[#8a8a8a]">Click to zoom in · Alt-click to zoom out</span> : null}
        </>
      ) : null}
    </>
  );

  // ---- overlays --------------------------------------------------------
  const z = zoom;
  const rectStyle = (r: Rect): React.CSSProperties => ({ left: r.x * z, top: r.y * z, width: r.w * z, height: r.h * z });
  const editing = editingText ? (doc.layers.find((l) => l.id === editingText) as TextLayer | undefined) : undefined;
  const activeBounds =
    activeLayer && effTool === "move" ? boundsOf(activeLayer, rasters.current.get(activeLayer.id)) : null;

  return (
    <CreativeShell
      ask={{
        placeholder: "e.g. Make a poster for our launch with a bold title, or remove the background and add a soft shadow",
        build: async (text) => {
          const s = dirty || !saved ? await save() : saved;
          return editorRequest("image", title, text, s);
        },
      }}
      badge="Im"
      dirty={dirty}
      isNew={!saved}
      kind="image"
      menus={menus}
      onClose={() => closeEditor()}
      onSave={() => void save()}
      onTitle={(t) => {
        setTitle(t);
        setDirty(true);
      }}
      options={options}
      saving={saving}
      status={
        <>
          <span>{Math.round(zoom * 100)}%</span>
          <span>
            {doc.width} × {doc.height} px
          </span>
          {cursorPos ? (
            <span>
              X {cursorPos.x} · Y {cursorPos.y}
            </span>
          ) : null}
          {sel ? <span>Selection {sel.w} × {sel.h}</span> : null}
          <span className="ml-auto">{activeLayer ? `Layer: ${activeLayer.name}` : ""}</span>
        </>
      }
      title={title}
    >
      <input
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) placeFile(f);
          e.target.value = "";
        }}
        ref={placeInput}
        type="file"
      />
      {/* tools */}
      <div className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-black/60 bg-[#2b2b2b] py-2">
        {TOOLS.map((t) => (
          <button
            aria-label={t.label}
            aria-pressed={effTool === t.id}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded",
              effTool === t.id ? "bg-[#4a4a4a] text-white" : "text-[#c8c8c8] hover:bg-[#3a3a3a]",
            )}
            key={t.id}
            onClick={() => setTool(t.id)}
            title={`${t.label} (${t.key})`}
            type="button"
          >
            <t.icon className="h-[18px] w-[18px]" />
          </button>
        ))}
        <span className="flex-1" />
        <div className="relative mb-1 h-10 w-10">
          <label className="absolute bottom-0 right-0 h-6 w-6 cursor-pointer rounded-sm border border-black/70" style={{ background: bg }} title="Background colour">
            <input className="sr-only" onChange={(e) => setBg(e.target.value)} type="color" value={bg} />
          </label>
          <label className="absolute left-0 top-0 h-6 w-6 cursor-pointer rounded-sm border border-white/70" style={{ background: fg }} title="Foreground colour">
            <input className="sr-only" onChange={(e) => setFg(e.target.value)} type="color" value={fg} />
          </label>
        </div>
        <button
          aria-label="Swap colours"
          className="mb-1 text-[#a8a8a8] hover:text-white"
          onClick={() => (setFg(bg), setBg(fg))}
          title="Swap colours (X)"
          type="button"
        >
          <ArrowLeftRight className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* document */}
      <div className="flex min-w-0 flex-1 flex-col bg-[#1b1b1b]">
        <div className="flex h-7 shrink-0 items-end border-b border-black/60 bg-[#262626] px-1">
          <span className="rounded-t bg-[#1b1b1b] px-3 py-1 text-[11px] text-[#cfcfcf]">
            {title.trim() || "Untitled"} @ {Math.round(zoom * 100)}% ({activeLayer?.name ?? "—"}, RGB/8){dirty ? " *" : ""}
          </span>
        </div>
        <div
          className="relative min-h-0 flex-1 overflow-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) placeFile(f);
          }}
          ref={scroller}
        >
          <div className="flex min-h-full min-w-full items-center justify-center p-12" style={{ width: "max-content" }}>
            <div
              className="relative shrink-0 shadow-[0_0_0_1px_rgba(0,0,0,0.6),0_8px_30px_rgba(0,0,0,0.5)]"
              onPointerDown={onPointerDown}
              onPointerLeave={() => {
                setCursorPos(null);
                if (brushCursor.current) brushCursor.current.style.width = "0px";
              }}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              ref={stage}
              style={{
                width: doc.width * z,
                height: doc.height * z,
                cursor: drag.current?.tool === "hand" ? "grabbing" : CURSOR[effTool],
              }}
            >
              <canvas
                className="absolute inset-0 [background:repeating-conic-gradient(#cfcfcf_0_25%,#fff_0_50%)_0_0/16px_16px]"
                ref={view}
                style={{ width: doc.width * z, height: doc.height * z, imageRendering: z >= 2 ? "pixelated" : "auto" }}
              />
              {!ready ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-white">Opening…</div>
              ) : null}
              {sel ? (
                <div
                  className="pointer-events-none absolute animate-pulse outline-dashed outline-1 outline-white [box-shadow:0_0_0_1px_rgba(0,0,0,0.8)]"
                  style={rectStyle(sel)}
                />
              ) : null}
              {cropRect ? (
                <div
                  className="pointer-events-none absolute border border-white [box-shadow:0_0_0_9999px_rgba(0,0,0,0.55)]"
                  style={rectStyle(cropRect)}
                >
                  <div className="absolute inset-0 [background:linear-gradient(to_right,transparent_33%,rgba(255,255,255,.35)_33%,rgba(255,255,255,.35)_calc(33%+1px),transparent_calc(33%+1px),transparent_66%,rgba(255,255,255,.35)_66%,rgba(255,255,255,.35)_calc(66%+1px),transparent_calc(66%+1px))]" />
                </div>
              ) : null}
              {activeBounds && activeLayer?.visible ? (
                <div className="pointer-events-none absolute border border-[#2f80ed]" style={rectStyle(activeBounds)} />
              ) : null}
              {editing ? (
                <TextBox
                  layer={editing}
                  onChange={(text) => updateLayer(editing.id, { text } as Partial<ImageLayer>)}
                  onDone={finishText}
                  zoom={z}
                />
              ) : null}
              {effTool === "brush" || effTool === "eraser" ? (
                <div
                  className="pointer-events-none absolute left-0 top-0 rounded-full border border-white mix-blend-difference"
                  ref={brushCursor}
                  style={{ width: 0, height: 0 }}
                />
              ) : null}
            </div>
          </div>
          {askSize ? <NewImageDialog onCancel={() => setAskSize(false)} onPick={newDocument} /> : null}
          {dialog ? (
            <SizeDialog
              height={doc.height}
              kind={dialog}
              onCancel={() => setDialog(null)}
              onOk={(w, h) => {
                setDialog(null);
                if (dialog === "image-size") resizeImage(w, h);
                else canvasSize(w, h);
              }}
              width={doc.width}
            />
          ) : null}
        </div>
      </div>

      {/* panels */}
      <div className="flex w-72 shrink-0 flex-col border-l border-black/60 bg-[#2b2b2b]">
        <ColorPanel bg={bg} fg={fg} onBg={setBg} onFg={setFg} />
        <Panel className="h-64 shrink-0" onTab={setMidTab} tab={midTab} tabs={["Properties", "Adjustments", "History"]}>
          {midTab === "Properties" ? (
            <PropertiesPanel
              layer={activeLayer}
              onChange={(patch) => activeLayer && updateLayer(activeLayer.id, patch)}
              onCommit={(label) => commitSoon(label)}
              raster={activeLayer ? rasters.current.get(activeLayer.id) : undefined}
            />
          ) : midTab === "Adjustments" ? (
            <AdjustmentsPanel
              layer={activeLayer}
              onChange={(a: Adjust) => activeLayer && updateLayer(activeLayer.id, { adjust: a })}
              onCommit={(label) => commitSoon(label)}
            />
          ) : (
            <HistoryPanel index={hIndex.current} labels={hist.current.map((s) => s.label)} onPick={restore} />
          )}
        </Panel>
        <LayersPanel
          active={active}
          docSize={doc}
          layers={doc.layers}
          onAdd={addLayer}
          onChange={updateLayer}
          onCommit={(label) => commitSoon(label)}
          onDelete={deleteLayer}
          onDuplicate={duplicate}
          onMergeDown={mergeDown}
          onMove={moveLayer}
          onSelect={(id) => {
            if (editingRef.current) finishText();
            setActive(id);
          }}
          rasters={rasters.current}
          tick={tick}
        />
      </div>
    </CreativeShell>
  );
}

type RasterLayerMeta = Extract<ImageLayer, { kind: "raster" }>;

function flipped(c: HTMLCanvasElement, horizontal: boolean): HTMLCanvasElement {
  const out = makeCanvas(c.width, c.height);
  const g = ctx2d(out);
  if (horizontal) {
    g.translate(c.width, 0);
    g.scale(-1, 1);
  } else {
    g.translate(0, c.height);
    g.scale(1, -1);
  }
  g.drawImage(c, 0, 0);
  return out;
}

/** Typing straight onto the canvas. */
function TextBox({
  layer,
  zoom,
  onChange,
  onDone,
}: {
  layer: TextLayer;
  zoom: number;
  onChange: (text: string) => void;
  onDone: () => void;
}) {
  const m = measureText(layer.text ? layer : { ...layer, text: "M" });
  const w = Math.max(m.w, layer.size * 2) + layer.size;
  const left = layer.align === "center" ? layer.x - w / 2 : layer.align === "right" ? layer.x - w : layer.x;
  return (
    <textarea
      autoFocus
      className="absolute resize-none overflow-hidden bg-transparent p-0 outline-dashed outline-1 outline-[#2f80ed]"
      onBlur={onDone}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) onDone();
      }}
      onPointerDown={(e) => e.stopPropagation()}
      spellCheck={false}
      style={{
        left: left * zoom,
        top: layer.y * zoom,
        width: w * zoom,
        height: (m.h + layer.size * 0.3) * zoom,
        font: fontOf({ ...layer, size: layer.size * zoom }),
        lineHeight: 1.2,
        paddingTop: layer.size * 0.1 * zoom,
        color: layer.color,
        textAlign: layer.align ?? "left",
        opacity: layer.opacity,
      }}
      value={layer.text}
    />
  );
}

function NewImageDialog({ onPick, onCancel }: { onPick: (w: number, h: number) => void; onCancel: () => void }) {
  const [w, setW] = React.useState(1920);
  const [h, setH] = React.useState(1080);
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
      <div className="w-[26rem] rounded-lg border border-black/60 bg-[#2f2f2f] p-4 text-[13px] shadow-2xl">
        <h3 className="mb-3 text-[15px] font-semibold text-white">New image</h3>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button
              className="rounded border border-black/50 bg-[#3a3a3a] px-2 py-2 text-left hover:border-[#2f80ed] hover:bg-[#404040]"
              key={p.label}
              onClick={() => onPick(p.w, p.h)}
              type="button"
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <NumberField label="Width" min={1} max={8000} onChange={setW} unit="px" value={w} width="w-20" />
          <NumberField label="Height" min={1} max={8000} onChange={setH} unit="px" value={h} width="w-20" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded bg-[#3a3a3a] px-3 py-1 hover:bg-[#454545]" onClick={onCancel} type="button">
            Keep current
          </button>
          <button
            className="rounded bg-[#2f6fd6] px-3 py-1 text-white hover:bg-[#3b7be0]"
            onClick={() => onPick(clampSize(w), clampSize(h))}
            type="button"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

const clampSize = (n: number) => Math.max(1, Math.min(8000, Math.round(n || 1)));

function SizeDialog({
  kind,
  width,
  height,
  onOk,
  onCancel,
}: {
  kind: "image-size" | "canvas-size";
  width: number;
  height: number;
  onOk: (w: number, h: number) => void;
  onCancel: () => void;
}) {
  const [w, setW] = React.useState(width);
  const [h, setH] = React.useState(height);
  const [lock, setLock] = React.useState(kind === "image-size");
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/50">
      <div className="w-80 rounded-lg border border-black/60 bg-[#2f2f2f] p-4 text-[13px] shadow-2xl">
        <h3 className="mb-1 text-[15px] font-semibold text-white">{kind === "image-size" ? "Image Size" : "Canvas Size"}</h3>
        <p className="mb-3 text-[11px] text-[#9a9a9a]">
          {kind === "image-size" ? "Resamples every layer to the new size." : "Adds or trims space around the centre."}
        </p>
        <div className="space-y-2">
          <NumberField
            label="Width "
            min={1}
            max={8000}
            onChange={(v) => {
              setW(v);
              if (lock) setH(Math.round((v * height) / width));
            }}
            unit="px"
            value={w}
            width="w-24"
          />
          <NumberField
            label="Height"
            min={1}
            max={8000}
            onChange={(v) => {
              setH(v);
              if (lock) setW(Math.round((v * width) / height));
            }}
            unit="px"
            value={h}
            width="w-24"
          />
          <label className="flex items-center gap-1.5 text-[12px]">
            <input checked={lock} onChange={(e) => setLock(e.target.checked)} type="checkbox" />
            Keep proportions
          </label>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded bg-[#3a3a3a] px-3 py-1 hover:bg-[#454545]" onClick={onCancel} type="button">
            Cancel
          </button>
          <button
            className="rounded bg-[#2f6fd6] px-3 py-1 text-white hover:bg-[#3b7be0]"
            onClick={() => onOk(clampSize(w), clampSize(h))}
            type="button"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
