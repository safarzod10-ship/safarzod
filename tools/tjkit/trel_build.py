"""blender -b -P trel_build.py -> kit/grape_trellis.glb"""
import sys, os, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blib import *
from mathutils import Vector, Matrix
import trel_layout as T
reset()
A = Atlas(T.S, T.ISL)
TX = os.path.join(TEXOUT, 'trellis')
mat = pbr_material('trellis', TX + '_base.jpg', TX + '_orm.jpg', TX + '_nrm.jpg')
leafmat = pbr_material('trellis_leaves', TX + '_base.jpg', TX + '_orm.jpg', TX + '_nrm.jpg', double_sided=True)
mb = MB(); rnd = random.Random(11)

def tube(pts, radii, nseg, isl, cap0=False, cap1=False, vscale=1.0):
    pts = [Vector(p) for p in pts]
    x0, y0, w, h, px = A.isl[isl]
    # parallel-transport frames
    t0 = (pts[1] - pts[0]).normalized()
    ref = Vector((0, 0, 1)) if abs(t0.z) < 0.9 else Vector((1, 0, 0))
    nrm = t0.cross(ref).normalized(); frames = []
    for i in range(len(pts)):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        nrm = (nrm - t * nrm.dot(t)).normalized(); bin_ = t.cross(nrm)
        frames.append((nrm.copy(), bin_.copy()))
    L = [0.0]
    for i in range(1, len(pts)): L.append(L[-1] + (pts[i] - pts[i - 1]).length)
    rmean = sum(radii) / len(radii)
    P, U = [], []
    for k in range(nseg + 1):
        a = 2 * math.pi * k / nseg
        if k < nseg:
            P.append([tuple(pts[i] + (frames[i][0] * math.cos(a) + frames[i][1] * math.sin(a)) * radii[i]) for i in range(len(pts))])
        U.append([A.uv_px(isl, min(w - 1, (2 * math.pi * rmean / px) * k / nseg), min(h - 1, L[i] * vscale / px)) for i in range(len(pts))])
    mb.grid(P, U, smooth=True, closed=True)
    for cap, i, sgn in ((cap0, 0, -1), (cap1, len(pts) - 1, 1)):
        if not cap: continue
        ring = [pts[i] + (frames[i][0] * math.cos(2 * math.pi * k / nseg) + frames[i][1] * math.sin(2 * math.pi * k / nseg)) * radii[i] for k in range(nseg)]
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() * sgn
        nn_ = (ring[1] - ring[0]).cross(ring[2] - ring[1])
        if nn_.dot(t) < 0: ring = ring[::-1]
        uv = [A.uv('end', 0.0827 + (frames[i][0].dot(p - pts[i])) * 0.9, 0.0827 + (frames[i][1].dot(p - pts[i])) * 0.9) for p in ring]
        mb.face([tuple(p) for p in ring], uv)

def wob(a, b, n, amp, seed, sag=0.0):
    r = random.Random(seed); out = []
    for i in range(n):
        t = i / (n - 1); p = Vector(a).lerp(Vector(b), t)
        if 0 < i < n - 1:
            p += Vector((r.uniform(-amp, amp), r.uniform(-amp, amp), r.uniform(-amp, amp) * 0.5))
        p.z -= sag * math.sin(math.pi * t)
        out.append(tuple(p))
    return out

hx, hy = 1.4, 1.4
for i, (sx, sy) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
    base = (sx * hx, sy * hy, 0.0); top = (sx * hx + rnd.uniform(-0.03, 0.03), sy * hy + rnd.uniform(-0.03, 0.03), T.POST_H)
    pts = wob(base, top, 6, 0.012, i)
    tube(pts, [T.R_POST * (1 - 0.12 * k / 5) for k in range(6)], 8, 'pole', cap1=True)
zb = T.POST_H + T.R_BEAM
for j, sy in enumerate((-1, 1)):
    pts = wob((-1.62, sy * hy, zb), (1.62, sy * hy, zb), 7, 0.01, 10 + j, sag=0.025)
    tube(pts, [T.R_BEAM] * 7, 6, 'pole', True, True, vscale=0.85)
zc = zb + T.R_BEAM + T.R_CROSS - 0.01
for i in range(9):
    x = -1.4 + i * 0.35
    pts = wob((x, -1.62, zc), (x, 1.62, zc), 4, 0.012, 20 + i, sag=0.02)
    tube(pts, [T.R_CROSS] * 4, 5, 'pole', True, True, vscale=0.85)
# vine trunk: twisting up near the front-left post, then branches over the top
trunk = []
for k in range(12):
    t = k / 11
    ang = t * 5.0
    trunk.append((-1.22 + 0.07 * math.cos(ang), -1.42 + 0.07 * math.sin(ang), t * (zc + 0.02)))
