"""blender -b -P tap_build.py -> kit/tapchan.glb"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blib import *
from mathutils import Matrix
import tap_layout as T
reset()
A = Atlas(T.S, T.ISL)
TX = os.path.join(TEXOUT, 'tapchan')
mat = pbr_material('tapchan', TX + '_base.jpg', TX + '_orm.jpg', TX + '_nrm.jpg')
mb = MB(); sd = [0]
def pf(pts, isl='plain', along=None):
    sd[0] += 1; return plain_fit(A, isl, pts, sd[0], along)
def wbox(x0, y0, z0, x1, y1, z1, skip=(), isl='plain'):
    box_faces(mb, x0, y0, z0, x1, y1, z1, lambda k, p: pf(p, isl), skip=skip)

hx, hy, D = T.LX / 2, T.LY / 2, T.DECK
P_ = 0.09                     # post size
# posts (corner posts run up to rail top)
for sx in (-1, 1):
    for sy in (-1, 1):
        x = sx * (hx - P_ / 2); y = sy * (hy - P_ / 2)
        wbox(x - P_ / 2, y - P_ / 2, 0, x + P_ / 2, y + P_ / 2, T.RAIL_TOP, skip=('-z',))
# middle legs on the long sides
for sy in (-1, 1):
    y = sy * (hy - P_ / 2 - 0.006)
    wbox(-P_ / 2, y - P_ / 2, 0, P_ / 2, y + P_ / 2, D - 0.04, skip=('-z', '+z'))
# aprons
wbox(-hx + P_, -hy, D - 0.16, hx - P_, -hy + 0.04, D - 0.04, skip=('-x', '+x'))
wbox(-hx + P_, hy - 0.04, D - 0.16, hx - P_, hy, D - 0.04, skip=('-x', '+x'))
wbox(-hx, -hy + P_, D - 0.16, -hx + 0.04, hy - P_, D - 0.04, skip=('-y', '+y'))
wbox(hx - 0.04, -hy + P_, D - 0.16, hx, hy - P_, D - 0.04, skip=('-y', '+y'))
# deck (planks along X)
def deckuv(k, pts):
    if k == '+z':
        return [A.uv('deck', (p[0] + hx) * 0.75, p[1] + hy + 0.2) for p in pts]
    return pf(pts)
box_faces(mb, -hx + 0.004, -hy + 0.004, D - 0.04, hx - 0.004, hy - 0.004, D, deckuv)
# rails: back + two sides (front open)
RT = T.RAIL_TOP
wbox(-hx + P_, hy - 0.06, RT - 0.05, hx - P_, hy - 0.01, RT, skip=('-x', '+x'))
wbox(-hx + P_, hy - 0.05, D, hx - P_, hy - 0.02, D + 0.05, skip=('-x', '+x', '-z'))
for sx in (-1, 1):
    x0 = sx * hx - (0.06 if sx > 0 else -0.01) if False else (hx - 0.06 if sx > 0 else -hx + 0.01)
    wbox(x0, -hy + P_, RT - 0.05, x0 + 0.05, hy - P_, RT, skip=('-y', '+y'))
    wbox(x0 + 0.01, -hy + P_, D, x0 + 0.04, hy - P_, D + 0.05, skip=('-y', '+y', '-z'))
# balusters: flat slats
def slats(axis, fixed, a0, a1, n):
    for i in range(n):
        c = a0 + (a1 - a0) * (i + 1) / (n + 1)
        if axis == 'x':
            wbox(c - 0.018, fixed - 0.012, D + 0.05, c + 0.018, fixed + 0.012, RT - 0.05, skip=('-z', '+z'))
        else:
            wbox(fixed - 0.012, c - 0.018, D + 0.05, fixed + 0.012, c + 0.018, RT - 0.05, skip=('-z', '+z'))
slats('x', hy - 0.035, -hx + P_, hx - P_, 12)
slats('y', -hx + 0.035, -hy + P_, hy - P_, 9)
slats('y', hx - 0.035, -hy + P_, hy - P_, 9)
# carpet
cx, cy = T.CARPET[0] / 2, T.CARPET[1] / 2; zc = D + 0.008
def cuv(k, pts):
    if k == '+z': return [A.uv('carpet', p[0] + cx, p[1] + cy) for p in pts]
    return [A.uv('carpet', min(max(p[0] + cx, 0.01), 1.89), min(max(p[1] + cy, 0.01), 1.49)) for p in pts]
box_faces(mb, -cx, -cy, D, cx, cy, zc, cuv, skip=('-z',))
# kurpacha quilts (chamfered slabs)
def kurpacha(x0, y0, x1, y1, z0, th, along_x=True, isl='ikat1'):
    c = 0.025
    lo = [(x0, y0, z0 + th - c), (x1, y0, z0 + th - c), (x1, y1, z0 + th - c), (x0, y1, z0 + th - c)]
    hi = [(x0 + c, y0 + c, z0 + th), (x1 - c, y0 + c, z0 + th), (x1 - c, y1 - c, z0 + th), (x0 + c, y1 - c, z0 + th)]
    def tuv(p):
        if along_x: return A.uv(isl, (p[0] - x0) + 0.01, (p[1] - y0) + 0.0)
        return A.uv(isl, (p[1] - y0) + 0.01, (x1 - p[0]))
    mb.face(hi, [tuv(p) for p in hi])
    for k in range(4):
        q = [lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]]
        mb.face(q, [tuv(p) for p in q])
        b0 = (lo[k][0], lo[k][1], z0); b1 = (lo[(k + 1) % 4][0], lo[(k + 1) % 4][1], z0)
        q = [b0, b1, lo[(k + 1) % 4], lo[k]]
        mb.face(q, [tuv(p) for p in q])
KZ = zc
kurpacha(-0.9, 0.24, 0.9, 0.75, KZ, 0.08)
kurpacha(-0.94, -0.7, -0.44, 0.24, KZ, 0.08, along_x=False)
# bolsters (takya): lathe along local Z, then rotated
def lathe_mb(prof, n, isl, around_m, along_scale=1.0, flip=False):
    m = MB()
    x0, y0, w, h, px = A.isl[isl]
    s = [0.0]
    for i in range(1, len(prof)):
        s.append(s[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    P, U = [], []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        if i < n: P.append([(r * math.cos(a), r * math.sin(a), z) for r, z in prof])
        U.append([A.uv_px(isl, min(w - 1, around_m / px * i / n), min(h - 1, s[k] * along_scale / px)) for k in range(len(prof))])
    m.grid(P, U, smooth=True, closed=True, flip=flip)
    return m
bol = [(0.0, -0.26), (0.06, -0.26), (0.095, -0.245), (0.11, -0.2), (0.112, 0.0), (0.11, 0.2), (0.095, 0.245), (0.06, 0.26), (0.0, 0.26)]
bm = lathe_mb(bol, 10, 'ikat2', 0.69, 0.9)
zb = KZ + 0.08 + 0.10
for x, y, rz in ((-0.42, 0.63, 0), (0.38, 0.63, 0), (-0.8, -0.25, 90)):
    M = Matrix.Translation((x, y, zb)) @ Matrix.Rotation(math.radians(rz), 4, 'Z') @ Matrix.Rotation(math.radians(90), 4, 'Y')
    mb.merge(bm, M)
# low table with dastarkhan
tx, ty, tz = 0.28, -0.18, zc + 0.30
TW, TD = 0.45, 0.30
wbox(tx - TW, ty - TD, tz - 0.035, tx + TW, ty + TD, tz - 0.004, skip=())
for sx in (-1, 1):
    for sy in (-1, 1):
        wbox(tx + sx * (TW - 0.06) - 0.025, ty + sy * (TD - 0.05) - 0.025, zc, tx + sx * (TW - 0.06) + 0.025, ty + sy * (TD - 0.05) + 0.025, tz - 0.035, skip=('-z', '+z'))
cl = [(tx - TW, ty - TD, tz), (tx + TW, ty - TD, tz), (tx + TW, ty + TD, tz), (tx - TW, ty + TD, tz)]
mb.face(cl, [A.uv('cloth', p[0] - (tx - TW - 0.01) + 0.0, p[1] - (ty - TD - 0.01)) for p in cl])
# teapot (choinak)
tp = [(0.0, 0.0), (0.045, 0.0), (0.065, 0.015), (0.075, 0.05), (0.068, 0.085), (0.045, 0.108), (0.034, 0.112),
      (0.038, 0.118), (0.03, 0.128), (0.012, 0.135), (0.008, 0.148), (0.0, 0.152)]
tpm = lathe_mb(tp, 12, 'ceramic', 0.41, 0.8)
px_, py_ = tx - 0.12, ty + 0.05
mb.merge(tpm, Matrix.Translation((px_, py_, tz + 0.002)))
# spout: tapered tube
sp = MB(); n = 6
rings = [((0.06, 0, 0.04), 0.018), ((0.10, 0, 0.07), 0.012), ((0.125, 0, 0.105), 0.008)]
P, U = [], []
for i in range(n + 1):
    a = 2 * math.pi * i / n
    if i < n:
        row = []
        for (c, r) in rings:
            row.append((c[0], c[1] + r * math.cos(a), c[2] + r * math.sin(a)))
        P.append(row)
    U.append([A.uv('ceramic', 0.01 + 0.04 * i / n, 0.01 + 0.03 * j) for j in range(len(rings))])
sp.grid(P, U, smooth=True, closed=True)
mb.merge(sp, Matrix.Translation((px_, py_, tz + 0.002)))
# handle: half torus on the back
hd = MB(); nu, nv = 8, 4; P, U = [], []
for i in range(nu + 1):
    a = math.pi * i / nu - math.pi / 2
    row = []; urow = []
    for j in range(nv + 1):
        b = 2 * math.pi * j / nv
        rr = 0.035 + 0.007 * math.cos(b)
        row.append((-0.068 - rr * math.cos(a) + 0.0, 0.007 * math.sin(b), 0.06 + rr * math.sin(a)))
        urow.append(A.uv('ceramic', 0.05 + 0.1 * i / nu, 0.005 + 0.02 * j / nv))
    P.append(row); U.append(urow)
hd.grid(P, U, smooth=True)
mb.merge(hd, Matrix.Translation((px_, py_, tz + 0.002)))
# bowls (piyola)
bw = [(0.0, 0.0), (0.024, 0.0), (0.03, 0.006), (0.046, 0.052), (0.043, 0.053), (0.022, 0.014), (0.0, 0.012)]
bwm = lathe_mb(bw, 12, 'ceramic', 0.29, 1.0)
for bx, by in ((tx + 0.05, ty - 0.1), (tx + 0.16, ty + 0.08)):
    mb.merge(bwm, Matrix.Translation((bx, by, tz + 0.002)))
# bread (non) x2
br = [(0.0, 0.0), (0.14, 0.0), (0.152, 0.01), (0.14, 0.024), (0.115, 0.028), (0.09, 0.016), (0.0, 0.014)]
brm = MB(); n = 16; P, U = [], []
for i in range(n + 1):
    a = 2 * math.pi * i / n
    if i < n: P.append([(r * math.cos(a), r * math.sin(a), z) for r, z in br])
    U.append([A.uv('bread', 0.155 + r * math.cos(a), 0.155 + r * math.sin(a)) for r, z in br])
brm.grid(P, U, smooth=True, closed=True)
mb.merge(brm, Matrix.Translation((tx + 0.22, ty - 0.08, tz + 0.002)))
mb.merge(brm, Matrix.Translation((tx + 0.25, ty - 0.06, tz + 0.03)) @ Matrix.Rotation(0.15, 4, 'Y'))
ob = mb.to_object('tapchan', [mat]); ob.data.validate()
print('TRIS', tri_count([ob]))
export_glb(os.path.join(KIT, 'tapchan.glb'), [ob])
