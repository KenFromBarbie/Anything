"""A light aircraft: lift, drag, speeds, stability, and the airflow.
Run: python aircraft.py [out folder]."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from simkit import aero  # noqa: E402
from simkit.report import Report  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(out, exist_ok=True)
wing = aero.Surface("wing", span=10, root_chord=1.6, tip_chord=0.8, airfoil="2412", dihedral_deg=4, twist_deg=-2)
tail = aero.Surface("tail", span=3, root_chord=0.8, tip_chord=0.5, airfoil="0012", root=(4.5, 0.3, 0),
                    incidence_deg=-2, panels=10)
fin = aero.Surface("fin", span=1.2, root_chord=0.9, tip_chord=0.5, airfoil="0012", root=(4.4, 0.3, 0),
                   vertical=True, symmetric=False, sweep_deg=30, panels=8)
parts = [wing, tail, fin]
cruise = aero.vlm(parts, alpha_deg=3, speed=50, cg=(0.45, 0, 0))
polar = aero.aircraft_polar(parts, mass=750, cg=(0.45, 0, 0))
aero.surfaces_glb(os.path.join(out, "aircraft.glb"), parts, extra=cruise)
fast = "--quick" in sys.argv
aero.wind_tunnel(aero.naca4("2412"), os.path.join(out, "airflow.gif"), alpha_deg=8,
                 steps=1500 if fast else 4000, frames=30)

rows = polar["rows"]
r = Report("Light aircraft — aerodynamics", "750 kg, 10 m span, NACA 2412 wing")
r.numbers({
    "Stall speed": f"{polar['stall_speed_ms'] * 3.6:.0f} km/h", "Best glide": f"{polar['best_glide_speed_ms'] * 3.6:.0f} km/h",
    "Max L/D": f"{polar['max_L_over_D']:.1f}", "Static margin": f"{polar['static_margin_pct_mac']:.0f} % MAC",
    "Span efficiency": f"{cruise['span_efficiency']:.2f}",
})
r.chart("Power to fly level", [x["speed_ms"] * 3.6 for x in rows], {"Power (kW)": [x["power_W"] / 1000 for x in rows]},
        x_label="Speed (km/h)", zero_line=False)
r.chart("Lift across the span at 3°", [s["z"] for s in cruise["strips"] if s["surface"] == "wing"],
        {"Lift (N/m)": [s["lift_per_m"] for s in cruise["strips"] if s["surface"] == "wing"]}, x_label="Span position (m)")
r.image("Airflow past the wing section at 8° (vorticity)", os.path.join(out, "airflow.gif"))
r.note("Vortex-lattice potential flow plus a parasite-drag estimate; no stall modelling beyond CLmax 1.4. "
       "The airflow picture is a low-Reynolds 2D lattice-Boltzmann simulation, for seeing the flow, not for numbers.")
r.save(os.path.join(out, "aircraft_report.html"))
print(os.path.join(out, "aircraft_report.html"))
