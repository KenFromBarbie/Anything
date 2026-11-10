"""A small boat: does it float, how stable is it, how does it move in waves.
Run: python boat.py [out folder]. Swap example_hull for mesh.load("your.glb")."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from simkit import hydro  # noqa: E402
from simkit.report import Report  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(out, exist_ok=True)
v, f = hydro.example_hull(length=4.0, beam=1.2, depth=0.6)
boat = hydro.Boat(v, f, mass=400, cg=(0.0, 0.35, 0.0), rho=hydro.RHO_FRESH)
eq = boat.float()
gz = boat.gz_curve(range(0, 91, 5))
run = boat.waves(height=0.4, period=2.5, heading="beam", seconds=24)
boat.save_glb(os.path.join(out, "boat_in_waves.glb"), run)

r = Report("Small boat — stability and seakeeping", "4.0 m hull, 400 kg loaded, fresh water")
r.numbers({
    "Draft": f"{eq['draft_m']:.2f} m", "Freeboard": f"{eq['freeboard_m']:.2f} m",
    "GM": f"{eq['GM_m']:.2f} m", "Roll period": f"{eq['roll_period_s']:.1f} s",
    "Max roll in waves": f"{run.stats['max_roll_deg']:.0f}°",
    "Vanishing stability": f"{gz['vanishing_stability_deg']:.0f}°" if gz["vanishing_stability_deg"] else "> 90°",
})
r.chart("Righting lever (GZ)", gz["heel_deg"], {"GZ": gz["gz_m"]}, x_label="Heel (°)", y_label="m")
r.chart("Motion in 0.4 m beam waves, 2.5 s period", run.t,
        {"Roll (°)": [x * 57.2958 for x in run.roll], "Heave (cm)": [x * 100 for x in run.heave]},
        x_label="Time (s)")
r.note("Exact hydrostatics of the hull mesh; motions from a linear heave/pitch and nonlinear roll "
       "model in regular deep-water waves with estimated added mass and damping. Not CFD.")
r.save(os.path.join(out, "boat_report.html"))
print(os.path.join(out, "boat_report.html"))
