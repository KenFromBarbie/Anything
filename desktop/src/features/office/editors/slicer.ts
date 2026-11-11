// 3D printing for the 3D editor: a slicer. It cuts a mesh into layers, builds
// the print path for each (walls, infill, a skirt), and writes G-code (Marlin
// flavour, as Ender / Prusa-style FDM printers read), with the print time,
// filament and cost. Units: millimetres on the printer; the scene is metres
// with Y up, so the printer's Z is the scene's Y.

import type { Tris } from "./marine";

export type Pt = [number, number];
export type Loop = Pt[];

export type Printer = { id: string; label: string; bed: [number, number, number]; nozzle: number; maxSpeed: number; originCenter?: boolean };
export const PRINTERS: Printer[] = [
  { id: "ender3", label: "Creality Ender-3 (220×220×250)", bed: [220, 220, 250], nozzle: 0.4, maxSpeed: 80 },
  { id: "ender3-corexy", label: "Ender-3 CoreXY conversion (220×220×250)", bed: [220, 220, 250], nozzle: 0.4, maxSpeed: 200 },
  { id: "ender5plus", label: "Creality Ender-5 Plus (350×350×400)", bed: [350, 350, 400], nozzle: 0.4, maxSpeed: 100 },
  { id: "mk3s", label: "Prusa i3 MK3S+ (250×210×210)", bed: [250, 210, 210], nozzle: 0.4, maxSpeed: 120 },
  { id: "a1mini", label: "Bambu A1 mini (180×180×180)", bed: [180, 180, 180], nozzle: 0.4, maxSpeed: 300 },
  { id: "voron350", label: "Voron 2.4 (350×350×350)", bed: [350, 350, 350], nozzle: 0.4, maxSpeed: 300 },
  { id: "big", label: "Large format (500×500×500)", bed: [500, 500, 500], nozzle: 0.6, maxSpeed: 100 },
];

export type Filament = { id: string; label: string; nozzle: number; bed: number; density: number; fan: number; /** per kg */ price: number };
export const FILAMENTS: Filament[] = [
  { id: "pla", label: "PLA", nozzle: 205, bed: 60, density: 1.24, fan: 100, price: 20 },
  { id: "petg", label: "PETG", nozzle: 235, bed: 80, density: 1.27, fan: 50, price: 22 },
  { id: "abs", label: "ABS", nozzle: 245, bed: 100, density: 1.05, fan: 0, price: 22 },
  { id: "asa", label: "ASA", nozzle: 250, bed: 100, density: 1.07, fan: 20, price: 28 },
  { id: "tpu", label: "TPU (flexible)", nozzle: 225, bed: 50, density: 1.21, fan: 60, price: 30 },
  { id: "pa-cf", label: "Nylon carbon fibre", nozzle: 280, bed: 90, density: 1.15, fan: 0, price: 60 },
];

export type PrintSettings = {
  printer: string;
  filament: string;
  layer: number;
  firstLayer: number;
  walls: number;
  /** 0–100 % */
  infill: number;
  topBottom: number;
  /** mm/s */
  speed: number;
  firstSpeed: number;
  travel: number;
  retract: number;
  skirt: boolean;
  /** uniform scale applied to the model (1 = as modelled) */
  scale: number;
  filamentDiameter: number;
  startGcode?: string;
  endGcode?: string;
};

export const DEFAULT_PRINT: PrintSettings = {
  printer: "ender3",
  filament: "pla",
  layer: 0.2,
  firstLayer: 0.28,
  walls: 2,
  infill: 20,
  topBottom: 4,
  speed: 50,
  firstSpeed: 20,
  travel: 150,
  retract: 5,
  skirt: true,
  scale: 1,
  filamentDiameter: 1.75,
};

export type Move = { x: number; y: number; /** extrude on the way here */ e: boolean; kind: "wall" | "outer" | "infill" | "solid" | "skirt" | "travel" };
export type Layer = { z: number; height: number; loops: Loop[]; moves: Move[] };
export type SliceResult = {
  ok: boolean;
  error?: string;
  layers: Layer[];
  /** model size on the bed (mm) and where it sits */
  size: [number, number, number];
  offset: [number, number];
  /** the model's lowest point before it was set on the bed (mm) */
  baseZ: number;
  fits: boolean;
  /** mm of filament, grams, seconds, currency */
  filament: number;
  grams: number;
  seconds: number;
  cost: number;
  /** share of the surface that overhangs more than 45° without support under it */
  overhang: number;
  warnings: string[];
};

