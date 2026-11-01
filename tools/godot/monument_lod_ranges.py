"""Extract the measured LOD switch distances (<= 1 px error at 1080p, 70 deg FOV)
from docs/reports/monument_v3_build.json into the runtime file read by
scripts/world/monument_lod.gd.

  python3 -I tools/godot/monument_lod_ranges.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
rep = json.loads((ROOT / "docs/reports/monument_v3_build.json").read_text())
out = {k: [v["lod1_min_distance_m_1px"], v["lod2_min_distance_m_1px"]] for k, v in rep["lod"].items()}
(ROOT / "assets/monuments/ismoili_somoni/lod_ranges.json").write_text(json.dumps(out, indent=1) + "\n")
print(json.dumps(out))
