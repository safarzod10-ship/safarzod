#!/usr/bin/env python3
"""DUSHANBE-X: builds the open world north of the peninsula (docs/WORLD_PLAN.md).

  python3 -I tools/world/build_world.py            (from dushanbe_city_src, ~2 min)

Outputs (dushanbe_city/data/world/):
  height.bin     uint16, 1281 x 1281 (8 m grid), h = v * 0.05 - 100  (roads carved in)
  splat.png      RGBA weights for the terrain shader: R rock, G snow, B earth/dirt, A sand (grass = rest)
  biome.png      R forest density, G orchard/field, B settlement, A river/lake proximity
  surface.bin    uint8 tyre surface class per cell (CityWorld.Surface + SNOW 6)
  world.json     roads (4 m polylines with heights, widths, bridges, tunnels), rivers, lakes,
                 places, landmarks, buildings, signs, km posts, fuel stations
and dushanbe_city/assets/ui/world_map.png (2048 px top-down map).
"""
import json, math, os, sys, time
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy.spatial import cKDTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import terrain as T
import roads as R
import network as NW
import places as PL

ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
GAME = os.path.join(ROOT, "dushanbe_city")
OUT = os.path.join(GAME, "data", "world")
SURF = {"grass": 0, "sand": 1, "rock": 2, "earth": 3, "asphalt": 4, "paved": 5, "snow": 6}
PRIO = {"avenue": 0, "highway": 1, "street": 2, "road": 2, "mountain": 2, "lane": 3, "dirt": 4}


def log(*a):
    print("[%6.1f]" % (time.time() - T0), *a, flush=True)


T0 = time.time()


