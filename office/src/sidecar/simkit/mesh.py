"""Triangle meshes with numpy: primitives, loading (.glb .stl .obj), and the
measurements engineering needs (volume, centroid, surface area, bounds).

Every function returns (vertices, faces): float (n, 3) and int (m, 3), in
metres, Y up, faces wound counter-clockwise seen from outside.
"""

from __future__ import annotations

import struct

import numpy as np


# ── primitives ────────────────────────────────────────────────────────────

def box(size=(1.0, 1.0, 1.0), center=(0.0, 0.0, 0.0)):
    sx, sy, sz = (s / 2 for s in size)
    v = np.array([[x, y, z] for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)], dtype=float)
    f = np.array([
        [0, 1, 3], [0, 3, 2], [4, 6, 7], [4, 7, 5], [0, 4, 5], [0, 5, 1],
        [2, 3, 7], [2, 7, 6], [0, 2, 6], [0, 6, 4], [1, 5, 7], [1, 7, 3],
    ])
    return v + np.asarray(center, dtype=float), f


def uv_sphere(radius=0.5, rings=16, segments=32, center=(0.0, 0.0, 0.0)):
    v = [[0, radius, 0]]
    for i in range(1, rings):
        phi = np.pi * i / rings
        for j in range(segments):
            th = 2 * np.pi * j / segments
            v.append([radius * np.sin(phi) * np.cos(th), radius * np.cos(phi), radius * np.sin(phi) * np.sin(th)])
    v.append([0, -radius, 0])
    f = []
    for j in range(segments):
        f.append([0, 1 + (j + 1) % segments, 1 + j])
    for i in range(rings - 2):
        a0, b0 = 1 + i * segments, 1 + (i + 1) * segments
        for j in range(segments):
            j1 = (j + 1) % segments
            f += [[a0 + j, a0 + j1, b0 + j], [a0 + j1, b0 + j1, b0 + j]]
    last = len(v) - 1
    base = 1 + (rings - 2) * segments
    for j in range(segments):
        f.append([last, base + j, base + (j + 1) % segments])
    return np.array(v, dtype=float) + np.asarray(center, dtype=float), np.array(f)


def cylinder(radius=0.5, height=1.0, segments=32, center=(0.0, 0.0, 0.0), axis="y"):
    th = np.linspace(0, 2 * np.pi, segments, endpoint=False)
    ring = np.stack([radius * np.cos(th), np.zeros_like(th), radius * np.sin(th)], axis=1)
    bottom = ring + [0, -height / 2, 0]
    top = ring + [0, height / 2, 0]
    v = np.vstack([bottom, top, [[0, -height / 2, 0], [0, height / 2, 0]]])
    cb, ct = 2 * segments, 2 * segments + 1
    f = []
    for j in range(segments):
        j1 = (j + 1) % segments
        f += [[j, segments + j, j1], [j1, segments + j, segments + j1],
              [cb, j, j1], [ct, segments + j1, segments + j]]
    v = _axis(v, axis)
    return v + np.asarray(center, dtype=float), np.array(f)


def grid(size_x=1.0, size_z=1.0, nx=20, nz=20, center=(0.0, 0.0, 0.0)):
    """A flat sheet in the XZ plane (facing up): water, a floor, cloth."""
    xs = np.linspace(-size_x / 2, size_x / 2, nx + 1)
    zs = np.linspace(-size_z / 2, size_z / 2, nz + 1)
    X, Z = np.meshgrid(xs, zs, indexing="ij")
    v = np.stack([X.ravel(), np.zeros(X.size), Z.ravel()], axis=1)
    f = []
    for i in range(nx):
        for k in range(nz):
            a = i * (nz + 1) + k
            b = (i + 1) * (nz + 1) + k
            f += [[a, a + 1, b], [b, a + 1, b + 1]]
    return v + np.asarray(center, dtype=float), np.array(f)


def _axis(v, axis):
    if axis == "x":
        return v[:, [1, 0, 2]] * [1, 1, 1]
    if axis == "z":
        return v[:, [0, 2, 1]]
    return v


def loft(sections, closed_ends=True):
    """Skin a solid through closed cross-sections (each an (n, 3) ring with
    the same n, in order). Hulls, fuselages, floats: define stations along
    the length and loft them."""
    rings = [np.asarray(s, dtype=float) for s in sections]
    n = len(rings[0])
    v = np.vstack(rings)
    f = []
    for i in range(len(rings) - 1):
        a, b = i * n, (i + 1) * n
        for j in range(n):
            j1 = (j + 1) % n
            f += [[a + j, b + j, a + j1], [a + j1, b + j, b + j1]]
    if closed_ends:
        c0 = len(v)
        c1 = c0 + 1
        v = np.vstack([v, rings[0].mean(axis=0), rings[-1].mean(axis=0)])
        last = (len(rings) - 1) * n
        for j in range(n):
            j1 = (j + 1) % n
            f += [[c0, j1, j], [c1, last + j, last + j1]]
    v, f = v, np.array(f)
    if signed_volume(v, f) < 0:
        f = f[:, ::-1]
    return v, f


