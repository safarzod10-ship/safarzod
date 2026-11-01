"""Write the Godot material resources (.tres) used by the stage-2 environment.
  python3 -I tools/godot/make_materials.py"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
M = ROOT / "assets" / "materials"


def shader_mat(path, shader, params, textures, noise=None):
    ext = [f'[ext_resource type="Shader" path="{shader}" id="s"]']
    for i, (k, tex) in enumerate(textures.items()):
        ext.append(f'[ext_resource type="Texture2D" path="{tex}" id="t{i}"]')
    subs = []
    if noise:
        subs.append(f'[sub_resource type="FastNoiseLite" id="fnl"]\nnoise_type = 3\nfrequency = {noise[0]}\nfractal_octaves = {noise[1]}\n')
        subs.append('[sub_resource type="NoiseTexture2D" id="ntex"]\nwidth = 512\nheight = 512\nseamless = true\ngenerate_mipmaps = true\nnoise = SubResource("fnl")\n')
    body = ['[resource]', 'shader = ExtResource("s")']
    for i, k in enumerate(textures):
        body.append(f'shader_parameter/{k} = ExtResource("t{i}")')
    if noise:
        body.append(f'shader_parameter/{noise[2]} = SubResource("ntex")')
    for k, v in params.items():
        body.append(f'shader_parameter/{k} = {v}')
    txt = f'[gd_resource type="ShaderMaterial" format=3]\n\n' + "\n".join(ext) + "\n\n" + "\n".join(subs) + "\n" + "\n".join(body) + "\n"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(txt)


def std_mat(path, albedo_tex, normal_tex, extra):
    txt = ('[gd_resource type="StandardMaterial3D" format=3]\n\n'
           f'[ext_resource type="Texture2D" path="{albedo_tex}" id="a"]\n'
           f'[ext_resource type="Texture2D" path="{normal_tex}" id="n"]\n\n'
           '[resource]\nalbedo_texture = ExtResource("a")\nroughness_texture = ExtResource("a")\n'
           'roughness_texture_channel = 3\nnormal_enabled = true\nnormal_texture = ExtResource("n")\n' + extra)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(txt)


T = "res://assets/textures/terrain/"
layers = {"l0": "grass_green", "l1": "grass_dry", "l2": "soil_loess", "l3": "gravel_dirt"}
tex = {}
for l, n in layers.items():
    tex[f"{l}_albedo"] = f"{T}{n}_albedo_rough.png"
    tex[f"{l}_normal"] = f"{T}{n}_normal.png"
tex["splat"] = "res://assets/world/terrain/splat_1m.png"
shader_mat(M / "terrain/terrain_high.tres", "res://assets/shaders/terrain.gdshader",
           {"anti_tiling": "true", "use_normal_maps": "true", "lawn_tint": "Color(0.70, 1.0, 0.60, 1)",
            "dry_tint": "Color(0.84, 0.82, 0.72, 1)"}, tex, (0.004, 4, "macro_noise"))
shader_mat(M / "terrain/terrain_low.tres", "res://assets/shaders/terrain.gdshader",
           {"anti_tiling": "false", "use_normal_maps": "false", "lawn_tint": "Color(0.70, 1.0, 0.60, 1)",
            "dry_tint": "Color(0.84, 0.82, 0.72, 1)"},
           {k: v for k, v in tex.items() if "normal" not in k}, (0.004, 4, "macro_noise"))
shader_mat(M / "mountains/mountains.tres", "res://assets/shaders/mountains.gdshader", {},
           {"rock_detail": f"{T}rock_grey_albedo_rough.png"})
F = "res://assets/textures/foliage/"
for name, atlas, tint, h, transl in [
        ("leaves_plane", "leaves_plane", "Color(0.95, 1.0, 0.86, 1)", 19.5, 0.32),
        ("leaves_elm", "leaves_elm", "Color(0.9, 0.98, 0.84, 1)", 14.0, 0.25),
        ("leaves_poplar", "leaves_poplar", "Color(0.94, 1.0, 0.82, 1)", 22.6, 0.3),
        ("leaves_thuja", "leaves_thuja", "Color(0.95, 1.05, 0.9, 1)", 6.8, 0.15),
        ("leaves_boxwood", "leaves_elm", "Color(0.72, 0.85, 0.7, 1)", 1.7, 0.15),
        ("leaves_juniper", "leaves_thuja", "Color(0.85, 0.98, 0.98, 1)", 1.5, 0.12),
        ("leaves_rose", "leaves_shrub", "Color(0.85, 0.95, 0.8, 1)", 1.7, 0.25)]:
    shader_mat(M / f"vegetation/{name}.tres", "res://assets/shaders/foliage.gdshader",
               {"tint": tint, "tree_height": h, "translucency": transl}, {"leaves": f"{F}{atlas}_albedo_alpha.png"})
B = "res://assets/textures/bark/"
for n in ("bark_light", "bark_dark"):
    std_mat(M / f"vegetation/{n}.tres", f"{B}{n}_albedo_rough.png", f"{B}{n}_normal.png",
            "uv1_scale = Vector3(1, 1, 1)\n")
shader_mat(M / "vegetation/grass.tres", "res://assets/shaders/grass.gdshader", {}, {})
S = "res://assets/textures/monument/"
for n, extra in (("stone_light", "albedo_color = Color(0.93, 0.9, 0.85, 1)\n"), ("stone_dark", "albedo_color = Color(0.55, 0.45, 0.42, 1)\n")):
    std_mat(M / f"monument/{n}.tres", f"{S}{n}_albedo_rough.png", f"{S}{n}_normal.png",
            f'resource_name = "M_Mon_{"StoneLight" if n == "stone_light" else "StoneDark"}"\n' + extra + "uv1_triplanar = true\nuv1_world_triplanar = true\nuv1_scale = Vector3(0.25, 0.25, 0.25)\nnormal_scale = 0.6\n")
print("materials written")
