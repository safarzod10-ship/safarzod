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

AMID_SPACING = 2000.0          # 0.24: one AMID per 2 km; the other slots become car wash + auto service lots
WASHES = []
AMID_AT = []
WASH_SERVICES = []

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
    ("laklak", "LakLak — служба доставки", 1385.0, -3000.0, 0.0, (64.0, 74.0)),
    # the hero's home (HeroHome: house, garage with the Prado, start of the game) on the west side of
    # Rudaki avenue, the car dealership and the gun shop opposite (their own buildings, game side)
    ("tas", "TAS Group", 120.0, -2470.0, 0.0, (66.0, 50.0)),
    ("hero_home", "Дом героя", -102.0, -2190.0, math.pi, (54.0, 124.0)),
    ("dealer", "Автосалон", 10.0, -2130.0, math.pi, (38.0, 48.0)),
    ("gunshop", "Оружейный магазин", 2.0, -2240.0, math.pi, (22.0, 26.0)),
    ("hisor_fort", "Гиссарская крепость", -4500.0, -2900.0, 0.3, (150.0, 110.0)),
    ("hisor_bazaar", "Гиссарский рынок", -4050.0, -2300.0, 0.0, (100.0, 70.0)),
]
# low-poly villas (assets/models/extra/houses_lowpoly.glb, sub-models 1..4): footprint L x D (m)
VILLA = {1: (27.0, 12.0), 2: (27.0, 22.1), 3: (27.6, 22.1), 4: (36.8, 22.1)}
FUEL = [("fuel_n", "rudaki", -40.0, -4350.0), ("fuel_g", "gissar", -3300.0, -2385.0),
        ("fuel_v", "m34", 0, 0), ("fuel_e", "east", 3000.0, -2150.0)]


