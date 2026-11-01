#!/usr/bin/env python3
"""Writes Godot ShaderMaterial / StandardMaterial3D .tres files for every material name the
city generator emits (dushanbe_city/assets/materials/city/<name>.tres). Texel density is set
via uv_scale because generator UVs are in metres."""
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "dushanbe_city", "assets", "materials", "city")

# name: (texture set, metres per texture repeat, extra params)
PBR = {
    "wall_panel":        ("concrete_panel", 3.0, {"macro_strength": 0.22, "normal_strength": 0.45}),
    "wall_plaster":      ("plaster", 2.5, {"macro_strength": 0.2, "normal_strength": 0.8}),
    "wall_plaster_rough": ("plaster_rough", 2.0, {"macro_strength": 0.22}),
    "wall_brick_red":    ("brick_red", 2.0, {"macro_strength": 0.12}),
    "wall_brick_buff":   ("brick_buff", 2.0, {"macro_strength": 0.12, "tint": (1.08, 1.0, 0.86)}),
    "wall_travertine":   ("travertine", 1.6, {"macro_strength": 0.08, "roughness_mul": 0.9}),
    "plinth":            ("concrete_worn", 2.0, {"macro_strength": 0.25}),
    "concrete":          ("concrete_smooth", 2.0, {"macro_strength": 0.2}),
    "seam":              ("concrete_worn", 2.0, {"macro_strength": 0.0}),
    "metal_paint":       ("metal", 1.0, {"metallic_value": 0.25, "roughness_mul": 0.9, "roughness_add": 0.15, "macro_strength": 0.05}),
    "metal_galv":        ("metal", 1.0, {"metallic_value": 0.75, "roughness_mul": 0.8, "roughness_add": 0.1, "macro_strength": 0.1}),
    "roof_metal":        ("roof_galv", 2.0, {"metallic_value": 0.45, "macro_strength": 0.15}),
    "roof_flat":         ("asphalt_yard", 3.0, {"macro_strength": 0.2}),
    "tiles":             ("tiles", 1.2, {"macro_strength": 0.1}),
    "wood":              ("wood", 1.5, {"macro_strength": 0.05}),
    # ground
    "asphalt":           ("asphalt_road", 4.0, {"macro_strength": 0.25, "macro_scale": 0.012, "wet_receptive": 1.0, "tint": (0.92, 0.91, 0.89), "roughness_add": 0.12}),
    "asphalt_yard":      ("asphalt_yard", 3.5, {"macro_strength": 0.12, "macro_scale": 0.02, "wet_receptive": 1.0}),
    "sidewalk":          ("sidewalk", 2.4, {"macro_strength": 0.22, "wet_receptive": 1.0}),
    "plaza":             ("plaza", 2.5, {"macro_strength": 0.2, "wet_receptive": 1.0}),
    "cobble":            ("cobble", 1.6, {"macro_strength": 0.2, "wet_receptive": 1.0}),
    "curb":              ("concrete_smooth", 1.2, {"macro_strength": 0.2, "tint": (0.92, 0.91, 0.88)}),
    "lawn":              ("grass", 2.5, {"macro_strength": 0.35, "macro_scale": 0.03, "roughness_add": 0.05}),
    "lawn_worn":         ("ground_grass", 3.0, {"macro_strength": 0.3}),
    "soil":              ("soil", 1.5, {"macro_strength": 0.15}),
    "gravel":            ("gravel", 1.5, {"macro_strength": 0.2}),
    "aryk":              ("concrete_worn", 1.5, {"macro_strength": 0.3}),
    "grate":             ("grate", 1.0, {"macro_strength": 0.0}),
    "manhole":           ("metal", 0.7, {"macro_strength": 0.1, "tint": (0.35, 0.33, 0.30), "metallic_value": 0.6}),
    "road_paint":        ("asphalt_road", 4.0, {"macro_strength": 0.3, "tint": (3.4, 3.4, 3.3), "roughness_add": 0.05}),
    "sport":             ("asphalt_yard", 3.0, {"macro_strength": 0.1, "roughness_add": 0.1}),
}

PLAIN = {  # name: (albedo rgb, roughness, metallic, extra)
    "frame_pvc": ((0.93, 0.93, 0.92), 0.38, 0.0, ""),
    "frame_paint": ((0.9, 0.9, 0.9), 0.55, 0.0, ""),
    "frame_alu": ((0.85, 0.85, 0.87), 0.35, 0.65, ""),
    "fabric": ((1, 1, 1), 0.92, 0.0, "cull_mode = 2\n"),
    "canopy_far": ((1, 1, 1), 0.9, 0.0, ""),
}


def tex_ext(name):
    d = os.path.join(ROOT, "dushanbe_city", "assets", "textures", name)
    return "albedo.jpg" if os.path.exists(os.path.join(d, "albedo.jpg")) else "albedo.png"