const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`;

export function signedArea(l: Loop): number {
  let a = 0;
  for (let i = 0; i < l.length; i++) {
    const p = l[i], q = l[(i + 1) % l.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

export function loopLength(l: Loop, closed = true): number {
  let s = 0;
  for (let i = 1; i < l.length; i++) s += Math.hypot(l[i][0] - l[i - 1][0], l[i][1] - l[i - 1][1]);
  if (closed && l.length > 1) s += Math.hypot(l[0][0] - l[l.length - 1][0], l[0][1] - l[l.length - 1][1]);
  return s;
}

/** Scene triangles (m, Y up) → printer triangles (mm, Z up), scaled. A proper
 *  rotation (X=x, Y=−z, Z=y), so the part isn't mirrored. */
export function toPrinter(t: Tris, scale = 1): Float64Array {
  const out = new Float64Array(t.length);
  const k = 1000 * scale;
  for (let i = 0; i < t.length; i += 3) {
    out[i] = t[i] * k;
    out[i + 1] = -t[i + 2] * k;
    out[i + 2] = t[i + 1] * k;
  }
  return out;
}

/** The closed outlines of the mesh at height z. */
export function sliceAt(t: Float64Array, z: number): Loop[] {
  const segs: [Pt, Pt][] = [];
  for (let k = 0; k < t.length; k += 9) {
    const v = [
      [t[k], t[k + 1], t[k + 2]],
      [t[k + 3], t[k + 4], t[k + 5]],
      [t[k + 6], t[k + 7], t[k + 8]],
    ];
    const pts: Pt[] = [];
    for (let i = 0; i < 3; i++) {
      const a = v[i], b = v[(i + 1) % 3];
      const da = a[2] - z, db = b[2] - z;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const s = da / (da - db);
        pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
      }
    }
    if (pts.length === 2 && (Math.abs(pts[0][0] - pts[1][0]) > 1e-7 || Math.abs(pts[0][1] - pts[1][1]) > 1e-7)) segs.push([pts[0], pts[1]]);
  }
  // chain segments into loops
  const byEnd = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const kk = key(p[0], p[1]);
      const arr = byEnd.get(kk);
      if (arr) arr.push(i);
      else byEnd.set(kk, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const loops: Loop[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const loop: Loop = [segs[i][0], segs[i][1]];
    for (let guard = 0; guard < segs.length + 2; guard++) {
      const end = loop[loop.length - 1];
      const cand = (byEnd.get(key(end[0], end[1])) ?? []).find((j) => !used[j]);
      if (cand == null) break;
      used[cand] = 1;
      const s = segs[cand];
      loop.push(key(s[0][0], s[0][1]) === key(end[0], end[1]) ? s[1] : s[0]);
    }
    if (loop.length > 3 && key(loop[0][0], loop[0][1]) === key(loop[loop.length - 1][0], loop[loop.length - 1][1])) {
      loop.pop();
      const clean = simplify(loop);
      if (clean.length >= 3 && Math.abs(signedArea(clean)) > 1e-3) loops.push(clean);
    }
  }
  return orient(loops);
}

/** Drop points on a straight line between their neighbours. */
function simplify(l: Loop): Loop {
  const out: Loop = [];
  for (let i = 0; i < l.length; i++) {
    const a = l[(i + l.length - 1) % l.length], b = l[i], c = l[(i + 1) % l.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (Math.abs(cross) > 1e-6 * Math.max(1, len)) out.push(b);
  }
  return out.length >= 3 ? out : l;
}

export function inside(p: Pt, l: Loop): boolean {
  let c = false;
  for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
    if (l[i][1] > p[1] !== l[j][1] > p[1] && p[0] < ((l[j][0] - l[i][0]) * (p[1] - l[i][1])) / (l[j][1] - l[i][1]) + l[i][0]) c = !c;
  }
  return c;
}

/** Outer outlines counter-clockwise, holes clockwise (by nesting depth). */
function orient(loops: Loop[]): Loop[] {
  return loops.map((l, i) => {
    let depth = 0;
    loops.forEach((o, j) => {
      if (i !== j && inside(l[0], o)) depth++;
    });
    const ccw = signedArea(l) > 0;
    const wantCcw = depth % 2 === 0;
    return ccw === wantCcw ? l : [...l].reverse();
  });
}

/** Move an outline inwards by d (outwards if negative): each corner slides
 *  along its bisector (mitre, limited). Null when the outline closes up. */
export function offsetLoop(l: Loop, d: number): Loop | null {
  const n = l.length;
  const a0 = signedArea(l);
  const out: Loop = [];
  for (let i = 0; i < n; i++) {
    const p = l[(i + n - 1) % n], c = l[i], q = l[(i + 1) % n];
    let e1x = c[0] - p[0], e1y = c[1] - p[1];
    let e2x = q[0] - c[0], e2y = q[1] - c[1];
    const l1 = Math.hypot(e1x, e1y) || 1, l2 = Math.hypot(e2x, e2y) || 1;
    e1x /= l1; e1y /= l1; e2x /= l2; e2y /= l2;
    // inward normal of a counter-clockwise outline is the left normal
    const n1x = -e1y, n1y = e1x, n2x = -e2y, n2y = e2x;
    let bx = n1x + n2x, by = n1y + n2y;
    const bl = Math.hypot(bx, by);
    if (bl < 1e-9) {
      bx = n1x; by = n1y;
    } else {
      bx /= bl; by /= bl;
    }
    const cos = Math.max(0.25, bx * n1x + by * n1y); // mitre limit 4×
    out.push([c[0] + (bx * d) / cos, c[1] + (by * d) / cos]);
  }
  // Edges that now run backwards mean that part of the outline closed up
  // (its corners passed each other). Mostly backwards: it's gone.
  let flipped = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    if ((l[j][0] - l[i][0]) * (out[j][0] - out[i][0]) + (l[j][1] - l[i][1]) * (out[j][1] - out[i][1]) < 0) flipped++;
  }
  if (flipped * 2 > n) return null;
  const a1 = signedArea(out);
  // closed up or turned inside out
  if (Math.sign(a1) !== Math.sign(a0) || Math.abs(a1) < 0.05) return null;
  // an outer outline must shrink when moved inwards (a hole grows)
  if (d > 0 && a0 > 0 && a1 > a0) return null;
  return out;
}

/** Hatch lines inside the outlines (even-odd), at an angle, `spacing` apart. */
export function hatch(loops: Loop[], spacing: number, angle: number): [Pt, Pt][] {
  if (!loops.length || spacing <= 0) return [];
  const c = Math.cos(-angle), s = Math.sin(-angle);
  const rot = loops.map((l) => l.map(([x, y]) => [x * c - y * s, x * s + y * c] as Pt));
  let lo = Infinity, hi = -Infinity;
  for (const l of rot) for (const p of l) {
    lo = Math.min(lo, p[1]);
    hi = Math.max(hi, p[1]);
  }
  const out: [Pt, Pt][] = [];
  const back = (x: number, y: number): Pt => [x * c + y * s, -x * s + y * c];
  let flip = false;
  for (let y = Math.ceil(lo / spacing) * spacing + spacing * 0.01; y < hi; y += spacing) {
    const xs: number[] = [];
    for (const l of rot) {
      for (let i = 0, j = l.length - 1; i < l.length; j = i++) {
        const a = l[j], b = l[i];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    const row: [Pt, Pt][] = [];
    for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 0.2) row.push([back(xs[i], y), back(xs[i + 1], y)]);
    // zig-zag: alternate direction so travel is short
    if (flip) row.reverse();
    for (const seg of row) out.push(flip ? [seg[1], seg[0]] : seg);
    flip = !flip;
  }
  return out;
}

function hull(points: Pt[]): Loop {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Pt[] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: Pt[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Slice a mesh (scene triangles) into print layers with their paths. */
export function slice(tris: Tris, s: PrintSettings): SliceResult {
  const printer = PRINTERS.find((p) => p.id === s.printer) ?? PRINTERS[0];
  const fil = FILAMENTS.find((f) => f.id === s.filament) ?? FILAMENTS[0];
  const empty = (error: string): SliceResult => ({ ok: false, error, layers: [], size: [0, 0, 0], offset: [0, 0], baseZ: 0, fits: false, filament: 0, grams: 0, seconds: 0, cost: 0, overhang: 0, warnings: [] });
  if (!tris.length) return empty("Nothing to print: select a solid object.");
  const t = toPrinter(tris, s.scale);
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.length; i += 3) {
    minX = Math.min(minX, t[i]); maxX = Math.max(maxX, t[i]);
    minY = Math.min(minY, t[i + 1]); maxY = Math.max(maxY, t[i + 1]);
    minZ = Math.min(minZ, t[i + 2]); maxZ = Math.max(maxZ, t[i + 2]);
  }
  const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  if (size[2] < s.firstLayer) return empty("The model is thinner than one layer at this scale (the scene is in metres: 1 unit = 1000 mm).");
  // sit it on the bed, centred
  const ox = printer.bed[0] / 2 - (minX + maxX) / 2;
  const oy = printer.bed[1] / 2 - (minY + maxY) / 2;
  for (let i = 0; i < t.length; i += 3) {
    t[i] += ox;
    t[i + 1] += oy;
    t[i + 2] -= minZ;
  }
  const fits = size[0] <= printer.bed[0] && size[1] <= printer.bed[1] && size[2] <= printer.bed[2];
  const warnings: string[] = [];
  if (!fits) warnings.push(`It's ${size.map((v) => v.toFixed(0)).join(" × ")} mm, bigger than the ${printer.bed.join(" × ")} mm build volume: scale it down or split it.`);
  const nLayers = 1 + Math.max(0, Math.floor((size[2] - s.firstLayer) / s.layer + 1e-6));
  if (nLayers > 4000) return empty("That's over 4,000 layers: use thicker layers or scale it down.");
  const w = printer.nozzle * 1.125; // line width
  const layers: Layer[] = [];
  const area = (l: Loop[]) => l.reduce((a, x) => a + signedArea(x), 0);

  // overhang: downward faces steeper than 45° that aren't on the bed
  let down = 0, total = 0;
  for (let k = 0; k < t.length; k += 9) {
    const ux = t[k + 3] - t[k], uy = t[k + 4] - t[k + 1], uz = t[k + 5] - t[k + 2];
    const vx = t[k + 6] - t[k], vy = t[k + 7] - t[k + 1], vz = t[k + 8] - t[k + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const a = Math.hypot(nx, ny, nz) / 2;
    if (a < 1e-9) continue;
    total += a;
    const zmin = Math.min(t[k + 2], t[k + 5], t[k + 8]);
    if (nz / (2 * a) < -0.7071 && zmin > s.firstLayer) down += a;
  }
  const overhang = total ? down / total : 0;
  if (overhang > 0.02) warnings.push(`About ${(overhang * 100).toFixed(0)}% of the surface overhangs more than 45°: turn the part so those faces sit on the bed, or print it with supports (not generated here).`);

  let skirtDone = false;
  for (let i = 0; i < nLayers; i++) {
    const height = i === 0 ? s.firstLayer : s.layer;
    const top = s.firstLayer + i * s.layer;
    const z = top - height / 2;
    const loops = sliceAt(t, z);
    const moves: Move[] = [];
    const go = (p: Pt) => moves.push({ x: p[0], y: p[1], e: false, kind: "travel" });
    const draw = (path: Pt[], kind: Move["kind"], closed: boolean) => {
      if (path.length < 2) return;
      go(path[0]);
      for (let k = 1; k < path.length; k++) moves.push({ x: path[k][0], y: path[k][1], e: true, kind });
      if (closed) moves.push({ x: path[0][0], y: path[0][1], e: true, kind });
    };
    if (i === 0 && s.skirt && loops.length && !skirtDone) {
      const h = hull(loops.flat());
      const sk = h.length >= 3 ? offsetLoop(signedArea(h) > 0 ? h : [...h].reverse(), -5) : null;
      if (sk) draw(sk, "skirt", true);
      skirtDone = true;
    }
    // walls: innermost first, the outer wall last (a cleaner surface)
    const rings: Loop[][] = [];
    let cur: Loop[] = loops;
    for (let k = 0; k < s.walls; k++) {
      const next = cur.map((l) => offsetLoop(l, k === 0 ? w / 2 : w)).filter((l): l is Loop => !!l);
      if (!next.length) break;
      rings.push(next);
      cur = next;
    }
    for (let k = rings.length - 1; k >= 0; k--) for (const l of rings[k]) draw(l, k === 0 ? "outer" : "wall", true);
    // fill: solid at the bottom and top, sparse between
    const inner = rings.length ? rings[rings.length - 1].map((l) => offsetLoop(l, w * 0.6)).filter((l): l is Loop => !!l) : [];
    const solid = i < s.topBottom || i >= nLayers - s.topBottom;
    const density = solid ? 1 : s.infill / 100;
    if (inner.length && density > 0 && Math.abs(area(inner)) > w * w) {
      const angle = (i % 2 ? 3 : 1) * (Math.PI / 4);
      for (const seg of hatch(inner, w / density, angle)) draw(seg, solid ? "solid" : "infill", false);
    }
    layers.push({ z: top, height, loops, moves });
  }
  if (!layers.some((l) => l.moves.length)) return empty("No printable outline found: the mesh may be open (not a closed solid) or thinner than the nozzle.");

  // totals
  const filArea = Math.PI * (s.filamentDiameter / 2) ** 2;
  let filament = 0, seconds = 0;
  for (const [i, l] of layers.entries()) {
    let px = 0, py = 0, first = true;
    for (const m of l.moves) {
      const d = first ? 0 : Math.hypot(m.x - px, m.y - py);
      if (m.e) {
        filament += (d * w * l.height) / filArea;
        seconds += d / (i === 0 ? s.firstSpeed : m.kind === "outer" ? s.speed * 0.6 : s.speed);
      } else {
        seconds += d / s.travel + (d > 2 ? 0.25 : 0);
      }
      px = m.x; py = m.y; first = false;
    }
    seconds += 0.4; // layer change
  }
  seconds = seconds * 1.12 + 120; // acceleration + heat-up
  const grams = (filament * filArea * fil.density) / 1000;
  return { ok: true, layers, size, offset: [ox, oy], baseZ: minZ, fits, filament, grams, seconds, cost: (grams / 1000) * fil.price, overhang, warnings };
}

