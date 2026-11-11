// Naval architecture for the 3D editor's Marine workspace (Orca3D-style):
// a parametric hull, hydrostatics and stability on any closed mesh, free
// trim equilibrium, the GZ curve, lines (sections / waterlines / buttocks),
// offsets, and resistance (Holtrop-Mennen 1984, Savitsky 1964).
//
// Axes: x forward (metres), y up, z to starboard.

import * as THREE from "three";

export const G = 9.80665;
export const RHO = { salt: 1025, fresh: 1000 } as const;
export const NU = { salt: 1.1892e-6, fresh: 1.1386e-6 } as const; // 15 °C

// ─── Hull design ─────────────────────────────────────────────────────────

export type HullType = "planing" | "round";
export type HullParams = {
  type: HullType;
  /** Length overall (m). */
  length: number;
  /** Max beam (m). */
  beam: number;
  /** Depth, keel to sheer at midships (m). */
  depth: number;
  /** Deadrise at the transom / forward (°), planing hulls. */
  deadriseAft: number;
  deadriseFwd: number;
  /** Transom beam as a share of the max beam. */
  transom: number;
  /** Entry fullness: 1 fine … 3 full. */
  entry: number;
  /** Forefoot rise at the bow, share of depth. */
  keelRise: number;
  /** Sheer rise at the bow (m). */
  sheerRise: number;
  /** Topside flare (°). */
  flare: number;
  /** Bilge squareness for round hulls: 2 round … 6 boxy. */
  bilge: number;
};

export const DEFAULT_HULL: HullParams = {
  type: "planing",
  length: 6,
  beam: 2.2,
  depth: 1.1,
  deadriseAft: 16,
  deadriseFwd: 40,
  transom: 0.9,
  entry: 1.8,
  keelRise: 0.55,
  sheerRise: 0.25,
  flare: 12,
  bilge: 2.5,
};

const N_ST = 48; // stations
const N_PT = 14; // points per half-section

function smooth(t: number) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/** One half-section at station u (0 transom … 1 bow): points from keel to
 *  sheer as [z (half-breadth), y (height)]. */
export function halfSection(h: HullParams, u: number): [number, number][] {
  const half = h.beam / 2;
  const tr = Math.min(1, Math.max(0.05, h.transom));
  const peak = 0.4;
  const f =
    u < peak
      ? tr + (1 - tr) * smooth(u / peak)
      : Math.max(0, 1 - ((u - peak) / (1 - peak)) ** Math.max(1.05, h.entry)) ** 0.55;
  const hb = half * f;
  const keel = u > 0.5 ? h.keelRise * h.depth * ((u - 0.5) / 0.5) ** 2 : 0;
  const sheer = h.depth + h.sheerRise * u * u;
  const flare = Math.tan((h.flare * Math.PI) / 180);
  const pts: [number, number][] = [];
  if (h.type === "planing") {
    const beta = ((h.deadriseAft + (h.deadriseFwd - h.deadriseAft) * smooth(u)) * Math.PI) / 180;
    const chineB = hb * 0.94;
    let chineY = keel + chineB * Math.tan(beta);
    chineY = Math.min(chineY, keel + (sheer - keel) * 0.85);
    const topB = chineB + (sheer - chineY) * flare * f;
    const nb = 7;
    for (let k = 0; k <= nb; k++) {
      const t = k / nb;
      // a slight convex bottom, like a real vee
      pts.push([chineB * t, keel + (chineY - keel) * (t ** 1.08)]);
    }
    const nt = N_PT - nb - 1;
    for (let k = 1; k <= nt; k++) {
      const t = k / nt;
      pts.push([chineB + (topB - chineB) * t, chineY + (sheer - chineY) * t]);
    }
  } else {
    const n = Math.max(2, h.bilge);
    const bilgeTop = keel + Math.min(sheer - keel, Math.max(hb * 0.9, (sheer - keel) * 0.55));
    const nb = 10;
    for (let k = 0; k <= nb; k++) {
      const th = (k / nb) * (Math.PI / 2);
      const c = Math.cos(th);
      const s = Math.sin(th);
      const zz = hb * Math.sign(s) * Math.abs(s) ** (2 / n);
      const yy = keel + (bilgeTop - keel) * (1 - Math.sign(c) * Math.abs(c) ** (2 / n));
      pts.push([zz, yy]);
    }
    const nt = N_PT - nb - 1;
    for (let k = 1; k <= nt; k++) {
      const t = k / nt;
      pts.push([hb + (sheer - bilgeTop) * flare * f * t, bilgeTop + (sheer - bilgeTop) * t]);
    }
  }
  return pts;
}

