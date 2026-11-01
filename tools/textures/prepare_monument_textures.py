"""Monument v3 tiling PBR sets from CC0 ambientCG scans, colour-calibrated to the
reference-photo estimates in docs/MONUMENT_MATERIALS.md.

  /opt/dushanbe-venv/bin/python -I tools/textures/prepare_monument_textures.py [download_dir]

* Downloads <id>_2K-JPG.zip (CC0 1.0) into download_dir (default /opt/dl/textures,
  outside the repository) and records SHA-256 in assets/textures/LICENSES.json.
* Colour calibration: the scan's albedo is converted to linear, its mean is
  moved to the target (linear) by a per-channel gain, and the variation around
  the mean is kept (optionally scaled) - so grain/veining is real scan detail
  and only the overall colour comes from the photo estimate. Roughness is
  remapped to the target mean, keeping the scan's variation.
* Output (assets/textures/monument_v3/): <name>_albedo_rough.png (sRGB RGB +
  linear roughness in A) and <name>_normal.png (OpenGL convention).
"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "textures" / "monument_v3"
DL = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/dl/textures")
LIC = ROOT / "assets" / "textures" / "LICENSES.json"

# name: (ambientCG id, target albedo sRGB hex, variation gain, target roughness mean, roughness spread gain, size)
SETS = {
    "granite_red": ("Granite006A", "#946A56", 0.85, 0.30, 0.8, 2048),     # platform, steps, pedestal
    "stone_arch": ("Granite001B", "#D6CAB6", 0.30, 0.62, 0.7, 2048),      # arch / pylon cladding
    "stone_column": ("Marble012", "#D8D5CE", 0.6, 0.42, 0.7, 1024),       # colonnade columns
    "gold_leaf": ("Metal042A", "#E0BC6C", 0.7, 0.30, 0.9, 1024),          # gilded stalactites, crown, rods
    "bronze_patina": ("Metal013", "#5F5A52", 0.75, 0.55, 1.0, 2048),       # statue, lions
}


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def hex_rgb(h):
    return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float64) / 255.0


def fetch(asset):
    DL.mkdir(parents=True, exist_ok=True)
    f = DL / f"{asset}_2K-JPG.zip"
    if not f.exists():
        req = urllib.request.Request(f"https://ambientcg.com/get?file={asset}_2K-JPG.zip",
                                     headers={"User-Agent": "DUSHANBE-asset-pipeline"})
        f.write_bytes(urllib.request.urlopen(req, timeout=300).read())
    data = f.read_bytes()
    return zipfile.ZipFile(io.BytesIO(data)), {"url": f"https://ambientcg.com/view?id={asset}", "archive": f.name,
                                               "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                                               "license": "CC0 1.0 Universal (ambientCG)"}


def img(z, asset, kind, mode):
    return Image.open(io.BytesIO(z.read(f"{asset}_2K-JPG_{kind}.jpg"))).convert(mode)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    lic = json.loads(LIC.read_text()) if LIC.exists() else {}
    report = {}
    for name, (asset, target, var_gain, r_mean, r_gain, size) in SETS.items():
        z, meta = fetch(asset)
        col = np.asarray(img(z, asset, "Color", "RGB").resize((size, size), Image.LANCZOS), dtype=np.float64) / 255
        lin = srgb_to_lin(col)
        mean = lin.reshape(-1, 3).mean(0)
        tgt = srgb_to_lin(hex_rgb(target))
        # luminance variation kept (scaled), chroma of the scan pulled to the target hue
        lum = lin @ np.array([0.2126, 0.7152, 0.0722])
        lum_mean = float(lum.mean())
        rel = 1.0 + var_gain * (lum / max(lum_mean, 1e-6) - 1.0)
        chroma = lin / np.maximum(lum[..., None], 1e-6)          # per-pixel colour ratio
        chroma_mean = mean / max(float(mean @ np.array([0.2126, 0.7152, 0.0722])), 1e-6)
        tgt_lum = float(tgt @ np.array([0.2126, 0.7152, 0.0722]))
        tgt_chroma = tgt / tgt_lum
        # keep 35 % of the scan's local chroma deviation (grain colour), rest = target hue
        ch = tgt_chroma * (1.0 + 0.35 * (chroma / chroma_mean - 1.0))
        out = np.clip(ch * (tgt_lum * rel)[..., None], 0, 1)
        rough = np.asarray(img(z, asset, "Roughness", "L").resize((size, size), Image.LANCZOS), dtype=np.float64) / 255
        rough = np.clip(r_mean + r_gain * (rough - rough.mean()), 0.04, 1.0)
        rgba = np.dstack([lin_to_srgb(out), rough])
        Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / f"{name}_albedo_rough.png", optimize=True)
        # normal maps of the scans at 1024: 1-1.6 mm/texel at the tiling used is enough for micro
        # relief and saves ~4 MB of VRAM / APK per set (measured APK 162 MB with 2048 normals)
        nsize = min(size, 1024)
        nrm = img(z, asset, "NormalGL", "RGB").resize((nsize, nsize), Image.LANCZOS)
        nrm.save(OUT / f"{name}_normal.png", optimize=True)
        got = lin_to_srgb(out.reshape(-1, 3).mean(0))
        report[name] = {"source": asset, "target_srgb": target, "result_mean_srgb": "#%02X%02X%02X" % tuple((got * 255 + .5).astype(int)),
                        "source_mean_srgb": "#%02X%02X%02X" % tuple((lin_to_srgb(mean) * 255 + .5).astype(int)),
                        "roughness_mean": round(float(rough.mean()), 3), "size": size, "normal_size": nsize}
        lic[asset] = {"purpose": f"monument v3: {name}", **meta}
        print(name, report[name], flush=True)
    LIC.write_text(json.dumps(lic, indent=1, ensure_ascii=False))
    (ROOT / "docs" / "reports" / "monument_v3_textures.json").write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