const f3 = (v: number) => (Math.round(v * 1000) / 1000).toString();
const f5 = (v: number) => (Math.round(v * 1e5) / 1e5).toString();

/** G-code (Marlin): heat, home, prime, the layers, cool down. */
export function toGcode(r: SliceResult, s: PrintSettings, title = "model"): string {
  const printer = PRINTERS.find((p) => p.id === s.printer) ?? PRINTERS[0];
  const fil = FILAMENTS.find((f) => f.id === s.filament) ?? FILAMENTS[0];
  const w = printer.nozzle * 1.125;
  const filArea = Math.PI * (s.filamentDiameter / 2) ** 2;
  const g: string[] = [];
  const time = `${Math.floor(r.seconds / 3600)}h ${Math.round((r.seconds % 3600) / 60)}m`;
  g.push(
    `; ${title} — sliced by Anything`,
    `; printer: ${printer.label}`,
    `; filament: ${fil.label}, ${s.filamentDiameter} mm, ${(r.filament / 1000).toFixed(2)} m, ${r.grams.toFixed(1)} g`,
    `; layers: ${r.layers.length} (${s.layer} mm, first ${s.firstLayer} mm), walls ${s.walls}, infill ${s.infill}%`,
    `; estimated time: ${time}`,
    `;TIME:${Math.round(r.seconds)}`,
    `;LAYER_COUNT:${r.layers.length}`,
    "M140 S" + fil.bed,
    "M104 S" + fil.nozzle,
    "G90 ; absolute positioning",
    "M82 ; absolute extrusion",
    "G28 ; home",
    "M190 S" + fil.bed + " ; wait for the bed",
    "M109 S" + fil.nozzle + " ; wait for the nozzle",
    "G92 E0",
  );
  if (s.startGcode?.trim()) g.push(...s.startGcode.trim().split(/\r?\n/));
  else {
    // prime line along the front-left edge
    g.push("G1 Z2 F3000", "G1 X5 Y10 F5000", `G1 Z${f3(s.firstLayer)} F3000`, "G1 X5 Y120 E12 F1200 ; prime", "G1 X5.5 Y120 F5000", "G1 X5.5 Y20 E22 F1200", "G92 E0", "G1 Z1.5 F3000");
  }
  let e = 0;
  let retracted = false;
  let x = 5.5, y = 20;
  for (const [i, l] of r.layers.entries()) {
    g.push(`;LAYER:${i}`, `G1 Z${f3(l.z)} F3000`);
    if (i === 1 && fil.fan > 0) g.push(`M106 S${Math.round((fil.fan / 100) * 255)} ; fan`);
    let kind = "";
    for (const m of l.moves) {
      const d = Math.hypot(m.x - x, m.y - y);
      if (!m.e) {
        if (d > 2 && !retracted && s.retract > 0) {
          e -= s.retract;
          g.push(`G1 E${f5(e)} F2400`);
          retracted = true;
        }
        g.push(`G0 X${f3(m.x)} Y${f3(m.y)} F${Math.round(s.travel * 60)}`);
      } else {
        if (retracted) {
          e += s.retract;
          g.push(`G1 E${f5(e)} F2400`);
          retracted = false;
        }
        if (m.kind !== kind) {
          kind = m.kind;
          g.push(`;TYPE:${kind === "outer" ? "WALL-OUTER" : kind === "wall" ? "WALL-INNER" : kind === "solid" ? "SKIN" : kind === "skirt" ? "SKIRT" : "FILL"}`);
        }
        e += (d * w * l.height) / filArea;
        const speed = i === 0 ? s.firstSpeed : m.kind === "outer" ? s.speed * 0.6 : s.speed;
        g.push(`G1 X${f3(m.x)} Y${f3(m.y)} E${f5(e)} F${Math.round(speed * 60)}`);
      }
      x = m.x; y = m.y;
    }
  }
  const lift = Math.min(printer.bed[2], (r.layers[r.layers.length - 1]?.z ?? 0) + 10);
  g.push(`G1 E${f5(e - Math.max(2, s.retract))} F2400 ; retract`);
  if (s.endGcode?.trim()) g.push(...s.endGcode.trim().split(/\r?\n/));
  else g.push(`G1 Z${f3(lift)} F3000 ; lift`, `G0 X5 Y${printer.bed[1] - 10} F6000 ; present the print`, "M106 S0 ; fan off", "M104 S0 ; nozzle off", "M140 S0 ; bed off", "M84 ; motors off");
  return g.join("\n") + "\n";
}

