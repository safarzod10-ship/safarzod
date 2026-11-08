"""DUSHANBE-X world terrain: one height function for the whole 10 x 10 km mainland north of the
peninsula. X east, -Z north, metres; city level ~0, sea -1.6.

Composition:
  plains   - Dushanbe basin (gently rising north), Gissar valley, rolling hills in the east
  valleys  - Varzob gorge along the river (floor rising 60 -> 430 m), the lake basin
  mountains- ridged fbm, amplitude growing northwards and away from the valleys, snow above ~850 m
  rivers   - carved beds (Varzob, Gissar stream, a tributary with a waterfall)
  seam     - at z = -800 equal to the old coast height function (build_coast.fields), blended north
"""
import math, os, sys
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "terrain"))
sys.path.insert(0, os.path.join(HERE, ".."))
import build_coast as bc          # old peninsula / coast height function (seam)

X0, Z0 = -5120.0, -11040.0       # world rectangle origin (south boundary is z = -800)
SIZE = 10240.0
STEP = 8.0
N = int(SIZE / STEP) + 1         # 1281 samples per side
SEAM_Z = -800.0
SEA = -1.6


def grid():
    xs = X0 + np.arange(N) * STEP
    zs = Z0 + np.arange(N) * STEP
    return np.meshgrid(xs, zs)    # X[j, i], Z[j, i]  (rows = z from Z0)


# ------------------------------------------------------------------------------------- noise
_LAT = {}


def _lat(seed):
    if seed not in _LAT:
        _LAT[seed] = np.random.default_rng(seed + 1000).random((256, 256))
    return _LAT[seed]


def vnoise(x, z, freq, seed):
    g = _lat(seed)
    X = np.asarray(x, np.float64) * freq + 17.3
    Z = np.asarray(z, np.float64) * freq + 53.9
    xi = np.floor(X); zi = np.floor(Z)
    fx = X - xi; fz = Z - zi
    fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz)
    i0 = xi.astype(np.int64) % 256; j0 = zi.astype(np.int64) % 256
    i1 = (i0 + 1) % 256; j1 = (j0 + 1) % 256
    a = g[j0, i0]; b = g[j0, i1]; c = g[j1, i0]; d = g[j1, i1]
    return (a * (1 - fx) + b * fx) * (1 - fz) + (c * (1 - fx) + d * fx) * fz


def fbm(x, z, freq, seed, oct=5, gain=0.5):
    s = 0.0; a = 1.0; f = freq; t = 0.0
    for o in range(oct):
        s = s + a * vnoise(x, z, f, seed + o * 7)
        t += a; a *= gain; f *= 2.03
    return s / t


def ridged(x, z, freq, seed, oct=6):
    s = 0.0; a = 1.0; f = freq; t = 0.0; w = 1.0
    for o in range(oct):
        n = 1.0 - np.abs(vnoise(x, z, f, seed + o * 11) * 2.0 - 1.0)
        n = n * n * w
        w = np.clip(n * 1.6, 0, 1)
        s = s + a * n; t += a; a *= 0.5; f *= 2.1
    return s / t


def ss(a, b, x):
    t = np.clip((np.asarray(x, np.float64) - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------------------------- polylines
def dist_poly(X, Z, pts):
    """distance from (X, Z) to a polyline, and the arc parameter (m) of the nearest point"""
    P = np.asarray(pts, np.float64)
    best = np.full(X.shape, 1e9); arc = np.zeros(X.shape); acc = 0.0
    for k in range(len(P) - 1):
        ax, az = P[k]; bx, bz = P[k + 1]
        dx, dz = bx - ax, bz - az
        L2 = dx * dx + dz * dz
        L = math.sqrt(L2)
        t = np.clip(((X - ax) * dx + (Z - az) * dz) / L2, 0, 1)
        d = np.hypot(X - (ax + t * dx), Z - (az + t * dz))
        m = d < best
        best = np.where(m, d, best); arc = np.where(m, acc + t * L, arc)
        acc += L
    return best, arc


def resample(pts, step):
    P = np.asarray(pts, np.float64)
    seg = np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1]))
    s = np.concatenate([[0], np.cumsum(seg)])
    n = max(2, int(s[-1] / step) + 1)
    t = np.linspace(0, s[-1], n)
    return np.stack([np.interp(t, s, P[:, 0]), np.interp(t, s, P[:, 1])], 1)


def chaikin(pts, it=3):
    P = np.asarray(pts, np.float64)
    for _ in range(it):
        Q = [P[0]]
        for k in range(len(P) - 1):
            Q.append(0.75 * P[k] + 0.25 * P[k + 1]); Q.append(0.25 * P[k] + 0.75 * P[k + 1])
        Q.append(P[-1]); P = np.array(Q)
    return P


