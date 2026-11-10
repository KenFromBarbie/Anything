"""A T-shirt in two sizes: patterns, drape and fit. Run: python garment.py [out folder]."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
from simkit import cloth  # noqa: E402
from simkit.report import Report  # noqa: E402

out = sys.argv[1] if len(sys.argv) > 1 else "."
os.makedirs(out, exist_ok=True)
body = cloth.Body(height=172, chest=96, waist=80, hip=100)
r = Report("T-shirt — pattern and fit", "Body 172 cm, chest 96, waist 80, hip 100 · cotton jersey")
rows = []
for label, ease in (("Regular", 10), ("Slim", 2)):
    shirt = cloth.tshirt(body, ease=ease, length=70, sleeve=22)
    shirt.save_svg(os.path.join(out, f"tshirt_{label.lower()}_pattern.svg"))
    d = cloth.drape(body, shirt, fabric="jersey")
    d.save_glb(os.path.join(out, f"tshirt_{label.lower()}_fit.glb"))
    b = d.fit["pieces"]["body"]
    rows.append([label, ease, b["max_stretch_pct"], b["tight_area_pct"], b["hem_height_cm"], d.fit["verdict"]])
r.table(["Fit", "Ease (cm)", "Max stretch %", "Tight area %", "Hem height (cm)", "Verdict"], rows)
r.note("Draped with position-based dynamics: body and sleeves are tubes held at their seams. "
       "Red in the 3D view is fabric pulled tight, blue hangs loose.")
r.save(os.path.join(out, "tshirt_report.html"))
print(os.path.join(out, "tshirt_report.html"))
