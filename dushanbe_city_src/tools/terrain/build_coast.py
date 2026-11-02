#!/usr/bin/env python3
"""DUSHANBE coast: turns the 600x600 m district into the centre of an urban PENINSULA.

The city (|x|,|z| <= 300) is untouched. Around it, by distance from the city edge:
green belt with hills -> beaches / rocky capes -> sea. To the north (-Z) the land continues as an
isthmus to the mainland (towards the mountains). Everything is derived from one coastline function
C(azimuth) and one height function, so mesh, collision, splat weights, water depth, vegetation,
paths and the minimap always agree.

Outputs (all deterministic):
  dushanbe_city/assets/terrain/coast_<i>_<j>.glb   400 m terrain tiles, material "terrain",
        vertex colour = splat weights R sand, G rock, B earth/path, A asphalt (grass = remainder)
  dushanbe_city/assets/terrain/promenade.glb       paved promenade strip with curb (south bay)
  dushanbe_city/data/city/chunk_coast_<i>_<j>.json loaded by CityWorld like city chunks
        (trees with y, boulders, benches, lamps, lights, colliders)
  dushanbe_city/data/terrain/height.bin + terrain.json   collision heightmap (float32, 4 m grid)
  dushanbe_city/assets/terrain/sea_mask.png         R = water depth (0..12 m), G = shore proximity (foam)
  dushanbe_city/assets/ui/minimap.png               prebaked top-down map (+-1024 m, 1 px = 1 m)
  dushanbe_city/data/terrain/bounds.json            playable boundary polyline (wading depth 0.9 m)
Usage: python3 build_coast.py
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "city"))
import meshkit as mk

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
GAME = os.path.join(ROOT, "dushanbe_city")
CITY = json.load(open(os.path.join(GAME, "data/city/city.json")))

HALF = 300.0          # city half size
SEA = -1.6            # sea level (city ground is 0)
WADE = 0.9            # playable wading depth
STEP = 4.0            # height grid / collision resolution (m)
EXT = 2400.0          # terrain extent (+-)
TILE = 400.0          # terrain tile / coast chunk size (fewer draw calls)


# ------------------------------------------------------------------------------------- noise
def _lattice(seed, n=256):
    return np.random.default_rng(seed).random((n, n)).astype(np.float64)


_LAT = {}


def vnoise(x, z, freq, seed):
    """2D value noise in [0,1], smooth (smoothstep interpolation), tiles every 256 lattice cells."""
    g = _LAT.setdefault(seed, _lattice(seed))
    X = np.asarray(x, np.float64) * freq + 37.1
    Z = np.asarray(z, np.float64) * freq + 91.7
    xi = np.floor(X); zi = np.floor(Z)
    fx = X - xi; fz = Z - zi
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz)
    xi = xi.astype(np.int64) % 256; zi = zi.astype(np.int64) % 256
    x1 = (xi + 1) % 256; z1 = (zi + 1) % 256
    a = g[xi, zi]; b = g[x1, zi]; c = g[xi, z1]; d = g[x1, z1]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz


def fbm(x, z, freq, seed, oct=5, gain=0.5):
    v = 0.0; a = 1.0; s = 0.0
    for o in range(oct):
        v = v + a * vnoise(x, z, freq * (2 ** o), seed + o * 17)
        s += a; a *= gain
    return v / s


def noise1(t, n, seed):
    """periodic 1D value noise over t in [0,1) with n lattice points"""
    g = np.random.default_rng(seed).random(n)
    T = np.asarray(t, np.float64) * n
    i = np.floor(T); f = T - i
    f = f * f * (3 - 2 * f)
    i = i.astype(np.int64) % n
    return g[i] * (1 - f) + g[(i + 1) % n] * f


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------- coastline
def azimuth(x, z):
    """degrees clockwise from north (-Z): 0 = N, 90 = E (+X), 180 = S (+Z), 270 = W"""
    return np.degrees(np.arctan2(x, -z)) % 360.0


def city_dist(x, z, r=60.0):
    """signed distance to the rounded city square (negative inside)"""
    qx = np.abs(x) - (HALF - r); qz = np.abs(z) - (HALF - r)
    out = np.hypot(np.maximum(qx, 0), np.maximum(qz, 0))
    return out + np.minimum(np.maximum(qx, qz), 0) - r


def _gauss_az(az, center, width):
    d = (az - center + 180.0) % 360.0 - 180.0
    return np.exp(-0.5 * (d / width) ** 2)


# (azimuth, coast offset m, width deg, rocky 0..1)
FEATURES = [
    (180, -95, 16, 0.0),    # south bay: wide beach + promenade
    (100, 125, 11, 1.0),    # east cape (rocky)
    (140, 50, 9, 0.6),      # south-east headland
    (215, 105, 10, 1.0),    # south-west cape (rocky)
    (255, -65, 14, 0.0),    # west bay (beach)
    (300, 70, 8, 0.9),      # north-west rocky point
    (62, -40, 11, 0.0),     # north-east cove (beach)
]


def coast_offset(az):
    """distance of the shoreline from the city edge (m) as a function of azimuth"""
    t = np.radians(az)
    c = 175 + 34 * np.sin(2 * t + 1.3) + 22 * np.sin(3 * t + 0.4) + 12 * np.sin(5 * t + 2.0)
    for (a, off, w, _) in FEATURES:
        c = c + off * _gauss_az(az, a, w)
    c = c + (noise1(az / 360.0, 90, 3) - 0.5) * 26 + (noise1(az / 360.0, 400, 4) - 0.5) * 9 * rockiness(az)
    # isthmus: a neck towards the mainland in the north (bays left and right of it)
    da = np.abs((az + 180.0) % 360.0 - 180.0)
    c = c + 520.0 * smoothstep(30.0, 12.0, da)
    return np.maximum(c, 85.0)


def mainland_s(x, z):
    """metres inland from the mainland's south-facing coast (a wavy east-west line ~650 m north)"""
    zm = 650 + 85 * np.sin(x / 260.0 + 0.7) + 50 * np.sin(x / 113.0 + 2.1) + (vnoise(x, 0 * x, 1 / 70.0, 13) - 0.5) * 40
    return (-z) - zm