/** The hull as a closed (watertight) mesh, transom at x = 0, bow at x = L. */
export function hullGeometry(h: HullParams): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const P = N_PT;
  // starboard + port surfaces: vertex (i, j, side)
  const vid = (i: number, j: number, side: 0 | 1) => (i * P + j) * 2 + side;
  for (let i = 0; i <= N_ST; i++) {
    const u = i / N_ST;
    const sec = halfSection(h, u);
    for (let j = 0; j < P; j++) {
      const [z, y] = sec[j];
      pos.push(u * h.length, y, z); // side 0: starboard
      pos.push(u * h.length, y, -z); // side 1: port
    }
  }
  for (let i = 0; i < N_ST; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = vid(i, j, 0), b = vid(i + 1, j, 0), c = vid(i + 1, j + 1, 0), d = vid(i, j + 1, 0);
      idx.push(a, b, c, a, c, d);
      const a2 = vid(i, j, 1), b2 = vid(i + 1, j, 1), c2 = vid(i + 1, j + 1, 1), d2 = vid(i, j + 1, 1);
      idx.push(a2, c2, b2, a2, d2, c2);
    }
    // deck between the sheers
    const s0 = vid(i, P - 1, 0), s1 = vid(i + 1, P - 1, 0), p0 = vid(i, P - 1, 1), p1 = vid(i + 1, P - 1, 1);
    idx.push(s0, s1, p1, s0, p1, p0);
  }
  // transom (fan from its centre)
  const centre = pos.length / 3;
  const sec0 = halfSection(h, 0);
  const cy = sec0.reduce((m, p) => m + p[1], 0) / sec0.length;
  pos.push(0, cy, 0);
  const ring = [...Array.from({ length: P }, (_, j) => vid(0, j, 0)), ...Array.from({ length: P }, (_, j) => vid(0, P - 1 - j, 1))];
  for (let k = 0; k < ring.length; k++) idx.push(centre, ring[k], ring[(k + 1) % ring.length]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  // Outward normals: flip if the volume came out negative.
  if (meshVolume(trianglesOf(g)) < 0) {
    const ix = g.getIndex() as THREE.BufferAttribute;
    for (let k = 0; k < ix.count; k += 3) {
      const t = ix.getX(k + 1);
      ix.setX(k + 1, ix.getX(k + 2));
      ix.setX(k + 2, t);
    }
  }
  g.computeVertexNormals();
  return g;
}

// ─── Triangles ───────────────────────────────────────────────────────────

/** A triangle soup: 9 numbers per triangle (world space). */
export type Tris = Float64Array;

export function trianglesOf(g: THREE.BufferGeometry, m?: THREE.Matrix4): Tris {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const ix = g.getIndex();
  const n = ix ? ix.count : p.count;
  const out = new Float64Array(n * 3);
  const v = new THREE.Vector3();
  for (let k = 0; k < n; k++) {
    const i = ix ? ix.getX(k) : k;
    v.fromBufferAttribute(p, i);
    if (m) v.applyMatrix4(m);
    out[k * 3] = v.x;
    out[k * 3 + 1] = v.y;
    out[k * 3 + 2] = v.z;
  }
  return out;
}

/** Every mesh under an object, in world space. */
export function trianglesOfObject(o: THREE.Object3D): Tris {
  o.updateWorldMatrix(true, true);
  const parts: Tris[] = [];
  o.traverse((x) => {
    const mesh = x as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry && !x.userData.helper) parts.push(trianglesOf(mesh.geometry, mesh.matrixWorld));
  });
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float64Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function meshVolume(t: Tris): number {
  let v = 0;
  for (let k = 0; k < t.length; k += 9) {
    const ax = t[k], ay = t[k + 1], az = t[k + 2];
    const bx = t[k + 3], by = t[k + 4], bz = t[k + 5];
    const cx = t[k + 6], cy = t[k + 7], cz = t[k + 8];
    v += ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx);
  }
  return v / 6;
}

