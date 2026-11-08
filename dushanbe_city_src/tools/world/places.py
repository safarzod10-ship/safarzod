"""Settlements of the DUSHANBE-X world: city blocks and buildings, villages, landmarks, signs,
kilometre posts, fuel stations, rivers (water ribbons) and the top-down world map.

Buildings are stored as compact specs; the game builds their meshes at runtime (world_buildings.gd):
  [kind, x, z, yaw, L, D, floors, seed, h_base]
kinds: panel5 panel9 tower office admin hotel shop house school market cottage garage
"""
import math
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy.spatial import cKDTree
import terrain as T
import network as NW

RNG = np.random.default_rng(2026)

# landmarks: id, name, x, z, yaw, footprint (L, D) -> plot is flattened and kept free of buildings
LANDMARKS = [
    ("somoni", "Памятник Исмоили Сомони и площадь Дусти", -175.0, -2475.0, 0.0, (150.0, 120.0)),
    ("rudaki_park", "Парк Рудаки", 150.0, -2655.0, 0.0, (220.0, 230.0)),
    ("museum", "Национальный музей", 230.0, -3380.0, 0.0, (160.0, 90.0)),
    ("library", "Национальная библиотека", -250.0, -3380.0, 0.0, (150.0, 90.0)),
    ("flag", "Парк Национального флага", 120.0, -3780.0, 0.0, (240.0, 300.0)),
    ("palace", "Дворец Наций", -250.0, -3800.0, 0.0, (170.0, 150.0)),
    ("navruz", "Кохи Навруз", -700.0, -1800.0, 0.0, (170.0, 140.0)),
    ("opera", "Театр оперы и балета", -230.0, -1800.0, 0.0, (110.0, 80.0)),
    ("mehrgon", "Рынок Мехргон", 620.0, -2200.0, 0.0, (180.0, 140.0)),
    ("hisor_fort", "Гиссарская крепость", -4500.0, -2900.0, 0.3, (150.0, 110.0)),
    ("hisor_bazaar", "Гиссарский рынок", -4050.0, -2300.0, 0.0, (100.0, 70.0)),
]
FUEL = [("fuel_n", "rudaki", -40.0, -4350.0), ("fuel_g", "gissar", -3300.0, -2385.0),
        ("fuel_v", "m34", 0, 0), ("fuel_e", "east", 3000.0, -2150.0)]