def rockiness(az):
    r = np.zeros_like(np.asarray(az, np.float64))
    for (a, off, w, rk) in FEATURES:
        r = np.maximum(r, rk * smoothstep(0.1, 0.8, _gauss_az(az, a, w * 1.5)))
    r = np.maximum(r, 0.85 * smoothstep(0.62, 0.9, noise1(az / 360.0, 36, 11)))
    return np.clip(r, 0, 1)


def fields(x, z):
    """height and helper fields for points (x, z)"""
    az = azimuth(x, z)
    e = city_dist(x, z)
    C = coast_offset(az)
    # rockiness averaged over an arc of +-25 m (in angle: shrinks with distance) -> no radial knife edges
    rad = np.maximum(np.hypot(x, z), 50.0)
    span = np.degrees(25.0 / rad)
    R = sum(rockiness(az + k * span) for k in (-1.0, -0.5, 0.0, 0.5, 1.0)) / 5.0
    s = np.maximum(C - e, mainland_s(x, z))             # metres inland from the shoreline
    Wb = 44.0 - 36.0 * R                                 # beach width
    # sea floor
    shelf = 0.03 + 0.20 * R
    h_sea = SEA - np.minimum(14.0, 0.25 * smoothstep(0.0, 4.0, -s) + np.maximum(-s, 0) * shelf)
    # beach profile -> +0.25 m at the back of the beach (dunes add up to ~1.2 m)
    tb = np.clip(s / Wb, 0, 1)
    beach = SEA + (0.25 - SEA) * (tb ** 0.85)
    dunes = (fbm(x, z, 1 / 28.0, 21, 3) - 0.35) * 1.9 * smoothstep(Wb * 0.6, Wb + 4, s) * smoothstep(Wb + 34, Wb + 12, s) * (1 - R)
    beach = beach + np.maximum(dunes, 0)
    # cliffs on rocky stretches
    nc = fbm(x, z, 1 / 60.0, 31, 3)
    cliff_h = 3.0 + 9.0 * R * (0.45 + 0.8 * nc)
    cliff = SEA + (cliff_h - SEA) * smoothstep(0.0, 8.0 + 8.0 * (1 - R), s + (nc - 0.5) * 6)
    # cliffs belong to the coastal strip only: further inland the rocky plateau drops to the hinterland
    rk = smoothstep(0.35, 0.7, R) * smoothstep(140.0, 60.0, s)
    land = beach * (1 - rk) + cliff * rk
    # hills in the green belt (zero at the city edge and behind the beach)
    hn = fbm(x, z, 1 / 340.0, 41, 5)
    hills = np.maximum(hn - 0.36, 0) ** 1.25 * 32.0 + (fbm(x, z, 1 / 90.0, 51, 3) - 0.5) * 2.2
    ramp = smoothstep(18.0, 120.0, e) * smoothstep(Wb + 6, Wb + 70, s)
    land = land + np.maximum(hills, -0.3) * ramp
    # mainland foothills rising towards the mountains (north)
    land = land + (fbm(x, z, 1 / 700.0, 45, 4) * 1.3 - 0.25) * 90.0 * smoothstep(800.0, 2300.0, -z) * smoothstep(Wb + 40, Wb + 250, s)
    land = land * smoothstep(2.0, 26.0, e)               # flat (0) next to the city
    h = np.where(s < 0, h_sea, land)
    h = np.where(e < 0, 0.0, h)
    return {"h": h, "s": s, "e": e, "R": R, "Wb": Wb, "az": az}


GRID_H = None
SHORE_D = None


def height_at(x, z):
    if GRID_H is not None:
        return float(sample_grid(GRID_H, np.array([x]), np.array([z]))[0])
    return float(fields(np.array([x], np.float64), np.array([z], np.float64))["h"][0])


def sample_grid(A, x, z):
    """bilinear sample of a grid array at world points (vectorised)"""
    fx = np.clip((np.asarray(x) + EXT) / STEP, 0, A.shape[1] - 1.001)
    fz = np.clip((np.asarray(z) + EXT) / STEP, 0, A.shape[0] - 1.001)
    i = fx.astype(int); j = fz.astype(int); u = fx - i; v = fz - j
    return (A[j, i] * (1 - u) * (1 - v) + A[j, i + 1] * u * (1 - v) + A[j + 1, i] * (1 - u) * v + A[j + 1, i + 1] * u * v)


def point_at(az_deg, e_target):
    """point with azimuth az and city distance e (bisection along the ray from the centre)"""
    t = math.radians(az_deg)
    dx, dz = math.sin(t), -math.cos(t)
    lo, hi = 0.0, 6000.0
    for _ in range(50):
        m = (lo + hi) / 2
        if float(city_dist(np.array([dx * m]), np.array([dz * m]))[0]) < e_target:
            lo = m
        else:
            hi = m
    return dx * lo, dz * lo


