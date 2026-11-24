"""Door texture atlas: python3 -I door_tex.py  -> work/texout/door_{base,orm,nrm}.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import door_layout as L

OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout'); os.makedirs(OUT, exist_ok=True)
S = L.S
base_a, orm_a, nrm_a = new_atlas(S)
used = np.zeros((S, S), bool)

def put(name, b, o, n):
    paste(base_a, L.ISL[name], b); paste(orm_a, L.ISL[name], o); paste(nrm_a, L.ISL[name], n)
    x0, y0, w, h, _ = L.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True

def rect_segs(x0, y0, x1, y1):
    return [((x0, y0), (x1, y0)), ((x1, y0), (x1, y1)), ((x1, y1), (x0, y1)), ((x0, y1), (x0, y0))]

def sub(cv, x0, y0, x1, y1):
    """Return slices for metric rect in canvas."""
    c0 = int(round(x0 / cv.px)); c1 = int(round(x1 / cv.px))
    r0 = int(round((cv.h_m - y1) / cv.px)); r1 = int(round((cv.h_m - y0) / cv.px))
    return slice(max(r0, 0), min(r1, cv.H)), slice(max(c0, 0), min(c1, cv.W))

def islimi_vertical(cv, x0, x1, y0, y1, amp, seed):
    """Vertical islimi in rect: generated horizontally then rotated."""
    w = x1 - x0; h = y1 - y0
    t = Canvas(h, w, cv.px)
    hh = islimi_band(t, 0, t.w_m, t.h_m / 2, t.h_m * 0.92, t.h_m * 1.9, amp, t.h_m * 0.055, seed)
    hh = np.rot90(hh, 1)
    sl = sub(cv, x0, y0, x1, y1)
    tgt = cv.h[sl]
    hh = fit(hh, tgt.shape)
    return sl, hh

def channel(cv, x0, y0, x1, y1, depth, orn, bead=0.0035):
    """Sunk channel with raised ornament orn (0..depth, relative) and bead mouldings."""
    sl = sub(cv, x0, y0, x1, y1)
    reg = cv.h[sl]
    o = np.zeros_like(reg); o[:] = fit(orn, reg.shape)
    cv.h[sl] = np.minimum(reg, -depth + o)
    rim = np.zeros_like(cv.h)
    for a, b in rect_segs(x0 + bead, y0 + bead, x1 - bead, y1 - bead):
        stroke(rim, cv, np.array([a, b]), bead, depth * 0.6, 'round')
    cv.h = np.where(rim > 0, np.maximum(cv.h, rim - depth), cv.h)

def girih_panel(cv, x0, y0, x1, y1, kind, depth=0.012):
    w, h = x1 - x0, y1 - y0
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    if kind == '8':
        Lc = w / 2
        polys, cent = tiling_488(Lc, x0, y0, x1, y1, (cx, cy))
        segs = hankin(polys, 67.5); shw = 0.0055; ros = Lc * 0.2; pet = 8
    elif kind == '12':
        s = 0.052
        polys, cent = tiling_4612(s, x0, y0, x1, y1, (cx, cy))
        segs = hankin(polys, 64); shw = 0.0045; ros = s * 0.7; pet = 12
    else:
        s = 0.036
        polys, cent = tiling_4612(s, x0, y0, x1, y1, (cx, cy))
        segs = hankin(polys, 70); shw = 0.004; ros = s * 0.55; pet = 12
    m = 0.007
    segs = dedupe(clip_segs(segs, x0, y0, x1, y1, 0.02)) + rect_segs(x0 + m, y0 + m, x1 - m, y1 - m)
    cent = [c for c in cent if x0 + ros < c[0] < x1 - ros and y0 + ros < c[1] < y1 - ros]
    sl = sub(cv, x0, y0, x1, y1)
    t = Canvas(x1 - x0, y1 - y0, cv.px)
    segs_l = [((a[0] - x0, a[1] - y0), (b[0] - x0, b[1] - y0)) for a, b in segs]
    cen_l = [(c[0] - x0, c[1] - y0) for c in cent]
    hh, _ = girih_relief(t, segs_l, shw, depth, cen_l, ros, petals=pet)
    reg = cv.h[sl]
    cv.h[sl] = fit(hh, reg.shape)

# ------------------------------------------------------------------ leaf front
px = L.PX_LEAF
cv = Canvas(L.LEAF_W, L.LEAF_H, px)
hg = np.zeros_like(cv.h)
X, Y = cv.full_xy()
for z0, z1, tag in L.leaf_rows():
    if tag is None:
        # rail ornament
        if z1 - z0 > 0.1:
            sl = sub(cv, L.STILE + 0.012, z0 + 0.014, L.LEAF_W - L.STILE - 0.012, z1 - 0.014)
            t = Canvas(L.LEAF_W - 2 * L.STILE - 0.024, z1 - z0 - 0.028, px)
            orn = islimi_band(t, 0, t.w_m, t.h_m / 2, t.h_m * 0.95, t.h_m * 2.0, 0.006, t.h_m * 0.05, 3)
            channel(cv, L.STILE + 0.012, z0 + 0.014, L.LEAF_W - L.STILE - 0.012, z1 - 0.014, 0.006, orn)
        else:
            x0, x1 = L.STILE + 0.012, L.LEAF_W - L.STILE - 0.012
            t = Canvas(x1 - x0, z1 - z0 - 0.026, px)
            ch = chip_band(t, 0, t.w_m, 0, t.h_m, 0.006)
            channel(cv, x0, z0 + 0.013, x1, z1 - 0.013, 0.0, ch + 0.0, bead=0.003)
        continue
    # panel: geometry recess (AO only) + carving on the panel floor
    px0, px1 = L.STILE, L.LEAF_W - L.STILE
    ins = L.PANEL_INSET
    inner = (X > px0 + ins) & (X < px1 - ins) & (Y > z0 + ins) & (Y < z1 - ins)
    dx = np.minimum(X - px0, px1 - X); dy = np.minimum(Y - z0, z1 - Y)
    dd = np.minimum(dx, dy)
    band = (X > px0) & (X < px1) & (Y > z0) & (Y < z1)
    hg[band] = -L.PANEL_DEPTH * np.clip(dd[band] / ins, 0, 1)
    # bead on the chamfer moulding
    bead = np.exp(-((dd - ins * 0.5) / (ins * 0.2)) ** 2) * 0.003
    cv.h[band & ~inner] += bead[band & ~inner]
    girih_panel(cv, px0 + ins, z0 + ins, px1 - ins, z1 - ins, {'main': '8', 'top': '12', 'bot': '12s'}[tag])
# stiles: islimi channels
for sx0 in (0.0, L.LEAF_W - L.STILE):
    sl, orn = islimi_vertical(cv, sx0 + 0.013, sx0 + L.STILE - 0.013, 0.03, L.LEAF_H - 0.03, 0.0065, 11 if sx0 == 0 else 12)
    channel(cv, sx0 + 0.013, 0.03, sx0 + L.STILE - 0.013, L.LEAF_H - 0.03, 0.0065, orn)
# weathering: bottom splash darkening and sun bleach on upper half
bleach = np.clip((Y - 0.9) / 1.4, 0, 1) * 0.18 * fbm(cv.H, cv.W, 60, 3, 5)
b, o, n = wood_finish(cv.h, px, hg, True, seed=1, streaks=0.25, bleach=bleach)
splash = np.clip(1 - Y / 0.35, 0, 1) * (0.6 + 0.4 * fbm(cv.H, cv.W, 20, 3, 9))
b *= (1 - 0.35 * splash)[..., None]
put('leaf_front', b, o, n)

# ------------------------------------------------------------------ leaf back
cv = Canvas(L.LEAF_W, L.LEAF_H, px)
X, Y = cv.full_xy()
for k in range(1, 3):
    x = L.LEAF_W * k / 3
    stroke(cv.h, cv, np.array([[x, 0], [x, L.LEAF_H]]), 0.004, 0.004, 'vee', op='min')
hg = np.zeros_like(cv.h)
for zc in (0.35, 1.2, 1.95):
    m = (np.abs(Y - zc) < 0.05)
    cv.h[m] += 0.004
    hg[m] += 0.02
    for xn in np.linspace(0.06, L.LEAF_W - 0.06, 4):
        for dz in (-0.025, 0.025):
            stroke(cv.h, cv, np.array([[xn, zc + dz], [xn + 1e-4, zc + dz]]), 0.007, 0.006, 'round')
b, o, n = wood_finish(cv.h, px, hg, True, seed=2, wear=0.5, dust=0.2)
put('leaf_back', b, o, n)

# ------------------------------------------------------------------ frieze (half; x=OW is centre)
cv = Canvas(L.OW, L.FRIEZE_H, px)
X, Y = cv.full_xy()
cv.h[:] = -0.010
m = 0.016
for a, bb in rect_segs(m, m, L.OW + 0.05, L.FRIEZE_H - m):
    stroke(cv.h, cv, np.array([a, bb]), 0.006, 0.0, 'flat')
cx, cy = L.OW, L.FRIEZE_H / 2
R = L.FRIEZE_H / 2 - m - 0.012
# medallion: 12-point girih clipped to circle
t = Canvas(L.OW, L.FRIEZE_H, px)
polys, cent = tiling_4612(0.05, 0, 0, L.OW, L.FRIEZE_H, (cx, cy))
segs = dedupe(clip_segs(hankin(polys, 64), cx - R - 0.02, 0, L.OW + 0.02, L.FRIEZE_H, 0.02))
hh, _ = girih_relief(t, segs, 0.0042, 0.010, [(cx, cy)], 0.035, petals=12)
r = np.hypot(X - cx, Y - cy)
cv.h = np.where(r < R, hh, cv.h)
stroke(cv.h, cv, np.stack([cx + (R + 0.004) * np.cos(np.linspace(0, 2 * np.pi, 90)), cy + (R + 0.004) * np.sin(np.linspace(0, 2 * np.pi, 90))], 1), 0.006, 0.0, 'flat')
cv.h = np.maximum(cv.h, -0.010)  # keep
# islimi to the side of medallion
t = Canvas(L.OW, L.FRIEZE_H, px)
orn = islimi_band(t, m + 0.01, cx - R - 0.012, cy, L.FRIEZE_H - 2 * m - 0.03, 0.2, 0.010, 0.0055, 21, 1.1)
cv.h = np.where((r > R + 0.012) & (X > m + 0.008) & (Y > m + 0.008) & (Y < L.FRIEZE_H - m - 0.008), np.maximum(cv.h, -0.010 + orn), cv.h)
b, o, n = wood_finish(cv.h, px, None, False, seed=3, streaks=0.1)
put('frieze', b, o, n)

# ------------------------------------------------------------------ jamb front (developed)
pxf = L.PX_FRAME
cv = Canvas(L.JFRONT, L.TOP, pxf)
X, Y = cv.full_xy()
bw, fw, sw, ow = L.JPROF
# rope bead: diagonal twist grooves
rope = np.sin(2 * np.pi * (Y / 0.028 + X / bw * 0.9))
cv.h += np.where(X < bw, -0.0025 * np.clip(-rope, 0, 1) ** 0.5, 0)
# flat: islimi channel above plinth
sl, orn = islimi_vertical(cv, bw + 0.012, bw + fw - 0.012, 0.42, L.TOP - 0.04, 0.0065, 31)
channel(cv, bw + 0.012, 0.42, bw + fw - 0.012, L.TOP - 0.04, 0.0065, orn)
# plinth panel outline
for a, bb in rect_segs(bw + 0.012, 0.05, bw + fw - 0.012, 0.37):
    stroke(cv.h, cv, np.array([a, bb]), 0.003, 0.003, 'vee', op='min')
# outer strip: chip carving vertical
t = Canvas(L.TOP - 0.06, ow - 0.008, pxf)
ch = np.rot90(chip_band(t, 0, t.w_m, 0, t.h_m, 0.005), 1)
sl2 = sub(cv, bw + fw + sw + 0.004, 0.03, L.JFRONT - 0.004, L.TOP - 0.03)
reg = cv.h[sl2]; cv.h[sl2] = np.minimum(reg, fit(ch, reg.shape))
hg = np.where((X > bw + fw) & (X < bw + fw + sw), -0.008, 0.0) + np.where(X > bw + fw + sw, -0.015, 0)
b, o, n = wood_finish(cv.h, pxf, hg, True, seed=4, streaks=0.3)
splash = np.clip(1 - Y / 0.4, 0, 1)
b *= (1 - 0.3 * splash)[..., None]
put('jamb', b, o, n)

# ------------------------------------------------------------------ cornice (developed, half)
cv = Canvas(0.84, L.CORN_PROF, pxf)
X, Y = cv.full_xy()
rope = np.sin(2 * np.pi * (X / 0.028 + Y / 0.03 * 0.9))
cv.h += np.where(Y < 0.03, -0.0025 * np.clip(-rope, 0, 1) ** 0.5, 0)
t = Canvas(0.84, 0.045, pxf)
ch = chip_band(t, 0, t.w_m, 0, t.h_m, 0.005)
sl = sub(cv, 0, 0.062, 0.84, 0.107); reg = cv.h[sl]; cv.h[sl] = fit(ch, reg.shape)
b, o, n = wood_finish(cv.h, pxf, None, False, seed=5, streaks=0.0)
put('cornice', b, o, n)

# ------------------------------------------------------------------ iron
pxi = 1 / 1000.0
cv = Canvas(0.128, 0.128, pxi)
X, Y = cv.full_xy()
c = 0.064
r = np.hypot(X - c, Y - c); a = np.arctan2(Y - c, X - c)
pet = 0.5 + 0.5 * np.cos(8 * a)
plate = np.clip((0.058 - r * (1.0 - 0.12 * pet)) / 0.004, 0, 1)
cv.h += 0.0015 * plate + 0.0012 * np.clip(1 - r / 0.018, 0, 1) ** 0.5
cv.h += 0.0007 * np.exp(-((r - 0.04) / 0.002) ** 2)
pits = fbm(cv.H, cv.W, 6, 4, 77)
cv.h += (pits - 0.5) * 0.0006
rust = np.clip((fbm(cv.H, cv.W, 30, 4, 78) - 0.55) * 4, 0, 1)
iron = hexc('2b2724'); rustc = hexc('6b3a1e')
col = iron[None, None, :] * (0.8 + 0.4 * pits[..., None]) * (1 - rust[..., None]) + rustc[None, None, :] * rust[..., None] * (0.7 + 0.6 * pits[..., None])
ao = ao_from_height(cv.h * 3, pxi, (0.002, 0.006))
col *= ao[..., None]
o = np.dstack([ao, 0.5 + 0.35 * rust, 0.85 * (1 - rust)])
n = n_to_rgb(normal_from_height(cv.h, pxi))
put('iron', col, o, n)

# ------------------------------------------------------------------ sill top (horizontal grain, worn middle)
pxp = L.PX_PLAIN
x0, y0, w, h, _ = L.ISL['sill_top']
cv = Canvas(w * pxp, h * pxp, pxp)
X, Y = cv.full_xy()
mid = np.exp(-((X - cv.w_m / 2) / 0.45) ** 2)
cv.h += -0.004 * mid * np.exp(-((Y - cv.h_m / 2) / 0.12) ** 2)
b, o, n = wood_finish(cv.h, pxp, None, False, seed=6, dust=0.3)
b = b * (1 + 0.25 * mid[..., None]); o[..., 1] -= 0.2 * mid
put('sill_top', b, o, n)

# ------------------------------------------------------------------ plain
x0, y0, w, h, _ = L.ISL['plain']
cv = Canvas(w * pxp, h * pxp, pxp)
b, o, n = wood_finish(cv.h, pxp, None, True, seed=7, streaks=0.3)
put('plain', b, o, n)

base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'door'), base_a, orm_a, nrm_a)
# quick look image
Image.fromarray((lin_to_srgb(base_a) * 255).astype(np.uint8)).resize((512, 512)).save(os.path.join(os.path.dirname(HERE), 'work', 'door_atlas_small.png'))
print('door textures done')