def build(roads, H, H_at, F):
    road_pts = []; road_hw = []
    for r in roads:
        c = NW.CLASSES[r["cls"]]
        road_pts.extend(r["P"].tolist()); road_hw.extend([c["w"] / 2] * len(r["P"]))
    road_pts = np.array(road_pts); road_hw = np.array(road_hw)
    rtree = cKDTree(road_pts)
    water_d = np.minimum(np.minimum(F["d_var"], F["d_gis"]), np.minimum(F["d_east"], F["d_trib"]))

    def wd_at(x, z):
        i = int(np.clip(round((x - T.X0) / T.STEP), 0, T.N - 1)); j = int(np.clip(round((z - T.Z0) / T.STEP), 0, T.N - 1))
        return water_d[j, i], F["lake_d"][j, i], F["kom_d"][j, i]

    lm_rects = [(x - L / 2 - 5, z - D / 2 - 5, x + L / 2 + 5, z + D / 2 + 5) for (_, _, x, z, _, (L, D)) in LANDMARKS]

    def free(x, z, L, D, yaw, clear=4.0):
        """footprint clear of roads, water, landmarks"""
        r = math.hypot(L, D) / 2
        for (a, b, c2, d) in lm_rects:
            if a - r < x < c2 + r and b - r < z < d + r:
                return False
        w, ld, kd = wd_at(x, z)
        if w < r + 25 or ld < 1.15 or kd < 1.25:
            return False
        # sample the footprint corners + centre against roads
        cs, sn = math.cos(yaw), math.sin(yaw)
        for (u, v) in [(0, 0), (-L / 2, -D / 2), (L / 2, -D / 2), (L / 2, D / 2), (-L / 2, D / 2), (0, D / 2), (0, -D / 2), (L / 2, 0), (-L / 2, 0)]:
            px = x + u * cs + v * sn; pz = z - u * sn + v * cs
            d, i = rtree.query((px, pz))
            if d < road_hw[i] + clear:
                return False
        return True

    buildings = []

    def add(kind, x, z, yaw, L, D, floors):
        y = float(H_at([x], [z])[0])
        buildings.append([kind, round(x, 2), round(z, 2), round(yaw, 4), round(L, 1), round(D, 1), int(floors), int(RNG.integers(0, 1 << 20)), round(y, 2)])

    # ---------------------------------------------------------------- Dushanbe blocks
    xs = sorted({-1950, -1700, -1300, -900, -500, -40, 400, 1300, 1650, 1950})
    zs = sorted({-1000, -1200, -1600, -2000, -2400, -2800, -3200, -3600, -4000, -4400, -4750})
    for a, b in zip(xs[:-1], xs[1:]):
        for d, c in zip(zs[:-1], zs[1:]):          # c = north edge (larger z), d = south ... (c > d)
            c, d = max(c, d), min(c, d)
            cx = (a + b) / 2; cz = (c + d) / 2
            center = abs(cx) < 1300 and cz > -3400
            outer = abs(cx) > 1450 or cz < -4050
            if outer:
                houses_block(add, free, a, b, c, d)
            elif center:
                perimeter_block(add, free, a, b, c, d, tall=abs(cx) < 700)
            else:
                micro_block(add, free, a, b, c, d)
    n_city = len(buildings)

    # ---------------------------------------------------------------- villages / towns / resorts
    for pid, nm, kind, px, pz, rad in NW.PLACES:
        if kind in ("village", "town"):
            village(add, free, roads, px, pz, rad, town=kind == "town")
        elif kind == "resort":
            resort(add, free, px, pz)
    # roadside houses along the M34 in the gorge and the country roads (dachas, cafes, tea houses)
    for r in roads:
        if r["id"] in ("m34", "east", "gissar", "gissar_n") :
            roadside(add, free, r, every=380.0 if r["id"] == "m34" else 520.0)

    # ---------------------------------------------------------------- landmarks, fuel, signs, km posts
    landmarks = []
    for (lid, nm, x, z, yaw, (L, D)) in LANDMARKS:
        # a landmark's plaza must never cover a road
        cs, sn = math.cos(yaw), math.sin(yaw)
        for u in np.linspace(-L / 2, L / 2, 9):
            for v in np.linspace(-D / 2, D / 2, 9):
                px = x + u * cs + v * sn; pz = z - u * sn + v * cs
                d, i = rtree.query((px, pz))
                if d < road_hw[i] + 1.0:
                    raise SystemExit("landmark %s overlaps a road at (%.0f, %.0f)" % (lid, px, pz))
        landmarks.append({"id": lid, "name": nm, "x": x, "z": z, "yaw": yaw, "L": L, "D": D, "y": round(float(H_at([x], [z])[0]), 2)})
    fuel = []
    by_id = {r["id"]: r for r in roads}
    for fid, rid, x, z in FUEL:
        r = by_id[rid]
        if fid == "fuel_v":
            k = len(r["P"]) // 3
        else:
            k = int(np.argmin(np.hypot(r["P"][:, 0] - x, r["P"][:, 1] - z)))
        p = r["P"][k]; q = r["P"][min(k + 3, len(r["P"]) - 1)]
        dx, dz = q - p; L = math.hypot(dx, dz); nx, nz = dz / L, -dx / L
        off = NW.CLASSES[r["cls"]]["w"] / 2 + 22.0
        fx, fz = p[0] + nx * off, p[1] + nz * off
        fuel.append({"id": fid, "x": round(fx, 2), "z": round(fz, 2), "yaw": round(math.atan2(dx, dz), 4), "y": round(float(H_at([fx], [fz])[0]), 2),
                     "road": rid})
    signs = make_signs(roads, H_at)
    kms = make_kmposts(roads, H_at)
    places = [{"id": p[0], "name": p[1], "kind": p[2], "x": p[3], "z": p[4], "r": p[5]} for p in NW.PLACES]
    print("buildings: city %d, villages/roadside %d" % (n_city, len(buildings) - n_city))
    return {"buildings": buildings, "landmarks": landmarks, "fuel": fuel, "signs": signs, "kmposts": kms, "places": places}