/** Rotate a soup about a point: heel φ (about x, starboard down) then trim θ
 *  (about z, bow down positive). Degrees. */
export function posed(t: Tris, about: [number, number, number], heel: number, trim: number): Tris {
  const out = new Float64Array(t.length);
  const ph = (heel * Math.PI) / 180;
  const th = (-trim * Math.PI) / 180;
  const ch = Math.cos(ph), sh = Math.sin(ph), ct = Math.cos(th), st = Math.sin(th);
  for (let k = 0; k < t.length; k += 3) {
    const x = t[k] - about[0], y = t[k + 1] - about[1], z = t[k + 2] - about[2];
    // heel about x
    const y1 = y * ch - z * sh;
    const z1 = y * sh + z * ch;
    // trim about z
    const x2 = x * ct - y1 * st;
    const y2 = x * st + y1 * ct;
    out[k] = x2 + about[0];
    out[k + 1] = y2 + about[1];
    out[k + 2] = z1 + about[2];
  }
  return out;
}

export function boundsOfTris(t: Tris) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < t.length; k += 3) {
    for (let a = 0; a < 3; a++) {
      if (t[k + a] < min[a]) min[a] = t[k + a];
      if (t[k + a] > max[a]) max[a] = t[k + a];
    }
  }
  return { min, max };
}

// ─── Hydrostatics ────────────────────────────────────────────────────────

export type Hydro = {
  waterline: number; // y of the water
  volume: number; // m³
  centre: [number, number, number]; // centre of buoyancy (x, y, z)
  wetted: number; // m²
  awp: number; // waterplane area, m²
  lcf: number; // x of the waterplane centroid
  tcf: number;
  it: number; // waterplane 2nd moment about the centreline (transverse)
  il: number; // … about the transverse axis through LCF (longitudinal)
  lwl: number;
  bwl: number;
  xAft: number; // waterline ends
  xFwd: number;
};

