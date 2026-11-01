#!/usr/bin/env python3
"""Download CC0 PBR textures from ambientCG and prepare game versions.

Raw 2K archives go to dushanbe_city_src/raw/ambientcg/ (not committed, re-fetchable).
Game textures go to dushanbe_city/assets/textures/<name>/:
    albedo.jpg   sRGB colour (alpha atlases: albedo.png with alpha)
    normal.png   OpenGL convention (+Y), as Godot expects
    orm.png      R = ambient occlusion, G = roughness, B = metallic (glTF packing)
A LICENSES.json with source ids and URLs is written next to them.

Usage: python3 fetch_textures.py [--only name,name]
"""
import io, json, os, sys, zipfile, urllib.request
from PIL import Image, ImageOps

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
RAW = os.path.join(ROOT, "dushanbe_city_src", "raw", "ambientcg")
OUT = os.path.join(ROOT, "dushanbe_city", "assets", "textures")

# name: (ambientCG id, game resolution, kind)
TEXTURES = {
    "asphalt_road":   ("Asphalt025C", 2048, "mat"),
    "asphalt_yard":   ("Asphalt026C", 1024, "mat"),
    "sidewalk":       ("PavingStones081", 2048, "mat"),
    "plaza":          ("PavingStones128", 1024, "mat"),
    "cobble":         ("PavingStones070", 1024, "mat"),
    "plaster":        ("Plaster001", 2048, "mat"),
    "plaster_rough":  ("PaintedPlaster017", 1024, "mat"),
    "concrete_panel": ("Concrete034", 1024, "mat"),
    "concrete_smooth": ("Concrete031", 1024, "mat"),
    "concrete_worn":  ("Concrete036", 1024, "mat"),
    "brick_red":      ("Bricks085", 1024, "mat"),
    "brick_buff":     ("Bricks094", 1024, "mat"),
    "travertine":     ("Travertine009", 1024, "mat"),
    "metal":          ("Metal032", 512, "mat"),
    "roof_galv":      ("CorrugatedSteel005", 1024, "mat"),
    "roof_painted":   ("CorrugatedSteel007A", 1024, "mat"),
    "grass":          ("Grass004", 1024, "mat"),
    "ground_grass":   ("Ground037", 1024, "mat"),
    "soil":           ("Ground048", 1024, "mat"),
    "gravel":         ("Gravel023", 1024, "mat"),
    "wood":           ("Wood049", 1024, "mat"),
    "tiles":          ("Tiles107", 1024, "mat"),
    "bark":           ("Bark014", 1024, "mat"),
    "grate":          ("Grate001", 512, "mat"),
    "leaves_plane":   ("LeafSet029", 1024, "atlas"),
    "leaves_elm":     ("LeafSet019", 1024, "atlas"),
    "leaves_round":   ("LeafSet024", 1024, "atlas"),
    "leaves_poplar":  ("LeafSet022", 1024, "atlas"),
}


def fetch(asset_id):
    os.makedirs(RAW, exist_ok=True)
    path = os.path.join(RAW, f"{asset_id}_2K-PNG.zip")
    if not os.path.exists(path) or os.path.getsize(path) < 1000:
        for fmt in ("2K-PNG", "2K-JPG"):
            url = f"https://ambientcg.com/get?file={asset_id}_{fmt}.zip"
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "dushanbe-asset-fetch/1.0"})
                data = urllib.request.urlopen(req, timeout=120).read()
                if len(data) > 1000:
                    open(path, "wb").write(data)
                    break
            except Exception as e:  # try next format
                print("  ", url, e)
    return zipfile.ZipFile(path)


def find(z, *keys):
    for n in z.namelist():
        low = n.lower()
        if any(k.lower() in low for k in keys) and not low.endswith(".usda"):
            return Image.open(io.BytesIO(z.read(n)))
    return None


def main():
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))
    licenses = {}
    lic_path = os.path.join(OUT, "LICENSES.json")
    if os.path.exists(lic_path):
        licenses = json.load(open(lic_path))
    for name, (aid, res, kind) in TEXTURES.items():
        if only and name not in only:
            continue
        print(name, aid)
        z = fetch(aid)
        d = os.path.join(OUT, name)
        os.makedirs(d, exist_ok=True)
        col = find(z, "_Color.")
        size = (res, res)
        if kind == "atlas":
            op = find(z, "_Opacity.")
            col = col.convert("RGB").resize(size, Image.LANCZOS)
            a = op.convert("L").resize(size, Image.LANCZOS)
            col.putalpha(a)
            col.save(os.path.join(d, "albedo.png"))
        else:
            col.convert("RGB").resize(size, Image.LANCZOS).save(os.path.join(d, "albedo.jpg"), quality=92)
        nrm = find(z, "_NormalGL.")
        if nrm:
            nrm.convert("RGB").resize(size, Image.LANCZOS).save(os.path.join(d, "normal.png"))
        rough = find(z, "_Roughness.")
        ao = find(z, "_AmbientOcclusion.")
        met = find(z, "_Metalness.")
        g = rough.convert("L").resize(size, Image.LANCZOS) if rough else Image.new("L", size, 200)
        r = ao.convert("L").resize(size, Image.LANCZOS) if ao else Image.new("L", size, 255)
        b = met.convert("L").resize(size, Image.LANCZOS) if met else Image.new("L", size, 0)
        Image.merge("RGB", (r, g, b)).save(os.path.join(d, "orm.png"))
        licenses[name] = {
            "source": "ambientCG", "id": aid, "license": "CC0 1.0",
            "url": f"https://ambientcg.com/view?id={aid}", "game_resolution": res,
        }
    json.dump(licenses, open(lic_path, "w"), indent=1, ensure_ascii=False)


if __name__ == "__main__":
    main()