def write_pbr(name, tex, metres, extra):
    lines = ['[gd_resource type="ShaderMaterial" load_steps=6 format=3]', "",
             '[ext_resource type="Shader" path="res://assets/shaders/city_pbr.gdshader" id="1"]',
             f'[ext_resource type="Texture2D" path="res://assets/textures/{tex}/{tex_ext(tex)}" id="2"]',
             f'[ext_resource type="Texture2D" path="res://assets/textures/{tex}/normal.png" id="3"]',
             f'[ext_resource type="Texture2D" path="res://assets/textures/{tex}/orm.png" id="4"]',
             '[ext_resource type="Texture2D" path="res://assets/textures/noise_macro.png" id="5"]', "",
             "[resource]", f'resource_name = "{name}"', 'shader = ExtResource("1")',
             'shader_parameter/albedo_tex = ExtResource("2")', 'shader_parameter/normal_tex = ExtResource("3")',
             'shader_parameter/orm_tex = ExtResource("4")', 'shader_parameter/macro_tex = ExtResource("5")',
             f"shader_parameter/uv_scale = Vector2({1 / metres:.5f}, {1 / metres:.5f})"]
    for k, v in extra.items():
        if isinstance(v, tuple):
            lines.append(f"shader_parameter/{k} = Color({v[0]}, {v[1]}, {v[2]}, 1)" if k == "tint" else "")
        else:
            lines.append(f"shader_parameter/{k} = {v}")
    open(os.path.join(OUT, name + ".tres"), "w").write("\n".join(l for l in lines if l is not None) + "\n")


def write_plain(name, rgb, rough, metal, extra):
    s = f'''[gd_resource type="StandardMaterial3D" format=3]

[resource]
resource_name = "{name}"
vertex_color_use_as_albedo = true
albedo_color = Color({rgb[0]}, {rgb[1]}, {rgb[2]}, 1)
roughness = {rough}
metallic = {metal}
{extra}'''
    open(os.path.join(OUT, name + ".tres"), "w").write(s)


def write_special():
    open(os.path.join(OUT, "vine.tres"), "w").write('''[gd_resource type="ShaderMaterial" load_steps=3 format=3]

[ext_resource type="Shader" path="res://assets/shaders/vine.gdshader" id="1"]
[ext_resource type="Texture2D" path="res://assets/textures/leaves_round/albedo.png" id="2"]

[resource]
resource_name = "vine"
shader = ExtResource("1")
shader_parameter/leaf_tex = ExtResource("2")
''')
    open(os.path.join(OUT, "facade_far.tres"), "w").write('''[gd_resource type="StandardMaterial3D" load_steps=2 format=3]

[ext_resource type="Texture2D" path="res://assets/textures/facade_far/albedo.png" id="1"]

[resource]
resource_name = "facade_far"
vertex_color_use_as_albedo = true
albedo_texture = ExtResource("1")
roughness = 0.85
''')
    open(os.path.join(OUT, "mountain.tres"), "w").write('''[gd_resource type="ShaderMaterial" load_steps=3 format=3]

[ext_resource type="Shader" path="res://assets/shaders/mountain.gdshader" id="1"]
[ext_resource type="Texture2D" path="res://assets/textures/noise_macro.png" id="2"]

[resource]
resource_name = "mountain"
shader = ExtResource("1")
shader_parameter/noise_tex = ExtResource("2")
''')
    open(os.path.join(OUT, "glass.tres"), "w").write('''[gd_resource type="ShaderMaterial" load_steps=3 format=3]

[ext_resource type="Shader" path="res://assets/shaders/glass.gdshader" id="1"]
[ext_resource type="Texture2D" path="res://assets/textures/windows_atlas.png" id="2"]

[resource]
resource_name = "glass"
shader = ExtResource("1")
shader_parameter/interior_tex = ExtResource("2")
''')
    open(os.path.join(OUT, "sign.tres"), "w").write('''[gd_resource type="StandardMaterial3D" load_steps=2 format=3]

[ext_resource type="Texture2D" path="res://assets/textures/signs_atlas.png" id="1"]

[resource]
resource_name = "sign"
albedo_texture = ExtResource("1")
roughness = 0.45
emission_enabled = true
emission_texture = ExtResource("1")
emission_energy_multiplier = 0.0
texture_filter = 5
''')
    open(os.path.join(OUT, "lamp_emissive.tres"), "w").write('''[gd_resource type="StandardMaterial3D" format=3]

[resource]
resource_name = "lamp_emissive"
albedo_color = Color(0.95, 0.93, 0.85, 1)
roughness = 0.2
emission_enabled = true
emission = Color(1, 0.86, 0.6, 1)
emission_energy_multiplier = 0.0
''')
    open(os.path.join(OUT, "water.tres"), "w").write('''[gd_resource type="ShaderMaterial" load_steps=3 format=3]

[ext_resource type="Shader" path="res://assets/shaders/water.gdshader" id="1"]
[ext_resource type="Texture2D" path="res://assets/textures/noise_macro.png" id="2"]

[resource]
resource_name = "water"
shader = ExtResource("1")
shader_parameter/noise_tex = ExtResource("2")
''')


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    for n, (t, m, e) in PBR.items():
        write_pbr(n, t, m, e)
    for n, (rgb, r, mt, e) in PLAIN.items():
        write_plain(n, rgb, r, mt, e)
    write_special()
    print(len(os.listdir(OUT)), "materials")
