"""Extract the real layout around the Ismoili Somoni monument from an OSM XML
extract and convert it to the game's local metric frame.

Frame (see docs/TERRAIN_SYSTEM.md):
  origin = centroid of OSM way 1375034135 (monument footprint)
  +X = east, -Z = north (Godot forward), Y = up, metres.
  Projection: local equirectangular (error < 1 cm over 1 km at this latitude).

Usage: python -I tools/geodata/osm_extract.py <in.osm> <out.json> [half_extent_m=300] [margin_m=150]
Data (c) OpenStreetMap contributors, ODbL 1.0.
"""
from __future__ import annotations

import json
import math
import sys
import xml.etree.ElementTree as ET

MONUMENT_WAY = "1375034135"
R = 6378137.0


def main(argv: list[str]) -> int:
    src, dst = argv[1], argv[2]
    half = float(argv[3]) if len(argv) > 3 else 300.0
    margin = float(argv[4]) if len(argv) > 4 else 150.0
    root = ET.parse(src).getroot()
    nodes = {n.get("id"): (float(n.get("lat")), float(n.get("lon"))) for n in root.iter("node")}
    ways = []
    for w in root.iter("way"):
        tags = {t.get("k"): t.get("v") for t in w.iter("tag")}
        refs = [nd.get("ref") for nd in w.iter("nd")]
        ways.append((w.get("id"), tags, refs))

    mon = next(w for w in ways if w[0] == MONUMENT_WAY)
    pts = [nodes[r] for r in mon[2][:-1]]
    lat0 = sum(p[0] for p in pts) / len(pts)
    lon0 = sum(p[1] for p in pts) / len(pts)
    k_lat = math.radians(1) * R
    k_lon = math.radians(1) * R * math.cos(math.radians(lat0))

    def proj(ll):
        lat, lon = ll
        return [round((lon - lon0) * k_lon, 2), round(-(lat - lat0) * k_lat, 2)]  # x east, z south(+)

    lim = half + margin

    def keep(poly):
        return any(abs(x) <= lim and abs(z) <= lim for x, z in poly)

    out = {
        "source": "OpenStreetMap API 0.6 map extract, bbox 68.7720,38.5705,68.7870,38.5825",
        "license": "ODbL 1.0, (c) OpenStreetMap contributors",
        "origin_latlon": [round(lat0, 7), round(lon0, 7)],
        "frame": "x=east m, z=south m (Godot: -Z = north), y=up",
        "roads": [], "areas": [], "buildings": [], "water": [], "trees": [],
        "monument_footprint": [proj(nodes[r]) for r in mon[2]],
    }
    for n in root.iter("node"):
        tags = {t.get("k"): t.get("v") for t in n.iter("tag")}
        if tags.get("natural") == "tree":
            p = proj((float(n.get("lat")), float(n.get("lon"))))
            if abs(p[0]) <= lim and abs(p[1]) <= lim:
                out["trees"].append(p)
    for wid, tags, refs in ways:
        if not refs or any(r not in nodes for r in refs):
            continue
        poly = [proj(nodes[r]) for r in refs]
        if not keep(poly):
            continue
        name = tags.get("name:ru") or tags.get("name") or tags.get("int_name") or ""
        if "highway" in tags:
            hw = tags["highway"]
            if hw in ("bus_stop", "platform", "elevator"):
                continue
            out["roads"].append({"id": wid, "type": hw, "name": name, "lanes": tags.get("lanes"),
                                 "width": tags.get("width"), "area": tags.get("area") == "yes", "pts": poly})
        elif "building" in tags:
            out["buildings"].append({"id": wid, "name": name, "levels": tags.get("building:levels"), "pts": poly})
        elif tags.get("natural") == "water" or "waterway" in tags or tags.get("water"):
            out["water"].append({"id": wid, "kind": tags.get("waterway") or tags.get("water") or "water", "name": name, "pts": poly})
        elif any(k in tags for k in ("leisure", "landuse", "natural", "amenity", "place", "area:highway", "man_made", "historic", "tourism")):
            kind = (tags.get("leisure") or tags.get("landuse") or tags.get("natural") or tags.get("area:highway")
                    or tags.get("place") or tags.get("amenity") or tags.get("man_made") or tags.get("historic") or tags.get("tourism"))
            out["areas"].append({"id": wid, "kind": kind, "name": name, "closed": refs[0] == refs[-1], "pts": poly})
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    summary = {k: len(v) for k, v in out.items() if isinstance(v, list)}
    print(json.dumps({"origin": out["origin_latlon"], **summary}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