# -------------------------------------------------------------------- block layouts
def perimeter_block(add, free, a, b, c, d, tall):
    """city centre (c > d): buildings along all four block edges facing the streets (6-20 storeys,
    shops on the ground floors), a second ring of lower blocks and a school in the courtyard"""
    for ring, inset in ((0, 24.0), (1, 70.0)):
        if ring == 1 and RNG.random() < 0.35:
            continue
        x0, x1, zs_, zn = a + inset, b - inset, d + inset, c - inset
        # edges as (start, end); the building's local +Z points into the block
        for (sx, sz, ex, ez) in [(x0, zn, x1, zn), (x1, zs_, x0, zs_), (x0, zs_, x0, zn), (x1, zn, x1, zs_)]:
            length = math.hypot(ex - sx, ez - sz)
            if length < 40:
                continue
            ux, uz = (ex - sx) / length, (ez - sz) / length
            yaw = math.atan2(-uz, ux)
            # inward normal = local +Z of a building with this yaw: (sin yaw, cos yaw)
            nx, nz = math.sin(yaw), math.cos(yaw)
            cxm, czm = (a + b) / 2, (c + d) / 2
            if (cxm - sx) * nx + (czm - sz) * nz < 0:
                yaw += math.pi; nx, nz = -nx, -nz
            s = 14.0
            while s < length - 14.0:
                if ring == 0:
                    kind = str(RNG.choice(["panel9", "panel9", "office", "hotel", "admin", "tower"] if tall else ["panel9", "panel5", "brick5", "office", "panel9"]))
                else:
                    kind = str(RNG.choice(["panel5", "brick5", "panel5", "school"]))
                L = 30.0 if kind == "tower" else float(RNG.choice([36, 42, 48, 54, 60]))
                if kind == "school":
                    L = 46.0
                L = min(L, length - s - 10)
                if L < 24:
                    break
                D = {"tower": 18.0, "school": 15.0, "panel5": 12.0, "brick5": 12.0}.get(kind, 14.0)
                x = sx + ux * (s + L / 2) + nx * D / 2
                z = sz + uz * (s + L / 2) + nz * D / 2
                floors = {"panel9": 9, "panel5": 5, "brick5": 5, "school": 3, "office": int(RNG.integers(5, 10)),
                          "admin": int(RNG.integers(4, 7)), "hotel": int(RNG.integers(7, 13)), "tower": int(RNG.integers(14, 23))}[kind]
                if free(x, z, L, D, yaw, 3.0):
                    add(kind, x, z, yaw, L, D, floors)
                s += L + float(RNG.choice([8, 12, 18]))


def micro_block(add, free, a, b, c, d):
    """Soviet micro-district: rows of 5 / 9-storey panel blocks, parallel, with yards"""
    x0, x1 = a + 26, b - 26
    zn, zs_ = c - 26, d + 26
    rot = RNG.random() < 0.5
    rows = np.arange(zs_ + 10, zn - 10, 48.0)
    for k, z in enumerate(rows):
        x = x0
        while x < x1 - 30:
            kind = RNG.choice(["panel5", "panel5", "panel9", "brick5"])
            L = float(RNG.choice([48, 60, 72, 84]))
            L = min(L, x1 - x - 4)
            if L < 30:
                break
            cx = x + L / 2
            yaw = 0.0 if not rot else 0.0
            if free(cx, z, L, 12.0, yaw, 4.0):
                add(kind, cx, z, yaw, L, 12.0 if kind != "panel9" else 13.0, {"panel5": 5, "panel9": 9, "brick5": 5}[kind])
            x += L + float(RNG.choice([16, 22, 30]))
    if RNG.random() < 0.6:
        cx = (a + b) / 2 + RNG.uniform(-40, 40); cz = (c + d) / 2
        if free(cx, cz, 50, 16, 0.0):
            add("school", cx, cz, 0.0, 50.0, 16.0, 3)
    if RNG.random() < 0.5:
        sx = a + 40; sz = c - 30
        if free(sx, sz, 30, 14, 0.0):
            add("shop", sx, sz, 0.0, 30.0, 14.0, 1)


