import json
import math
import os

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
MAP = os.path.abspath(os.path.join(HERE, '..'))
TEX = os.path.join(MAP, 'textures')
META = json.load(open(os.path.join(TEX, 'atlas.json')))
R = META['regions']

FX, FZ = 10.5, 9.25
CHAMFER = 1.8
SUN = np.array([1.0, 0.0, 0.35]) / np.linalg.norm([1.0, 0.0, 0.35])

SRC = np.array(META['floor']['src_quad_px'], float)
DST = np.array([[-FX, -FZ], [FX, -FZ], [FX, FZ], [-FX, FZ]], float)


def _homography(src, dst):
    a = []
    for (x, y), (u, v) in zip(src, dst):
        a.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        a.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.array(a))
    return vt[-1].reshape(3, 3) / vt[-1][-1]


H = _homography(SRC, DST)


def w(px, py):
    p = H @ np.array([px, py, 1.0])
    return p[0] / p[2], p[1] / p[2]


GROUPS = {}
COLLIDERS = []


def shade_of(n):
    n = np.asarray(n, float)
    n = n / (np.linalg.norm(n) + 1e-9)
    side = 0.62 + 0.38 * (float(np.dot([n[0], 0, n[2]], SUN)) / max(1e-6, math.hypot(n[0], n[2])) + 1) / 2 \
        if abs(n[1]) < 0.999 else 1.0
    up = max(0.0, n[1])
    if n[1] < -0.5:
        return 0.45
    return up * 1.0 + (1 - up) * side


def uv_in(region, s, t, sub=(0, 0, 1, 1)):
    u0, v0, u1, v1 = R[region]['uv_in']
    s = sub[0] + (sub[2] - sub[0]) * s
    t = sub[1] + (sub[3] - sub[1]) * t
    return (u0 + (u1 - u0) * s, v0 + (v1 - v0) * t)


def add_face(group, pts, uvs, mat='atlas', normal=None, shade=None):
    pts = [np.asarray(p, float) for p in pts]
    n = np.cross(pts[1] - pts[0], pts[2] - pts[0])
    if normal is not None and np.dot(n, normal) < 0:
        pts, uvs = pts[::-1], uvs[::-1]
        n = -n
    s = shade_of(n) if shade is None else shade
    GROUPS.setdefault(group, {'atlas': [], 'fence': [], 'pave': [], 'roof': []})[mat].append((pts, uvs, s))


def quad(group, tl, tr, br, bl, region, sub=(0, 0, 1, 1), normal=None, mat='atlas', uv=None, shade=None):
    if uv is None:
        uv = [uv_in(region, 0, 0, sub), uv_in(region, 1, 0, sub), uv_in(region, 1, 1, sub), uv_in(region, 0, 1, sub)]
    add_face(group, [tl, tr, br, bl], uv, mat, normal, shade)


def box(group, x0, x1, z0, z1, y0, y1, tex, skip=(), collide=True):
    P = {
        'top': ([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], (0, 1, 0)),
        's': ([x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1], (0, 0, 1)),
        'n': ([x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0], (0, 0, -1)),
        'e': ([x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1], (1, 0, 0)),
        'w': ([x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0], (-1, 0, 0)),
    }
    for f, (a, b, c, d, n) in P.items():
        if f in skip or f not in tex:
            continue
        region, sub = tex[f]
        quad(group, a, b, c, d, region, sub, normal=n)
    if collide:
        COLLIDERS.append({'group': group, 'x': [round(x0, 3), round(x1, 3)], 'z': [round(z0, 3), round(z1, 3)], 'h': round(y1, 3)})


def all_faces(region, sub=(0, 0, 1, 1)):
    return {f: (region, sub) for f in ('top', 'n', 's', 'e', 'w')}


def footprint(px0, px1, py_base, depth, width=None):
    xa, zs = w(px0, py_base)
    xb, _ = w(px1, py_base)
    if width is not None:
        c = (xa + xb) / 2
        xa, xb = c - width / 2, c + width / 2
    return xa, xb, zs - depth, zs


