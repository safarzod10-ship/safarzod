"""Prado v3 tiling PBR sets: CC0 ambientCG scans colour-calibrated to the cabin colour scheme
(docs/PRADO_V3.md) + a procedural clear-coat "orange peel" normal map for the white paint.

  /opt/dushanbe-venv/bin/python -I tools/textures/prepare_prado_textures.py [download_dir]

Same calibration as the monument (tools/textures/prepare_monument_textures.py): mean colour moved
to the target in linear space, scan variation kept. Output: assets/textures/prado_v3/.
"""
import io
import json
import sys
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import prepare_monument_textures as P  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "textures" / "prado_v3"
P.DL = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/dl/textures")

# name: (ambientCG id, target sRGB, variation gain, roughness mean, roughness gain, size)
SETS = {
    "leather_beige": ("Leather037", "#C4B496", 0.6, 0.55, 0.8, 1024),     # seats, armrest, door inserts
    "leather_black": ("Leather026", "#1F1F20", 0.6, 0.50, 0.8, 1024),     # steering wheel, shifter knob
    "carpet_dark": ("Carpet012", "#2E2E30", 0.7, 0.95, 0.4, 1024),        # floor, mats, cargo
    "headliner": ("Fabric036", "#CDC3AF", 0.5, 0.90, 0.4, 1024),          # roof lining, visors
    "plastic_grain": ("Plastic011", "#E0E0E0", 0.5, 0.60, 0.6, 1024),     # dash / trims (light: tinted DOWN per material)
    "tyre_rubber": ("Rubber004", "#1C1C1D", 0.6, 0.85, 0.5, 1024),
}


def orange_peel(size=1024, seed=7):
    """Clear-coat micro-waviness ('orange peel'): band-limited noise, very low amplitude."""
    rng = np.random.default_rng(seed)
    f = np.fft.fft2(rng.normal(size=(size, size)))
    ky, kx = np.meshgrid(np.fft.fftfreq(size), np.fft.fftfreq(size), indexing="ij")
    k = np.sqrt(kx * kx + ky * ky) * size
    f *= np.exp(-((k - 60) / 25) ** 2)
    h = np.real(np.fft.ifft2(f))
    h /= np.abs(h).max()
    gy, gx = np.gradient(h)
    n = np.dstack([-gx * 2.0, -gy * 2.0, np.ones_like(h)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8), "RGB")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lic = json.loads(P.LIC.read_text()) if P.LIC.exists() else {}
    report = {}
    for name, (asset, target, var_gain, r_mean, r_gain, size) in SETS.items():
        z, meta = P.fetch(asset)
        col = np.asarray(P.img(z, asset, "Color", "RGB").resize((size, size), Image.LANCZOS), dtype=np.float64) / 255
        lin = P.srgb_to_lin(col)
        w = np.array([0.2126, 0.7152, 0.0722])
        lum = lin @ w
        tgt = P.srgb_to_lin(P.hex_rgb(target))
        rel = 1.0 + var_gain * (lum / max(float(lum.mean()), 1e-6) - 1.0)
        out = np.clip((tgt / float(tgt @ w))[None, None, :] * (float(tgt @ w) * rel)[..., None], 0, 1)
        rough = np.asarray(P.img(z, asset, "Roughness", "L").resize((size, size), Image.LANCZOS), dtype=np.float64) / 255
        rough = np.clip(r_mean + r_gain * (rough - rough.mean()), 0.04, 1.0)
        rgba = np.dstack([P.lin_to_srgb(out), rough])
        Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / f"{name}_albedo_rough.png", optimize=True)
        P.img(z, asset, "NormalGL", "RGB").resize((size, size), Image.LANCZOS).save(OUT / f"{name}_normal.png", optimize=True)
        got = P.lin_to_srgb(out.reshape(-1, 3).mean(0))
        report[name] = {"source": asset, "target_srgb": target, "result_mean_srgb": "#%02X%02X%02X" % tuple((got * 255 + .5).astype(int))}
        lic[asset] = {"purpose": f"prado v3: {name}", **meta}
    # paint: flat albedo (colour comes from the material), roughness 0.30, orange-peel normal
    a = np.dstack([np.full((256, 256, 3), 255, np.uint8), np.full((256, 256), int(0.30 * 255), np.uint8)])
    Image.fromarray(a, "RGBA").save(OUT / "paint_albedo_rough.png")
    orange_peel().save(OUT / "paint_normal.png", optimize=True)
    report["paint"] = {"source": "procedural (numpy FFT band-limited noise)", "note": "clear-coat orange peel"}
    P.LIC.write_text(json.dumps(lic, indent=1, ensure_ascii=False))
    (ROOT / "docs" / "reports" / "prado_v3_textures.json").write_text(json.dumps(report, indent=1))
    print(json.dumps(report))


if __name__ == "__main__":
    main()