def build(roads, H, H_at, F, avoid=()):
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

    # the city plan is warped (network.city_warp): landmarks move / turn with their blocks
    LMW = []
    for (lid, nm, x, z, yaw, LD) in LANDMARKS:
        wx, wz = NW.warp_pt(x, z)
        LMW.append((lid, nm, wx, wz, NW.warp_yaw(x, z, yaw), LD))
    lm_rects = [(x - L / 2 - 5, z - D / 2 - 5, x + L / 2 + 5, z + D / 2 + 5) for (_, _, x, z, _, (L, D)) in LMW]

    def free(x, z, L, D, yaw, clear=4.0):
        """footprint clear of roads, water, landmarks"""
        r = math.hypot(L, D) / 2
        for (a, b, c2, d) in lm_rects:
            if a - r < x < c2 + r and b - r < z < d + r:
                return False
        for (cc, rr) in avoid:
            if abs(x - cc[0]) < rr + r and abs(z - cc[1]) < rr + r and math.hypot(x - cc[0], z - cc[1]) < rr + r * 0.8:
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

    def free_fuel(x, z, L, D, yaw):
        return free(x, z, L, D, yaw, 1.5)

    def add(kind, x, z, yaw, L, D, floors):
        y = float(H_at([x], [z])[0])
        buildings.append([kind, round(x, 2), round(z, 2), round(yaw, 4), round(L, 1), round(D, 1), int(floors), int(RNG.integers(0, 1 << 20)), round(y, 2)])

    # ---------------------------------------------------------------- Dushanbe blocks
    def addw(kind, x, z, yaw, L, D, floors):
        wx, wz = NW.warp_pt(x, z)
        add(kind, wx, wz, NW.warp_yaw(x, z, yaw), L, D, floors)

    def freew(x, z, L, D, yaw, clear=4.0):
        wx, wz = NW.warp_pt(x, z)
        return free(wx, wz, L, D, NW.warp_yaw(x, z, yaw), clear)

    xs = sorted({-1950, -1700, -1300, -900, -500, -40, 400, 1300, 1650, 1950})
    zs = sorted({-1000, -1200, -1600, -2000, -2400, -2800, -3200, -3600, -4000, -4400, -4750})
    for a, b in zip(xs[:-1], xs[1:]):
        for d, c in zip(zs[:-1], zs[1:]):          # c = north edge (larger z), d = south ... (c > d)
            c, d = max(c, d), min(c, d)
            cx = (a + b) / 2; cz = (c + d) / 2
            center = abs(cx) < 1300 and cz > -3400
            outer = abs(cx) > 1450 or cz < -4050
            if outer:
                houses_block(addw, freew, a, b, c, d)
            elif center:
                perimeter_block(addw, freew, a, b, c, d, tall=abs(cx) < 700)
            else:
                micro_block(addw, freew, a, b, c, d)
    # model buildings (assets/models/extra): schools (65 x 55 m) and hospitals (31 x 18.5 m) on free
    # city ground, turned along the nearest street, never overlapping other buildings
    def place_models(kind, L, D, count):
        bt = cKDTree(np.array([[b[1], b[2]] for b in buildings]))
        br = [math.hypot(b[4], b[5]) / 2 for b in buildings]
        placed = 0
        for attempt in range(4000):
            if placed >= count:
                break
            x = float(RNG.uniform(-1800, 1800)); z = float(RNG.uniform(-4500, -1150))
            d, i = rtree.query((x, z))
            q = road_pts[min(i + 1, len(road_pts) - 1)] - road_pts[max(i - 1, 0)]
            yaw = math.atan2(-q[1], q[0]) if np.hypot(*q) > 1e-6 else 0.0
            if d > road_hw[i] + D / 2 + 30 or not free(x, z, L + 8, D + 8, yaw, 4.0):
                continue
            R = math.hypot(L, D) / 2
            hit = [j for j in bt.query_ball_point((x, z), R + 60) if math.hypot(x - bt.data[j][0], z - bt.data[j][1]) < R + br[j] + 3]
            # the dense city leaves no empty lots: ordinary blocks give way to a school / hospital
            if any(str(buildings[j][0]) not in CLEARABLE or j in KILL for j in hit):
                continue
            KILL.update(hit)
            add(kind, x, z, yaw, L, D, 3)
            bt = cKDTree(np.array([[b[1], b[2]] for b in buildings]))
            br.append(R)
            placed += 1
        return placed
    # big models (AMID with its car park, malls, towers) own their footprint: the ordinary buildings of
    # the inner block rows that overlap them go (the AMID can be entered, nothing may stand inside)
    BIG = {"wash_lot": (60.0, 44.0), "amid_m": (118.0, 117.0), "mall_m": (100.0, 56.0), "luxa_m": (28.0, 28.0), "luxb_m": (32.0, 32.0)}
    big = [(i, b) for i, b in enumerate(buildings) if b[0] in BIG]
    drop = set()
    for i, b in big:
        L2, D2 = BIG[b[0]][0] / 2, BIG[b[0]][1] / 2
        c, s_ = math.cos(b[3]), math.sin(b[3])
        for j, o in enumerate(buildings):
            if j == i or j in drop or o[0] in BIG or o[0].endswith("_m"):
                continue
            dx, dz = o[1] - b[1], o[2] - b[2]
            lx = dx * c - dz * s_
            lz = dx * s_ + dz * c
            r = max(o[4], o[5]) / 2
            if abs(lx) < L2 + r and abs(lz) < D2 + r:
                drop.add(j)
    if drop:
        print("buildings removed under big models: %d" % len(drop))
        buildings[:] = [b for k, b in enumerate(buildings) if k not in drop]
    # the car wash + auto service lots leave the building list (the game builds them)
    for b in [b for b in buildings if b[0] == "wash_lot"]:
        yaw = b[3]
        fx, fz = -math.sin(yaw), -math.cos(yaw)                 # towards the street
        rx, rz = math.cos(yaw), -math.sin(yaw)
        sy = yaw + math.pi / 2                                    # service / wash +X -> the street
        for lx, lst in ((-15.0, WASH_SERVICES), (15.0, WASHES)):
            ox, oz = b[1] + rx * lx + fx * 4.0, b[2] + rz * lx + fz * 4.0
            lst.append({"x": round(ox + fx * 14.0, 2), "z": round(oz + fz * 14.0, 2), "ox": round(ox, 2), "oz": round(oz, 2),
                        "y": round(float(H_at([ox], [oz])[0]), 2), "yaw": round(sy, 4), "road": "lot"})
    buildings[:] = [b for b in buildings if b[0] != "wash_lot"]
    print("car wash + auto service lots (AMIDs 2 km apart): %d" % len(WASHES))
    ns = place_models("school_m", 65.0, 55.0, 6)
    nh = place_models("hospital_m", 31.0, 18.5, 4)
    print("model schools %d, hospitals %d" % (ns, nh))
    n_city = len(buildings)

    # ---------------------------------------------------------------- villages / towns / resorts
    for pid, nm, kind, px, pz, rad in NW.PLACES:
        if kind in ("village", "town"):
            village(add, free, roads, px, pz, rad, town=kind == "town")
        elif kind == "resort":
            resort(add, free, px, pz)
    # roadside houses along the M34 in the gorge and the country roads (dachas, cafes, tea houses)
    for r in roads:
        if r["id"] in ("m34", "east", "gissar", "gissar_n"):
            roadside(add, free, r, every=150.0 if r["id"] == "m34" else 200.0)
        elif r["cls"] in ("mountain", "road") and r["id"] not in ("lake_down",):
            roadside(add, free, r, every=420.0)

    # ---------------------------------------------------------------- landmarks, fuel, signs, km posts
    landmarks = []
    for (lid, nm, x, z, yaw, (L, D)) in LMW:
        # a landmark's plaza must never cover a road
        cs, sn = math.cos(yaw), math.sin(yaw)
        for u in np.linspace(-L / 2, L / 2, 9):
            for v in np.linspace(-D / 2, D / 2, 9):
                px = x + u * cs + v * sn; pz = z - u * sn + v * cs
                d, i = rtree.query((px, pz))
                if d < road_hw[i] + 1.0:
                    raise SystemExit("landmark %s overlaps a road at (%.0f, %.0f)" % (lid, px, pz))
        landmarks.append({"id": lid, "name": nm, "x": x, "z": z, "yaw": yaw, "L": L, "D": D, "y": round(float(H_at([x], [z])[0]), 2)})
    # 0.20: on every road (city streets and lanes too): a filling station every ~1.6 km, an auto service
    # every ~600 m between them
    fuel = fuel_stations(roads, buildings, landmarks, H_at, free_fuel, every=1600.0, sep=550.0, start=700.0)
    services = fuel_stations(roads, buildings, landmarks, H_at, free_fuel, every=600.0, sep=230.0, prefix="service",
                             start=300.0, avoid=fuel, avoid_r=120.0)
    if KILL:
        print("buildings cleared for stations / services: %d" % len(KILL))
        buildings[:] = [b for i, b in enumerate(buildings) if i not in KILL]
    signs = make_signs(roads, H_at)
    kms = make_kmposts(roads, H_at)
    places = [{"id": p[0], "name": p[1], "kind": p[2], "x": p[3], "z": p[4], "r": p[5]} for p in NW.PLACES]
    print("buildings: city %d, villages/roadside %d" % (n_city, len(buildings) - n_city))
    services = services + WASH_SERVICES
    return {"buildings": buildings, "landmarks": landmarks, "fuel": fuel, "services": services, "washes": WASHES, "signs": signs, "kmposts": kms, "places": places}