/** Everything below the plane y = w (the shell must be closed). */
export function submerged(t: Tris, w: number): Hydro {
  let vol = 0, mx = 0, my = 0, mz = 0, wet = 0;
  // waterplane integrals over the cut segments (Green's theorem)
  let A = 0, Sx = 0, Sz = 0, Ixx = 0, Izz = 0;
  let xa = Infinity, xf = -Infinity, zmin = Infinity, zmax = -Infinity;
  const P = [0, 0, 0], Q = [0, 0, 0], R = [0, 0, 0];
  const poly: number[][] = [];
  const cutPts: number[][] = [];
  const addTet = (a: number[], b: number[], c: number[]) => {
    // tetra with apex (0, w, 0) on the plane: no cap needed
    const ax = a[0], ay = a[1] - w, az = a[2];
    const bx = b[0], by = b[1] - w, bz = b[2];
    const cx = c[0], cy = c[1] - w, cz = c[2];
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    vol += v;
    mx += v * (a[0] + b[0] + c[0]) / 4;
    my += v * (w + a[1] + b[1] + c[1]) / 4;
    mz += v * (a[2] + b[2] + c[2]) / 4;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    wet += 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
  };
  for (let k = 0; k < t.length; k += 9) {
    P[0] = t[k]; P[1] = t[k + 1]; P[2] = t[k + 2];
    Q[0] = t[k + 3]; Q[1] = t[k + 4]; Q[2] = t[k + 5];
    R[0] = t[k + 6]; R[1] = t[k + 7]; R[2] = t[k + 8];
    const tri = [P, Q, R];
    const below = tri.map((p) => p[1] <= w);
    const nb = below.filter(Boolean).length;
    if (nb === 0) continue;
    if (nb === 3) {
      addTet(P, Q, R);
      continue;
    }
    // clip (Sutherland–Hodgman, one plane), remembering the cut edge
    poly.length = 0;
    cutPts.length = 0;
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      const ia = a[1] <= w, ib = b[1] <= w;
      if (ia) poly.push([a[0], a[1], a[2]]);
      if (ia !== ib) {
        const s = (w - a[1]) / (b[1] - a[1]);
        const p = [a[0] + (b[0] - a[0]) * s, w, a[2] + (b[2] - a[2]) * s];
        poly.push(p);
        cutPts.push(p);
      }
    }
    for (let i = 1; i + 1 < poly.length; i++) addTet(poly[0], poly[i], poly[i + 1]);
    if (cutPts.length === 2) {
      // the cut edge, in the clipped polygon's order (a → b)
      const ai = poly.indexOf(cutPts[0]);
      const bi = poly.indexOf(cutPts[1]);
      const [a, b] = (ai + 1) % poly.length === bi ? [cutPts[0], cutPts[1]] : [cutPts[1], cutPts[0]];
      // plane coordinates (x, z)
      const x1 = a[0], z1 = a[2], x2 = b[0], z2 = b[2];
      const cr = x1 * z2 - x2 * z1;
      A += cr / 2;
      Sx += ((x1 + x2) * cr) / 6;
      Sz += ((z1 + z2) * cr) / 6;
      Ixx += ((x1 * x1 + x1 * x2 + x2 * x2) * cr) / 12;
      Izz += ((z1 * z1 + z1 * z2 + z2 * z2) * cr) / 12;
      for (const p of [a, b]) {
        xa = Math.min(xa, p[0]);
        xf = Math.max(xf, p[0]);
        zmin = Math.min(zmin, p[2]);
        zmax = Math.max(zmax, p[2]);
      }
    }
  }
  // The cut edges run around the cap the other way: flip to a positive area.
  if (A < 0) {
    A = -A; Sx = -Sx; Sz = -Sz; Ixx = -Ixx; Izz = -Izz;
  }
  const lcf = A ? Sx / A : 0;
  const tcf = A ? Sz / A : 0;
  return {
    waterline: w,
    volume: vol,
    centre: vol > 1e-12 ? [mx / vol, my / vol, mz / vol] : [0, w, 0],
    wetted: wet,
    awp: A,
    lcf,
    tcf,
    it: Izz - A * tcf * tcf,
    il: Ixx - A * lcf * lcf,
    lwl: Number.isFinite(xf - xa) ? xf - xa : 0,
    bwl: Number.isFinite(zmax - zmin) ? zmax - zmin : 0,
    xAft: Number.isFinite(xa) ? xa : 0,
    xFwd: Number.isFinite(xf) ? xf : 0,
  };
}

/** The waterline at which it displaces `volume` (bisection). */
export function waterlineFor(t: Tris, volume: number): Hydro | null {
  const { min, max } = boundsOfTris(t);
  const total = submerged(t, max[1] + 1e-6).volume;
  if (volume > total) return null; // it sinks
  let lo = min[1], hi = max[1];
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (submerged(t, mid).volume < volume) lo = mid;
    else hi = mid;
  }
  return submerged(t, (lo + hi) / 2);
}

export type Weight = { name: string; mass: number; cg: [number, number, number] };

export type Equilibrium = Hydro & {
  heel: number;
  trim: number; // ° bow down +
  draft: number; // at the LCF, keel to waterline (upright frame)
  draftAft: number;
  draftFwd: number;
  displacement: number; // kg
  kb: number;
  bmt: number;
  bml: number;
  kmt: number;
  kml: number;
  gmt: number;
  gml: number;
  cb: number;
  cp: number;
  cm: number;
  cwp: number;
  am: number;
  tpc: number; // tonnes per cm immersion
  mct: number; // tonne·m per cm of trim
  transomArea: number; // immersed transom area
  keel: number; // lowest point (y)
};

/** Section area below water at x (from a posed soup). */
export function sectionArea(t: Tris, x: number, w: number): { area: number; beam: number; depth: number } {
  // Cut at x, keep segments, clip each to y ≤ w and integrate (Green, in (z, y)).
  let A = 0, zmin = Infinity, zmax = -Infinity, ymin = Infinity;
  const segs = sliceTris(t, 0, x);
  for (const [a, b] of segs) {
    // a, b are [z, y]
    let p = a, q = b;
    const pa = p[1] <= w, qa = q[1] <= w;
    if (!pa && !qa) continue;
    if (pa !== qa) {
      const s = (w - p[1]) / (q[1] - p[1]);
      const c: [number, number] = [p[0] + (q[0] - p[0]) * s, w];
      if (pa) q = c;
      else p = c;
    }
    A += (p[0] * (q[1] - w) - q[0] * (p[1] - w)) / 2;
    zmin = Math.min(zmin, p[0], q[0]);
    zmax = Math.max(zmax, p[0], q[0]);
    ymin = Math.min(ymin, p[1], q[1]);
  }
  return { area: Math.abs(A), beam: Number.isFinite(zmax - zmin) ? zmax - zmin : 0, depth: Number.isFinite(ymin) ? w - ymin : 0 };
}

