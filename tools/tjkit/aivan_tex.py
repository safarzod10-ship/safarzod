"""Aivan 2048 atlas: column atlas quadrant + painted ceiling (generated ornament, faded, cracked).
python3 -I aivan_tex.py -> work/texout/aivan_*.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import aivan_layout as L

OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout')
S = L.S
base_a, orm_a, nrm_a = new_atlas(S)
used = np.zeros((S, S), bool)
def put(name, b, o, n):
    paste(base_a, L.ISL[name], b); paste(orm_a, L.ISL[name], o); paste(nrm_a, L.ISL[name], n)
    x0, y0, w, h, _ = L.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True

# column quadrant (reuse column atlas at 1:1)
for arr, f, srgb in ((base_a, 'column_base.jpg', True), (orm_a, 'column_orm.jpg', False), (nrm_a, 'column_nrm.jpg', False)):
    a = np.asarray(Image.open(os.path.join(OUT, f)).convert('RGB')).astype(np.float32) / 255
    arr[0:1024, 0:1024] = srgb_to_lin(a) if srgb else a
used[0:1024, 0:1024] = True

# palette (traditional mineral paints), linear
P = dict(red=hexc('a8382a'), blue=hexc('2d4f8e'), green=hexc('3f7a52'), ochre=hexc('c89a3c'),
         cream=hexc('e6d9bd'), black=hexc('2a2420'), turq=hexc('3f8f93'), brown=hexc('6b4a33'))
FADE = hexc('cfc4ad')

def paint_finish(col, px, seed, wear=1.0, front_w=None, ao=None, wood_vertical=True):
    """Faded, crackled, flaking distemper paint over wood."""
    H, W = col.shape[:2]
    rng_f = fbm(H, W, 0.15 / px, 3, seed)
    col = col * (1 - (0.22 + 0.15 * rng_f)[..., None]) + FADE[None, None, :] * (0.22 + 0.15 * rng_f)[..., None]
    # craquelure
    e = voronoi_edges(H, W, max(6, 0.018 / px), seed + 1)
    crack = np.clip(1 - e / 0.9, 0, 1) * np.clip(fbm(H, W, 0.1 / px, 2, seed + 2) * 1.8 - 0.5, 0, 1)
    # flaking
    fl = fbm(H, W, 0.03 / px, 4, seed + 3)
    thr = 0.88 - 0.08 * wear - (0.12 * front_w if front_w is not None else 0)
    flake = np.clip((fl - thr) / 0.02, 0, 1)
    wood, wo, wn = wood_finish(np.zeros((H, W), np.float32), px, None, wood_vertical, seed=seed + 4, dust=0, grime=0)
    dirt = fbm(H, W, 0.3 / px, 3, seed + 5)
    col = col * (0.85 + 0.2 * dirt[..., None])
    col = col * (1 - 0.6 * crack[..., None])
    out = col * (1 - flake[..., None]) + wood * flake[..., None]
    hpaint = 0.0004 * (1 - flake) - 0.0002 * crack
    n = normal_from_height(hpaint, px)
    n = blend_normals(n, rgb_to_n(wn), 0.25)
    rough = 0.78 + 0.08 * dirt - 0.05 * (1 - flake)
    aoc = np.ones((H, W), np.float32) if ao is None else ao
    out = out * (0.5 + 0.5 * aoc[..., None])
    orm = np.dstack([aoc, np.clip(rough, 0, 1), np.zeros((H, W))])
    return np.clip(out, 0, 1), orm, n_to_rgb(n)

def girih_paint(cv, segs, hw, colorer, outline=P['black'], strap=P['cream']):
    D = dist_to_segments(cv, segs, hw * 6)
    smask = D < hw
    lab, nl = ndi.label(~smask)
    idx = np.arange(1, nl + 1)
    area = ndi.sum(np.ones_like(D), lab, idx)
    cy, cx = np.array(ndi.center_of_mass(np.ones_like(D), lab, idx)).T if nl else ([], [])
    col = np.zeros((cv.H, cv.W, 3), np.float32)
    table = np.zeros((nl + 1, 3), np.float32)
    for k in range(nl):
        table[k + 1] = colorer(area[k] * cv.px * cv.px, cx[k] * cv.px, cv.h_m - cy[k] * cv.px)
    col = table[lab]
    col[smask] = strap
    ol = np.abs(D - hw) < cv.px * 0.9
    col[ol] = outline
    return col, D

def rosettes(col, cv, centres, r, c_out, c_in):
    X, Y = cv.full_xy()
    for c in centres:
        d = np.hypot(X - c[0], Y - c[1]); a = np.arctan2(Y - c[1], X - c[0])
        pet = r * (0.6 + 0.4 * np.abs(np.cos(4 * a)))
        col[d < pet] = c_out
        col[d < r * 0.3] = c_in

# ------------------------------------------------------------------ ceiling bays (4 colourways)
schemes = [('ochre', 'blue', 'green', 'red'), ('blue', 'red', 'ochre', 'green'),
           ('red', 'green', 'blue', 'ochre'), ('green', 'ochre', 'red', 'blue')]
for b in range(4):
    name = f'bay{b}'
    x0, y0, w, h, px = L.ISL[name]
    cv = Canvas(w * px, h * px, px)
    star, cross, small, rim = schemes[b]
    Lc = cv.w_m * 0.92
    polys, cent = tiling_488(Lc, -0.2, -0.2, cv.w_m + 0.2, cv.h_m + 0.2, (cv.w_m / 2, 0.15))
    segs = dedupe(clip_segs(hankin(polys, 67.5), 0, 0, cv.w_m, cv.h_m, 0.05))
    big = Lc * Lc * 0.25
    def colorer(area, x, y, star=star, cross=cross, small=small):
        if area > big * 0.55: return P[star]
        if area > big * 0.18: return P[cross]
        if area > big * 0.05: return P[small]
        return P['cream']
    col, D = girih_paint(cv, segs, 0.004, colorer)
    rosettes(col, cv, cent, Lc * 0.12, P['red'] if star != 'red' else P['blue'], P['cream'])
    X, Y = cv.full_xy()
    # border lines along both long edges (hidden partly by joists)
    edge = np.minimum(X, cv.w_m - X)
    col[edge < 0.052] = P[rim]
    col[(edge > 0.046) & (edge < 0.052)] = P['black']
    ao = np.clip(0.45 + 0.55 * np.clip((edge - 0.045) / 0.06, 0, 1), 0, 1)
    frontw = np.clip(1 - Y / 0.5, 0, 1)          # island bottom = front of veranda (weathered)
    bb, oo, nn = paint_finish(col, px, 100 + b, 1.0, frontw, ao)
    put(name, bb, oo, nn)

# ------------------------------------------------------------------ joists (developed octagon)
for j in range(2):
    name = f'joist{j}'
    x0, y0, w, h, px = L.ISL[name]
    cv = Canvas(w * px, h * px, px)
    X, Y = cv.full_xy()
    Cc = cv.w_m
    if j == 0:   # barber-pole twisted ribbon
        t = (X / Cc + Y / 0.16) % 1.0
        col = np.where((t < 0.28)[..., None], P['red'], np.where((t < 0.5)[..., None], P['cream'], np.where((t < 0.78)[..., None], P['blue'], P['cream'])))
        line = (np.abs(t - 0.28) < 0.012) | (np.abs(t - 0.5) < 0.012) | (np.abs(t - 0.78) < 0.012) | (t < 0.012)
        col[line] = P['black']
    else:        # chevrons with rings
        t = (Y / 0.12 + np.abs(X / Cc - 0.5) * 1.2) % 1.0
        col = np.where((t < 0.5)[..., None], P['green'], P['ochre'])
        col[np.abs(t - 0.5) < 0.03] = P['black']
    ring = (Y % 0.6) < 0.05
    col[ring] = P['red'] if j else P['ochre']
    col[ring & ((Y % 0.6) < 0.008)] = P['black']
    bb, oo, nn = paint_finish(col.astype(np.float32), px, 200 + j, 0.8, np.clip(1 - Y / 0.35, 0, 1))
    put(name, bb, oo, nn)

# ------------------------------------------------------------------ end grain
x0, y0, w, h, px = L.ISL['endgrain']
cv = Canvas(w * px, h * px, px)
X, Y = cv.full_xy()
r = np.hypot(X - 0.064, Y - 0.064)
rings = 0.5 + 0.5 * np.sin(r / 0.0035 * 2 * np.pi + 3 * fbm(h, w, 30, 3, 7))
col = hexc('7a5a3e')[None, None, :] * (0.75 + 0.3 * rings[..., None])
col *= (1 - 0.5 * np.clip((r - 0.045) / 0.01, 0, 1))[..., None] * 0.9 + 0.1
cr = np.abs(np.arctan2(Y - 0.064, X - 0.064) - 0.7) < 0.03
col[cr & (r < 0.045)] *= 0.35
hh = 0.0003 * rings
put('endgrain', col, np.dstack([np.ones((h, w)), np.full((h, w), 0.8), np.zeros((h, w))]), n_to_rgb(normal_from_height(hh, px)))

# ------------------------------------------------------------------ roof top (earth plaster)
x0, y0, w, h, px = L.ISL['roof']
c = tile(ph('clay_plaster', 'col', px, 2.0), h, w)
n = tile(ph('clay_plaster', 'nrm', px, 2.0), h, w, normal=True)
a = tile(ph('clay_plaster', 'arm', px, 2.0), h, w)
c = c * hexc('b0a088')[None, None, :] / (c.mean((0, 1), keepdims=True) + 1e-6) * 0.9
put('roof', c, np.dstack([a[..., 0], np.clip(a[..., 1] + 0.1, 0, 1), np.zeros((h, w))]), n)

# ------------------------------------------------------------------ beam front: cartouches with islimi
x0, y0, w, h, px = L.ISL['beam_front']
cv = Canvas(w * px, h * px, px)          # x = 0 at beam end, x = 3.0 at centre (mirror)
X, Y = cv.full_xy()
col = np.zeros((cv.H, cv.W, 3), np.float32) + P['red']
period = 0.75
ph_ = (X % period) - period / 2
yc = cv.h_m / 2
a_, b_ = period * 0.36, cv.h_m * 0.36
ang = np.arctan2((Y - yc) / b_, ph_ / a_)
rr = (np.abs(ph_ / a_) ** 2.6 + np.abs((Y - yc) / b_) ** 2.6) ** (1 / 2.6)
lobe = 1 + 0.06 * np.cos(10 * ang)
cart = rr < lobe
col[cart] = P['cream']
col[np.abs(rr - lobe) < 0.04] = P['black']
isl = islimi_band(cv, 0, cv.w_m, yc, b_ * 1.75, period / 2, 1.0, 0.0065, 61, 1.15)
col[cart & (isl > 0.05)] = P['black']
col[cart & (isl > 0.35)] = P['blue']
col[cart & (isl > 0.35) & (isl < 0.6)] = P['green']
# blue separators with white star
sep = np.abs(ph_) > period * 0.44
col[np.abs(np.abs(ph_) - period * 0.44) < 0.004] = P['black']
d = np.abs(np.abs(ph_) - period / 2)
col[sep] = P['blue']
ang2 = np.arctan2(Y - yc, d * np.sign(ph_)); r2 = np.hypot(d, Y - yc)
st = r2 < 0.028 * (0.55 + 0.45 * np.abs(np.cos(4 * ang2)) ** 3)
col[sep & st] = P['cream']
for yy in (0.012, cv.h_m - 0.012):
    col[np.abs(Y - yy) < 0.006] = P['ochre']
    col[np.abs(Y - yy) < 0.0015] = P['black']
bb, oo, nn = paint_finish(col, px, 300, 0.8, None, None, False)
put('beam_front', bb, oo, nn)

# ------------------------------------------------------------------ beam bottom: girih chain
x0, y0, w, h, px = L.ISL['beam_bottom']
cv = Canvas(w * px, h * px, px)
Lc = cv.h_m * 0.9
polys, cent = tiling_488(Lc, -0.3, -0.3, cv.w_m + 0.3, cv.h_m + 0.3, (Lc / 2, cv.h_m / 2))
segs = dedupe(clip_segs(hankin(polys, 67.5), 0, 0, cv.w_m, cv.h_m, 0.05))
big = Lc * Lc * 0.25
col, D = girih_paint(cv, segs, 0.004, lambda a, x, y: P['ochre'] if a > big * 0.55 else (P['green'] if a > big * 0.18 else P['red']))
rosettes(col, cv, cent, Lc * 0.12, P['red'], P['cream'])
bb, oo, nn = paint_finish(col, px, 301, 0.9, None, None, False)
put('beam_bottom', bb, oo, nn)

# ------------------------------------------------------------------ fascia (roof edge): stepped merlon band
x0, y0, w, h, px = L.ISL['fascia']
cv = Canvas(w * px, h * px, px)
X, Y = cv.full_xy()
col = np.zeros((cv.H, cv.W, 3), np.float32) + P['cream']
t = (X % 0.12) / 0.12
tri = Y < (0.11 * (1 - np.abs(t - 0.5) * 2) + 0.02)
col[tri] = P['blue']
col[tri & (Y < 0.05 * (1 - np.abs(t - 0.5) * 2) + 0.02)] = P['turq']
col[Y < 0.02] = P['red']
col[Y > cv.h_m - 0.025] = P['red']
bb, oo, nn = paint_finish(col, px, 302, 1.3, np.clip(Y / cv.h_m, 0, 1) * 0.5, None, False)
put('fascia', bb, oo, nn)

# ------------------------------------------------------------------ plain wood
x0, y0, w, h, px = L.ISL['plain']
cv = Canvas(w * px, h * px, px)
bb, oo, nn = wood_finish(cv.h, px, None, True, seed=303, streaks=0.3)
put('plain', bb, oo, nn)

base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'aivan'), base_a, orm_a, nrm_a)
Image.fromarray((lin_to_srgb(base_a) * 255).astype(np.uint8)).resize((1024, 1024)).save(os.path.join(os.path.dirname(HERE), 'work', 'aivan_atlas_view.jpg'))
print('aivan textures done')
