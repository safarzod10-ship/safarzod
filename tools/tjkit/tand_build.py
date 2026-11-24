"""blender -b -P tand_build.py -> kit/tandoor.glb"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blib import *
import tand_layout as T
reset()
A = Atlas(T.S, T.ISL)
TX = os.path.join(TEXOUT, 'tandoor')
mat = pbr_material('tandoor_clay', TX + '_base.jpg', TX + '_orm.jpg', TX + '_nrm.jpg')
mb = MB()
pts, n_out, n_rim = T.profile()
s = [0.0]
for i in range(1, len(pts)):
    s.append(s[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
x0, y0, w, h, px = A.isl['lathe']
n = T.NSEG
P, U = [], []
for i in range(n + 1):
    a = 2 * math.pi * i / n
    if i < n:
        P.append([(r * math.cos(a), r * math.sin(a), z) for r, z in pts])
    U.append([A.uv_px('lathe', w * i / n, s[k] / px) for k in range(len(pts))])
mb.grid(P, U, smooth=True, closed=True)
hx, hy, H = T.PL_X / 2, T.PL_Y / 2, T.PL_H
c = 0.04
lo = [(-hx, -hy, H - c), (hx, -hy, H - c), (hx, hy, H - c), (-hx, hy, H - c)]
hi = [(-hx + c, -hy + c, H), (hx - c, -hy + c, H), (hx - c, hy - c, H), (-hx + c, hy - c, H)]
mb.face(hi, [A.uv('plat_top', p[0] + hx, p[1] + hy) for p in hi])
for k in range(4):
    q = [lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]]
    mb.face(q, [A.uv('plat_side', 0.05 + (abs(p[0]) if k % 2 == 0 else abs(p[1])) + 0.0 * k, 0.41 + (p[2] - (H - c))) for p in q])
    b0 = (lo[k][0], lo[k][1], 0.0); b1 = (lo[(k + 1) % 4][0], lo[(k + 1) % 4][1], 0.0)
    q = [b0, b1, lo[(k + 1) % 4], lo[k]]
    L = math.dist(b0[:2], b1[:2]); off = 0.0 if k % 2 == 0 else 0.9
    mb.face(q, [A.uv('plat_side', off + (j in (1, 2)) * L, p[2]) for j, p in enumerate(q)])
ob = mb.to_object('tandoor', [mat]); ob.data.validate()
print('TRIS', tri_count([ob]))
export_glb(os.path.join(KIT, 'tandoor.glb'), [ob])
