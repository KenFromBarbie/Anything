// Structure analysis for the 3D editor: linear static finite-element analysis
// of 3D frames (Euler–Bernoulli beam elements, 6 DOF per node), as in a CAD
// package's frame/weldment simulation. Members come from line curves in the
// scene; nodes are merged where ends meet; supports, point loads and
// self-weight; results are deflections, member forces, stresses and the
// safety factor against yield.

import type { Vec3 } from "./modelFormat";
import { solveLinear } from "./robotics";

export type MaterialId = "steel" | "stainless" | "aluminium" | "titanium" | "wood" | "pla" | "petg" | "carbon";
export const MATERIALS: Record<MaterialId, { label: string; E: number; G: number; fy: number; rho: number }> = {
  steel: { label: "Steel S235", E: 210e9, G: 81e9, fy: 235e6, rho: 7850 },
  stainless: { label: "Stainless 304", E: 193e9, G: 77e9, fy: 215e6, rho: 8000 },
  aluminium: { label: "Aluminium 6061-T6", E: 69e9, G: 26e9, fy: 240e6, rho: 2700 },
  titanium: { label: "Titanium Gr5", E: 114e9, G: 44e9, fy: 880e6, rho: 4430 },
  wood: { label: "Timber C24", E: 11e9, G: 0.69e9, fy: 24e6, rho: 420 },
  pla: { label: "PLA (printed)", E: 3.5e9, G: 1.3e9, fy: 50e6, rho: 1240 },
  petg: { label: "PETG (printed)", E: 2.1e9, G: 0.8e9, fy: 50e6, rho: 1270 },
  carbon: { label: "Carbon tube (CFRP)", E: 70e9, G: 5e9, fy: 600e6, rho: 1550 },
};

export type SectionShape = "tube" | "square" | "rect" | "rod";
export type Section = { shape: SectionShape; /** mm */ d: number; /** mm (height for rect) */ h?: number; /** wall mm */ t?: number };

/** Area (m²), second moments Iy, Iz (m⁴), torsion J (m⁴), and extreme fibre
 *  distances cy, cz (m). y is the section's "up", z its "side". */
export function sectionProps(s: Section): { A: number; Iy: number; Iz: number; J: number; cy: number; cz: number } {
  const mm = 1e-3;
  if (s.shape === "rod") {
    const r = (s.d * mm) / 2;
    const I = (Math.PI * r ** 4) / 4;
    return { A: Math.PI * r * r, Iy: I, Iz: I, J: 2 * I, cy: r, cz: r };
  }
  if (s.shape === "tube") {
    const ro = (s.d * mm) / 2;
    const ri = Math.max(0, ro - (s.t ?? s.d / 10) * mm);
    const I = (Math.PI * (ro ** 4 - ri ** 4)) / 4;
    return { A: Math.PI * (ro * ro - ri * ri), Iy: I, Iz: I, J: 2 * I, cy: ro, cz: ro };
  }
  const b = s.d * mm;
  const h = (s.shape === "rect" ? (s.h ?? s.d) : s.d) * mm;
  if (s.shape === "square" && s.t) {
    const t = s.t * mm;
    const bi = Math.max(0, b - 2 * t);
    const hi = Math.max(0, h - 2 * t);
    const Iz = (b * h ** 3 - bi * hi ** 3) / 12;
    const Iy = (h * b ** 3 - hi * bi ** 3) / 12;
    // thin-walled closed section torsion (Bredt)
    const Am = (b - t) * (h - t);
    const J = (4 * Am * Am * t) / (2 * (b - t) + 2 * (h - t));
    return { A: b * h - bi * hi, Iy, Iz, J, cy: h / 2, cz: b / 2 };
  }
  const Iz = (b * h ** 3) / 12;
  const Iy = (h * b ** 3) / 12;
  const a = Math.max(b, h) / 2;
  const c = Math.min(b, h) / 2;
  const J = a * c ** 3 * (16 / 3 - 3.36 * (c / a) * (1 - c ** 4 / (12 * a ** 4)));
  return { A: b * h, Iy, Iz, J, cy: h / 2, cz: b / 2 };
}