# -------------------------------------------------------------------- block layouts
def perimeter_block(add, free, a, b, c, d, tall):
    """city centre (c > d): buildings along all four block edges facing the streets (6-20 storeys,
    shops on the ground floors), a second ring of lower blocks and a school in the courtyard"""
    # three rings: the street front right behind the sidewalk, then two inner rows (no empty
    # 400 m courtyards)
    # four rings (0.20: no empty courtyards): the street front, then three inner rows
    for ring, inset in ((0, 17.0), (1, 58.0), (2, 102.0), (3, 146.0)):
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
                    # modern Dushanbe on the avenues: cream towers with blue glass and domes, round glass
                    # towers, cream residential blocks, shopping centres (assets/models/city)
                    kind = str(RNG.choice(["luxa_m", "luxb_m", "luxc_m", "luxc_m", "luxa_m", "office", "hotel", "sky", "mall_m", "amid_m"] if tall
                                          else ["luxc_m", "luxc_m", "luxa_m", "panel9", "brick5", "office"]))
                    if kind == "amid_m" and RNG.random() < 0.15:
                        kind = "mall_m"          # an AMID now and then, not on every block
                    if kind == "amid_m" and any(math.hypot(o[0] - (sx + ux * (s + 58)), o[1] - (sz + uz * (s + 58))) < AMID_SPACING
                                                for o in AMID_AT):
                        kind = "wash_lot"        # 0.24: AMIDs 2 km apart; here a car wash + auto service
                elif ring == 3:
                    kind = str(RNG.choice(["luxc_m", "panel9", "panel5", "brick5"]))
                elif ring == 2:
                    kind = str(RNG.choice(["panel5", "panel9", "brick5", "panel5"]))
                else:
                    kind = str(RNG.choice(["panel5", "brick5", "panel5", "school"]))
                L = 30.0 if kind == "tower" else float(RNG.choice([36, 42, 48, 54, 60]))
                if kind == "school":
                    L = 46.0
                if kind == "sky":
                    L = 24.0
                LUXD = {"luxa_m": (26.0, 26.0), "luxb_m": (30.0, 30.0), "luxc_m": (42.0, 16.0), "mall_m": (96.0, 52.0), "amid_m": (116.0, 115.0),
                        "wash_lot": (60.0, 44.0)}
                if kind in LUXD:
                    L = LUXD[kind][0]
                    if length - s - 10 < L:
                        kind = "luxc_m" if length - s - 10 >= 42 else "panel5"
                        L = LUXD.get(kind, (36.0, 12.0))[0]
                L = min(L, length - s - 10)
                if L < 24:
                    break
                D = {"tower": 18.0, "school": 15.0, "panel5": 12.0, "brick5": 12.0, "sky": 24.0}.get(kind, LUXD.get(kind, (0, 14.0))[1])
                x = sx + ux * (s + L / 2) + nx * D / 2
                z = sz + uz * (s + L / 2) + nz * D / 2
                floors = {"wash_lot": 1, "amid_m": 3, "luxa_m": 22, "luxb_m": 18, "luxc_m": 12, "mall_m": 4, "panel9": 9, "panel5": 5, "brick5": 5, "school": 3, "office": int(RNG.integers(5, 10)),
                          "admin": int(RNG.integers(4, 7)), "hotel": int(RNG.integers(7, 13)), "tower": int(RNG.integers(14, 23)), "sky": 30}[kind]
                if free(x, z, L, D, yaw, 3.0):
                    add(kind, x, z, yaw, L, D, floors)
                    if kind == "amid_m":
                        AMID_AT.append((x, z))
                s += L + float(RNG.choice([4, 6, 8]))