trunk.append((-1.1, -1.3, zc + 0.06))
tube(trunk, [0.055 - 0.02 * k / 12 for k in range(13)], 6, 'vine')
branches = [((-1.1, -1.3, zc + 0.06), (1.3, -1.0, zc + 0.05)), ((-1.1, -1.3, zc + 0.06), (0.4, 1.3, zc + 0.06)),
            ((-1.1, -1.3, zc + 0.06), (-1.25, 1.35, zc + 0.05)), ((-0.2, -0.4, zc + 0.06), (1.3, 0.9, zc + 0.05))]
leaf_sites = []
for bi, (a, b) in enumerate(branches):
    pts = wob(a, b, 7, 0.09, 40 + bi)
    pts = [(p[0], p[1], max(p[2], zc + T.R_CROSS + 0.012)) for p in pts]
    tube(pts, [0.03 - 0.018 * k / 6 for k in range(7)], 5, 'vine', cap1=False)
    leaf_sites += pts[1:]
# leaves: palmate polygons, double sided
outline = T.leaf_outline()
outline = [p for i, p in enumerate(outline) if i not in (2, 8)]   # 9-point outline
LC = (0.0, 0.085)
def leaf(pos, normal, yaw, scale, var):
    n = Vector(normal).normalized()
    up = Vector((math.cos(yaw), math.sin(yaw), 0))
    up = (up - n * up.dot(n)).normalized(); side = up.cross(n)
    P = lambda p: tuple(Vector(pos) + (side * p[0] + up * p[1]) * scale + (n * 0.018 * scale if p is LC else Vector()))
    UVf = lambda p: A.uv(f'leaf{var}', p[0] + 0.1, p[1] + 0.005)
    for i in range(len(outline) - 1):
        tri = [LC, outline[i], outline[i + 1]]
        pts = [Vector(P(q)) for q in tri]
        if (pts[1] - pts[0]).cross(pts[2] - pts[1]).dot(n) < 0: tri = tri[::-1]
        leafmb.face([P(q) for q in tri], [UVf(q) for q in tri])
    tri = [LC, outline[-1], outline[0]]
    pts = [Vector(P(q)) for q in tri]
    if (pts[1] - pts[0]).cross(pts[2] - pts[1]).dot(n) < 0: tri = tri[::-1]
    leafmb.face([P(q) for q in tri], [UVf(q) for q in tri])
leafmb = MB()
nleaf = 0
import bisect
for i in range(170):
    if rnd.random() < 0.6:
        s0 = Vector(leaf_sites[rnd.randrange(len(leaf_sites))])
        pos = s0 + Vector((rnd.gauss(0, 0.28), rnd.gauss(0, 0.28), rnd.uniform(0.02, 0.14)))
    else:
        pos = Vector((rnd.uniform(-1.6, 1.6), rnd.uniform(-1.6, 1.6), zc + rnd.uniform(0.04, 0.16)))
    pos.x = max(-1.7, min(1.7, pos.x)); pos.y = max(-1.7, min(1.7, pos.y))
    hang = rnd.random() < 0.3 and (abs(pos.x) > 1.25 or abs(pos.y) > 1.25)
    if hang:
        out = Vector((pos.x, pos.y, 0)).normalized()
        nrm = (out + Vector((0, 0, rnd.uniform(-0.3, 0.3)))).normalized(); pos.z -= rnd.uniform(0.05, 0.3)
    else:
        nrm = Vector((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), 1.0))
    leaf(tuple(pos), tuple(nrm), rnd.uniform(0, 6.28), rnd.uniform(0.9, 1.45), rnd.randrange(4))
    nleaf += 1
# grape clusters hanging below the canopy
for i in range(5):
    c = Vector(leaf_sites[(i * 5 + 2) % len(leaf_sites)]) + Vector((rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), 0))
    top = c + Vector((0, 0, -0.04)); L = rnd.uniform(0.16, 0.24)
    prof = [(0.0, 0.0), (0.06, -0.02), (0.065, -L * 0.35), (0.04, -L * 0.75), (0.0, -L)]
    P, U = [], []
    n = 6
    for k in range(n + 1):
        a = 2 * math.pi * k / n
        if k < n: P.append([tuple(top + Vector((r * math.cos(a), r * math.sin(a), z))) for r, z in prof])
        U.append([A.uv('grapes', 0.02 + 0.2 * k / n, 0.02 + 0.2 * j / 4) for j in range(len(prof))])
    mb.grid(P, U, smooth=True, closed=True, flip=True)
ob = mb.to_object('grape_trellis', [mat]); ob.data.validate()
lo = leafmb.to_object('grape_leaves', [leafmat], parent=ob); lo.data.validate()
print('TRIS', tri_count([ob, lo]), 'leaves', nleaf, 'structure', tri_count([ob]))
export_glb(os.path.join(KIT, 'grape_trellis.glb'), [ob, lo])