def houses_block(add, free, a, b, c, d):
    """private sector (havli): plots ~24 x 30 m, a house at the street side of each plot"""
    for zrow in np.arange(d + 24, c - 20, 32.0):
        for x in np.arange(a + 20, b - 18, 25.0 + RNG.uniform(-2, 4)):
            if RNG.random() < 0.08:
                continue
            L = float(RNG.uniform(11, 17)); D = float(RNG.uniform(8, 11))
            yaw = 0.0 if (int((zrow - d) / 32) % 2 == 0) else math.pi
            if free(x, zrow, L + 6, D + 8, yaw, 3.0):
                add("house", x + RNG.uniform(-2, 2), zrow, yaw, L, D, int(RNG.choice([1, 1, 2])))


def village(add, free, roads, px, pz, rad, town=False):
    """houses along every road inside the radius, both sides, + a few lanes behind"""
    n0 = 0
    for r in roads:
        P = r["P"]
        dd = np.hypot(P[:, 0] - px, P[:, 1] - pz)
        idx = np.nonzero(dd < rad)[0]
        if len(idx) < 4:
            continue
        hw = NW.CLASSES[r["cls"]]["w"] / 2
        for k in idx[::7]:
            if k + 2 >= len(P):
                continue
            p = P[k]; q = P[k + 2]
            dx, dz = q - p; L0 = math.hypot(dx, dz)
            if L0 < 1e-3:
                continue
            nx, nz = dz / L0, -dx / L0
            yaw = math.atan2(dx, dz)
            for side in (-1, 1):
                if RNG.random() < 0.15:
                    continue
                off = hw + 12.0 + RNG.uniform(0, 4)
                x = p[0] + nx * off * side; z = p[1] + nz * off * side
                L = float(RNG.uniform(10, 16)); D = float(RNG.uniform(8, 11))
                kind = "house"
                floors = int(RNG.choice([1, 1, 1, 2]))
                if town and RNG.random() < 0.25:
                    kind, L, D, floors = "shop" if RNG.random() < 0.5 else "brick5", float(RNG.uniform(18, 30)), 12.0, int(RNG.choice([2, 3]))
                facing = yaw + (math.pi / 2 if side > 0 else -math.pi / 2)
                if free(x, z, L + (8 if kind == "house" else 0), D + (30 if kind == "house" else 0), facing, 3.0):
                    add(kind, x, z, facing + math.pi, L, D, floors)
                    n0 += 1
                # second row
                if RNG.random() < 0.55:
                    off2 = off + 30.0
                    x2 = p[0] + nx * off2 * side; z2 = p[1] + nz * off2 * side
                    if free(x2, z2, L + 8, D + 30, facing, 3.0):
                        add("house", x2, z2, facing + math.pi, float(RNG.uniform(10, 15)), float(RNG.uniform(8, 10)), int(RNG.choice([1, 1, 2])))


def resort(add, free, px, pz):
    for k in range(10):
        a = RNG.uniform(0, math.tau); r = RNG.uniform(30, 130)
        x, z = px + math.cos(a) * r, pz + math.sin(a) * r
        if k == 0:
            if free(x, z, 40, 14, a, 3.0):
                add("hotel", x, z, a, 40.0, 14.0, 4)
        elif free(x, z, 10, 8, a, 3.0):
            add("cottage", x, z, a, 9.0, 7.0, 1)


