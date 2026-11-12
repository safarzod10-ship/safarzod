#!/usr/bin/env python3
"""Write the shared prop materials (.tres) to dushanbe_city/assets/materials/props/.

Every prop surface material name used in the GLBs maps 1:1 to <name>.tres here.
Materials reference the SHARED project textures (assets/textures/<name>/...) or the prop
textures in assets/models/props/textures/ - nothing is embedded in meshes.
UVs of procedural props are in metres; uv1_scale = 1 / tile size in metres.
"""
import json, os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "dushanbe_city", "assets", "materials", "props")
T = "res://assets/textures/"
PT = "res://assets/models/props/textures/"


def proj(name):
    return {"albedo": f"{T}{name}/albedo.jpg", "normal": f"{T}{name}/normal.png", "orm": f"{T}{name}/orm.png"}


PAINT = {"albedo": PT + "paint_grunge_albedo.png", "normal": PT + "paint_grunge_normal.png", "orm": PT + "paint_grunge_orm.png"}


def paint(col, tile=1.0, normal=None, orm=None, **kw):
    d = dict(PAINT, color=col, tile=tile, **kw)
    if normal:
        d["normal"] = normal
    if orm:
        d["orm"] = orm
    return d


WOOD_N = T + "wood/normal.png"
ROOF_N, ROOF_O = T + "roof_painted/normal.png", T + "roof_painted/orm.png"

