#!/usr/bin/env python3
"""Download the Poly Haven (CC0) prop models used by the DUSHANBE prop library.

Raw glTF (1k textures) goes to dushanbe_city_src/raw/polyhaven/<id>/ (not committed,
re-fetchable with this script).  Processing (decimation, origin, texture packing) is done
by build_polyhaven.py inside Blender.

Usage: python3 fetch_polyhaven.py [id ...]
"""
import json, os, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "dushanbe_city_src", "raw", "polyhaven")
sys.path.insert(0, os.path.dirname(__file__))
from ph_list import PH_ASSETS  # noqa: E402

UA = {"User-Agent": "dushanbe-prop-fetch/1.0"}


def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
        return r.read()


def fetch(asset_id, res="1k"):
    out = os.path.join(RAW, asset_id)
    os.makedirs(out, exist_ok=True)
    files = json.loads(get(f"https://api.polyhaven.com/files/{asset_id}"))
    info = json.loads(get(f"https://api.polyhaven.com/info/{asset_id}"))
    with open(os.path.join(out, "info.json"), "w") as f:
        json.dump(info, f, indent=1)
    g = files["gltf"][res]["gltf"]
    items = [(os.path.basename(g["url"]), g["url"], g.get("size", 0))]
    for rel, it in g.get("include", {}).items():
        items.append((rel, it["url"], it.get("size", 0)))
    for rel, url, size in items:
        dst = os.path.join(out, rel)
        if os.path.exists(dst) and os.path.getsize(dst) == size:
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        data = get(url)
        with open(dst, "wb") as f:
            f.write(data)
        print("  ", rel, len(data))
    for key in PH_ASSETS.get(asset_id, {}).get("extra", []):
        if key not in files:
            print("   missing map", key)
            continue
        it = files[key][res]["jpg"]
        dst = os.path.join(out, "textures", os.path.basename(it["url"]))
        if not (os.path.exists(dst) and os.path.getsize(dst) == it.get("size", -1)):
            data = get(it["url"])
            with open(dst, "wb") as f:
                f.write(data)
            print("   extra", key, len(data))
    print("ok", asset_id)


if __name__ == "__main__":
    ids = sys.argv[1:] or list(PH_ASSETS.keys())
    for i in ids:
        fetch(i)