def roadside(add, free, r, every):
    P = r["P"]; hw = NW.CLASSES[r["cls"]]["w"] / 2
    acc = 0.0
    for k in range(1, len(P) - 3):
        acc += math.hypot(*(P[k] - P[k - 1]))
        if acc < every:
            continue
        acc = 0.0
        p = P[k]; q = P[k + 2]; dx, dz = q - p; L0 = math.hypot(dx, dz)
        nx, nz = dz / L0, -dx / L0
        side = 1 if RNG.random() < 0.5 else -1
        off = hw + 14.0
        x = p[0] + nx * off * side; z = p[1] + nz * off * side
        yaw = math.atan2(dx, dz) + (math.pi / 2 if side > 0 else -math.pi / 2)
        kind = RNG.choice(["house", "house", "shop", "cottage"])
        L, D = (20.0, 12.0) if kind == "shop" else (float(RNG.uniform(10, 15)), 9.0)
        if free(x, z, L + 8, D + 30, yaw, 3.0):
            add(kind, x, z, yaw + math.pi, L, D, 1 if kind != "house" else int(RNG.choice([1, 2])))


# -------------------------------------------------------------------- terrain under buildings
def flatten_plots(H, X, Z, world):
    """level the ground under each building (and landmark plaza) to its base height"""
    for b in world["buildings"]:
        kind, x, z, yaw, L, D = b[0], b[1], b[2], b[3], b[4], b[5]
        rad = math.hypot(L, D) / 2 + 6
        i0 = max(0, int((x - rad - T.X0) / T.STEP)); i1 = min(T.N, int((x + rad - T.X0) / T.STEP) + 2)
        j0 = max(0, int((z - rad - T.Z0) / T.STEP)); j1 = min(T.N, int((z + rad - T.Z0) / T.STEP) + 2)
        sub = H[j0:j1, i0:i1]
        y = float(np.median(sub))
        b[8] = round(y, 2)
        dd = np.hypot(X[j0:j1, i0:i1] - x, Z[j0:j1, i0:i1] - z)
        w = T.ss(rad, rad - 8, dd)
        H[j0:j1, i0:i1] = sub * (1 - w) + y * w
    for lm in world["landmarks"]:
        x, z, L, D = lm["x"], lm["z"], lm["L"], lm["D"]
        i0 = max(0, int((x - L / 2 - 30 - T.X0) / T.STEP)); i1 = min(T.N, int((x + L / 2 + 30 - T.X0) / T.STEP) + 2)
        j0 = max(0, int((z - D / 2 - 30 - T.Z0) / T.STEP)); j1 = min(T.N, int((z + D / 2 + 30 - T.Z0) / T.STEP) + 2)
        sub = H[j0:j1, i0:i1]
        y = float(np.median(sub)); lm["y"] = round(y, 2)
        ex = np.maximum(np.abs(X[j0:j1, i0:i1] - x) - L / 2, 0); ez = np.maximum(np.abs(Z[j0:j1, i0:i1] - z) - D / 2, 0)
        w = T.ss(30, 0, np.hypot(ex, ez))
        H[j0:j1, i0:i1] = sub * (1 - w) + y * w
    for f in world["fuel"]:
        x, z = f["x"], f["z"]
        i0 = max(0, int((x - 40 - T.X0) / T.STEP)); i1 = min(T.N, int((x + 40 - T.X0) / T.STEP) + 2)
        j0 = max(0, int((z - 40 - T.Z0) / T.STEP)); j1 = min(T.N, int((z + 40 - T.Z0) / T.STEP) + 2)
        sub = H[j0:j1, i0:i1]; y = f["y"]
        w = T.ss(40, 24, np.hypot(X[j0:j1, i0:i1] - x, Z[j0:j1, i0:i1] - z))
        H[j0:j1, i0:i1] = sub * (1 - w) + y * w
    return H


