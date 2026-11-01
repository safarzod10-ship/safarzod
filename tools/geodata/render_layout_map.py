"""Render assets/world/osm_layout.json (+ optional world zones) to a PNG map for docs.
Usage: python -I tools/geodata/render_layout_map.py <layout.json> <out.png> [world_config.json]"""
import json, sys
from PIL import Image, ImageDraw
lay = json.load(open(sys.argv[1])); out = sys.argv[2]
cfg = json.load(open(sys.argv[3])) if len(sys.argv) > 3 else None
S, L = 1000, 450  # px, half extent m
def px(p): return ((p[0] + L) / (2 * L) * S, (p[1] + L) / (2 * L) * S)
im = Image.new("RGB", (S, S), (236, 230, 214)); d = ImageDraw.Draw(im)
col = {"park": (170, 205, 150), "grass": (150, 200, 120), "fountain": (120, 170, 220), "basin": (120, 170, 220),
       "parking": (205, 200, 195), "monument": (220, 180, 80)}
for a in lay["areas"]:
    if a["closed"] and len(a["pts"]) > 2:
        d.polygon([px(p) for p in a["pts"]], fill=col.get(a["kind"], (215, 210, 195)))
for w in lay["water"]:
    if len(w["pts"]) > 2: d.polygon([px(p) for p in w["pts"]], fill=(120, 170, 220))
for b in lay["buildings"]:
    if len(b["pts"]) > 2: d.polygon([px(p) for p in b["pts"]], fill=(170, 160, 150), outline=(120, 110, 100))
wid = {"trunk": 7, "trunk_link": 4, "primary": 6, "secondary": 5, "tertiary": 4, "residential": 3, "service": 2}
for r in lay["roads"]:
    d.line([px(p) for p in r["pts"]], fill=(90, 90, 90) if r["type"] in wid else (200, 120, 90), width=wid.get(r["type"], 1))
if cfg:
    for z in cfg.get("zones", []):
        if "rect" in z:
            x0, z0, x1, z1 = z["rect"]; d.rectangle([px((x0, z0)), px((x1, z1))], outline=(200, 0, 160), width=2)
            d.text(px((x0 + 3, z0 + 3)), z["id"], fill=(160, 0, 130))
d.polygon([px(p) for p in lay["monument_footprint"]], fill=(230, 170, 40))
d.rectangle([px((-300, -300)), px((300, 300))], outline=(220, 30, 30), width=3)
for i in range(-300, 301, 100):
    d.line([px((i, -300)), px((i, 300))], fill=(220, 120, 120)); d.line([px((-300, i)), px((300, i))], fill=(220, 120, 120))
d.text(px((-10, -440)), "N", fill=(0, 0, 0)); d.text((10, S - 20), "grid 100 m, red = 600x600 play area; (c) OpenStreetMap contributors", fill=(0, 0, 0))
im.save(out)