def merge(*meshes):
    vs, fs, off = [], [], 0
    for v, f in meshes:
        vs.append(np.asarray(v, dtype=float))
        fs.append(np.asarray(f) + off)
        off += len(v)
    return np.vstack(vs), np.vstack(fs)


def transform(v, translate=(0, 0, 0), rotate_deg=(0, 0, 0), scale=1.0, about=(0, 0, 0)):
    """Scale, then rotate about X, Y, Z (degrees, in that order), then move."""
    v = (np.asarray(v, dtype=float) - about) * scale
    rx, ry, rz = np.radians(rotate_deg)
    Rx = np.array([[1, 0, 0], [0, np.cos(rx), -np.sin(rx)], [0, np.sin(rx), np.cos(rx)]])
    Ry = np.array([[np.cos(ry), 0, np.sin(ry)], [0, 1, 0], [-np.sin(ry), 0, np.cos(ry)]])
    Rz = np.array([[np.cos(rz), -np.sin(rz), 0], [np.sin(rz), np.cos(rz), 0], [0, 0, 1]])
    return v @ (Rz @ Ry @ Rx).T + about + np.asarray(translate, dtype=float)


# ── measurements ──────────────────────────────────────────────────────────

def signed_volume(v, f):
    v = np.asarray(v, dtype=float)
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def volume_centroid(v, f):
    """Volume and centre of volume of a closed mesh."""
    v = np.asarray(v, dtype=float)
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    vol = np.einsum("ij,ij->i", a, np.cross(b, c)) / 6.0
    total = vol.sum()
    if abs(total) < 1e-15:
        return 0.0, v.mean(axis=0)
    centroid = ((a + b + c) / 4.0 * vol[:, None]).sum(axis=0) / total
    return float(abs(total)), centroid


def surface_area(v, f):
    v = np.asarray(v, dtype=float)
    return float(np.linalg.norm(np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]]), axis=1).sum() / 2)


def bounds(v):
    v = np.asarray(v, dtype=float)
    return v.min(axis=0), v.max(axis=0)


def is_watertight(f):
    """Every edge shared by exactly two faces (needed for volumes, hulls)."""
    e = np.sort(np.vstack([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]]), axis=1)
    _, counts = np.unique(e, axis=0, return_counts=True)
    return bool(np.all(counts == 2))


def weld(v, f, tol=1e-6):
    """Merge duplicate vertices (STL files repeat them for every face)."""
    keys = np.round(np.asarray(v) / tol).astype(np.int64)
    _, index, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    f2 = inverse.reshape(-1)[np.asarray(f)]
    keep = (f2[:, 0] != f2[:, 1]) & (f2[:, 1] != f2[:, 2]) & (f2[:, 0] != f2[:, 2])
    return np.asarray(v)[index], f2[keep]


# ── loading ───────────────────────────────────────────────────────────────

def load(path):
    """A mesh from .glb, .stl (binary or text) or .obj, welded."""
    lower = path.lower()
    if lower.endswith(".glb"):
        from .glb import read_glb_mesh
        v, f = read_glb_mesh(path)
    elif lower.endswith(".stl"):
        v, f = _load_stl(path)
    elif lower.endswith(".obj"):
        v, f = _load_obj(path)
    else:
        raise ValueError("load a .glb, .stl or .obj")
    return weld(v, f)


def _load_stl(path):
    with open(path, "rb") as fh:
        data = fh.read()
    if len(data) >= 84:
        n = struct.unpack_from("<I", data, 80)[0]
        if 84 + n * 50 == len(data):
            rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]),
                                count=n, offset=84)
            v = rec["v"].reshape(-1, 3).astype(float)
            return v, np.arange(len(v)).reshape(-1, 3)
    pts = [list(map(float, line.split()[1:4])) for line in data.decode("utf-8", "ignore").splitlines()
           if line.strip().startswith("vertex")]
    v = np.array(pts, dtype=float)
    return v, np.arange(len(v)).reshape(-1, 3)


def _load_obj(path):
    vs, fs = [], []
    with open(path, encoding="utf-8", errors="ignore") as fh:
        for line in fh:
            parts = line.split()
            if not parts:
                continue
            if parts[0] == "v":
                vs.append([float(x) for x in parts[1:4]])
            elif parts[0] == "f":
                idx = [int(p.split("/")[0]) for p in parts[1:]]
                idx = [i - 1 if i > 0 else len(vs) + i for i in idx]
                for k in range(1, len(idx) - 1):
                    fs.append([idx[0], idx[k], idx[k + 1]])
    return np.array(vs, dtype=float), np.array(fs)


def save_stl(path, v, f):
    """Binary STL (for 3D printing or CAD)."""
    v = np.asarray(v, dtype=np.float32)
    tri = v[np.asarray(f)]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)
    rec = np.zeros(len(tri), dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
    rec["n"], rec["v"] = n, tri
    with open(path, "wb") as fh:
        fh.write(b"simkit".ljust(80, b" "))
        fh.write(struct.pack("<I", len(tri)))
        fh.write(rec.tobytes())
    return path