/**
 * Float it: the waterline and trim at which the weight is held up and the
 * centre of buoyancy is under the centre of gravity (free trim), at a heel.
 */
export function equilibrium(t: Tris, w: Weight, rho: number, heel = 0, freeTrim = true, fixedTrim = 0): Equilibrium | null {
  const V = w.mass / rho;
  const solve = (trim: number) => {
    const p = posed(t, w.cg, heel, trim);
    const h = waterlineFor(p, V);
    return h ? { p, h } : null;
  };
  let trim = fixedTrim;
  let s = solve(trim);
  if (!s) return null;
  if (freeTrim && heel === 0) {
    // secant on trim until LCB is under LCG
    let t0 = 0, f0 = s.h.centre[0] - w.cg[0];
    let t1 = f0 > 0 ? 0.5 : -0.5;
    let s1 = solve(t1);
    if (!s1) return null;
    let f1 = s1.h.centre[0] - w.cg[0];
    for (let i = 0; i < 30 && Math.abs(f1) > 1e-5; i++) {
      const t2 = Math.max(-30, Math.min(30, t1 - (f1 * (t1 - t0)) / (f1 - f0 || 1e-9)));
      const s2 = solve(t2);
      if (!s2) break;
      t0 = t1; f0 = f1; t1 = t2; s1 = s2; f1 = s2.h.centre[0] - w.cg[0];
    }
    trim = t1;
    s = s1;
  }
  const { p, h } = s;
  const { min, max } = boundsOfTris(p);
  const keel = min[1];
  const disp = h.volume * rho;
  const kb = h.centre[1] - keel;
  const bmt = h.volume ? h.it / h.volume : 0;
  const bml = h.volume ? h.il / h.volume : 0;
  const kg = w.cg[1] - keel;
  const xMid = (h.xAft + h.xFwd) / 2;
  const mid = sectionArea(p, xMid, h.waterline);
  // the deepest immersed section, for Cm
  let am = mid.area;
  for (let k = 1; k < 20; k++) am = Math.max(am, sectionArea(p, h.xAft + ((h.xFwd - h.xAft) * k) / 20, h.waterline).area);
  const T = h.waterline - keel;
  const cb = h.lwl && h.bwl && T ? h.volume / (h.lwl * h.bwl * T) : 0;
  const cm = h.bwl && T ? am / (h.bwl * T) : 0;
  const tr = sectionArea(p, min[0] + 1e-4, h.waterline);
  const drAt = (x: number) => {
    const s2 = sliceTris(p, 0, x);
    let lo = Infinity;
    for (const [a, b] of s2) lo = Math.min(lo, a[1], b[1]);
    return Number.isFinite(lo) ? Math.max(0, h.waterline - lo) : 0;
  };
  void max;
  return {
    ...h,
    heel,
    trim,
    draft: T,
    draftAft: drAt(h.xAft + 0.02 * h.lwl),
    draftFwd: drAt(h.xFwd - 0.02 * h.lwl),
    displacement: disp,
    kb,
    bmt,
    bml,
    kmt: kb + bmt,
    kml: kb + bml,
    gmt: kb + bmt - kg,
    gml: kb + bml - kg,
    cb,
    cm,
    cp: cm ? cb / cm : 0,
    cwp: h.lwl && h.bwl ? h.awp / (h.lwl * h.bwl) : 0,
    am,
    tpc: (h.awp * 0.01 * rho) / 1000,
    mct: h.lwl ? (disp / 1000) * bml / (100 * h.lwl) : 0,
    transomArea: tr.area,
    keel,
  };
}

