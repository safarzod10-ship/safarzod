# Pack the exported sprite PNGs into atlas pages per group and write the sprite manifest.
#   python -I pack_atlas.py <export dir> <sprites dir> <sprites.json> <web dir>
# Groups: core (GameAssets, Resources) and one per scene; a sprite lives in the first group that uses it.
import sys, os, json, re
from PIL import Image

exp, sprite_dir, sprites_json, web = sys.argv[1:5]
SP = json.load(open(sprites_json))
meta = {}
for key, s in SP.items():
    meta[s["file"]] = dict(s, key=key)
borders = json.load(open(os.path.join(exp, "borders.json")))


def refs(path):
    return set(re.findall(r'"S:([^"]+)"', open(path).read()))


groups = [
    ("core", refs(os.path.join(exp, "assets.json")) | refs(os.path.join(exp, "scenes", "resources.json")) |
     {f for f, m in meta.items() if m["key"].startswith("resources.assets:")}),
    ("level1", refs(os.path.join(exp, "scenes", "level1.json"))),
    # sprites only referenced from AnimationClips (the prologue girl's Animator) go with the prologue
    ("level0", refs(os.path.join(exp, "scenes", "level0.json")) | {f for f in meta if f.startswith("Girl1_")}),
    ("level2", refs(os.path.join(exp, "scenes", "level2.json"))),
]
placed = {}
PAGE = 2048
PAD = 1
out_img = os.path.join(web, "atlas")
os.makedirs(out_img, exist_ok=True)
for f in os.listdir(out_img):
    os.remove(os.path.join(out_img, f))
manifest = {"pages": [], "sprites": {}, "groups": {}}


def extrude(img):
    w, h = img.size
    e = Image.new("RGBA", (w + 2 * PAD, h + 2 * PAD))
    e.paste(img, (PAD, PAD))
    e.paste(img.crop((0, 0, w, 1)), (PAD, 0)); e.paste(img.crop((0, h - 1, w, h)), (PAD, h + PAD))
    col = e.crop((PAD, 0, PAD + 1, h + 2 * PAD)); e.paste(col, (0, 0))
    col = e.crop((PAD + w - 1, 0, PAD + w, h + 2 * PAD)); e.paste(col, (w + PAD, 0))
    return e


for gname, names in groups:
    todo = sorted((n for n in names if n not in placed and n in meta), key=lambda n: (-meta[n]["h"], -meta[n]["w"]))
    pages = []
    cur = None
    def new_page(w=PAGE, h=PAGE):
        p = {"img": Image.new("RGBA", (w, h)), "x": 0, "y": 0, "row": 0, "w": w, "h": h, "used_h": 0}
        pages.append(p)
        return p
    for n in todo:
        m = meta[n]
        img = Image.open(os.path.join(sprite_dir, n + ".png")).convert("RGBA")
        w, h = img.size
        ew, eh = w + 2 * PAD, h + 2 * PAD
        if ew > PAGE or eh > PAGE:
            p = new_page(ew, eh)
            p["img"].paste(extrude(img), (0, 0)); p["used_h"] = eh
            px, py, page = 0, 0, p
        else:
            if cur is None or cur["w"] != PAGE:
                cur = new_page()
            if cur["x"] + ew > PAGE:
                cur["x"] = 0; cur["y"] += cur["row"]; cur["row"] = 0
            if cur["y"] + eh > PAGE:
                cur = new_page();
            px, py, page = cur["x"], cur["y"], cur
            cur["img"].paste(extrude(img), (px, py))
            cur["x"] += ew; cur["row"] = max(cur["row"], eh); cur["used_h"] = max(cur["used_h"], py + eh)
        placed[n] = (page, px + PAD, py + PAD, w, h)
    ids = []
    for i, p in enumerate(pages):
        name = f"{gname}_{i}.png"
        h = p["used_h"]
        hh = 1
        while hh < h: hh *= 2
        img = p["img"].crop((0, 0, p["w"], min(p["h"], hh))) if p["w"] == PAGE else p["img"]
        img.save(os.path.join(out_img, name), optimize=True)
        p["index"] = len(manifest["pages"])
        manifest["pages"].append(name)
        ids.append(p["index"])
    manifest["groups"][gname] = ids
    for n in todo:
        page, x, y, w, h = placed[n]
        m = meta[n]
        e = [page["index"], x, y, w, h, round(m["pivot"][0], 5), round(m["pivot"][1], 5), m["ppu"]]
        if n in borders:
            e.append(borders[n])
        manifest["sprites"][n] = e
    print(gname, len(todo), "sprites", len(pages), "pages")
json.dump(manifest, open(os.path.join(web, "data", "sprites.json"), "w"), separators=(",", ":"))