/** Read a G-code file back into moves per layer (for the path viewer). */
export function parseGcode(text: string): { layers: { z: number; moves: Move[] }[]; filament: number } {
  const layers: { z: number; moves: Move[] }[] = [];
  let x = 0, y = 0, z = 0, e = 0, abs = true, absE = true, maxE = 0;
  let cur: { z: number; moves: Move[] } | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.split(";")[0].trim();
    if (!line) continue;
    const cmd = line.split(/\s+/)[0].toUpperCase();
    if (cmd === "G90") abs = true;
    else if (cmd === "G91") abs = false;
    else if (cmd === "M82") absE = true;
    else if (cmd === "M83") absE = false;
    else if (cmd === "G92") {
      const m = /E(-?[\d.]+)/i.exec(line);
      if (m) e = Number(m[1]);
    } else if (cmd === "G0" || cmd === "G1") {
      const num = (c: string) => {
        const m = new RegExp(`${c}(-?[\\d.]+)`, "i").exec(line);
        return m ? Number(m[1]) : null;
      };
      const nx = num("X"), ny = num("Y"), nz = num("Z"), ne = num("E");
      const px = x, py = y, pe = e;
      if (nx != null) x = abs ? nx : x + nx;
      if (ny != null) y = abs ? ny : y + ny;
      if (nz != null) z = abs ? nz : z + nz;
      if (ne != null) e = absE ? ne : e + ne;
      maxE = Math.max(maxE, e);
      if (nz != null && (!cur || Math.abs(cur.z - z) > 1e-6) && nx == null && ny == null) {
        cur = { z, moves: [] };
        layers.push(cur);
      }
      if ((nx != null || ny != null) && cur && (x !== px || y !== py)) cur.moves.push({ x, y, e: e > pe + 1e-9, kind: e > pe + 1e-9 ? "wall" : "travel" });
    }
  }
  return { layers: layers.filter((l) => l.moves.length), filament: maxE };
}

export function formatDuration(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}
