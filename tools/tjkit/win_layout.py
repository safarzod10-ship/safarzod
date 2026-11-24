"""Panjara (girih lattice) window: frame 1.0 x 1.4 x 0.14 m, real lattice strips.
Pattern segments are computed here in pure python (shared by texture + build)."""
import math
S = 1024
W, H, D = 1.0, 1.4, 0.14
FR = 0.085                      # frame width
IN_X0, IN_X1 = -W / 2 + FR, W / 2 - FR
IN_Z0, IN_Z1 = FR + 0.03, H - FR
STRIP_W = 0.024
STRIP_D = 0.04
L = (IN_X1 - IN_X0) / 3          # 3 stars across
PX = 1 / 700.0
ISL = {
    'front': (0, 0, int(W / PX), int(H / PX), PX),       # planar front projection of whole window
    'back': (0, 0, int(W / PX), int(H / PX), PX),
    'plain': (720, 0, 304, 1024, 1 / 300.0),
}

def _rot(v, a):
    c, s = math.cos(a), math.sin(a); return (c * v[0] - s * v[1], s * v[0] + c * v[1])

def _isect(p, d, q, e):
    det = d[0] * (-e[1]) - d[1] * (-e[0])
    if abs(det) < 1e-12: return None
    rx, ry = q[0] - p[0], q[1] - p[1]
    t = (rx * (-e[1]) - ry * (-e[0])) / det
    return (p[0] + t * d[0], p[1] + t * d[1])

def hankin_lines():
    """8-point girih (4.8.8, contact angle 67.5) clipped to the inner opening, collinear
    pieces merged. Returns list of ((x0,z0),(x1,z1))."""
    th = math.radians(67.5)
    cx, cz = 0.0, (IN_Z0 + IN_Z1) / 2
    R8 = (L / 2) / math.cos(math.pi / 8); s4 = 2 * (L / 2) * math.tan(math.pi / 8)
    polys = []
    for i in range(-4, 5):
        for j in range(-6, 7):
            c = (cx + i * L, cz + j * L)
            polys.append([(c[0] + R8 * math.cos(math.pi / 8 + k * math.pi / 4), c[1] + R8 * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)])
            cs = (c[0] + L / 2, c[1] + L / 2); r4 = s4 / math.sqrt(2)
            polys.append([(cs[0] + r4 * math.cos(k * math.pi / 2), cs[1] + r4 * math.sin(k * math.pi / 2)) for k in range(4)])
    segs = []
    for P in polys:
        n = len(P)
        mids = [((P[i][0] + P[(i + 1) % n][0]) / 2, (P[i][1] + P[(i + 1) % n][1]) / 2) for i in range(n)]
        dirs = []
        for i in range(n):
            dx, dy = P[(i + 1) % n][0] - P[i][0], P[(i + 1) % n][1] - P[i][1]; l = math.hypot(dx, dy)
            dirs.append((dx / l, dy / l))
        for i in range(n):
            j = (i + 1) % n
            d1 = _rot(dirs[i], th); d2 = _rot((-dirs[j][0], -dirs[j][1]), -th)
            X = _isect(mids[i], d1, mids[j], d2)
            if X: segs += [(mids[i], X), (mids[j], X)]
    # group collinear, merge intervals
    groups = {}
    for a, b in segs:
        ang = math.atan2(b[1] - a[1], b[0] - a[0]) % math.pi
        ka = round(ang / (math.pi / 8)) % 8
        ang = ka * math.pi / 8
        d = (math.cos(ang), math.sin(ang)); nrm = (-d[1], d[0])
        off = round((a[0] * nrm[0] + a[1] * nrm[1]) * 1e4)
        t0, t1 = sorted((a[0] * d[0] + a[1] * d[1], b[0] * d[0] + b[1] * d[1]))
        groups.setdefault((ka, off), []).append((t0, t1))
    lines = []
    for (ka, off), iv in groups.items():
        ang = ka * math.pi / 8; d = (math.cos(ang), math.sin(ang)); nrm = (-d[1], d[0]); o = off / 1e4
        iv.sort(); cur = list(iv[0])
        merged = []
        for t0, t1 in iv[1:]:
            if t0 <= cur[1] + 1e-5: cur[1] = max(cur[1], t1)
            else: merged.append(cur); cur = [t0, t1]
        merged.append(cur)
        for t0, t1 in merged:
            p0 = (nrm[0] * o + d[0] * t0, nrm[1] * o + d[1] * t0); p1 = (nrm[0] * o + d[0] * t1, nrm[1] * o + d[1] * t1)
            c = clip(p0, p1)
            if c and math.dist(*c) > 0.01: lines.append(c)
    # border strips around the opening
    return lines

def clip(p0, p1):
    x0, x1, z0, z1 = IN_X0, IN_X1, IN_Z0, IN_Z1
    dx, dz = p1[0] - p0[0], p1[1] - p0[1]; t0, t1 = 0.0, 1.0
    for p, q in ((-dx, p0[0] - x0), (dx, x1 - p0[0]), (-dz, p0[1] - z0), (dz, z1 - p0[1])):
        if abs(p) < 1e-12:
            if q < 0: return None
        else:
            r = q / p
            if p < 0: t0 = max(t0, r)
            else: t1 = min(t1, r)
    if t0 > t1: return None
    return ((p0[0] + t0 * dx, p0[1] + t0 * dz), (p0[0] + t1 * dx, p0[1] + t1 * dz))
