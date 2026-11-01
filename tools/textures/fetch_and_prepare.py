"""Download CC0 source textures (ambientCG) and build the game-ready set.

  /opt/dushanbe-venv/bin/python -I tools/textures/fetch_and_prepare.py [download_dir]

* Sources: ambientCG 1K-JPG archives (CC0 1.0, https://ambientcg.com/license).
  Archives stay OUTSIDE the repository (default /opt/dl/textures); SHA-256 of
  every archive is written to assets/textures/LICENSES.json.
* Output (committed, assets/textures/...): <name>_albedo_rough.png (RGB albedo,
  A = roughness) + <name>_normal.png (OpenGL). Foliage atlases are generated
  from individual-leaf scans (leaf clusters) or procedurally (scale foliage).
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import random
import sys
import urllib.request
import zipfile
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "assets" / "textures"
DL = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/dl/textures")

SOURCES = {  # asset id: purpose
    "Grass004": "terrain green grass (irrigated lawns, parks)",
    "Ground109": "terrain dry loess soil",
    "Ground110": "terrain compacted gravel / dirt (future road corridors, paths)",
    "Rock030": "rock (mountain foothills, boulders)",
    "Marble019": "monument light stone",
    "Marble016": "monument dark polished stone",
    "Bark012": "bark, dark furrowed (elm / karagach)",
    "Bark004": "bark, light smooth (poplar, plane tree)",
    "LeafSet024": "individual leaf scans -> broadleaf clusters",
    "LeafSet018": "individual leaf scans -> elongated leaf clusters",
}
LICENSES = {}


def fetch(asset: str) -> zipfile.ZipFile:
    DL.mkdir(parents=True, exist_ok=True)
    f = DL / f"{asset}_1K-JPG.zip"
    if not f.exists():
        url = f"https://ambientcg.com/get?file={asset}_1K-JPG.zip"
        req = urllib.request.Request(url, headers={"User-Agent": "DUSHANBE-asset-pipeline"})
        f.write_bytes(urllib.request.urlopen(req, timeout=120).read())
    data = f.read_bytes()
    LICENSES[asset] = {"purpose": SOURCES[asset], "url": f"https://ambientcg.com/view?id={asset}",
                       "archive": f.name, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                       "license": "CC0 1.0 Universal (ambientCG)"}
    return zipfile.ZipFile(io.BytesIO(data))


def mapimg(z: zipfile.ZipFile, asset: str, kind: str, mode="RGB") -> Image.Image | None:
    name = f"{asset}_1K-JPG_{kind}.jpg"
    if name not in z.namelist():
        return None
    return Image.open(io.BytesIO(z.read(name))).convert(mode)


def save_pbr(name: str, sub: str, albedo: Image.Image, rough: Image.Image, normal: Image.Image, size=1024, nsize=None):
    d = OUT / sub
    d.mkdir(parents=True, exist_ok=True)
    a = albedo.resize((size, size), Image.LANCZOS)
    r = rough.resize((size, size), Image.LANCZOS)
    a.putalpha(r)
    a.save(d / f"{name}_albedo_rough.png", optimize=True)
    normal.resize((size, size), Image.LANCZOS).save(d / f"{name}_normal.png", optimize=True)


def pbr_from(asset: str, name: str, sub: str, size=1024, grade=None, nsize=None):
    z = fetch(asset)
    col = mapimg(z, asset, "Color")
    if grade:
        col = grade(col)
    save_pbr(name, sub, col, mapimg(z, asset, "Roughness", "L"), mapimg(z, asset, "NormalGL"), size, nsize)
    return z


def dry_grass_grade(img: Image.Image) -> Image.Image:
    """Late-spring/summer unirrigated grass: shift green towards straw, keep detail."""
    g = ImageEnhance.Color(img).enhance(0.45)
    r, gg, b = g.split()
    r = r.point(lambda v: min(255, int(v * 1.22 + 14)))
    gg = gg.point(lambda v: min(255, int(v * 1.08 + 8)))
    b = b.point(lambda v: int(v * 0.78))
    return ImageEnhance.Brightness(Image.merge("RGB", (r, gg, b))).enhance(1.05)


def leaf_sprites(asset: str) -> list[Image.Image]:
    z = fetch(asset)
    col = mapimg(z, asset, "Color")
    op = mapimg(z, asset, "Opacity", "L")
    rgba = col.copy()
    rgba.putalpha(op)
    bbox_mask = op.point(lambda v: 255 if v > 40 else 0)
    sprites = []
    # split the atlas into its leaves via connected bounding boxes of columns/rows
    cols = 3 if asset == "LeafSet024" else 3
    rows = 3 if asset == "LeafSet024" else 1
    w, h = col.size
    for j in range(rows):
        for i in range(cols):
            box = (i * w // cols, j * h // rows, (i + 1) * w // cols, (j + 1) * h // rows)
            cell = rgba.crop(box)
            bb = bbox_mask.crop(box).getbbox()
            if bb:
                sprites.append(cell.crop(bb))
    return sprites


def cluster_atlas(name: str, sprites, leaf_px, n_leaves, tint, seed, shape="round"):
    """2x2 atlas (1024) of leaf-cluster cards with soft self-shadowing towards the centre."""
    rnd = random.Random(seed)
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for cell in range(4):
        card = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        twig = ImageDraw.Draw(card)
        cx, cy = 256, 300
        # twigs radiating from the card base
        for _ in range(7):
            ang = rnd.uniform(-2.3, -0.8)
            x2, y2 = cx + math.cos(ang) * rnd.uniform(120, 220), cy + math.sin(ang) * rnd.uniform(120, 220)
            twig.line([(256, 500), (cx, cy), (x2, y2)], fill=(74, 58, 40, 255), width=4)
        for _ in range(n_leaves):
            if shape == "column":
                px, py = rnd.gauss(256, 70), rnd.gauss(250, 140)
            else:
                a, rr = rnd.uniform(0, math.tau), abs(rnd.gauss(0, 1)) * 150
                px, py = 256 + math.cos(a) * rr, 250 + math.sin(a) * rr * 0.9
            sp = rnd.choice(sprites)
            s = leaf_px * rnd.uniform(0.75, 1.25) / max(sp.size)
            leaf = sp.resize((max(4, int(sp.width * s)), max(4, int(sp.height * s))), Image.LANCZOS)
            leaf = leaf.rotate(rnd.uniform(0, 360), expand=True, resample=Image.BICUBIC)
            # colour variation + darker leaves deeper in the cluster (cheap baked AO)
            depth = min(1.0, math.hypot(px - 256, py - 250) / 200)
            k = (0.62 + 0.38 * depth) * rnd.uniform(0.88, 1.12)
            r, g, b, a_ = leaf.split()
            r = r.point(lambda v: min(255, int(v * k * tint[0])))
            g = g.point(lambda v: min(255, int(v * k * tint[1])))
            b = b.point(lambda v: min(255, int(v * k * tint[2])))
            leaf = Image.merge("RGBA", (r, g, b, a_))
            card.alpha_composite(leaf, (int(px - leaf.width / 2), int(py - leaf.height / 2)))
        atlas.paste(card, ((cell % 2) * 512, (cell // 2) * 512))
    _finish_foliage(name, atlas, rough=0.6)


def scale_foliage_atlas(name: str, seed: int):
    """Procedural flattened sprays of scale-like foliage (Platycladus / Thuja)."""
    rnd = random.Random(seed)
    atlas = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    for cell in range(4):
        card = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
        d = ImageDraw.Draw(card)

        def spray(x, y, ang, length, width, depth):
            if depth == 0 or length < 10:
                return
            steps = int(length / 6)
            for s in range(steps):
                t = s / steps
                px = x + math.cos(ang) * length * t
                py = y + math.sin(ang) * length * t
                w = width * (1 - t * 0.7)
                g = int(rnd.uniform(70, 110) * (0.75 + 0.25 * t))
                d.ellipse([px - w, py - w * 0.7, px + w, py + w * 0.7], fill=(int(g * 0.42), g, int(g * 0.38), 255))
                if s % 3 == 1:
                    for side in (-1, 1):
                        spray(px, py, ang + side * rnd.uniform(0.6, 0.9), length * 0.42, w * 0.8, depth - 1)
        for _ in range(3):
            spray(256 + rnd.uniform(-40, 40), 500, rnd.uniform(-1.9, -1.25), rnd.uniform(330, 420), 13, 3)
        card = card.filter(ImageFilter.SMOOTH)
        atlas.paste(card, ((cell % 2) * 512, (cell // 2) * 512))
    _finish_foliage(name, atlas, rough=0.7)


def _finish_foliage(name: str, atlas: Image.Image, rough: float):
    d = OUT / "foliage"
    d.mkdir(parents=True, exist_ok=True)
    # bleed colour into transparent texels so mipmaps do not darken leaf edges
    rgb = atlas.convert("RGB")
    a = atlas.getchannel("A")
    blurred = rgb.filter(ImageFilter.GaussianBlur(6))
    rgb = Image.composite(rgb, blurred, a.point(lambda v: 255 if v > 8 else 0))
    rgb.putalpha(a)
    rgb.save(d / f"{name}_albedo_alpha.png", optimize=True)


def main():
    pbr_from("Grass004", "grass_green", "terrain", nsize=512)
    pbr_from("Grass004", "grass_dry", "terrain", grade=dry_grass_grade, nsize=512)
    pbr_from("Ground109", "soil_loess", "terrain", nsize=512)
    pbr_from("Ground110", "gravel_dirt", "terrain", nsize=512)
    pbr_from("Rock030", "rock_grey", "terrain", nsize=512)
    pbr_from("Marble019", "stone_light", "monument", size=512)
    pbr_from("Marble016", "stone_dark", "monument", size=512)
    pbr_from("Bark012", "bark_dark", "bark", size=512)
    pbr_from("Bark004", "bark_light", "bark", size=512)
    broad = leaf_sprites("LeafSet024")
    long_ = leaf_sprites("LeafSet018")
    cluster_atlas("leaves_elm", broad, 46, 260, (0.78, 0.92, 0.70), 11)            # karagach: small dark leaves
    cluster_atlas("leaves_plane", broad, 74, 150, (0.95, 1.02, 0.80), 12)          # chinar: large light leaves
    cluster_atlas("leaves_poplar", broad, 40, 300, (0.92, 1.05, 0.78), 13, "column")
    cluster_atlas("leaves_shrub", long_, 44, 230, (0.80, 0.95, 0.72), 14)
    scale_foliage_atlas("leaves_thuja", 15)
    (OUT / "LICENSES.json").write_text(json.dumps(LICENSES, indent=1))
    print(json.dumps({k: v["sha256"][:12] for k, v in LICENSES.items()}))


if __name__ == "__main__":
    main()
