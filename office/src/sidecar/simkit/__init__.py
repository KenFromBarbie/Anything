"""simkit: the Office's 3D, clothing and simulation kit (numpy only; Pillow
for the wind tunnel's GIF). Read README.md next to this file first.

    import sys; sys.path.insert(0, r"<hive>/tools")
    from simkit import mesh, glb, hydro, aero, cloth, report
"""

__version__ = "1.0.0"

from . import aero, cloth, glb, hydro, mesh, report  # noqa: E402,F401