def crate(group, px0, px1, py_base, size, y0=0.0, skip=()):
    xa, xb, za, zb = footprint(px0, px1, py_base, size, width=size)
    box(group, xa, xb, za, zb, y0, y0 + size, all_faces('crate'), skip)
    return xa, xb, za, zb


def grey_box(group, px0, px1, py_base, w_, d_, h_, skip=()):
    xa, xb, za, zb = footprint(px0, px1, py_base, d_, width=w_)
    box(group, xa, xb, za, zb, 0, h_, all_faces('box_grey'), skip)


def block(group, xa, xb, za, zb, h=1.2):
    long_x = (xb - xa) >= (zb - za)
    tex = {'top': ('concrete', (0, 0, 1, 1))}
    face, end = ('block_face', (0, 0, 1, 1)), ('concrete', (0, 0, 0.4, 1))
    if long_x:
        tex.update(s=face, n=face, e=end, w=end)
    else:
        tex.update(e=face, w=face, s=end, n=end)
    box(group, xa, xb, za, zb, 0, h, tex)


def planter(group, xa, xb, za, zb, h=0.45, bush_h=0.75, inset=0.12):
    tex = {f: ('concrete', (0, 0, 1, 0.35)) for f in ('n', 's', 'e', 'w')}
    box(group, xa, xb, za, zb, 0, h, tex)
    i, k = inset, 0.32
    bx0, bx1, bz0, bz1 = xa + i, xb - i, za + i, zb - i
    tx0, tx1, tz0, tz1 = bx0 + k, bx1 - k, bz0 + k, bz1 - k
    y1 = h + bush_h

    def puv(x, z):
        return uv_in('bush', (x - xa) / (xb - xa), (z - za) / (zb - za))
    ring_b = [(bx0, bz0), (bx1, bz0), (bx1, bz1), (bx0, bz1)]
    ring_t = [(tx0, tz0), (tx1, tz0), (tx1, tz1), (tx0, tz1)]
    cx, cz = (xa + xb) / 2, (za + zb) / 2
    for j in range(4):
        a, b = ring_b[j], ring_b[(j + 1) % 4]
        c, d = ring_t[(j + 1) % 4], ring_t[j]
        pts = [[a[0], h, a[1]], [b[0], h, b[1]], [c[0], y1, c[1]], [d[0], y1, d[1]]]
        mid = np.array([(a[0] + b[0]) / 2 - cx, 0.4, (a[1] + b[1]) / 2 - cz])
        add_face(group, pts, [puv(*a), puv(*b), puv(*c), puv(*d)], normal=mid)
    add_face(group, [[x, y1, z] for x, z in ring_t], [puv(x, z) for x, z in ring_t], normal=(0, 1, 0))


