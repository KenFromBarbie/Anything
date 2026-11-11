// Rhino-style modeling for the 3D editor: curves (line, polyline,
// interpolated curve, circle, rectangle) and surfaces made from them
// (extrude, revolve, loft, pipe), kept with their history so editing a curve
// updates the surfaces built on it.

import * as THREE from "three";

import type { ModelFile, SceneObject, Vec3 } from "./modelFormat";
import { poseAt } from "./modelFormat";

export type CurveType = "polyline" | "interp" | "circle" | "rect";
export type CurveDef = {
  type: CurveType;
  /** Control / pick points in the curve's own space (circle: [centre, a
   *  point on it]; rect: two opposite corners). */
  points: Vec3[];
  closed?: boolean;
  /** Circle / rect plane normal ("y" top, "z" front, "x" right). */
  plane?: "x" | "y" | "z";
};

export type SurfaceOp = "extrude" | "revolve" | "loft" | "pipe";
export type SurfaceDef = {
  op: SurfaceOp;
  /** The curves it's made from (object ids), in order. */
  curves: string[];
  /** extrude */
  direction?: Vec3;
  /** revolve: degrees, about the axis through `axisPoint` along `axis` */
  angle?: number;
  axis?: Vec3;
  axisPoint?: Vec3;
  /** pipe radius */
  radius?: number;
  /** close the ends (extrude of a closed curve, pipe) */
  cap?: boolean;
};

const D2R = Math.PI / 180;

/** Points along a curve in its own space. */
export function curveSamples(c: CurveDef, n = 64): THREE.Vector3[] {
  const P = c.points.map((p) => new THREE.Vector3(...p));
  if (c.type === "circle" && P.length >= 2) {
    const centre = P[0];
    const r = centre.distanceTo(P[1]);
    const out: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const u = Math.cos(a) * r;
      const v = Math.sin(a) * r;
      out.push(
        c.plane === "z" ? new THREE.Vector3(centre.x + u, centre.y + v, centre.z) : c.plane === "x" ? new THREE.Vector3(centre.x, centre.y + v, centre.z + u) : new THREE.Vector3(centre.x + u, centre.y, centre.z + v),
      );
    }
    return out;
  }
  if (c.type === "rect" && P.length >= 2) {
    const [a, b] = P;
    const corners =
      c.plane === "z"
        ? [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, a.y, a.z), new THREE.Vector3(b.x, b.y, a.z), new THREE.Vector3(a.x, b.y, a.z)]
        : c.plane === "x"
          ? [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(a.x, a.y, b.z), new THREE.Vector3(a.x, b.y, b.z), new THREE.Vector3(a.x, b.y, a.z)]
          : [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, a.y, a.z), new THREE.Vector3(b.x, a.y, b.z), new THREE.Vector3(a.x, a.y, b.z)];
    return [...corners, corners[0].clone()];
  }
  if (c.type === "interp" && P.length >= 3) {
    const curve = new THREE.CatmullRomCurve3(P, !!c.closed, "centripetal");
    return curve.getPoints(Math.max(n, P.length * 8));
  }
  return c.closed && P.length > 2 ? [...P, P[0].clone()] : P;
}

export function isClosed(c: CurveDef): boolean {
  return c.type === "circle" || c.type === "rect" || !!c.closed;
}

export function curveLength(c: CurveDef): number {
  const s = curveSamples(c, 256);
  let L = 0;
  for (let i = 1; i < s.length; i++) L += s[i].distanceTo(s[i - 1]);
  return L;
}

/** The object's pose as a matrix. */
export function matrixOf(o: SceneObject, frame = 1): THREE.Matrix4 {
  const p = poseAt(o, frame);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...p.position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rotation[0] * D2R, p.rotation[1] * D2R, p.rotation[2] * D2R)),
    new THREE.Vector3(...p.scale),
  );
}

/** A curve's points in world space (its own transform applied). */
export function curveWorld(o: SceneObject, n = 64): THREE.Vector3[] {
  if (!o.curve) return [];
  const m = matrixOf(o);
  return curveSamples(o.curve, n).map((p) => p.applyMatrix4(m));
}

export function curveLine(c: CurveDef, color = "#e8e8e8"): THREE.Line {
  const g = new THREE.BufferGeometry().setFromPoints(curveSamples(c));
  return new THREE.Line(g, new THREE.LineBasicMaterial({ color }));
}

/** Resample a polyline to n points evenly by length. */
export function resample(pts: THREE.Vector3[], n: number): THREE.Vector3[] {
  if (pts.length < 2) return pts;
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const total = d[d.length - 1] || 1;
  const out: THREE.Vector3[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * total;
    while (j < d.length - 1 && d[j] < t) j++;
    const a = pts[j - 1], b = pts[j];
    const s = (t - d[j - 1]) / Math.max(1e-12, d[j] - d[j - 1]);
    out.push(a.clone().lerp(b, Math.min(1, Math.max(0, s))));
  }
  return out;
}

/** A grid surface through rows of points (rows × cols), optionally capped. */
function gridGeometry(rows: THREE.Vector3[][], closedCols: boolean): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const C = rows[0].length;
  for (const r of rows) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < C - 1; j++) {
      const a = i * C + j, b = i * C + j + 1, c = (i + 1) * C + j + 1, d = (i + 1) * C + j;
      idx.push(a, b, c, a, c, d);
    }
  }
  void closedCols;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat cap over a closed loop (ear-clipped in its best-fit plane). */
