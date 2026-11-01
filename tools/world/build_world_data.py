"""Build the stage-2 world data from real sources (deterministic).

  /opt/dushanbe-venv/bin/python -I tools/world/build_world_data.py [dem_dir]

Inputs : assets/world/osm_layout.json (OSM), <dem_dir>/local_dem.npy (SRTM, 2 m grid +-1600 m)
Outputs: assets/world/world_config.json          frame, zones, chunks, bookmarks
         assets/world/terrain/heightmap_2m.bin   float32, (H x W) row = +Z (south), col = +X (east)
         assets/world/terrain/skirt_heights.bin  float32 16 m grid +-1600 m (outskirts / skirt mesh)
         assets/world/terrain/splat_1m.png       RGBA weights: R green grass, G dry grass, B soil, A gravel/paved
         assets/world/vegetation_instances.json  trees + shrubs (type, x, z, y, yaw, scale)
         docs/maps/world_zones.png               zone / vegetation map for review

Height pipeline (documented in docs/TERRAIN_SYSTEM.md):
  1. SRTM is a surface model: buildings/trees appear as 2-8 m bumps -> Gaussian sigma 24 m.
  2. y = 0 at the monument base (elevation subtracted, stored in world_config).
  3. Controlled micro-relief (fBm, 0.35 m @ ~40 m, 0.08 m @ ~8 m) only on unpaved ground.
  4. Paved / future-road corridors, the square and building pads are flattened towards a
     heavily smoothed (sigma 50 m) surface so future roads/buildings sit on even ground.
"""
from __future__ import annotations

import json
import math
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[2]
DEM = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("/opt/dl/dem")
OUTW = ROOT / "assets" / "world"
TER = OUTW / "terrain"
TER.mkdir(parents=True, exist_ok=True)

PLAY_HALF = 300.0       # playable 600 x 600 m
WORLD_HALF = 400.0      # detailed terrain (+100 m visual margin)
CHUNK = 100.0
STEP = 2.0              # terrain grid
SPLAT_RES = 1.0         # m / px
SEED = 2026

LAY = json.loads((OUTW / "osm_layout.json").read_text())
ROAD_HALF = {"trunk": 6.5, "trunk_link": 4.0, "primary": 6.0, "secondary": 5.0, "tertiary": 4.5,
             "residential": 3.5, "unclassified": 3.5, "service": 2.5, "living_street": 3.0,
             "pedestrian": 3.0, "footway": 1.4, "path": 1.0, "cycleway": 1.2, "steps": 1.4, "track": 2.0}
PAVED_AREAS = {"fountain", "basin", "parking", "monument", "pedestrian"}
GREEN_AREAS = {"park", "grass", "garden", "recreation_ground", "village_green"}


# ------------------------------------------------------------------ raster helpers
def raster(n_px, half, res):
    img = Image.new("L", (n_px, n_px), 0)
    return img, ImageDraw.Draw(img), (lambda p: ((p[0] + half) / res, (p[1] + half) / res))


def poly_mask(polys, half, res, n):
    img, d, px = raster(n, half, res)
    for p in polys:
        if len(p) >= 3:
            d.polygon([px(q) for q in p], fill=255)
    return np.asarray(img) > 0


def line_mask(lines, half, res, n, widths):
    img, d, px = raster(n, half, res)
    for p, w in zip(lines, widths):
        if len(p) >= 2:
            d.line([px(q) for q in p], fill=255, width=max(1, int(round(2 * w / res))), joint="curve")
            for q in (p[0], p[-1]):
                c = px(q)
                r = w / res
                d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=255)
    return np.asarray(img) > 0


