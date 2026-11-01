"""Convert the Blender bake buffers (.npy, written by tools/blender/monument_v3_build.py)
into game textures.

  /opt/dushanbe-venv/bin/python -I tools/textures/convert_monument_bakes.py <bake_dir>

bake_<atlas>.png : RGB8 linear data (R = AO 4 m, G = local AO/cavity 0.25 m, B = convexity)
lions_normal.png : RGB8 tangent-space normal map (OpenGL / glTF convention, MikkTSpace)
Rows are flipped (Blender image origin is bottom-left, PNG/Godot top-left).
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "textures" / "monument_v3"
src = Path(sys.argv[1])
for f in sorted(src.glob("*.npy")):
    a = np.load(f).astype(np.float32) / 65535.0
    a = a[::-1]
    name = f.stem if f.stem.endswith("normal") else "bake_" + f.stem.replace("_bake", "")
    img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), "RGB")
    img.save(OUT / f"{name}.png", optimize=True)
    print(name, img.size, "mean", (a.reshape(-1, 3).mean(0)).round(3).tolist())