def micro_block(add, free, a, b, c, d):
    """Soviet micro-district: rows of 5 / 9-storey panel blocks, parallel, with yards"""
    x0, x1 = a + 17, b - 17
    zn, zs_ = c - 17, d + 17
    rot = RNG.random() < 0.5
    rows = np.arange(zs_ + 6, zn - 6, 36.0)
    for k, z in enumerate(rows):
        x = x0
        while x < x1 - 30:
            kind = RNG.choice(["panel5", "panel5", "panel9", "brick5", "luxc_m"])
            L = float(RNG.choice([48, 60, 72, 84]))
            L = min(L, x1 - x - 4)
            if L < 30:
                break
            cx = x + L / 2
            yaw = 0.0 if not rot else 0.0
            if free(cx, z, L, 12.0, yaw, 4.0):
                add(kind, cx, z, yaw, L if kind != "luxc_m" else 42.0, {"panel9": 13.0, "luxc_m": 16.0}.get(kind, 12.0), {"panel5": 5, "panel9": 9, "brick5": 5, "luxc_m": 12}[kind])
            x += L + float(RNG.choice([12, 16, 22]))
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
    for zrow in np.arange(d + 17, c - 14, 30.0):
        for x in np.arange(a + 15, b - 13, 23.0 + RNG.uniform(-2, 3)):
            if RNG.random() < 0.08:
                continue
            L = float(RNG.uniform(11, 17)); D = float(RNG.uniform(8, 11))
            yaw = 0.0 if (int((zrow - d) / 32) % 2 == 0) else math.pi
            if RNG.random() < 0.07:
                vk = int(RNG.integers(1, 4))
                VL, VD = VILLA[vk]
                if free(x, zrow, VL + 4, VD + 4, yaw, 3.0):
                    add("villa%d" % vk, x, zrow, yaw, VL, VD, 2)
                    continue
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
        for k in idx[::4]:
            if k + 2 >= len(P):
                continue
            p = P[k]; q = P[k + 2]
            dx, dz = q - p; L0 = math.hypot(dx, dz)
            if L0 < 1e-3:
                continue
            nx, nz = dz / L0, -dx / L0
            yaw = math.atan2(dx, dz)
            for side in (-1, 1):
                if RNG.random() < 0.08:
                    continue
                off = hw + 7.0 + RNG.uniform(0, 1.5)
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
                    off2 = off + 24.0
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
        elif k < 4:
            vk = int(RNG.integers(1, 5))
            VL, VD = VILLA[vk]
            if free(x, z, VL + 4, VD + 4, a, 3.0):
                add("villa%d" % vk, x, z, a, VL, VD, 2)
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
        off = hw + 7.5
        x = p[0] + nx * off * side; z = p[1] + nz * off * side
        yaw = math.atan2(dx, dz) + (math.pi / 2 if side > 0 else -math.pi / 2)
        kind = str(RNG.choice(["house", "house", "shop", "cottage", "villa"]))
        L, D = (20.0, 12.0) if kind == "shop" else (float(RNG.uniform(10, 15)), 9.0)
        if kind == "villa":
            vk = int(RNG.integers(1, 5))
            kind = "villa%d" % vk
            L, D = VILLA[vk]
            off = hw + 5.0 + D / 2
            x = p[0] + nx * off * side; z = p[1] + nz * off * side
            if free(x, z, L + 4, D + 6, yaw, 3.0):
                add(kind, x, z, yaw + math.pi, L, D, 2)
            continue
        if free(x, z, L + 8, D + 30, yaw, 3.0):
            add(kind, x, z, yaw + math.pi, L, D, 1 if kind != "house" else int(RNG.choice([1, 2])))


