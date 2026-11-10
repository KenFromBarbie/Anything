"""Clothing: sewing patterns, a body from measurements, and draping.

    from simkit import cloth
    body = cloth.Body(height=172, chest=96, waist=80, hip=100)     # cm
    shirt = cloth.tshirt(body, ease=10, length=70, sleeve=22)
    shirt.save_svg("tshirt_pattern.svg")          # printable 1:1, seam allowance, grain
    result = cloth.drape(body, shirt, fabric="cotton")
    result.save_glb("tshirt_drape.glb")           # animated drape + fit colours
    result.fit                                    # where it's tight or loose

Patterns are flat pieces in centimetres. Draping builds the sewn garment as
cloth (tubes for body, skirt and sleeves), hangs it on the body and lets
gravity, the fabric's stretch and bending, and collisions with the body settle
it (position-based dynamics). The fit map colours the cloth by strain: red
where it's pulled tight, blue where it hangs loose. It's a design tool, not a
production cloth solver: seams are approximated (the body tube and sleeves
are separate tubes, the top of each is held where its seam would sit).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FABRICS = {
    #            stretch  bend   friction  weight g/m²
    "cotton":  dict(stretch=0.95, bend=0.30, friction=0.5, weight=150),
    "jersey":  dict(stretch=0.55, bend=0.08, friction=0.5, weight=180),
    "silk":    dict(stretch=0.90, bend=0.02, friction=0.2, weight=60),
    "denim":   dict(stretch=1.00, bend=0.85, friction=0.6, weight=380),
    "wool":    dict(stretch=0.85, bend=0.50, friction=0.6, weight=280),
    "linen":   dict(stretch=0.98, bend=0.45, friction=0.5, weight=170),
    "chiffon": dict(stretch=0.85, bend=0.01, friction=0.25, weight=40),
}


def _ellipse_axes(circumference: float, ratio: float) -> tuple[float, float]:
    """Half-axes (a, b = ratio·a) of an ellipse with this circumference."""
    def circ(a):
        b = ratio * a
        h = ((a - b) / (a + b)) ** 2
        return np.pi * (a + b) * (1 + 3 * h / (10 + np.sqrt(4 - 3 * h)))
    lo, hi = 0.0, circumference
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if circ(mid) < circumference else (lo, mid)
    a = (lo + hi) / 2
    return a, ratio * a


@dataclass
class Body:
    """A body from measurements (cm). Y up, X across (left/right), Z front.
    Proportions follow common sizing charts; give what you know."""
    height: float = 170.0
    chest: float = 94.0       # bust
    waist: float = 78.0
    hip: float = 98.0
    shoulder: float | None = None   # shoulder width, point to point
    arm: float | None = None        # shoulder to wrist
    bicep: float = 30.0
    thigh: float = 56.0
    neck: float = 38.0

    def __post_init__(self):
        h = self.height
        self.shoulder = self.shoulder or 0.245 * h
        self.arm = self.arm or 0.34 * h
        self.y = dict(crotch=0.47 * h, hip=0.52 * h, waist=0.615 * h, chest=0.72 * h,
                      shoulder=0.815 * h, neck=0.845 * h, top=h)
        # the torso's cross-sections, tabulated for fast collisions
        self._ty = np.linspace(self.y["crotch"], self.y["neck"], 240)
        ab = np.array([self.torso_section(v) for v in self._ty])
        self._ta, self._tb = ab[:, 0], ab[:, 1]

    def torso_section(self, y: float) -> tuple[float, float]:
        """Half-width and half-depth of the torso at height y."""
        h = self.y
        levels = [h["crotch"], h["hip"], h["waist"], h["chest"], h["shoulder"], h["neck"]]
        circs = [self.hip * 0.93, self.hip, self.waist, self.chest, self.chest * 0.92, self.neck]
        ratios = [0.70, 0.68, 0.72, 0.66, 0.55, 0.95]
        c = float(np.interp(y, levels, circs))
        r = float(np.interp(y, levels, ratios))
        a, b = _ellipse_axes(c, r)
        if y > h["chest"]:      # shoulders are wider than the chest ellipse
            t = (y - h["chest"]) / (h["shoulder"] - h["chest"])
            if y <= h["shoulder"]:
                a = max(a, a + (self.shoulder / 2 - a) * min(t, 1.0) * 0.9)
        return a, b

    def arms(self):
        """Capsules (start, end, radius) for both arms, slightly away from the
        body (A-pose, 25° from vertical)."""
        r = self.bicep / (2 * np.pi)
        out = []
        for side in (1, -1):
            start = np.array([side * (self.shoulder / 2 - r * 0.6), self.y["shoulder"] - r * 0.8, 0.0])
            ang = np.radians(25)
            end = start + self.arm * np.array([side * np.sin(ang), -np.cos(ang), 0.0])
            out.append((start, end, r))
        return out

    def legs(self):
        r = self.thigh / (2 * np.pi)
        out = []
        for side in (1, -1):
            start = np.array([side * r * 1.05, self.y["crotch"] + r, 0.0])
            end = np.array([side * r * 1.2, 0.0, 0.0])
            out.append((start, end, r * 0.95))
        return out

    def head(self):
        return np.array([0.0, self.height - 0.065 * self.height, 0.0]), 0.065 * self.height

    def mesh(self, rings: int = 40, segments: int = 32):
        """A smooth mannequin (cm), for the GLB."""
        from .mesh import cylinder, loft, merge, uv_sphere

        ys = np.linspace(self.y["crotch"], self.y["neck"] + 2, rings)
        sections = []
        th = np.linspace(0, 2 * np.pi, segments, endpoint=False)
        for y in ys:
            a, b = self.torso_section(y)
            sections.append(np.stack([a * np.cos(th), np.full_like(th, y), b * np.sin(th)], 1))
        parts = [loft(sections)]
        c, r = self.head()
        parts.append(uv_sphere(r, 14, 24, center=c))
        nv, nf = cylinder(self.neck / (2 * np.pi), self.y["top"] * 0.06, 16,
                          center=(0, self.y["neck"] + self.height * 0.02, 0))
        parts.append((nv, nf))
        for start, end, rad in self.arms() + self.legs():
            parts.append(_capsule_mesh(start, end, rad))
        return merge(*parts)

    def collide(self, p: np.ndarray, margin: float = 0.4,
                parts=("torso", "arms", "legs", "head")) -> np.ndarray:
        """Push points out of the body (only the named parts: a shirt's body
        ignores the arms, which pass through its armholes). Returns a mask of
        the points that touched."""
        hit = np.zeros(len(p), dtype=bool)
        y = p[:, 1]
        inside_torso = (y > self.y["crotch"]) & (y < self.y["neck"])
        if "torso" not in parts:
            inside_torso[:] = False
        if inside_torso.any():
            idx = np.where(inside_torso)[0]
            a = np.interp(y[idx], self._ty, self._ta) + margin
            b = np.interp(y[idx], self._ty, self._tb) + margin
            x, z = p[idx, 0], p[idx, 2]
            r = np.sqrt((x / a) ** 2 + (z / b) ** 2)
            inn = r < 1.0
            scale = 1.0 / np.maximum(r[inn], 1e-6)
            p[idx[inn], 0] = x[inn] * scale
            p[idx[inn], 2] = z[inn] * scale
            hit[idx[inn]] = True
        limbs = (self.arms() if "arms" in parts else []) + (self.legs() if "legs" in parts else [])
        for start, end, rad in limbs:
            d = end - start
            t = np.clip(((p - start) @ d) / (d @ d), 0, 1)
            closest = start + t[:, None] * d
            off = p - closest
            dist = np.linalg.norm(off, axis=1)
            inn = dist < rad + margin
            if inn.any():
                n = off[inn] / np.maximum(dist[inn], 1e-6)[:, None]
                p[inn] = closest[inn] + n * (rad + margin)
                hit |= inn
        if "head" not in parts:
            return hit
        c, r = self.head()
        off = p - c
        dist = np.linalg.norm(off, axis=1)
        inn = dist < r + margin
        if inn.any():
            p[inn] = c + off[inn] / np.maximum(dist[inn], 1e-6)[:, None] * (r + margin)
            hit |= inn
        return hit


def _capsule_mesh(start, end, r, seg: int = 16, rings: int = 10):
    from .mesh import loft
    d = end - start
    length = np.linalg.norm(d)
    axis = d / length
    ref = np.array([0, 0, 1.0]) if abs(axis[2]) < 0.9 else np.array([1.0, 0, 0])
    u = np.cross(axis, ref)
    u /= np.linalg.norm(u)
    w = np.cross(axis, u)
    th = np.linspace(0, 2 * np.pi, seg, endpoint=False)
    secs = []
    for t in np.linspace(0, 1, rings):
        c = start + d * t
        rr = r * (1 - 0.15 * t)
        secs.append(c + rr * (np.cos(th)[:, None] * u + np.sin(th)[:, None] * w))
    return loft(secs)


# ── patterns ──────────────────────────────────────────────────────────────

@dataclass
class Piece:
    name: str
    outline: np.ndarray            # (n, 2) cm, closed, counter-clockwise
    cut: int = 1                   # how many to cut
    on_fold: bool = False
    grain: tuple = ((0.5, 0.2), (0.5, 0.8))   # fractions of the bounding box
    notes: list = field(default_factory=list)


@dataclass
class Garment:
    kind: str
    pieces: list
    tubes: list            # [(name, y_top, y_bottom, [(t, circumference), …], axis)] for draping
    seam_allowance: float = 1.0
    meta: dict = field(default_factory=dict)

    def save_svg(self, path: str, seam_allowance: float | None = None) -> str:
        return pattern_svg(self, path, seam_allowance)


def _curve(p0, p1, p2, n=12):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * np.asarray(p0) + 2 * (1 - t) * t * np.asarray(p1) + t ** 2 * np.asarray(p2)


def _ccw(poly):
    poly = np.asarray(poly, dtype=float)
    area = np.sum(poly[:, 0] * np.roll(poly[:, 1], -1) - np.roll(poly[:, 0], -1) * poly[:, 1])
    return poly if area > 0 else poly[::-1]


def tshirt(body: Body, ease: float = 10.0, length: float | None = None, sleeve: float = 22.0) -> Garment:
    """A set-in-sleeve T-shirt: front, back (both on the fold) and sleeve."""
    length = length or 0.41 * body.height
    hw = (body.chest + ease) / 4                 # half-width of front/back
    neck_w = body.neck / 6 + 1.0
    shoulder = body.shoulder / 2
    slope = 4.0
    armhole = (body.y["shoulder"] - body.y["chest"]) + 4
    pieces = []
    for name, neck_d in (("Front", body.neck / 6 + 2.5), ("Back", 2.0)):
        top = length
        out = [(0, 0), (hw, 0), (hw, top - armhole)]
        out += [tuple(p) for p in _curve((hw, top - armhole), (shoulder - 0.5, top - armhole + 2), (shoulder, top - slope))[1:]]
        out += [(neck_w, top)]
        out += [tuple(p) for p in _curve((neck_w, top), (neck_w, top - neck_d), (0, top - neck_d))[1:]]
        pieces.append(Piece(name, _ccw(out), cut=1, on_fold=True, notes=["Place the left edge on the fold"]))
    bicep = body.bicep + ease * 0.6
    cap = armhole * 0.55
    sw = bicep / 2
    cuff = sw * 0.9
    s = [(-cuff, 0), (cuff, 0), (sw, sleeve - cap)]
    s += [tuple(p) for p in _curve((sw, sleeve - cap), (sw * 0.45, sleeve + cap * 0.15), (0, sleeve))[1:]]
    s += [tuple(p) for p in _curve((0, sleeve), (-sw * 0.45, sleeve + cap * 0.15), (-sw, sleeve - cap))[1:]]
    pieces.append(Piece("Sleeve", _ccw(s), cut=2, grain=((0.5, 0.15), (0.5, 0.75))))
    y_top = body.y["shoulder"] + 1.0
    return Garment("tshirt", pieces, tubes=[
        ("body", y_top, y_top - length, [(0, body.chest + ease), (1, body.chest + ease)], "body"),
        ("sleeve_l", 0, sleeve, [(0, bicep), (1, cuff * 2)], "arm0"),
        ("sleeve_r", 0, sleeve, [(0, bicep), (1, cuff * 2)], "arm1"),
    ], meta={"ease_cm": ease, "length_cm": length, "sleeve_cm": sleeve})


def skirt(body: Body, length: float = 55.0, flare: float = 1.4, ease: float = 2.0,
          hip_ease: float = 4.0, panels: int = 4) -> Garment:
    """A panelled A-line skirt: `panels` identical gores, curved out from the
    waist to clear the hip (+ `hip_ease`), then flaring to a hem of
    waist × `flare` (at least the hip plus walking room)."""
    waist = body.waist + ease
    hip = body.hip + hip_ease
    drop = min(body.y["waist"] - body.y["hip"], length * 0.6)    # waist to hip line
    hem = max(waist * flare, hip + 8)
    t_hip = drop / length
    # the hem may not narrow the skirt below the hip: keep it straight down
    hem = max(hem, hip)
    tw, hw, bw = waist / panels, hip / panels, hem / panels
    side = _curve((tw / 2, length), (hw / 2, length - drop * 0.45), (hw / 2, length - drop), 10)
    out = [(-bw / 2, 0), (bw / 2, 0)] + [tuple(p) for p in side[::-1]] + [(0, length + 0.6)]
    out += [(-x, y) for x, y in side]
    pieces = [Piece("Gore", _ccw(out), cut=panels, notes=[f"Cut {panels}; sew side by side into a tube"])]
    y_top = body.y["waist"]
    return Garment("skirt", pieces, tubes=[
        ("skirt", y_top, y_top - length,
         [(0, waist), (t_hip * 0.5, (waist + hip) / 2 + (hip - waist) * 0.15), (t_hip, hip), (1, hem)], "body"),
    ], meta={"waist_cm": waist, "hip_cm": hip, "hem_cm": hem, "length_cm": length, "panels": panels})


def pattern_svg(garment: Garment, path: str, seam_allowance: float | None = None) -> str:
    """Every piece at real size (1 user unit = 1 cm, printed at 100% it
    measures true: check the 5 cm square), cut line with seam allowance,
    stitch line dashed, grainline, labels."""
    sa = garment.seam_allowance if seam_allowance is None else seam_allowance
    margin = 3.0
    x = margin
    shapes = []
    height = 0.0
    for piece in garment.pieces:
        o = piece.outline - piece.outline.min(axis=0)
        cut = _offset(o, sa)
        w, h = np.ptp(cut[:, 0]), np.ptp(cut[:, 1])
        shift = np.array([x - cut[:, 0].min(), margin - cut[:, 1].min()])
        flip = lambda pts: np.stack([pts[:, 0] + shift[0], margin + h - (pts[:, 1] + shift[1] - margin)], 1)
        poly = lambda pts: " ".join(f"{a:.2f},{b:.2f}" for a, b in flip(pts))
        g0 = np.array(piece.grain[0]) * [np.ptp(o[:, 0]), np.ptp(o[:, 1])]
        g1 = np.array(piece.grain[1]) * [np.ptp(o[:, 0]), np.ptp(o[:, 1])]
        (gx0, gy0), (gx1, gy1) = flip(np.array([g0, g1]))
        cx, cy = flip(np.array([[np.ptp(o[:, 0]) / 2, np.ptp(o[:, 1]) * 0.5]]))[0]
        label = f"{piece.name} — cut {piece.cut}" + (" on fold" if piece.on_fold else "")
        shapes.append(
            f'<polygon points="{poly(cut)}" fill="#fffdf6" stroke="#222" stroke-width="0.12"/>'
            f'<polygon points="{poly(o)}" fill="none" stroke="#c0392b" stroke-width="0.08" stroke-dasharray="0.6 0.4"/>'
            f'<line x1="{gx0:.2f}" y1="{gy0:.2f}" x2="{gx1:.2f}" y2="{gy1:.2f}" stroke="#2c3e50" stroke-width="0.1" marker-start="url(#a)" marker-end="url(#a)"/>'
            f'<text x="{cx:.2f}" y="{cy:.2f}" font-size="1.4" text-anchor="middle" font-family="sans-serif">{label}</text>'
            + "".join(f'<text x="{cx:.2f}" y="{cy + 2 * (i + 1):.2f}" font-size="0.9" text-anchor="middle" font-family="sans-serif" fill="#555">{n}</text>'
                      for i, n in enumerate(piece.notes))
        )
        x += w + margin
        height = max(height, h)
    width = x + 8
    height += 2 * margin
    square = (f'<rect x="{width - 7}" y="{margin}" width="5" height="5" fill="none" stroke="#222" stroke-width="0.1"/>'
              f'<text x="{width - 4.5}" y="{margin + 6.5}" font-size="0.8" text-anchor="middle" font-family="sans-serif">5 cm</text>')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}cm" height="{height}cm" viewBox="0 0 {width:.2f} {height:.2f}">'
           '<defs><marker id="a" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse">'
           '<path d="M0,0 L10,5 L0,10 z" fill="#2c3e50"/></marker></defs>'
           f'<rect width="100%" height="100%" fill="#f4f1ea"/>{"".join(shapes)}{square}'
           f'<text x="{margin}" y="{height - 0.8:.2f}" font-size="0.9" font-family="sans-serif" fill="#555">'
           f'{garment.kind}: solid line = cut ({sa:g} cm seam allowance), dashed = stitch. Print at 100%.</text></svg>')
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(svg)
    return path


def _offset(poly: np.ndarray, d: float) -> np.ndarray:
    """Offset a counter-clockwise polygon outward by d (mitred, capped)."""
    p = np.asarray(poly, dtype=float)
    prev, nxt = np.roll(p, 1, axis=0), np.roll(p, -1, axis=0)
    e1 = p - prev
    e2 = nxt - p
    n1 = np.stack([e1[:, 1], -e1[:, 0]], 1) / np.maximum(np.linalg.norm(e1, axis=1), 1e-9)[:, None]
    n2 = np.stack([e2[:, 1], -e2[:, 0]], 1) / np.maximum(np.linalg.norm(e2, axis=1), 1e-9)[:, None]
    m = n1 + n2
    m /= np.maximum(np.linalg.norm(m, axis=1), 1e-9)[:, None]
    cos = np.clip(np.einsum("ij,ij->i", m, n1), 0.35, 1)
    return p + m * (d / cos)[:, None]


# ── draping ───────────────────────────────────────────────────────────────

@dataclass
class DrapeResult:
    body: Body
    garment: Garment
    meshes: list            # [(name, rest_vertices, faces, frames[list of (n,3)], strain)]
    fit: dict

    def save_glb(self, path: str, keyframes: int = 12, seconds: float = 3.0) -> str:
        """Mannequin + garment, the drape animated over `seconds`, the cloth
        coloured by fit (red tight, white right, blue loose). Metres."""
        from .glb import Scene

        scene = Scene()
        bv, bf = self.body.mesh()
        scene.node("body", mesh=scene.mesh("body", bv / 100, bf, color=(0.78, 0.74, 0.70), roughness=0.8))
        for name, _, faces, frames, strain in self.meshes:
            pick = np.linspace(0, len(frames) - 1, keyframes).round().astype(int)
            shots = [frames[i] / 100 for i in pick]
            colors = fit_colors(strain)
            mesh = scene.mesh(name, shots[0], faces, color=(1, 1, 1), double_sided=True, roughness=0.9,
                              vertex_colors=colors, morph_targets=shots[1:])
            node = scene.node(name, mesh=mesh)
            n = len(shots) - 1
            t = np.linspace(0, seconds, n + 1)
            w = np.vstack([np.zeros(n), np.eye(n)])
            scene.animate_shapes(node, t, w)
        return scene.save(path)


def fit_colors(strain: np.ndarray) -> np.ndarray:
    """Per-vertex colour: blue (loose, slack) → off-white (neutral) → red (tight)."""
    s = np.clip(np.asarray(strain) / 0.06, -1, 1)
    neutral = np.array([0.93, 0.91, 0.86])
    red = np.array([0.86, 0.18, 0.16])
    blue = np.array([0.20, 0.42, 0.85])
    return np.where(s[:, None] > 0, neutral + (red - neutral) * s[:, None], neutral + (blue - neutral) * (-s)[:, None])


def _tube(circ_top, circ_bottom, length, res=2.0):
    nu = max(16, int(round(max(circ_top, circ_bottom) / res)))
    nv = max(4, int(round(length / res)))
    u = np.arange(nu)
    v = np.arange(nv + 1)
    faces = []
    for j in range(nv):
        for i in range(nu):
            a = j * nu + i
            b = j * nu + (i + 1) % nu
            c = (j + 1) * nu + i
            d = (j + 1) * nu + (i + 1) % nu
            faces += [[a, c, b], [b, c, d]]
    return nu, nv, np.array(faces)


def _constraints(nu, nv):
    idx = lambda i, j: j * nu + (i % nu)
    s, sh, bd = [], [], []
    for j in range(nv + 1):
        for i in range(nu):
            s.append((idx(i, j), idx(i + 1, j)))
            bd.append((idx(i, j), idx(i + 2, j)))
            if j < nv:
                s.append((idx(i, j), idx(i, j + 1)))
                sh.append((idx(i, j), idx(i + 1, j + 1)))
                sh.append((idx(i + 1, j), idx(i, j + 1)))
            if j < nv - 1:
                bd.append((idx(i, j), idx(i, j + 2)))
    return np.array(s), np.array(sh), np.array(bd)


def drape(body: Body, garment: Garment, fabric: str | dict = "cotton", frames: int = 120,
          iterations: int = 10, res: float = 2.5) -> DrapeResult:
    """Hang the garment on the body and let it settle. `res` is the cloth
    grid size in cm (smaller = finer and slower)."""
    fab = FABRICS[fabric] if isinstance(fabric, str) else fabric
    arms = body.arms()
    meshes = []
    fit = {"fabric": fabric if isinstance(fabric, str) else "custom", "pieces": {}}
    gravity = np.array([0.0, -981.0, 0.0])
    dt = 1 / 60
    for name, y_top, y_bot, profile, axis in garment.tubes:
        length = abs(y_top - y_bot)
        pt = [p[0] for p in profile]
        pc = [p[1] for p in profile]
        circ_at = lambda t: float(np.interp(t, pt, pc))
        nu, nv, faces = _tube(max(pc), max(pc), length, res)
        th = np.linspace(0, 2 * np.pi, nu, endpoint=False)
        pts = []
        rest = []
        if axis == "body":
            for j in range(nv + 1):
                t = j / nv
                y = y_top + (y_bot - y_top) * t
                circ = circ_at(t)
                a, b = body.torso_section(min(max(y, body.y["crotch"]), body.y["neck"] - 0.1))
                # the body's own shape, grown to the garment's circumference
                k = circ / (np.pi * (3 * (a + b) - np.sqrt((3 * a + b) * (a + 3 * b))))
                rest.append(np.stack([a * k * np.cos(th), np.full_like(th, y), b * k * np.sin(th)], 1))
                k = max(k, 1.02)      # start it just off the body; a small one pulls tight
                pts.append(np.stack([a * k * np.cos(th), np.full_like(th, y), b * k * np.sin(th)], 1))
            pinned = np.arange(nu)                        # waistband / shoulders
        else:
            start, end, r = arms[0 if axis == "arm0" else 1]
            d = (end - start) / np.linalg.norm(end - start)
            ref = np.array([0, 0, 1.0])
            u = np.cross(d, ref)
            u /= np.linalg.norm(u)
            w = np.cross(d, u)
            for j in range(nv + 1):
                t = j / nv
                circ = circ_at(t)
                c = start + d * (length * t)
                rest.append(c + circ / (2 * np.pi) * (np.cos(th)[:, None] * u + np.sin(th)[:, None] * w))
                rr = max(circ / (2 * np.pi), r * 1.05)
                pts.append(c + rr * (np.cos(th)[:, None] * u + np.sin(th)[:, None] * w))
            pinned = np.arange(nu)
        x = np.vstack(pts).astype(float)
        rest_pts = np.vstack(rest).astype(float)   # the garment's own (pattern) size
        s, sh, bd = _constraints(nu, nv)

        def lengths(e):
            return np.linalg.norm(rest_pts[e[:, 0]] - rest_pts[e[:, 1]], axis=1)

        sets = [(s, lengths(s), fab["stretch"]), (sh, lengths(sh), fab["stretch"] * 0.6),
                (bd, lengths(bd), fab["bend"])]
        parts = ("torso", "legs", "head") if axis == "body" else ("arms",)
        # tethers: no point hangs farther from its seam than the cloth between them
        col = np.arange(len(x)) % nu
        down = rest_pts.reshape(nv + 1, nu, 3)
        seg = np.linalg.norm(np.diff(down, axis=0), axis=2)
        reach = np.vstack([np.zeros((1, nu)), np.cumsum(seg, axis=0)]).ravel() * (1 + 0.04 * (1 - fab["stretch"]) + 0.01)
        counts = {id(e): np.maximum(np.bincount(e.ravel(), minlength=len(x)), 1).astype(float)
                  for e, _, _ in sets}
        prev = x.copy()
        inv_mass = np.ones(len(x))
        inv_mass[pinned] = 0
        anchor = x[pinned].copy()
        recorded = [x.copy()]
        for step in range(frames):
            vel = (x - prev) * 0.985
            prev = x.copy()
            x = x + vel + gravity * dt * dt * (inv_mass[:, None] > 0)
            for _ in range(iterations):
                for e, rest, k in sets:
                    if k <= 0:
                        continue
                    pa, pb = x[e[:, 0]], x[e[:, 1]]
                    dvec = pb - pa
                    dist = np.maximum(np.linalg.norm(dvec, axis=1), 1e-9)
                    wa, wb = inv_mass[e[:, 0]], inv_mass[e[:, 1]]
                    wsum = np.maximum(wa + wb, 1e-9)
                    corr = ((dist - rest) / dist / wsum * k)[:, None] * dvec
                    n_pts = len(x)
                    delta = np.stack([
                        np.bincount(e[:, 0], corr[:, k] * wa, n_pts) - np.bincount(e[:, 1], corr[:, k] * wb, n_pts)
                        for k in range(3)], axis=1)
                    x += delta / counts[id(e)][:, None] * 1.6
                tether = x - x[pinned][col]
                tlen = np.linalg.norm(tether, axis=1)
                over = tlen > reach
                if over.any():
                    x[over] = x[pinned][col[over]] + tether[over] * (reach[over] / tlen[over])[:, None]
                hit = body.collide(x, parts=parts)
                x[pinned] = anchor          # seams stay where they're sewn
                hit[pinned] = False
                if hit.any():   # friction: keep part of the contact position
                    prev[hit] = prev[hit] + (x[hit] - prev[hit]) * fab["friction"] * 0.5
            recorded.append(x.copy())
        # fit: strain of the horizontal (around) edges, per vertex
        ring = s[(s[:, 1] - s[:, 0]) % nu == 1]   # the edges around the tube
        l_now = np.linalg.norm(x[ring[:, 0]] - x[ring[:, 1]], axis=1)
        l_rest = np.linalg.norm(rest_pts[ring[:, 0]] - rest_pts[ring[:, 1]], axis=1)
        strain_e = l_now / l_rest - 1
        strain = np.zeros(len(x))
        cnt = np.zeros(len(x))
        np.add.at(strain, ring[:, 0], strain_e)
        np.add.at(strain, ring[:, 1], strain_e)
        np.add.at(cnt, ring[:, 0], 1)
        np.add.at(cnt, ring[:, 1], 1)
        strain /= np.maximum(cnt, 1)
        strain[: 2 * nu] = 0.0     # the held seam rows aren't fabric strain
        # clearance to the body (how far the cloth stands off it)
        probe = x.copy()
        body.collide(probe, margin=1.5, parts=parts)
        snug = np.linalg.norm(probe - x, axis=1) > 0.01
        rows = strain.reshape(nv + 1, nu)
        ys = x[:, 1].reshape(nv + 1, nu).mean(axis=1)
        fit["pieces"][name] = {
            "max_stretch_pct": float(strain.max() * 100),
            "tight_area_pct": float((strain > 0.03).mean() * 100),
            "touching_body_pct": float(snug.mean() * 100),
            "tightest_at_height_cm": float(ys[int(np.argmax(rows.max(axis=1)))]),
            "hem_height_cm": float(x[-nu:, 1].mean()),
        }
        meshes.append((name, rest_pts, faces, recorded, strain))
    worst = max(fit["pieces"].values(), key=lambda p: p["max_stretch_pct"])
    fit["verdict"] = ("too tight: size up or add ease" if worst["max_stretch_pct"] > 8
                      else "snug" if worst["max_stretch_pct"] > 3 else "comfortable")
    return DrapeResult(body, garment, meshes, fit)
