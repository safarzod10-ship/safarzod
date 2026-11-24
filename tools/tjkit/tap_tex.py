"""python3 -I tap_tex.py -> work/texout/tapchan_*.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import tap_layout as T
OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout')
base_a, orm_a, nrm_a = new_atlas(T.S)
used = np.zeros((T.S, T.S), bool)
def put(name, b, o, n):
    paste(base_a, T.ISL[name], b); paste(orm_a, T.ISL[name], o); paste(nrm_a, T.ISL[name], n)
    x0, y0, w, h, _ = T.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True
def canvas(name):
    x0, y0, w, h, px = T.ISL[name]; cv = Canvas(w * px, h * px, px); X, Y = cv.full_xy(); return cv, X, Y, px
def weave(H, W, px, pitch=0.002, amp=0.00015):
    cv = Canvas(W * px, H * px, px); X, Y = cv.full_xy()
    return amp * (np.sin(2 * np.pi * X / pitch) * np.sin(2 * np.pi * Y / pitch))
K = dict(red=hexc('8c1f17'), navy=hexc('1d2440'), ivory=hexc('d8cbb0'), blue=hexc('2b4a7a'), orange=hexc('c0682a'),
         black=hexc('231a1a'), yellow=hexc('d6a92e'), green=hexc('3d6b3a'), purple=hexc('4d2440'), white=hexc('e8e2d4'),
         pink=hexc('c0566a'), cobalt=hexc('1f3f8f'), gold=hexc('b08a3a'))
def fabric_out(name, col, h, px, rough=0.9, ao=None):
    H, W = h.shape
    ao = np.ones_like(h) if ao is None else ao
    n = normal_from_height(h + weave(H, W, px), px)
    put(name, np.clip(col * ao[..., None], 0, 1), np.dstack([ao, np.full_like(ao, rough), np.zeros_like(ao)]), n_to_rgb(n))

# ------------------------------------------------------------------ carpet (gul pattern)
cv, X, Y, px = canvas('carpet')
W_, H_ = cv.w_m, cv.h_m
col = np.zeros((cv.H, cv.W, 3), np.float32) + K['red']
d_edge = np.minimum.reduce([X, W_ - X, Y, H_ - Y])
border = d_edge < 0.2
col[border] = K['navy']
# running zigzag (ram's horn simplified) in the border
t = np.where(np.minimum(X, W_ - X) < np.minimum(Y, H_ - Y), Y, X)
zz = np.abs(((t / 0.08) % 1) - 0.5) * 2
inb = (d_edge > 0.05) & (d_edge < 0.15)
u = (d_edge - 0.05) / 0.10
col[inb & (np.abs(u - zz) < 0.18)] = K['ivory']
col[inb & (np.abs(u - (1 - zz)) < 0.1)] = K['orange']
for g0, g1, c in ((0.0, 0.03, K['red']), (0.03, 0.045, K['ivory']), (0.165, 0.18, K['ivory']), (0.18, 0.2, K['orange'])):
    col[(d_edge >= g0) & (d_edge < g1)] = c
# field guls
fx0, fy0, fx1, fy1 = 0.2, 0.2, W_ - 0.2, H_ - 0.2
nx, ny = 4, 3
for i in range(nx):
    for j in range(ny):
        cx = fx0 + (i + 0.5) * (fx1 - fx0) / nx; cy = fy0 + (j + 0.5) * (fy1 - fy0) / ny
        dx, dy = X - cx, Y - cy
        oct_ = np.maximum(np.abs(dx) + np.abs(dy) * 0.0, 0)
        r8 = np.maximum(np.maximum(np.abs(dx), np.abs(dy) * 1.25), (np.abs(dx) + np.abs(dy) * 1.25) / 1.414)
        g = r8 < 0.16
        q = ((dx > 0) ^ (dy > 0))
        col[g] = np.where(q[g][:, None], K['ivory'], K['blue'])
        col[(r8 > 0.145) & (r8 < 0.16)] = K['black']
        inner = r8 < 0.075
        col[inner] = K['red']
        dm = (np.abs(dx) + np.abs(dy) * 1.25) < 0.05
        col[dm] = K['orange']
        col[(np.abs(dx) + np.abs(dy) * 1.25) < 0.02] = K['black']
        # minor gul (diamond) between
        if i < nx - 1 and j < ny - 1:
            mx = cx + (fx1 - fx0) / nx / 2; my = cy + (fy1 - fy0) / ny / 2
            dmn = np.abs(X - mx) + np.abs(Y - my)
            col[dmn < 0.07] = K['navy']; col[dmn < 0.045] = K['ivory']; col[dmn < 0.02] = K['red']
# pile texture, wear, abrash (colour banding)
abr = fbm(cv.H, cv.W, 60, 2, 3, (6, 1))
col *= (0.85 + 0.22 * abr[..., None])
wear = np.exp(-(((X - W_ / 2) / 0.6) ** 2 + ((Y - H_ / 2) / 0.45) ** 2)) * fbm(cv.H, cv.W, 20, 3, 4)
col = col * (1 - 0.25 * wear[..., None]) + K['ivory'] * 0.25 * wear[..., None] * 0.6
pile = fbm(cv.H, cv.W, 2, 2, 5)
col *= (0.9 + 0.15 * pile[..., None])
h = 0.0006 * pile - 0.002 * (d_edge < 0.008)
fabric_out('carpet', col, h, px, 0.95)

# ------------------------------------------------------------------ ikat (adras) fabrics
def ikat(name, pal, seed):
    cv, X, Y, px = canvas(name)
    rng = np.random.default_rng(seed)
    col = np.zeros((cv.H, cv.W, 3), np.float32) + pal[0]
    # warp along X: motif depends on Y (across) and repeats along X; jagged along X per weft row
    jag = (rng.random(cv.H) * 0.012)[:, None]
    Xj = X + jag + 0.006 * np.sin(Y / 0.003)
    per = 0.30
    xm = (Xj % per) / per
    yc = cv.h_m / 2
    # big lozenge / comb motifs
    lz = np.abs(xm - 0.5) * 2 * 1.0 + np.abs(Y - yc) / (cv.h_m * 0.45)
    col[lz < 1.0] = pal[1]
    col[lz < 0.72] = pal[2]
    col[lz < 0.45] = pal[3]
    col[lz < 0.2] = pal[1]
    # side stripe bands
    for yy, c in ((0.03, pal[4]), (cv.h_m - 0.03, pal[4])):
        col[np.abs(Y - yy) < 0.018] = c
    combs = (np.abs(Y - 0.075) < 0.02) | (np.abs(Y - (cv.h_m - 0.075)) < 0.02)
    col[combs & ((Xj % 0.06) < 0.03)] = pal[2]
    # quilting stitches along X every 6 cm
    st = np.abs(((Y + 0.03) % 0.06) - 0.03) < 0.0012
    h = -0.002 * np.clip(1 - np.abs(((Y + 0.03) % 0.06) - 0.03) / 0.008, 0, 1)
    col *= (0.88 + 0.2 * fbm(cv.H, cv.W, 30, 3, seed)[..., None])
    sheen = 0.9 + 0.15 * np.sin(Y / 0.0015)
    col *= sheen[..., None]
    fabric_out(name, col, h, px, 0.75)
ikat('ikat1', [K['yellow'], K['red'], K['white'], K['purple'], K['green']], 11)
ikat('ikat2', [K['purple'], K['pink'], K['yellow'], K['green'], K['red']], 12)

# ------------------------------------------------------------------ dastarkhan cloth
cv, X, Y, px = canvas('cloth')
col = np.zeros((cv.H, cv.W, 3), np.float32) + K['white']
de = np.minimum.reduce([X, cv.w_m - X, Y, cv.h_m - Y])
col[(de > 0.03) & (de < 0.07)] = K['red']
col[(de > 0.04) & (de < 0.06) & (((X + Y) % 0.05) < 0.025)] = K['yellow']
r = np.hypot(X - cv.w_m / 2, Y - cv.h_m / 2); a = np.arctan2(Y - cv.h_m / 2, X - cv.w_m / 2)
col[r < 0.12 * (0.7 + 0.3 * np.abs(np.cos(4 * a)))] = K['red']
col[r < 0.05] = K['green']
col *= (0.9 + 0.12 * fbm(cv.H, cv.W, 20, 3, 21)[..., None])
fabric_out('cloth', col, np.zeros_like(X), px, 0.85)

# ------------------------------------------------------------------ ceramic (white with cobalt 'cotton' net)
cv, X, Y, px = canvas('ceramic')
col = np.zeros((cv.H, cv.W, 3), np.float32) + hexc('eceae4')
u = X / cv.w_m * 8; v = Y / 0.035
cu = (u % 1) - 0.5; cvv = (v % 1) - 0.5
net = (np.abs(np.abs(cu) - np.abs(cvv)) < 0.06)
col[net] = K['cobalt']
boll = np.hypot(cu, cvv) < 0.2
col[boll] = hexc('f6f4ee'); col[(np.hypot(cu, cvv) > 0.2) & (np.hypot(cu, cvv) < 0.24)] = K['cobalt']
col[Y > cv.h_m - 0.01] = K['gold']
h = 0.00005 * fbm(cv.H, cv.W, 10, 2, 22)
n = n_to_rgb(normal_from_height(h, px))
ao = np.ones_like(X)
put('ceramic', col, np.dstack([ao, np.where(Y > cv.h_m - 0.01, 0.3, 0.12), np.where(Y > cv.h_m - 0.01, 0.9, 0.0)]), n)

# ------------------------------------------------------------------ non (bread) with stamped centre
cv, X, Y, px = canvas('bread')
c = cv.w_m / 2
r = np.hypot(X - c, Y - c); a = np.arctan2(Y - c, X - c)
crust = hexc('a8622c'); light = hexc('c08a50')
col = crust * (0.8 + 0.3 * fbm(cv.H, cv.W, 6, 3, 31))[..., None]
centre = r < 0.09
col[centre] = light * (0.9 + 0.2 * fbm(cv.H, cv.W, 3, 2, 32))[centre][..., None]
dots = centre & (((np.round(r / 0.012) * 0.012 - r) ** 2 + 0) < 1e-5) & ((np.sin(a * np.round(r / 0.012) * 6) > 0.9))
h = np.where(centre, -0.004, 0.006 * np.clip(1 - np.abs(r - 0.12) / 0.04, 0, 1))
pr = (np.abs((r % 0.012) - 0.006) < 0.0015) & centre & (np.abs(np.sin(a * 20)) > 0.7)
col[pr] *= 0.6; h = h - 0.001 * pr
col *= (1 - 0.35 * np.clip((r - 0.11) / 0.04, 0, 1) * np.clip(1 - (r - 0.15) / 0.02, 0, 1))[..., None]
ao = ao_from_height(h, px)
put('bread', col * ao[..., None], np.dstack([ao, np.full_like(ao, 0.7), np.zeros_like(ao)]), n_to_rgb(normal_from_height(h, px)))

# ------------------------------------------------------------------ wood
for name, seed, vert in (('deck', 41, False), ('plain', 42, False)):
    cv, X, Y, px = canvas(name)
    if name == 'deck':
        src = 'brown_planks_03'
        b, o, n = wood_finish(cv.h, px, None, vert, seed=seed, src=src, src_m=1.0, tone=dict(col=hexc('7d6a55'), worn=hexc('a08a70'), grime=hexc('2e261f'), dust=hexc('8a8070')), ph_nrm=0.9)
    else:
        b, o, n = wood_finish(cv.h, px, None, vert, seed=seed, streaks=0.2, tone=dict(col=hexc('4e3a2b'), worn=hexc('7d6650'), grime=hexc('1d150f'), dust=hexc('7a7264')), bleach=0.25 * fbm(cv.H, cv.W, 40, 3, 7))
    put(name, b, o, n)
base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'tapchan'), base_a, orm_a, nrm_a)
Image.fromarray((lin_to_srgb(base_a) * 255).astype(np.uint8)).save(os.path.join(os.path.dirname(HERE), 'work', 'tapchan_view.jpg'))
print('tapchan textures done')