# ------------------------------------------------------------------------------------- paths
def road_ends():
    """(x, z, dir_x, dir_z, half_width) for every road reaching the city edge"""
    out = []
    for r in CITY["roads"]:
        hw = r["carriage_half"]
        if r["axis"] == "z":     # runs along z at x = c
            if r["a0"] <= -HALF + 1:
                out.append((r["c"], -HALF, 0.0, -1.0, hw, r["id"]))
            if r["a1"] >= HALF - 1:
                out.append((r["c"], HALF, 0.0, 1.0, hw, r["id"]))
        else:                    # runs along x at z = c
            if r["a0"] <= -HALF + 1:
                out.append((-HALF, r["c"], -1.0, 0.0, hw, r["id"]))
            if r["a1"] >= HALF - 1:
                out.append((HALF, r["c"], 1.0, 0.0, hw, r["id"]))
    return out


def make_paths():
    """Paths continuing every road end: asphalt apron fading into an earth path that bends gently
    and runs down to the beach (or to a viewpoint on a cliff); in the north (mainland) the main
    roads continue as country asphalt roads."""
    paths = []
    for (x, z, dx, dz, hw, rid) in road_ends():
        pts = [(x, z)]
        px, pz = x, z
        ang = math.atan2(dx, dz)
        seed = int(abs(x) * 3 + abs(z) * 7)
        north = dz < 0 and abs(dx) < 0.1
        main = rid in ("av", "d", "e") and north
        L = 520.0 if main else 900.0
        for i in range(int(L / 6.0)):
            bend = (float(noise1(np.array([i / 60.0]), 12, seed)[0]) - 0.5) * (0.05 if main else 0.16)
            ang += bend
            px += math.sin(ang) * 6.0; pz += math.cos(ang) * 6.0
            f = fields(np.array([px]), np.array([pz]))
            pts.append((px, pz))
            if float(f["s"][0]) < float(f["Wb"][0]) * 0.55 and not main:
                break                          # reached the beach (or the cliff edge)
            if float(f["s"][0]) < 4.0:
                break
        width = (hw * 2.0 if main else 3.6)
        paths.append({"id": rid, "pts": pts, "width": width, "asphalt": main,
                      "apron": 18.0 if not main else 0.0, "road_half": hw})
    return paths


def make_promenade():
    """paved embankment behind the south-bay beach: polyline at the back of the beach"""
    pts = []
    for az in np.arange(146.0, 214.01, 1.0):
        C = float(coast_offset(np.array([az]))[0])
        R = float(rockiness(np.array([az]))[0])
        Wb = 44.0 - 36.0 * R
        x, z = point_at(az, C - (Wb + 7.0))
        pts.append((x, z))
    # resample to ~5 m spacing and smooth
    P = np.array(pts)
    for _ in range(6):
        P[1:-1] = (P[:-2] + 2 * P[1:-1] + P[2:]) / 4
    seg = np.hypot(*np.diff(P, axis=0).T)
    cum = np.concatenate([[0], np.cumsum(seg)])
    n = int(cum[-1] / 5.0)
    xs = np.interp(np.linspace(0, cum[-1], n), cum, P[:, 0])
    zs = np.interp(np.linspace(0, cum[-1], n), cum, P[:, 1])
    return list(zip(xs.tolist(), zs.tolist()))


def dist_to_polyline(X, Z, pts, maxd):
    """distance field (and arc parameter) of grid points to a polyline, limited to maxd"""
    d = np.full(X.shape, 1e9)
    for (ax, az_), (bx, bz) in zip(pts[:-1], pts[1:]):
        x0, x1 = min(ax, bx) - maxd, max(ax, bx) + maxd
        z0, z1 = min(az_, bz) - maxd, max(az_, bz) + maxd
        i0 = max(int((x0 + EXT) / STEP), 0); i1 = min(int((x1 + EXT) / STEP) + 2, X.shape[1])
        j0 = max(int((z0 + EXT) / STEP), 0); j1 = min(int((z1 + EXT) / STEP) + 2, X.shape[0])
        if i0 >= i1 or j0 >= j1:
            continue
        sx = X[j0:j1, i0:i1]; sz = Z[j0:j1, i0:i1]
        vx, vz = bx - ax, bz - az_
        L2 = vx * vx + vz * vz + 1e-9
        t = np.clip(((sx - ax) * vx + (sz - az_) * vz) / L2, 0, 1)
        dd = np.hypot(sx - (ax + vx * t), sz - (az_ + vz * t))
        d[j0:j1, i0:i1] = np.minimum(d[j0:j1, i0:i1], dd)
    return d


