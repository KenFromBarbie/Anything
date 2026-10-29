#!/usr/bin/env python3
"""Zip a folder as a downloadable app component, with its .sha256 beside it.

    python scripts/zip-component.py <folder> <out.zip>

Entries are relative to <folder> and keep their Unix permissions, so the
runtime and the servers' programs stay executable when the app unpacks them
(desktop/src-tauri/src/components.rs). Works the same on Windows, macOS and
Linux runners (no zip tool needed).
"""
import hashlib
import os
import sys
import zipfile


def main() -> None:
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for base, dirs, files in os.walk(src):
            dirs.sort()
            for name in sorted(files):
                path = os.path.join(base, name)
                if os.path.islink(path):
                    continue
                rel = os.path.relpath(path, src).replace(os.sep, "/")
                # ZipInfo.from_file records the mode (st_mode << 16).
                info = zipfile.ZipInfo.from_file(path, rel)
                info.compress_type = zipfile.ZIP_DEFLATED
                with open(path, "rb") as f:
                    z.writestr(info, f.read(), compresslevel=9)
    digest = hashlib.sha256()
    with open(out, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    with open(out + ".sha256", "w", newline="\n") as f:
        f.write(f"{digest.hexdigest()}  {os.path.basename(out)}\n")
    print(f"{out}: {os.path.getsize(out) / 1048576:.1f} MB")


if __name__ == "__main__":
    main()
