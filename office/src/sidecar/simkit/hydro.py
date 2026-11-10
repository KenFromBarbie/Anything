"""Boats on water: hydrostatics, stability and motion in waves, from a hull
mesh (closed, metres, Y up, X along the length, Z across the beam).

    from simkit import hydro, mesh
    v, f = mesh.load("hull.glb")
    boat = hydro.Boat(v, f, mass=180, cg=(0.0, 0.35, 0.0))
    eq = boat.float()                  # draft, freeboard, GM, trim
    gz = boat.gz_curve(range(0, 91, 5))   # righting lever vs heel
    run = boat.waves(height=0.4, period=3.0, heading="beam", seconds=30)
    boat.save_glb("boat_in_waves.glb", run)   # animated: the app plays it

What it is: exact hydrostatics of the mesh (volume, centre of buoyancy,
waterplane) at any heel, the classic stability numbers (GM, GZ curve, angle of
vanishing stability), and a time-domain heave / roll / pitch model in regular
deep-water waves (linear restoring from the waterplane, nonlinear roll from
the GZ curve, added mass and damping as fractions). It is an engineering
estimate, not CFD: say so when you report, and give the assumptions.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .mesh import is_watertight, volume_centroid

G = 9.81
RHO_SEA = 1025.0
RHO_FRESH = 1000.0


@dataclass
class Section:
    """What is under water at one draft (in the mesh's own frame)."""
    draft: float          # waterline height y
    volume: float         # m³
    cb: np.ndarray        # centre of buoyancy (x, y, z)
    awp: float            # waterplane area m²
    cf: np.ndarray        # centre of flotation (x, z)
    it: float             # waterplane 2nd moment about the length axis (roll) m⁴
    il: float             # … about the beam axis (pitch) m⁴


def _clip_below(tri: np.ndarray, g: np.ndarray):
    """The part of a triangle with g <= 0, as a polygon, plus the cut segment
    (exit point → entry point, in polygon order) if the plane crosses it."""
    out = []
    gs = []
    seg_exit = seg_enter = None
    for i in range(3):
        a, b = tri[i], tri[(i + 1) % 3]
        ga, gb = g[i], g[(i + 1) % 3]
        if ga <= 0:
            out.append(a)
            gs.append(ga)
        if (ga <= 0) != (gb <= 0):
            t = ga / (ga - gb)
            p = a + t * (b - a)
            out.append(p)
            gs.append(0.0)
            if ga <= 0:
                seg_exit = p
            else:
                seg_enter = p
    seg = (seg_exit, seg_enter) if seg_exit is not None and seg_enter is not None else None
    return out, gs, seg


def section(v: np.ndarray, f: np.ndarray, draft: float) -> Section:
    """Exact submerged volume, centre of buoyancy and waterplane at a draft.

    Uses the divergence theorem with fields that vanish on the waterline, so
    the (unknown) waterplane cap needs no triangles of its own."""
    tri = v[f]
    g = tri[:, :, 1] - draft
    below = (g <= 0).all(axis=1)
    cross = (g <= 0).any(axis=1) & ~below

    vol = mx = mz = my = 0.0

    def add(a, b, c, ga, gb, gc):
        nonlocal vol, mx, mz, my
        cy = ((b[..., 2] - a[..., 2]) * (c[..., 0] - a[..., 0]) - (b[..., 0] - a[..., 0]) * (c[..., 2] - a[..., 2]))
        half = cy / 2.0
        sg = ga + gb + gc
        vol += np.sum(half * sg / 3.0)
        for idx, acc in ((0, "x"), (2, "z")):
            fx = (a[..., idx], b[..., idx], c[..., idx])
            val = np.sum(half * (fx[0] * ga + fx[1] * gb + fx[2] * gc + (fx[0] + fx[1] + fx[2]) * sg) / 12.0)
            if acc == "x":
                mx += val
            else:
                mz += val
        my += np.sum(half * 0.5 * (ga * ga + gb * gb + gc * gc + sg * sg) / 12.0)

    if below.any():
        t = tri[below]
        gg = g[below]
        add(t[:, 0], t[:, 1], t[:, 2], gg[:, 0], gg[:, 1], gg[:, 2])

    segs = []
    for t, gg in zip(tri[cross], g[cross]):
        poly, gs, seg = _clip_below(t, gg)
        for k in range(1, len(poly) - 1):
            add(poly[0][None], poly[k][None], poly[k + 1][None],
                np.array([gs[0]]), np.array([gs[k]]), np.array([gs[k + 1]]))
        if seg:
            segs.append(seg)

    if vol <= 1e-12:
        return Section(draft, 0.0, np.array([0.0, draft, 0.0]), 0.0, np.zeros(2), 0.0, 0.0)
    cb = np.array([mx / vol, draft + my / vol, mz / vol])

    # Waterplane from the cut segments (Green's theorem in the x–z plane).
    awp = 0.0
    cf = np.zeros(2)
    it = il = 0.0
    if segs:
        p = np.array([s[0] for s in segs])
        q = np.array([s[1] for s in segs])
        xp, zp, xq, zq = p[:, 0], p[:, 2], q[:, 0], q[:, 2]
        cr = xp * zq - xq * zp
        a = cr.sum() / 2.0
        if abs(a) > 1e-12:
            sx = ((xp + xq) * cr).sum() / 6.0
            sz = ((zp + zq) * cr).sum() / 6.0
            izz = (cr * (zp * zp + zp * zq + zq * zq)).sum() / 12.0
            ixx = (cr * (xp * xp + xp * xq + xq * xq)).sum() / 12.0
            cx, cz = sx / a, sz / a
            awp = abs(a)
            cf = np.array([cx, cz])
            it = abs(izz - a * cz * cz)
            il = abs(ixx - a * cx * cx)
    return Section(draft, float(vol), cb, float(awp), cf, float(it), float(il))


def rotate_x(v: np.ndarray, angle: float, about: np.ndarray) -> np.ndarray:
    """Heel: rotate about the length (X) axis through `about`."""
    c, s = np.cos(angle), np.sin(angle)
    p = v - about
    return np.stack([p[:, 0], p[:, 1] * c - p[:, 2] * s, p[:, 1] * s + p[:, 2] * c], axis=1) + about


@dataclass
class WaveRun:
    t: np.ndarray
    heave: np.ndarray       # m, + up, about the calm floating position
    roll: np.ndarray        # rad
    pitch: np.ndarray       # rad
    eta: np.ndarray         # wave height at the boat, m
    height: float
    period: float
    heading: str
    wavelength: float
    stats: dict = field(default_factory=dict)


class Boat:
    """A hull mesh with a mass and centre of gravity, in water."""

    def __init__(self, vertices, faces, mass: float, cg=None, rho: float = RHO_FRESH,
                 roll_radius: float | None = None, pitch_radius: float | None = None):
        self.v = np.asarray(vertices, dtype=float)
        self.f = np.asarray(faces, dtype=np.int64)
        if not is_watertight(self.f):
            raise ValueError("the hull mesh isn't closed (watertight); volumes would be wrong. "
                             "Close it (cap open ends, weld vertices) first.")
        self.mass = float(mass)
        self.rho = float(rho)
        vol, centroid = volume_centroid(self.v, self.f)
        self.total_volume = vol
        lo, hi = self.v.min(axis=0), self.v.max(axis=0)
        self.length = float(hi[0] - lo[0])
        self.beam = float(hi[2] - lo[2])
        self.depth = float(hi[1] - lo[1])
        self.cg = np.asarray(cg if cg is not None else [centroid[0], lo[1] + 0.4 * self.depth, centroid[2]], dtype=float)
        self.kxx = roll_radius or 0.35 * self.beam
        self.kzz = pitch_radius or 0.25 * self.length

    # ── statics ─────────────────────────────────────────────────────────
    def _draft_for(self, v: np.ndarray) -> Section:
        need = self.mass / self.rho
        lo, hi = v[:, 1].min(), v[:, 1].max()
        if need >= self.total_volume:
            raise ValueError(f"it sinks: {self.mass:.0f} kg needs {need:.3f} m³ of displacement, "
                             f"the hull only has {self.total_volume:.3f} m³")
        a, b = lo, hi
        for _ in range(60):
            mid = (a + b) / 2
            if section(v, self.f, mid).volume < need:
                a = mid
            else:
                b = mid
        return section(v, self.f, (a + b) / 2)

    def float(self) -> dict:
        """Upright floating condition and initial stability."""
        s = self._draft_for(self.v)
        self.eq = s
        kb = s.cb[1]
        bm_t = s.it / s.volume
        bm_l = s.il / s.volume
        gm_t = kb + bm_t - self.cg[1]
        gm_l = kb + bm_l - self.cg[1]
        lo = self.v[:, 1].min()
        # trim from the lengthwise offset of G and B (small angle)
        trim = (self.cg[0] - s.cb[0]) / gm_l if gm_l > 0 else float("nan")
        return {
            "displacement_kg": self.mass,
            "volume_m3": s.volume,
            "draft_m": float(s.draft - lo),
            "waterline_y": float(s.draft),
            "freeboard_m": float(self.v[:, 1].max() - s.draft),
            "reserve_buoyancy_pct": float(100 * (self.total_volume - s.volume) / s.volume),
            "waterplane_area_m2": s.awp,
            "centre_of_buoyancy": s.cb.tolist(),
            "centre_of_flotation_x": float(s.cf[0]),
            "KB_m": float(kb - lo),
            "KG_m": float(self.cg[1] - lo),
            "BM_m": bm_t,
            "GM_m": float(gm_t),
            "GM_long_m": float(gm_l),
            "trim_deg_bow_down": float(np.degrees(trim)),
            "tons_per_cm_kg": float(self.rho * s.awp * 0.01),
            "heave_period_s": float(2 * np.pi * np.sqrt(self.mass * 1.8 / (self.rho * G * s.awp))) if s.awp else None,
            "roll_period_s": float(2 * np.pi * self.kxx * 1.1 / np.sqrt(G * gm_t)) if gm_t > 0 else None,
            "stable": bool(gm_t > 0),
        }

    def gz(self, heel_deg: float) -> float:
        """Righting lever (m) at a heel angle: + rights the boat, − capsizes it."""
        phi = np.radians(heel_deg)
        v = rotate_x(self.v, phi, self.cg)
        s = self._draft_for(v)
        return float(s.cb[2] - self.cg[2])

    def gz_curve(self, heels=range(0, 91, 5)) -> dict:
        heels = [float(h) for h in heels]
        gz = [self.gz(h) for h in heels]
        vanish = None
        for (h0, g0), (h1, g1) in zip(zip(heels, gz), zip(heels[1:], gz[1:])):
            if g0 > 0 >= g1:
                vanish = h0 + (h1 - h0) * g0 / (g0 - g1)
                break
        i = int(np.argmax(gz))
        arr = np.radians(heels)
        area = float(np.trapezoid(np.maximum(gz, 0), arr)) if hasattr(np, "trapezoid") else float(np.trapz(np.maximum(gz, 0), arr))
        return {
            "heel_deg": heels,
            "gz_m": gz,
            "righting_moment_Nm": [g * self.mass * G for g in gz],
            "max_gz_m": gz[i],
            "max_gz_at_deg": heels[i],
            "vanishing_stability_deg": vanish,
            "area_m_rad": area,
        }

    # ── dynamics ────────────────────────────────────────────────────────
    def waves(self, height: float = 0.3, period: float = 3.0, heading: str = "beam",
              seconds: float = 30.0, dt: float | None = None, heave_damping: float = 0.2,
              roll_damping: float = 0.08, pitch_damping: float = 0.2) -> WaveRun:
        """Heave, roll and pitch in regular deep-water waves.

        heading: "beam" (waves from the side: roll), "head" (from ahead:
        pitch), "quartering" (45°: both). Damping is a fraction of critical."""
        if not hasattr(self, "eq"):
            self.float()
        s = self.eq
        omega = 2 * np.pi / period
        k = omega * omega / G
        wavelength = 2 * np.pi / k
        amp = height / 2
        beta = {"head": 0.0, "beam": np.pi / 2, "quartering": np.pi / 4}.get(heading, np.pi / 2)
        draft = s.draft - self.v[:, 1].min()
        smith = np.exp(-k * draft / 2)  # waves act less deep down
        # long boats ride over short waves: average the slope over the length/beam
        def avg(span):
            x = k * span / 2
            return np.sinc(x / np.pi) if x > 1e-9 else 1.0
        slope_roll = np.sin(beta) * avg(self.beam * np.sin(beta))
        slope_pitch = np.cos(beta) * avg(self.length * np.cos(beta))

        m_heave = self.mass * 1.8          # + added mass
        c_heave = self.rho * G * s.awp
        i_roll = self.mass * self.kxx ** 2 * 1.2
        i_pitch = self.mass * self.kzz ** 2 * 1.8
        gm_l = s.cb[1] + s.il / s.volume - self.cg[1]

        heels = np.linspace(-80, 80, 33)
        gz_tab = np.array([np.sign(h) * self.gz(abs(h)) if h else 0.0 for h in heels])

        def gz_of(phi):
            return np.interp(np.degrees(phi), heels, gz_tab)

        gm_t = max(float(np.gradient(gz_tab, np.radians(heels))[16]), 1e-4)
        b_heave = 2 * heave_damping * np.sqrt(c_heave * m_heave)
        b_roll = 2 * roll_damping * np.sqrt(self.mass * G * gm_t * i_roll)
        b_pitch = 2 * pitch_damping * np.sqrt(self.mass * G * max(gm_l, 1e-3) * i_pitch)

        dt = dt or min(period, 2 * np.pi * np.sqrt(m_heave / c_heave)) / 80
        n = int(seconds / dt) + 1
        t = np.arange(n) * dt
        eta = amp * np.sin(omega * t)
        ramp = np.minimum(t / (2 * period), 1.0)   # start gently
        state = np.zeros(6)  # z, z', phi, phi', theta, theta'

        def deriv(tt, y):
            r = min(tt / (2 * period), 1.0)
            e = r * amp * np.sin(omega * tt)
            slope = r * k * amp * np.cos(omega * tt)
            z, zd, ph, phd, th, thd = y
            zdd = (c_heave * (smith * e - z) - b_heave * zd) / m_heave
            m_wave_roll = self.mass * G * gm_t * slope * slope_roll
            phdd = (m_wave_roll - self.mass * G * gz_of(ph) - b_roll * phd) / i_roll
            m_wave_pitch = self.mass * G * gm_l * slope * slope_pitch
            thdd = (m_wave_pitch - self.mass * G * gm_l * np.sin(th) - b_pitch * thd) / i_pitch
            return np.array([zd, zdd, phd, phdd, thd, thdd])

        out = np.zeros((n, 6))
        for i in range(n):
            out[i] = state
            tt = t[i]
            k1 = deriv(tt, state)
            k2 = deriv(tt + dt / 2, state + dt / 2 * k1)
            k3 = deriv(tt + dt / 2, state + dt / 2 * k2)
            k4 = deriv(tt + dt, state + dt * k3)
            state = state + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
        eta = eta * ramp
        settle = t > min(seconds / 2, 4 * period)
        heave, roll, pitch = out[:, 0], out[:, 2], out[:, 4]
        acc = np.gradient(out[:, 1], t)
        run = WaveRun(t, heave, roll, pitch, eta, height, period, heading, wavelength)
        run.stats = {
            "wavelength_m": float(wavelength),
            "max_heave_m": float(np.abs(heave[settle]).max()),
            "max_roll_deg": float(np.degrees(np.abs(roll[settle]).max())),
            "max_pitch_deg": float(np.degrees(np.abs(pitch[settle]).max())),
            "max_vertical_accel_g": float(np.abs(acc[settle]).max() / G),
            "capsized": bool(np.degrees(np.abs(roll)).max() > 75),
            "min_freeboard_m": float(self.v[:, 1].max() - self.eq.draft - np.abs(heave - eta * smith).max()
                                     - self.beam / 2 * np.sin(np.abs(roll).max())),
        }
        return run

    # ── output ──────────────────────────────────────────────────────────
    def save_glb(self, path: str, run: WaveRun | None = None, hull_color=(0.92, 0.93, 0.95),
                 water_size: float | None = None, frames_per_wave: int = 16) -> str:
        """The boat floating at its waterline (y = 0), on animated waves when
        given a run. Rotations are about the centre of gravity."""
        from .glb import Scene, quat_from_euler
        from .mesh import grid

        if not hasattr(self, "eq"):
            self.float()
        shift = np.array([0.0, -self.eq.draft, 0.0])
        cg = self.cg + shift
        scene = Scene()
        hull = scene.mesh("hull", self.v + shift - cg, self.f, color=hull_color, roughness=0.45)
        boat = scene.node("boat", mesh=hull, translation=cg)

        size = water_size or max(self.length, self.beam) * 3
        n = 48
        wv, wf = grid(size, size, n, n)
        if run is None:
            scene.mesh("water", wv, wf, color=(0.12, 0.42, 0.62), alpha=0.75, double_sided=True)
            scene.node("water", mesh=len(scene.gltf["meshes"]) - 1)
            return scene.save(path)

        omega = 2 * np.pi / run.period
        k = 2 * np.pi / run.wavelength
        beta = {"head": 0.0, "beam": np.pi / 2, "quartering": np.pi / 4}.get(run.heading, np.pi / 2)
        amp = run.height / 2
        dirx, dirz = np.cos(beta), np.sin(beta)
        targets = []
        for i in range(frames_per_wave):
            phase = 2 * np.pi * i / frames_per_wave
            shape = wv.copy()
            shape[:, 1] = amp * np.sin(phase - k * (wv[:, 0] * dirx + wv[:, 2] * dirz))
            targets.append(shape)
        water_mesh = scene.mesh("water", wv, wf, color=(0.12, 0.42, 0.62), alpha=0.75,
                                double_sided=True, roughness=0.15, morph_targets=targets)
        water = scene.node("water", mesh=water_mesh)

        # sample the run at ~20 fps for the animation
        step = max(1, int(round((1 / 20) / (run.t[1] - run.t[0]))))
        idx = np.arange(0, len(run.t), step)
        t = run.t[idx]
        translation = np.repeat(cg[None], len(idx), axis=0)
        translation[:, 1] += run.heave[idx]
        quat = quat_from_euler(run.roll[idx], run.pitch[idx], np.zeros(len(idx)))
        scene.animate(boat, t, translation=translation, rotation=quat)

        # waves: blend between the two nearest phase shapes
        phase = (omega * t / (2 * np.pi) * frames_per_wave) % frames_per_wave
        lo = np.floor(phase).astype(int) % frames_per_wave
        hi = (lo + 1) % frames_per_wave
        frac = phase - np.floor(phase)
        ramp = np.minimum(t / (2 * run.period), 1.0)
        w = np.zeros((len(t), frames_per_wave))
        w[np.arange(len(t)), lo] += (1 - frac) * ramp
        w[np.arange(len(t)), hi] += frac * ramp
        scene.animate_shapes(water, t, w)
        return scene.save(path)


def example_hull(length=4.0, beam=1.2, depth=0.6, stations=24, points=24, flare=0.15):
    """A simple round-bilge displacement hull (pointed bow and stern), for
    trying things out or as a starting point."""
    from .mesh import loft

    sections = []
    for i in range(stations + 1):
        x = -length / 2 + length * i / stations
        s = 1 - (2 * x / length) ** 2       # fullness along the length
        half = max(beam / 2 * s ** 0.6, 1e-3)
        d = depth * (0.35 + 0.65 * s ** 0.4)
        ring = []
        for j in range(points):
            a = 2 * np.pi * j / points
            ca, sa = np.cos(a), np.sin(a)
            if sa >= 0:   # deck: flat at the top
                z = half * (1 + flare) * ca
                y = depth * 0.55
            else:         # bottom: rounded
                z = half * np.sign(ca) * np.abs(ca) ** 0.7 * (1 + flare * (1 + sa))
                y = depth * 0.55 + d * sa
            ring.append([x, y, z])
        sections.append(ring)
    v, f = loft(sections)
    v[:, 1] -= v[:, 1].min()
    return v, f