# ------------------------------------------------------------------------------------- build
def main():
    n = int(2 * EXT / STEP) + 1
    xs = np.linspace(-EXT, EXT, n)
    X, Z = np.meshgrid(xs, xs)                 # [row = z, col = x]
    F = fields(X, Z)
    H = F["h"].copy()
    S, E, R, Wb = F["s"], F["e"], F["R"], F["Wb"]
    # sea floor from the TRUE distance to the shore (not along rays from the centre)
    from scipy import ndimage
    wet = S < 0
    dsea, (ni, nj) = ndimage.distance_transform_edt(wet, return_indices=True)
    dsea = dsea * STEP
    # shelf steepness of the NEAREST shore point (rocky shores drop fast, beaches stay shallow),
    # smoothed so neighbouring stretches of coast blend
    shelf = ndimage.gaussian_filter(0.03 + 0.20 * R[ni, nj], 12)
    H = np.where(wet, SEA - np.minimum(14.0, 0.25 * smoothstep(0.0, 4.0, dsea) + dsea * shelf), H)
    global GRID_H, SHORE_D
    GRID_H = H
    SHORE_D = dsea

    # slope before path flattening
    gz, gx = np.gradient(H, STEP)
    slope = np.degrees(np.arctan(np.hypot(gx, gz)))

    # --- paths: flatten along a smoothed profile, splat earth / asphalt
    paths = make_paths()
    earth = np.zeros_like(H); asphalt = np.zeros_like(H)
    for p in paths:
        pts = p["pts"]
        prof = np.array([height_at(x, z) for (x, z) in pts])
        k = 7
        prof_s = np.convolve(np.pad(prof, k, mode="edge"), np.ones(2 * k + 1) / (2 * k + 1), mode="same")[k:-k]
        prof_s[0] = 0.0
        p["prof"] = prof_s.tolist()
        half = p["width"] / 2
        d = dist_to_polyline(X, Z, pts, half + 10)
        near = d < half + 10
        # height of the path at each nearby grid point = profile of the nearest vertex
        P = np.array(pts)
        idx = np.where(near)
        if len(idx[0]):
            qx = X[idx]; qz = Z[idx]
            dd = (qx[:, None] - P[None, :, 0]) ** 2 + (qz[:, None] - P[None, :, 1]) ** 2
            nearest = np.argmin(dd, axis=1)
            ph = prof_s[nearest]
            w = smoothstep(half + 9, half + 1, d[idx])
            H[idx] = H[idx] * (1 - w) + ph * w
            cov = smoothstep(half + 1.2, half - 0.6, d[idx]) * (0.85 + 0.15 * fbm(qx, qz, 0.4, 61, 2))
            if p["asphalt"]:
                asphalt[idx] = np.maximum(asphalt[idx], cov)
            else:
                # asphalt apron at the city edge fading into earth over ~18 m (patchy)
                arc = np.hypot(qx - pts[0][0], qz - pts[0][1])
                ap = smoothstep(p["apron"], p["apron"] * 0.35, arc + (fbm(qx, qz, 0.25, 71, 2) - 0.5) * 8)
                wide = smoothstep(p["road_half"] + 1.0, p["road_half"] - 0.5, d[idx]) * ap
                asphalt[idx] = np.maximum(asphalt[idx], wide)
                earth[idx] = np.maximum(earth[idx], cov * (1 - wide))
                H[idx] = np.where(wide > 0.01, H[idx] * (1 - wide), H[idx])

    # --- promenade: flatten a 7 m strip 0.15 m below its paved top
    prom = make_promenade()
    prom_h = []
    for (x, z) in prom:
        prom_h.append(max(height_at(x, z), 0.55))
    prom_h = np.convolve(np.pad(np.array(prom_h), 6, mode="edge"), np.ones(13) / 13, mode="same")[6:-6]
    dprom = dist_to_polyline(X, Z, prom, 14)
    idx = np.where(dprom < 14)
    if len(idx[0]):
        P = np.array(prom)
        qx = X[idx]; qz = Z[idx]
        nearest = np.argmin((qx[:, None] - P[None, :, 0]) ** 2 + (qz[:, None] - P[None, :, 1]) ** 2, axis=1)
        w = smoothstep(13.0, 4.6, dprom[idx])
        H[idx] = H[idx] * (1 - w) + (prom_h[nearest] - 0.15) * w
        earth[idx] = np.maximum(earth[idx], smoothstep(6.0, 3.8, dprom[idx]) * 0.6)

    gz, gx = np.gradient(H, STEP)
    slope = np.degrees(np.arctan(np.hypot(gx, gz)))

    # --- splat weights
    ns = fbm(X, Z, 1 / 9.0, 81, 3)
    sand = smoothstep(Wb + 6 + (ns - 0.5) * 10, Wb - 2 + (ns - 0.5) * 10, S) * (1 - smoothstep(0.45, 0.8, R))
    sand = np.maximum(sand, smoothstep(2.5, -1.0, H - SEA) * 0.9 * (1 - R))       # wet strip
    rock = np.maximum(smoothstep(26, 40, slope), smoothstep(0.45, 0.75, R) * smoothstep(Wb + 26, Wb + 8, S) * (S < 160))
    rock = np.maximum(rock, smoothstep(0.78, 0.86, fbm(X, Z, 1 / 40.0, 91, 3)) * smoothstep(40, 120, E) * (S > Wb + 20))
    bare = smoothstep(0.66, 0.78, fbm(X, Z, 1 / 55.0, 101, 4)) * 0.55 * smoothstep(30, 90, E)
    earth = np.maximum(earth, bare * (1 - sand))
    inside = E < 0
    for a in (sand, rock, earth, asphalt):
        a[inside] = 0
    # normalise so the total never exceeds 1 (grass = 1 - sum)
    tot = sand + rock + earth + asphalt
    k = np.where(tot > 1, 1 / np.maximum(tot, 1e-6), 1.0)
    sand *= k; rock *= k; earth *= k; asphalt *= k
    H[inside] = 0.0

    os.makedirs(os.path.join(GAME, "assets/terrain"), exist_ok=True)
    os.makedirs(os.path.join(GAME, "data/terrain"), exist_ok=True)
    os.makedirs(os.path.join(GAME, "assets/ui"), exist_ok=True)

    # --- collision heightmap (playable window only: +-1200 m)
    W = 1200.0
    c0 = int((EXT - W) / STEP); c1 = int((EXT + W) / STEP) + 1
    hm = H[c0:c1, c0:c1].astype(np.float32)
    hm.tofile(os.path.join(GAME, "data/terrain/height.bin"))
    json.dump({"step": STEP, "size": hm.shape[0], "origin": [-W, -W], "sea_level": SEA, "wade_depth": WADE,
               "note": "row-major float32, rows = z from -W, cols = x from -W"},
              open(os.path.join(GAME, "data/terrain/terrain.json"), "w"), indent=1)

    # full-extent heights (8 m) for the backdrop generator (mainland suburbs), not shipped with the game
    os.makedirs(os.path.join(ROOT, "dushanbe_city_src/build"), exist_ok=True)
    np.save(os.path.join(ROOT, "dushanbe_city_src/build/height_full.npy"), H[::2, ::2].astype(np.float32))
    write_tiles(X, Z, H, sand, rock, earth, asphalt)
    write_promenade(prom, prom_h)
    bounds = write_bounds(H)
    write_sea_mask(H, S)
    chunks = scatter(X, Z, H, S, E, R, Wb, slope, sand, earth, asphalt, paths, prom, prom_h, dprom, bounds)
    write_minimap(H, sand, rock, earth, asphalt, paths, prom)
    json.dump({"paths": [{k: v for k, v in p.items() if k != "prof"} for p in paths], "promenade": prom},
              open(os.path.join(GAME, "data/terrain/paths.json"), "w"))
    land = (H > SEA)
    print("terrain: land %.2f km2 within +-1200 m, paths %d, promenade %.0f m, chunks %d" % (
        land[c0:c1, c0:c1].sum() * STEP * STEP / 1e6, len(paths), len(prom) * 5.0, chunks))


