#!/usr/bin/env python3
"""DUSHANBE-X: builds the open world north of the peninsula (docs/WORLD_PLAN.md).

  python3 -I tools/world/build_world.py            (from dushanbe_city_src, ~2 min)

Outputs (dushanbe_city/data/world/):
  height.bin     float32, 1281 x 1281 (8 m grid), roads and plots carved in
  splat.bin      raw RGBA8 weights for the terrain shader: R rock, G snow, B earth/dirt, A sand (grass = rest)
  biome.bin      raw RGBA8: R forest density, G orchard/field, B settlement, A river/lake proximity
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
import furniture as FU

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
        P = T.resample(wps, 2.0)
        if rid not in ("ring", "rudaki", "d_link", "e_link"):
            P = clip_to_ring(P)
        Wx, Wz = NW.city_warp(P[:, 0], P[:, 1])
        P = T.resample(np.stack([Wx, Wz], 1), 4.0)
        roads.append({"id": rid, "name": nm, "cls": cls, "P": P, "routed": False})
    for rid, nm, cls, wps0 in NW.ROUTED + NW.DIRT:
        wps = [NW.warp_pt(x, z) for (x, z) in wps0]
        g = NW.CLASSES[cls]["g"]
        pts = []
        for a, b in zip(wps[:-1], wps[1:]):
            seg = rt.route(a, b, g, margin=1500.0 if cls == "mountain" else 900.0)
            pts += seg if not pts else seg[1:]
        # exact waypoints at the ends (junctions with other roads)
        pts[0] = wps[0]; pts[-1] = wps[-1]
        P = R.smooth_route(pts)
        c = NW.CLASSES[cls]
        P = R.remove_loops(P, c["w"] + 2.0, lambda xs, zs: H_at(xs, zs))
        P = R.smooth_route(P)
        P = R.min_radius(P, c["w"] / 2 + (5.0 if c["surf"] != "dirt" else 4.0))
        P[0] = wps[0]; P[-1] = wps[-1]
        ov = R.self_overlaps(P, c["w"] + 1.0)
        if ov:
            print("  %s: %d self-overlapping point pairs after smoothing" % (rid, len(ov)))
        roads.append({"id": rid, "name": nm, "cls": cls, "P": P, "routed": True})
    connect_ends(roads)
    log("routed", len(roads), "roads, %.1f km" % (sum(np.sum(np.hypot(*np.diff(r["P"], axis=0).T)) for r in roads) / 1000))

    # ------------------------------------------------------------------ profiles (major roads first)
    roads.sort(key=lambda r: PRIO[r["cls"]])
    water_d = np.minimum(np.minimum(F["d_var"], F["d_gis"]), np.minimum(F["d_east"], F["d_trib"]))
    H = H0.copy()
    global LOCK
    LOCK = np.zeros(H.shape, bool)          # cells under finished roads: later roads never move them
    done_pts = []          # (x, z, h, half width) of finished roads (junction pinning)
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        P = r["P"]
        dirt = c["surf"] == "dirt" or r["cls"] == "lane"
        win = 120.0 if not r["routed"] else (16.0 if dirt else (45.0 if r["cls"] == "mountain" else 60.0))
        # mountain roads: the profile follows the slope (up to 15 %, real mountain roads) instead of
        # hanging over the valley as a long viaduct; only water is bridged
        gprof = c["g"] * (1.6 if dirt else (1.4 if r["cls"] == "mountain" else 1.0))
        hp, h = R.profile(P, lambda xs, zs: H_at(xs, zs, H), gprof, win=win if r["cls"] != "mountain" else 24.0)
        h_orig = H_at(P[:, 0], P[:, 1])
        # pin points lying on earlier (major) roads to their height
        if done_pts:
            D = np.array(done_pts)
            tree = cKDTree(D[:, :2])
            dd, ii = tree.query(P, k=1)
            on = dd < D[ii, 3] + 1.0
            # pin only at-grade junctions (similar level) and the road's own ends; a crossing at a
            # very different level stays free -> it becomes a bridge / underpass
            near_level = np.abs(D[ii, 2] - hp) < 4.0
            ends = np.zeros(len(P), bool); ends[:12] = True; ends[-12:] = True
            on = on & (near_level | ends)
            if on.any():
                pin = np.where(on, D[ii, 2], np.nan)
                hp = pinned_profile(hp, pin, c["g"])
        # roads starting at the seam: exactly on the peninsula's ground there, and the ribbon reaches
        # 6 m over it (the old terrain's edge at z = -800 is under the road, never a step)
        if P[0][1] > -830.0:
            import build_coast as bc
            h_old = float(bc.fields(np.array([P[0][0]]), np.array([P[0][1]]))["h"][0])
            ext = P[0] + (P[0] - P[1]) / max(np.linalg.norm(P[0] - P[1]), 1e-6) * 6.0
            h_ext = float(bc.fields(np.array([ext[0]]), np.array([ext[1]]))["h"][0])
            P = np.concatenate([[ext], P])
            r["P"] = P
            hp = np.concatenate([[h_ext], hp])
            corr = h_old - hp[1]
            w = np.exp(-np.arange(len(hp)) * 4.0 / 60.0)          # fade the correction over ~60 m
            hp = hp + corr * w
            hp[0] = h_ext
            hp[1] = h_old
            h_orig = np.concatenate([[h_ext], h_orig])
        wd = T_sample(water_d, P)
        r["H"] = hp
        r["water"] = wd < 18.0
        r["bridges"], r["tunnels"] = R.structures(P, hp, h_orig, r["water"], allow_tunnels=not dirt, bridge_h=99.0 if dirt or r["cls"] == "mountain" else (20.0 if r["cls"] == "road" else 6.0))
        # city grid streets over the river are bridges at the river only (the basin is flat)
        for (a, b) in r["bridges"]:
            pass
        for k in range(len(P)):
            done_pts.append((P[k, 0], P[k, 1], hp[k], c["w"] / 2))
        H = carve(H, H0, X, Z, P, hp, c["w"] / 2, r["bridges"], r["tunnels"], dirt=c["surf"] == "dirt", lock=LOCK)
    split_structures_at_junctions(roads)
    log("profiles + carving done")
    for r in roads:
        log("  %-10s %-9s %6.0f m  h %4.0f..%4.0f  bridges %d tunnels %d" % (
            r["id"], r["cls"], np.sum(np.hypot(*np.diff(r["P"], axis=0).T)), r["H"].min(), r["H"].max(), len(r["bridges"]), len(r["tunnels"])))

    # ------------------------------------------------------------------ places, buildings, signs
    fillets, crossings = FU.fillets_and_crossings(roads)
    log("junction fillets %d, zebra crossings %d" % (len(fillets), len(crossings)))
    kites = []
    for fl in fillets:
        C = np.array([fl["c"][0], fl["c"][2]]); O = np.array(fl["o"])
        kites.append(((C + O) / 2, np.linalg.norm(C - O) / 2 + 1.5))
    world = PL.build(roads, H, H_at, F, avoid=kites)
    water_all = np.minimum(np.minimum(F["d_var"], F["d_gis"]), np.minimum(F["d_east"], F["d_trib"]))

    def water_ok(x, z):
        i = int(np.clip(round((x - T.X0) / T.STEP), 0, T.N - 1)); j = int(np.clip(round((z - T.Z0) / T.STEP), 0, T.N - 1))
        return water_all[j, i] > 30.0 and F["lake_d"][j, i] > 1.3 and F["kom_d"][j, i] > 1.35
    avoid_lm = world["landmarks"] + [{"x": fs["x"], "z": fs["z"], "L": 44.0, "D": 36.0} for fs in world["fuel"] + world["services"]]
    world["billboards"] = FU.billboards(roads, world["buildings"], avoid_lm, lambda xs, zs: H_at(xs, zs, H), water_ok)
    world["guardrails"] = FU.guardrails(roads, lambda xs, zs: H_at(xs, zs, H))
    nd = add_driveways(roads, world, lambda xs, zs: H_at(xs, zs, H))
    # boards that now stand on a driveway go (a 15.5 m board: 8 m + the lane's 3 m + margin)
    drv = [r for r in roads if str(r["id"]).startswith("drive")]
    if drv:
        dp = np.concatenate([r["P"] for r in drv])
        dt = cKDTree(dp)
        before = len(world["billboards"])
        world["billboards"] = [b for b in world["billboards"] if dt.query((b["x"], b["z"]))[0] > 13.0]
        log("billboards removed from driveways: %d" % (before - len(world["billboards"])))
    log("driveways (shops, malls, auto services -> the nearest road): %d" % nd)
    world["fillets"] = fillets
    world["crossings"] = crossings
    log("billboards %d, guardrail runs %d (%.1f km)" % (len(world["billboards"]), len(world["guardrails"]),
        sum(np.sum(np.hypot(*np.diff(np.array(g["p"])[:, [0, 2]], axis=0).T)) for g in world["guardrails"]) / 1000))
    log("places: %d buildings, %d landmarks, %d signs" % (len(world["buildings"]), len(world["landmarks"]), len(world["signs"])))
    # flatten building plots (never the cells under / next to a road)
    rm0, _ = rasterize_roads(roads, X, Z)
    H_before = H.copy()
    H = PL.flatten_plots(H, X, Z, world)
    H = np.where(rm0 > 0.05, H_before, H)
    # remove carving artefacts (switchbacks stacked above each other: the nearest-road fill / cut
    # can flip between levels from one cell to the next) - never under a road surface
    H = despike(H, rm0 > 0.3)
    H = enforce_roads(H, roads)
    H = shoulders(H, roads)
    H = enforce_tunnels(H, roads)
    H = enforce_roads(H, roads, it=12)       # last: nothing may end up above a road surface
    H = enforce_nodes(H, X, Z, roads)
    H = enforce_fillets(H, X, Z, world["fillets"])
    log("terrain above any road after enforcement: %d samples" % check_roads(H, roads))

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
    (splat * 255).astype(np.uint8).tofile(os.path.join(OUT, "splat.bin"))       # raw RGBA8, rows = z
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
    (np.clip(biome, 0, 1) * 255).astype(np.uint8).tofile(os.path.join(OUT, "biome.bin"))
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
    H.astype("<f4").tofile(os.path.join(OUT, "height.bin"))      # float32, rows = z (loads with one call)

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
    log("river surface lowered under / beside roads at %d points" % PL.rivers_under_roads(W["rivers"], W["roads"]))
    W["lakes"] = [{"id": "lake", "name": "Озеро Искандар", "c": [T.LAKE[0], T.LAKE[1]], "r": [T.LAKE[2], T.LAKE[3]], "level": 520.0},
                  {"id": "komsomol", "name": "Комсомольское озеро", "c": [T.KOMSOMOL[0], T.KOMSOMOL[1]], "r": [T.KOMSOMOL[2], T.KOMSOMOL[3]], "level": 0.2}]
    W["waterfalls"] = [{"x": T.WATERFALL[0], "z": T.WATERFALL[1], "top": 262.0, "bottom": 234.0}]
    W.update(world)
    log("terrain raised under floating roads at %d nodes" % PL.fill_under_roads(H, W["roads"], W["rivers"]))
    H.astype("<f4").tofile(os.path.join(OUT, "height.bin"))
    json.dump(W, open(os.path.join(OUT, "world.json"), "w"), ensure_ascii=False, separators=(",", ":"))
    log("world.json %.1f MB" % (os.path.getsize(os.path.join(OUT, "world.json")) / 1e6))
    PL.write_map(W, H, splat, biome, road_mask, os.path.join(GAME, "assets", "ui", "world_map.png"))
    log("map written. done")


def enforce_fillets(H, X, Z, fillets, clearance=0.22):
    """terrain under the rounded junction corners (kite C-T1-O-T2 + 2 m) stays under their surface"""
    def contains(poly, pts):
        """convex polygon (any winding): all edge cross products of one sign"""
        sgn = None
        res = np.ones(len(pts), bool)
        cr_all = []
        for a, b in zip(poly, poly[1:] + poly[:1]):
            cr_all.append((b[0] - a[0]) * (pts[:, 1] - a[1]) - (b[1] - a[1]) * (pts[:, 0] - a[0]))
        cr = np.array(cr_all)
        return (cr >= 0).all(0) | (cr <= 0).all(0)
    for fl in fillets:
        C = np.array([fl["c"][0], fl["c"][2]]); O = np.array(fl["o"]); T1 = np.array(fl["t1"]); T2 = np.array(fl["t2"])
        cen = (C + O) / 2
        poly = [cen + (p - cen) * (1 + 2.5 / max(np.linalg.norm(p - cen), 1)) for p in (C, T1, O, T2)]
        lo = np.min(poly, 0); hi = np.max(poly, 0)
        i0 = int(max((lo[0] - T.X0) / T.STEP - 1, 0)); i1 = int(min((hi[0] - T.X0) / T.STEP + 2, T.N))
        j0 = int(max((lo[1] - T.Z0) / T.STEP - 1, 0)); j1 = int(min((hi[1] - T.Z0) / T.STEP + 2, T.N))
        sub = np.stack([X[j0:j1, i0:i1].ravel(), Z[j0:j1, i0:i1].ravel()], 1)
        inside = contains(poly, sub).reshape(j1 - j0, i1 - i0)
        blk = H[j0:j1, i0:i1]
        H[j0:j1, i0:i1] = np.where(inside, np.minimum(blk, fl["c"][1] - clearance), blk)
    return H


def clip_to_ring(P):
    """keep the part of a city street inside the rounded ring; its ends exactly on the ring line"""
    inside = np.array([NW.in_ring(x, z) for x, z in P])
    if inside.all():
        return P
    idx = np.nonzero(inside)[0]
    a, b = idx[0], idx[-1]
    out = [P[k] for k in range(a, b + 1)]

    def edge(pin, pout):
        lo, hi = np.array(pin, float), np.array(pout, float)
        for _ in range(30):
            m = (lo + hi) / 2
            if NW.in_ring(m[0], m[1]):
                lo = m
            else:
                hi = m
        return lo
    if a > 0:
        out.insert(0, edge(P[a], P[a - 1]))
    if b < len(P) - 1:
        out.append(edge(P[b], P[b + 1]))
    return np.array(out)


def enforce_roads(H, roads, clearance=0.22, it=4):
    """guarantee: the bilinear terrain is below every road surface (across its full width + 2 m),
    except inside tunnels; lowers the 4 grid cells around any sample that pokes through"""
    for _ in range(it):
        moved = 0
        for r in roads:
            c = NW.CLASSES[r["cls"]]
            P = r["P"]; hp = r["H"]
            tun = np.zeros(len(P), bool)
            for a, b in r["tunnels"]:
                tun[a:b + 1] = True
            d = np.gradient(P, axis=0); d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6)
            nrm = np.stack([-d[:, 1], d[:, 0]], 1)
            for off in np.arange(-(c["w"] / 2 + 4.5), c["w"] / 2 + 4.51, 1.5):
                Q = P + nrm * off
                fx = (Q[:, 0] - T.X0) / T.STEP; fz = (Q[:, 1] - T.Z0) / T.STEP
                i = np.clip(np.floor(fx).astype(int), 0, T.N - 2); j = np.clip(np.floor(fz).astype(int), 0, T.N - 2)
                u = fx - i; v = fz - j
                h = H[j, i] * (1 - u) * (1 - v) + H[j, i + 1] * u * (1 - v) + H[j + 1, i] * (1 - u) * v + H[j + 1, i + 1] * u * v
                ex = h - (hp - clearance)
                bad = (ex > 0) & ~tun
                if not bad.any():
                    continue
                moved += int(bad.sum())
                for (jj, ii) in [(0, 0), (0, 1), (1, 0), (1, 1)]:
                    J = j[bad] + jj; I = i[bad] + ii
                    np.minimum.at(H, (J, I), H[J, I] - ex[bad] - 0.02)
        if moved == 0:
            break
    return H


def enforce_nodes(H, X, Z, roads, clearance=0.22):
    """every terrain grid node inside a road corridor (half width + 4.5 m) is clamped under the road
    height at that node's projection (roads densified to 1 m) - the terrain triangles can no longer
    poke through between the 4 m road samples"""
    pts = []; hs = []; rad = []
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        P = r["P"]; hp = r["H"]
        tun = np.zeros(len(P), bool)
        for a, b in r["tunnels"]:
            tun[a:b + 1] = True
        for k in range(len(P) - 1):
            if tun[k] or tun[k + 1]:
                continue
            n = 4
            for t in np.linspace(0, 1, n, endpoint=False):
                pts.append(P[k] * (1 - t) + P[k + 1] * t)
                hs.append(hp[k] * (1 - t) + hp[k + 1] * t)
                rad.append(c["w"] / 2 + 4.5)
    pts = np.array(pts); hs = np.array(hs); rad = np.array(rad)
    tree = cKDTree(pts)
    nodes = np.stack([X.ravel(), Z.ravel()], 1)
    lim = np.full(nodes.shape[0], np.inf)
    for i, near in enumerate(tree.query_ball_point(nodes, r=rad.max())):
        if not near:
            continue
        nr = np.array(near)
        d = np.hypot(pts[nr, 0] - nodes[i, 0], pts[nr, 1] - nodes[i, 1])
        ok = d <= rad[nr]
        if ok.any():
            lim[i] = hs[nr[ok]].min() - clearance
    flat = H.ravel()
    flat = np.where(np.isfinite(lim), np.minimum(flat, lim), flat)
    return flat.reshape(H.shape)


def check_roads(H, roads, clearance=0.2):
    n = 0
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        P = r["P"]; hp = r["H"]
        tun = np.zeros(len(P), bool)
        for a, b in r["tunnels"]:
            tun[a:b + 1] = True
        d = np.gradient(P, axis=0); d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6)
        nrm = np.stack([-d[:, 1], d[:, 0]], 1)
        for off in np.arange(-(c["w"] / 2 + 4.5), c["w"] / 2 + 4.51, 1.5):
            Q = P + nrm * off
            fx = (Q[:, 0] - T.X0) / T.STEP; fz = (Q[:, 1] - T.Z0) / T.STEP
            i = np.clip(np.floor(fx).astype(int), 0, T.N - 2); j = np.clip(np.floor(fz).astype(int), 0, T.N - 2)
            u = fx - i; v = fz - j
            h = H[j, i] * (1 - u) * (1 - v) + H[j, i + 1] * u * (1 - v) + H[j + 1, i] * (1 - u) * v + H[j + 1, i + 1] * u * v
            bad = (h - (hp - clearance) > 0.01) & ~tun
            n += int(bad.sum())
            if bad.any() and r["id"] == "pass":
                k = int(np.nonzero(bad)[0][0])
                print("   pass violation k=%d off=%.1f h=%.2f road=%.2f" % (k, off, h[k], hp[k]))
    return n


def shoulders(H, roads):
    """after the enforcement the ground beside a road can be far below it (a high, edge-less
    embankment): raise every cell around the carriageway (+3 m) up to 0.3 m under the road, never
    above 0.22 m under any road sample nearby (bridges excluded)"""
    target = np.full(H.shape, -1e9)
    allowed = np.full(H.shape, 1e9)
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        P = r["P"]; hp = r["H"]
        skip = np.zeros(len(P), bool)
        for a, b in r["bridges"] + r["tunnels"]:
            skip[a:b + 1] = True
        d = np.gradient(P, axis=0); d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-6)
        nrm = np.stack([-d[:, 1], d[:, 0]], 1)
        for off in np.arange(-(c["w"] / 2 + 4.5), c["w"] / 2 + 4.51, 1.5):
            Q = P + nrm * off
            fx = (Q[:, 0] - T.X0) / T.STEP; fz = (Q[:, 1] - T.Z0) / T.STEP
            i = np.clip(np.floor(fx).astype(int), 0, T.N - 2); j = np.clip(np.floor(fz).astype(int), 0, T.N - 2)
            for (jj, ii) in [(0, 0), (0, 1), (1, 0), (1, 1)]:
                J = j + jj; I = i + ii
                np.minimum.at(allowed, (J, I), hp - 0.22)
                np.maximum.at(target, (J[~skip], I[~skip]), (hp - 0.3)[~skip])
    near = target > -1e8
    H = np.where(near, np.minimum(np.maximum(H, target), allowed), H)
    return H


def enforce_tunnels(H, roads, cover=9.0):
    """inside tunnels (away from the portals) the mountain is above the vault everywhere across the
    tube: no slope may cut through it; the game removes the terrain triangles at the portals"""
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        P = r["P"]; hp = r["H"]
        for (a, b) in r["tunnels"]:
            for k in range(a + 3, b - 2):
                d = P[min(k + 1, len(P) - 1)] - P[max(k - 1, 0)]
                d = d / max(np.linalg.norm(d), 1e-6)
                n = np.array([-d[1], d[0]])
                for off in np.arange(-(c["w"] / 2 + 6.0), c["w"] / 2 + 6.01, 4.0):
                    q = P[k] + n * off
                    i = int(round((q[0] - T.X0) / T.STEP)); j = int(round((q[1] - T.Z0) / T.STEP))
                    if 0 <= i < T.N and 0 <= j < T.N:
                        H[j, i] = max(H[j, i], hp[k] + cover)
    return H


def despike(H, protect, it=4, tol=4.0):
    from scipy.ndimage import median_filter
    for _ in range(it):
        M = median_filter(H, 3)
        bad = (np.abs(H - M) > tol) & ~protect
        H = np.where(bad, M, H)
    # gentle cap of the steepness next to roads: no vertical walls between switchbacks
    return H


def split_structures_at_junctions(roads):
    """where another road meets / crosses a bridge or tunnel AT THE SAME LEVEL (|dh| < 4.5 m), the
    structure is interrupted there (an at-grade junction: no parapets / tunnel walls across a road)"""
    for r in roads:
        P = r["P"]; hp = r["H"]
        for key in ("bridges", "tunnels"):
            out = []
            for (a, b) in r[key]:
                block = np.zeros(b - a + 1, bool)
                for o in roads:
                    if o is r:
                        continue
                    hw = NW.CLASSES[o["cls"]]["w"] / 2 + NW.CLASSES[r["cls"]]["w"] / 2 + 12.0
                    Q = o["P"]
                    tree = cKDTree(Q)
                    d, i = tree.query(P[a:b + 1], k=1)
                    near = (d < hw) & (np.abs(o["H"][i] - hp[a:b + 1]) < 4.5)
                    block |= near
                # keep the structure pieces between junctions (min 4 points)
                k = 0
                while k < len(block):
                    if block[k]:
                        k += 1
                        continue
                    j = k
                    while j < len(block) and not block[j]:
                        j += 1
                    if j - k >= 4:
                        out.append([a + k, a + j - 1])
                    k = j
            if out != r[key]:
                print("  %s %s split at junctions: %s -> %s" % (r["id"], key, r[key], out))
            r[key] = out


def connect_ends(roads, reach=150.0):
    """a road that starts / ends at a waypoint in the middle of another road must physically join
    it. First the stretch that runs ON / along the other road is trimmed (no doubled, diverging
    surfaces), then a smooth connector (quadratic curve) joins the remaining end to the nearest point
    of the other road (no dead ends, no gaps)."""
    for r in roads:
        for end in (0, -1):
            P = r["P"]
            p = P[end]
            if p[1] > -830.0:
                continue                     # ends at the seam: joins the peninsula's road there
            best = (1e9, None, None)
            for o in roads:
                if o is r:
                    continue
                d = np.hypot(o["P"][:, 0] - p[0], o["P"][:, 1] - p[1])
                k = int(np.argmin(d))
                if d[k] < best[0]:
                    best = (float(d[k]), o, k)
            if best[1] is None or best[0] > reach or best[0] < 1.0:
                continue                     # far away, or already exactly on the other road
            o = best[1]
            clear = NW.CLASSES[o["cls"]]["w"] / 2 + NW.CLASSES[r["cls"]]["w"] / 2 + 3.0
            tree = cKDTree(o["P"])
            dd, _ = tree.query(P)
            seq = range(len(P)) if end == 0 else range(len(P) - 1, -1, -1)
            first = None
            for k in seq:
                if dd[k] > clear:
                    first = k
                    break
            if first is None:
                continue
            keep = P[first:] if end == 0 else P[:first + 1]
            q_end = keep[0] if end == 0 else keep[-1]
            _, kk = tree.query(q_end)
            q = o["P"][kk]
            if np.hypot(*(q - q_end)) < 1.0:
                continue
            # quadratic connector: from the other road's point, leaving it perpendicular-ish, to the kept end
            tdir = (keep[min(3, len(keep) - 1)] - keep[0]) if end == 0 else (keep[-1] - keep[max(-4, -len(keep))])
            tdir = tdir / max(np.linalg.norm(tdir), 1e-6)
            L = np.hypot(*(q_end - q))
            ctrl = q_end - tdir * L * 0.5 if end == 0 else q_end + tdir * L * 0.5
            t = np.linspace(0, 1, max(3, int(L / 4.0) + 2))[:, None]
            curve = (1 - t) ** 2 * q + 2 * (1 - t) * t * ctrl + t ** 2 * q_end
            if end == 0:
                r["P"] = T.resample(np.concatenate([curve[:-1], keep]), 4.0)
                r["P"][0] = q
            else:
                r["P"] = T.resample(np.concatenate([keep, curve[::-1][1:]]), 4.0)
                r["P"][-1] = q
            print("  connector: %s %s -> %s, trimmed %d pts, %.0f m" % (r["id"], "start" if end == 0 else "end", o["id"], first if end == 0 else len(P) - 1 - first, L))


def add_driveways(roads, world, H_at):
    """0.21: every shop / mall / auto service gets a real asphalt lane (6 m) from its front (car park,
    repair pad) to the nearest road, so the player never has to cross a lawn; they join the road
    network (navigator) like any other road"""
    pts = []; owner = []
    for i, r in enumerate(roads):
        for p in r["P"]:
            pts.append(p); owner.append(i)
    tree = cKDTree(np.array(pts))
    starts = []
    for b in world["buildings"]:
        if b[0] in ("amid_m", "mall_m"):
            yaw = b[3]
            fx, fz = -math.sin(yaw), -math.cos(yaw)          # the plan's street side (local -Z)
            starts.append((b[1] + fx * (b[5] / 2 - 2.0), b[2] + fz * (b[5] / 2 - 2.0), "mall"))
    for sv in world.get("services", []):
        yaw = sv["yaw"]
        dx, dz = math.cos(yaw), -math.sin(yaw)                # garage front (+X) towards the road
        starts.append((sv["ox"] + dx * 14.0, sv["oz"] + dz * 14.0, "service"))
    n = 0
    for (x, z, kind) in starts:
        d, j = tree.query((x, z))
        if d < 3.0 or d > 140.0:
            continue
        rx, rz = pts[j]
        L = math.hypot(rx - x, rz - z)
        k = max(2, int(L / 4.0) + 1)
        P = np.array([[x + (rx - x) * t, z + (rz - z) * t] for t in np.linspace(0.0, 1.0, k)])
        Hh = H_at(P[:, 0], P[:, 1])
        Hh[-1] = float(roads[owner[j]]["H"][min(j - sum(len(roads[q]["P"]) for q in range(owner[j])), len(roads[owner[j]]["H"]) - 1)])
        roads.append({"id": "drive%d" % n, "name": "", "cls": "lane", "P": P, "H": np.asarray(Hh, float),
                      "routed": False, "bridges": [], "tunnels": [], "water": np.zeros(len(P), bool)})
        n += 1
    return n


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


LOCK = None


def carve(H, H0, X, Z, P, hp, hw, bridges, tunnels, dirt=False, lock=None):
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
    w0 = hw + 1.5 + 4.0                     # + half a grid cell: the 8 m terrain never rises over the road edge
    under = hr - (0.05 if dirt else 0.25)
    cut = np.minimum(sub, under + np.maximum(d0 - w0, 0) / 1.5)
    fill = np.maximum(sub, np.minimum(under - np.maximum(d0 - w0, 0) / 1.5, sub + 60.0))
    new = np.where(d0 <= w0, under, np.where(sub > hr, cut, fill))
    new = np.where(ok, new, sub)
    if lock is not None:
        lk = lock[j0:j1, i0:i1].ravel()
        new = np.where(lk, sub, new)
        lock[j0:j1, i0:i1] = (lk | (ok & (d0 <= w0))).reshape(sx.shape)
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
