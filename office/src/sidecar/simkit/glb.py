"""Write binary glTF (.glb) files with numpy only: meshes with colours and
materials, a node tree, and animations (moving parts and shape keys).

The app's 3D viewer plays a .glb's animations, so a simulation can be
published as one file the owner can turn, zoom and watch:

    from simkit.glb import Scene
    scene = Scene()
    hull = scene.mesh("hull", vertices, faces, color=(0.9, 0.9, 0.95))
    boat = scene.node("boat", mesh=hull)
    scene.animate(boat, times, translation=xyz_per_time, rotation=quat_per_time)
    scene.save("boat.glb")

Units are metres, Y is up. Quaternions are (x, y, z, w).
"""

from __future__ import annotations

import json
import struct

import numpy as np

_FLOAT = 5126
_UINT = 5125
_ARRAY_BUFFER = 34962
_ELEMENT_ARRAY_BUFFER = 34963


def vertex_normals(vertices: np.ndarray, faces: np.ndarray) -> np.ndarray:
    """Smooth per-vertex normals (area weighted)."""
    v = np.asarray(vertices, dtype=np.float64)
    f = np.asarray(faces, dtype=np.int64)
    n = np.zeros_like(v)
    fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
    for k in range(3):
        np.add.at(n, f[:, k], fn)
    length = np.linalg.norm(n, axis=1, keepdims=True)
    length[length == 0] = 1.0
    return n / length


