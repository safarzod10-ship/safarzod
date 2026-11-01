"""Fetch real elevation (AWS Terrain Tiles, "terrarium" encoding) around the
monument and resample it into the game's local metric frame.

  /opt/dushanbe-venv/bin/python -I tools/geodata/fetch_dem.py [cache_dir]

Outputs (cache_dir, default /opt/dl/dem; NOT committed, reproducible):
  local_dem.npy    2 m grid, +-1600 m   (z15 tiles, SRTM-derived ~30 m source)
  region_dem.npy   120 m grid, +-62 km  (z11 tiles)
  dem_meta.json    grid definitions + tile SHA-256
Elevation data: Mapzen/AWS Terrain Tiles (SRTM, NASA public domain; see
https://github.com/tilezen/joerd/blob/master/docs/attribution.md).
"""
from __future__ import annotations

import hashlib
import io
import json
import math
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/dl/dem")
LAYOUT = json.loads((ROOT / "assets/world/osm_layout.json").read_text())
LAT0, LON0 = LAYOUT["origin_latlon"]
R = 6378137.0
K_LAT = math.radians(1) * R
K_LON = math.radians(1) * R * math.cos(math.radians(LAT0))
tiles_meta = {}


def tile_xy(lat, lon, z):
    n = 2 ** z
    x = (lon + 180) / 360 * n
    la = np.radians(lat)
    y = (1 - np.log(np.tan(la) + 1 / np.cos(la)) / math.pi) / 2 * n
    return x, y


def get_tile(z, x, y) -> np.ndarray:
    f = CACHE / f"t{z}_{x}_{y}.png"
    if not f.exists():
        url = f"https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
        f.write_bytes(urllib.request.urlopen(url, timeout=60).read())
    data = f.read_bytes()
    tiles_meta[f.name] = hashlib.sha256(data).hexdigest()
    a = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def sample_grid(z, half_m, step_m):
    """Bilinear-sample elevation on a local grid (rows = z/south, cols = x/east)."""
    n = int(round(2 * half_m / step_m)) + 1
    xs = np.linspace(-half_m, half_m, n)
    zs = np.linspace(-half_m, half_m, n)
    X, Zs = np.meshgrid(xs, zs)
    lat = LAT0 - Zs / K_LAT
    lon = LON0 + X / K_LON
    tx, ty = tile_xy(lat, lon, z)
    px, py = tx * 256 - 0.5, ty * 256 - 0.5
    x0, y0 = np.floor(px).astype(int), np.floor(py).astype(int)
    need = {(int(a) // 256, int(b) // 256) for a in (x0.min(), x0.max() + 1) for b in (y0.min(), y0.max() + 1)}
    txs = range(min(t[0] for t in need), max(t[0] for t in need) + 1)
    tys = range(min(t[1] for t in need), max(t[1] for t in need) + 1)
    mosaic = np.zeros((len(tys) * 256, len(txs) * 256))
    for j, ty_ in enumerate(tys):
        for i, tx_ in enumerate(txs):
            mosaic[j * 256:(j + 1) * 256, i * 256:(i + 1) * 256] = get_tile(z, tx_, ty_)
    ox, oy = txs[0] * 256, tys[0] * 256
    fx, fy = px - ox, py - oy
    ix, iy = np.clip(np.floor(fx).astype(int), 0, mosaic.shape[1] - 2), np.clip(np.floor(fy).astype(int), 0, mosaic.shape[0] - 2)
    wx, wy = fx - ix, fy - iy
    v = (mosaic[iy, ix] * (1 - wx) * (1 - wy) + mosaic[iy, ix + 1] * wx * (1 - wy)
         + mosaic[iy + 1, ix] * (1 - wx) * wy + mosaic[iy + 1, ix + 1] * wx * wy)
    return v.astype(np.float32), {"zoom": z, "half_extent_m": half_m, "step_m": step_m, "n": n,
                                  "tiles": len(txs) * len(tys)}


def main():
    CACHE.mkdir(parents=True, exist_ok=True)
    local, lm = sample_grid(15, 1600.0, 2.0)
    region, rm = sample_grid(11, 62000.0, 120.0)
    np.save(CACHE / "local_dem.npy", local)
    np.save(CACHE / "region_dem.npy", region)
    c = local.shape[0] // 2
    meta = {"origin_latlon": [LAT0, LON0], "local": lm, "region": rm,
            "elevation_at_origin_m": float(local[c, c]),
            "local_min_max": [float(local.min()), float(local.max())],
            "local_600m_min_max": [float(local[c - 150:c + 151, c - 150:c + 151].min()),
                                   float(local[c - 150:c + 151, c - 150:c + 151].max())],
            "region_min_max": [float(region.min()), float(region.max())],
            "source": "AWS Terrain Tiles (terrarium), SRTM-derived", "tiles_sha256": tiles_meta}
    (CACHE / "dem_meta.json").write_text(json.dumps(meta, indent=1))
    print(json.dumps({k: v for k, v in meta.items() if k != "tiles_sha256"}, indent=1))


if __name__ == "__main__":
    main()
