"""The 3D editor's .model.json -> triangle meshes, one per object (the Office's
shared evaluator; first written by the floor for the HAVIK build).

Use it through modeleval.py (shared, cached) rather than on its own:
    python modeleval.py eval <file.model.json>
Direct use still works:
    python model_eval.py <file.model.json> [--glb out.glb] [--json out.json]

Object kinds handled: box, sphere, icosphere, cylinder, cone, torus, plane,
capsule, empty, curve (polyline/interp/circle/rect), surface (loft/extrude/
revolve/pipe), boolean (subtract/union/intersect), import (.glb and nested
.model.json). Kind "hull" is NOT evaluated (warned, skipped).

Conventions (assumed where the editor doc is silent; all listed in APPROX/WARN):
  * Rotation = degrees, Euler order XYZ as three.js: R = Rx @ Ry @ Rz.
  * Parent transforms compose: world = parent_world @ local (T @ R @ S).
  * Cylinder/cone/capsule axis = Y; torus lies in XY (three.js); plane lies in XZ.
  * capsule "height" = total height; plane "width"/"depth" = X/Z extents.
  * Keyframes ("keys") are ignored: the rest pose (frame 1 values) is used.
  * array: copy k is shifted by k*offset in the parent frame.
  * smooth: subdivision + Taubin smoothing (approximation of a subdivision surface).
  * bevel: exact rounded box (convex hull of corner spheres).
  * booleans: triangle-level classification (no exact CSG; manifold3d not
    installed, and no installs allowed). Cut faces are jagged; the result can be
    non-watertight. Cutters must be watertight to be used.
  * Output: visible objects only. Hidden objects (booleans' operands, curves,
    envelope shells) are still evaluated for use by other objects.
"""
import json
import math
import os
import sys

import numpy as np
import trimesh

try:
    import mapbox_earcut as _earcut
except Exception:  # pragma: no cover
    _earcut = None

APPROX = set()
WARN = []
EPS = 1e-9


def approx(tag):
    APPROX.add(tag)


def warn(msg):
    if msg not in WARN:
        WARN.append(msg)


# ---------------------------------------------------------------- transforms
def mat_t(p):
    M = np.eye(4)
    M[:3, 3] = p
    return M


def mat_s(s):
    M = np.eye(4)
    M[0, 0], M[1, 1], M[2, 2] = s
    return M


def mat_r(deg):
    rx, ry, rz = (math.radians(a) for a in deg)
    cx, sx = math.cos(rx), math.sin(rx)
    cy, sy = math.cos(ry), math.sin(ry)
    cz, sz = math.cos(rz), math.sin(rz)
    Rx = np.array([[1, 0, 0, 0], [0, cx, -sx, 0], [0, sx, cx, 0], [0, 0, 0, 1]])
    Ry = np.array([[cy, 0, sy, 0], [0, 1, 0, 0], [-sy, 0, cy, 0], [0, 0, 0, 1]])
    Rz = np.array([[cz, -sz, 0, 0], [sz, cz, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]])
    return Rx @ Ry @ Rz


def local_matrix(o):
    return mat_t(o.get("position", [0, 0, 0])) @ mat_r(o.get("rotation", [0, 0, 0])) @ mat_s(o.get("scale", [1, 1, 1]))


def apply(M, V):
    V = np.asarray(V, float).reshape(-1, 3)
    return V @ M[:3, :3].T + M[:3, 3]


def hex_rgba(h, opacity=1.0):
    h = (h or "#888888").lstrip("#")
    try:
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
    except ValueError:
        r, g, b = 136, 136, 136
    return [r, g, b, int(round(255 * opacity))]


# ---------------------------------------------------------------- primitives
def box_geom(w, h, d, bevel=0.0):
    if bevel and bevel > EPS:
        r = min(bevel, 0.499 * min(w, h, d))
        sp = trimesh.creation.icosphere(subdivisions=2, radius=r).vertices
        pts = []
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    pts.append(sp + np.array([sx * (w / 2 - r), sy * (h / 2 - r), sz * (d / 2 - r)]))
        hull = trimesh.convex.convex_hull(np.vstack(pts))
        return np.asarray(hull.vertices), np.asarray(hull.faces)
    m = trimesh.creation.box(extents=[w, h, d])
    return np.asarray(m.vertices), np.asarray(m.faces)