export type Member = { a: Vec3; b: Vec3; section: Section; material: MaterialId; name?: string };
export type Support = { at: Vec3; type: "fixed" | "pinned" };
export type Load = { at: Vec3; force: Vec3; /** N·m */ moment?: Vec3 };
export type FrameStudy = {
  /** curve object ids used as members (each segment is a member) */
  curves: string[];
  section: Section;
  material: MaterialId;
  supports: Support[];
  loads: Load[];
  selfWeight: boolean;
};

export type FrameModel = { members: Member[]; supports: Support[]; loads: Load[]; selfWeight: boolean; gravity?: number };

export type MemberResult = {
  index: number;
  /** axial force N (+ tension), shear Vy Vz, torsion T, moments My Mz at each end (N, N·m) */
  ends: [number[], number[]];
  /** peak combined stress (Pa) */
  stress: number;
  utilization: number;
  length: number;
};
export type FrameResult = {
  nodes: Vec3[];
  /** per node: [ux, uy, uz, rx, ry, rz] (m, rad) */
  displacement: number[][];
  members: MemberResult[];
  reactions: { at: Vec3; force: Vec3; moment: Vec3 }[];
  maxDisplacement: number;
  maxStress: number;
  safetyFactor: number;
  mass: number;
  ok: boolean;
  error?: string;
};

const TOL = 1e-3;