def tile_rects():
    """(x0, z0, size) of every terrain tile: 400 m tiles within +-800 m (near the player, good LOD),
    800 m tiles further out (far terrain: 4x fewer meshes = fewer draw calls)"""
    out = []
    for gz in range(-3, 3):
        for gx in range(-3, 3):
            x0, z0 = gx * 800.0, gz * 800.0
            if -800 <= x0 < 800 and -800 <= z0 < 800:
                for sz in range(2):
                    for sx in range(2):
                        out.append((x0 + sx * 400.0, z0 + sz * 400.0, 400.0))
            else:
                out.append((x0, z0, 800.0))
    return out


def write_tiles(X, Z, H, sand, rock, earth, asphalt):
    out = os.path.join(GAME, "assets/terrain")
    for f in os.listdir(out):
        if f.startswith("coast_") and f.endswith(".glb"):
            os.remove(os.path.join(out, f))
    count = 0; tris = 0
    names = []
    gz_all, gx_all = np.gradient(H, STEP)
    for (x0, z0, size) in tile_rects():
            cx, cz = x0 + size / 2, z0 + size / 2
            dist = math.hypot(cx, cz)
            if max(abs(x0), abs(x0 + size)) <= HALF and max(abs(z0), abs(z0 + size)) <= HALF:
                continue                               # fully inside the city
            stride = 1 if size <= 400 else (2 if dist < 1500 else 4)
            per = int(size / STEP)
            i0 = int((x0 + EXT) / STEP); j0 = int((z0 + EXT) / STEP)
            sl = (slice(j0, j0 + per + 1, stride), slice(i0, i0 + per + 1, stride))
            h = H[sl]
            if h.max() < SEA - 0.4:
                continue                               # fully under the (opaque) sea
            x = X[sl]; z = Z[sl]
            col = np.stack([sand[sl], rock[sl], earth[sl], asphalt[sl]], -1)
            # normals from the full-res grid
            nx = -gx_all[sl]; nz = -gz_all[sl]; ny = np.ones_like(nx)
            ln = np.sqrt(nx * nx + ny * ny + nz * nz)
            nrm = np.stack([nx / ln, ny / ln, nz / ln], -1)
            ny_, nx_ = h.shape
            # cells: skip those fully inside the city or fully under water
            keep = np.ones((ny_ - 1, nx_ - 1), bool)
            inside = (np.abs(x) <= HALF + 0.01) & (np.abs(z) <= HALF + 0.01)   # boundary counts as city
            keep &= ~(inside[:-1, :-1] & inside[1:, 1:] & inside[:-1, 1:] & inside[1:, :-1])
            wet = h < SEA - 0.4
            keep &= ~(wet[:-1, :-1] & wet[1:, 1:] & wet[:-1, 1:] & wet[1:, :-1])
            if not keep.any():
                continue
            m = mk.Mesh()
            pos = np.stack([x, h, z], -1).reshape(-1, 3)
            m.pos = pos.tolist(); m.nrm = nrm.reshape(-1, 3).tolist()
            m.uv = (np.stack([x, z], -1).reshape(-1, 2) / 4.0).tolist()
            m.col = col.reshape(-1, 4).tolist()
            jj, ii = np.nonzero(keep)
            a = jj * nx_ + ii; b = a + 1; c = a + nx_; d = c + 1
            # winding: counter-clockwise seen from above (+Y)
            idx = np.stack([a, c, b, b, c, d], -1).reshape(-1)
            m.idx = idx.tolist()
            # skirts along the tile border (hide cracks between tiles of different resolution)
            base = len(m.pos)
            border = [(0, k) for k in range(nx_)] + [(k, nx_ - 1) for k in range(1, ny_)] + \
                     [(ny_ - 1, k) for k in range(nx_ - 2, -1, -1)] + [(k, 0) for k in range(ny_ - 2, 0, -1)] + [(0, 0)]
            for (r0, c0), (r1, c1) in zip(border[:-1], border[1:]):
                if not (keep[min(r0, ny_ - 2), min(c0, nx_ - 2)] or keep[min(r1, ny_ - 2), min(c1, nx_ - 2)]):
                    continue
                p0 = pos[r0 * nx_ + c0]; p1 = pos[r1 * nx_ + c1]
                k0 = len(m.pos)
                for p, rr, cc in ((p0, r0, c0), (p1, r1, c1)):
                    m.pos.append([p[0], p[1], p[2]]); m.nrm.append(nrm[rr, cc].tolist())
                    m.uv.append([p[0] / 4, p[2] / 4]); m.col.append(col[rr, cc].tolist())
                for p, rr, cc in ((p0, r0, c0), (p1, r1, c1)):
                    m.pos.append([p[0], p[1] - 1.5, p[2]]); m.nrm.append(nrm[rr, cc].tolist())
                    m.uv.append([p[0] / 4, p[2] / 4]); m.col.append(col[rr, cc].tolist())
                m.idx += [k0, k0 + 1, k0 + 2, k0 + 1, k0 + 3, k0 + 2, k0, k0 + 2, k0 + 1, k0 + 1, k0 + 2, k0 + 3]
            name = "coast_%d_%d_%d.glb" % (int(x0), int(z0), int(size))
            mk.write_glb(os.path.join(out, name), [("terrain", {"terrain": m})], origin=(cx, 0.0, cz))
            names.append(name)
            count += 1; tris += len(m.idx) // 3
    print("tiles", count, "triangles", tris)
    return names