# -------------------------------------------------------------------- terrain under buildings
def flatten_plots(H, X, Z, world):
    """level the ground under each building (and landmark plaza) to its base height"""
    for b in world["buildings"]:
        kind, x, z, yaw, L, D = b[0], b[1], b[2], b[3], b[4], b[5]
        rad = math.hypot(L, D) / 2 + (11 if kind in ("amid_m", "mall_m") else 6)   # big car parks: flat to the corners
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


def rivers_under_roads(rivers, roads, clear=1.2, deck=2.6):
    """The water surface (bed + 0.9 m) is sampled from the terrain, which the road passes flatten to
    0.22 m under the road: where a road runs along the river or crosses it, the water came out ABOVE
    the carriageway / the bridge deck. Lower the surface under and beside every road to `clear` m
    below it (bridge decks: `deck` m), keep it never rising downstream."""
    pts = []
    for r in roads:
        hw = r["w"] * 0.5
        br = set()
        for a, b in r["bridges"]:
            br.update(range(a - 2, b + 3))
        tu = set()
        for a, b in r["tunnels"]:
            tu.update(range(a, b + 1))
        for k, p in enumerate(r["pts"]):
            if k in tu:
                continue
            pts.append((p[0], p[2], p[1] - (deck if k in br else clear), hw))
    R = np.array(pts)
    cell = 32.0
    grid = {}
    for i, (x, z, _, _) in enumerate(R):
        grid.setdefault((int(np.floor(x / cell)), int(np.floor(z / cell))), []).append(i)
    lowered = 0
    for rv in rivers:
        hw = rv["w"] * 0.5
        P = rv["pts"]
        for p in P:
            cx, cz = int(np.floor(p[0] / cell)), int(np.floor(p[2] / cell))
            lim = p[1]
            for dj in (-1, 0, 1):
                for di in (-1, 0, 1):
                    for i in grid.get((cx + di, cz + dj), ()):
                        x, z, ymax, rhw = R[i]
                        if (x - p[0]) ** 2 + (z - p[2]) ** 2 < (hw + rhw + 8.0) ** 2:
                            lim = min(lim, ymax)
            if lim < p[1] - 1e-3:
                p[1] = round(float(lim), 2)
                lowered += 1
        for k in range(1, len(P)):
            P[k][1] = min(P[k][1], P[k - 1][1])
    return lowered