/** Solve a frame. */
export function solveFrame(model: FrameModel): FrameResult {
  const g = model.gravity ?? 9.81;
  // nodes
  const nodes: Vec3[] = [];
  const nodeOf = (p: Vec3) => {
    for (let i = 0; i < nodes.length; i++) if (Math.hypot(nodes[i][0] - p[0], nodes[i][1] - p[1], nodes[i][2] - p[2]) < TOL) return i;
    nodes.push([...p] as Vec3);
    return nodes.length - 1;
  };
  const els = model.members
    .map((m) => ({ m, i: nodeOf(m.a), j: nodeOf(m.b) }))
    .filter((e) => e.i !== e.j);
  const empty = (error: string): FrameResult => ({ nodes, displacement: [], members: [], reactions: [], maxDisplacement: 0, maxStress: 0, safetyFactor: 0, mass: 0, ok: false, error });
  if (!els.length) return empty("No members: draw lines or polylines and pick them as members.");
  if (nodes.length > 400) return empty("Too many joints for the solver (400 max).");
  const n = nodes.length * 6;
  const K: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const F = new Array(n).fill(0);
  const T: number[][][] = [];
  const kLoc: number[][][] = [];
  let mass = 0;

  els.forEach((e, k) => {
    const a = nodes[e.i];
    const b = nodes[e.j];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const L = Math.hypot(dx, dy, dz);
    const mat = MATERIALS[e.m.material];
    const sp = sectionProps(e.m.section);
    const { E, G } = mat;
    const { A, Iy, Iz, J } = sp;
    // local stiffness (12×12)
    const kl: number[][] = Array.from({ length: 12 }, () => new Array(12).fill(0));
    const put = (r: number, c: number, v: number) => {
      kl[r][c] += v;
      if (r !== c) kl[c][r] += v;
    };
    const EA = (E * A) / L, GJ = (G * J) / L;
    const z12 = (12 * E * Iz) / L ** 3, z6 = (6 * E * Iz) / L ** 2, z4 = (4 * E * Iz) / L, z2 = (2 * E * Iz) / L;
    const y12 = (12 * E * Iy) / L ** 3, y6 = (6 * E * Iy) / L ** 2, y4 = (4 * E * Iy) / L, y2 = (2 * E * Iy) / L;
    put(0, 0, EA); put(6, 6, EA); put(0, 6, -EA);
    put(3, 3, GJ); put(9, 9, GJ); put(3, 9, -GJ);
    // bending in local x-y plane (about z): v (1,7), θz (5,11)
    put(1, 1, z12); put(7, 7, z12); put(1, 7, -z12);
    put(1, 5, z6); put(1, 11, z6); put(5, 7, -z6); put(7, 11, -z6);
    put(5, 5, z4); put(11, 11, z4); put(5, 11, z2);
    // bending in local x-z plane (about y): w (2,8), θy (4,10)
    put(2, 2, y12); put(8, 8, y12); put(2, 8, -y12);
    put(2, 4, -y6); put(2, 10, -y6); put(4, 8, y6); put(8, 10, y6);
    put(4, 4, y4); put(10, 10, y4); put(4, 10, y2);
    // rotation: local x along the member; local y from a reference "up"
    const ex = [dx / L, dy / L, dz / L];
    const ref = Math.abs(ex[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0];
    let ez = cross(ex, ref);
    ez = scale(ez, 1 / Math.hypot(...ez));
    const ey = cross(ez, ex);
    const R = [ex, ey, ez];
    const t: number[][] = Array.from({ length: 12 }, () => new Array(12).fill(0));
    for (let blk = 0; blk < 4; blk++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) t[blk * 3 + r][blk * 3 + c] = R[r][c];
    T[k] = t;
    kLoc[k] = kl;
    // global = Tᵀ k T
    const kt = matMul(kl, t);
    const kg = matMul(transpose(t), kt);
    const dof = [...range(e.i * 6, 6), ...range(e.j * 6, 6)];
    for (let r = 0; r < 12; r++) for (let c = 0; c < 12; c++) K[dof[r]][dof[c]] += kg[r][c];
    const w = A * L * mat.rho;
    mass += w;
    if (model.selfWeight) {
      // lumped: half the weight at each end, plus the fixed-end moments
      const q = (w * g) / L; // N/m downwards (−y)
      F[e.i * 6 + 1] -= (q * L) / 2;
      F[e.j * 6 + 1] -= (q * L) / 2;
      // fixed-end moments of a uniform load, about the global axes
      const horiz = Math.hypot(dx, dz);
      if (horiz > 1e-9) {
        const Mend = (q * horiz * horiz) / 12;
        // moment vector ⟂ to both the member's horizontal direction and gravity
        const mAxis = [dz / horiz, 0, -dx / horiz];
        for (let c = 0; c < 3; c++) {
          F[e.i * 6 + 3 + c] += Mend * mAxis[c];
          F[e.j * 6 + 3 + c] -= Mend * mAxis[c];
        }
      }
    }
  });

  for (const l of model.loads) {
    const i = findNode(nodes, l.at);
    if (i < 0) continue;
    for (let c = 0; c < 3; c++) F[i * 6 + c] += l.force[c];
    if (l.moment) for (let c = 0; c < 3; c++) F[i * 6 + 3 + c] += l.moment[c];
  }

  const fixed = new Set<number>();
  const maxDiag = Math.max(...K.map((r, i) => Math.abs(r[i])));
  for (const s of model.supports) {
    const i = findNode(nodes, s.at);
    if (i < 0) continue;
    for (let c = 0; c < (s.type === "fixed" ? 6 : 3); c++) fixed.add(i * 6 + c);
    // A pin leaves the member free to twist about itself (a harmless rigid
    // mode): a tiny stabilising spring, as CAD solvers add. Real mechanisms
    // still show up as huge displacements below.
    if (s.type === "pinned") for (let c = 3; c < 6; c++) K[i * 6 + c][i * 6 + c] += maxDiag * 1e-9;
  }
  if (!fixed.size) return empty("Add at least one support (where the frame is held).");
  // rotational DOFs with no stiffness (pinned truss joints) get a tiny spring
  for (let d = 0; d < n; d++) if (!fixed.has(d) && Math.abs(K[d][d]) < 1e-9) K[d][d] = 1e-6;
  const free = range(0, n).filter((d) => !fixed.has(d));
  const Kff = free.map((r) => free.map((c) => K[r][c]));
  const Ff = free.map((r) => F[r]);
  const uf = cholesky(Kff, Ff) ?? solveLinear(Kff, Ff);
  if (!uf || uf.some((v) => !Number.isFinite(v))) return empty("The frame is a mechanism (it can move without bending): add supports or bracing.");
  const U = new Array(n).fill(0);
  free.forEach((d, k) => (U[d] = uf[k]));
  // Linear analysis assumes small deflections: anything this large means a
  // mechanism (or a frame far too weak for its load).
  if (U.some((v, d) => Math.abs(v) > (d % 6 < 3 ? 1 : 0.5))) return empty("The frame is a mechanism or far too weak for this load (it moves more than a metre or turns more than 30°): add supports, bracing or a stronger section.");

  // reactions = K U − F at fixed DOFs
  const reactions: FrameResult["reactions"] = [];
  for (const s of model.supports) {
    const i = findNode(nodes, s.at);
    if (i < 0) continue;
    const R6 = range(i * 6, 6).map((d) => K[d].reduce((acc, v, c) => acc + v * U[c], 0) - F[d]);
    reactions.push({ at: nodes[i], force: [R6[0], R6[1], R6[2]], moment: s.type === "fixed" ? [R6[3], R6[4], R6[5]] : [0, 0, 0] });
  }

  let maxStress = 0;
  const members: MemberResult[] = els.map((e, k) => {
    const dof = [...range(e.i * 6, 6), ...range(e.j * 6, 6)];
    const ug = dof.map((d) => U[d]);
    const ul = matVec(T[k], ug);
    const f = matVec(kLoc[k], ul); // local end forces
    const sp = sectionProps(e.m.section);
    const L = dist(nodes[e.i], nodes[e.j]);
    const endStress = (o: number) => {
      const N = Math.abs(f[o]);
      const My = Math.abs(f[o + 4]);
      const Mz = Math.abs(f[o + 5]);
      return N / sp.A + (My * sp.cz) / sp.Iy + (Mz * sp.cy) / sp.Iz;
    };
    const stress = Math.max(endStress(0), endStress(6));
    maxStress = Math.max(maxStress, stress);
    return {
      index: k,
      ends: [
        [-f[0], f[1], f[2], f[3], f[4], f[5]],
        [f[6], f[7], f[8], f[9], f[10], f[11]],
      ],
      stress,
      utilization: stress / MATERIALS[e.m.material].fy,
      length: L,
    };
  });
  const displacement = nodes.map((_, i) => U.slice(i * 6, i * 6 + 6));
  const maxDisplacement = Math.max(...displacement.map((u) => Math.hypot(u[0], u[1], u[2])));
  return {
    nodes,
    displacement,
    members,
    reactions,
    maxDisplacement,
    maxStress,
    safetyFactor: maxStress > 0 ? Math.min(...members.map((m) => (m.stress > 0 ? 1 / m.utilization : Number.POSITIVE_INFINITY))) : Number.POSITIVE_INFINITY,
    mass,
    ok: true,
  };
}

export function findNode(nodes: Vec3[], p: Vec3): number {
  let best = -1;
  let bd = 0.02;
  nodes.forEach((q, i) => {
    const d = dist(p, q);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

/** Cholesky solve for a symmetric positive-definite system, or null. */
function cholesky(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const L: Float64Array[] = Array.from({ length: n }, () => new Float64Array(n));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i][j];
      const Li = L[i], Lj = L[j];
      for (let k = 0; k < j; k++) s -= Li[k] * Lj[k];
      if (i === j) {
        if (s <= 0) return null;
        Li[i] = Math.sqrt(s);
      } else Li[j] = s / Lj[j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i][k] * y[k];
    y[i] = s / L[i][i];
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k][i] * x[k];
    x[i] = s / L[i][i];
  }
  return x;
}

const range = (s: number, n: number) => Array.from({ length: n }, (_, i) => s + i);
const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: number[], k: number) => a.map((v) => v * k);
const transpose = (m: number[][]) => m[0].map((_, c) => m.map((r) => r[c]));
function matMul(a: number[][], b: number[][]): number[][] {
  return a.map((row) => b[0].map((_, c) => row.reduce((s, v, k) => s + v * b[k][c], 0)));
}
function matVec(a: number[][], v: number[]): number[] {
  return a.map((row) => row.reduce((s, x, k) => s + x * v[k], 0));
}
