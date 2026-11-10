"""Aerodynamics for aircraft, wings, sails and fins, with numpy:

- `naca4("2412")`: airfoil coordinates.
- `airfoil(coords, alpha)`: 2D panel method (Hess–Smith): pressure
  distribution, lift, moment; `airfoil_polar` over a range of angles with a
  skin-friction drag estimate.
- `Surface` + `vlm([...], alpha, speed)`: vortex-lattice method for whole
  wings and tails (taper, sweep, dihedral, twist): lift, induced drag, span
  efficiency, spanwise loading, pitching moment.
- `aircraft_polar(...)`: drag polar, L/D, stall and cruise speeds for a mass.
- `wind_tunnel(shape, ...)`: a 2D lattice-Boltzmann flow around a shape,
  saved as an animated GIF of the airflow (vorticity or speed) — for seeing
  the flow (wake, separation), not for numbers.

Potential-flow methods don't stall: past roughly CL 1.2–1.5 (thin sections
earlier) a real wing stalls. Say so when you report. Units: SI, angles in
degrees at the interface.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

RHO_AIR = 1.225
NU_AIR = 1.46e-5
G = 9.81


# ── airfoils ───────────────────────────────────────────────────────────────

def naca4(code: str = "0012", n: int = 80, chord: float = 1.0) -> np.ndarray:
    """NACA 4-digit airfoil, closed trailing edge, points ordered from the
    trailing edge along the lower surface to the nose and back along the
    upper surface (clockwise), first point == last point."""
    m = int(code[0]) / 100
    p = int(code[1]) / 10
    t = int(code[2:]) / 100
    beta = np.linspace(0, np.pi, n + 1)
    x = (1 - np.cos(beta)) / 2
    yt = 5 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4)
    yc = np.zeros_like(x)
    dyc = np.zeros_like(x)
    if m > 0 and p > 0:
        fwd = x < p
        yc[fwd] = m / p ** 2 * (2 * p * x[fwd] - x[fwd] ** 2)
        yc[~fwd] = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x[~fwd] - x[~fwd] ** 2)
        dyc[fwd] = 2 * m / p ** 2 * (p - x[fwd])
        dyc[~fwd] = 2 * m / (1 - p) ** 2 * (p - x[~fwd])
    th = np.arctan(dyc)
    xu, yu = x - yt * np.sin(th), yc + yt * np.cos(th)
    xl, yl = x + yt * np.sin(th), yc - yt * np.cos(th)
    pts = np.vstack([np.stack([xl[::-1], yl[::-1]], 1), np.stack([xu[1:], yu[1:]], 1)])
    pts[-1] = pts[0]
    return pts * chord


def zero_lift_angle(code: str) -> float:
    """Thin-airfoil zero-lift angle (degrees) of a NACA 4-digit section."""
    m = int(code[0]) / 100
    p = int(code[1]) / 10
    if m == 0 or p == 0:
        return 0.0
    th = np.linspace(0, np.pi, 2001)
    x = (1 - np.cos(th)) / 2
    dyc = np.where(x < p, 2 * m / p ** 2 * (p - x), 2 * m / (1 - p) ** 2 * (p - x))
    integ = dyc * (np.cos(th) - 1)
    val = np.sum((integ[1:] + integ[:-1]) / 2 * np.diff(th))
    return float(np.degrees(-val / np.pi))


@dataclass
class AirfoilResult:
    alpha: float
    cl: float
    cm_quarter: float
    x: np.ndarray          # control points
    y: np.ndarray
    cp: np.ndarray         # pressure coefficient at each panel


def airfoil(coords: np.ndarray, alpha_deg: float) -> AirfoilResult:
    """Hess–Smith panel method (sources + one vortex, Kutta condition)."""
    pts = np.asarray(coords, dtype=float)
    if np.allclose(pts[0], pts[-1]):
        pts = pts[:-1]
    pts = np.vstack([pts, pts[:1]])
    xa, ya = pts[:-1, 0], pts[:-1, 1]
    xb, yb = pts[1:, 0], pts[1:, 1]
    n = len(xa)
    xc, yc = (xa + xb) / 2, (ya + yb) / 2
    length = np.hypot(xb - xa, yb - ya)
    theta = np.arctan2(yb - ya, xb - xa)
    alpha = np.radians(alpha_deg)

    dxa = xc[:, None] - xa[None, :]
    dya = yc[:, None] - ya[None, :]
    dxb = xc[:, None] - xb[None, :]
    dyb = yc[:, None] - yb[None, :]
    r1 = np.hypot(dxa, dya)
    r2 = np.hypot(dxb, dyb)
    beta = np.arctan2(dxa * dyb - dya * dxb, dxa * dxb + dya * dyb)
    np.fill_diagonal(beta, np.pi)
    lnr = np.log(np.maximum(r2, 1e-300) / np.maximum(r1, 1e-300))
    np.fill_diagonal(lnr, 0.0)
    dth = theta[:, None] - theta[None, :]
    A = (np.sin(dth) * lnr + np.cos(dth) * beta) / (2 * np.pi)   # source → normal
    B = (np.sin(dth) * beta - np.cos(dth) * lnr) / (2 * np.pi)   # source → tangential

    M = np.zeros((n + 1, n + 1))
    rhs = np.zeros(n + 1)
    M[:n, :n] = A
    M[:n, n] = -B.sum(axis=1)
    rhs[:n] = -np.sin(alpha - theta)
    M[n, :n] = B[0] + B[-1]
    M[n, n] = A[0].sum() + A[-1].sum()
    rhs[n] = -(np.cos(alpha - theta[0]) + np.cos(alpha - theta[-1]))
    sol = np.linalg.solve(M, rhs)
    q, gamma = sol[:n], sol[n]
    vt = np.cos(alpha - theta) + B @ q + gamma * A.sum(axis=1)
    cp = 1 - vt ** 2
    chord = pts[:, 0].max() - pts[:, 0].min()
    # forces from the pressure, on the outward normal of the clockwise contour
    nx, ny = -np.sin(theta), np.cos(theta)
    fx = -(cp * length * nx).sum() / chord
    fy = -(cp * length * ny).sum() / chord
    cl = fy * np.cos(alpha) - fx * np.sin(alpha)
    xq = pts[:, 0].min() + chord / 4
    cm = ((cp * length) * (ny * (xc - xq) - nx * yc)).sum() / chord ** 2
    return AirfoilResult(float(alpha_deg), float(cl), float(cm), xc, yc, cp)


def skin_friction_cd(thickness: float, reynolds: float) -> float:
    """Profile drag estimate: turbulent flat plate (both sides) with a form
    factor for thickness."""
    cf = 0.074 / reynolds ** 0.2 if reynolds > 5e5 else 1.328 / np.sqrt(max(reynolds, 1.0))
    return float(2 * cf * (1 + 2 * thickness + 60 * thickness ** 4))


def airfoil_polar(code: str = "2412", alphas=range(-6, 15), speed: float = 30.0, chord: float = 1.0,
                  nu: float = NU_AIR) -> dict:
    coords = naca4(code)
    re = speed * chord / nu
    cd0 = skin_friction_cd(int(code[2:]) / 100, re)
    rows = [airfoil(coords, a) for a in alphas]
    cl = [r.cl for r in rows]
    cd = [cd0 * (1 + 0.5 * (c / 1.2) ** 2) for c in cl]   # drag rises with lift
    return {
        "airfoil": f"NACA {code}",
        "reynolds": re,
        "alpha_deg": [float(a) for a in alphas],
        "cl": cl,
        "cd_estimate": cd,
        "cm_quarter": [r.cm_quarter for r in rows],
        "l_over_d": [c / d for c, d in zip(cl, cd)],
        "cl_alpha_per_deg": float(np.polyfit([float(a) for a in alphas], cl, 1)[0]),
        "note": "inviscid lift (no stall); drag is a skin-friction estimate",
    }


# ── wings: vortex-lattice method ───────────────────────────────────────────

@dataclass
class Surface:
    """A lifting surface (wing, tailplane, fin with vertical=True), both
    halves unless `symmetric` is False. Positions in metres: x aft, y up,
    z span (right). `root` is the leading edge of the root chord."""
    name: str = "wing"
    span: float = 10.0
    root_chord: float = 1.6
    tip_chord: float = 1.0
    sweep_deg: float = 0.0          # leading-edge sweep
    dihedral_deg: float = 0.0
    incidence_deg: float = 0.0      # root angle to the fuselage
    twist_deg: float = 0.0          # tip relative to root (− = washout)
    airfoil: str = "2412"
    root: tuple = (0.0, 0.0, 0.0)
    symmetric: bool = True
    vertical: bool = False
    panels: int = 24                # spanwise, per half

    @property
    def area(self) -> float:
        return self.span * (self.root_chord + self.tip_chord) / 2

    @property
    def aspect_ratio(self) -> float:
        return self.span ** 2 / self.area

    @property
    def mac(self) -> float:
        lam = self.tip_chord / self.root_chord
        return 2 / 3 * self.root_chord * (1 + lam + lam ** 2) / (1 + lam)

    def strips(self):
        """Spanwise strips: (corners a, b of the bound vortex at ¼ chord,
        control point at ¾ chord, local chord, local incidence deg)."""
        half = self.span / 2 if self.symmetric else self.span
        s = (1 - np.cos(np.linspace(0, np.pi, self.panels + 1))) / 2 * half   # finer at the tip
        tan_sw = np.tan(np.radians(self.sweep_deg))
        dih = np.radians(self.dihedral_deg)

        def at(sp):
            frac = sp / half
            c = self.root_chord + (self.tip_chord - self.root_chord) * frac
            le_x = self.root[0] + sp * tan_sw
            if self.vertical:
                p = np.array([le_x, self.root[1] + sp, self.root[2]])
            else:
                p = np.array([le_x, self.root[1] + sp * np.sin(dih), self.root[2] + sp * np.cos(dih)])
            inc = self.incidence_deg + self.twist_deg * frac - zero_lift_angle(self.airfoil)
            return p, c, inc

        out = []
        sides = (1, -1) if self.symmetric and not self.vertical else (1,)
        for side in sides:
            for i in range(self.panels):
                pa, ca, ia = at(s[i])
                pb, cb, ib = at(s[i + 1])
                if side < 0:
                    pa = pa * [1, 1, -1] + [0, 0, 2 * self.root[2]]
                    pb = pb * [1, 1, -1] + [0, 0, 2 * self.root[2]]
                    pa, pb = pb, pa
                a = pa + [ca / 4, 0, 0]
                b = pb + [cb / 4, 0, 0]
                mid_le = (pa + pb) / 2
                c = (ca + cb) / 2
                cp = mid_le + [0.75 * c, 0, 0]
                out.append((a, b, cp, c, (ia + ib) / 2))
        return out


def _segment(p, a, b):
    """Velocity at points p from a unit vortex segment a→b (Biot–Savart)."""
    r1 = p - a
    r2 = p - b
    cr = np.cross(r1, r2)
    cr2 = np.einsum("...i,...i", cr, cr)
    n1 = np.linalg.norm(r1, axis=-1)
    n2 = np.linalg.norm(r2, axis=-1)
    r0 = b - a
    k = (np.einsum("...i,...i", r0, r1) / np.maximum(n1, 1e-12) - np.einsum("...i,...i", r0, r2) / np.maximum(n2, 1e-12))
    out = cr * (k / (4 * np.pi * np.maximum(cr2, 1e-12)))[..., None]
    out[cr2 < 1e-10] = 0
    return out


def _horseshoe(p, a, b, far=1e4):
    fa = a + [far, 0, 0]
    fb = b + [far, 0, 0]
    return _segment(p, fa, a) + _segment(p, a, b) + _segment(p, b, fb)


def vlm(surfaces, alpha_deg: float = 4.0, speed: float = 50.0, rho: float = RHO_AIR,
        ref_area: float | None = None, ref_chord: float | None = None, cg=(0.0, 0.0, 0.0)) -> dict:
    """Solve the vortex lattice for one or more surfaces at an angle of attack.
    Returns lift, induced drag, coefficients (on the first surface's area
    unless `ref_area`), span efficiency, pitching moment about `cg`, and the
    spanwise lift per strip."""
    strips = []
    owner = []
    for si, srf in enumerate(surfaces):
        for st in srf.strips():
            strips.append(st)
            owner.append(si)
    a = np.array([s[0] for s in strips])
    b = np.array([s[1] for s in strips])
    cps = np.array([s[2] for s in strips])
    chords = np.array([s[3] for s in strips])
    inc = np.radians(np.array([s[4] for s in strips]))
    vertical = np.array([surfaces[o].vertical for o in owner])
    alpha = np.radians(alpha_deg)

    # normals: tilted by the local incidence; a fin's normal is sideways
    span_dir = (b - a) / np.linalg.norm(b - a, axis=1)[:, None]
    chord_dir = np.stack([np.cos(inc), -np.sin(inc), np.zeros_like(inc)], axis=1)
    normal = np.cross(chord_dir, span_dir)
    # point wings' normals up and fins' normals to the right (+z)
    up = np.where(vertical, normal[:, 2], normal[:, 1])
    normal *= np.where(up < 0, -1.0, 1.0)[:, None]
    normal /= np.linalg.norm(normal, axis=1)[:, None]

    n = len(strips)
    vinf = speed * np.array([np.cos(alpha), np.sin(alpha), 0.0])
    AIC = np.zeros((n, n))
    for j in range(n):
        vel = _horseshoe(cps, a[j], b[j])
        AIC[:, j] = np.einsum("ij,ij->i", vel, normal)
    gamma = np.linalg.solve(AIC, -normal @ vinf)

    # forces (Kutta–Joukowski) on each bound segment, velocity at its middle
    mids = (a + b) / 2
    vel = np.tile(vinf, (n, 1))
    for j in range(n):
        vel += _horseshoe(mids, a[j], b[j]) * gamma[j]
    seg = b - a
    force = rho * gamma[:, None] * np.cross(vel, seg)
    total = force.sum(axis=0)
    lift_dir = np.array([-np.sin(alpha), np.cos(alpha), 0.0])
    drag_dir = np.array([np.cos(alpha), np.sin(alpha), 0.0])
    lift = float(total @ lift_dir)
    # induced drag in the Trefftz plane (far behind): the trailing legs are
    # 2D vortices in the y–z plane; drag = ½ρ Σ Γ_i w_i ℓ_i (positive definite)
    ya, za, yb, zb = a[:, 1], a[:, 2], b[:, 1], b[:, 2]
    my, mz = (ya + yb) / 2, (za + zb) / 2
    ty, tz = yb - ya, zb - za
    ln = np.hypot(ty, tz)
    ny_, nz_ = -tz / ln, ty / ln             # strip normal in the plane

    def wash(qy, qz, sign):
        dy = my[:, None] - qy[None, :]
        dz = mz[:, None] - qz[None, :]
        r2 = np.maximum(dy * dy + dz * dz, 1e-12)
        vy = -dz / (2 * np.pi * r2)
        vz = dy / (2 * np.pi * r2)
        return sign * (vy * ny_[:, None] + vz * nz_[:, None])

    K = wash(ya, za, 1.0) + wash(yb, zb, -1.0)
    w = K @ gamma
    drag_i = float(abs(0.5 * rho * np.sum(gamma * w * ln)))
    # The lattice's piecewise-constant loading biases this a few % low. Measure
    # the bias with an elliptic loading on the main wing's own strips (whose
    # exact drag is known) and correct for it.
    main = np.array(owner) == 0
    if not surfaces[0].vertical and main.sum() > 4:
        half = surfaces[0].span / 2
        zc = mz[main] - surfaces[0].root[2]
        g_e = np.sqrt(np.clip(1 - (zc / half) ** 2, 0, None))
        Km = K[np.ix_(main, main)]
        d_disc = abs(0.5 * rho * np.sum(g_e * (Km @ g_e) * ln[main]))
        l_e = rho * speed * np.sum(g_e * ln[main])
        d_exact = l_e ** 2 / (np.pi * 0.5 * rho * speed ** 2 * surfaces[0].span ** 2)
        if d_disc > 0:
            drag_i *= d_exact / d_disc
    moment = np.cross(mids - np.asarray(cg, dtype=float), force).sum(axis=0)

    s_ref = ref_area or surfaces[0].area
    c_ref = ref_chord or surfaces[0].mac
    q = 0.5 * rho * speed ** 2
    cl = lift / (q * s_ref)
    cdi = drag_i / (q * s_ref)
    ar = surfaces[0].aspect_ratio
    e = cl ** 2 / (np.pi * ar * cdi) if cdi > 1e-9 else float("nan")
    strip_lift = force @ lift_dir / np.linalg.norm(seg, axis=1)
    return {
        "alpha_deg": alpha_deg,
        "speed_ms": speed,
        "lift_N": lift,
        "induced_drag_N": drag_i,
        "CL": float(cl),
        "CDi": float(cdi),
        "span_efficiency": float(e),
        "pitching_moment_Nm": float(-moment[2]),
        "Cm": float(-moment[2] / (q * s_ref * c_ref)),
        "strips": [{"surface": surfaces[o].name, "z": float(m[2]), "y": float(m[1]),
                    "lift_per_m": float(l), "chord": float(c)}
                   for o, m, l, c in zip(owner, mids, strip_lift, chords)],
    }


def aircraft_polar(surfaces, mass: float, cd0: float | None = None, cl_max: float = 1.4,
                   speeds=None, rho: float = RHO_AIR, cg=(0.0, 0.0, 0.0)) -> dict:
    """Performance of a whole aircraft: lift curve and induced drag from the
    VLM, parasite drag `cd0` (estimated from the wetted surfaces if not
    given), then for each speed the angle needed to fly level, drag, power
    and L/D; stall and best-L/D speeds; static stability (neutral point)."""
    s_ref = surfaces[0].area
    a0 = vlm(surfaces, 0.0, 50, rho, cg=cg)
    a1 = vlm(surfaces, 4.0, 50, rho, cg=cg)
    cla = (a1["CL"] - a0["CL"]) / 4.0                    # per degree
    k = a1["CDi"] / a1["CL"] ** 2 if a1["CL"] else 0.0   # CDi = k CL²
    cma = (a1["Cm"] - a0["Cm"]) / 4.0
    if cd0 is None:
        wetted = sum(2.05 * s.area for s in surfaces)
        cd0 = 0.0055 * wetted / s_ref + 0.012           # + fuselage, gear, interference
    weight = mass * G
    v_stall = float(np.sqrt(2 * weight / (rho * s_ref * cl_max)))
    speeds = np.linspace(v_stall, v_stall * 3.5, 30) if speeds is None else np.asarray(speeds, dtype=float)
    rows = []
    for v in speeds:
        cl = 2 * weight / (rho * v * v * s_ref)
        cd = cd0 + k * cl * cl
        drag = 0.5 * rho * v * v * s_ref * cd
        rows.append({
            "speed_ms": float(v), "CL": float(cl), "alpha_deg": float((cl - a0["CL"]) / cla),
            "CD": float(cd), "drag_N": float(drag), "power_W": float(drag * v),
            "L_over_D": float(cl / cd), "stalled": bool(cl > cl_max),
        })
    best = max(rows, key=lambda r: r["L_over_D"])
    mac = surfaces[0].mac
    neutral_x = cg[0] - cma / cla * mac if cla else None
    return {
        "wing_area_m2": s_ref, "aspect_ratio": surfaces[0].aspect_ratio,
        "CL_alpha_per_deg": float(cla), "CL_at_0deg": a0["CL"], "induced_drag_factor_k": float(k),
        "CD0": float(cd0), "stall_speed_ms": v_stall,
        "best_glide_speed_ms": best["speed_ms"], "max_L_over_D": best["L_over_D"],
        "Cm_alpha_per_deg": float(cma),
        "statically_stable": bool(cma < 0),
        "neutral_point_x_m": float(neutral_x) if neutral_x is not None else None,
        "static_margin_pct_mac": float((neutral_x - cg[0]) / mac * 100) if neutral_x is not None else None,
        "rows": rows,
        "note": "potential flow (VLM) + parasite-drag estimate; no stall modelling beyond cl_max",
    }


def surfaces_glb(path: str, surfaces, colors=None, thickness: float = 0.12, extra=None) -> str:
    """A 3D model of the lifting surfaces (each strip lofted from its
    airfoil), coloured by spanwise lift when given a `vlm` result as `extra`."""
    from .glb import Scene

    scene = Scene()
    lifts = None
    if extra:
        vals = np.array([s["lift_per_m"] for s in extra["strips"]])
        lifts = (vals - vals.min()) / max(np.ptp(vals), 1e-9)
    k = 0
    for si, srf in enumerate(surfaces):
        sec = naca4(srf.airfoil, 24)[:-1]
        verts, faces, cols = [], [], []
        for (a, b, _, c, inc_deg) in srf.strips():
            for p, chord in ((a, c), (b, c)):
                le = p - [chord / 4, 0, 0]
                inc = np.radians(inc_deg)
                xs = sec[:, 0] * chord
                ys = sec[:, 1] * chord
                x = xs * np.cos(inc) + ys * np.sin(inc)
                y = -xs * np.sin(inc) + ys * np.cos(inc)
                ring = np.stack([le[0] + x, le[1] + y, np.full_like(x, le[2])], 1)
                if srf.vertical:
                    ring = np.stack([le[0] + x, np.full_like(x, le[1]), le[2] + y], 1)
                base = len(verts) * 0
                verts.append(ring)
                col = (0.85, 0.87, 0.9)
                if lifts is not None:
                    t = float(lifts[k])
                    col = (0.2 + 0.8 * t, 0.35 + 0.3 * (1 - abs(t - 0.5) * 2), 1.0 - 0.8 * t)
                cols.append(np.tile(col, (len(ring), 1)))
            k += 1
        m = len(sec)
        V = np.vstack(verts)
        F = []
        for s_i in range(0, len(verts), 2):
            o1, o2 = s_i * m, (s_i + 1) * m
            for j in range(m):
                j1 = (j + 1) % m
                F += [[o1 + j, o1 + j1, o2 + j], [o1 + j1, o2 + j1, o2 + j]]
        mesh = scene.mesh(srf.name, V, np.array(F), color=(1, 1, 1), double_sided=True,
                          vertex_colors=np.vstack(cols))
        scene.node(srf.name, mesh=mesh)
    return scene.save(path)


# ── wind tunnel: lattice Boltzmann ─────────────────────────────────────────

def _inside(poly: np.ndarray, X: np.ndarray, Y: np.ndarray) -> np.ndarray:
    inside = np.zeros(X.shape, dtype=bool)
    px, py = poly[:, 0], poly[:, 1]
    j = len(poly) - 1
    for i in range(len(poly)):
        cond = ((py[i] > Y) != (py[j] > Y)) & (X < (px[j] - px[i]) * (Y - py[i]) / (py[j] - py[i] + 1e-30) + px[i])
        inside ^= cond
        j = i
    return inside


def wind_tunnel(shape: np.ndarray, path: str, alpha_deg: float = 6.0, reynolds: float = 400.0,
                width: int = 360, height: int = 140, steps: int = 6000, frames: int = 60,
                show: str = "vorticity") -> dict:
    """Air flowing left to right past a 2D shape (an airfoil from `naca4`, a
    hull section, a car outline: any closed polygon, any size), as an
    animated GIF at `path`. The shape is scaled to a quarter of the tunnel
    length and turned by `alpha_deg` (nose up). Low Reynolds numbers only
    (≲ 1000): it shows how the flow behaves, not real-scale forces."""
    from PIL import Image

    poly = np.asarray(shape, dtype=float)
    poly = poly - poly.mean(axis=0)
    a = np.radians(-alpha_deg)
    poly = poly @ np.array([[np.cos(a), np.sin(a)], [-np.sin(a), np.cos(a)]])
    size = width / 4
    poly = poly / np.ptp(poly[:, 0]) * size
    poly = poly + [width / 3.5, height / 2]
    Y, X = np.mgrid[0:height, 0:width]
    solid = _inside(poly, X + 0.5, Y + 0.5)

    u0 = 0.08
    nu = u0 * size / reynolds
    tau = max(3 * nu + 0.5, 0.505)
    omega = 1 / tau
    c = np.array([[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]])
    w = np.array([4 / 9] + [1 / 9] * 4 + [1 / 36] * 4)
    opp = [0, 3, 4, 1, 2, 7, 8, 5, 6]

    def equilibrium(rho, ux, uy):
        cu = 3 * (c[:, 0, None, None] * ux + c[:, 1, None, None] * uy)
        usq = 1.5 * (ux * ux + uy * uy)
        return rho * w[:, None, None] * (1 + cu + 0.5 * cu * cu - usq)

    rho = np.ones((height, width))
    ux = np.full((height, width), u0)
    uy = np.zeros((height, width))
    uy[height // 2:height // 2 + 2, :width // 5] = 1e-3     # break the symmetry
    f = equilibrium(rho, ux, uy)
    inlet = equilibrium(np.ones((height, 1)), np.full((height, 1), u0), np.zeros((height, 1)))

    images = []
    every = max(1, steps // frames)
    vmax = None
    for step in range(steps):
        f[:, :, -1] = f[:, :, -2]                    # outflow
        rho = f.sum(axis=0)
        ux = (f * c[:, 0, None, None]).sum(axis=0) / rho
        uy = (f * c[:, 1, None, None]).sum(axis=0) / rho
        ux[:, 0], uy[:, 0], rho[:, 0] = u0, 0.0, 1.0
        feq = equilibrium(rho, ux, uy)
        f += omega * (feq - f)
        f[:, :, :1] = inlet
        bounced = f[:, solid][opp]
        for i in range(9):
            f[i] = np.roll(np.roll(f[i], c[i, 0], axis=1), c[i, 1], axis=0)
        f[:, solid] = bounced
        if step % every == 0 and step > steps * 0.2:
            if show == "speed":
                field = np.hypot(ux, uy) / u0
                lo, hi = 0.0, 1.6
                t = np.clip((field - lo) / (hi - lo), 0, 1)
                rgb = np.stack([t ** 0.8, 0.3 + 0.6 * t * (1 - t) * 4 * 0.5, 1 - t], -1)
            else:
                vort = (np.roll(uy, -1, 1) - np.roll(uy, 1, 1)) - (np.roll(ux, -1, 0) - np.roll(ux, 1, 0))
                if vmax is None:
                    vmax = np.percentile(np.abs(vort[~solid]), 99) or 1e-6
                t = np.clip(vort / vmax, -1, 1)
                white = 1 - np.abs(t)
                rgb = np.stack([np.where(t > 0, 1, white), white, np.where(t < 0, 1, white)], -1)
                rgb = 0.15 + 0.85 * rgb
            rgb[solid] = [0.2, 0.22, 0.27]
            img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)[::-1])
            images.append(img.resize((width * 2, height * 2), Image.NEAREST))
    if not images:
        raise ValueError("not enough steps for any frames")
    images[0].save(path, save_all=True, append_images=images[1:], duration=60, loop=0, optimize=True)
    return {"path": path, "frames": len(images), "reynolds": reynolds, "tau": tau, "alpha_deg": alpha_deg}
