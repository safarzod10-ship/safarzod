"""Write the monument v3 ShaderMaterials (assets/materials/monument_v3/*.tres).

  python3 -I tools/godot/make_monument_materials.py

One shader (assets/shaders/monument_surface.gdshader), seven instances: the
five physical materials, with gold and bronze split per baked atlas (a
material can sample only one bake atlas). Parameter rationale and photo
colour estimates: docs/MONUMENT_MATERIALS.md. Albedo colour is already
calibrated inside the textures (tools/textures/prepare_monument_textures.py),
so tint stays white unless noted.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "materials" / "monument_v3"
TEX = "res://assets/textures/monument_v3/"
SHADER = "res://assets/shaders/monument_surface.gdshader"

STONE_GRANITE = dict(tex="granite_red", tile_m=1.0, roughness_up=0.14, joint_spacing=(1.0, 0.0), joint_width=0.004,
                     joint_color=(0.23, 0.15, 0.12), panel_tone=0.06, cavity_darkening=0.35, roughness_in_cavity=0.15,
                     normal_strength=0.5)
STONE_ARCH = dict(tex="stone_arch", tile_m=1.6, joint_spacing=(0.9, 0.9), joint_width=0.006,
                  joint_color=(0.45, 0.42, 0.38), panel_tone=0.05, cavity_darkening=0.45, roughness_in_cavity=0.1,
                  normal_strength=0.7)
STONE_COLUMN = dict(tex="stone_column", tile_m=1.0, cavity_darkening=0.4, roughness_in_cavity=0.1, normal_strength=0.5)
GOLD = dict(tex="gold_leaf", tile_m=0.8, tint=(1.0, 0.93, 0.78), metallic_value=1.0, metallic_in_cavity=0.6,
            roughness_scale=1.25, roughness_in_cavity=0.2, cavity_darkening=0.35, panel_tone=0.12, panel_cell_m=0.6,
            edge_polish=0.25, normal_strength=0.6)
BRONZE = dict(tex="bronze_patina", tile_m=0.9, metallic_value=0.4, metallic_in_cavity=0.25, roughness_scale=1.1,
              roughness_in_cavity=0.15, cavity_darkening=0.5, edge_polish=0.15, normal_strength=0.8)

MATERIALS = {  # file / material name : (params, bake atlas, baked normal)
    "M_Mon_Granite": (STONE_GRANITE, "arch", None),
    "M_Mon_ArchStone": (STONE_ARCH, "arch", None),
    "M_Mon_ColumnStone": (STONE_COLUMN, "arch", None),
    "M_Mon_Gold": (GOLD, "arch", None),
    "M_Mon_Gold_Sculpt": (GOLD, "sculpt", None),
    "M_Mon_Bronze": (BRONZE, "sculpt", None),
    "M_Mon_Bronze_Lion": (BRONZE, "lions", "lions_normal"),
}


def val(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, tuple) and len(v) == 2:
        return "Vector2(%g, %g)" % v
    if isinstance(v, tuple) and len(v) == 3:
        return "Color(%g, %g, %g, 1)" % v
    return "%g" % v


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (p, atlas, bnormal) in MATERIALS.items():
        p = dict(p)
        tex = p.pop("tex")
        res = [(f"{TEX}{tex}_albedo_rough.png", "a"), (f"{TEX}{tex}_normal.png", "n"), (f"{TEX}bake_{atlas}.png", "b")]
        if bnormal:
            res.append((f"{TEX}{bnormal}.png", "bn"))
        lines = [f'[gd_resource type="ShaderMaterial" load_steps={len(res) + 2} format=3]', "",
                 f'[ext_resource type="Shader" path="{SHADER}" id="s"]']
        lines += [f'[ext_resource type="Texture2D" path="{path}" id="{i}"]' for path, i in res]
        lines += ["", "[resource]", f'resource_name = "{name}"', 'shader = ExtResource("s")',
                  'shader_parameter/detail_albedo_rough = ExtResource("a")',
                  'shader_parameter/detail_normal = ExtResource("n")',
                  'shader_parameter/bake_map = ExtResource("b")']
        if bnormal:
            lines += ['shader_parameter/bake_normal = ExtResource("bn")', "shader_parameter/use_bake_normal = true"]
        lines += [f"shader_parameter/{k} = {val(v)}" for k, v in p.items()]
        (OUT / f"{name}.tres").write_text("\n".join(lines) + "\n")
        print("wrote", name)


if __name__ == "__main__":
    main()