def write_promenade(prom, prom_h):
    """paved top (sidewalk material) + curb faces on both sides"""
    b = mk.Builder()
    P = np.array(prom)
    W2 = 3.5
    for i in range(len(P) - 1):
        (ax, az), (bx, bz) = P[i], P[i + 1]
        ha, hb = float(prom_h[i]), float(prom_h[i + 1])
        tx, tz = bx - ax, bz - az
        L = math.hypot(tx, tz) or 1.0
        nx, nz = -tz / L * W2, tx / L * W2
        A0 = (ax - nx, ha, az - nz); A1 = (ax + nx, ha, az + nz)
        B0 = (bx - nx, hb, bz - nz); B1 = (bx + nx, hb, bz + nz)
        b.quad("sidewalk", A0, A1, B1, B0, uvmode="auto")
        for (P0, Q0) in ((A0, B0), (B1, A1)):
            b.quad("curb", (P0[0], P0[1] - 0.6, P0[2]), (Q0[0], Q0[1] - 0.6, Q0[2]), Q0, P0, uvmode="auto")
    for mesh in b.meshes.values():   # quads may come out facing down: make every face point up/out
        pass
    mk.write_glb(os.path.join(GAME, "assets/terrain/promenade.glb"), [("promenade", b.meshes)])


def write_bounds(H):
    """playable boundary: along each azimuth, the first point where the sea is deeper than WADE;
    the mainland (north) is closed at 1050 m from the centre"""
    az = np.radians(np.arange(0.0, 360.0, 1.0))[:, None]
    r = np.arange(HALF, 1180.0, 2.0)[None, :]
    x = np.sin(az) * r; z = -np.cos(az) * r
    deep = sample_grid(H, x, z) < SEA - WADE
    first = np.where(deep.any(axis=1), deep.argmax(axis=1), -1)
    pts = []
    for k in range(az.shape[0]):
        rr = float(r[0, first[k]]) if first[k] >= 0 else 1050.0
        rr = min(rr, 1050.0)
        pts.append((round(float(np.sin(az[k, 0]) * rr), 2), round(float(-np.cos(az[k, 0]) * rr), 2)))
    json.dump({"polyline": pts, "closed": True, "wade_depth": WADE}, open(os.path.join(GAME, "data/terrain/bounds.json"), "w"))
    return pts


def write_sea_mask(H, S):
    """1024x1024 over +-2048 m (4 m/px, the terrain grid): R = water depth / 12 m,
    G = shore proximity (1 at the waterline -> 0 at 45 m out), B = water"""
    n = 1024
    xs = np.linspace(-2048 + 2, 2048 - 2, n)
    Xm, Zm = np.meshgrid(xs, xs)
    h = sample_grid(H, Xm, Zm)
    d = sample_grid(SHORE_D, Xm, Zm)
    depth = np.clip(SEA - h, 0, 12) / 12.0
    shore = np.clip(1.0 - d / 45.0, 0, 1) * (h < SEA + 0.3)
    img = np.stack([depth, shore, (h < SEA).astype(np.float64)], -1)
    Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGB").filter(ImageFilter.GaussianBlur(0.7)).save(
        os.path.join(GAME, "assets/terrain/sea_mask.png"))


