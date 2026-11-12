#!/usr/bin/env python3
"""Prepare game textures + material manifest for the Poly Haven props.

Reads the raw glTF bundles in dushanbe_city_src/raw/polyhaven/<id>/ and writes
  dushanbe_city/assets/models/props/textures/ph/<material>_albedo.jpg|png (png when alpha)
  ..._normal.jpg (OpenGL) and ..._orm.jpg (glTF ARM = AO/Rough/Metal = Godot ORM)
  dushanbe_city_src/tools/props/ph_materials.json  (consumed by make_materials.py)
"""
import json, os, sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RAW = os.path.join(ROOT, "dushanbe_city_src", "raw", "polyhaven")
OUT = os.path.join(ROOT, "dushanbe_city", "assets", "models", "props", "textures", "ph")
sys.path.insert(0, HERE)
from ph_list import PH_ASSETS  # noqa: E402

# materials replaced by project materials
REMAP = {"security_camera_02_glass": "glass"}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for aid, cfg in PH_ASSETS.items():
        d = os.path.join(RAW, aid)
        g = json.load(open(os.path.join(d, [f for f in os.listdir(d) if f.endswith(".gltf")][0])))
        res = cfg["tex"]
        img_uri = lambda ti: g["images"][g["textures"][ti]["source"]]["uri"]
        keep = set()
        for o in cfg["out"]:
            names = o["keep"]
            for n in g["nodes"]:
                if "mesh" in n and (names is None or n["name"] in names):
                    for p in g["meshes"][n["mesh"]]["primitives"]:
                        keep.add(p.get("material"))
        for mi, m in enumerate(g["materials"]):
            if mi not in keep or m["name"] in REMAP:
                continue
            name = m["name"]
            pbr = m.get("pbrMetallicRoughness", {})
            base = img_uri(pbr["baseColorTexture"]["index"]) if "baseColorTexture" in pbr else None
            rgb_path = os.path.join(d, "textures", f"{name}_diff_1k.jpg")
            if not os.path.exists(rgb_path) and base:
                rgb_path = os.path.join(d, base)
            alpha_path = None
            if m.get("alphaMode", "OPAQUE") == "OPAQUE":
                pass
            elif base and "opacity" in base:
                alpha_path = os.path.join(d, base)
            elif os.path.exists(os.path.join(d, "textures", f"{name}_opacity_1k.jpg")):
                alpha_path = os.path.join(d, "textures", f"{name}_opacity_1k.jpg")
            entry = {"albedo_color": pbr.get("baseColorFactor", [1, 1, 1, 1]),
                     "metallic": pbr.get("metallicFactor", 1.0), "roughness": pbr.get("roughnessFactor", 1.0),
                     "double_sided": bool(m.get("doubleSided", False)), "alpha": "scissor" if alpha_path else "opaque"}
            im = Image.open(rgb_path).convert("RGB").resize((res, res), Image.LANCZOS)
            if alpha_path:
                a = Image.open(alpha_path).convert("L").resize((res, res), Image.LANCZOS)
                im.putalpha(a)
                fn = f"{name}_albedo.png"
                im.save(os.path.join(OUT, fn))
            else:
                fn = f"{name}_albedo.jpg"
                im.save(os.path.join(OUT, fn), quality=90)
            entry["albedo"] = fn
            if "normalTexture" in m:
                fn = f"{name}_normal.jpg"
                Image.open(os.path.join(d, img_uri(m["normalTexture"]["index"]))).convert("RGB").resize((res, res), Image.LANCZOS).save(os.path.join(OUT, fn), quality=92)
                entry["normal"] = fn
            if "metallicRoughnessTexture" in pbr:
                fn = f"{name}_orm.jpg"
                Image.open(os.path.join(d, img_uri(pbr["metallicRoughnessTexture"]["index"]))).convert("RGB").resize((res // 2, res // 2), Image.LANCZOS).save(os.path.join(OUT, fn), quality=90)
                entry["orm"] = fn
            manifest[name] = entry
            print(aid, name, entry["alpha"])
    json.dump({"materials": manifest, "remap": REMAP}, open(os.path.join(HERE, "ph_materials.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
