#!/usr/bin/env python3
"""Godot materials for the vegetation GLB material names (assets/materials/vegetation/*.tres)."""
import os, json
ROOT = "/home/user/safarzod/dushanbe_city"
OUT = ROOT + "/assets/materials/vegetation"
os.makedirs(OUT, exist_ok=True)
FOL_H = {"plane": 20, "elm": 12, "poplar": 21, "acacia": 13, "mulberry": 8, "lilac": 2.5, "thuja": 5,
         "privet": 1, "rose": 1, "flowers": 0.4}
TINT = {"plane": (0.92, 0.98, 0.86), "elm": (0.9, 0.97, 0.85), "poplar": (0.95, 1.0, 0.9), "acacia": (0.95, 1.0, 0.85),
        "mulberry": (0.9, 0.98, 0.85), "lilac": (0.9, 0.98, 0.88), "thuja": (0.92, 0.98, 0.9), "privet": (0.9, 0.98, 0.88),
        "rose": (1, 1, 1), "flowers": (1, 1, 1)}


def res(name, shader, ext, params):
    lines = ['[gd_resource type="ShaderMaterial" format=3]', "",
             f'[ext_resource type="Shader" path="res://assets/shaders/{shader}.gdshader" id="s"]']
    for i, (k, p) in enumerate(ext.items()):
        lines.append(f'[ext_resource type="Texture2D" path="{p}" id="t{i}"]')
    lines += ["", "[resource]", f'resource_name = "{name}"', 'shader = ExtResource("s")']
    for i, (k, p) in enumerate(ext.items()):
        lines.append(f'shader_parameter/{k} = ExtResource("t{i}")')
    for k, v in params.items():
        if isinstance(v, tuple):
            lines.append(f"shader_parameter/{k} = Color({v[0]}, {v[1]}, {v[2]}, 1)")
        elif isinstance(v, bool):
            lines.append(f"shader_parameter/{k} = {'true' if v else 'false'}")
        else:
            lines.append(f"shader_parameter/{k} = {v}")
    open(f"{OUT}/{name}.tres", "w").write("\n".join(lines) + "\n")


for sp in FOL_H:
    t = f"res://assets/textures/foliage_{sp}"
    res(f"foliage_{sp}", "foliage", {"albedo_tex": t + "/albedo.png", "normal_tex": t + "/normal.png"},
        {"sway_height": FOL_H[sp], "tint": TINT[sp], "use_instance_custom": True})
WW = {"bark_plane": 0.55, "bark_furrowed": 0.6, "bark_grey": 0.35, "bark_mulberry": 0.5, "bark_thuja": 0.0}
for b, ww in WW.items():
    t = f"res://assets/textures/{b}"
    res(b, "bark", {"albedo_tex": t + "/albedo.jpg", "normal_tex": t + "/normal.png", "orm_tex": t + "/orm.png"},
        {"whitewash_chance": ww, "use_instance_custom": True})
t = "res://assets/textures/wood"
res("stake_wood", "bark", {"albedo_tex": t + "/albedo.jpg", "normal_tex": t + "/normal.png", "orm_tex": t + "/orm.png"}, {})
res("grass", "grass", {}, {"use_instance_custom": True})
open(f"{OUT}/stem_green.tres", "w").write('[gd_resource type="StandardMaterial3D" format=3]\n\n[resource]\nresource_name = "stem_green"\nalbedo_color = Color(0.22, 0.32, 0.12, 1)\nroughness = 0.8\n')
print(len(os.listdir(OUT)), "materials")
