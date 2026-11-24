"""Blender: column mesh builder (shared by column and aivan)."""
import math
from blib import MB, Atlas, plain_fit, box_faces
import col_layout as C

class SubAtlas(Atlas):
    """Column atlas placed inside a bigger atlas: uv' = uv*scale + offset."""
    def __init__(self, base, scale=1.0, off=(0.0, 0.0)):
        super().__init__(base.S, base.isl); self.sc = scale; self.off = off
    def uv(self, name, xm, ym):
        u, v = super().uv(name, xm, ym); return (u * self.sc + self.off[0], v * self.sc + self.off[1])
    def uv_px(self, name, cx, cy):
        u, v = super().uv_px(name, cx, cy); return (u * self.sc + self.off[0], v * self.sc + self.off[1])

def column_mesh(H, A, seed0=0, nseg=C.NSEG):
    mb = MB(); seed = [seed0]
    def pf(pts, isl='plain', along=None):
        seed[0] += 1; return plain_fit(A, isl, pts, seed[0], along)
    # stone plinth with chamfer
    bh, hb, ch = C.BASE_H, C.BASE_HALF, 0.03
    def suv(k, pts): return pf(pts, 'stone')
    box_faces(mb, -hb, -hb, 0, hb, hb, bh - ch, suv, skip=('-z', '+z'))
    t = hb - ch
    lo = [(-hb, -hb, bh - ch), (hb, -hb, bh - ch), (hb, hb, bh - ch), (-hb, hb, bh - ch)]
    hi = [(-t, -t, bh), (t, -t, bh), (t, t, bh), (-t, t, bh)]
    for k in range(4):
        q = [lo[k], lo[(k + 1) % 4], hi[(k + 1) % 4], hi[k]]
        mb.face(q, pf(q, 'stone'))
    mb.face(hi, pf(hi, 'stone'))
    # lathe: kuza + shaft, v remapped onto the reference (H=3.10) texture
    ref, _ = C.profile(3.10); sref = C.developed(ref)
    pts, cap_z0 = C.profile(H); s = C.developed(pts)
    x0, y0, w, h, px = A.isl['lathe']
    P, U = [], []
    for i in range(nseg + 1):
        a = 2 * math.pi * i / nseg
        if i < nseg:
            P.append([(r * math.cos(a), r * math.sin(a), z) for r, z in pts])
        U.append([A.uv_px('lathe', w * i / nseg, sref[k] / px) for k in range(len(pts))])
    mb.grid(P, U, smooth=True, closed=True)
    # muqarnas capital rings
    rings = C.cap_rings(cap_z0)
    R = [C.ring_pts(*r) for r in rings]
    xc0, yc0, wc, hc, pxc = A.isl['capital']
    nc = C.NSEG
    P = [[R[j][i] for j in range(len(R))] for i in range(nc)]
    U = []
    for i in range(nc + 1):
        col = [R[j][i % nc] for j in range(len(R))]
        v = [0.0]
        for j in range(1, len(col)):
            v.append(v[-1] + math.dist(col[j], col[j - 1]))
        U.append([A.uv_px('capital', wc * i / nc, min(vv / pxc, hc - 1)) for vv in v])
    mb.grid(P, U, smooth=False, closed=True)
    # abacus
    za0 = rings[-1][2]; za1 = za0 + 0.12; ha = C.ABA_HALF
    def auv(k, pts):
        if k in ('-z', '+z'):
            return pf(pts)
        if k in ('-y', '+y'):
            return [A.uv('abacus', (p[0] + ha) if k == '-y' else (ha - p[0]), p[2] - za0) for p in pts]
        return [A.uv('abacus', (p[1] + ha) if k == '+x' else (ha - p[1]), p[2] - za0) for p in pts]
    box_faces(mb, -ha, -ha, za0, ha, ha, za1, auv)
    # bolish bracket along X
    L2, W2, Hb = C.BOL_L / 2, C.BOL_W / 2, C.BOL_H
    prof = [(-L2, Hb), (L2, Hb), (L2, 0.07)]
    for k in range(1, 4):
        tt = math.pi / 2 * k / 4
        prof.append((0.2 + 0.2 * math.cos(tt), 0.07 - 0.07 * math.sin(tt)))
    for k in range(4, -1, -1):
        tt = math.pi / 2 * k / 4
        prof.append((-0.2 - 0.2 * math.cos(tt), 0.07 - 0.07 * math.sin(tt)))
    prof = [(x, z + za1) for x, z in prof]
    # prof runs: top-left -> top-right -> down right end -> bottom -> up left end (clockwise in x-z seen from -y)
    front = [(x, -W2, z) for x, z in prof]
    back = [(x, W2, z) for x, z in prof]
    mb.face(front[::-1], [A.uv('bolish', p[0] + L2, p[2] - za1) for p in front[::-1]])
    mb.face(back, [A.uv('bolish', L2 - p[0], p[2] - za1) for p in back])
    n = len(prof)
    for k in range(n):
        a, b = prof[k], prof[(k + 1) % n]
        q = [(b[0], -W2, b[1]), (b[0], W2, b[1]), (a[0], W2, a[1]), (a[0], -W2, a[1])]
        mb.face(q, pf(q, 'plain2', along=(1, 0, 0) if abs(a[1] - b[1]) < 0.06 else None))
    return mb, za1 + Hb