def fbm(shape, cell_px, octaves, seed):
    rng = np.random.default_rng(seed)
    out = np.zeros(shape, np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        c = max(2, int(cell_px / (2 ** o)))
        g = rng.standard_normal((shape[0] // c + 3, shape[1] // c + 3)).astype(np.float32)
        z = ndimage.zoom(g, c, order=3)[: shape[0], : shape[1]]
        out += z * amp
        tot += amp
        amp *= 0.5
    return out / tot


# ------------------------------------------------------------------ height
def build_heights():
    local = np.load(DEM / "local_dem.npy")                      # 2 m, +-1600 m, 1601 x 1601
    n_full = local.shape[0]
    filled = local.copy()
    med = ndimage.median_filter(local, size=9)
    bad = np.abs(local - med) > 25                               # SRTM voids / spikes
    filled[bad] = med[bad]
    smooth = ndimage.gaussian_filter(filled, sigma=12)          # 12 px * 2 m = 24 m
    very = ndimage.gaussian_filter(filled, sigma=25)            # 50 m, for paved corridors
    c = n_full // 2
    base = float(smooth[c, c])
    # crop detailed window
    k = int(WORLD_HALF / STEP)
    sl = slice(c - k, c + k + 1)
    h = smooth[sl, sl] - base
    hv = very[sl, sl] - base
    n = h.shape[0]
    # masks at terrain resolution
    paved, roads_w = paved_masks(WORLD_HALF, STEP, n)
    micro = fbm((n, n), 20, 3, SEED) * 0.35 + fbm((n, n), 4, 2, SEED + 1) * 0.08
    paved_soft = ndimage.gaussian_filter(paved.astype(np.float32), sigma=2.0)
    h = h + micro * (1.0 - paved_soft)
    h = h * (1.0 - paved_soft) + hv * paved_soft
    # the square is perfectly level at the monument base
    yy, xx = np.mgrid[0:n, 0:n]
    r = np.hypot((xx - k) * STEP, (yy - k) * STEP)
    sq = np.clip((85.0 - r) / 15.0, 0, 1)
    h = h * (1 - sq) + 0.0 * sq
    # skirt heights (outskirts, 16 m grid, +-1600 m)
    skirt = ndimage.gaussian_filter(filled, sigma=16)[::8, ::8] - base
    return h.astype(np.float32), skirt.astype(np.float32), base, {
        "srtm_voids_fixed": int(bad.sum()), "base_elevation_m": round(base, 2),
        "range_detailed_m": [round(float(h.min()), 2), round(float(h.max()), 2)],
        "range_playable_m": [round(float(h[k - 150:k + 151, k - 150:k + 151].min()), 2),
                             round(float(h[k - 150:k + 151, k - 150:k + 151].max()), 2)]}


def roads(min_types=None):
    out = []
    for rd in LAY["roads"]:
        if rd.get("area"):
            continue
        w = ROAD_HALF.get(rd["type"], 1.2)
        try:
            w = max(w, float(rd["width"]) / 2) if rd.get("width") else w
        except ValueError:
            pass
        out.append((rd["pts"], w, rd["type"]))
    return out


def paved_masks(half, res, n):
    rd = [r for r in roads() if r[2] not in ("footway", "path", "steps", "cycleway")]
    m = line_mask([r[0] for r in rd], half, res, n, [r[1] + 1.0 for r in rd])
    areas = [a["pts"] for a in LAY["areas"] if a["kind"] in PAVED_AREAS and a["closed"]]
    areas += [b["pts"] for b in LAY["buildings"]]
    m |= poly_mask(areas, half, res, n)
    m |= poly_mask([r["pts"] for r in LAY["roads"] if r.get("area")], half, res, n)
    return m, rd


# ------------------------------------------------------------------ splat
def build_splat():
    half, res = WORLD_HALF, SPLAT_RES
    n = int(2 * half / res)
    rd_all = roads()
    car = [r for r in rd_all if r[2] not in ("footway", "path", "steps", "cycleway", "pedestrian")]
    foot = [r for r in rd_all if r[2] in ("footway", "path", "steps", "cycleway", "pedestrian")]
    m_car = line_mask([r[0] for r in car], half, res, n, [r[1] + 1.5 for r in car])
    m_foot = line_mask([r[0] for r in foot], half, res, n, [r[1] for r in foot])
    m_green = poly_mask([a["pts"] for a in LAY["areas"] if a["kind"] in GREEN_AREAS and a["closed"]], half, res, n)
    m_paved_area = poly_mask([a["pts"] for a in LAY["areas"] if a["kind"] in PAVED_AREAS and a["closed"]]
                             + [r["pts"] for r in LAY["roads"] if r.get("area")], half, res, n)
    m_build = poly_mask([b["pts"] for b in LAY["buildings"]], half, res, n)
    m_water = poly_mask([w["pts"] for w in LAY["water"] if len(w["pts"]) > 3], half, res, n)
    yy, xx = np.mgrid[0:n, 0:n]
    X, Z = xx * res - half + res / 2, yy * res - half + res / 2
    m_square = np.hypot(X, Z) < 80
    noise_a = fbm((n, n), 40, 4, SEED + 5)
    noise_b = fbm((n, n), 12, 3, SEED + 6)
    paved = m_car | m_paved_area | m_square | m_water
    # base: unmanaged ground = dry grass with soil patches
    # late April: unmanaged ground is a mix of dry grass, young green weeds and loess soil
    soil = np.clip(0.35 + noise_a * 0.9, 0, 1) * 0.45
    green = np.clip(0.25 + noise_b * 0.6, 0, 0.55).astype(np.float32)
    dry = np.clip(1.0 - soil - green, 0, 1)
    gravel = np.zeros((n, n), np.float32)
    # irrigated lawns / park
    g = m_green & ~paved
    green[g] = np.clip(0.85 + noise_b[g] * 0.4, 0.4, 1.0)
    dry[g] = 1.0 - green[g]
    soil[g] = np.clip(noise_a[g] * 0.5 - 0.15, 0, 0.3)
    # building pads (future buildings): bare soil
    soil[m_build] = 1.0; dry[m_build] = 0.0; green[m_build] = 0.0
    # footpaths: compacted gravel/dirt
    gravel[m_foot] = 1.0
    # carriageways, square, paved areas: gravel placeholder for future paving
    gravel[paved] = 1.0
    shoulder = ndimage.binary_dilation(paved | m_foot | m_build, iterations=2) & ~(paved | m_foot | m_build)
    soil[shoulder] = np.maximum(soil[shoulder], 0.7)
    w = np.stack([green, dry, soil, gravel], -1)
    w[gravel > 0.5] = [0, 0, 0, 1]
    w = ndimage.gaussian_filter(w, sigma=(0.8, 0.8, 0))
    w /= np.maximum(w.sum(-1, keepdims=True), 1e-6)
    masks = {"car": m_car, "foot": m_foot, "green": m_green & ~paved, "build": m_build, "paved": paved,
             "square": m_square, "water": m_water}
    return (w * 255).round().astype(np.uint8), masks


# ------------------------------------------------------------------ vegetation
def poisson(rng, mask, spacing, half, res, limit=200000):
    """Simple dart throwing on a boolean mask (metres)."""
    n = mask.shape[0]
    cand = np.argwhere(mask)
    rng.shuffle(cand)
    cell = spacing / math.sqrt(2)
    grid = {}
    pts = []
    for (iy, ix) in cand[:limit]:
        x = ix * res - half + rng.uniform(0, res)
        z = iy * res - half + rng.uniform(0, res)
        gx, gz = int(x // cell), int(z // cell)
        ok = True
        for dx in (-2, -1, 0, 1, 2):
            for dz in (-2, -1, 0, 1, 2):
                q = grid.get((gx + dx, gz + dz))
                if q and (q[0] - x) ** 2 + (q[1] - z) ** 2 < spacing * spacing:
                    ok = False
                    break
            if not ok:
                break
        if ok:
            grid[(gx, gz)] = (x, z)
            pts.append((x, z))
    return pts


def along(rng, line, step, offset, jitter):
    out = []
    for a, b in zip(line[:-1], line[1:]):
        ax, az = a
        bx, bz = b
        L = math.hypot(bx - ax, bz - az)
        if L < 1e-3:
            continue
        nx, nz = -(bz - az) / L, (bx - ax) / L
        t = rng.uniform(0, step)
        while t < L:
            for side in (-1, 1):
                px = ax + (bx - ax) * t / L + nx * offset * side + rng.normal(0, jitter)
                pz = az + (bz - az) * t / L + nz * offset * side + rng.normal(0, jitter)
                out.append((px, pz))
            t += step * rng.uniform(0.85, 1.15)
    return out


def build_vegetation(masks, heights):
    rng = np.random.default_rng(SEED)
    half, res = WORLD_HALF, SPLAT_RES
    free = ~(masks["paved"] | masks["foot"] | masks["build"] | masks["square"] | masks["water"])
    free_tree = ndimage.binary_erosion(free, iterations=3)       # trunks >= 3 m from hard edges
    free_shrub = ndimage.binary_erosion(free, iterations=1)

    def ok(p, m):
        ix, iy = int((p[0] + half) / res), int((p[1] + half) / res)
        return 0 <= ix < m.shape[1] and 0 <= iy < m.shape[0] and m[iy, ix]

    trees = []
    # 1) avenue rows along carriageways (Soviet-era plantings: plane trees + pyramidal poplars)
    for pts, w, t in roads():
        if t in ("trunk", "tertiary", "residential", "primary", "secondary"):
            for p in along(rng, pts, 9.0, w + 4.5, 0.4):
                if ok(p, free_tree):
                    trees.append((p, "plane" if rng.random() < 0.55 else "poplar"))
        if t in ("footway", "path", "pedestrian") and any(ok(q, masks["green"]) for q in pts[::3]):
            for p in along(rng, pts, 8.0, w + 3.5, 0.5):
                if ok(p, free_tree) and ok(p, masks["green"]):
                    trees.append((p, rng.choice(["plane", "elm", "elm", "thuja"])))
    # 2) parks and lawns: Poisson clusters
    for p in poisson(rng, free_tree & masks["green"], 11.0, half, res):
        if rng.random() < 0.55:
            trees.append((p, rng.choice(["plane", "elm", "elm", "thuja", "poplar"])))
    # 3) unmanaged land: sparse elms / poplars
    for p in poisson(rng, free_tree & ~masks["green"], 26.0, half, res):
        if rng.random() < 0.35:
            trees.append((p, "elm" if rng.random() < 0.7 else "poplar"))
    # remove trees too close to each other
    kept = []
    grid = {}
    for p, sp in trees:
        g = (int(p[0] // 4), int(p[1] // 4))
        if any((q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 < 4.5 ** 2
               for dx in (-1, 0, 1) for dz in (-1, 0, 1) for q in grid.get((g[0] + dx, g[1] + dz), [])):
            continue
        grid.setdefault(g, []).append(p)
        kept.append((p, sp))
    shrubs = []
    for pts, w, t in roads():
        if t in ("footway", "path", "pedestrian"):
            for p in along(rng, pts, 3.2, w + 1.4, 0.2):
                if ok(p, free_shrub) and ok(p, masks["green"]) and rng.random() < 0.45:
                    shrubs.append((p, "boxwood" if rng.random() < 0.6 else "juniper"))
    for a in np.linspace(0, math.tau, 90, endpoint=False):           # clipped ring around the square
        p = (math.cos(a) * 84.0, math.sin(a) * 84.0)
        if ok(p, free_shrub):
            shrubs.append((p, "boxwood"))
    for p in poisson(rng, free_shrub & masks["green"], 7.0, half, res):
        if rng.random() < 0.3:
            shrubs.append((p, rng.choice(["boxwood", "juniper", "rose"])))
    for p in poisson(rng, free_shrub & ~masks["green"], 14.0, half, res):
        if rng.random() < 0.25:
            shrubs.append((p, "juniper"))

    k = heights.shape[0] // 2

    def hy(p):
        fx, fz = p[0] / STEP + k, p[1] / STEP + k
        ix, iz = int(np.clip(fx, 0, heights.shape[1] - 2)), int(np.clip(fz, 0, heights.shape[0] - 2))
        tx, tz = fx - ix, fz - iz
        return float(heights[iz, ix] * (1 - tx) * (1 - tz) + heights[iz, ix + 1] * tx * (1 - tz)
                     + heights[iz + 1, ix] * (1 - tx) * tz + heights[iz + 1, ix + 1] * tx * tz)

    SCALE = {"plane": (0.8, 1.25), "elm": (0.75, 1.2), "poplar": (0.85, 1.15), "thuja": (0.7, 1.3),
             "boxwood": (0.7, 1.3), "juniper": (0.7, 1.4), "rose": (0.8, 1.2)}

    def rec(p, sp):
        lo, hi = SCALE[sp]
        return {"t": sp, "x": round(p[0], 2), "z": round(p[1], 2), "y": round(hy(p), 3),
                "yaw": round(float(rng.uniform(0, 360)), 1), "s": round(float(rng.uniform(lo, hi)), 3)}
    inside = lambda p: abs(p[0]) < half - 1 and abs(p[1]) < half - 1
    return ([rec(p, s) for p, s in kept if inside(p)], [rec(p, s) for p, s in shrubs if inside(p)])


# ------------------------------------------------------------------ main
def main():
    h, skirt, base, hstats = build_heights()
    splat, masks = build_splat()
    trees, shrubs = build_vegetation(masks, h)
    (TER / "heightmap_2m.bin").write_bytes(h.astype("<f4").tobytes())
    (TER / "skirt_heights.bin").write_bytes(skirt.astype("<f4").tobytes())
    Image.fromarray(splat, "RGBA").save(TER / "splat_1m.png", optimize=True)
    veg = {"format_version": 1, "seed": SEED, "trees": trees, "shrubs": shrubs,
           "note": "Generated by tools/world/build_world_data.py from OSM layout + SRTM heights."}
    (OUTW / "vegetation_instances.json").write_text(json.dumps(veg, separators=(",", ":")))

    n = h.shape[0]
    chunks = []
    nc = int(2 * WORLD_HALF / CHUNK)
    for j in range(nc):
        for i in range(nc):
            x0, z0 = -WORLD_HALF + i * CHUNK, -WORLD_HALF + j * CHUNK
            playable = (x0 + CHUNK > -PLAY_HALF and x0 < PLAY_HALF and z0 + CHUNK > -PLAY_HALF and z0 < PLAY_HALF)
            chunks.append({"id": f"Chunk_{i}_{j}", "x0": x0, "z0": z0, "size": CHUNK, "playable": playable})

    def bbox_of(kind=None, name=None, src="areas"):
        for a in LAY[src]:
            if (kind is None or a.get("kind") == kind or a.get("type") == kind) and (name is None or name in a.get("name", "")):
                xs = [p[0] for p in a["pts"]]
                zs = [p[1] for p in a["pts"]]
                return [round(min(xs), 1), round(min(zs), 1), round(max(xs), 1), round(max(zs), 1)]
        return None
    fountains = [a for a in LAY["areas"] if a["kind"] in ("fountain", "basin")]
    fx = [p[0] for a in fountains for p in a["pts"]]
    fz = [p[1] for a in fountains for p in a["pts"]]
    cfg = {
        "format_version": 1,
        "units": "metres",
        "frame": {"origin": "centroid of the Ismoili Somoni monument footprint (OSM way 1375034135)",
                  "origin_latlon": LAY["origin_latlon"], "origin_elevation_m": round(base, 2),
                  "axes": {"+X": "east", "-X": "west", "-Z": "north", "+Z": "south", "+Y": "up"},
                  "projection": "local equirectangular (error < 1 cm over 1 km)"},
        "bounds": {"playable": [-PLAY_HALF, -PLAY_HALF, PLAY_HALF, PLAY_HALF],
                   "detailed_terrain": [-WORLD_HALF, -WORLD_HALF, WORLD_HALF, WORLD_HALF],
                   "outskirts": [-1600, -1600, 1600, 1600], "mountain_backdrop_radius_m": 60000},
        "terrain": {"chunk_size_m": CHUNK, "grid_step_m": STEP, "chunks_per_side": nc,
                    "heightmap": "res://assets/world/terrain/heightmap_2m.bin", "heightmap_size": [n, n],
                    "splat": "res://assets/world/terrain/splat_1m.png", "splat_res_m": SPLAT_RES,
                    "skirt_heights": "res://assets/world/terrain/skirt_heights.bin", "skirt_size": list(skirt.shape),
                    "skirt_step_m": 16.0, "skirt_half_m": 1600.0, **hstats},
        "chunks": chunks,
        "zones": [
            {"id": "somoni_square", "kind": "plaza_future", "center": [0, 0], "radius": 80,
             "note": "level at y=0; monument at origin, statue faces west"},
            {"id": "fountain_axis", "kind": "plaza_future", "rect": [round(min(fx), 1), round(min(fz), 1), round(max(fx), 1), round(max(fz), 1)]},
            {"id": "rudaki_park", "kind": "park", "rect": bbox_of("park")},
            {"id": "rudaki_avenue", "kind": "road_future", "rect": [88, -400, 140, 400],
             "note": "dual carriageway, OSM trunk; continues NE beyond x>120"},
            {"id": "east_open_land", "kind": "open_land", "rect": [150, -300, 300, 120]},
            {"id": "south_blocks", "kind": "buildings_future", "rect": [-300, 60, 150, 300]},
        ],
        "monument": {"position": [0, 0, 0], "rotation_y_deg": -90.0},
        "spawn_points": {"default": [-120, 1.7, 30], "square": [-60, 1.7, 0]},
        "camera_bookmarks": {   # [x, height above terrain, z, yaw_deg (0 = north, 90 = west, -90 = east), pitch_deg]
            "overview": [-260, 120, 260, -45, -22], "square": [-95, 6, 8, -90, -4],
            "park": [-40, 2, -150, 20, -2], "mountains_north": [0, 30, 260, 0, 2],
            "trees_closeup": [-60, 3, -110, 0, -6], "east_land": [220, 4, 40, 60, -5]},
        "sources": {"layout": "OpenStreetMap (ODbL), assets/world/osm_layout.json",
                    "elevation": "AWS Terrain Tiles / SRTM (tools/geodata/fetch_dem.py)"},
        "vegetation": {"trees": len(trees), "shrubs": len(shrubs)},
    }
    (OUTW / "world_config.json").write_text(json.dumps(cfg, indent=1, ensure_ascii=False))
    # review map
    img = Image.fromarray(np.dstack([
        np.clip(splat[..., 1] * 0.8 + splat[..., 2] * 0.7 + splat[..., 3] * 0.6, 0, 255),
        np.clip(splat[..., 0] * 0.75 + splat[..., 1] * 0.7 + splat[..., 2] * 0.55 + splat[..., 3] * 0.6, 0, 255),
        np.clip(splat[..., 0] * 0.25 + splat[..., 1] * 0.3 + splat[..., 2] * 0.35 + splat[..., 3] * 0.6, 0, 255)]).astype(np.uint8))
    d = ImageDraw.Draw(img)
    col = {"plane": (20, 90, 20), "elm": (10, 60, 10), "poplar": (60, 120, 30), "thuja": (0, 50, 30)}
    for t in trees:
        x, z = t["x"] + half_px(), t["z"] + half_px()
        d.ellipse([x - 2.5, z - 2.5, x + 2.5, z + 2.5], fill=col[t["t"]])
    for s in shrubs:
        x, z = s["x"] + half_px(), s["z"] + half_px()
        d.point((x, z), fill=(120, 40, 120))
    d.rectangle([WORLD_HALF - PLAY_HALF, WORLD_HALF - PLAY_HALF, WORLD_HALF + PLAY_HALF, WORLD_HALF + PLAY_HALF], outline=(220, 30, 30), width=2)
    img.save(ROOT / "docs" / "maps" / "world_zones.png")
    print(json.dumps({**hstats, "trees": len(trees), "shrubs": len(shrubs), "chunks": len(chunks),
                      "tree_types": {t: sum(1 for x in trees if x["t"] == t) for t in col}}, ensure_ascii=False))


def half_px():
    return WORLD_HALF / SPLAT_RES


if __name__ == "__main__":
    main()
