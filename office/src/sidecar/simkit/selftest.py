"""Checks the kit against answers known by hand. Run: python -m simkit.selftest
(from the folder that holds simkit). Prints OK or the first failure."""
import math
import os
import sys
import tempfile

import numpy as np

from . import aero, cloth, glb, hydro, mesh


def close(name, got, want, tol):
    if abs(got - want) > tol:
        raise AssertionError(f"{name}: got {got:.4f}, want {want:.4f} ± {tol}")


def main():
    # box barge 4 × 1 × 1 m, 1000 kg in fresh water: draft 0.25, KB 0.125, BM 1/3
    v, f = mesh.box((4, 1, 1), center=(0, 0.5, 0))
    b = hydro.Boat(v, f, mass=1000, cg=(0, 0.3, 0))
    eq = b.float()
    close("box draft", eq["draft_m"], 0.25, 1e-4)
    close("box KB", eq["KB_m"], 0.125, 1e-4)
    close("box BM", eq["BM_m"], 1 / 3, 1e-4)
    close("box GZ 5°", b.gz(5), (0.125 + 1 / 3 - 0.3) * math.sin(math.radians(5)), 2e-3)
    # NACA 0012 at 5°: panel-method lift ≈ 0.60 (thin airfoil 0.548)
    close("0012 cl", aero.airfoil(aero.naca4("0012"), 5).cl, 0.60, 0.03)
    close("2412 zero-lift angle", aero.zero_lift_angle("2412"), -2.08, 0.1)
    # rectangular wing AR 8: CLα ≈ 0.081/deg, span efficiency ≈ 0.95–0.98
    r = aero.vlm([aero.Surface(span=8, root_chord=1, tip_chord=1, airfoil="0012", panels=20)], 5, 30)
    close("AR8 CL/deg", r["CL"] / 5, 0.081, 0.004)
    close("AR8 e", r["span_efficiency"], 0.965, 0.02)
    # a T-shirt with ease hangs to its length and fits; one 6 cm too small is tight
    body = cloth.Body(height=172, chest=96, waist=80, hip=100)
    ok = cloth.drape(body, cloth.tshirt(body, ease=10), frames=80)
    close("shirt hem", ok.fit["pieces"]["body"]["hem_height_cm"], body.y["shoulder"] + 1 - 0.41 * 172, 4)
    if ok.fit["pieces"]["body"]["max_stretch_pct"] > 4:
        raise AssertionError("a shirt with 10 cm ease shouldn't stretch")
    tight = cloth.drape(body, cloth.tshirt(body, ease=-6), frames=80)
    if tight.fit["verdict"] != "too tight: size up or add ease":
        raise AssertionError("a shirt 6 cm too small should read as too tight")
    # GLB round trip
    with tempfile.TemporaryDirectory() as d:
        s = glb.Scene()
        s.node("box", mesh=s.mesh("box", v, f))
        path = s.save(os.path.join(d, "box.glb"))
        v2, _ = glb.read_glb_mesh(path)
        close("glb round trip", float(np.abs(v2 - v).max()), 0.0, 1e-5)
    print("OK")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as e:
        print("FAIL", e)
        sys.exit(1)