/** Righting arm GZ (m) against heel, at the upright trim. */
export function gzCurve(t: Tris, w: Weight, rho: number, trim: number, angles = Array.from({ length: 19 }, (_, i) => i * 5)) {
  const V = w.mass / rho;
  return angles.map((a) => {
    const p = posed(t, w.cg, a, trim);
    const h = waterlineFor(p, V);
    // After heeling about G, B's sideways offset from G is the righting arm.
    return { heel: a, gz: h ? h.centre[2] - w.cg[2] : Number.NaN };
  });
}

// ─── Lines ───────────────────────────────────────────────────────────────

/** Cut a soup with the plane (axis = 0 x, 1 y, 2 z) at `at`: segments in the
 *  plane's other two coordinates (x→[z,y], y→[x,z], z→[x,y]). */
export function sliceTris(t: Tris, axis: 0 | 1 | 2, at: number): [[number, number], [number, number]][] {
  const out: [[number, number], [number, number]][] = [];
  const [u, v] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
  for (let k = 0; k < t.length; k += 9) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const a = k + i * 3, b = k + ((i + 1) % 3) * 3;
      const da = t[a + axis] - at, db = t[b + axis] - at;
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const s = da / (da - db);
        pts.push([t[a + u] + (t[b + u] - t[a + u]) * s, t[a + v] + (t[b + v] - t[a + v]) * s]);
      }
    }
    if (pts.length === 2) out.push([pts[0], pts[1]]);
  }
  return out;
}

/** Offsets: half-breadths at each station for each waterline height. */
export function offsets(t: Tris, stations: number[], heights: number[]): number[][] {
  return stations.map((x) => {
    const segs = sliceTris(t, 0, x);
    return heights.map((y) => {
      let hb = 0;
      for (const [a, b] of segs) {
        if ((a[1] - y) * (b[1] - y) > 0) continue;
        const s = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1]);
        hb = Math.max(hb, a[0] + (b[0] - a[0]) * s);
      }
      return hb;
    });
  });
}

// ─── Resistance ──────────────────────────────────────────────────────────

export type ResistancePoint = { knots: number; fn: number; rt: number; power: number; trim?: number; method: string };

const ittc = (re: number) => 0.075 / (Math.log10(re) - 2) ** 2;

/**
 * Holtrop & Mennen (1984) for displacement and semi-displacement hulls,
 * Fn ≤ 0.45 (no bulb). Lengths in m, volume in m³, lcb in % of L forward of
 * midships, wetted area S in m², transom area AT in m².
 */
export function holtrop(p: { L: number; B: number; T: number; V: number; cm: number; cwp: number; cb: number; lcb: number; S: number; AT: number; rho: number; nu: number }, speed: number): number {
  const { L, B, T, V, cm, cwp, rho, nu } = p;
  const cp = p.cb / cm;
  const lcb = p.lcb;
  const LR = L * (1 - cp + (0.06 * cp * lcb) / (4 * cp - 1));
  const k1 = 0.93 + 0.487118 * (B / L) ** 1.06806 * (T / L) ** 0.46106 * (L / LR) ** 0.121563 * (L ** 3 / V) ** 0.36486 * (1 - cp) ** -0.604247;
  const Fn = speed / Math.sqrt(G * L);
  const Re = (speed * L) / nu;
  const RF = 0.5 * rho * speed ** 2 * p.S * ittc(Math.max(Re, 1e5));
  const BL = B / L;
  const c7 = BL < 0.11 ? 0.229577 * BL ** 0.33333 : BL < 0.25 ? BL : 0.5 - 0.0625 * (L / B);
  const iE = 1 + 89 * Math.exp(-((L / B) ** 0.80856) * (1 - cwp) ** 0.30484 * Math.max(1e-6, 1 - cp - 0.0225 * lcb) ** 0.6367 * (LR / B) ** 0.34574 * ((100 * V) / L ** 3) ** 0.16302);
  const c1 = 2223105 * c7 ** 3.78613 * (T / B) ** 1.07961 * Math.max(1, 90 - iE) ** -1.37565;
  const c5 = 1 - (0.8 * p.AT) / (B * T * cm);
  const lam = L / B < 12 ? 1.446 * cp - 0.03 * (L / B) : 1.446 * cp - 0.36;
  const c16 = cp < 0.8 ? 8.07981 * cp - 13.8673 * cp ** 2 + 6.984388 * cp ** 3 : 1.73014 - 0.7067 * cp;
  const m1 = 0.0140407 * (L / T) - (1.75254 * V ** (1 / 3)) / L - 4.79323 * (B / L) - c16;
  const L3V = L ** 3 / V;
  const c15 = L3V < 512 ? -1.69385 : L3V > 1726.91 ? 0 : -1.69385 + (L / V ** (1 / 3) - 8) / 2.36;
  const m4 = c15 * 0.4 * Math.exp(-0.034 * Fn ** -3.29);
  const RW = Fn > 0.02 ? c1 * c5 * V * rho * G * Math.exp(m1 * Fn ** -0.9 + m4 * Math.cos(lam * Fn ** -2)) : 0;
  const FnT = p.AT > 0 ? speed / Math.sqrt((2 * G * p.AT) / (B + B * cwp)) : 99;
  const c6 = FnT < 5 ? 0.2 * (1 - 0.2 * FnT) : 0;
  const RTR = 0.5 * rho * speed ** 2 * p.AT * c6;
  const c4 = Math.min(0.04, p.T / L);
  const CA = 0.006 * (L + 100) ** -0.16 - 0.00205 + 0.003 * Math.sqrt(L / 7.5) * p.cb ** 4 * 0.04 * (0.04 - c4);
  const RA = 0.5 * rho * speed ** 2 * p.S * CA;
  return RF * k1 + RW + RTR + RA;
}

