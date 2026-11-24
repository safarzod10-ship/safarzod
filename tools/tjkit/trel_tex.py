"""python3 -I trel_tex.py -> work/texout/trellis_*.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import trel_layout as T
OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout')
base_a, orm_a, nrm_a = new_atlas(T.S)
used = np.zeros((T.S, T.S), bool)
def put(name, b, o, n):
    paste(base_a, T.ISL[name], b); paste(orm_a, T.ISL[name], o); paste(nrm_a, T.ISL[name], n)
    x0, y0, w, h, _ = T.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True
# poplar poles: weathered grey wood with long checks and bark remnants
x0, y0, W, H, px = T.ISL['pole']
cv = Canvas(W * px, H * px, px)
checks = np.zeros((H, W), np.float32)
rng = np.random.default_rng(3)
for _ in range(60):
    x = rng.random() * cv.w_m; y = rng.random() * cv.h_m; L = 0.1 + 0.5 * rng.random()
    xs = x + 0.004 * np.sin(np.linspace(0, 6, 12)); ys = np.linspace(y, y + L, 12)
    stroke(checks, cv, np.stack([xs, ys], 1), 0.0018 * np.sin(np.linspace(0.1, 3.0, 12)), 0.004, 'vee')
b, o, n = wood_finish(-checks, px, None, True, seed=51, src='fine_grained_wood', src_m=0.6,
                      tone=dict(col=hexc('8a7e6f'), worn=hexc('a89c8a'), grime=hexc('2e2924'), dust=hexc('8a8070')), streaks=0.3, ph_nrm=0.5)
bark_c = tile(ph('bark_willow', 'col', px, 1.0), H, W); bark_n = tile(ph('bark_willow', 'nrm', px, 1.0), H, W, normal=True)
patch = np.clip((fbm(H, W, 60, 4, 52, (1, 3)) - 0.62) * 8, 0, 1)
b = b * (1 - patch[..., None]) + bark_c * 0.8 * patch[..., None]
n = n * (1 - patch[..., None]) + bark_n * patch[..., None]
put('pole', b, o, n)
# vine bark: dark, fibrous, shredding
x0, y0, W, H, px = T.ISL['vine']
c = tile(ph('bark_willow', 'col', px * 0.5, 1.0), H, W, 0, (0.3, 0.1))
nn = tile(ph('bark_willow', 'nrm', px * 0.5, 1.0), H, W, 0, (0.3, 0.1), normal=True)
a = tile(ph('bark_willow', 'arm', px * 0.5, 1.0), H, W, 0, (0.3, 0.1))
lum = c.mean(2, keepdims=True) / c.mean()
c = hexc('5a4636')[None, None, :] * lum ** 1.4 * (0.8 + 0.4 * fbm(H, W, 30, 3, 53, (1, 6))[..., None])
put('vine', c, np.dstack([a[..., 0], np.full((H, W), 0.85), np.zeros((H, W))]), nn)
# leaves (4 variants): green, veins, slightly yellow/brown margins
outline = T.leaf_outline()
greens = [hexc('3e5f26'), hexc('4a6b2a'), hexc('5a7030'), hexc('3a5a24')]
for k in range(4):
    name = f'leaf{k}'
    x0, y0, W, H, px = T.ISL[name]
    cv = Canvas(W * px, H * px, px)
    X, Y = cv.full_xy()
    lx, ly = X - cv.w_m / 2, Y - 0.005          # leaf space: petiole near the bottom centre
    poly = [(p[0] + cv.w_m / 2, p[1] + 0.005) for p in outline]
    inside = poly_mask(cv, poly).astype(np.float32)
    veins = np.zeros((H, W), np.float32)
    base = np.array([cv.w_m / 2, 0.05])
    for ang in (0, 60, -60, 118, -118):
        th = math.radians(ang)
        tip = base + 0.15 * np.array([math.sin(th), math.cos(th)])
        stroke(veins, cv, np.array([base, tip]), np.array([0.0022, 0.0006]), 1.0, 'round')
        for t in (0.3, 0.55, 0.75):
            p0 = base + (tip - base) * t
            for s in (-1, 1):
                d = np.array([math.sin(th + s * 0.8), math.cos(th + s * 0.8)])
                stroke(veins, cv, np.array([p0, p0 + d * 0.035 * (1 - t * 0.5)]), np.array([0.0008, 0.0003]), 0.6, 'round')
    g = greens[k] * (0.85 + 0.3 * fbm(H, W, 12, 3, 60 + k))[..., None]
    col = g * (1 + 0.25 * veins[..., None])
    rim = inside * (1 - ndi.uniform_filter(inside, 7))
    edge = np.clip(rim * 4, 0, 1) * (0.4 + 0.6 * fbm(H, W, 8, 2, 70 + k))
    col = col * (1 - edge[..., None] * 0.6) + hexc('8a6a2a') * edge[..., None] * 0.6
    if k == 2:
        spots = (fbm(H, W, 6, 3, 80) > 0.72)
        col[spots] = col[spots] * 0.6 + hexc('9a7a2a') * 0.4
    hh = 0.0006 * veins - 0.0004 * fbm(H, W, 10, 2, 90 + k)
    n = normal_from_height(-hh, px)
    put(name, col, np.dstack([np.ones((H, W)), np.full((H, W), 0.6), np.zeros((H, W))]), n_to_rgb(n))
# grapes: berries packed
x0, y0, W, H, px = T.ISL['grapes']
cv = Canvas(W * px, H * px, px)
hh = np.zeros((H, W), np.float32); idm = np.zeros((H, W), np.float32)
rng = np.random.default_rng(9)
for j in range(14):
    for i in range(14):
        x = (i + 0.5 * (j % 2)) * 0.018 + rng.normal(0, 0.002); y = j * 0.016 + rng.normal(0, 0.002)
        stroke(hh, cv, np.array([[x, y], [x + 1e-5, y]]), 0.0095, 0.0095, 'round')
col = hexc('3a2240') * (0.55 + 0.6 * (hh / 0.0095)[..., None]) * (0.85 + 0.3 * fbm(H, W, 20, 2, 10))[..., None]
bloom = fbm(H, W, 4, 2, 11)
col = col * (1 - 0.25 * bloom[..., None]) + hexc('8a8aa0') * 0.25 * bloom[..., None]
ao = ao_from_height(hh, px, (0.003, 0.008))
put('grapes', col * ao[..., None], np.dstack([ao, np.full((H, W), 0.45), np.zeros((H, W))]), n_to_rgb(normal_from_height(hh, px)))
# end grain
x0, y0, W, H, px = T.ISL['end']
cv = Canvas(W * px, H * px, px); X, Y = cv.full_xy()
r = np.hypot(X - cv.w_m / 2, Y - cv.h_m / 2)
rings = 0.5 + 0.5 * np.sin(r / 0.004 * 6.28 + 2 * fbm(H, W, 30, 2, 12))
col = hexc('9a8a74') * (0.75 + 0.3 * rings)[..., None]
col *= np.where(r > 0.075, 0.6, 1.0)[..., None]
put('end', col, np.dstack([np.ones((H, W)), np.full((H, W), 0.85), np.zeros((H, W))]), n_to_rgb(normal_from_height(0.0003 * rings, px)))
base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'trellis'), base_a, orm_a, nrm_a)
Image.fromarray((lin_to_srgb(base_a) * 255).astype(np.uint8)).save(os.path.join(os.path.dirname(HERE), 'work', 'trellis_view.jpg'))
print('trellis textures done')
