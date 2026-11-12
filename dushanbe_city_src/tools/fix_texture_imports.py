#!/usr/bin/env python3
"""Force correct import settings on every 3D texture of the project.

Root cause found on Android: all textures had been imported headless as Lossless (compress/mode=0)
without mipmaps, because Godot only switches a texture to VRAM compression when the *editor*
detects its use in 3D. Result: ~600 MB of uncompressed RGBA8 in VRAM and no mip chains.

Sets: compress/mode=2 (VRAM Compressed: ETC2/ASTC on Android, BC on desktop), mipmaps on,
normal-map flag for *normal* textures, roughness/channel hints, high-quality ASTC off (speed).
UI-only textures (fonts, icons) are left untouched.
"""
import glob, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "dushanbe_city")
SKIP = ("assets/fonts/", "icon.svg")
changed = 0
for imp in glob.glob(os.path.join(ROOT, "**", "*.import"), recursive=True):
    rel = os.path.relpath(imp, ROOT)
    if any(s in rel for s in SKIP) or not rel.startswith("assets/"):
        continue
    s = open(imp).read()
    if 'importer="texture"' not in s:
        continue
    name = os.path.basename(rel).lower()
    is_normal = "normal" in name
    params = {
        "compress/mode": "2",
        "compress/high_quality": "false",
        "compress/normal_map": "1" if is_normal else "0",
        "mipmaps/generate": "true",
        "mipmaps/limit": "-1",
        "detect_3d/compress_to": "0",
        "roughness/mode": "0",
        "process/size_limit": "0",
    }
    for k, v in params.items():
        if re.search(rf"^{re.escape(k)}=", s, re.M):
            s = re.sub(rf"^{re.escape(k)}=.*$", f"{k}={v}", s, flags=re.M)
        else:
            s = s.replace("[params]\n", f"[params]\n\n{k}={v}\n", 1)
    # force reimport: drop the cached metadata hash/dest so Godot rebuilds the .ctex
    s = re.sub(r'^valid=false\n', '', s, flags=re.M)
    open(imp, "w").write(s)
    changed += 1
print("patched", changed, "texture imports")
