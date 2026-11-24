"""python3 -I tile_tex.py -> work/texout/tiles_*.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import tile_layout as T
OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout')
base_a, orm_a, nrm_a = new_atlas(T.S)
used = np.zeros((T.S, T.S), bool)
def put(name, b, o, n):
    paste(base_a, T.ISL[name], b); paste(orm_a, T.ISL[name], o); paste(nrm_a, T.ISL[name], n)
    x0, y0, w, h, _ = T.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True
C = dict(cobalt=hexc('1f3f8f'), turq=hexc('2f9fae'), white=hexc('eee9dc'), yellow=hexc('d9a531'),
         green=hexc('3f8a4f'), black=hexc('1d1c22'), manganese=hexc('5a3a4a'))
x0, y0, w, h, px = T.ISL['front']
cv = Canvas(w * px, h * px, px)
X, Y = cv.full_xy()
col = np.zeros((cv.H, cv.W, 3), np.float32) + C['white']
relief = np.zeros((cv.H, cv.W), np.float32)
B = T.TILE
# ---- field: 8-point girih spanning tiles
fx0, fy0, fx1, fy1 = B, B, T.PW - B, T.PH - B
Lc = 0.4
polys, cent = tiling_488(Lc, fx0, fy0, fx1, fy1, ((fx0 + fx1) / 2, (fy0 + fy1) / 2))
segs = dedupe(clip_segs(hankin(polys, 67.5), fx0, fy0, fx1, fy1, 0.05))
segs += [((fx0, fy0), (fx1, fy0)), ((fx1, fy0), (fx1, fy1)), ((fx1, fy1), (fx0, fy1)), ((fx0, fy1), (fx0, fy0))]
fcv = cv
D = dist_to_segments(cv, segs, 0.05)
infield = (X > fx0) & (X < fx1) & (Y > fy0) & (Y < fy1)
hw = 0.009
strap = D < hw
lab, nl = ndi.label(infield & ~strap)
idx = np.arange(1, nl + 1)
area = ndi.sum(np.ones_like(D), lab, idx) * px * px
big = Lc * Lc * 0.25
tab = np.zeros((nl + 1, 3), np.float32)
for k in range(nl):
    a = area[k]
    tab[k + 1] = C['cobalt'] if a > big * 0.5 else (C['turq'] if a > big * 0.16 else (C['yellow'] if a > big * 0.05 else C['green']))
col = np.where(infield[..., None], tab[lab], col)
col[infield & strap] = C['white']
# rosettes in stars
for c in cent:
    if not (fx0 < c[0] < fx1 and fy0 < c[1] < fy1): continue
    d = np.hypot(X - c[0], Y - c[1]); an = np.arctan2(Y - c[1], X - c[0])
    pet = 0.055 * (0.45 + 0.55 * np.abs(np.cos(4 * an)) ** 0.7)
    col[d < pet] = C['white']; col[d < 0.018] = C['yellow']; col[d < 0.007] = C['cobalt']
# ---- border: islimi in white/turquoise on cobalt
inb = ~infield
col[inb] = C['cobalt']
bands = []
for (bx0, bx1, by, horiz) in ((B, T.PW - B, B / 2, True), (B, T.PW - B, T.PH - B / 2, True)):
    t = Canvas(bx1 - bx0, B, px)
    ih = islimi_band(t, 0, t.w_m, B / 2, B * 0.85, 0.4, 1.0, 0.011, 71, 1.35)
    r0 = int(round((cv.h_m - (by + B / 2)) / px)); c0 = int(round(bx0 / px))
    reg = (slice(r0, r0 + ih.shape[0]), slice(c0, c0 + ih.shape[1]))
    m = fit(ih, col[reg].shape) > 0.2
    sub = col[reg]; sub[m] = C['white']; sub[fit(ih, col[reg].shape) > 0.55] = C['turq']
for (bx, ) in ((B / 2,), (T.PW - B / 2,)):
    t = Canvas(T.PH - 2 * B, B, px)
    ih = np.rot90(islimi_band(t, 0, t.w_m, B / 2, B * 0.85, 0.4, 1.0, 0.011, 72, 1.35), 1)
    r0 = int(round(B / px)); c0 = int(round((bx - B / 2) / px))
    reg = (slice(r0, r0 + ih.shape[0]), slice(c0, c0 + ih.shape[1]))
    g = fit(ih, col[reg].shape)
    sub = col[reg]; sub[g > 0.2] = C['white']; sub[g > 0.55] = C['turq']
# corner rosettes
for cx in (B / 2, T.PW - B / 2):
    for cy in (B / 2, T.PH - B / 2):
        d = np.hypot(X - cx, Y - cy); an = np.arctan2(Y - cy, X - cx)
        col[d < 0.085] = C['cobalt']
        col[d < 0.075 * (0.55 + 0.45 * np.abs(np.cos(4 * an)))] = C['white']
        col[d < 0.035 * (0.6 + 0.4 * np.abs(np.cos(4 * an + 0.4)))] = C['turq']
        col[d < 0.012] = C['yellow']
# thin yellow line framing border/field and outer edge
for (a, b) in ((fx0, fy0), ):
    pass
fe = np.minimum.reduce([np.abs(X - fx0), np.abs(X - fx1), np.abs(Y - fy0), np.abs(Y - fy1)])
col[(fe < 0.004) & ((X > fx0 - 0.01) & (X < fx1 + 0.01) & (Y > fy0 - 0.01) & (Y < fy1 + 0.01))] = C['yellow']
oe = np.minimum.reduce([X, T.PW - X, Y, T.PH - Y])
col[(oe > 0.006) & (oe < 0.011)] = C['yellow']
# cuerda seca: dark outline between different colours (slightly sunk)
lum = col @ np.array([0.3, 0.5, 0.2], np.float32)
edge = (np.abs(ndi.sobel(lum, 0)) + np.abs(ndi.sobel(lum, 1))) > 0.08
edge = ndi.binary_dilation(edge, iterations=0) if False else edge
col[edge] = col[edge] * 0.35 + C['manganese'] * 0.65
relief -= edge * 0.00025
# ---- glaze variation per tile + pooling
ti = np.floor(X / B).astype(int); tj = np.floor(Y / B).astype(int)
rng = np.random.default_rng(5)
tv = rng.normal(0, 1, (10, 10, 3)).astype(np.float32)
var = 1 + 0.045 * tv[ti.clip(0, 9), tj.clip(0, 9)]
col = col * var
cloud = fbm(cv.H, cv.W, 40, 4, 6)
col = col * (0.92 + 0.14 * cloud[..., None])
# colour areas slightly raised (thick glaze), pooled darker at area edges
pool = ndi.gaussian_filter(edge.astype(np.float32), 2.0)
col = col * (1 - 0.25 * np.clip(pool * 3, 0, 1))[..., None]
relief += 0.00015 * (1 - np.clip(pool * 4, 0, 1))
# ---- tile joints, bevels, grout
fxm = (X % B) / B; fym = (Y % B) / B
dj = np.minimum.reduce([fxm, 1 - fxm, fym, 1 - fym]) * B          # distance to joint (m)
grout = dj < 0.0025
bevel = np.clip((dj - 0.0025) / 0.004, 0, 1)
relief += -0.003 * (1 - np.sqrt(bevel))
grout_c = hexc('9b9282') * (0.8 + 0.3 * fbm(cv.H, cv.W, 8, 3, 9))[..., None]
# chips at random tile corners / edges: terracotta exposed
chip_n = fbm(cv.H, cv.W, 10, 3, 10)
chips = (dj < 0.012) & (chip_n > 0.78) & ~grout
terr = hexc('b06a45') * (0.85 + 0.3 * fbm(cv.H, cv.W, 4, 3, 11))[..., None]
# crazing
cr = voronoi_edges(cv.H, cv.W, 0.012 / px, 12)
craze = (cr < 0.6) & ~grout & ~chips
craze_s = craze & (fbm(cv.H, cv.W, 60, 2, 13) > 0.45)
col[craze_s] *= 0.93
relief -= craze_s * 0.00005
# glaze waviness
relief += 0.0007 * (fbm(cv.H, cv.W, 35, 3, 14) - 0.5)
col = np.where(grout[..., None], grout_c, col)
col = np.where(chips[..., None], terr, col)
relief = np.where(grout, -0.0035, relief)
relief = np.where(chips, np.minimum(relief, -0.0015), relief)
# grime: lower part and grout dirt
grime = np.clip(1 - Y / 0.5, 0, 1) * 0.25 * fbm(cv.H, cv.W, 30, 3, 15)
col *= (1 - grime)[..., None]
ao = ao_from_height(relief * 3, px, (0.003, 0.01))
rough = np.where(grout, 0.92, np.where(chips, 0.85, 0.16 + 0.1 * cloud + 0.2 * grime))
rough = np.where(craze_s, rough + 0.15, rough)
n = n_to_rgb(normal_from_height(relief, px))
put('front', np.clip(col * (0.6 + 0.4 * ao[..., None]), 0, 1), np.dstack([ao, np.clip(rough, 0, 1), np.zeros_like(ao)]), n)
# ---- brick surround (terracotta, small bricks with lime joints)
x0, y0, w, h, px = T.ISL['brick']
cv = Canvas(w * px, h * px, px)
X, Y = cv.full_xy()
bw_, bh_ = 0.25, 0.06
row = np.floor(Y / bh_)
xx = (X + (row % 2) * bw_ / 2) % bw_
jy = (Y % bh_); jd = np.minimum.reduce([xx, bw_ - xx, jy, bh_ - jy])
joint = jd < 0.006
idb = (np.floor((X + (row % 2) * bw_ / 2) / bw_) * 31 + row * 17).astype(int) % 97
bv = np.random.default_rng(3).normal(0, 1, 97)[idb]
c = tile(ph('clay_plaster', 'col', px, 2.0), h, w)
lumc = c.mean(2, keepdims=True) / c.mean()
bcol = hexc('a8613f')[None, None, :] * (1 + 0.08 * bv[..., None]) * lumc
bcol = np.where(joint[..., None], hexc('bdb3a0')[None, None, :] * lumc, bcol)
hb = np.where(joint, -0.004, 0.0) + 0.0008 * (fbm(h, w, 10, 3, 4) - 0.5)
ao = ao_from_height(hb, px)
put('brick', bcol * ao[..., None], np.dstack([ao, np.full((h, w), 0.85), np.zeros((h, w))]), n_to_rgb(normal_from_height(hb, px)))
base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'tiles'), base_a, orm_a, nrm_a)
Image.fromarray((lin_to_srgb(base_a) * 255).astype(np.uint8)).save(os.path.join(os.path.dirname(HERE), 'work', 'tiles_view.jpg'))
print('tile textures done')
