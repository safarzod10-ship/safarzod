"""python3 -I tand_tex.py -> work/texout/tandoor_*.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import tand_layout as T
OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout')
base_a, orm_a, nrm_a = new_atlas(T.S)
used = np.zeros((T.S, T.S), bool)
def put(name, b, o, n):
    paste(base_a, T.ISL[name], b); paste(orm_a, T.ISL[name], o); paste(nrm_a, T.ISL[name], n)
    x0, y0, w, h, _ = T.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True
CLAY = hexc('a88b6a'); MUD = hexc('8c7155'); SOOT = hexc('1c1814'); STRAW = hexc('c9b07a'); FIRED = hexc('b0714a')

def clay_surface(H, W, px, seed, base=CLAY, cracks=1.0, straw=1.0):
    c = tile(ph('clay_plaster', 'col', px, 2.0), H, W, 0, (seed * 0.13 % 1, seed * 0.29 % 1))
    n = tile(ph('clay_plaster', 'nrm', px, 2.0), H, W, 0, (seed * 0.13 % 1, seed * 0.29 % 1), normal=True)
    a = tile(ph('clay_plaster', 'arm', px, 2.0), H, W, 0, (seed * 0.13 % 1, seed * 0.29 % 1))
    lum = c.mean(2, keepdims=True); lum = lum / lum.mean()
    col = base[None, None, :] * lum ** 1.3 * (0.85 + 0.3 * fbm(H, W, 0.25 / px, 3, seed)[..., None])
    hh = np.zeros((H, W), np.float32)
    if straw:
        rng = np.random.default_rng(seed)
        cv = Canvas(W * px, H * px, px)
        sm = np.zeros((H, W), np.float32)
        for _ in range(int(W * H * px * px * 900 * straw)):
            x, y = rng.random() * cv.w_m, rng.random() * cv.h_m
            a_ = rng.random() * np.pi; L = 0.01 + 0.025 * rng.random()
            stroke(sm, cv, np.array([[x, y], [x + L * np.cos(a_), y + L * np.sin(a_)]]), 0.0012, 1.0, 'round')
        col = col * (1 - 0.6 * sm[..., None]) + STRAW[None, None, :] * 0.6 * sm[..., None]
        hh += 0.0005 * sm
    if cracks:
        e = voronoi_edges(H, W, 0.16 / px, seed + 1) + 1.5 * fbm(H, W, 0.03 / px, 2, seed + 7)
        cm = np.clip(1 - e / 1.2, 0, 1) * np.clip(fbm(H, W, 0.2 / px, 2, seed + 2) * 2 - 0.7, 0, 1) * cracks
        col *= (1 - 0.55 * cm)[..., None]; hh -= 0.002 * cm
    return col, hh, n, a

# ------------------------------------------------------------------ lathe
pts, n_out, n_rim = T.profile()
s = [0.0]
for i in range(1, len(pts)):
    s.append(s[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
x0, y0, W, H, pxv = T.ISL['lathe']
rows_s = (H - (np.arange(H) + 0.5)) * pxv
Zr = np.interp(rows_s, s, [p[1] for p in pts])
Rr = np.interp(rows_s, s, [p[0] for p in pts])
Zg = np.repeat(Zr[:, None], W, 1); Rg = np.repeat(Rr[:, None], W, 1)
U = np.repeat(((np.arange(W) + 0.5) / W)[None, :], H, 0)
col, hh, nn, arm = clay_surface(H, W, pxv, 3, cracks=0.45)
inside = np.repeat((rows_s > s[n_rim - 1])[:, None], W, 1)
rimz = np.repeat(((rows_s > s[n_out - 1]) & (rows_s <= s[n_rim - 1]))[:, None], W, 1)
# soot: interior black, rim and drips down the outside
col = np.where(inside[..., None], SOOT[None, None, :] * (0.7 + 0.6 * fbm(H, W, 30, 3, 21))[..., None] + FIRED * 0.08 * fbm(H, W, 60, 2, 22)[..., None], col)
topz = T.PL_H + 0.94
drip = fbm(H, W, 18, 3, 23, (1, 4))
sooty = np.clip((Zg - (topz - 0.12 - 0.25 * drip)) / 0.12, 0, 1) * (~inside)
col = col * (1 - 0.85 * sooty[..., None]) + SOOT * 0.85 * sooty[..., None]
col = np.where(rimz[..., None], col * 0.5 + SOOT * 0.3, col)
# fired/heat discolouration band near the top (reddish)
heat = np.clip(1 - np.abs(Zg - (topz - 0.25)) / 0.2, 0, 1) * 0.35 * (~inside)
col = col * (1 - heat[..., None]) + FIRED * col.mean(2, keepdims=True) / CLAY.mean() * heat[..., None]
# air hole at the front (u = 0.75 -> -Y direction) near the base
uc = 0.75
du = (U - uc) * 2 * np.pi * Rg; dz = Zg - (T.PL_H + 0.12)
hole = (np.abs(du) / 0.09) ** 2 + (np.maximum(dz, 0) / 0.11) ** 2 + (np.minimum(dz, 0) / 0.05) ** 2
hm = hole < 1
col = np.where(hm[..., None], SOOT * 0.6, col)
ring = (hole > 1) & (hole < 1.7)
col = np.where(ring[..., None], col * 0.6, col)
hh = np.where(hm, -0.03, hh)
hh += np.where(ring, 0.004 * (1 - (hole - 1) / 0.7), 0)
# ground splash dirt
col *= (1 - 0.25 * np.clip(1 - (Zg - T.PL_H) / 0.15, 0, 1) * (~inside))[..., None]
ao = ao_from_height(hh, pxv) * np.where(inside, 0.5, 1.0)
rough = np.where(inside, 0.95, 0.88)
n = blend_normals(normal_from_height(hh, pxv), rgb_to_n(nn), 0.8)
put('lathe', np.clip(col, 0, 1) * ao[..., None] ** 0.5, np.dstack([ao, rough, np.zeros_like(ao)]), n_to_rgb(n))
# ------------------------------------------------------------------ platform
for name, seed in (('plat_top', 5), ('plat_side', 6)):
    x0, y0, W, H, px = T.ISL[name]
    col, hh, nn, arm = clay_surface(H, W, px, seed, MUD, 0.3, 0.6)
    # plaster fallen off in patches: exposed mud bricks
    cv = Canvas(W * px, H * px, px); X, Y = cv.full_xy()
    patch = fbm(H, W, 0.25 / px, 4, seed + 10) > (0.78 if name == "plat_side" else 0.86)
    bw_, bh_ = 0.30, 0.09
    row = np.floor(Y / bh_); xx = (X + (row % 2) * bw_ / 2) % bw_; jy = Y % bh_
    jd = np.minimum.reduce([xx, bw_ - xx, jy, bh_ - jy])
    brick = hexc('9a7a58') * (0.85 + 0.3 * fbm(H, W, 12, 3, seed + 11))[..., None]
    bc = np.where((jd < 0.01)[..., None], MUD * 0.6, brick)
    col = np.where(patch[..., None], bc, col)
    hh = np.where(patch, -0.008 + np.where(jd < 0.01, -0.006, 0), hh)
    edge = ndi.gaussian_filter(patch.astype(np.float32), 2)
    col *= (1 - 0.3 * np.clip(edge * 2 - 0.2, 0, 1) * (~patch))[..., None]
    if name == 'plat_side':
        col *= (1 - 0.3 * np.clip(1 - Y / 0.15, 0, 1))[..., None]
    if name == 'plat_top':   # ash and soot around the tandoor foot
        r = np.hypot(X - cv.w_m / 2, Y - cv.h_m / 2)
        ash = np.clip(1 - (r - 0.52) / 0.15, 0, 1) * (r > 0.45) * fbm(H, W, 20, 3, 31)
        col = col * (1 - 0.5 * ash[..., None]) + hexc('6d6760') * 0.5 * ash[..., None]
    ao = ao_from_height(hh, px)
    n = blend_normals(normal_from_height(hh, px), rgb_to_n(nn), 0.8)
    put(name, np.clip(col * ao[..., None], 0, 1), np.dstack([ao, np.full_like(ao, 0.9), np.zeros_like(ao)]), n_to_rgb(n))
base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'tandoor'), base_a, orm_a, nrm_a)
print('tandoor textures done')