# ------------------------------------------------------------------------------------- features
# Varzob river: from the glaciers in the north down the gorge through the city to Komsomol lake
VARZOB = chaikin([(700, -10900), (560, -10200), (820, -9400), (420, -8600), (650, -7800), (380, -7000),
                  (620, -6200), (420, -5500), (700, -4700), (560, -3900), (820, -3000), (760, -2200),
                  (900, -1650)], 3)
VARZOB_BED = [(-10900, 470.0), (-10200, 420), (-9000, 330), (-7800, 250), (-7000, 200), (-6200, 150),
              (-5500, 105), (-4700, 62), (-3900, 34), (-3000, 18), (-2200, 8), (-1650, 2.0)]
# Gissar stream (from the mountains to the fields) and an eastern stream
GISSAR_R = chaikin([(-3500, -7350), (-3700, -6600), (-3550, -5800), (-3850, -4900), (-3700, -4000),
                    (-3950, -3100), (-3800, -2200), (-3950, -1400)], 3)
EAST_R = chaikin([(3600, -6600), (3400, -5800), (3700, -5000), (3350, -4100), (3550, -3200), (3300, -2300),
                  (3450, -1500)], 3)
# tributary of the Varzob from the east with a waterfall at the gorge wall
TRIB = chaikin([(2500, -7900), (2050, -7650), (1650, -7480), (1180, -7380), (700, -7300)], 2)
WATERFALL = (1460, -7430)       # top of the fall (the bed drops ~28 m here)
LAKE = (-3300.0, -8300.0, 560.0, 330.0)   # centre x, z, radius x, radius z  (surface set in heights())
KOMSOMOL = (900.0, -1500.0, 210.0, 130.0)

# region centres for plains
DUSH = (0.0, -2800.0)


def bed_height(arcz):
    zs = np.array([p[0] for p in VARZOB_BED])          # ascending z (north first)
    hs = np.array([p[1] for p in VARZOB_BED])
    return np.interp(arcz, zs, hs)


