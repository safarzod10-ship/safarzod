"""Road network definition of DUSHANBE-X (see docs/WORLD_PLAN.md).
Each road: id, name, class, list of waypoints. Class -> (width m, max grade, surface).
'grid' roads are straight city streets (no routing); others are routed over the terrain.
"""

CLASSES = {
    "avenue":   {"w": 27.0, "g": 0.06, "surf": "asphalt", "lanes": 6},
    "highway":  {"w": 14.0, "g": 0.07, "surf": "asphalt", "lanes": 4},
    "street":   {"w": 10.0, "g": 0.08, "surf": "asphalt", "lanes": 2},
    "road":     {"w": 8.0,  "g": 0.08, "surf": "asphalt", "lanes": 2},
    "mountain": {"w": 7.5,  "g": 0.11, "surf": "asphalt", "lanes": 2},
    "lane":     {"w": 6.0,  "g": 0.10, "surf": "asphalt", "lanes": 1},
    "dirt":     {"w": 5.0,  "g": 0.12, "surf": "dirt", "lanes": 1},
}

# ---------------------------------------------------------------- Dushanbe (mainland) street grid
CITY_X = (-1950.0, 1950.0)
CITY_Z = (-1000.0, -4750.0)
GRID = []
# N-S: Rudaki avenue continues the peninsula avenue (its country-road end at (-70.7, -814))
GRID.append(("rudaki", "проспект Рудаки", "avenue", [(-70.0, -800.0), (-56.0, -900.0), (-40.0, -1000.0), (-40.0, -4700.0)]))
GRID.append(("ave_w", "проспект Исмоили Сомони", "avenue", [(-1300.0, -1000.0), (-1300.0, -4750.0)]))
GRID.append(("ave_e", "проспект Айни", "highway", [(1300.0, -1000.0), (1300.0, -4750.0)]))
for z, nm in [(-1600.0, "проспект Борбад"), (-2400.0, "проспект Дусти"), (-3200.0, "проспект Шотемур"), (-4000.0, "улица Варзобская")]:
    GRID.append(("ew%d" % int(-z), nm, "highway", [(-1950.0, z), (1950.0, z)]))
# ring road (bypass): a rounded rectangle (corner radius RING_R), not a square
RING_R = 820.0


def ring_points(step=8.0):
    import math
    x0, x1 = CITY_X
    zs, zn = CITY_Z[1], CITY_Z[0]          # south (more negative) / north edge
    R = RING_R
    pts = []
    # corners (centre x, centre z, start angle, end angle); point = centre + R (cos a, sin a)
    corners = [(x0 + R, zn - R, math.pi, math.pi * 0.5),          # (-x, z = -1000 edge)
               (x1 - R, zn - R, math.pi * 0.5, 0.0),
               (x1 - R, zs + R, 0.0, -math.pi * 0.5),
               (x0 + R, zs + R, -math.pi * 0.5, -math.pi)]
    for (cx, cz, a0, a1) in corners:
        n = max(4, int(R * abs(a1 - a0) / step))
        for k in range(n + 1):
            a = a0 + (a1 - a0) * k / n
            pts.append((cx + R * math.cos(a), cz + R * math.sin(a)))
    pts.append(pts[0])
    return pts


def in_ring(x, z):
    """inside the rounded ring rectangle (unwarped coordinates)"""
    import math
    x0, x1 = CITY_X
    zs, zn = CITY_Z[1], CITY_Z[0]
    R = RING_R
    if not (x0 <= x <= x1 and zs <= z <= zn):
        return False
    cx = min(max(x, x0 + R), x1 - R)
    cz = min(max(z, zs + R), zn - R)
    return math.hypot(x - cx, z - cz) <= R


def city_warp(x, z):
    """smooth organic deformation of the whole city plan (streets, blocks, landmarks): no straight
    ruler-drawn grid, gentle bends like real streets; fades out 600 m outside the city and towards
    the peninsula seam (z -800), where the old roads join unchanged"""
    import numpy as np
    x = np.asarray(x, float); z = np.asarray(z, float)
    ox = np.maximum(np.maximum(CITY_X[0] - x, x - CITY_X[1]), 0.0)
    oz = np.maximum(np.maximum(CITY_Z[1] - z, z - CITY_Z[0]), 0.0)
    out = np.hypot(ox, oz)
    w = np.clip(1.0 - out / 600.0, 0.0, 1.0)
    w = w * w * (3 - 2 * w)
    seam = np.clip((-850.0 - z) / 450.0, 0.0, 1.0)
    w = w * seam * seam * (3 - 2 * seam)
    dx = 95.0 * np.sin(z / 650.0 + 0.8) + 26.0 * np.sin(z / 280.0 + x / 800.0)
    dz = 80.0 * np.sin(x / 700.0 + 1.7) + 22.0 * np.sin(x / 300.0 - z / 1000.0)
    return x + dx * w, z + dz * w


def warp_pt(x, z):
    a, b = city_warp(x, z)
    return float(a), float(b)


def warp_yaw(x, z, yaw):
    """yaw (building local +X = (cos yaw, -sin yaw)) after the warp"""
    import math
    e = 2.0
    ux, uz = math.cos(yaw), -math.sin(yaw)
    a = warp_pt(x, z); b = warp_pt(x + ux * e, z + uz * e)
    return math.atan2(-(b[1] - a[1]), b[0] - a[0])


GRID.append(("ring", "Объездная дорога", "highway", ring_points()))
# a curved boulevard across the western districts (breaks the grid like a real city's diagonal)
GRID.append(("sino", "проспект Сино", "highway", "CURVE:" ))
# streets
for x in (-1700.0, -900.0, -500.0, 400.0, 1650.0):
    GRID.append(("sx%d" % int(x), "", "street", [(x, -1000.0), (x, -4750.0)]))
