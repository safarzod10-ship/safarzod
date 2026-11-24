"""blender -b -P win_build.py -> kit/window_panjara.glb"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from blib import *
import win_layout as WL
reset()
A = Atlas(WL.S, WL.ISL)
T = os.path.join(TEXOUT, 'window')
mat = pbr_material('window_wood', T + '_base.jpg', T + '_orm.jpg', T + '_nrm.jpg')
mb = MB(); sd = [0]
def pf(pts, along=None):
    sd[0] += 1; return plain_fit(A, 'plain', pts, sd[0], along)
fuv = lambda p: A.uv('front', p[0] + WL.W / 2, p[2])
buv = lambda p: A.uv('front', WL.W / 2 - p[0], p[2])
def boxuv(k, pts):
    if k == '-y': return [fuv(p) for p in pts]
    if k == '+y': return [buv(p) for p in pts]
    return pf(pts)
hd = WL.D / 2
# frame: stiles + rails
box_faces(mb, -WL.W / 2, -hd, 0, WL.IN_X0, hd, WL.H, boxuv)
box_faces(mb, WL.IN_X1, -hd, 0, WL.W / 2, hd, WL.H, boxuv)
box_faces(mb, WL.IN_X0, -hd, WL.IN_Z1, WL.IN_X1, hd, WL.H, boxuv, skip=('-x', '+x'))
box_faces(mb, WL.IN_X0, -hd, 0, WL.IN_X1, hd, WL.IN_Z0, boxuv, skip=('-x', '+x'))
# sill ledge
box_faces(mb, -WL.W / 2 - 0.03, -hd - 0.05, -0.04, WL.W / 2 + 0.03, hd, 0.0, lambda k, p: pf(p))
# lattice strips
lines = WL.hankin_lines()
hw, hd2 = WL.STRIP_W / 2, WL.STRIP_D / 2
for a, b in lines:
    dx, dz = b[0] - a[0], b[1] - a[1]; l = math.hypot(dx, dz)
    fam = int(round((math.atan2(dz, dx) % math.pi) / (math.pi / 8))) % 8
    hd2 = WL.STRIP_D / 2 + 0.0018 * (fam % 4)
    nx, nz = -dz / l * hw, dx / l * hw
    c = [(a[0] + nx, a[1] + nz), (b[0] + nx, b[1] + nz), (b[0] - nx, b[1] - nz), (a[0] - nx, a[1] - nz)]
    fr = [(x, -hd2, z) for x, z in c]; bk = [(x, hd2, z) for x, z in c]
    # orientation: c goes along +dir on the +n side then back; normal of front must be -y
    def nrm_y(q):
        e1 = [q[1][i] - q[0][i] for i in range(3)]; e2 = [q[2][i] - q[1][i] for i in range(3)]
        return e1[2] * e2[0] - e1[0] * e2[2]
    if nrm_y(fr) > 0: fr = fr[::-1]
    if nrm_y(bk) < 0: bk = bk[::-1]
    mb.face(fr, [fuv(p) for p in fr]); mb.face(bk, [buv(p) for p in bk])
    for s0, s1 in ((0, 1), (2, 3)):
        q = [fr_ for fr_ in ((c[s0][0], -hd2, c[s0][1]), (c[s1][0], -hd2, c[s1][1]), (c[s1][0], hd2, c[s1][1]), (c[s0][0], hd2, c[s0][1]))]
        # outward = away from strip centre
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        e1 = [q[1][i] - q[0][i] for i in range(3)]; e2 = [q[2][i] - q[1][i] for i in range(3)]
        n = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
        cc = ((q[0][0] + q[1][0]) / 2 - mid[0], (q[0][2] + q[1][2]) / 2 - mid[1])
        if n[0] * cc[0] + n[2] * cc[1] < 0: q = q[::-1]
        mb.face(q, pf(q, along=(dx, 0, dz)))
    for s0, s1, endp in ((1, 2, b), (3, 0, a)):
        q = [(c[s0][0], -hd2, c[s0][1]), (c[s1][0], -hd2, c[s1][1]), (c[s1][0], hd2, c[s1][1]), (c[s0][0], hd2, c[s0][1])]
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        e1 = [q[1][i] - q[0][i] for i in range(3)]; e2 = [q[2][i] - q[1][i] for i in range(3)]
        n = (e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0])
        cc = (endp[0] - mid[0], endp[1] - mid[1])
        if n[0] * cc[0] + n[2] * cc[1] < 0: q = q[::-1]
        mb.face(q, pf(q))
ob = mb.to_object('window_panjara', [mat]); ob.data.validate()
print('TRIS', tri_count([ob]), 'lines', len(lines))
export_glb(os.path.join(KIT, 'window_panjara.glb'), [ob])
