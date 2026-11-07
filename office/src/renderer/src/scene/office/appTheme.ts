// The floor in the colours of the app it is shown in.
//
// Inside Anything the page posts `{ type: 'buzz-theme', … }` with its light or
// dark colours (as `hsl(…)` strings) when the Office loads and whenever the
// theme changes. The floor and wall layers are then recoloured with a duotone
// matrix: each layer's darkest and lightest shade of the pixel art are mapped
// onto two of the app's colours, so the tile detail stays and only the palette
// changes. Furniture and people keep their own colours.

import { ColorMatrixFilter, type Application } from 'pixi.js';
import { hostedInBuzz } from '@/host/buzzHost';
import type { TiledMapRenderer } from './TiledMapRenderer';

type Rgb = [number, number, number];

export interface AppTheme {
  dark: boolean;
  background: Rgb;
  foreground: Rgb;
  sidebar: Rgb;
  card: Rgb;
}

/** "hsl(210 12.2% 16.1%)" (the app's `--x` values) → 0..1 RGB. */
export function parseHsl(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const m = value.match(/hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/i);
  if (!m) return null;
  const h = Number(m[1]) / 360;
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t: number) => {
    const u = ((t % 1) + 1) % 1;
    if (u < 1 / 6) return p + (q - p) * 6 * u;
    if (u < 1 / 2) return q;
    if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}

/** The theme in a `buzz-theme` message, or null when it isn't one. */
export function readAppTheme(data: unknown): AppTheme | null {
  const d = data as Record<string, unknown> | null;
  if (!d || d.type !== 'buzz-theme') return null;
  const background = parseHsl(d.background);
  const foreground = parseHsl(d.foreground);
  if (!background || !foreground) return null;
  return {
    dark: d.dark === true,
    background,
    foreground,
    sidebar: parseHsl(d.sidebar) ?? background,
    card: parseHsl(d.card) ?? background,
  };
}

const mix = (a: Rgb, b: Rgb, t: number): Rgb =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const luma = (c: Rgb) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

const hex = (h: number): Rgb => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

/** A colour matrix taking a pixel of luma `lo` to `low` and of luma `hi` to
 *  `high` (and the shades between to the colours between). */
export function duotone(lo: number, hi: number, low: Rgb, high: Rgb): number[] {
  const m: number[] = [];
  for (let c = 0; c < 3; c++) {
    const k = (high[c] - low[c]) / (hi - lo);
    const b = low[c] - k * lo;
    m.push(k * 0.299, k * 0.587, k * 0.114, 0, b);
  }
  m.push(0, 0, 0, 1, 0);
  return m;
}

// The art's own shades: the floor's grid line and tile, the walls' outline
// and face (measured from the tilesets).
const FLOOR_LINE = luma(hex(0x75938d));
const FLOOR_TILE = luma(hex(0x92a897));
const WALL_EDGE = luma(hex(0x302a28));
const WALL_FACE = luma(hex(0xffffff));

/** What each layer's shades become in the app's colours. */
export function themeShades(t: AppTheme) {
  const tile = t.sidebar;
  return {
    floorTile: tile,
    floorLine: mix(tile, t.foreground, t.dark ? 0.06 : 0.08),
    wallFace: t.dark ? mix(t.background, t.foreground, 0.2) : t.card,
    wallEdge: t.dark ? mix(t.background, [0, 0, 0], 0.35) : mix(t.foreground, t.background, 0.15),
  };
}

const toNumber = (c: Rgb) =>
  (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);

/** Recolour the floor's layers and canvas for `t`. */
export function applyAppTheme(app: Application, map: TiledMapRenderer, t: AppTheme): void {
  const s = themeShades(t);
  const floor = new ColorMatrixFilter();
  floor.matrix = duotone(FLOOR_LINE, FLOOR_TILE, s.floorLine, s.floorTile) as typeof floor.matrix;
  const walls = new ColorMatrixFilter();
  walls.matrix = duotone(WALL_EDGE, WALL_FACE, s.wallEdge, s.wallFace) as typeof walls.matrix;
  map.setLayerFilters('floor', [floor]);
  map.setLayerFilters('walls', [walls]);
  app.renderer.background.color = toNumber(t.background);
}

let current: AppTheme | null = null;
const listeners = new Set<(t: AppTheme) => void>();

if (hostedInBuzz && typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent) return;
    const t = readAppTheme(event.data);
    if (!t) return;
    current = t;
    for (const fn of listeners) fn(t);
  });
  // This module loads with the floor, after the frame's own load event, so a
  // theme the app posted then was missed: ask for it again.
  window.parent.postMessage({ type: 'buzz-theme-request' }, '*');
}

/** Call `fn` with the app's theme now (if known) and on every change. */
export function onAppTheme(fn: (t: AppTheme) => void): () => void {
  listeners.add(fn);
  if (current) fn(current);
  return () => listeners.delete(fn);
}