for z in (-1200.0, -2000.0, -2800.0, -3600.0, -4400.0):
    GRID.append(("sz%d" % int(-z), "", "street", [(-1950.0, z), (1950.0, z)]))
# the peninsula's other country roads continue into the city
GRID.append(("d_link", "", "street", [(-5.6, -786.1), (-10.0, -850.0), (-30.0, -1000.0)]))
GRID.append(("e_link", "", "street", [(-221.4, -814.7), (-221.0, -900.0), (-221.0, -1000.0)]))

# ---------------------------------------------------------------- routed roads (waypoints)
ROUTED = [
    ("m34", "М34 Душанбе — Варзоб", "highway",
     [(-40.0, -4700.0), (250.0, -5400.0), (300.0, -6300.0), (480.0, -7000.0), (300.0, -7800.0), (560.0, -8700.0), (900.0, -9500.0), (760.0, -10150.0)]),
    ("gissar", "Душанбе — Гиссар", "highway",
     [(-1950.0, -2400.0), (-3000.0, -2380.0), (-4200.0, -2450.0)]),
    ("gissar_n", "Гиссар — горы", "road",
     [(-4200.0, -2450.0), (-4350.0, -3500.0), (-4300.0, -4600.0), (-4150.0, -5500.0)]),
    ("east", "Душанбе — Ромит", "road",
     [(1950.0, -2000.0), (3000.0, -2150.0), (4200.0, -2300.0), (4250.0, -3500.0), (4150.0, -4800.0)]),
    ("pass", "Перевальная дорога", "mountain",
     [(480.0, -7000.0), (-300.0, -7350.0), (-1500.0, -7750.0), (-2500.0, -7900.0), (-3300.0, -7880.0)]),
    ("lake_s", "Озёрная дорога", "mountain",
     [(-3300.0, -7880.0), (-3850.0, -8150.0), (-3900.0, -8700.0)]),
    ("lake_e", "Озёрная дорога (восточный берег)", "mountain",
     [(-3900.0, -8700.0), (-3300.0, -8720.0), (-2600.0, -8450.0), (-2850.0, -7880.0)]),
    # ("lake_down", Спуск в Гиссар) removed in 0.18: the lake valley ends in a ~400 m escarpment;
    # the road could only be a 2.2 km viaduct up to 170 m above the ground
    ("east_mtn", "Восточная горная дорога", "mountain",
     [(480.0, -5650.0), (1500.0, -5500.0), (2400.0, -5350.0), (3300.0, -5150.0), (4150.0, -4800.0)]),
]
# dirt tracks / village lanes
DIRT = [
    ("fall", "К водопаду", "dirt", [(480.0, -7300.0), (900.0, -7330.0), (1380.0, -7470.0)]),
    ("view", "Смотровая площадка", "dirt", [(-1300.0, -4600.0), (-1550.0, -5150.0)]),
    ("orch", "Сады Гиссара", "dirt", [(-3000.0, -2380.0), (-3200.0, -3300.0), (-3000.0, -4200.0), (-4300.0, -4600.0)]),
    ("farm_e", "Фермы", "dirt", [(3000.0, -2150.0), (2800.0, -3200.0), (3300.0, -3700.0), (4250.0, -3500.0)]),
    ("forest", "Лесная дорога", "dirt", [(300.0, -8000.0), (1100.0, -8400.0), (1700.0, -9000.0)]),
    ("giss_vil", "", "lane", [(-4200.0, -2450.0), (-4800.0, -1800.0), (-4600.0, -1200.0)]),
    ("giss_vil2", "", "lane", [(-3000.0, -2380.0), (-2800.0, -1600.0)]),
]

# settlements / points of interest: (id, name, kind, x, z, radius)
PLACES = [
    ("dushanbe", "Душанбе", "city", 0.0, -2600.0, 2200.0),
    ("varzob", "Варзоб", "village", 450.0, -7050.0, 380.0),
    ("takob", "Такоб", "village", 560.0, -8750.0, 300.0),
    ("safeddara", "Сафеддара", "resort", 760.0, -10050.0, 260.0),
    ("gissar", "Гиссар", "town", -4200.0, -2450.0, 650.0),
    ("shahrinav", "Шахринав", "village", -4700.0, -1450.0, 350.0),
    ("sharora", "Шарора", "village", -2800.0, -1550.0, 300.0),
    ("hisor_n", "Ханака", "village", -4350.0, -4300.0, 320.0),
    ("romit", "Ромит", "village", 4200.0, -2300.0, 420.0),
    ("chorbog", "Чорбог", "village", 3200.0, -3600.0, 280.0),
    ("vahdat_n", "Симиганч", "village", 4150.0, -4800.0, 330.0),
    ("lake", "Озеро Искандар", "lake", -3300.0, -8300.0, 600.0),
    ("pass_top", "Перевал Анзоб", "pass", -1500.0, -7750.0, 150.0),
    ("waterfall", "Водопад", "poi", 1460.0, -7430.0, 80.0),
    ("viewpoint", "Смотровая площадка", "poi", -1550.0, -5150.0, 80.0),
    ("tourbase1", "Турбаза «Варзоб»", "resort", 320.0, -6350.0, 150.0),
    ("tourbase2", "Зона отдыха «Чормағзак»", "resort", 330.0, -5450.0, 150.0),
]


def _sino():
    import terrain as T
    return T.chaikin([(-1950.0, -4250.0), (-1650.0, -3750.0), (-1350.0, -3250.0), (-1050.0, -2850.0), (-760.0, -2620.0), (-500.0, -2540.0)], 4)


GRID = [(a, b, c, (_sino() if d == "CURVE:" else d)) for (a, b, c, d) in GRID]