class Scene:
    """A glTF scene being built. Add meshes and nodes, animate, then save."""

    def __init__(self) -> None:
        self._bin = bytearray()
        self.gltf: dict = {
            "asset": {"version": "2.0", "generator": "simkit"},
            "scene": 0,
            "scenes": [{"nodes": []}],
            "nodes": [],
            "meshes": [],
            "materials": [],
            "accessors": [],
            "bufferViews": [],
            "buffers": [],
        }
        self._animations: list[dict] = []

    # ── buffers ──────────────────────────────────────────────────────────
    def _view(self, data: bytes, target: int | None = None) -> int:
        while len(self._bin) % 4:
            self._bin.append(0)
        view = {"buffer": 0, "byteOffset": len(self._bin), "byteLength": len(data)}
        if target:
            view["target"] = target
        self._bin.extend(data)
        self.gltf["bufferViews"].append(view)
        return len(self.gltf["bufferViews"]) - 1

    def _accessor(self, array: np.ndarray, kind: str, target: int | None = None,
                  bounds: bool = False) -> int:
        if kind == "SCALAR" and array.dtype.kind in "iu":
            data = np.ascontiguousarray(array, dtype=np.uint32)
            comp = _UINT
        else:
            data = np.ascontiguousarray(array, dtype=np.float32)
            comp = _FLOAT
        acc = {
            "bufferView": self._view(data.tobytes(), target),
            "componentType": comp,
            "count": int(data.shape[0]),
            "type": kind,
        }
        if bounds:
            flat = data.reshape(data.shape[0], -1)
            acc["min"] = [float(x) for x in flat.min(axis=0)]
            acc["max"] = [float(x) for x in flat.max(axis=0)]
        self.gltf["accessors"].append(acc)
        return len(self.gltf["accessors"]) - 1

    # ── content ──────────────────────────────────────────────────────────
    def material(self, color=(0.8, 0.8, 0.8), alpha: float = 1.0, metallic: float = 0.0,
                 roughness: float = 0.6, double_sided: bool = False, name: str = "") -> int:
        mat = {
            "name": name or f"material{len(self.gltf['materials'])}",
            "pbrMetallicRoughness": {
                "baseColorFactor": [float(color[0]), float(color[1]), float(color[2]), float(alpha)],
                "metallicFactor": float(metallic),
                "roughnessFactor": float(roughness),
            },
            "doubleSided": bool(double_sided),
        }
        if alpha < 1.0:
            mat["alphaMode"] = "BLEND"
        self.gltf["materials"].append(mat)
        return len(self.gltf["materials"]) - 1

    def mesh(self, name: str, vertices, faces, color=(0.8, 0.8, 0.8), alpha: float = 1.0,
             metallic: float = 0.0, roughness: float = 0.6, double_sided: bool = False,
             vertex_colors=None, morph_targets=None) -> int:
        """A triangle mesh. `morph_targets` is a list of vertex arrays (whole
        shapes, same size as `vertices`) for shape-key animation."""
        v = np.asarray(vertices, dtype=np.float64)
        f = np.asarray(faces, dtype=np.int64).reshape(-1, 3)
        attrs = {
            "POSITION": self._accessor(v, "VEC3", _ARRAY_BUFFER, bounds=True),
            "NORMAL": self._accessor(vertex_normals(v, f), "VEC3", _ARRAY_BUFFER),
        }
        if vertex_colors is not None:
            c = np.asarray(vertex_colors, dtype=np.float64)
            if c.shape[1] == 3:
                c = np.hstack([c, np.ones((len(c), 1))])
            attrs["COLOR_0"] = self._accessor(c, "VEC4", _ARRAY_BUFFER)
        prim = {
            "attributes": attrs,
            "indices": self._accessor(f.reshape(-1), "SCALAR", _ELEMENT_ARRAY_BUFFER),
            "material": self.material(color, alpha, metallic, roughness, double_sided, name),
            "mode": 4,
        }
        mesh: dict = {"name": name, "primitives": [prim]}
        if morph_targets:
            base_n = vertex_normals(v, f)
            targets = []
            for shape in morph_targets:
                s = np.asarray(shape, dtype=np.float64)
                targets.append({
                    "POSITION": self._accessor(s - v, "VEC3", _ARRAY_BUFFER, bounds=True),
                    "NORMAL": self._accessor(vertex_normals(s, f) - base_n, "VEC3", _ARRAY_BUFFER),
                })
            prim["targets"] = targets
            mesh["weights"] = [0.0] * len(targets)
        self.gltf["meshes"].append(mesh)
        return len(self.gltf["meshes"]) - 1

    def node(self, name: str, mesh: int | None = None, translation=None, rotation=None,
             scale=None, parent: int | None = None) -> int:
        node: dict = {"name": name}
        if mesh is not None:
            node["mesh"] = mesh
        if translation is not None:
            node["translation"] = [float(x) for x in translation]
        if rotation is not None:
            node["rotation"] = [float(x) for x in rotation]
        if scale is not None:
            node["scale"] = [float(x) for x in scale]
        self.gltf["nodes"].append(node)
        index = len(self.gltf["nodes"]) - 1
        if parent is None:
            self.gltf["scenes"][0]["nodes"].append(index)
        else:
            self.gltf["nodes"][parent].setdefault("children", []).append(index)
        return index

    def animate(self, node: int, times, translation=None, rotation=None, scale=None,
                name: str = "simulation") -> None:
        """Keyframes for a node (one row per time). All channels share a clip."""
        t = np.asarray(times, dtype=np.float64)
        anim = self._clip(name)
        for path, values, kind in (("translation", translation, "VEC3"),
                                   ("rotation", rotation, "VEC4"),
                                   ("scale", scale, "VEC3")):
            if values is None:
                continue
            vals = np.asarray(values, dtype=np.float64)
            if path == "rotation":
                vals = vals / np.linalg.norm(vals, axis=1, keepdims=True)
            self._channel(anim, node, path, t, vals, kind)

    def animate_shapes(self, node: int, times, weights, name: str = "simulation") -> None:
        """Shape-key weights over time: `weights[i]` has one weight per morph
        target of the node's mesh (see `keyframe_weights`)."""
        t = np.asarray(times, dtype=np.float64)
        w = np.asarray(weights, dtype=np.float64)
        self._channel(self._clip(name), node, "weights", t, w.reshape(-1), "SCALAR")

    def _clip(self, name: str) -> dict:
        for anim in self._animations:
            if anim["name"] == name:
                return anim
        anim = {"name": name, "channels": [], "samplers": []}
        self._animations.append(anim)
        return anim

    def _channel(self, anim: dict, node: int, path: str, t: np.ndarray, vals: np.ndarray,
                 kind: str) -> None:
        sampler = {
            "input": self._accessor(t, "SCALAR", bounds=True),
            "output": self._accessor(vals.reshape(len(vals), -1) if kind != "SCALAR" else vals.reshape(-1, 1)[:, 0], kind),
            "interpolation": "LINEAR",
        }
        if kind == "SCALAR":
            # weights are stored flat (frames × targets), as SCALAR
            self.gltf["accessors"][sampler["output"]]["type"] = "SCALAR"
        anim["samplers"].append(sampler)
        anim["channels"].append({"sampler": len(anim["samplers"]) - 1,
                                 "target": {"node": node, "path": path}})

    # ── output ───────────────────────────────────────────────────────────
    def save(self, path: str) -> str:
        gltf = dict(self.gltf)
        if self._animations:
            gltf["animations"] = self._animations
        while len(self._bin) % 4:
            self._bin.append(0)
        gltf["buffers"] = [{"byteLength": len(self._bin)}]
        for key in ("meshes", "materials", "accessors", "bufferViews"):
            if not gltf[key]:
                del gltf[key]
        text = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
        text += b" " * ((4 - len(text) % 4) % 4)
        body = bytes(self._bin)
        total = 12 + 8 + len(text) + 8 + len(body)
        with open(path, "wb") as out:
            out.write(struct.pack("<III", 0x46546C67, 2, total))
            out.write(struct.pack("<II", len(text), 0x4E4F534A))
            out.write(text)
            out.write(struct.pack("<II", len(body), 0x004E4942))
            out.write(body)
        return path