def barrel(group, px, py_base, r=0.4, h=1.0, region='barrel_blue'):
    cx, zs = w(px, py_base)
    cz = zs - r
    n = 6
    ring = [(cx + r * math.cos(2 * math.pi * k / n + math.pi / 6), cz + r * math.sin(2 * math.pi * k / n + math.pi / 6)) for k in range(n)]
    for k in range(n):
        a, b = ring[k], ring[(k + 1) % n]
        s0, s1 = (k % 3) / 3, (k % 3 + 1) / 3
        mid = np.array([(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz])
        add_face(group, [[b[0], h, b[1]], [a[0], h, a[1]], [a[0], 0, a[1]], [b[0], 0, b[1]]],
                 [uv_in(region, s0, 0), uv_in(region, s1, 0), uv_in(region, s1, 1), uv_in(region, s0, 1)], normal=mid)
    uvs = [uv_in('barrel_top', 0.5 + 0.5 * (x - cx) / r, 0.5 + 0.5 * (z - cz) / r) for x, z in ring]
    for k in (1, 2, 3, 4):
        add_face(group, [[ring[0][0], h, ring[0][1]], [ring[k][0], h, ring[k][1]], [ring[k + 1][0], h, ring[k + 1][1]]],
                 [uvs[0], uvs[k], uvs[k + 1]], normal=(0, 1, 0))
    COLLIDERS.append({'group': group, 'x': [round(cx - r, 3), round(cx + r, 3)], 'z': [round(cz - r, 3), round(cz + r, 3)], 'h': h})


ICO_V = None
ICO_F = None


def _ico():
    t = (1 + 5 ** 0.5) / 2
    v = np.array([[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
                  [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]], float)
    v /= np.linalg.norm(v, axis=1)[:, None]
    f = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
         [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]]
    return v, f


def blob(group, c, rx, ry, rz, region, seed=0):
    v, f = _ico()
    rng = np.random.default_rng(seed)
    v = v * (1 + 0.12 * (rng.random((len(v), 1)) - 0.5))
    P = c + v * np.array([rx, ry, rz])
    for tri in f:
        pts = [P[i] for i in tri]
        uvs = [uv_in(region, 0.5 + 0.5 * (p[0] - c[0]) / rx, 0.5 + 0.5 * (p[2] - c[2]) / rz) for p in pts]
        n = np.mean(pts, axis=0) - c
        add_face(group, pts, uvs, normal=n, shade=0.55 + 0.45 * max(0.0, (n / np.linalg.norm(n)) @ np.array([0.7, 0.6, 0.25])))


def tree(group, x, z, r=2.2, trunk_h=2.4, seed=0, blobs=2):
    tr = 0.3
    pts = [(x + tr * math.cos(a), z + tr * math.sin(a)) for a in (0, 2.094, 4.189)]
    for k in range(3):
        a, b = pts[k], pts[(k + 1) % 3]
        mid = np.array([(a[0] + b[0]) / 2 - x, 0, (a[1] + b[1]) / 2 - z])
        quad(group, [b[0], trunk_h, b[1]], [a[0], trunk_h, a[1]], [a[0], 0, a[1]], [b[0], 0, b[1]], 'trunk', normal=mid)
    blob(group, np.array([x, trunk_h + r * 0.45, z]), r, r * 0.75, r, 'canopy', seed)
    if blobs > 1:
        blob(group, np.array([x + r * 0.45, trunk_h + r * 0.95, z - r * 0.3]), r * 0.62, r * 0.5, r * 0.62, 'canopy', seed + 1)


def ac_unit(group, x, z, y, rot=False):
    w_, d_ = (0.6, 0.9) if rot else (0.9, 0.6)
    tex = {'top': ('ac_top', (0, 0, 1, 1))}
    tex.update({f: ('ac_side', (0, 0, 1, 1)) for f in ('n', 's', 'e', 'w')})
    box(group, x - w_ / 2, x + w_ / 2, z - d_ / 2, z + d_ / 2, y, y + 0.65, tex, collide=False)


def parapet(group, x0, x1, z0, z1, h, sides='new', t=0.22, ph=0.3):
    rim = {'n': (x0, x1, z0, z0 + t), 's': (x0, x1, z1 - t, z1), 'w': (x0, x0 + t, z0 + t, z1 - t), 'e': (x1 - t, x1, z0 + t, z1 - t)}
    for sd in sides:
        a0, a1, b0, b1 = rim[sd]
        keep = {'n': ('top', 'n', 's'), 's': ('top', 'n', 's'), 'w': ('top', 'e', 'w'), 'e': ('top', 'e', 'w')}[sd]
        box(group, a0, a1, b0, b1, h, h + ph, {f: ('concrete', (0, 0.3, 1, 0.45)) for f in keep}, collide=False)


def building(group, x0, x1, z0, z1, h, roof='roof', skip=()):
    fw, fh = META['facade']['size_m']
    assert x1 - x0 <= fw + 1e-6 and z1 - z0 <= fw + 1e-6 and h <= fh + 1e-6, (group, x1 - x0, z1 - z0, h)
    tv = 1 - h / fh
    tex = {
        's': ('facade', (0, tv, (x1 - x0) / fw, 1)), 'n': ('facade', (0, tv, (x1 - x0) / fw, 1)),
        'e': ('facade', (0, tv, (z1 - z0) / fw, 1)), 'w': ('facade', (0, tv, (z1 - z0) / fw, 1)),
    }
    box(group, x0, x1, z0, z1, 0, h, tex, skip, collide=False)
    rt = META['roof']['tile_m'][0]
    quad(group, [x0, h, z0], [x1, h, z0], [x1, h, z1], [x0, h, z1], None, mat='roof',
         uv=[(x0 / rt, z0 / rt), (x1 / rt, z0 / rt), (x1 / rt, z1 / rt), (x0 / rt, z1 / rt)], normal=(0, 1, 0), shade=1.0)


G = 70.0
pt = META['pavement']['tile_m'][0]
quad('ground', [-G, -0.04, -G], [G, -0.04, -G], [G, -0.04, G], [-G, -0.04, G], None, mat='pave',
     uv=[(-G / pt, -G / pt), (G / pt, -G / pt), (G / pt, G / pt), (-G / pt, G / pt)], normal=(0, 1, 0),
     shade=(0.62, 0.6, 0.64))
c = CHAMFER
octa = [(-FX + c, -FZ), (FX - c, -FZ), (FX, -FZ + c), (FX, FZ - c), (FX - c, FZ), (-FX + c, FZ), (-FX, FZ - c), (-FX, -FZ + c)]
fuv = [uv_in('floor', (x + FX) / (2 * FX), (z + FZ) / (2 * FZ)) for x, z in octa]
for k in range(1, 7):
    add_face('floor', [[octa[0][0], 0, octa[0][1]], [octa[k][0], 0, octa[k][1]], [octa[k + 1][0], 0, octa[k + 1][1]]],
             [fuv[0], fuv[k], fuv[k + 1]], normal=(0, 1, 0), shade=1.0)

WALL_X = (-5.6, 4.4)
BASE_H, BASE_T, MESH_H = 0.45, 0.25, 1.7
edges = []
for k in range(8):
    a, b = np.array(octa[k], float), np.array(octa[(k + 1) % 8], float)
    if k == 0:
        edges += [(a, np.array([WALL_X[0], -FZ])), (np.array([WALL_X[1], -FZ]), b)]
    else:
        edges.append((a, b))
for a, b in edges:
    d = b - a
    L = float(np.linalg.norm(d))
    out = np.array([d[1], -d[0]]) / L
    ia, ib = a, b
    oa, ob = a + out * BASE_T, b + out * BASE_T
    s_len = min(1.0, L / 6.0)
    n_in = (-out[0], 0, -out[1])
    quad('fence', [ia[0], BASE_H, ia[1]], [ib[0], BASE_H, ib[1]], [ib[0], 0, ib[1]], [ia[0], 0, ia[1]],
         'concrete', (0, 0.4, s_len, 0.62), normal=n_in)
    quad('fence', [ob[0], BASE_H, ob[1]], [oa[0], BASE_H, oa[1]], [oa[0], 0, oa[1]], [ob[0], 0, ob[1]],
         'concrete', (0, 0.4, s_len, 0.62), normal=(out[0], 0, out[1]))
    quad('fence', [oa[0], BASE_H, oa[1]], [ob[0], BASE_H, ob[1]], [ib[0], BASE_H, ib[1]], [ia[0], BASE_H, ia[1]],
         'concrete', (0, 0.2, s_len, 0.3), normal=(0, 1, 0))
    ma, mb = a + out * BASE_T / 2, b + out * BASE_T / 2
    tile = META['chainlink']['tile_m'][0]
    uv = [(0, 0), (L / tile, 0), (L / tile, 1), (0, 1)]
    quad('fence', [ma[0], BASE_H + MESH_H, ma[1]], [mb[0], BASE_H + MESH_H, mb[1]], [mb[0], BASE_H, mb[1]], [ma[0], BASE_H, ma[1]],
         None, mat='fence', uv=uv, normal=n_in, shade=1.0)

WH, WT = 2.6, 0.3
x0, x1, zi, zo = WALL_X[0], WALL_X[1], -FZ, -FZ - WT
quad('wall', [x0, WH, zi], [x1, WH, zi], [x1, 0, zi], [x0, 0, zi], 'wall_dvor', normal=(0, 0, 1), shade=1.0)
quad('wall', [x1, WH, zo], [x0, WH, zo], [x0, 0, zo], [x1, 0, zo], 'concrete', (0, 0, 1, 1), normal=(0, 0, -1))
quad('wall', [x0, WH, zo], [x1, WH, zo], [x1, WH, zi], [x0, WH, zi], 'concrete', (0, 0, 1, 0.15), normal=(0, 1, 0))
for xe, nx in ((x0, -1), (x1, 1)):
    quad('wall', [xe, WH, zo if nx < 0 else zi], [xe, WH, zi if nx < 0 else zo], [xe, 0, zi if nx < 0 else zo], [xe, 0, zo if nx < 0 else zi],
         'concrete', (0, 0, 0.2, 1), normal=(nx, 0, 0))
COLLIDERS.append({'group': 'wall', 'x': [x0, x1], 'z': [zo, zi], 'h': WH})

xa, xb, za, zb = footprint(760, 912, 283, 1.25)
block('cover_n', xa, xb, za, zb)
xa, xb, za, zb = footprint(762, 925, 745, 1.25)
block('cover_s', xa, xb, za, zb)
xa, xb, za, zb = footprint(530, 588, 503, 3.4, width=1.2)
block('cover_w', xa, xb, za, zb)
cx_w = (xa + xb) / 2
box('cover_w', cx_w - 0.42, cx_w + 0.42, za + 0.6, za + 1.44, 1.2, 2.04, all_faces('crate'))
crate('cover_w', 540, 588, 548, 0.8)
planter('cover_w', xa - 1.35, xa - 0.05, za + 0.2, zb + 0.6)
xa, xb, za, zb = footprint(1075, 1140, 533, 3.0, width=1.3)
block('cover_e', xa, xb, za, zb)
crate('cover_e', 1088, 1128, 598, 0.8)

xa, xb, za, zb = footprint(1098, 1160, 300, 2.0, width=1.25)
planter('planter_ne', xa, xb, za, zb)
xa, xb, za, zb = footprint(472, 560, 872, 2.6, width=1.7)
planter('planter_sw', xa, xb, za, zb)
xa, xb, za, zb = footprint(1300, 1352, 745, 2.5, width=1.0)
planter('planter_e', min(xa, FX - 1.05), min(xb, FX - 0.05), za, zb)
planter('planter_n', w(1045, 135)[0], w(1185, 135)[0], -FZ + 0.02, -FZ + 0.85, bush_h=0.6)

barrel('props_n', 599, 152, region='barrel_blue')
barrel('props_n', 640, 140, region='barrel_rust')
crate('props_n', 657, 702, 140, 0.85, skip=('n',))
crate('props_n', 848, 878, 155, 0.7, skip=('n',))
crate('props_n', 880, 912, 155, 0.7, skip=('n',))
crate('props_n', 1195, 1235, 132, 0.7, skip=('n',))

crate('props_w', 335, 385, 245, 0.9, skip=('w',))
crate('props_w', 335, 385, 245, 0.85, y0=0.9, skip=('w',))
crate('props_w', 335, 385, 310, 0.9, skip=('w',))
crate('props_w', 310, 350, 600, 0.85, skip=('w',))
crate('props_w', 310, 350, 645, 0.85, skip=('w',))
grey_box('props_w', 305, 358, 745, 1.0, 1.4, 0.95, skip=('w',))
crate('props_w', 300, 345, 797, 0.85, skip=('w',))

crate('props_s', 575, 608, 893, 0.75, skip=('s',))
crate('props_s', 608, 640, 893, 0.75, skip=('s',))
crate('props_s', 575, 640, 893, 0.7, y0=0.75, skip=())
grey_box('props_s', 680, 745, 898, 1.3, 1.0, 0.9, skip=('s',))
crate('props_s', 960, 1012, 898, 0.95, skip=('s',))
crate('props_s', 1060, 1095, 893, 0.8, skip=('s',))
crate('props_s', 1095, 1130, 893, 0.8, skip=('s',))
crate('props_s', 1078, 1112, 880, 0.7, y0=0.8)

grey_box('props_e', 1300, 1345, 290, 1.0, 1.9, 1.15, skip=('e',))
crate('props_e', 1295, 1340, 335, 0.85, skip=('e',))
barrel('props_e', 1328, 398, r=0.38, region='barrel_blue')
crate('props_e', 1305, 1340, 600, 0.75, skip=('e',))
crate('props_e', 1280, 1340, 840, 1.1, skip=('e',))

tree('trees', -9.4, -11.3, r=2.3, seed=1, blobs=1)
tree('trees', 5.2, -11.2, r=2.1, seed=3, blobs=1)
tree('trees', -15.5, 3.9, r=2.5, seed=5)
tree('trees', -15.0, -5.6, r=1.9, seed=7, blobs=1)
tree('trees', 12.4, 10.2, r=2.1, seed=9)

B = 'buildings'
building(B, -22.5, -12.0, -18.0, -6.4, 9, 'roof')
building(B, -22.0, -12.0, -4.8, 2.4, 8, 'roof')
building(B, -22.0, -12.0, 6.2, 16.0, 7, 'roof')
building(B, 12.0, 23.0, -17.5, -5.0, 9, 'roof')
building(B, 12.8, 24.0, -4.2, 3.6, 10, 'roof')
building(B, 14.3, 25.0, 3.6, 15.0, 7, 'roof')
building(B, -12.0, -1.0, -25.0, -12.5, 12, 'roof')
building(B, -0.8, 11.2, -25.0, -12.5, 11, 'roof')
building(B, -24.5, -12.0, -30.6, -18.2, 12, 'roof')
building(B, 11.0, 23.5, -30.0, -17.7, 12, 'roof')
building(B, -12.0, 0.6, -37.5, -25.0, 12, 'roof')
building(B, 0.6, 13.0, -37.5, -25.0, 12, 'roof')
building(B, -35.0, -22.5, -18.0, -6.0, 8, 'roof')
building(B, -35.0, -22.5, -5.0, 7.5, 9, 'roof')
building(B, -35.0, -22.5, 8.0, 20.0, 7, 'roof')
building(B, 24.0, 36.5, -17.0, -4.6, 8, 'roof')
building(B, 25.0, 37.5, -4.2, 8.0, 9, 'roof')
building(B, 25.0, 37.5, 8.5, 20.5, 7, 'roof')
building(B, -13.5, -4.5, 11.2, 17.5, 3.2, 'roof')
building(B, -4.5, 4.5, 11.2, 17.5, 2.9, 'roof')
building(B, 4.5, 13.5, 11.2, 17.5, 3.2, 'roof')
parapet(B, -13.5, -4.5, 11.2, 17.5, 3.2, 'nw')
parapet(B, -4.5, 4.5, 11.2, 17.5, 2.9, 'n')
parapet(B, 4.5, 13.5, 11.2, 17.5, 3.2, 'ne')

ac_unit(B, -15.0, -14.0, 9, rot=True)
ac_unit(B, -16.5, -1.5, 8)
ac_unit(B, -14.6, 9.0, 7, rot=True)
ac_unit(B, 15.0, -9.0, 9)
ac_unit(B, 15.6, 0.5, 10, rot=True)
ac_unit(B, -7.5, 14.0, 3.2)
ac_unit(B, 2.0, 15.0, 3.2, rot=True)
ac_unit(B, 9.0, 13.6, 3.2)

for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for m in list(bpy.data.meshes):
    bpy.data.meshes.remove(m)


def make_material(name, image_file, alpha=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    img = bpy.data.images.load(os.path.join(TEX, image_file))
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = img
    vcol = nt.nodes.new('ShaderNodeVertexColor')
    vcol.layer_name = 'Col'
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(tex.outputs['Color'], mix.inputs['A'])
    nt.links.new(vcol.outputs['Color'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = 1.0
    bsdf.inputs['Metallic'].default_value = 0.0
    if alpha:
        nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
        mat.blend_method = 'CLIP' if hasattr(mat, 'blend_method') else None
        mat.use_backface_culling = False
    else:
        mat.use_backface_culling = True
    return mat


MAT = {'atlas': make_material('MAP_Atlas', META['atlas']),
       'fence': make_material('MAP_ChainLink', META['chainlink']['file'], alpha=True),
       'pave': make_material('MAP_Pavement', META['pavement']['file']),
       'roof': make_material('MAP_Roof', META['roof']['file'])}

objs, report = [], {'groups': {}}
for gname, mats in GROUPS.items():
    verts, faces, uvs, cols, fmat = [], [], [], [], []
    used = [m for m in ('atlas', 'fence', 'pave', 'roof') if mats[m]]
    for mi, m in enumerate(used):
        for pts, fuv, s in mats[m]:
            base = len(verts)
            for p in pts:
                verts.append((p[0], -p[2], p[1]))
            faces.append(list(range(base, base + len(pts))))
            uvs += [(u, 1 - v) for u, v in fuv]
            rgb = (s, s, s) if np.isscalar(s) else tuple(s)
            cols += [tuple(min(1.0, ch) ** 2.2 for ch in rgb) + (1.0,)] * len(pts)
            fmat.append(mi)
    me = bpy.data.meshes.new(gname)
    me.from_pydata(verts, [], faces)
    uvl = me.uv_layers.new(name='UVMap')
    for li, loop in enumerate(me.loops):
        uvl.data[li].uv = uvs[loop.vertex_index]
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    for li, loop in enumerate(me.loops):
        ca.data[li].color = cols[loop.vertex_index]
    for m in used:
        me.materials.append(MAT[m])
    for p, mi in zip(me.polygons, fmat):
        p.material_index = mi
        p.use_smooth = False
    me.validate()
    me.update()
    ob = bpy.data.objects.new(gname, me)
    bpy.context.scene.collection.objects.link(ob)
    objs.append(ob)
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    report['groups'][gname] = tris

report['triangles_total'] = sum(report['groups'].values())
report['colliders'] = COLLIDERS
report['courtyard'] = {'x': [-FX, FX], 'z': [-FZ, FZ], 'chamfer': CHAMFER}
print('TRIS', report['triangles_total'], report['groups'])

os.makedirs(os.path.join(MAP, 'source'), exist_ok=True)
os.makedirs(os.path.join(MAP, 'export'), exist_ok=True)
for img in bpy.data.images:
    img.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(MAP, 'source', 'MAP_Dvor.blend'), compress=True)

for o in bpy.context.view_layer.objects:
    o.select_set(o in objs)
bpy.context.view_layer.objects.active = objs[0]
bpy.ops.export_scene.gltf(
    filepath=os.path.join(MAP, 'export', 'MAP_Dvor.raw.glb'), export_format='GLB', use_selection=True,
    export_yup=True, export_apply=False, export_texcoords=True, export_normals=True, export_tangents=False,
    export_materials='EXPORT', export_image_format='AUTO', export_vertex_color='ACTIVE',
    export_all_vertex_colors=False, export_skins=False, export_animations=False, export_morph=False, export_extras=False,
)
with open(os.path.join(MAP, 'export', 'MAP_Dvor.build.json'), 'w') as f:
    json.dump(report, f, indent=1)