MATS = {
    # painted steel (grunge albedo tinted)
    "paint_green_dark": paint((0.13, 0.27, 0.16)),
    "paint_green": paint((0.17, 0.44, 0.22)),
    "paint_blue": paint((0.10, 0.36, 0.66)),
    "paint_white": paint((0.88, 0.88, 0.85)),
    "paint_black": paint((0.075, 0.075, 0.075)),
    "paint_grey": paint((0.55, 0.57, 0.56)),
    "paint_grey_dark": paint((0.22, 0.23, 0.24)),
    "paint_yellow": paint((0.95, 0.74, 0.12)),
    "paint_red": paint((0.70, 0.11, 0.08)),
    "wood_painted_green": paint((0.20, 0.42, 0.22), normal=WOOD_N),
    "wood_painted_brown": paint((0.40, 0.22, 0.12), normal=WOOD_N),
    "roof_painted_green": paint((0.20, 0.43, 0.27), tile=1.5, normal=ROOF_N, orm=ROOF_O),
    # bare materials with project textures
    "galv": dict(proj("metal"), color=(0.82, 0.84, 0.86), tile=1.0, metallic=0.85, roughness=1.15),
    "steel": dict(proj("metal"), color=(0.95, 0.95, 0.97), tile=1.0, metallic=1.0, roughness=0.75),
    "wood": dict(proj("wood"), color=(1, 1, 1), tile=1.0),
    "wood_pole": dict(proj("wood"), color=(0.62, 0.56, 0.5), tile=1.0),
    "concrete": dict(proj("concrete_smooth"), color=(1.25, 1.25, 1.22), tile=2.0),
    "concrete_light": dict(proj("concrete_panel"), color=(0.92, 0.9, 0.86), tile=2.5),
    "concrete_worn": dict(proj("concrete_worn"), color=(1, 1, 1), tile=2.0),
    "plaster_cream": dict(proj("plaster"), color=(0.97, 0.90, 0.76), tile=2.0),
    "brick_red": dict(proj("brick_red"), color=(1, 1, 1), tile=1.05),
    "soil": dict(proj("soil"), color=(1, 1, 1), tile=1.0),
    "grate": dict(proj("grate"), color=(1, 1, 1), tile=1.0),
    "sand": {"albedo": PT + "sand_albedo.png", "normal": PT + "sand_normal.png", "color": (1, 1, 1), "tile": 1.0, "roughness": 0.95},
    "manhole": {"albedo": PT + "manhole_albedo.png", "normal": PT + "manhole_normal.png", "orm": PT + "manhole_orm.png", "color": (1, 1, 1), "tile": 1.0},
    "fabric_red": {"albedo": PT + "fabric_red.png", "color": (1, 1, 1), "tile": 1.0, "roughness": 0.92},
    "fabric_green": {"albedo": PT + "fabric_green.png", "color": (1, 1, 1), "tile": 1.0, "roughness": 0.92},
    "trash": {"albedo": PT + "ph/trashbag_albedo.jpg", "normal": PT + "ph/trashbag_normal.jpg", "orm": PT + "ph/trashbag_orm.jpg", "color": (0.8, 0.8, 0.8), "tile": 2.0},
    # plain colours
    "grate_frame": {"color": (0.12, 0.12, 0.12), "roughness": 0.8, "metallic": 0.3},
    "plastic_black": {"color": (0.035, 0.035, 0.038), "roughness": 0.45},
    "plastic_grey": {"color": (0.55, 0.56, 0.57), "roughness": 0.5},
    "plastic_dark_green": {"color": (0.08, 0.2, 0.11), "roughness": 0.5},
    "rubber": {"color": (0.03, 0.03, 0.03), "roughness": 0.9},
    "rope": {"color": (0.78, 0.78, 0.74), "roughness": 0.9},
    "insulator": {"color": (0.55, 0.72, 0.62), "roughness": 0.12, "metallic": 0.1},
    "glass": {"color": (0.55, 0.66, 0.70, 0.22), "roughness": 0.04, "metallic": 0.3, "transparent": True, "cull": 2},
    # atlases
    "signs": {"albedo": PT + "signs_atlas.png", "color": (1, 1, 1), "roughness": 0.45, "aniso": True},
    "plates": {"albedo": PT + "plates_atlas.png", "color": (1, 1, 1), "roughness": 0.5, "aniso": True},
    # emissive / animated (default = OFF/day; *_on variants for night / active state)
    "lamp_emissive": {"color": (0.86, 0.86, 0.84), "roughness": 0.25, "emission": (1.0, 0.93, 0.80), "energy": 0.0},
    "lamp_emissive_on": {"color": (0.86, 0.86, 0.84), "roughness": 0.25, "emission": (1.0, 0.93, 0.80), "energy": 6.0},
    "ad_lightbox": {"albedo": PT + "plates_atlas.png", "color": (1, 1, 1), "roughness": 0.2, "emission_tex": True, "emission": (1, 1, 1), "energy": 0.0, "aniso": True},
    "ad_lightbox_on": {"albedo": PT + "plates_atlas.png", "color": (1, 1, 1), "roughness": 0.2, "emission_tex": True, "emission": (1, 1, 1), "energy": 1.2, "aniso": True},
    "tl_countdown": {"albedo": PT + "plates_atlas.png", "color": (0.35, 0.35, 0.35), "roughness": 0.2, "emission_tex": True, "emission": (1, 1, 1), "energy": 0.0},
    "tl_countdown_on": {"albedo": PT + "plates_atlas.png", "color": (1, 1, 1), "roughness": 0.2, "emission_tex": True, "emission": (1, 1, 1), "energy": 3.0},
}
for nm, col, ecol in (("tl_red", (0.30, 0.03, 0.02), (1.0, 0.08, 0.04)), ("tl_yellow", (0.32, 0.20, 0.02), (1.0, 0.62, 0.05)),
                      ("tl_green", (0.02, 0.22, 0.12), (0.1, 1.0, 0.55))):
    MATS[nm] = {"color": col, "roughness": 0.15, "emission": ecol, "energy": 0.0}
    MATS[nm + "_on"] = {"color": col, "roughness": 0.15, "emission": ecol, "energy": 5.0}
