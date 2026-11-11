// Mass properties of a closed mesh, as a CAD package reports them: volume,
// surface area, mass, centre of gravity, and the inertia tensor about the
// centre of gravity (and its principal moments). Exact for a closed,
// consistently wound triangle mesh (signed tetrahedra from the origin).

import type { Tris } from "./marine";

export type MassProps = {
  volume: number;
  area: number;
  mass: number;
  cg: [number, number, number];
  /** inertia tensor about the CG (kg·m²): [Ixx, Iyy, Izz, Ixy, Iyz, Ixz] (products as +∫xy dm) */
  inertia: [number, number, number, number, number, number];
  principal: [number, number, number];
  /** radii of gyration (m) */
  gyration: [number, number, number];
};

export function massProps(t: Tris, density: number): MassProps {
  let V = 0;
  let A = 0;
  let cx = 0, cy = 0, cz = 0;
  // second moments about the origin, ∫ x² etc. (per unit density)
  let xx = 0, yy = 0, zz = 0, xy = 0, yz = 0, xz = 0;
  for (let k = 0; k < t.length; k += 9) {
    const a = [t[k], t[k + 1], t[k + 2]];
    const b = [t[k + 3], t[k + 4], t[k + 5]];
    const c = [t[k + 6], t[k + 7], t[k + 8]];
    // area
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    A += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
    // signed volume of the tetra (0, a, b, c)
    const det = a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    const v = det / 6;
    V += v;
    cx += (v * (a[0] + b[0] + c[0])) / 4;
    cy += (v * (a[1] + b[1] + c[1])) / 4;
    cz += (v * (a[2] + b[2] + c[2])) / 4;
    // ∫ p_i p_j over the tetra with one vertex at the origin
    const f = (i: number, j: number) => (v / 20) * (a[i] * a[j] + b[i] * b[j] + c[i] * c[j] + (a[i] + b[i] + c[i]) * (a[j] + b[j] + c[j]));
    xx += f(0, 0);
    yy += f(1, 1);
    zz += f(2, 2);
    xy += f(0, 1);
    yz += f(1, 2);
    xz += f(0, 2);
  }
  const sign = V < 0 ? -1 : 1;
  V *= sign;
  xx *= sign; yy *= sign; zz *= sign; xy *= sign; yz *= sign; xz *= sign;
  const cg: [number, number, number] = V > 1e-15 ? [(cx * sign) / V, (cy * sign) / V, (cz * sign) / V] : [0, 0, 0];
  const m = V * density;
  // about the origin, then shift to the CG (parallel axis)
  const sxx = (xx - V * cg[0] * cg[0]) * density;
  const syy = (yy - V * cg[1] * cg[1]) * density;
  const szz = (zz - V * cg[2] * cg[2]) * density;
  const sxy = (xy - V * cg[0] * cg[1]) * density;
  const syz = (yz - V * cg[1] * cg[2]) * density;
  const sxz = (xz - V * cg[0] * cg[2]) * density;
  const Ixx = syy + szz, Iyy = sxx + szz, Izz = sxx + syy;
  const inertia: MassProps["inertia"] = [Ixx, Iyy, Izz, sxy, syz, sxz];
  const principal = eigenSym3([
    [Ixx, -sxy, -sxz],
    [-sxy, Iyy, -syz],
    [-sxz, -syz, Izz],
  ]);
  const gyration = principal.map((I) => (m > 0 ? Math.sqrt(Math.max(0, I) / m) : 0)) as [number, number, number];
  return { volume: V, area: A, mass: m, cg, inertia, principal, gyration };
}

/** Eigenvalues of a symmetric 3×3 (Jacobi rotations), ascending. */
export function eigenSym3(M: number[][]): [number, number, number] {
  const a = M.map((r) => [...r]);
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += a[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => x - y) as [number, number, number];
}

export const DENSITIES: Record<string, number> = {
  Steel: 7850,
  Stainless: 8000,
  Aluminium: 2700,
  Titanium: 4430,
  Brass: 8500,
  "PLA (solid)": 1240,
  "PETG (solid)": 1270,
  "ABS (solid)": 1050,
  Nylon: 1140,
  "Carbon fibre": 1550,
  Oak: 750,
  Pine: 500,
  Water: 1000,
  Concrete: 2400,
  Glass: 2500,
};