function capGeometry(loop: THREE.Vector3[], flip: boolean): THREE.BufferGeometry {
  const pts = loop.length > 1 && loop[0].distanceTo(loop[loop.length - 1]) < 1e-9 ? loop.slice(0, -1) : loop;
  // best-fit plane: Newell normal
  const nrm = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    nrm.x += (a.y - b.y) * (a.z + b.z);
    nrm.y += (a.z - b.z) * (a.x + b.x);
    nrm.z += (a.x - b.x) * (a.y + b.y);
  }
  nrm.normalize();
  const u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(nrm.dot(u)) > 0.9) u.set(0, 1, 0);
  const v = new THREE.Vector3().crossVectors(nrm, u).normalize();
  u.crossVectors(v, nrm).normalize();
  const flat = pts.map((p) => new THREE.Vector2(p.dot(u), p.dot(v)));
  const tris = THREE.ShapeUtils.triangulateShape(flat, []);
  const pos: number[] = [];
  for (const p of pts) pos.push(p.x, p.y, p.z);
  const idx: number[] = [];
  for (const [a, b, c] of tris) idx.push(...(flip ? [a, c, b] : [a, b, c]));
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const g of parts) {
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    const base = pos.length / 3;
    for (let i = 0; i < p.count; i++) pos.push(p.getX(i), p.getY(i), p.getZ(i));
    const ix = g.getIndex();
    if (ix) for (let i = 0; i < ix.count; i++) idx.push(ix.getX(i) + base);
    else for (let i = 0; i < p.count; i++) idx.push(base + i);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

/** The surface's mesh in world space, from its curves (history). */
export function surfaceGeometry(s: SurfaceDef, file: ModelFile): THREE.BufferGeometry | null {
  const curves = s.curves.map((id) => file.objects.find((o) => o.id === id)).filter((o): o is SceneObject => !!o?.curve);
  if (!curves.length) return null;
  const first = curves[0];
  const closed = isClosed(first.curve as CurveDef);
  if (s.op === "extrude") {
    const base = curveWorld(first, 96);
    const dir = new THREE.Vector3(...(s.direction ?? [0, 1, 0]));
    const top = base.map((p) => p.clone().add(dir));
    const parts = [gridGeometry([base, top], closed)];
    if (closed && s.cap !== false && base.length > 3) {
      parts.push(capGeometry(base, dir.y >= 0), capGeometry(top, dir.y < 0));
    }
    return merge(parts);
  }
  if (s.op === "revolve") {
    const prof = curveWorld(first, 96);
    const axis = new THREE.Vector3(...(s.axis ?? [0, 1, 0])).normalize();
    const at = new THREE.Vector3(...(s.axisPoint ?? [0, 0, 0]));
    const angle = (s.angle ?? 360) * D2R;
    const steps = Math.max(8, Math.round((Math.abs(angle) / (Math.PI * 2)) * 64));
    const rows: THREE.Vector3[][] = [];
    const q = new THREE.Quaternion();
    for (let k = 0; k <= steps; k++) {
      q.setFromAxisAngle(axis, (angle * k) / steps);
      rows.push(prof.map((p) => p.clone().sub(at).applyQuaternion(q).add(at)));
    }
    return gridGeometry(rows, false);
  }
  if (s.op === "loft") {
    if (curves.length < 2) return null;
    const n = 96;
    let rows = curves.map((c) => resample(curveWorld(c, n), n));
    // smooth between sections (Catmull-Rom through matching points)
    if (rows.length > 2) {
      const steps = (rows.length - 1) * 8;
      const cols = rows[0].map((_, j) => new THREE.CatmullRomCurve3(rows.map((r) => r[j]), false, "centripetal").getPoints(steps));
      rows = Array.from({ length: steps + 1 }, (_, i) => cols.map((c) => c[i]));
    }
    const parts = [gridGeometry(rows, closed)];
    if (closed && s.cap) parts.push(capGeometry(rows[0], true), capGeometry(rows[rows.length - 1], false));
    return merge(parts);
  }
  // pipe
  const path = curveWorld(first, 128);
  if (path.length < 2) return null;
  const tube = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, closed, "centripetal"), Math.max(32, path.length), Math.max(0.001, s.radius ?? 0.05), 24, closed);
  return tube;
}

/** Surface area of a mesh (m²). */
export function meshArea(g: THREE.BufferGeometry, m?: THREE.Matrix4): number {
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const ix = g.getIndex();
  const n = ix ? ix.count : p.count;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  let area = 0;
  for (let k = 0; k < n; k += 3) {
    a.fromBufferAttribute(p, ix ? ix.getX(k) : k);
    b.fromBufferAttribute(p, ix ? ix.getX(k + 1) : k + 1);
    c.fromBufferAttribute(p, ix ? ix.getX(k + 2) : k + 2);
    if (m) {
      a.applyMatrix4(m);
      b.applyMatrix4(m);
      c.applyMatrix4(m);
    }
    area += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return area;
}

/** Parse "x,y,z" (or "x,y" on the construction plane, or "@dx,dy,dz"
 *  relative to `last`). */
export function parsePoint(text: string, last: Vec3 | null, plane: "x" | "y" | "z"): Vec3 | null {
  const t = text.trim();
  const rel = t.startsWith("@");
  const nums = t.replace(/^@/, "").split(/[ ,;]+/).filter(Boolean).map(Number);
  if (!nums.length || nums.some((n) => !Number.isFinite(n))) return null;
  let p: Vec3;
  if (nums.length >= 3) p = [nums[0], nums[1], nums[2]];
  else if (nums.length === 2) p = plane === "y" ? [nums[0], 0, nums[1]] : plane === "z" ? [nums[0], nums[1], 0] : [0, nums[1], nums[0]];
  else return null;
  if (rel && last) p = [last[0] + p[0], last[1] + p[1], last[2] + p[2]];
  return p;
}
