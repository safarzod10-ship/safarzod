"""blender -b -P door_build.py  -> kit/door_khujand.glb"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy
from mathutils import Vector, Matrix
from blib import *
import door_layout as L

reset()
A = Atlas(L.S, L.ISL)
T = os.path.join(TEXOUT, 'door')
mat = pbr_material('door_wood', T + '_base.jpg', T + '_orm.jpg', T + '_nrm.jpg')
seed = [0]
def pf(pts, along=None):
    seed[0] += 1
    return plain_fit(A, 'plain', pts, seed[0], along)

FRONT_Y = -0.10       # frame front plane (origin = base centre, frame depth 0.20)
LEAF_Y = -0.045       # leaf front plane

# ------------------------------------------------------------------ leaf (local: hinge at x=0, front y=0)
def leaf_mesh():
    mb = MB()
    W, H, Tt = L.LEAF_W, L.LEAF_H, L.LEAF_T
    xs = [0, L.STILE, W - L.STILE, W]
    rows = L.leaf_rows()
    uvf = lambda x, z: A.uv('leaf_front', x, z)
    for (z0, z1, tag) in rows:
        for i in range(3):
            x0, x1 = xs[i], xs[i + 1]
            if tag and i == 1:
                c, d = L.PANEL_INSET, L.PANEL_DEPTH
                o = [(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)]
                n = [(x0 + c, d, z0 + c), (x1 - c, d, z0 + c), (x1 - c, d, z1 - c), (x0 + c, d, z1 - c)]
                for k in range(4):
                    q = [o[k], o[(k + 1) % 4], n[(k + 1) % 4], n[k]]
                    mb.face(q, [uvf(p[0], p[2]) for p in q])
                mb.face(n, [uvf(p[0], p[2]) for p in n])
            else:
                q = [(x0, 0, z0), (x1, 0, z0), (x1, 0, z1), (x0, 0, z1)]
                mb.face(q, [uvf(p[0], p[2]) for p in q])
    # back
    q = [(W, Tt, 0), (0, Tt, 0), (0, Tt, H), (W, Tt, H)]
    mb.face(q, [A.uv('leaf_back', W - p[0], p[2]) for p in q])
    # edges
    for q in ([(0, Tt, 0), (0, 0, 0), (0, 0, H), (0, Tt, H)],
              [(W, 0, 0), (W, Tt, 0), (W, Tt, H), (W, 0, H)],
              [(0, 0, H), (W, 0, H), (W, Tt, H), (0, Tt, H)],
              [(0, Tt, 0), (W, Tt, 0), (W, 0, 0), (0, 0, 0)]):
        mb.face(q, pf(q))
    # iron: knocker plate, pin, ring, studs
    iron = 'iron'
    def iuv(x, y):  # iron island metres (0..0.128)
        return A.uv(iron, x, y)
    kx, kz = W - 0.072, L.KNOCK_Z
    n = 16; R = 0.058; th = 0.006
    ring_front = []
    for k in range(n):
        a = 2 * math.pi * k / n
        ring_front.append((kx + R * math.cos(a), -th, kz + R * math.sin(a)))
    mb.face(ring_front[::-1] if False else ring_front, [iuv(0.064 + (p[0] - kx), 0.064 + (p[2] - kz)) for p in ring_front])
    for k in range(n):
        a0, a1 = 2 * math.pi * k / n, 2 * math.pi * (k + 1) / n
        q = [(kx + R * math.cos(a0), 0, kz + R * math.sin(a0)), (kx + R * math.cos(a1), 0, kz + R * math.sin(a1)),
             (kx + R * math.cos(a1), -th, kz + R * math.sin(a1)), (kx + R * math.cos(a0), -th, kz + R * math.sin(a0))]
        mb.face(q, [iuv(0.01 + 0.005 * j, 0.01) for j in range(4)])
    # pin boss (dome)
    def dome(cx, cy, cz, r, h, nseg=8, rings=3, uvc=(0.064, 0.064)):
        P = []; U = []
        for i in range(nseg + 1):
            a = 2 * math.pi * i / nseg
            row = []; urow = []
            for j in range(rings + 1):
                t = j / rings
                rr = r * math.cos(t * math.pi / 2); yy = -h * math.sin(t * math.pi / 2)
                row.append((cx + rr * math.cos(a), cy + yy, cz + rr * math.sin(a)))
                urow.append(iuv(uvc[0] + 0.012 * math.cos(a) * (1 - t), uvc[1] + 0.012 * math.sin(a) * (1 - t)))
            if i < nseg: P.append(row)
            U.append(urow)
        mb.grid(P, U, smooth=True, closed=True)
    dome(kx, -th, kz, 0.016, 0.014)
    # ring (torus) hanging from the boss, tilted slightly away from the leaf
    Rr, rr = 0.062, 0.0085
    nu, nv = 18, 6
    P = []; U = []
    tilt = math.radians(8)
    for i in range(nu + 1):
        a = 2 * math.pi * i / nu
        row = []; urow = []
        for j in range(nv + 1):
            b = 2 * math.pi * j / nv
            x = (Rr + rr * math.cos(b)) * math.cos(a)
            z = (Rr + rr * math.cos(b)) * math.sin(a)
            y = rr * math.sin(b)
            # ring plane = leaf plane, top of ring at boss
            z -= Rr - 0.008
            yy = -th - 0.02 + y + (z) * -math.sin(tilt)
            row.append((kx + x, yy, kz + z))
            urow.append(iuv(0.004 + 0.12 * i / nu, 0.004 + 0.012 * j / nv))
        if i < nu: P.append(row)
        U.append(urow)
    mb.grid(P, U, smooth=True, closed=True, flip=True)
    # decorative studs on the mid rails
    for (z0, z1, tag) in rows:
        if tag is None and 0.05 < z0 < L.LEAF_H - 0.2 and abs((z1 - z0) - L.RAIL_MID) < 1e-6:
            for x in (L.STILE * 0.5, W - L.STILE * 0.5):
                dome(x, 0, (z0 + z1) / 2, 0.013, 0.011, 8, 2, (0.11, 0.11))
    return mb

def mirrored(mb):
    out = MB()
    for p in mb.v:
        out.v.append((-p[0], p[1], p[2]))
    for f, u, s, m in zip(mb.f, mb.uv, mb.sm, mb.mat):
        out.f.append(f[::-1]); out.uv.append(u[::-1]); out.sm.append(s); out.mat.append(m)
    return out

# ------------------------------------------------------------------ frame
frame = MB()
OW = L.OW
def extrude_profile(mb, prof, z0, z1, island_ranges, mirror=False):
    """prof: list of (x, y) points (x across, y depth) for the LEFT jamb; extruded along z.
    island_ranges: list per segment: ('jamb', s_start) for developed mapping or None for plain."""
    s = 0.0
    for k in range(len(prof) - 1):
        a, b = prof[k], prof[k + 1]
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        q = [(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)]
        isl = island_ranges[k]
        if isl is None:
            uv = pf(q, along=(0, 0, 1))
        else:
            s0 = isl
            uv = [A.uv('jamb', s0, z0), A.uv('jamb', s0 + seg, z0), A.uv('jamb', s0 + seg, z1), A.uv('jamb', s0, z1)]
        if mirror:
            q = [(-p[0], p[1], p[2]) for p in q]
        else:
            q = q[::-1]; uv = uv[::-1]
        mb.face(q, uv)

bw, fw, sw, ow = L.JPROF
x_in = -OW
yr = FRONT_Y + 0.03
prof = [(x_in, -FRONT_Y)]                 # reveal back corner (y=+0.10)
prof.append((x_in, yr))                    # reveal face to bead start
rng = [None]
nb = 4
s = 0.0
for k in range(1, nb + 1):
    a = -math.pi / 2 * k / nb
    p = (x_in - 0.03 + 0.03 * math.cos(a), yr + 0.03 * math.sin(a))
    rng.append(s); s += math.hypot(p[0] - prof[-1][0], p[1] - prof[-1][1]); prof.append(p)
# rescale bead developed length to island part
bead_len = s
rng = [None] + [r * bw / bead_len for r in rng[1:]]
prof.append((x_in - 0.03 - fw, FRONT_Y)); rng.append(bw)
prof.append((x_in - 0.03 - fw, FRONT_Y + 0.008)); rng.append(bw + fw)
prof.append((x_in - L.JAMB_W, FRONT_Y + 0.008)); rng.append(bw + fw + sw)
prof.append((x_in - L.JAMB_W, -FRONT_Y)); rng.append(None)
prof.append((x_in, -FRONT_Y)); rng.append(None)
for mirror in (False, True):
    extrude_profile(frame, prof, 0.0, L.TOP, rng, mirror)

# sill
def boxuv(key, pts):
    if key == '+z':
        return [A.uv('sill_top', p[0] + 0.87, p[1] - (-0.115) + 0.0) for p in pts]
    return pf(pts)
box_faces(frame, -OW, FRONT_Y - 0.015, 0.0, OW, -FRONT_Y, L.SILL_H, boxuv, skip=('-z',))

# frieze panel between jambs (front at reveal start)
zf0, zf1 = L.SILL_H + L.LEAF_H, L.TOP
fy = yr
q = [(-OW, fy, zf0), (0, fy, zf0), (0, fy, zf1), (-OW, fy, zf1)]
frame.face(q, [A.uv('frieze', p[0] + OW, p[2] - zf0) for p in q])
q = [(0, fy, zf0), (OW, fy, zf0), (OW, fy, zf1), (0, fy, zf1)]
frame.face(q, [A.uv('frieze', OW - p[0], p[2] - zf0) for p in q])
q = [(-OW, -FRONT_Y, zf0), (OW, -FRONT_Y, zf0), (OW, fy, zf0), (-OW, fy, zf0)]
frame.face(q, pf(q))
q = [(OW, -FRONT_Y, zf0), (-OW, -FRONT_Y, zf0), (-OW, -FRONT_Y, zf1), (OW, -FRONT_Y, zf1)]
frame.face(q, pf(q))
# rope bead under frieze: half cylinder along x
nseg = 6; rb = 0.018
P = []; U = []
for i, x in enumerate((-OW, 0.0, OW)):
    row = []; urow = []
    for j in range(nseg + 1):
        a = math.pi * j / nseg
        row.append((x, fy - rb * math.sin(a), zf0 + rb - rb * math.cos(a) + 0.0))
        urow.append(A.uv('jamb', bw * j / nseg, 1.0 + abs(x) * 0.9))
    P.append(row); U.append(urow)
frame.grid(P, U, smooth=True)

# cornice: profile in (y, z), extruded along x, with dentils
xc = OW + L.JAMB_W + 0.05
cz = L.TOP
cprof = [(-FRONT_Y, cz), (FRONT_Y, cz), (FRONT_Y, cz + 0.03), (FRONT_Y - 0.03, cz + 0.03), (FRONT_Y - 0.03, cz + 0.075)]
for k in range(1, 5):
    a = math.pi / 2 * k / 4
    cprof.append((FRONT_Y - 0.03 - 0.03 * math.sin(a), cz + 0.075 + 0.03 * (1 - math.cos(a))))
cprof.append((FRONT_Y - 0.06, cz + 0.125)); cprof.append((-FRONT_Y, cz + 0.125))
s = 0.0; dev = [0.0]
for k in range(1, len(cprof)):
    s += math.hypot(cprof[k][0] - cprof[k - 1][0], cprof[k][1] - cprof[k - 1][1]); dev.append(s)
s_front0 = dev[1]
for k in range(len(cprof) - 1):
    a, b = cprof[k], cprof[k + 1]
    for (x0, x1, sgn) in ((-xc, 0.0, -1), (0.0, xc, 1)):
        q = [(x0, a[0], a[1]), (x1, a[0], a[1]), (x1, b[0], b[1]), (x0, b[0], b[1])]
        if k == 0 or k == len(cprof) - 2:
            uv = pf(q)
        else:
            v0 = min(L.CORN_PROF, dev[k] - s_front0); v1 = min(L.CORN_PROF, dev[k + 1] - s_front0)
            uv = [A.uv('cornice', 0.84 - abs(p[0]) * 0.84 / xc, v0 if (p[1], p[2]) == a else v1) for p in q]
        frame.face(q, uv)
# cornice back
for (x0, x1) in ((-xc, 0.0), (0.0, xc)):
    q = [(x1, -FRONT_Y, cz), (x0, -FRONT_Y, cz), (x0, -FRONT_Y, cz + 0.125), (x1, -FRONT_Y, cz + 0.125)]
    frame.face(q, pf(q))
# cornice end caps
for sgn in (-1, 1):
    pts = [(sgn * xc, y, z) for (y, z) in cprof]
    if sgn > 0:
        pts = pts[::-1]
    frame.face(pts, pf(pts))
# dentils under the overhang
nd = int(2 * xc / 0.055)
for i in range(nd):
    x = -xc + 0.03 + i * (2 * xc - 0.06) / (nd - 1)
    def duv(key, pts):
        return [A.uv('cornice', 0.3 + (p[0] - x) * 1.0 + i * 0.01, 0.065 + (p[2] - cz) * 0.5) for p in pts]
    box_faces(frame, x - 0.012, FRONT_Y - 0.026, cz + 0.004, x + 0.012, FRONT_Y + 0.0, cz + 0.03, duv, skip=('+y', '+z'))

frame_ob = frame.to_object('door_frame', [mat])
lm = leaf_mesh()
leafL = lm.to_object('leaf_left', [mat], parent=frame_ob, loc=(-OW + 0.002, LEAF_Y, L.SILL_H))
leafR = mirrored(lm).to_object('leaf_right', [mat], parent=frame_ob, loc=(OW - 0.002, LEAF_Y, L.SILL_H))
for ob in (frame_ob, leafL, leafR):
    ob.data.validate()
objs = [frame_ob, leafL, leafR]
print('TRIS', tri_count(objs), {o.name: tri_count([o]) for o in objs})
os.makedirs(KIT, exist_ok=True)
export_glb(os.path.join(KIT, 'door_khujand.glb'), objs)