def fill_under_roads(H, roads, rivers, under=0.35, slope=0.35):
    """roads must lie ON the ground: where the terrain is far below a road (dirt / forest tracks over
    small hollows, the carving left them in the air), raise each grid node near a road to `under` m
    below the NEAREST road sample (so slopes stay right) and slope it down (1:3) for 6 m beside it.
    Never raises a node above that; not on bridges / tunnels, not near rivers."""
    from scipy.spatial import cKDTree
    pts = []
    for r in roads:
        hw = r["w"] * 0.5
        skip = set()
        for a, b in r["bridges"] + r["tunnels"]:
            skip.update(range(a - 3, b + 4))
        P = r["pts"]
        for k in range(len(P)):
            # densify to ~2 m so the nearest sample is close to the node's projection
            x, y, z = P[k]
            if k in skip:
                pts.append((x, z, -1e9, hw))      # a bridge / tunnel sample: blocks filling there
                continue
            pts.append((x, z, y, hw))
            if k + 1 < len(P) and (k + 1) not in skip:
                x2, y2, z2 = P[k + 1]
                L = math.hypot(x2 - x, z2 - z)
                for m in range(1, int(L // 2.0) + 1):
                    t = m * 2.0 / L
                    if t < 1.0:
                        pts.append((x + (x2 - x) * t, z + (z2 - z) * t, y + (y2 - y) * t, hw))
    A = np.array(pts)
    tree = cKDTree(A[:, :2])
    rv = [(p[0], p[2]) for rv in rivers for p in rv["pts"]]
    rt = cKDTree(np.array(rv)) if rv else None
    n = H.shape[0]
    xs = T.X0 + np.arange(n) * T.STEP
    GX, GZ = np.meshgrid(xs, T.Z0 + np.arange(n) * T.STEP)
    G = np.stack([GX.ravel(), GZ.ravel()], 1)
    d, idx = tree.query(G, distance_upper_bound=20.0)
    ok = np.isfinite(d)
    hw = np.where(ok, A[np.minimum(idx, len(A) - 1), 3], 0.0)
    y = np.where(ok, A[np.minimum(idx, len(A) - 1), 2], -1e9)
    reach = hw + 6.0
    ok &= (d <= reach) & (y > -1e8)
    if rt is not None:
        dr, _ = rt.query(G, distance_upper_bound=40.0)
        ok &= ~(dr < 30.0)
    t = y - under - np.maximum(0.0, d - hw - 1.0) * slope
    Hf = H.ravel()
    up = ok & (Hf < t)
    Hf[up] = t[up]
    # safety: nothing may now poke through a road surface (junctions of roads at different levels)
    for r in roads:
        skip = set()
        for a_, b_ in r["tunnels"]:
            skip.update(range(a_, b_ + 1))
        for k, (x, y, z) in enumerate(r["pts"]):
            if k in skip:
                continue
            fx = (x - T.X0) / T.STEP; fz = (z - T.Z0) / T.STEP
            i = min(max(int(fx), 0), n - 2); j = min(max(int(fz), 0), n - 2)
            u = fx - i; v = fz - j
            hh = H[j, i] * (1 - u) * (1 - v) + H[j, i + 1] * u * (1 - v) + H[j + 1, i] * (1 - u) * v + H[j + 1, i + 1] * u * v
            ex = hh - (y - 0.22)
            if ex > 0:
                for jj, ii in ((0, 0), (0, 1), (1, 0), (1, 1)):
                    H[j + jj, i + ii] -= ex + 0.02
    return int(up.sum())


# -------------------------------------------------------------------- world map
def write_map(W, H, splat, biome, road_mask, path, px=4096):
    """the world map texture in an illustrated tourist-map style: saturated valley greens, forests as
    little tree crowns, strong relief shading with snowy peaks, bright rivers and lakes with a light
    shore, city blocks, roads as coloured bands with dark outlines (motorways orange, roads yellow)"""
    rock, snow, earth, sand = [splat[..., i] for i in range(4)]
    forest, fields, settle = biome[..., 0], biome[..., 1], biome[..., 2]
    # relief: multi-directional hillshade + slope darkening (mountains read as mountains)
    gx = np.gradient(H, T.STEP, axis=1); gz = np.gradient(H, T.STEP, axis=0)
    nrm = np.dstack([-gx, -gz, np.ones_like(H) * 3.0]); nrm /= np.linalg.norm(nrm, axis=2, keepdims=True)
    sh = 0.0
    for lx, lz, wgt in ((-0.5, -0.6, 0.6), (-0.8, 0.1, 0.25), (0.1, -0.9, 0.15)):
        L = np.array([lx, lz, 0.75]); L = L / np.linalg.norm(L)
        sh = sh + np.clip(nrm @ L, 0, 1) * wgt
    slope = 1.0 - nrm[..., 2]
    hn = np.clip((H - 0.0) / 2600.0, 0, 1)
    c = np.zeros(H.shape + (3,))
    low = np.array([0.33, 0.56, 0.2]); mid = np.array([0.3, 0.5, 0.2]); high = np.array([0.45, 0.5, 0.3])
    c[:] = low
    c = c * (1 - np.clip(hn * 2.2, 0, 1)[..., None]) + mid * np.clip(hn * 2.2, 0, 1)[..., None]
    c = c * (1 - np.clip((hn - 0.35) * 2.0, 0, 1)[..., None]) + high * np.clip((hn - 0.35) * 2.0, 0, 1)[..., None]
    c = c * (1 - fields[..., None] * 0.55) + np.array([0.72, 0.74, 0.36]) * fields[..., None] * 0.55
    c = c * (1 - forest[..., None] * 0.75) + np.array([0.16, 0.38, 0.15]) * forest[..., None] * 0.75
    c = c * (1 - earth[..., None] * 0.5) + np.array([0.66, 0.58, 0.42]) * earth[..., None] * 0.5
    c = c * (1 - rock[..., None] * 0.6) + np.array([0.52, 0.5, 0.42]) * rock[..., None] * 0.6
    c = c * (1 - snow[..., None]) + np.array([0.97, 0.98, 1.0]) * snow[..., None]
    c = c * (1 - settle[..., None] * 0.3) + np.array([0.6, 0.6, 0.45]) * settle[..., None] * 0.3
    shade = 0.5 + 0.75 * sh - 0.14 * np.clip(slope * 1.5, 0, 1)
    img = np.clip(c * shade[..., None] * 1.08, 0, 1)
    im = Image.fromarray((img * 255).astype(np.uint8)).resize((px, px), Image.BICUBIC)
    d = ImageDraw.Draw(im)
    k = px / T.SIZE

    def P(x, z):
        return ((x - T.X0) * k, (z - T.Z0) * k)

    # forests: little tree crowns (dark rim, lighter top-left highlight)
    rng = np.random.default_rng(7)
    n = H.shape[0]
    for _ in range(220000):
        i, j = rng.integers(0, n), rng.integers(0, n)
        f = forest[j, i]
        # forests dense; scattered trees everywhere else in the green (not on rock / snow / city)
        if snow[j, i] > 0.3 or rock[j, i] > 0.6 or settle[j, i] > 0.5:
            continue
        if rng.random() > (f if f >= 0.3 else 0.12):
            continue
        x = (i + rng.random()) * px / (n - 1); z = (j + rng.random()) * px / (n - 1)
        r = 2.6 + rng.random() * 2.6
        g = 0.75 + 0.5 * rng.random()
        d.ellipse([x - r, z - r, x + r, z + r], fill=(int(18 * g), int(62 * g), int(22 * g)))
        d.ellipse([x - r * 0.75, z - r * 0.85, x + r * 0.45, z + r * 0.35], fill=(int(46 * g), int(118 * g), int(40 * g)))
    # water
    for lk in W["lakes"]:
        cx, cz = lk["c"]; rx, rz = lk["r"]
        a, b = P(cx - rx, cz - rz); c2, d2 = P(cx + rx, cz + rz)
        d.ellipse([a - 4, b - 4, c2 + 4, d2 + 4], fill=(205, 232, 245))
        d.ellipse([a, b, c2, d2], fill=(40, 120, 205))
        d.ellipse([a + (c2 - a) * 0.2, b + (d2 - b) * 0.2, c2 - (c2 - a) * 0.3, d2 - (d2 - b) * 0.35], fill=(60, 145, 225))
    for rv in W["rivers"]:
        pts = [P(p[0], p[2]) for p in rv["pts"]]
        wpx = max(3, int(rv["w"] * k * 1.8))
        d.line(pts, fill=(205, 232, 245), width=wpx + 4, joint="curve")
        d.line(pts, fill=(40, 125, 215), width=wpx, joint="curve")
    # buildings: light blocks with a darker roof
    for b in W["buildings"]:
        x, z = P(b[1], b[2])
        r = max(1.2, b[4] * k * 0.5)
        d.rectangle([x - r, z - r * 0.65, x + r, z + r * 0.65], fill=(120, 112, 104))
        d.rectangle([x - r * 0.8, z - r * 0.5, x + r * 0.8, z + r * 0.4], fill=(214, 206, 192))
    order = {"dirt": 0, "lane": 1, "street": 2, "road": 3, "mountain": 3, "highway": 4, "avenue": 5}
    for rd in sorted(W["roads"], key=lambda r: order[r["cls"]]):
        col = {"dirt": (176, 140, 92), "lane": (240, 240, 232), "street": (250, 250, 244), "road": (252, 222, 110),
               "mountain": (250, 210, 100), "highway": (250, 170, 60), "avenue": (255, 236, 150)}[rd["cls"]]
        wpx = max(2, int(rd["w"] * k * 1.7))
        pts = [P(p[0], p[2]) for p in rd["pts"]]
        d.line(pts, fill=(55, 45, 35), width=wpx + 3, joint="curve")
        d.line(pts, fill=col, width=wpx, joint="curve")
    im = im.filter(ImageFilter.UnsharpMask(radius=2, percent=60, threshold=2))
    im.save(path)


KILL = set()                 ## building indices cleared for filling stations / auto services
CLEARABLE = {"house", "panel5", "panel9", "brick5", "luxc_m", "shop", "cottage", "office"}


def fuel_stations(roads, buildings, landmarks, H_at, free_fn, every=2800.0, sep=700.0, prefix="fuel", start=1200.0, avoid=(), avoid_r=150.0):
    """filling stations along every road (model assets/models/extra/gas_station.glb): one every ~3.2 km
    of road, alternating sides, beside the road (the model's +X - pumps, canopy, price sign - faces
    the road), on level free ground, never closer than 900 m to another station"""
    from scipy.spatial import cKDTree
    bld = cKDTree(np.array([[b[1], b[2]] for b in buildings])) if buildings else None
    bR = [math.hypot(b[4], b[5]) / 2 for b in buildings]
    out = []
    for r in roads:
        if r["cls"] == "dirt":
            continue
        P = r["P"]; Hh = r["H"]
        hw = NW.CLASSES[r["cls"]]["w"] / 2
        S = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
        bad = np.zeros(len(P), bool)
        for a, b in r["bridges"] + r["tunnels"]:
            bad[max(a - 10, 0):b + 11] = True
        n = int((S[-1] - start) // every) + 1
        for m in range(n):
            placed = False
            for shift in (0, 150, -150, 300, -300, 450, -450, 600, -600, 750, -750, 900, -900, 1050, -1050):
                target = start + m * every + shift
                if target < 60 or target > S[-1] - 60:
                    continue
                k = int(np.searchsorted(S, target))
                if bad[max(k - 8, 0):k + 8].any():
                    continue
                d = P[min(k + 2, len(P) - 1)] - P[max(k - 2, 0)]
                d = d / max(np.linalg.norm(d), 1e-6)
                for side in ((1, -1) if (m + len(out)) % 2 == 0 else (-1, 1)):
                    nx, nz = -d[1] * side, d[0] * side          # away from the road
                    off = hw + 21.0
                    ox, oz = P[k][0] + nx * off, P[k][1] + nz * off
                    yaw = math.atan2(nz, -nx)                  # model +X -> towards the road (-n)
                    cs, sn = math.cos(yaw), math.sin(yaw)
                    # plot centre (model local 2.5, 1.5): store at -12, price sign at +17.5 (2 m from the road edge)
                    px = ox + 2.5 * cs + 1.5 * sn; pz = oz - 2.5 * sn + 1.5 * cs
                    if any(math.hypot(px - f["x"], pz - f["z"]) < sep for f in out):
                        continue
                    if any(math.hypot(px - f["x"], pz - f["z"]) < avoid_r for f in avoid):
                        continue
                    hs = H_at(np.array([px - 16, px + 16, px, px, px]), np.array([pz, pz, pz - 11, pz + 11, pz]))
                    if hs.max() - hs.min() > 6.0 or abs(float(H_at([ox], [oz])[0]) - Hh[k]) > 3.5:
                        continue
                    if not free_fn(px, pz, 30.0, 22.0, yaw):
                        continue
                    if bld is not None:
                        hit = [j for j in bld.query_ball_point((px, pz), 80) if math.hypot(px - bld.data[j][0], pz - bld.data[j][1]) < 22 + bR[j]]
                        # in the city the plot is cleared (ordinary blocks / houses give way); never models
                        if any(not str(buildings[j][0]) in CLEARABLE for j in hit):
                            continue
                        if hit and r["cls"] not in ("avenue", "highway", "street", "lane", "road"):
                            continue
                        KILL.update(hit)
                    if any(abs(px - l["x"]) < l["L"] / 2 + 20 and abs(pz - l["z"]) < l["D"] / 2 + 20 for l in landmarks):
                        continue
                    y = float(Hh[k] - 0.1)
                    out.append({"id": "%s%d" % (prefix, len(out)), "x": round(px, 2), "z": round(pz, 2), "ox": round(ox, 2), "oz": round(oz, 2),
                                "y": round(y, 2), "yaw": round(yaw, 4), "road": r["id"]})
                    placed = True
                    break
                if placed:
                    break
    print("%s: %d" % ("filling stations" if prefix == "fuel" else prefix, len(out)))
    return out
