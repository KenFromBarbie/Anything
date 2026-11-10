# simkit — 3D, clothing and simulations for the Office

A Python kit (numpy; Pillow for GIFs) for making engineering-grade 3D work
the owner can look at in the app. Everything ends in files you publish with
`buzz-show`: an animated **.glb** (the app's 3D viewer plays animations), an
HTML **report** (charts, numbers, assumptions), a **GIF** of airflow, an
**SVG** sewing pattern.

Use it from your own scripts:

```python
import sys; sys.path.insert(0, r"<this folder's parent>")   # the hive's tools folder
from simkit import mesh, glb, hydro, aero, cloth, report
```

The `examples/` folder has one complete, runnable script per job. Copy one
into your own folder and change it; don't edit the kit itself.

## Which tool for what

| The owner wants | Use | Publish |
|---|---|---|
| A 3D model (product, part, prop) | `mesh` primitives + `loft`, `glb.Scene` | `.glb` |
| Something that moves (mechanism, assembly) | `glb.Scene.animate` (node keyframes) | `.glb` |
| A boat, float, pontoon, hull: does it float, is it stable, how does it move in waves | `hydro.Boat` | animated `.glb` + HTML report |
| A wing, plane, drone, glider, sail, fin: lift, drag, stability, speeds | `aero.vlm`, `aero.aircraft_polar`, `aero.airfoil_polar` | `.glb` coloured by lift + HTML report |
| To *see* airflow (wake, separation) | `aero.wind_tunnel` | `.gif` (in the report too) |
| Clothing: patterns and how they fit | `cloth.Body`, `cloth.tshirt` / `cloth.skirt` (or your own `Piece`s), `cloth.drape` | `.svg` pattern + animated `.glb` drape + fit report |
| A 3D-printable part | `mesh.save_stl` | `.stl` |

## Rules for honest engineering

- **Units**: SI (metres, kilograms, seconds) everywhere, except `cloth`, which
  works in centimetres like sewing patterns (its GLB output is in metres).
- **Y is up.** Boats: X along the length, Z across. Aircraft: X aft, Z span.
- **Say what the model is.** Each module's docstring lists its assumptions
  (potential flow doesn't stall; the wave model is linear with estimated
  damping; the drape is position-based dynamics). Put them in the report's
  `note`. Give numbers with sensible precision, never more digits than the
  method earns.
- **Check before you trust.** Compare against a case you know (a box hull's
  GM by hand, thin-airfoil lift 2π·α, the rider's own weight), and say if a
  result is outside the method's range (e.g. CL above ~1.4: stalled).
- **Hulls must be closed** (`mesh.is_watertight`); weld STL files
  (`mesh.load` does). A boat made for looks (open, thin shells) needs a
  closed version for hydrostatics.
- **Mass and centre of gravity matter more than anything else** for
  stability: get them from the parts (rider ~75–90 kg sits high), and show
  how sensitive the answer is (e.g. GM with the rider 10 cm higher).

## Boats — `hydro`

```python
from simkit import hydro, mesh
v, f = mesh.load("hull.glb")               # or hydro.example_hull(4.0, 1.2, 0.6)
boat = hydro.Boat(v, f, mass=180, cg=(0.0, 0.45, 0.0), rho=hydro.RHO_FRESH)
eq = boat.float()        # draft, freeboard, reserve buoyancy, KB, BM, GM, trim, roll period…
gz = boat.gz_curve(range(0, 91, 5))        # righting lever; max, vanishing angle, area
run = boat.waves(height=0.4, period=3.0, heading="beam", seconds=30)
run.stats                # max heave/roll/pitch, vertical acceleration, min freeboard, capsized
boat.save_glb("in_waves.glb", run)          # boat moving on animated waves
```

Multi-hull craft (catamarans, pontoon bikes): merge the floats into one mesh
(`mesh.merge`), they're handled as one hull. Good signs: GM well above 0.15 m
for small craft, reserve buoyancy above ~100 %, vanishing stability > 60°.

## Aircraft and wings — `aero`

```python
from simkit import aero
wing = aero.Surface("wing", span=10, root_chord=1.6, tip_chord=0.7, airfoil="2412", dihedral_deg=4, twist_deg=-2)
tail = aero.Surface("tail", span=3, root_chord=0.8, tip_chord=0.5, airfoil="0012", root=(4.5, 0.3, 0), incidence_deg=-2)
fin = aero.Surface("fin", span=1.2, root_chord=0.9, tip_chord=0.5, airfoil="0012", root=(4.4, 0.3, 0), vertical=True, symmetric=False, sweep_deg=30)
r = aero.vlm([wing, tail, fin], alpha_deg=4, speed=50)          # lift, induced drag, e, Cm, spanwise loading
p = aero.aircraft_polar([wing, tail, fin], mass=750, cg=(0.45, 0, 0))  # stall, best glide, L/D, static margin
aero.airfoil_polar("2412", range(-6, 15), speed=30, chord=1.4)  # section lift, drag estimate
aero.surfaces_glb("plane.glb", [wing, tail, fin], extra=r)      # 3D, coloured by lift
aero.wind_tunnel(aero.naca4("2412"), "flow.gif", alpha_deg=8)   # ~1 min; any closed 2D outline
```

Static margin 5–20 % of the mean chord is the usual stable range; negative is
unstable. The wind tunnel is low-Reynolds and qualitative.

## Clothing — `cloth`

```python
from simkit import cloth
body = cloth.Body(height=172, chest=96, waist=80, hip=100)     # cm; more measurements optional
g = cloth.tshirt(body, ease=10, length=70, sleeve=22)          # or cloth.skirt(body, length=55, flare=1.5)
g.save_svg("pattern.svg")              # 1:1, seam allowance, grain lines, 5 cm check square
d = cloth.drape(body, g, fabric="jersey")   # cotton, jersey, silk, denim, wool, linen, chiffon, or a dict
d.fit                                  # per piece: max stretch, tight area, touching, hem height, verdict
d.save_glb("fit.glb")                  # drape animation; red = tight, blue = loose
```

New garments: build `cloth.Piece`s (outlines in cm) for the pattern and a
`cloth.Garment` whose `tubes` describe how the sewn garment wraps the body
(`(name, y_top, y_bottom, [(t, circumference), …], "body" | "arm0" | "arm1")`).
Try several sizes or fabrics and compare their fit in one report.

## Reports — `report`

```python
from simkit.report import Report
r = Report("Boat Bike — stability", "Prototype v5 with a 85 kg rider")
r.numbers({"Draft": f"{eq['draft_m']:.2f} m", "GM": f"{eq['GM_m']:.2f} m"})
r.chart("Righting lever", gz["heel_deg"], {"GZ (m)": gz["gz_m"]}, x_label="Heel (°)", y_label="m")
r.image("Airflow at 8°", "flow.gif")
r.note("Assumptions: …")
r.save("stability.html")      # publish with buzz-show --file
```