def frustum_geom(rt, rb, h, seg):
    seg = max(int(seg or 16), 3)
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    top = np.c_[rt * np.cos(th), np.full(seg, h / 2), rt * np.sin(th)]
    bot = np.c_[rb * np.cos(th), np.full(seg, -h / 2), rb * np.sin(th)]
    V = [top, bot]
    F = []
    n = 2 * seg
    ctop = cbot = None
    if rt > EPS:
        ctop = n
        V.append(np.array([[0, h / 2, 0.0]]))
        n += 1
    if rb > EPS:
        cbot = n
        V.append(np.array([[0, -h / 2, 0.0]]))
        n += 1
    for i in range(seg):
        j = (i + 1) % seg
        a = i if rt > EPS else ctop
        b = j if rt > EPS else ctop
        c = seg + j if rb > EPS else cbot
        d = seg + i if rb > EPS else cbot
        F.append([a, d, c])
        F.append([a, c, b])
        if rt > EPS:
            F.append([ctop, i, j])
        if rb > EPS:
            F.append([cbot, seg + j, seg + i])
    V = np.vstack(V)
    return V, np.array(F)


def torus_geom(R, r, seg_major, seg_minor=12):
    seg_major = max(int(seg_major or 32), 3)
    seg_minor = max(int(seg_minor), 3)
    u = np.linspace(0, 2 * np.pi, seg_major, endpoint=False)
    v = np.linspace(0, 2 * np.pi, seg_minor, endpoint=False)
    U, Vv = np.meshgrid(u, v, indexing="ij")
    x = (R + r * np.cos(Vv)) * np.cos(U)
    y = (R + r * np.cos(Vv)) * np.sin(U)
    z = r * np.sin(Vv)
    V = np.c_[x.ravel(), y.ravel(), z.ravel()]
    F = []
    for i in range(seg_major):
        for j in range(seg_minor):
            a = i * seg_minor + j
            b = ((i + 1) % seg_major) * seg_minor + j
            c = ((i + 1) % seg_major) * seg_minor + (j + 1) % seg_minor
            d = i * seg_minor + (j + 1) % seg_minor
            F += [[a, b, c], [a, c, d]]
    return V, np.array(F)


def sphere_geom(r):
    m = trimesh.creation.icosphere(subdivisions=3, radius=r)
    return np.asarray(m.vertices), np.asarray(m.faces)


def capsule_geom(r, h):
    r = min(r, h / 2)
    L = max(h - 2 * r, 0.0)
    sp = trimesh.creation.icosphere(subdivisions=3, radius=r).vertices
    pts = np.vstack([sp + [0, L / 2, 0], sp - [0, L / 2, 0]])
    hull = trimesh.convex.convex_hull(pts)   # exact capsule, watertight
    return np.asarray(hull.vertices), np.asarray(hull.faces)


def plane_geom(w, d):
    V = np.array([[-w / 2, 0, -d / 2], [w / 2, 0, -d / 2], [w / 2, 0, d / 2], [-w / 2, 0, d / 2]])
    return V, np.array([[0, 2, 1], [0, 3, 2]])


def join(parts):
    Vs, Fs, n = [], [], 0
    for V, F in parts:
        if V is None or len(V) == 0:
            continue
        Vs.append(np.asarray(V, float).reshape(-1, 3))
        Fs.append(np.asarray(F, int).reshape(-1, 3) + n)
        n += len(V)
    if not Vs:
        return np.zeros((0, 3)), np.zeros((0, 3), int)
    return np.vstack(Vs), np.vstack(Fs)


# ---------------------------------------------------------------- curves
def dedupe(P, closed):
    P = np.asarray(P, float)
    out = [P[0]] if len(P) else []
    for p in P[1:]:
        if np.linalg.norm(p - out[-1]) > 1e-9:
            out.append(p)
    if closed and len(out) > 1 and np.linalg.norm(out[-1] - out[0]) < 1e-9:
        out.pop()
    return np.array(out)