def settlement_mask(X, Z, world):
    m = np.zeros(X.shape)
    for p in world["places"]:
        if p["kind"] in ("village", "town", "resort", "city"):
            d = np.hypot(X - p["x"], Z - p["z"])
            m = np.maximum(m, T.ss(p["r"] * 1.1, p["r"] * 0.7, d))
    m = np.maximum(m, T.ss(2150, 1950, np.abs(X)) * T.ss(-4950, -4750, Z) * T.ss(-850, -1000, Z))
    return m


# -------------------------------------------------------------------- signs / km posts
def make_signs(roads, H_at):
    """town entry/exit plates where named roads enter a place radius; direction signs at the
    start of every routed road"""
    out = []
    for r in roads:
        P = r["P"]
        hw = NW.CLASSES[r["cls"]]["w"] / 2
        for pid, nm, kind, px, pz, rad in NW.PLACES:
            if kind not in ("village", "town", "city", "resort"):
                continue
            inside = np.hypot(P[:, 0] - px, P[:, 1] - pz) < rad
            ch = np.nonzero(np.diff(inside.astype(int)))[0]
            for k in ch[:4]:
                k2 = min(k + 2, len(P) - 1)
                dx, dz = P[k2] - P[k]; L = math.hypot(dx, dz) or 1
                entering = inside[k2]
                nx, nz = dz / L, -dx / L
                x, z = P[k, 0] + nx * (hw + 2.5), P[k, 1] + nz * (hw + 2.5)
                out.append({"t": "town", "text": nm, "end": not entering, "x": round(float(x), 2), "z": round(float(z), 2),
                            "y": round(float(H_at([x], [z])[0]), 2), "yaw": round(math.atan2(dx, dz) + (math.pi if entering else 0), 4)})
    # direction signs at the start of routed roads
    dest = {"m34": "Варзоб 7 км · Сафеддара 11 км", "gissar": "Гиссар 3 км", "east": "Ромит 5 км",
            "pass": "Перевал Анзоб · Озеро Искандар", "east_mtn": "Симиганч · Восточные горы",
            "lake_down": "Гиссар", "gissar_n": "Ханака · Горы", "fall": "Водопад 1 км", "view": "Смотровая площадка"}
    for r in roads:
        if r["id"] not in dest:
            continue
        P = r["P"]; k = 12 if len(P) > 20 else 1
        dx, dz = P[k + 1] - P[k]; L = math.hypot(dx, dz) or 1
        nx, nz = dz / L, -dx / L
        hw = NW.CLASSES[r["cls"]]["w"] / 2
        x, z = P[k, 0] + nx * (hw + 3), P[k, 1] + nz * (hw + 3)
        out.append({"t": "dir", "text": dest[r["id"]], "x": round(float(x), 2), "z": round(float(z), 2),
                    "y": round(float(H_at([x], [z])[0]), 2), "yaw": round(math.atan2(dx, dz) + math.pi, 4)})
    return out


def make_kmposts(roads, H_at):
    out = []
    for r in roads:
        if not r["routed"] or r["cls"] in ("dirt", "lane"):
            continue
        P = r["P"]; hw = NW.CLASSES[r["cls"]]["w"] / 2
        s = 0.0; nxt = 1000.0
        for k in range(1, len(P) - 1):
            s += math.hypot(*(P[k] - P[k - 1]))
            if s >= nxt:
                dx, dz = P[k + 1] - P[k]; L = math.hypot(dx, dz) or 1
                nx, nz = dz / L, -dx / L
                x, z = P[k, 0] + nx * (hw + 1.6), P[k, 1] + nz * (hw + 1.6)
                out.append({"road": r["id"], "km": int(nxt / 1000), "x": round(float(x), 2), "z": round(float(z), 2),
                            "y": round(float(H_at([x], [z])[0]), 2), "yaw": round(math.atan2(dx, dz), 4)})
                nxt += 1000.0
    return out