for nm in ("tl_ped_red", "tl_ped_green"):
    MATS[nm] = {"albedo": PT + "plates_atlas.png", "color": (0.45, 0.45, 0.45), "roughness": 0.15, "emission_tex": True, "emission": (1, 1, 1), "energy": 0.0}
    MATS[nm + "_on"] = {"albedo": PT + "plates_atlas.png", "color": (1, 1, 1), "roughness": 0.15, "emission_tex": True, "emission": (1, 1, 1), "energy": 4.0}


def col(c):
    c = list(c) + [1.0] * (4 - len(c))
    return "Color(%.4g, %.4g, %.4g, %.4g)" % tuple(c)


def write(name, d, outdir):
    ext = []

    def ref(path):
        if path not in ext:
            ext.append(path)
        return f'ExtResource("{ext.index(path) + 1}")'
    body = [f'resource_name = "{name}"']
    if d.get("cull") is not None:
        body.append(f"cull_mode = {d['cull']}")
    if d.get("transparent"):
        body.append("transparency = 1")
    if d.get("alpha") == "scissor":
        body.append("transparency = 2")
        body.append("alpha_scissor_threshold = 0.5")
    if d.get("double_sided"):
        body.append("cull_mode = 2")
    body.append(f"albedo_color = {col(d.get('color', (1, 1, 1)))}")
    if d.get("albedo"):
        body.append(f"albedo_texture = {ref(d['albedo'])}")
    has_orm = bool(d.get("orm"))
    if has_orm:
        body.append(f"orm_texture = {ref(d['orm'])}")
        body.append(f"roughness = {min(1.0, d.get('roughness', 1.0)):.3g}")
        body.append(f"metallic = {d.get('metallic', 1.0):.3g}")
    else:
        body.append(f"roughness = {d.get('roughness', 0.6):.3g}")
        body.append(f"metallic = {d.get('metallic', 0.0):.3g}")
    if d.get("normal"):
        body.append("normal_enabled = true")
        body.append(f"normal_texture = {ref(d['normal'])}")
    if "emission" in d:
        body.append("emission_enabled = true")
        body.append(f"emission = {col(d['emission'])}")
        body.append(f"emission_energy_multiplier = {d['energy']:.3g}")
        if d.get("emission_tex"):
            body.append(f"emission_texture = {ref(d['albedo'])}")
            body.append("emission_operator = 1")
    tile = d.get("tile", 1.0)
    if tile != 1.0:
        s = 1.0 / tile
        body.append(f"uv1_scale = Vector3({s:.4g}, {s:.4g}, {s:.4g})")
    if d.get("aniso"):
        body.append("texture_filter = 5")
    typ = "ORMMaterial3D" if has_orm else "StandardMaterial3D"
    lines = [f'[gd_resource type="{typ}" load_steps={len(ext) + 1} format=3]', ""]
    for i, p in enumerate(ext):
        lines.append(f'[ext_resource type="Texture2D" path="{p}" id="{i + 1}"]')
    if ext:
        lines.append("")
    lines.append("[resource]")
    lines += body
    with open(os.path.join(outdir, name + ".tres"), "w") as f:
        f.write("\n".join(lines) + "\n")


def main():
    os.makedirs(OUT, exist_ok=True)
    for k, d in MATS.items():
        write(k, d, OUT)
    ph = json.load(open(os.path.join(HERE, "ph_materials.json")))["materials"]
    phdir = os.path.join(OUT, "ph")
    os.makedirs(phdir, exist_ok=True)
    for k, e in ph.items():
        d = {"albedo": PT + "ph/" + e["albedo"], "color": e["albedo_color"], "metallic": e["metallic"],
             "roughness": e["roughness"], "double_sided": e["double_sided"], "alpha": e["alpha"]}
        if e.get("normal"):
            d["normal"] = PT + "ph/" + e["normal"]
        if e.get("orm"):
            d["orm"] = PT + "ph/" + e["orm"]
        write(k, d, phdir)
    print(len(MATS), "materials +", len(ph), "poly haven materials ->", OUT)


if __name__ == "__main__":
    main()