def keyframe_weights(n_targets: int) -> np.ndarray:
    """Weights that show morph target 0, then 1, … one per keyframe: frame i
    has weight 1 on target i (frame 0 can be the base shape: pass n+1 times
    and prepend a zero row yourself)."""
    return np.eye(n_targets)


def quat_from_euler(roll: np.ndarray, pitch: np.ndarray, yaw: np.ndarray) -> np.ndarray:
    """Quaternions (x, y, z, w) for rotations about X (roll), Z (pitch) and Y
    (yaw), in radians, applied yaw → pitch → roll. Arrays of equal length."""
    roll, pitch, yaw = (np.asarray(a, dtype=np.float64) for a in (roll, pitch, yaw))

    def q(axis: int, angle: np.ndarray) -> np.ndarray:
        out = np.zeros((angle.size, 4))
        out[:, axis] = np.sin(angle / 2)
        out[:, 3] = np.cos(angle / 2)
        return out

    def mul(a: np.ndarray, b: np.ndarray) -> np.ndarray:
        x1, y1, z1, w1 = a.T
        x2, y2, z2, w2 = b.T
        return np.stack([
            w1 * x2 + x1 * w2 + y1 * z2 - z1 * y2,
            w1 * y2 - x1 * z2 + y1 * w2 + z1 * x2,
            w1 * z2 + x1 * y2 - y1 * x2 + z1 * w2,
            w1 * w2 - x1 * x2 - y1 * y2 - z1 * z2,
        ], axis=1)

    return mul(mul(q(1, yaw.ravel()), q(2, pitch.ravel())), q(0, roll.ravel()))


def read_glb_mesh(path: str) -> tuple[np.ndarray, np.ndarray]:
    """All triangles of a .glb as one mesh (vertices, faces), node transforms
    applied. Enough to load a hull or a body made elsewhere."""
    with open(path, "rb") as f:
        data = f.read()
    magic, _, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        raise ValueError("not a .glb file")
    jlen, _ = struct.unpack_from("<II", data, 12)
    gltf = json.loads(data[20:20 + jlen])
    bin_start = 20 + jlen + 8
    binary = data[bin_start:]

    def read(acc_index: int) -> np.ndarray:
        acc = gltf["accessors"][acc_index]
        view = gltf["bufferViews"][acc["bufferView"]]
        dtype = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}[acc["componentType"]]
        width = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[acc["type"]]
        start = view.get("byteOffset", 0) + acc.get("byteOffset", 0)
        stride = view.get("byteStride")
        item = np.dtype(dtype).itemsize * width
        if stride and stride != item:
            rows = [np.frombuffer(binary, dtype, width, start + i * stride) for i in range(acc["count"])]
            return np.array(rows)
        return np.frombuffer(binary, dtype, acc["count"] * width, start).reshape(acc["count"], width)

    def matrix(node: dict) -> np.ndarray:
        if "matrix" in node:
            return np.array(node["matrix"], dtype=np.float64).reshape(4, 4).T
        m = np.eye(4)
        x, y, z, w = node.get("rotation", [0, 0, 0, 1])
        r = np.array([
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ])
        m[:3, :3] = r * np.array(node.get("scale", [1, 1, 1]))
        m[:3, 3] = node.get("translation", [0, 0, 0])
        return m

    verts: list[np.ndarray] = []
    faces: list[np.ndarray] = []
    offset = 0

    def walk(index: int, parent: np.ndarray) -> None:
        nonlocal offset
        node = gltf["nodes"][index]
        m = parent @ matrix(node)
        if "mesh" in node:
            for prim in gltf["meshes"][node["mesh"]]["primitives"]:
                if prim.get("mode", 4) != 4:
                    continue
                v = read(prim["attributes"]["POSITION"]).astype(np.float64)
                v = (np.hstack([v, np.ones((len(v), 1))]) @ m.T)[:, :3]
                if "indices" in prim:
                    f = read(prim["indices"]).astype(np.int64).reshape(-1, 3)
                else:
                    f = np.arange(len(v)).reshape(-1, 3)
                verts.append(v)
                faces.append(f + offset)
                offset += len(v)
        for child in node.get("children", []):
            walk(child, m)

    scene = gltf.get("scenes", [{"nodes": list(range(len(gltf["nodes"])))}])[gltf.get("scene", 0)]
    for root in scene["nodes"]:
        walk(root, np.eye(4))
    if not verts:
        raise ValueError("no triangles in that .glb")
    return np.vstack(verts), np.vstack(faces)
