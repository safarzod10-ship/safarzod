"""blender -b -P aivan_build.py -> kit/aivan_section.glb"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blib import *
import aivan_layout as L
import col_layout as C
from col_geo import column_mesh, SubAtlas
reset()
A = Atlas(L.S, L.ISL)
CA = SubAtlas(Atlas(C.S, C.ISL), 0.5, (0.0, 0.5))
T = os.path.join(TEXOUT, 'aivan')
mat = pbr_material('aivan_atlas', T + '_base.jpg', T + '_orm.jpg', T + '_nrm.jpg')
mb = MB(); seed = [500]
def pf(pts, along=None):
    seed[0] += 1; return plain_fit(A, 'plain', pts, seed[0], along)

# columns
for cx in L.COL_X:
    cm, top = column_mesh(L.COL_H, CA, seed0=cx * 100, nseg=20)
    from mathutils import Matrix
    mb.merge(cm, Matrix.Translation((cx, L.FRONT_Y, 0)))
hw = L.WIDTH / 2
def beam_uv(key, pts, ycen):
    if key in ('-y', '+y'):
        return [A.uv('beam_front', hw - abs(p[0]), p[2] - L.Z_BEAM0) for p in pts]
    if key == '-z':
        return [A.uv('beam_bottom', hw - abs(p[0]), p[1] - (ycen - L.BEAM[0] / 2)) for p in pts]
    return pf(pts)
# front girder and back ledger, split at x=0 for mirrored painting
for ycen, wid in ((L.FRONT_Y, L.BEAM[0]), (L.Y1 - 0.075, 0.15)):
    for xa, xb in ((-hw, 0.0), (0.0, hw)):
        box_faces(mb, xa, ycen - wid / 2, L.Z_BEAM0, xb, ycen + wid / 2, L.Z_BEAM1,
                  lambda k, p, yc=ycen: beam_uv(k, p, yc), skip=('-x', '+x'))
# joists: octagonal prisms along Y, painted, with end-grain caps at the front
n = 8
for i in range(L.JOIST_N):
    x = -hw + L.JOIST_STEP * (i + 0.5)
    isl = f'joist{i % 2}'
    x0, y0, w, h, px = L.ISL[isl]
    P, U = [], []
    for k in range(n + 1):
        a = 2 * math.pi * k / n + math.pi / 8
        if k < n:
            P.append([(x + L.JOIST_R * math.cos(a), y, L.Z_JOIST + L.JOIST_R * math.sin(a)) for y in (L.Y0, L.Y1)])
        U.append([A.uv_px(isl, w * k / n, (y - L.Y0) / px) for y in (L.Y0, L.Y1)])
    mb.grid(P, U, smooth=True, closed=True, flip=True)
    cap = [(x + L.JOIST_R * math.cos(2 * math.pi * k / n + math.pi / 8), L.Y0, L.Z_JOIST + L.JOIST_R * math.sin(2 * math.pi * k / n + math.pi / 8)) for k in range(n)]
    mb.face(cap, [A.uv('endgrain', 0.064 + (p[0] - x) * 1.25, 0.064 + (p[2] - L.Z_JOIST) * 1.25) for p in cap])
# ceiling bays (face down), one bay per joist interval centred between joists
for i in range(L.JOIST_N + 1):
    xa = max(-hw, -hw + L.JOIST_STEP * (i - 0.5)); xb = min(hw, -hw + L.JOIST_STEP * (i + 0.5))
    if xb - xa < 1e-4: continue
    isl = f'bay{(i * 7) % 4}'
    xc = -hw + L.JOIST_STEP * i
    q = [(xa, L.Y1, L.Z_CEIL), (xb, L.Y1, L.Z_CEIL), (xb, L.Y0, L.Z_CEIL), (xa, L.Y0, L.Z_CEIL)]
    mb.face(q, [A.uv(isl, (p[0] - xc) + L.JOIST_STEP / 2, p[1] - L.Y0) for p in q])
# roof slab: front fascia (painted), top (earth), back edge
def roof_uv(k, pts):
    if k == '-y':
        return [A.uv('fascia', hw - abs(p[0]), p[2] - L.Z_CEIL) for p in pts]
    if k == '+z':
        return [A.uv('roof', (p[0] + hw) * 0.95 % 4.5 if False else (p[0] + hw) * 0.75, (p[1] - L.Y0 - 0.02) * 1.0) for p in pts]
    return pf(pts)
for xa, xb in ((-hw, 0.0), (0.0, hw)):
    box_faces(mb, xa, L.Y0 - 0.02, L.Z_CEIL, xb, L.Y1, L.Z_TOP, roof_uv, skip=('-x', '+x', '-z'))
# end caps (keeps a single module closed; hidden when modules are tiled side by side)
for sx in (-1, 1):
    x = sx * hw
    for (ya, yb, za, zb) in ((L.FRONT_Y - L.BEAM[0] / 2, L.FRONT_Y + L.BEAM[0] / 2, L.Z_BEAM0, L.Z_BEAM1),
                             (L.Y1 - 0.15, L.Y1, L.Z_BEAM0, L.Z_BEAM1), (L.Y0 - 0.02, L.Y1, L.Z_CEIL, L.Z_TOP)):
        q = [(x, ya, za), (x, yb, za), (x, yb, zb), (x, ya, zb)]
        if sx < 0: q = q[::-1]
        mb.face(q, pf(q))
ob = mb.to_object('aivan_section', [mat]); ob.data.validate()
print('TRIS', tri_count([ob]))
export_glb(os.path.join(KIT, 'aivan_section.glb'), [ob])
