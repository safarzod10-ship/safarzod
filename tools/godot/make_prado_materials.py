"""Write the Prado v3 materials (assets/materials/prado_v3/*.tres).

  python3 -I tools/godot/make_prado_materials.py

Opaque parts: assets/shaders/vehicle_surface.gdshader (triplanar CC0 detail + baked AO atlas +
clear coat + emission); glass: assets/shaders/vehicle_glass.gdshader (VLT-based transmission).
Colours: docs/PRADO_V3.md (paint Super White II, beige leather cabin, graphite dash).
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "materials" / "prado_v3"
TEX = "res://assets/textures/prado_v3/"


def lin(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def srgb(c):
    return [12.92 * x if x <= 0.0031308 else 1.055 * x ** (1 / 2.4) - 0.055 for x in c]


def tint_for(target_hex, base_hex):
    """Colour multiplier so that texture(base) * tint == target (computed in linear, stored sRGB)."""
    t, b = lin(target_hex), lin(base_hex)
    return tuple(round(min(1.0, srgb([min(1.0, x / y)])[0]), 4) for x, y in zip(t, b))


PL = "#E0E0E0"   # mean of plastic_grain
MATS = {  # name: (texture set, tile_m, params)
    "M_Prado_Paint": ("paint", 0.35, dict(tint=tint_for("#F1F1EC", "#FFFFFF"), roughness_scale=0.8, normal_strength=0.12,
                                         clearcoat_amount=1.0, clearcoat_gloss=0.96, cavity_darkening=0.25)),
    "M_Prado_Chrome": ("paint", 0.5, dict(tint=(0.93, 0.93, 0.95), metallic_value=1.0, roughness_scale=0.25, normal_strength=0.0)),
    "M_Prado_TrimBlack": ("plastic_grain", 0.25, dict(tint=tint_for("#161617", PL), roughness_scale=1.0)),
    "M_Prado_GapDark": ("plastic_grain", 0.25, dict(tint=tint_for("#050505", PL), roughness_scale=1.3)),
    "M_Prado_LightLens": ("paint", 0.5, dict(tint=(0.92, 0.93, 0.95), metallic_value=1.0, roughness_scale=0.3,
                                             clearcoat_amount=1.0, emission_color=(1.0, 0.97, 0.9), emission_energy=0.0)),
    "M_Prado_TailLight": ("paint", 0.5, dict(tint=tint_for("#8E0A0A", "#FFFFFF"), roughness_scale=0.3, clearcoat_amount=1.0,
                                             emission_color=(1.0, 0.05, 0.03), emission_energy=0.15)),
    "M_Prado_Tyre": ("tyre_rubber", 0.25, dict(roughness_scale=1.0, cavity_darkening=0.4)),
    "M_Prado_Rim": ("paint", 0.5, dict(tint=(0.80, 0.81, 0.83), metallic_value=1.0, roughness_scale=0.9, clearcoat_amount=0.6)),
    "M_Prado_Brake": ("plastic_grain", 0.2, dict(tint=tint_for("#555658", PL), metallic_value=1.0, roughness_scale=0.8)),
    "M_Prado_Leather_Beige": ("leather_beige", 0.30, dict(cavity_darkening=0.45, normal_strength=0.9)),
    "M_Prado_Leather_Black": ("leather_black", 0.25, dict(normal_strength=0.9)),
    "M_Prado_Dash_Graphite": ("plastic_grain", 0.30, dict(tint=tint_for("#3A3B3E", PL), roughness_scale=1.0)),
    "M_Prado_Trim_BeigeGrey": ("plastic_grain", 0.30, dict(tint=tint_for("#A79C88", PL), roughness_scale=1.05)),
    "M_Prado_Console_Dark": ("plastic_grain", 0.25, dict(tint=tint_for("#1E1F21", PL), roughness_scale=0.75)),
    "M_Prado_Metal_Insert": ("paint", 0.5, dict(tint=(0.66, 0.67, 0.69), metallic_value=1.0, roughness_scale=1.0)),
    "M_Prado_Headliner": ("headliner", 0.35, dict(normal_strength=0.6)),
    "M_Prado_Carpet": ("carpet_dark", 0.35, dict(normal_strength=0.8, cavity_darkening=0.5)),
    "M_Prado_Screen": ("paint", 0.5, dict(tint=tint_for("#050608", "#FFFFFF"), roughness_scale=0.15,
                                          emission_color=(0.15, 0.3, 0.55), emission_energy=0.25)),
    "M_Prado_Belt": ("carpet_dark", 0.15, dict(tint=(0.85, 0.85, 0.85), normal_strength=0.5)),
}
GLASS = {"M_Prado_Glass_Tint": 0.20, "M_Prado_Glass_Clear": 0.75}


def val(v):
    if isinstance(v, tuple) and len(v) == 3:
        return "Color(%g, %g, %g, 1)" % v
    return "%g" % v


EXTERIOR = {"M_Prado_Paint", "M_Prado_Chrome", "M_Prado_TrimBlack", "M_Prado_GapDark", "M_Prado_LightLens",
            "M_Prado_TailLight", "M_Prado_Rim", "M_Prado_Tyre", "M_Prado_Brake"}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (tex, tile, p) in MATS.items():
        lines = ['[gd_resource type="ShaderMaterial" load_steps=5 format=3]', "",
                 '[ext_resource type="Shader" path="res://assets/shaders/vehicle_surface.gdshader" id="s"]',
                 f'[ext_resource type="Texture2D" path="{TEX}{tex}_albedo_rough.png" id="a"]',
                 f'[ext_resource type="Texture2D" path="{TEX}{tex}_normal.png" id="n"]',
                 f'[ext_resource type="Texture2D" path="{TEX}bake_prado.png" id="b"]', "", "[resource]",
                 f'resource_name = "{name}"', 'shader = ExtResource("s")',
                 'shader_parameter/detail_albedo_rough = ExtResource("a")', 'shader_parameter/detail_normal = ExtResource("n")',
                 'shader_parameter/bake_map = ExtResource("b")', f"shader_parameter/tile_m = {tile}",
                 "shader_parameter/detail_fade_start = 15.0", "shader_parameter/detail_fade_end = 45.0"]
        p = dict(p)
        p.setdefault("ao_strength", 0.25 if name in EXTERIOR else 0.7)
        if name in EXTERIOR:
            p.setdefault("cavity_darkening", 0.1)
        lines += [f"shader_parameter/{k} = {val(v)}" for k, v in p.items()]
        (OUT / f"{name}.tres").write_text("\n".join(lines) + "\n")
    for name, v in GLASS.items():
        (OUT / f"{name}.tres").write_text("\n".join([
            '[gd_resource type="ShaderMaterial" load_steps=2 format=3]', "",
            '[ext_resource type="Shader" path="res://assets/shaders/vehicle_glass.gdshader" id="s"]', "", "[resource]",
            f'resource_name = "{name}"', 'shader = ExtResource("s")', f"shader_parameter/vlt = {v}",
            "render_priority = 1"]) + "\n")
    print("materials:", len(MATS) + len(GLASS))


if __name__ == "__main__":
    main()