def heights(X, Z):
    """height field + helper masks for arrays X, Z"""
    # ---- plains / basins
    # Dushanbe basin: 0 at the seam rising ~45 m to the north edge, small undulation
    dush = 2.0 + 42.0 * ss(-800, -4900, Z) + (fbm(X, Z, 1 / 900, 3, 4) - 0.5) * 10
    # Gissar valley (west): wide flat fields, slight slope to the south
    giss = 12.0 + 55.0 * ss(-1500, -6200, Z) + (fbm(X, Z, 1 / 700, 5, 4) - 0.5) * 8
    # eastern rolling hills
    east = 20.0 + 70.0 * ss(-1200, -5600, Z) + np.maximum(fbm(X, Z, 1 / 520, 7, 5) - 0.42, 0) * 260
    wd = ss(-2600, -1700, X)          # 0 west .. 1 Dushanbe
    we = ss(1700, 2700, X)            # 0 Dushanbe .. 1 east
    plain = giss * (1 - wd) + dush * wd * (1 - we) + east * we

    # ---- Varzob gorge: valley floor follows the river, walls widen with height
    dv, arc = dist_poly(X, Z, VARZOB)
    # river z at the nearest point (approx: arc -> z via the polyline)
    Pv = np.asarray(VARZOB)
    segl = np.concatenate([[0], np.cumsum(np.hypot(np.diff(Pv[:, 0]), np.diff(Pv[:, 1])))])
    rz = np.interp(arc, segl, Pv[:, 1])
    floor_v = bed_height(rz) + 3.0
    half_floor = 120 + 140 * ss(-9000, -5000, rz)          # narrow up north, wide in the south
    gorge = floor_v + np.maximum(dv - half_floor, 0) ** 1.18 * 0.55

    # ---- mountains
    north = ss(-3600, -6800, Z)                            # mountains grow to the north
    rid = ridged(X, Z, 1 / 1900, 11, 6)
    m_amp = 200 + 900 * north + 260 * ss(-8500, -10800, Z)
    mount = 60 + (0.32 + 0.68 * rid) * m_amp + fbm(X, Z, 1 / 260, 13, 4) * 50 * north
    # side ranges between Dushanbe and Gissar / east (low ridges further south)
    side = (ss(1400, 0, np.abs(X + 2300)) * ss(-3800, -5600, Z) + ss(1200, 0, np.abs(X - 2300)) * ss(-3800, -5800, Z))
    mount = mount + side * 260 * ridged(X, Z, 1 / 900, 17, 4)
    # where are the mountains allowed: not in the plains (south), not on the gorge floor
    front = Z + (fbm(X, Z, 1 / 1400, 29, 3) - 0.5) * 1800      # irregular mountain front
    m_mask = np.clip(ss(-3900, -6400, front) + side * 0.9, 0, 1)
    # the lowlands stay low: Dushanbe (to z -4900), Gissar (to -5800), the east (to -5300)
    nb = (fbm(X, Z, 1 / 1100, 31, 3) - 0.5) * 2600                # wobbly region borders
    low = np.maximum.reduce([ss(2900, 1900, np.abs(X) + nb) * ss(-5600, -4700, Z + nb),
                             ss(-1500, -2300, X + nb) * ss(-6400, -5500, Z - nb),
                             ss(1500, 2300, X - nb) * ss(-5900, -5000, Z + nb)])
    m_mask = m_mask * (1 - low)
    side = side * (1 - low)
    # Gissar valley stays open to the north-west as a high valley up to the lake
    land = np.maximum(plain, plain * (1 - m_mask) + mount * m_mask)
    # the gorge cuts through the mountains: valley walls rise with the distance from the river
    land = np.minimum(land, gorge)

    # ---- lake basin (high valley NW): bowl around the lake, flat surface shore
    lx, lz, rx, rzz = LAKE
    ld = np.sqrt(((X - lx) / rx) ** 2 + ((Z - lz) / rzz) ** 2)
    lake_level = 520.0
    bowl = lake_level - 18 + np.maximum(ld - 0.6, 0) ** 1.6 * 260 + (fbm(X, Z, 1 / 300, 19, 3) - 0.5) * 30
    lw = ss(2.6, 1.4, ld)
    land = land * (1 - lw) + np.minimum(land, bowl) * lw

    # ---- rivers: carve beds
    def carve(h, pts, bed_fn, width, depth):
        d, a = dist_poly(X, Z, pts)
        P = np.asarray(pts)
        sl = np.concatenate([[0], np.cumsum(np.hypot(np.diff(P[:, 0]), np.diff(P[:, 1])))])
        bz = np.interp(a, sl, P[:, 1])
        bed = bed_fn(bz, a)
        prof = bed + np.where(d < width, -depth * (1 - (d / width) ** 2), (d - width) * 0.35)
        return np.minimum(h, np.where(d < width * 6, prof, 1e9)), d
    land, d_var = carve(land, VARZOB, lambda bz, a: bed_height(bz), 16.0, 2.6)

    def gis_bed(bz, a):
        return np.interp(bz, [-7350, -6600, -5800, -4900, -3000, -1400], [540, 300, 120, 60, 25, 12])
    land, d_gis = carve(land, GISSAR_R, gis_bed, 9.0, 1.6)

    def east_bed(bz, a):
        return np.interp(bz, [-6600, -5000, -3200, -1500], [420, 180, 70, 22])
    land, d_east = carve(land, EAST_R, east_bed, 8.0, 1.4)

    def trib_bed(bz, a):
        # tributary: 290 m upstream, waterfall at arc ~1080 m drops 28 m, joins the Varzob at ~206 m
        L = 1880.0
        return np.where(a < 1070, np.interp(a, [0, 1070], [330, 262]), np.interp(a, [1090, L], [234, 206]))
    land, d_trib = carve(land, TRIB, trib_bed, 6.0, 1.2)

    # ---- Komsomol lake in the city
    kx, kz, krx, krz = KOMSOMOL
    kd = np.sqrt(((X - kx) / krx) ** 2 + ((Z - kz) / krz) ** 2)
    land = np.where(kd < 1.25, np.minimum(land, 0.4 - 2.6 * ss(1.0, 0.55, kd) + 3.0 * ss(0.95, 1.25, kd)), land)

    # ---- seam with the old coast / peninsula (exactly equal at z = -800)
    w = ss(-800, -1150, Z)
    if np.any(w < 1):
        m = w < 1
        old = np.zeros_like(land)
        old[m] = bc.fields(X[m], Z[m])["h"]
        # far east / west of the old terrain (|x| > 2300) the mainland meets the sea
        coast_side = ss(2250, 2700, np.abs(X))
        old = old * (1 - coast_side) + (SEA - 3.0) * coast_side
        land = old * (1 - w) + land * w
        # those far strips rise from the sea to the land over 150 m
        land = np.where(m & (np.abs(X) > 2300), np.minimum(land, SEA - 3.0 + (-800 - Z) * 0.25 + 0 * X), land)

    # ---- world edge: a final rim of peaks (impassable)
    ex = np.minimum(np.minimum(X - X0, X0 + SIZE - X), Z - Z0)
    land = land + ss(400, 0, ex) * 500 * (0.6 + 0.4 * ridged(X, Z, 1 / 600, 23, 3))
    return {"h": land.astype(np.float64), "d_var": d_var, "d_gis": d_gis, "d_east": d_east, "d_trib": d_trib,
            "lake_d": ld, "kom_d": kd, "gorge_d": dv, "river_z": rz}