def main():
    os.makedirs(OUT, exist_ok=True)
    X, Z = T.grid()
    F = T.heights(X, Z)
    H0 = F["h"].copy()
    log("terrain", H0.shape, "%.0f..%.0f" % (H0.min(), H0.max()))

    def H_at(xs, zs, A=None):
        A = H0 if A is None else A
        fx = np.clip((np.asarray(xs) - T.X0) / T.STEP, 0, T.N - 1.001)
        fz = np.clip((np.asarray(zs) - T.Z0) / T.STEP, 0, T.N - 1.001)
        i = fx.astype(int); j = fz.astype(int); u = fx - i; v = fz - j
        return (A[j, i] * (1 - u) * (1 - v) + A[j, i + 1] * u * (1 - v) + A[j + 1, i] * (1 - u) * v + A[j + 1, i + 1] * u * v)

    # ------------------------------------------------------------------ routes
    rt = R.Router()
    log("router ready")
    roads = []
    for rid, nm, cls, wps in NW.GRID:
        P = T.resample(wps, 4.0)
        roads.append({"id": rid, "name": nm, "cls": cls, "P": P, "routed": False})
    for rid, nm, cls, wps in NW.ROUTED + NW.DIRT:
        g = NW.CLASSES[cls]["g"]
        pts = []
        for a, b in zip(wps[:-1], wps[1:]):
            seg = rt.route(a, b, g)
            pts += seg if not pts else seg[1:]
        # exact waypoints at the ends (junctions with other roads)
        pts[0] = wps[0]; pts[-1] = wps[-1]
        P = R.smooth_route(pts)
        P[0] = wps[0]; P[-1] = wps[-1]
        roads.append({"id": rid, "name": nm, "cls": cls, "P": P, "routed": True})
    log("routed", len(roads), "roads, %.1f km" % (sum(np.sum(np.hypot(*np.diff(r["P"], axis=0).T)) for r in roads) / 1000))

    # ------------------------------------------------------------------ profiles (major roads first)
    roads.sort(key=lambda r: PRIO[r["cls"]])
    water_d = np.minimum(np.minimum(F["d_var"], F["d_gis"]), np.minimum(F["d_east"], F["d_trib"]))
    H = H0.copy()
    done_pts = []          # (x, z, h, half width) of finished roads (junction pinning)
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        P = r["P"]
        dirt = c["surf"] == "dirt" or r["cls"] == "lane"
        win = 120.0 if not r["routed"] else (16.0 if dirt else 60.0)
        hp, h = R.profile(P, lambda xs, zs: H_at(xs, zs, H), c["g"] * (1.6 if dirt else 1.0), win=win)
        h_orig = H_at(P[:, 0], P[:, 1])
        # pin points lying on earlier (major) roads to their height
        if done_pts:
            D = np.array(done_pts)
            tree = cKDTree(D[:, :2])
            dd, ii = tree.query(P, k=1)
            on = dd < D[ii, 3] + 1.0
            if on.any():
                pin = np.where(on, D[ii, 2], np.nan)
                hp = pinned_profile(hp, pin, c["g"])
        wd = T_sample(water_d, P)
        r["H"] = hp
        r["water"] = wd < 18.0
        r["bridges"], r["tunnels"] = R.structures(P, hp, h_orig, r["water"], allow_tunnels=not dirt, bridge_h=99.0 if dirt else 5.0)
        # city grid streets over the river are bridges at the river only (the basin is flat)
        for (a, b) in r["bridges"]:
            pass
        for k in range(len(P)):
            done_pts.append((P[k, 0], P[k, 1], hp[k], c["w"] / 2))
        H = carve(H, H0, X, Z, P, hp, c["w"] / 2, r["bridges"], r["tunnels"], dirt=c["surf"] == "dirt")
    log("profiles + carving done")
    for r in roads:
        log("  %-10s %-9s %6.0f m  h %4.0f..%4.0f  bridges %d tunnels %d" % (
            r["id"], r["cls"], np.sum(np.hypot(*np.diff(r["P"], axis=0).T)), r["H"].min(), r["H"].max(), len(r["bridges"]), len(r["tunnels"])))

    # ------------------------------------------------------------------ places, buildings, signs
    world = PL.build(roads, H, H_at, F)
    log("places: %d buildings, %d landmarks, %d signs" % (len(world["buildings"]), len(world["landmarks"]), len(world["signs"])))
    # flatten building plots
    H = PL.flatten_plots(H, X, Z, world)

    # ------------------------------------------------------------------ surfaces, splat, biome
    gx = np.gradient(H, T.STEP, axis=1); gz = np.gradient(H, T.STEP, axis=0)
    slope = np.hypot(gx, gz)
    rock = T.ss(0.55, 0.95, slope) + T.ss(0.35, 0.6, slope) * T.ss(600, 900, H) * 0.6
    snow_line = 1000 + (T.fbm(X, Z, 1 / 400, 41, 3) - 0.5) * 180
    snow = T.ss(snow_line - 40, snow_line + 60, H) * (1 - T.ss(0.9, 1.3, slope))
    sand = T.ss(26.0, 10.0, water_d) * T.ss(0.25, 0.1, slope) * 0.8
    lake_shore = T.ss(1.25, 1.02, F["lake_d"]) * T.ss(1.0, 1.02, F["lake_d"])
    sand = np.maximum(sand, lake_shore)
    earth = T.ss(0.62, 0.75, T.fbm(X, Z, 1 / 160, 43, 3)) * 0.7 + T.ss(300, 500, H) * 0.35 * (1 - snow)
    road_mask, road_cls = rasterize_roads(roads, X, Z)
    earth = np.maximum(earth, (road_cls == 4) * road_mask)
    rock = np.clip(rock, 0, 1); snow = np.clip(snow, 0, 1); earth = np.clip(earth, 0, 1) * (1 - snow)
    splat = np.stack([rock, snow, earth, sand], -1)
    Image.fromarray((splat * 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "splat.png"))
    # biome: forest density (mid altitudes, moderate slope, valleys), fields / orchards, settlements
    fn = T.fbm(X, Z, 1 / 380, 47, 4)
    forest = T.ss(0.48, 0.62, fn) * T.ss(120, 260, H) * T.ss(900, 650, H) * T.ss(0.9, 0.5, slope)
    forest = np.maximum(forest, T.ss(120, 30, water_d) * T.ss(-4600, -5200, Z) * 0.8)       # riverside trees in the gorge
    fields = T.ss(-1900, -2400, X) * T.ss(-6000, -5500, Z) + T.ss(2100, 2600, X) * T.ss(-5200, -4800, Z)
    fields = np.clip(fields, 0, 1) * T.ss(0.25, 0.1, slope)
    settle = PL.settlement_mask(X, Z, world)
    forest = forest * (1 - settle) * (1 - road_mask)
    waterp = T.ss(60, 10, water_d)
    biome = np.stack([forest, fields * (1 - settle), settle, waterp], -1)
    Image.fromarray((np.clip(biome, 0, 1) * 255).astype(np.uint8), "RGBA").save(os.path.join(OUT, "biome.png"))
    surf = np.full(H.shape, SURF["grass"], np.uint8)
    surf[earth > 0.5] = SURF["earth"]
    surf[sand > 0.5] = SURF["sand"]
    surf[rock > 0.5] = SURF["rock"]
    surf[snow > 0.5] = SURF["snow"]
    surf[(road_mask > 0.5) & (road_cls < 4)] = SURF["asphalt"]
    surf[(road_mask > 0.5) & (road_cls == 4)] = SURF["earth"]
    surf.tofile(os.path.join(OUT, "surface.bin"))
    log("splat / biome / surface written")

    # ------------------------------------------------------------------ heights
    q = np.clip(np.round((H + 100.0) / 0.05), 0, 65535).astype("<u2")
    q.tofile(os.path.join(OUT, "height.bin"))

    # ------------------------------------------------------------------ world.json
    W = {"version": 1, "origin": [T.X0, T.Z0], "step": T.STEP, "size": T.N, "height_scale": 0.05, "height_offset": -100.0,
         "sea_level": T.SEA, "seam_z": T.SEAM_Z, "sector": 512.0,
         "roads": [], "rivers": [], "lakes": [], "waterfalls": []}
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        W["roads"].append({"id": r["id"], "name": r["name"], "cls": r["cls"], "w": c["w"], "surf": c["surf"], "lanes": c["lanes"],
                           "pts": [[round(float(x), 2), round(float(h), 2), round(float(z), 2)] for (x, z), h in zip(r["P"], r["H"])],
                           "bridges": r["bridges"], "tunnels": r["tunnels"]})
    W["rivers"] = PL.rivers(H_at, H)
    W["lakes"] = [{"id": "lake", "name": "Озеро Искандар", "c": [T.LAKE[0], T.LAKE[1]], "r": [T.LAKE[2], T.LAKE[3]], "level": 520.0},
                  {"id": "komsomol", "name": "Комсомольское озеро", "c": [T.KOMSOMOL[0], T.KOMSOMOL[1]], "r": [T.KOMSOMOL[2], T.KOMSOMOL[3]], "level": 0.2}]
    W["waterfalls"] = [{"x": T.WATERFALL[0], "z": T.WATERFALL[1], "top": 262.0, "bottom": 234.0}]
    W.update(world)
    json.dump(W, open(os.path.join(OUT, "world.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log("world.json %.1f MB" % (os.path.getsize(os.path.join(OUT, "world.json")) / 1e6))
    PL.write_map(W, H, splat, biome, road_mask, os.path.join(GAME, "assets", "ui", "world_map.png"))
    log("map written. done")


def T_sample(A, P):
    fx = np.clip((P[:, 0] - T.X0) / T.STEP, 0, T.N - 1); fz = np.clip((P[:, 1] - T.Z0) / T.STEP, 0, T.N - 1)
    return A[np.round(fz).astype(int), np.round(fx).astype(int)]


def pinned_profile(hp, pin, g, step=4.0):
    """keep pinned heights exactly, blend the rest towards them over 60 m, then grade-limit"""
    n = len(hp)
    idx = np.nonzero(~np.isnan(pin))[0]
    out = hp.copy()
    if len(idx) == 0:
        return out
    corr = np.zeros(n); wsum = np.zeros(n)
    for k in idx:
        d = np.abs(np.arange(n) - k) * step
        w = np.exp(-0.5 * (d / 30.0) ** 2)
        corr += w * (pin[k] - hp[k]); wsum += w
    out = hp + np.where(wsum > 1e-6, corr / np.maximum(wsum, 1e-6) * np.minimum(wsum, 1.0), 0)
    out[idx] = pin[idx]
    lim = g * step * 1.3
    for _ in range(2):
        for i in range(1, n):
            if np.isnan(pin[i]):
                out[i] = np.clip(out[i], out[i - 1] - lim, out[i - 1] + lim)
        for i in range(n - 2, -1, -1):
            if np.isnan(pin[i]):
                out[i] = np.clip(out[i], out[i + 1] - lim, out[i + 1] + lim)
    return out


def carve(H, H0, X, Z, P, hp, hw, bridges, tunnels, dirt=False):
    """cut / fill the terrain along a road: flat under the carriageway (+ 1.5 m shoulders) 0.25 m
    below the road surface, 1:1.5 slopes beyond; nothing under bridges, nothing over tunnels
    (except the portal cuts)."""
    skip = np.zeros(len(P), bool)
    for a, b in bridges:
        skip[a + 2:b - 1] = True
    tun = np.zeros(len(P), bool)
    for a, b in tunnels:
        tun[a + 6:b - 5] = True
    keep = ~skip & ~tun
    if not keep.any():
        return H
    Pk = P[keep]; hk = hp[keep]
    x0, x1 = Pk[:, 0].min() - hw - 60, Pk[:, 0].max() + hw + 60
    z0, z1 = Pk[:, 1].min() - hw - 60, Pk[:, 1].max() + hw + 60
    i0 = max(0, int((x0 - T.X0) / T.STEP)); i1 = min(T.N, int((x1 - T.X0) / T.STEP) + 2)
    j0 = max(0, int((z0 - T.Z0) / T.STEP)); j1 = min(T.N, int((z1 - T.Z0) / T.STEP) + 2)
    sx = X[j0:j1, i0:i1]; sz = Z[j0:j1, i0:i1]
    tree = cKDTree(Pk)
    d, ii = tree.query(np.stack([sx.ravel(), sz.ravel()], 1), k=2, distance_upper_bound=hw + 60)
    d0 = d[:, 0]; i_0 = ii[:, 0]
    ok = np.isfinite(d0)
    hr = np.full(d0.shape, np.nan)
    # height of the road at the nearest point, interpolated with the second nearest
    i_0c = np.clip(i_0, 0, len(hk) - 1); i_1c = np.clip(ii[:, 1], 0, len(hk) - 1)
    d1 = np.where(np.isfinite(d[:, 1]), d[:, 1], d0 + 4.0)
    wa = np.where(np.isfinite(d0), d1 / np.maximum(np.nan_to_num(d0, posinf=1e6) + d1, 1e-6), 1.0)
    hr = hk[i_0c] * wa + hk[i_1c] * (1 - wa)
    sub = H[j0:j1, i0:i1].ravel().copy()
    w0 = hw + 1.5 + (0.0 if dirt else 0.5)
    under = hr - (0.05 if dirt else 0.25)
    cut = np.minimum(sub, under + np.maximum(d0 - w0, 0) / 1.5)
    fill = np.maximum(sub, under - np.maximum(d0 - w0, 0) / 1.5)
    new = np.where(d0 <= w0, under, np.where(sub > hr, cut, fill))
    new = np.where(ok, new, sub)
    H[j0:j1, i0:i1] = new.reshape(sx.shape)
    return H


def rasterize_roads(roads, X, Z):
    """road coverage (0..1) and class (0 asphalt classes .. 4 dirt) per grid cell"""
    pts = []; hw = []; cl = []
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        for p in r["P"]:
            pts.append(p); hw.append(c["w"] / 2); cl.append(4 if c["surf"] == "dirt" else PRIO[r["cls"]])
    pts = np.array(pts); hw = np.array(hw); cl = np.array(cl)
    tree = cKDTree(pts)
    d, i = tree.query(np.stack([X.ravel(), Z.ravel()], 1), k=1, distance_upper_bound=20)
    ok = np.isfinite(d)
    ic = np.clip(i, 0, len(pts) - 1)
    m = np.where(ok, T.ss(hw[ic] + 2.0, hw[ic] - 1.0, d), 0)
    return m.reshape(X.shape), np.where(ok, cl[ic], 9).reshape(X.shape)


if __name__ == "__main__":
    main()