# -------------------------------------------------------------------- rivers (water ribbons)
def rivers(H_at, H):
    out = []
    for rid, nm, pts, w in [("varzob", "Варзоб", T.VARZOB, 16.0), ("gissar_r", "Ширкент", T.GISSAR_R, 9.0),
                            ("east_r", "Ромит", T.EAST_R, 8.0), ("trib", "Ручей", T.TRIB, 6.0)]:
        P = T.resample(pts, 8.0)
        h = H_at(P[:, 0], P[:, 1], H)
        # water surface: a little above the bed, never rising downstream
        s = h + 0.9
        for k in range(1, len(s)):
            s[k] = min(s[k], s[k - 1])
        out.append({"id": rid, "name": nm, "w": w * 1.6, "pts": [[round(float(x), 2), round(float(y), 2), round(float(z), 2)] for (x, z), y in zip(P, s)]})
    return out


# -------------------------------------------------------------------- world map
def write_map(W, H, splat, biome, road_mask, path, px=4096):
    s = H.shape[0]
    rock, snow, earth, sand = [splat[..., i] for i in range(4)]
    gx = np.gradient(H, T.STEP, axis=1); gz = np.gradient(H, T.STEP, axis=0)
    nrm = np.dstack([-gx, -gz, np.ones_like(H) * 2.5]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    sh = np.clip(nrm @ np.array([-0.45, -0.55, 0.7]), 0, 1)
    c = np.zeros(H.shape + (3,)); c[:] = [0.56, 0.66, 0.38]
    c = c * (1 - biome[..., 0:1] * 0.7) + np.array([0.27, 0.42, 0.22]) * biome[..., 0:1] * 0.7
    c = c * (1 - biome[..., 1:2] * 0.6) + np.array([0.70, 0.68, 0.40]) * biome[..., 1:2] * 0.6
    c = c * (1 - earth[..., None] * 0.6) + np.array([0.62, 0.54, 0.40]) * earth[..., None] * 0.6
    c = c * (1 - rock[..., None]) + np.array([0.55, 0.52, 0.48]) * rock[..., None]
    c = c * (1 - snow[..., None]) + np.array([0.96, 0.97, 0.99]) * snow[..., None]
    c = c * (1 - biome[..., 2:3] * 0.5) + np.array([0.84, 0.80, 0.74]) * biome[..., 2:3] * 0.5
    img = (np.clip(c * (0.45 + 0.7 * sh[..., None]), 0, 1) * 255).astype(np.uint8)
    im = Image.fromarray(img).resize((px, px), Image.BILINEAR)
    d = ImageDraw.Draw(im)
    k = px / T.SIZE

    def P(x, z):
        return ((x - T.X0) * k, (z - T.Z0) * k)

    for lk in W["lakes"]:
        cx, cz = lk["c"]; rx, rz = lk["r"]
        a, b = P(cx - rx, cz - rz); c2, d2 = P(cx + rx, cz + rz)
        d.ellipse([a, b, c2, d2], fill=(70, 130, 200))
    for rv in W["rivers"]:
        d.line([P(p[0], p[2]) for p in rv["pts"]], fill=(70, 130, 210), width=max(2, int(rv["w"] * k * 1.5)))
    for b in W["buildings"]:
        x, z = P(b[1], b[2])
        r = max(1.0, b[4] * k * 0.5)
        d.rectangle([x - r, z - r * 0.6, x + r, z + r * 0.6], fill=(150, 140, 130))
    order = {"dirt": 0, "lane": 1, "street": 2, "road": 3, "mountain": 3, "highway": 4, "avenue": 5}
    for rd in sorted(W["roads"], key=lambda r: order[r["cls"]]):
        col = {"dirt": (150, 120, 80), "lane": (235, 235, 230), "street": (245, 245, 240), "road": (250, 230, 150),
               "mountain": (250, 210, 120), "highway": (250, 190, 90), "avenue": (255, 255, 255)}[rd["cls"]]
        wpx = max(2, int(rd["w"] * k * 1.6))
        pts = [P(p[0], p[2]) for p in rd["pts"]]
        d.line(pts, fill=(60, 60, 60), width=wpx + 2)
        d.line(pts, fill=col, width=wpx)
    im.save(path)