def catmull(P, closed, per=6):
    n = len(P)
    out = []
    rng = range(n) if closed else range(n - 1)
    for i in rng:
        if closed:
            p0, p1, p2, p3 = P[(i - 1) % n], P[i], P[(i + 1) % n], P[(i + 2) % n]
        else:
            p0, p1 = P[max(i - 1, 0)], P[i]
            p2, p3 = P[min(i + 1, n - 1)], P[min(i + 2, n - 1)]
        for t in np.linspace(0, 1, per, endpoint=False):
            out.append(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    if not closed:
        out.append(P[-1])
    return np.array(out)


def resample(P, closed, N):
    Q = np.vstack([P, P[:1]]) if closed else P
    seg = np.linalg.norm(np.diff(Q, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    total = s[-1]
    if total < EPS or len(P) < 2:
        return np.repeat(P[:1], N, axis=0)
    t = np.linspace(0, total, N, endpoint=not closed)
    return np.c_[[np.interp(t, s, Q[:, k]) for k in range(3)]].T


def plane_axes(plane):
    plane = (plane or "y").lower()
    if plane == "x":
        return 1, 2, 0
    if plane == "z":
        return 0, 1, 2
    return 0, 2, 1  # 'y' default: horizontal XZ


def curve_points(c):
    """Return (points (n,3) in the curve's own local frame, closed flag)."""
    kind = c.get("type", "polyline")
    pts = np.asarray(c.get("points", []), float).reshape(-1, 3)
    closed = bool(c.get("closed", False))
    if kind == "polyline":
        return pts, closed
    if kind == "interp":
        approx("curve-interp-catmull-rom")
        return catmull(pts, closed), closed
    if kind in ("circle", "rect"):
        ax_a, ax_b, fixed = plane_axes(c.get("plane"))
        if kind == "circle":
            cen, on = pts[0], pts[1]
            rad = np.array([on[ax_a] - cen[ax_a], on[ax_b] - cen[ax_b]])
            r = np.linalg.norm(rad)
            th0 = math.atan2(rad[1], rad[0])
            th = th0 + np.linspace(0, 2 * np.pi, 64, endpoint=False)
            P = np.zeros((64, 3))
            P[:, fixed] = cen[fixed]
            P[:, ax_a] = cen[ax_a] + r * np.cos(th)
            P[:, ax_b] = cen[ax_b] + r * np.sin(th)
            return P, True
        a, b = pts[0], pts[1]
        P = np.zeros((4, 3))
        P[:, fixed] = a[fixed]
        P[:, ax_a] = [a[ax_a], b[ax_a], b[ax_a], a[ax_a]]
        P[:, ax_b] = [a[ax_b], a[ax_b], b[ax_b], b[ax_b]]
        return P, True
    warn(f"unknown curve type {kind!r}; using its raw points")
    return pts, closed


# ---------------------------------------------------------------- caps / surfaces
def polygon_faces(P):
    """Triangulate a planar polygon (n,3) -> faces over 0..n-1."""
    n = len(P)
    if n < 3:
        return np.zeros((0, 3), int)
    fan = np.array([[0, i, i + 1] for i in range(1, n - 1)], int)
    nrm = np.zeros(3)
    for i in range(n):
        nrm += np.cross(P[i], P[(i + 1) % n])
    nn = np.linalg.norm(nrm)
    if nn < EPS:
        return fan
    nrm /= nn
    a = np.array([1.0, 0, 0]) if abs(nrm[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(nrm, a)
    u /= np.linalg.norm(u)
    v = np.cross(nrm, u)
    c = P.mean(axis=0)
    xy = np.c_[(P - c) @ u, (P - c) @ v].astype(np.float64)
    if _earcut is not None:
        try:
            idx = _earcut.triangulate_float64(xy, np.array([n], dtype=np.uint32))
            idx = np.asarray(idx, int).reshape(-1, 3)
            if len(idx):
                return idx
        except Exception:
            pass
    approx("cap-fan-triangulation")
    return fan


def _split_to(P, closed, N):
    """Add mid-points on the longest edges until the ring has N points (keeps every original corner)."""
    P = [np.asarray(p, float) for p in P]
    while len(P) < N:
        n = len(P)
        lens = []
        for i in range(n):
            if closed:
                lens.append((np.linalg.norm(P[(i + 1) % n] - P[i]), i))
            elif i < n - 1:
                lens.append((np.linalg.norm(P[i + 1] - P[i]), i))
        if not lens:
            break
        _, i = max(lens)
        j = (i + 1) % n if closed else i + 1
        P.insert(i + 1, (P[i] + P[j]) / 2.0)
    return np.array(P)


def _align(prev, cur, closed):
    """Cyclic shift (and reversal) of a closed ring so it corresponds to the previous ring."""
    if not closed:
        return cur
    n = len(cur)
    best = None
    for cand in (cur, cur[::-1]):
        for k in range(n):
            c = np.roll(cand, -k, axis=0)
            d = float(((c - prev) ** 2).sum())
            if best is None or d < best[0]:
                best = (d, c)
    return best[1]


def loft(secs, cap):
    """Loft through sections (points, closed) in surface-local space. Original corners are kept,
    rings with fewer points get mid-points on their longest edges, and each ring is aligned to the one
    before it, so the side faces connect the right points."""
    prepped = [(dedupe(P, c), c) for P, c in secs]
    N = max(len(Q) for Q, _ in prepped)
    all_closed = all(c for _, c in secs)
    rings = []
    for Q, c in prepped:
        if len(Q) < 2:
            rings.append(np.repeat(Q[:1], N, axis=0))
            continue
        R = _split_to(Q, c, N)
        if rings and c:
            R = _align(rings[-1], R, c)
        rings.append(R)
    M = len(rings)
    V = np.vstack(rings)
    F = []
    for i in range(M - 1):
        jmax = N if all_closed else N - 1
        for j in range(jmax):
            a = i * N + j
            b = i * N + (j + 1) % N
            c_ = (i + 1) * N + (j + 1) % N
            d = (i + 1) * N + j
            F += [[a, d, c_], [a, c_, b]]
    if cap:
        F += list(polygon_faces(rings[0]))
        F += list(polygon_faces(rings[-1]) + (M - 1) * N)
    return V, np.array(F, int).reshape(-1, 3)


def extrude(P, closed, d, cap):
    n = len(P)
    V = np.vstack([P, P + d])
    F = []
    m = n if closed else n - 1
    for i in range(m):
        j = (i + 1) % n
        a, b, c_, dd = i, j, n + j, n + i
        F += [[a, b, c_], [a, c_, dd]]
    if cap:
        F += list(polygon_faces(P))
        F += list(polygon_faces(P + d)[:, ::-1] + n)
    return V, np.array(F, int).reshape(-1, 3)


def rodrigues(v, k, th):
    return (v * math.cos(th) + np.cross(k, v) * math.sin(th)
            + np.outer(v @ k, k) * (1 - math.cos(th)))


def revolve(P, closed, axis, p0, angle_deg, cap):
    k = np.asarray(axis, float)
    k = k / (np.linalg.norm(k) or 1.0)
    full = abs(abs(angle_deg) - 360) < 1e-6
    nseg = max(8, int(round(abs(angle_deg) / 7.5)))
    angles = np.linspace(0, math.radians(angle_deg), nseg if full else nseg + 1, endpoint=not full)
    rings = [rodrigues(P - p0, k, th) + p0 for th in angles]
    n = len(P)
    R = len(rings)
    V = np.vstack(rings)
    F = []
    edges = n if closed else n - 1
    for r in range(R - 1 if not full else R):
        r2 = (r + 1) % R
        for j in range(edges):
            j2 = (j + 1) % n
            a, b = r * n + j, r * n + j2
            c_, d = r2 * n + j2, r2 * n + j
            F += [[a, d, c_], [a, c_, b]]
    if cap and not full:
        F += list(polygon_faces(rings[0]))
        F += list(polygon_faces(rings[-1])[:, ::-1] + (R - 1) * n)
    return V, np.array(F, int).reshape(-1, 3)


def pipe(P, closed, radius, cap, seg=16):
    n = len(P)
    t = np.zeros_like(P)
    for i in range(n):
        a = P[(i + 1) % n] if closed else P[min(i + 1, n - 1)]
        b = P[(i - 1) % n] if closed else P[max(i - 1, 0)]
        d = a - b
        t[i] = d / (np.linalg.norm(d) or 1.0)
    rings = []
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    for i in range(n):
        ref = np.array([0, 1.0, 0]) if abs(t[i][1]) < 0.9 else np.array([1.0, 0, 0])
        n1 = np.cross(t[i], ref)
        n1 /= np.linalg.norm(n1)
        n2 = np.cross(t[i], n1)
        rings.append(P[i] + radius * (np.outer(np.cos(th), n1) + np.outer(np.sin(th), n2)))
    V = np.vstack(rings)
    F = []
    edges = n if closed else n - 1
    for i in range(edges):
        i2 = (i + 1) % n
        for j in range(seg):
            j2 = (j + 1) % seg
            a, b = i * seg + j, i * seg + j2
            c_, d = i2 * seg + j2, i2 * seg + j
            F += [[a, d, c_], [a, c_, b]]
    if cap and not closed:
        F += list(polygon_faces(rings[0]))
        F += list(polygon_faces(rings[-1])[:, ::-1] + (n - 1) * seg)
    return V, np.array(F, int).reshape(-1, 3)


def clean(V, F):
    """Merge coincident vertices, drop degenerate and duplicate faces."""
    m = trimesh.Trimesh(V, F, process=True)
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    return np.asarray(m.vertices), np.asarray(m.faces)


def smooth_mesh(V, F, level):
    m = trimesh.Trimesh(V, F, process=True)
    for _ in range(int(level)):
        v2, f2 = trimesh.remesh.subdivide(np.asarray(m.vertices), np.asarray(m.faces))
        m = trimesh.Trimesh(v2, f2, process=True)
        trimesh.smoothing.filter_taubin(m, iterations=6)
    approx("smooth-taubin-not-subdivision-surface")
    return np.asarray(m.vertices), np.asarray(m.faces)


def orient_closed(m):
    """Consistent, outward winding for closed meshes (fix_normals), then flip if the volume is negative."""
    try:
        if m.is_watertight:
            trimesh.repair.fix_normals(m)
            if m.volume < 0:
                m.invert()
    except Exception:
        pass
    return m


def inside(mesh, pts, chunk=400):
    """Generalized winding number > 0.5 (numpy only; no rtree). Robust for
    closed meshes; approximate for open ones."""
    V = np.asarray(mesh.vertices, float)
    T = V[np.asarray(mesh.faces, int)]
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    out = np.zeros(len(pts), bool)
    for s in range(0, len(pts), chunk):
        P = np.asarray(pts[s:s + chunk], float)[:, None, :]
        A, B, C = a[None] - P, b[None] - P, c[None] - P
        la, lb, lc = (np.linalg.norm(X, axis=2) for X in (A, B, C))
        det = np.einsum("pmi,pmi->pm", A, np.cross(B, C))
        den = la * lb * lc + np.einsum("pmi,pmi->pm", A, B) * lc             + np.einsum("pmi,pmi->pm", B, C) * la + np.einsum("pmi,pmi->pm", C, A) * lb
        omega = 2 * np.arctan2(det, den)
        w = omega.sum(axis=1) / (4 * np.pi)
        out[s:s + chunk] = np.abs(w) > 0.5
    return out


# ---------------------------------------------------------------- booleans
def bool_op(op, A, B):
    """A, B: trimesh.Trimesh in one frame. Triangle-level classification."""
    if not B.is_watertight:
        warn("boolean cutter not watertight: cut skipped")
        approx("boolean-cutter-not-watertight-skipped")
        return A if op != "intersect" else A.copy()
    approx("boolean-triangle-classification (not exact CSG)")
    inB = inside(B, A.triangles_center)
    if op == "intersect":
        Ak = A.faces[inB]
        Bk = np.zeros((0, 3), int)
        return _combine(A, Ak, None, Bk)
    if op == "union":
        Ak = A.faces[~inB]
        inA = inside(A, B.triangles_center) if A.is_watertight else np.zeros(len(B.faces), bool)
        Bk = B.faces[~inA]
        return _combine(A, Ak, B, Bk)
    # subtract: keep A outside B, plus B's faces inside A as the cavity walls
    Ak = A.faces[~inB]
    inA = inside(A, B.triangles_center) if A.is_watertight else np.zeros(len(B.faces), bool)
    Bk = B.faces[inA][:, ::-1]
    return _combine(A, Ak, B, Bk)


def _combine(A, Af, B, Bf):
    Vs, Fs, n = [np.asarray(A.vertices)], [Af], len(A.vertices)
    if B is not None and len(Bf):
        Vs.append(np.asarray(B.vertices))
        Fs.append(Bf + n)
    return trimesh.Trimesh(np.vstack(Vs), np.vstack([f.reshape(-1, 3) for f in Fs]), process=True)


# ---------------------------------------------------------------- the evaluator
class FileEval:
    def __init__(self, path, stack=()):
        self.path = os.path.abspath(path)
        if self.path in stack:
            raise RuntimeError(f"import cycle: {self.path}")
        self.stack = tuple(stack) + (self.path,)
        with open(self.path, encoding="utf-8") as fh:
            self.doc = json.load(fh)
        self.objs = self.doc.get("objects", [])
        self.by = {o["id"]: o for o in self.objs}
        self._world = {}
        self._geom = {}

    def world(self, oid, _depth=0):
        if oid in self._world:
            return self._world[oid]
        o = self.by[oid]
        M = local_matrix(o)
        pid = o.get("parent")
        if pid:
            if pid not in self.by:
                warn(f"{oid}: parent {pid} missing")
            else:
                M = self.world(pid) @ M
        self._world[oid] = M
        return M

    def visible(self, oid):
        o = self.by[oid]
        if not o.get("visible", True):
            return False
        pid = o.get("parent")
        return self.visible(pid) if pid and pid in self.by else True

    def geom(self, oid):
        """Triangles of object oid in this file's frame (world), or None."""
        if oid in self._geom:
            return self._geom[oid]
        o = self.by[oid]
        kind = o.get("kind")
        p = o.get("params", {}) or {}
        M = self.world(oid)
        result = None
        if kind == "box":
            V, F = box_geom(p.get("width", 1), p.get("height", 1), p.get("depth", 1), p.get("bevel", 0))
            result = (apply(M, V), F)
        elif kind in ("sphere", "icosphere"):
            V, F = sphere_geom(p.get("radius", 0.5))
            result = (apply(M, V), F)
        elif kind == "cylinder":
            V, F = frustum_geom(p.get("radius", 0.5), p.get("radiusTop", p.get("radius", 0.5)),
                                p.get("height", 1), p.get("segments", 16))
            result = (apply(M, V), F)
        elif kind == "cone":
            r = p.get("radius", 0.5)
            V, F = frustum_geom(p.get("radiusTop", 0.0), r, p.get("height", 1), p.get("segments", 16))
            result = (apply(M, V), F)
        elif kind == "torus":
            V, F = torus_geom(p.get("radius", 0.5), p.get("tube", 0.1), p.get("segments", 32))
            result = (apply(M, V), F)
        elif kind == "capsule":
            V, F = capsule_geom(p.get("radius", 0.5), p.get("height", 1.0))
            result = (apply(M, V), F)
        elif kind == "plane":
            V, F = plane_geom(p.get("width", 1), p.get("depth", p.get("height", 1)))
            result = (apply(M, V), F)
        elif kind == "surface":
            result = self._surface(oid, o)
        elif kind == "boolean":
            b = o.get("boolean", {})
            A = self._mesh(b.get("a"))
            B = self._mesh(b.get("b"))
            if A is None:
                warn(f"{oid}: boolean operand a missing")
            else:
                if B is None:
                    warn(f"{oid}: boolean cutter b missing")
                    res = A
                else:
                    res = bool_op(b.get("op", "subtract"), A, B)
                result = (np.asarray(res.vertices), np.asarray(res.faces))
        elif kind in ("curve", "empty", "import"):
            result = None
        else:
            warn(f"{oid}: kind {kind!r} not evaluated")
            result = None
        if result is not None and len(result[1]):
            result = clean(*result)
        if kind in ("box", "sphere", "icosphere", "cylinder", "cone", "torus", "capsule", "plane", "surface") \
                and result is not None and p.get("smooth"):
            result = clean(*smooth_mesh(result[0], result[1], p.get("smooth")))
        if result is not None and kind in ("box", "sphere", "icosphere", "cylinder", "cone", "torus",
                                           "capsule", "plane", "surface", "boolean") and o.get("keys"):
            approx("keyframes-ignored (rest pose)")
        self._geom[oid] = result
        return result

    def _mesh(self, oid):
        if oid is None or oid not in self.by:
            return None
        g = self.geom(oid)
        if g is None:
            return None
        return orient_closed(trimesh.Trimesh(g[0], g[1], process=True))

    def _curve_in(self, cid, inv_surface):
        c = self.by.get(cid)
        if c is None or c.get("kind") != "curve":
            raise RuntimeError(f"surface refers to missing curve {cid}")
        P, closed = curve_points(c["curve"])
        Wc = self.world(cid)
        Pw = apply(Wc, P)
        return apply(inv_surface, Pw), closed

    def _surface(self, oid, o):
        s = o.get("surface", {})
        op = s.get("op")
        Ws = self.world(oid)
        inv = np.linalg.inv(Ws)
        curves = [self._curve_in(cid, inv) for cid in s.get("curves", [])]
        cap = bool(s.get("cap", False))
        if not curves:
            warn(f"{oid}: surface has no curves")
            return None
        if op == "loft":
            V, F = loft(curves, cap)
        elif op == "extrude":
            P, closed = curves[0]
            d = np.asarray(s.get("direction", [0, 1, 0]), float)
            V, F = extrude(dedupe(P, closed) if closed else P, closed, d, cap)
        elif op == "revolve":
            P, closed = curves[0]
            V, F = revolve(P, closed, s.get("axis", [0, 1, 0]), np.asarray(s.get("axisPoint", [0, 0, 0]), float),
                           float(s.get("angle", 360)), cap)
        elif op == "pipe":
            P, closed = curves[0]
            V, F = pipe(P, closed, float(s.get("radius", 0.05)), cap)
        else:
            warn(f"{oid}: surface op {op!r} not evaluated")
            return None
        return apply(Ws, V), F

    # ------------------------------------------------------------ output nodes
    def nodes(self, depth=0):
        """Visible final nodes in this file's frame: list of dicts."""
        out = []
        for o in self.objs:
            oid = o["id"]
            if not self.visible(oid):
                continue
            kind = o.get("kind")
            if kind == "import":
                out += self._import_nodes(o, depth)
                continue
            g = self.geom(oid) if kind not in ("curve", "empty") else None
            if g is None:
                continue
            copies = [(oid, g)]
            arr = o.get("array")
            if arr:
                approx("array-copies")
                copies = []
                off = np.asarray(arr.get("offset", [0, 0, 0]), float)
                for k in range(int(arr.get("count", 1))):
                    Vk = g[0] + k * off
                    copies.append((f"{oid}#{k}", (Vk, g[1])))
            for name, (V, F) in copies:
                out.append(self._node(name, o, V, F))
        return out

    def _node(self, name, o, V, F):
        mat = o.get("material", {}) or {}
        return {
            "name": name, "id": o["id"], "label": o.get("name", ""), "kind": o.get("kind"),
            "source": self.path, "vertices": np.asarray(V, float), "faces": np.asarray(F, int),
            "color": hex_rgba(mat.get("color"), mat.get("opacity", 1.0)),
            "mass": o.get("mass"), "cg": o.get("cg"),
        }

    def _import_nodes(self, o, depth):
        src = o.get("src", "")
        M = self.world(o["id"])
        oid = o["id"]
        if src.lower().endswith(".model.json"):
            child = FileEval(src, self.stack)
            nodes = child.nodes(depth + 1)
            for nd in nodes:
                nd["name"] = f"{oid}/{nd['name']}"
                nd["vertices"] = apply(M, nd["vertices"])
                nd["source"] = child.path
            return nodes
        if src.lower().endswith((".glb", ".gltf", ".obj", ".stl")):
            approx("import-mesh-flattened")
            m = trimesh.load(src, force="mesh")
            return [self._node(oid, o, apply(M, m.vertices), m.faces)]
        warn(f"{oid}: import src {src!r} not supported")
        return []


def evaluate(path):
    APPROX.clear()
    WARN.clear()
    fe = FileEval(path)
    nodes = fe.nodes()
    for nd in nodes:
        m = trimesh.Trimesh(nd["vertices"], nd["faces"], process=True)
        nd["trimesh"] = orient_closed(m)
    return nodes


def summary(nodes):
    rows = []
    for nd in nodes:
        m = nd["trimesh"]
        rows.append({
            "name": nd["name"], "kind": nd["kind"], "tris": int(len(m.faces)),
            "watertight": bool(m.is_watertight),
            "volume_m3": round(float(m.volume), 6) if m.is_watertight else None,
            "bounds": [[round(float(x), 4) for x in b] for b in m.bounds] if len(m.faces) else None,
            "mass": nd["mass"],
        })
    return {"nodes": rows, "approximations": sorted(APPROX), "warnings": list(WARN)}


def to_scene(nodes):
    scene = trimesh.Scene()
    for nd in nodes:
        m = nd["trimesh"].copy()
        m.visual.face_colors = np.tile(np.array(nd["color"], np.uint8), (len(m.faces), 1))
        scene.add_geometry(m, node_name=nd["name"], geom_name=nd["name"])
    return scene


def main(argv):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("model")
    ap.add_argument("--glb")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    nodes = evaluate(a.model)
    s = summary(nodes)
    if a.glb:
        to_scene(nodes).export(a.glb)
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(s, fh, indent=1)
    print(f"nodes: {len(nodes)}  tris: {sum(r['tris'] for r in s['nodes'])}")
    print("approximations:", s["approximations"])
    print("warnings:", s["warnings"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
