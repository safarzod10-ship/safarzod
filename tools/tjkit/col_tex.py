"""Column atlas: python3 -I col_tex.py -> work/texout/column_*.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import col_layout as C

OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout'); os.makedirs(OUT, exist_ok=True)
S = C.S
base_a, orm_a, nrm_a = new_atlas(S)
used = np.zeros((S, S), bool)
def put(name, b, o, n):
    paste(base_a, C.ISL[name], b); paste(orm_a, C.ISL[name], o); paste(nrm_a, C.ISL[name], n)
    x0, y0, w, h, _ = C.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True

# ------------------------------------------------------------------ lathe (kuza + shaft)
pts, cap_z0 = C.profile(3.10)
sdev = C.developed(pts)
x0, y0, W, H, pxv = C.ISL['lathe']
rows_s = (H - (np.arange(H) + 0.5)) * pxv            # developed s per image row (row 0 = top)
r_s = np.interp(rows_s, sdev, [p[0] for p in pts])
z_s = np.interp(rows_s, sdev, [p[1] for p in pts])
u = (np.arange(W) + 0.5) / W
TH, Z = np.meshgrid(u * 2 * np.pi, z_s)
R = np.repeat(r_s[:, None], W, 1)
h = np.zeros((H, W), np.float32)
b = C.BASE_H
ss = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
# gadroon lobes on the bulb, ending in pointed petals near the neck
nl = 16
ph_ = (TH * nl / (2 * np.pi)) % 1.0 - 0.5            # -0.5..0.5 within a lobe
zt = (Z - (b + 0.04)) / (0.30)                        # 0 at foot, 1 at petal tips
halfw = 0.5 * np.clip(1 - ss(0.62, 1.0, zt) * 0.98, 0.02, 1)
lob = np.clip(1 - (np.abs(ph_) / halfw) ** 2, 0, 1) ** 0.5
inband = (zt > 0) & (zt < 1.0)
h += np.where(inband, (lob - 1) * 0.007 * ss(0, 0.08, zt), 0)
# small leaf crown above the petals
zc = (Z - (b + 0.34)) / 0.05
ph2 = ((TH * nl / (2 * np.pi)) + 0.5) % 1.0 - 0.5
leaf = np.clip(1 - np.abs(ph2) / (0.42 * np.clip(1 - zc, 0, 1) + 1e-3), 0, 1) ** 0.6
h += np.where((zc > 0) & (zc < 1), (leaf - 1) * 0.004, 0)
# rope rings (foot torus and neck ring)
rope = np.sin(TH * 18 + Z / 0.012)
for z0r, z1r in ((b, b + 0.03), (b + 0.405, b + 0.44), (pts[-3][1] - 0.035, pts[-3][1])):
    m = (Z >= z0r) & (Z <= z1r)
    h += np.where(m, -0.002 * np.clip(-rope, 0, 1) ** 0.5, 0)
# carved band low on the shaft: 8-point girih chain, 5 stars around
Cc = 2 * np.pi * 0.111
bz0, bz1 = b + 0.47, b + 0.47 + 0.26
cv = Canvas(Cc, bz1 - bz0, pxv)
Lc = Cc / 5
polys, cent = tiling_488(Lc, -0.1, -0.1, Cc + 0.1, bz1 - bz0 + 0.1, (Lc / 2, (bz1 - bz0) / 2))
segs = dedupe(hankin(polys, 67.5)) + [((-1, 0.008), (Cc + 1, 0.008)), ((-1, bz1 - bz0 - 0.008), (Cc + 1, bz1 - bz0 - 0.008))]
gh, _ = girih_relief(cv, segs, 0.0045, 0.008, cent, Lc * 0.18)
gh = ndi.zoom(gh, (1, W / gh.shape[1]), order=1)
r0 = int(round((H - (np.interp(bz1, [p[1] for p in pts], sdev)) / pxv)))
r1 = r0 + gh.shape[0]
h[r0:r1] = np.minimum(h[r0:r1], fit(gh, h[r0:r1].shape))
# islimi band near the top of the shaft (3 waves around)
tz1 = pts[-5][1] - 0.02; tz0 = tz1 - 0.17
cv = Canvas(Cc, tz1 - tz0, pxv)
ih = islimi_band(cv, 0, Cc, (tz1 - tz0) / 2, (tz1 - tz0) * 0.9, Cc / 3, 0.006, 0.005, 41)
ih = ih - 0.006
for yy in (0.006, tz1 - tz0 - 0.006):
    stroke(ih, cv, np.array([[-0.1, yy], [Cc + 0.1, yy]]), 0.005, 0.0, 'round')
ih = ndi.zoom(ih, (1, W / ih.shape[1]), order=1)
r0 = int(round((H - (np.interp(tz1, [p[1] for p in pts], sdev)) / pxv)))
h[r0:r0 + ih.shape[0]] = fit(ih, h[r0:r0 + ih.shape[0]].shape)
# anisotropic px: horizontal metres per px differ; approximate with vertical px (r~0.11)
Zrow = Z
bleach = 0.12 * fbm(H, W, 80, 3, 3)
bb, oo, nn = wood_finish(h, pxv, None, True, seed=11, streaks=0.35, bleach=bleach)
splash = np.clip(1 - (Zrow - b) / 0.5, 0, 1)
bb *= (1 - 0.3 * splash)[..., None]
put('lathe', bb, oo, nn)

# ------------------------------------------------------------------ capital (developed rows per ring)
x0, y0, W, H, px = C.ISL['capital']
cv = Canvas(W * px, H * px, px)
X, Y = cv.full_xy()
rings = C.cap_rings(cap_z0)
# v of each ring = cumulative distance at point vertices
vs = [0.0]
for i in range(1, len(rings)):
    rp0, rp1 = rings[i - 1][0], rings[i][0]
    vs.append(vs[-1] + math.hypot(rp1 - rp0, rings[i][2] - rings[i - 1][2]))
hg = np.zeros_like(cv.h)
for i in range(len(rings) - 1):
    va, vb = vs[i], vs[i + 1]
    m = (Y >= va) & (Y < vb)
    t = (Y - va) / max(vb - va, 1e-6)
    vertical = abs(rings[i][0] - rings[i + 1][0]) < 1e-6
    if vertical:
        # pointed-arch niche cell on every facet (reads as muqarnas cells)
        fw = cv.w_m / C.NSEG
        xl = ((X % fw) / fw - 0.5) * 2            # -1..1 across facet
        yl = np.clip((Y - va) / (vb - va), 0, 1)
        top = 0.45 + 0.5 * np.sqrt(np.clip(1 - (np.abs(xl) / 0.8) ** 2, 0, 1)) - 0.12 * np.abs(xl)
        inside = (np.abs(xl) < 0.78) & (yl > 0.06) & (yl < top)
        edge = np.minimum.reduce([0.78 - np.abs(xl), yl - 0.06, top - yl])
        dn = -0.012 * np.clip(edge / 0.12, 0, 1) ** 0.6
        cv.h[m] = np.where(inside[m], dn[m], cv.h[m])
        hg[m] = np.where(inside[m], -0.02 * (yl[m]), 0)
    else:
        hg[m] = -0.03 * (t[m])        # niche: darker towards the top of the corbel slope
b2, o2, n2 = wood_finish(cv.h, px, hg, True, seed=12, ao_k=1.6)
put('capital', b2, o2, n2)

# ------------------------------------------------------------------ abacus + bolish sides
for name, seed in (('abacus', 13), ('bolish', 14)):
    x0, y0, W, H, px = C.ISL[name]
    cv = Canvas(W * px, H * px, px)
    X, Y = cv.full_xy()
    if name == 'abacus':
        tt = Canvas(cv.w_m, 0.05, px)
        ch = chip_band(tt, 0, tt.w_m, 0, tt.h_m, 0.005)
        r0 = int(round((cv.h_m - 0.085) / px)); cv.h[r0:r0 + ch.shape[0]] = fit(ch, cv.h[r0:r0 + ch.shape[0]].shape)
        stroke(cv.h, cv, np.array([[0, 0.025], [cv.w_m, 0.025]]), 0.004, 0.003, 'vee', op='min')
    else:
        orn = islimi_band(cv, 0.0, cv.w_m, cv.h_m / 2 + 0.01, cv.h_m * 0.72, 0.2, 0.007, 0.0045, 51, 0.9)
        cv.h = orn - 0.007 * (Y > 0.0)
        cv.h = np.where((Y > 0.012) & (Y < cv.h_m - 0.012), cv.h, 0.0)
    b3, o3, n3 = wood_finish(cv.h, px, None, False, seed=seed)
    put(name, b3, o3, n3)

# ------------------------------------------------------------------ stone (grey limestone-ish)
x0, y0, W, H, px = C.ISL['stone']
src = tile(ph('old_sandstone_02', 'col', px, 4.0), H, W, 0, (0.31, 0.05))
lum = src.mean(2, keepdims=True)
stone = hexc('8d877c')[None, None, :] * (lum / lum.mean()) ** 1.2
sn = tile(ph('old_sandstone_02', 'nrm', px, 4.0), H, W, 0, (0.31, 0.05), normal=True)
sa = tile(ph('old_sandstone_02', 'arm', px, 4.0), H, W, 0, (0.31, 0.05))
dirt = fbm(H, W, 40, 4, 99)
stone *= (0.8 + 0.3 * dirt[..., None])
o4 = np.dstack([sa[..., 0], np.clip(sa[..., 1] * 0.3 + 0.62, 0, 1), np.zeros((H, W))])
put('stone', stone * sa[..., :1] ** 0.5, o4, sn)

for name, seed in (('plain', 15), ('plain2', 16)):
    x0, y0, W, H, px = C.ISL[name]
    cv = Canvas(W * px, H * px, px)
    b5, o5, n5 = wood_finish(cv.h, px, None, True, seed=seed, streaks=0.3)
    put(name, b5, o5, n5)

base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'column'), base_a, orm_a, nrm_a)
s = Image.new('RGB', (2048, 1024))
s.paste(Image.open(os.path.join(OUT, 'column_base.jpg')), (0, 0)); s.paste(Image.open(os.path.join(OUT, 'column_nrm.jpg')), (1024, 0))
s.save(os.path.join(os.path.dirname(HERE), 'work', 'column_atlas_view.jpg'))
print('column textures done')
