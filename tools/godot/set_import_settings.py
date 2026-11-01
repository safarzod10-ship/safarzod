"""Force correct texture import settings for 3D/mobile (idempotent).
  python3 -I tools/godot/set_import_settings.py   (then: godot --headless --import)
VRAM compression (ETC2/ASTC on Android) + mipmaps for every 3D texture; normal maps
flagged as such (RGTC/ASTC normal packing); the splat map stays lossless."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
changed = 0
for imp in ROOT.glob("assets/**/*.png.import"):
    src = imp.name[:-len(".import")]
    t = imp.read_text()
    if "icon.svg" in src:
        continue
    want = {"compress/mode": "2", "mipmaps/generate": "true", "detect_3d/compress_to": "0"}
    if src.endswith("_normal.png"):
        want["compress/normal_map"] = "1"
    if "splat" in src:
        want = {"compress/mode": "0", "mipmaps/generate": "true", "detect_3d/compress_to": "0"}
    new = t
    for k, v in want.items():
        new = re.sub(rf"^{re.escape(k)}=.*$", f"{k}={v}", new, flags=re.M)
    if new != t:
        imp.write_text(new)
        changed += 1
print("import files updated:", changed)