/**
 * Savitsky (1964) for planing hulls, thrust through the CG. b = chine beam,
 * lcg = CG forward of the transom, beta = deadrise (°), mass in kg.
 * Returns the resistance (N) and running trim (°), or null below planing.
 */
export function savitsky(p: { mass: number; b: number; lcg: number; beta: number; rho: number; nu: number }, speed: number): { r: number; trim: number } | null {
  const { b, rho, nu } = p;
  const W = p.mass * G;
  const beta = p.beta;
  const Cv = speed / Math.sqrt(G * b);
  if (Cv < 1) return null;
  const CLb = W / (0.5 * rho * speed ** 2 * b ** 2);
  // CL0 from CLβ = CL0 − 0.0065 β CL0^0.6
  let CL0 = CLb;
  for (let i = 0; i < 50; i++) CL0 = CLb + 0.0065 * beta * CL0 ** 0.6;
  const lambdaFor = (tau: number) => {
    // CL0 = τ^1.1 (0.012 λ^0.5 + 0.0055 λ^2.5 / Cv²)
    let lo = 0.01, hi = 40;
    for (let i = 0; i < 60; i++) {
      const lam = (lo + hi) / 2;
      const c = tau ** 1.1 * (0.012 * Math.sqrt(lam) + (0.0055 * lam ** 2.5) / Cv ** 2);
      if (c < CL0) lo = lam;
      else hi = lam;
    }
    return (lo + hi) / 2;
  };
  const centreOfPressure = (tau: number) => {
    const lam = lambdaFor(tau);
    const Cp = 0.75 - 1 / ((5.21 * Cv ** 2) / lam ** 2 + 2.39);
    return { lam, lp: Cp * lam * b };
  };
  // trim where the centre of pressure is at the CG
  let lo = 0.5, hi = 20;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (centreOfPressure(mid).lp > p.lcg) lo = mid;
    else hi = mid;
  }
  const tau = (lo + hi) / 2;
  const { lam } = centreOfPressure(tau);
  const t1 = 0.012 * Math.sqrt(lam) * tau ** 1.1;
  const Vm = speed * Math.sqrt(Math.max(0.05, 1 - (t1 - 0.0065 * beta * t1 ** 0.6) / (lam * Math.cos((tau * Math.PI) / 180))));
  const Re = (Vm * lam * b) / nu;
  const Cf = ittc(Re) + 0.0004;
  const Df = (0.5 * rho * Vm ** 2 * lam * b ** 2 * Cf) / Math.cos((beta * Math.PI) / 180);
  const t = (tau * Math.PI) / 180;
  return { r: W * Math.tan(t) + Df / Math.cos(t), trim: tau };
}