# ------------------------------------------------------------------------------------- vegetation & props
def scatter(X, Z, H, S, E, R, Wb, slope, sand, earth, asphalt, paths, prom, prom_h, dprom, bounds):
    rng = np.random.default_rng(7)
    items = {}   # chunk key -> dict

    def chunk(x, z):
        k = (int(math.floor(x / TILE)), int(math.floor(z / TILE)))
        if k not in items:
            items[k] = {"trees": [], "props": [], "lines": [], "colliders": [], "lights": [], "attach": [], "doors": []}
        return items[k]

    def sample(arr, x, z):
        i = int(round((x + EXT) / STEP)); j = int(round((z + EXT) / STEP))
        return float(arr[min(max(j, 0), arr.shape[0] - 1), min(max(i, 0), arr.shape[1] - 1)])

    pathd = None
    for p in paths:
        # country asphalt roads keep a 14 m open corridor each side (vista to the mountains),
        # earth paths only a narrow one
        clear = 14.0 if p["asphalt"] else 0.0
        d = dist_to_polyline(X, Z, p["pts"], p["width"] / 2 + 6 + clear) - clear
        pathd = d if pathd is None else np.minimum(pathd, d)

    def hgt(x, z):   # bilinear height of the final grid
        return float(sample_grid(H, np.array([x]), np.array([z]))[0])

    forest = fbm(X, Z, 1 / 150.0, 111, 4)
    ntree = nshrub = 0
    G = 9.0
    for gz in np.arange(-1100, 1100, G):
        for gx in np.arange(-1100, 1100, G):
            x = gx + rng.uniform(-G * 0.45, G * 0.45); z = gz + rng.uniform(-G * 0.45, G * 0.45)
            e = sample(E, x, z)
            if e < 6:
                continue
            s = sample(S, x, z); wb = sample(Wb, x, z)
            if s < wb + 6 or sample(slope, x, z) > 24 or sample(pathd, x, z) < 4.5 or sample(dprom, x, z) < 7:
                continue
            if sample(asphalt, x, z) > 0.1 or sample(sand, x, z) > 0.35:
                continue
            fo = sample(forest, x, z)
            coastal = s < wb + 55
            dens = smoothstep(0.42, 0.62, fo) * 0.85 + 0.06
            if coastal:
                dens *= 0.55
            if e > 760:
                dens *= 0.5
            if rng.random() > dens:
                continue
            y = hgt(x, z)
            yaw = round(float(rng.uniform(0, 6.283)), 3)
            r = rng.random()
            if coastal:
                cat = "coast_shrub" if r < 0.45 else "coast_tree"
            else:
                cat = "coast_shrub" if r < 0.15 else "hill_tree"
            sc = round(float(rng.uniform(0.8, 1.15)), 3)
            chunk(x, z)["trees"].append([cat, round(x, 2), round(z, 2), yaw, sc, round(y - 0.05, 3)])
            if cat == "coast_shrub":
                nshrub += 1
            else:
                ntree += 1
    # boulders on rocky shores and cliff feet
    nb = 0
    for az in np.arange(0.0, 360.0, 0.35):
        Rk = float(rockiness(np.array([az]))[0])
        if Rk < 0.45:
            continue
        C = float(coast_offset(np.array([az]))[0])
        if C > 1500:
            continue
        for k in range(2):
            off = rng.uniform(-7.0, 12.0)
            x, z = point_at(az + rng.uniform(-0.15, 0.15), C - off)
            if abs(x) > 1150 or abs(z) > 1150:
                continue
            y = hgt(x, z)
            sc = float(rng.uniform(0.5, 1.0) ** 2 * 2.6 + 0.35) * Rk
            ch = chunk(x, z)
            ch["props"].append(["boulder", round(x, 2), round(y - 0.25 * sc, 3), round(z, 2), round(float(rng.uniform(0, 6.283)), 3), round(sc, 3)])
            if sc > 0.9 and y > SEA - WADE:
                ch["colliders"].append([round(x, 2), round(y + 0.2 * sc, 3), round(z, 2), round(1.5 * sc, 2), round(1.1 * sc, 2), round(1.4 * sc, 2), 0.0])
            nb += 1
    # promenade: lamps every 25 m (land side), benches facing the sea every 25 m, urns
    P = np.array(prom)
    for i in range(2, len(P) - 2, 5):
        (ax, az_), (bx, bz) = P[i], P[i + 1]
        tx, tz = bx - ax, bz - az_
        L = math.hypot(tx, tz) or 1.0
        nx, nz = -tz / L, tx / L              # left normal
        # which side is the sea? sample S both sides
        sl = sample(S, ax + nx * 10, az_ + nz * 10); sr = sample(S, ax - nx * 10, az_ - nz * 10)
        sx_, sz_ = (nx, nz) if sl < sr else (-nx, -nz)       # towards the sea
        y = float(prom_h[i])
        lx, lz = ax - sx_ * 3.0, az_ - sz_ * 3.0
        ch = chunk(lx, lz)
        ch["props"].append(["lamp_park", round(lx, 2), round(y, 3), round(lz, 2), round(math.atan2(sx_, sz_), 3)])
        ch["lights"].append(["street", round(lx, 2), round(y + 3.8, 2), round(lz, 2)])
        if (i // 5) % 2 == 0:
            bxp, bzp = ax + (tx / L) * 12 - sx_ * 2.2, az_ + (tz / L) * 12 - sz_ * 2.2
            chunk(bxp, bzp)["props"].append(["bench_park", round(bxp, 2), round(y, 3), round(bzp, 2), round(math.atan2(sx_, sz_), 3)])
        else:
            ux, uz = ax + (tx / L) * 12 - sx_ * 2.6, az_ + (tz / L) * 12 - sz_ * 2.6
            chunk(ux, uz)["props"].append(["urn", round(ux, 2), round(y, 3), round(uz, 2), 0.0])
    # promenade collision: boxes per segment (top at the paved height)
    for i in range(len(P) - 1):
        (ax, az_), (bx, bz) = P[i], P[i + 1]
        cx, cz = (ax + bx) / 2, (az_ + bz) / 2
        L = math.hypot(bx - ax, bz - az_)
        yaw = math.atan2(bx - ax, bz - az_)
        y = (float(prom_h[i]) + float(prom_h[i + 1])) / 2
        chunk(cx, cz)["colliders"].append([round(cx, 2), round(y - 0.3, 3), round(cz, 2), 7.0, 0.6, round(L + 0.3, 2), round(yaw, 4)])
    # write chunks
    d = os.path.join(GAME, "data/city")
    for f in os.listdir(d):
        if f.startswith("chunk_coast_"):
            os.remove(os.path.join(d, f))
    for k, J in items.items():
        if not any(J.values()):
            continue
        J["glb"] = ""
        J["origin"] = [k[0] * TILE, k[1] * TILE]
        J["terrain"] = True
        json.dump(J, open(os.path.join(d, "chunk_coast_v_%d_%d.json" % (k[0], k[1])), "w"), separators=(",", ":"))
    for f in sorted(os.listdir(os.path.join(GAME, "assets/terrain"))):
        if f.startswith("coast_") and f.endswith(".glb"):
            json.dump({"glb": "res://assets/terrain/" + f, "origin": [0, 0], "terrain": True},
                      open(os.path.join(d, "chunk_" + f.replace(".glb", ".json")), "w"))
    pj = os.path.join(GAME, "data/city/chunk_coast_promenade.json")
    json.dump({"glb": "res://assets/terrain/promenade.glb", "origin": [0, 0], "trees": [], "props": [], "lines": [],
               "colliders": [], "lights": [], "attach": [], "doors": [], "terrain": True}, open(pj, "w"))
    print("vegetation: trees %d, shrubs %d, boulders %d" % (ntree, nshrub, nb))
    return len(items)


# ------------------------------------------------------------------------------------- minimap
def write_minimap(H, sand, rock, earth, asphalt, paths, prom):
    """2048 x 2048 px over +-1024 m (1 px = 1 m), drawn with PIL:
    sea (depth-tinted), beach, rock, grass (hill shading), city plan (blocks, roads, buildings)."""
    N = 2048
    W = 1024.0
    xs = np.linspace(-W + 0.5, W - 0.5, N)
    Xm, Zm = np.meshgrid(xs, xs)
    h = sample_grid(H, Xm, Zm)
    # sample splats from the 4 m grid
    def grid(a):
        i = np.clip(((Xm + EXT) / STEP).round().astype(int), 0, a.shape[1] - 1)
        j = np.clip(((Zm + EXT) / STEP).round().astype(int), 0, a.shape[0] - 1)
        return a[j, i]
    sa, ro, ea, asp = (sample_grid(a, Xm, Zm) for a in (sand, rock, earth, asphalt))
    hh = h
    gz, gx = np.gradient(hh)
    shade = np.clip(1.0 + (gx * -0.6 + gz * -0.6) * 0.35, 0.75, 1.2)[..., None]
    grass = np.array([0.56, 0.71, 0.43]); sandc = np.array([0.90, 0.84, 0.66]); rockc = np.array([0.55, 0.53, 0.50])
    earthc = np.array([0.66, 0.56, 0.42]); aspc = np.array([0.33, 0.33, 0.35])
    gr = (1 - sa - ro - ea - asp)[..., None]
    col = gr * grass + sa[..., None] * sandc + ro[..., None] * rockc + ea[..., None] * earthc + asp[..., None] * aspc
    col = col * shade
    depth = np.clip((SEA - h) / 10.0, 0, 1)[..., None]
    water = (1 - depth) * np.array([0.45, 0.72, 0.82]) + depth * np.array([0.17, 0.38, 0.58])
    wet = (h < SEA)[..., None]
    col = np.where(wet, water, col)
    img = Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8), "RGB")
    d = ImageDraw.Draw(img)
    def P(x, z):
        return (x + W, z + W)
    # city: base, lawns, roads, buildings (same palette as docs/maps/city_plan.png)
    d.rectangle([P(-HALF, -HALF), P(HALF, HALF)], fill=(150, 190, 120))
    for r in CITY["roads"]:
        hw = r["half"]
        if r["axis"] == "z":
            d.rectangle([P(r["c"] - hw, r["a0"]), P(r["c"] + hw, r["a1"])], fill=(200, 196, 186))
        else:
            d.rectangle([P(r["a0"], r["c"] - hw), P(r["a1"], r["c"] + hw)], fill=(200, 196, 186))
    for r in CITY["roads"]:
        hw = r["carriage_half"]
        if r["axis"] == "z":
            d.rectangle([P(r["c"] - hw, r["a0"]), P(r["c"] + hw, r["a1"])], fill=(72, 72, 78))
        else:
            d.rectangle([P(r["a0"], r["c"] - hw), P(r["a1"], r["c"] + hw)], fill=(72, 72, 78))
    for b in CITY["buildings"]:
        x0, z0, x1, z1 = b["rect"]
        d.rectangle([P(x0, z0), P(x1, z1)], fill=(226, 214, 190), outline=(120, 110, 95))
    for p in paths:
        pts = [P(x, z) for (x, z) in p["pts"]]
        d.line(pts, fill=(72, 72, 78) if p["asphalt"] else (190, 160, 120), width=max(2, int(p["width"])))
    d.line([P(x, z) for (x, z) in prom], fill=(214, 210, 200), width=7)
    img = img.filter(ImageFilter.SMOOTH)
    img.save(os.path.join(GAME, "assets/ui/minimap.png"))
    json.dump({"extent": W, "pixels": N, "note": "pixel (0,0) = world (-extent, -extent); +x right, +z down"},
              open(os.path.join(GAME, "assets/ui/minimap.json"), "w"))


if __name__ == "__main__":
    main()
