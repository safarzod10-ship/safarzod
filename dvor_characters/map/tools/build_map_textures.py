import json
import os

import cv2
import numpy as np

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
REF = os.path.join(ROOT, 'ref')
OUT = os.path.join(ROOT, 'textures')
os.makedirs(OUT, exist_ok=True)

top = cv2.imread(os.path.join(REF, 'map_top.png'), cv2.IMREAD_COLOR)
persp = cv2.imread(os.path.join(REF, 'map_persp.png'), cv2.IMREAD_COLOR)
rng = np.random.default_rng(7)

ATLAS = 2048
atlas = np.zeros((ATLAS, ATLAS, 3), np.uint8)
regions = {}


def put(name, img, x, y):
    h, w = img.shape[:2]
    assert x + w <= ATLAS and y + h <= ATLAS, name
    atlas[y:y + h, x:x + w] = img
    regions[name] = {'px': [x, y, w, h], 'uv': [x / ATLAS, y / ATLAS, (x + w) / ATLAS, (y + h) / ATLAS]}


def rectify(src, quad, w, h):
    m = cv2.getPerspectiveTransform(np.float32(quad), np.float32([[0, 0], [w, 0], [w, h], [0, h]]))
    return cv2.warpPerspective(src, m, (w, h), flags=cv2.INTER_LANCZOS4, borderMode=cv2.BORDER_REFLECT)


def crop(src, x0, y0, x1, y1, w, h):
    return cv2.resize(src[y0:y1, x0:x1], (w, h), interpolation=cv2.INTER_LANCZOS4)


def sharpen(img, amount=0.6, sigma=1.2):
    blur = cv2.GaussianBlur(img, (0, 0), sigma)
    return cv2.addWeighted(img, 1 + amount, blur, -amount, 0)


def noise(h, w, scale, octaves=3):
    acc = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(2, int(scale / (2 ** o)))
        small = rng.random((h // s + 2, w // s + 2)).astype(np.float32)
        acc += amp * cv2.resize(small, (w, h), interpolation=cv2.INTER_CUBIC)[:h, :w]
        tot += amp
        amp *= 0.5
    return acc / tot


def bgr(hexs):
    hexs = hexs.lstrip('#')
    return np.array([int(hexs[4:6], 16), int(hexs[2:4], 16), int(hexs[0:2], 16)], np.float32)


FLOOR_SRC = [[325, 108], [1358, 108], [1378, 893], [298, 893]]
FLOOR_W, FLOOR_D = 21.0, 18.5
FW, FH = 1216, 1072

OBJECT_BOXES = [
    (758, 203, 914, 285), (760, 660, 927, 747), (528, 328, 592, 550), (466, 365, 532, 548),
    (1073, 383, 1142, 600), (1095, 192, 1163, 302), (468, 735, 562, 875), (1296, 610, 1356, 748),
    (1040, 60, 1188, 140), (576, 85, 662, 158), (655, 85, 704, 142), (845, 88, 912, 158),
    (1192, 80, 1238, 135), (300, 175, 390, 315), (300, 530, 355, 648), (298, 662, 360, 750),
    (295, 740, 350, 855), (570, 815, 750, 900), (955, 840, 1015, 900), (1045, 800, 1135, 900),
    (1290, 175, 1350, 340), (1300, 355, 1350, 402), (1300, 555, 1345, 603), (1275, 765, 1345, 845),
    (1290, 755, 1390, 900),
    (320, 95, 470, 142),
    (280, 140, 352, 895), (1318, 140, 1395, 895),
    (300, 96, 1380, 118), (290, 882, 1390, 900),
]
mask = np.zeros(top.shape[:2], np.uint8)
for x0, y0, x1, y1 in OBJECT_BOXES:
    cv2.rectangle(mask, (x0 - 3, y0 - 3), (x1 + 3, y1 + 3), 255, -1)
src = top.copy()
filled = cv2.inpaint(src, mask, 9, cv2.INPAINT_TELEA)
CLEAN = (600, 590, 700, 680)
cp = src[CLEAN[1]:CLEAN[3], CLEAN[0]:CLEAN[2]].astype(np.float32)
hp = cp - cv2.GaussianBlur(cp, (0, 0), 6)
reps = (src.shape[0] // hp.shape[0] + 1, src.shape[1] // hp.shape[1] + 1, 1)
detail = np.tile(hp, reps)[:src.shape[0], :src.shape[1]]
filled = np.clip(filled.astype(np.float32) + np.where(mask[..., None] > 0, detail, 0), 0, 255).astype(np.uint8)
cv2.imwrite(os.path.join(OUT, 'MAP_floor_inpaint_mask.jpg'),
            np.where(mask[..., None] > 0, (filled * 0.5 + np.array([0, 0, 128])).astype(np.uint8), filled))
floor = rectify(filled, FLOOR_SRC, FW, FH)
floor = sharpen(floor, 0.5, 1.5)
put('floor', floor, 0, 0)

FAW, FAH = 1024, 960
PPM = FAW / 12.8
brick = bgr('#a5573c')
fac = np.empty((FAH, FAW, 3), np.float32)
fac[:] = brick
n = noise(FAH, FAW, 64)
fac *= (0.82 + 0.3 * n)[..., None]
bw, bh = int(0.25 * PPM), max(3, int(0.075 * PPM))
for r in range(0, FAH, bh):
    cv2.line(fac, (0, r), (FAW, r), bgr('#6e3a2c').tolist(), 1)
    off = (r // bh) % 2 * bw // 2
    for c in range(-off, FAW, bw):
        cv2.line(fac, (c, r), (c, r + bh), bgr('#6e3a2c').tolist(), 1)
    for c in range(-off, FAW, bw):
        fac[r + 1:r + bh, max(0, c + 1):max(0, c + bw)] *= 0.9 + 0.2 * rng.random()
bay, flo = FAW // 4, FAH // 4
for i in range(4):
    for j in range(4):
        x0 = i * bay + int(0.25 * bay)
        x1 = i * bay + int(0.75 * bay)
        yb = FAH - j * flo - int(0.9 * PPM)
        yt = yb - int(1.45 * PPM)
        if j == 0 and i == 1:
            yb, yt = FAH - j * flo, FAH - j * flo - int(2.1 * PPM)
            cv2.rectangle(fac, (x0 - 6, yt - 6), (x1 + 6, yb), bgr('#8b8f9b').tolist(), -1)
            cv2.rectangle(fac, (x0, yt), (x1, yb), bgr('#4b4f5e').tolist(), -1)
            cv2.line(fac, ((x0 + x1) // 2, yt), ((x0 + x1) // 2, yb), bgr('#353845').tolist(), 2)
            continue
        cv2.rectangle(fac, (x0 - 7, yt - 7), (x1 + 7, yb + 7), bgr('#c9c4c2').tolist(), -1)
        cv2.rectangle(fac, (x0 - 11, yb + 4), (x1 + 11, yb + 13), bgr('#d9d2cc').tolist(), -1)
        cv2.rectangle(fac, (x0 - 11, yt - 16), (x1 + 11, yt - 7), bgr('#8e5341').tolist(), -1)
        g = np.linspace(0, 1, yb - yt)[:, None, None]
        glass = (1 - g) * bgr('#6e7b96') + g * bgr('#2f3446')
        fac[yt:yb, x0:x1] = glass
        cv2.line(fac, ((x0 + x1) // 2, yt), ((x0 + x1) // 2, yb), bgr('#c9c4c2').tolist(), 4)
        cv2.line(fac, (x0, yt + (yb - yt) // 3), (x1, yt + (yb - yt) // 3), bgr('#c9c4c2').tolist(), 4)
        if (i + j) % 3 == 0 and j > 0:
            ax0, ay0 = x1 - int(0.15 * PPM), yb + int(0.25 * PPM)
            cv2.rectangle(fac, (ax0, ay0), (ax0 + int(0.8 * PPM), ay0 + int(0.55 * PPM)), bgr('#d8d8da').tolist(), -1)
            cv2.circle(fac, (ax0 + int(0.5 * PPM), ay0 + int(0.27 * PPM)), int(0.2 * PPM), bgr('#8f9298').tolist(), 3)
for j in range(1, 4):
    yy = FAH - j * flo
    cv2.rectangle(fac, (0, yy - 5), (FAW, yy + 5), bgr('#8e4c37').tolist(), -1)
cv2.rectangle(fac, (0, FAH - int(0.6 * PPM)), (FAW, FAH), bgr('#5e5a5f').tolist(), -1)
yy, xx = np.mgrid[0:FAH, 0:FAW].astype(np.float32)
fac *= (0.88 + 0.18 * (xx / FAW) + 0.08 * (1 - yy / FAH))[..., None]
fac[..., 2] *= 1.04
put('facade', np.clip(fac, 0, 255).astype(np.uint8), 0, FH)

X0 = FW

WPM = 832 / 10.0
WH = int(2.6 * WPM)
wall = np.zeros((WH, 832, 3), np.uint8)
dvor = rectify(persp, [[265, 178], [492, 126], [495, 248], [280, 318]], int(4.5 * WPM), WH)
arrow = rectify(persp, [[497, 128], [640, 96], [642, 200], [498, 245]], int(2.7 * WPM), WH)
plain = cv2.resize(dvor[:, :int(0.6 * WPM)], (int(2.0 * WPM), WH), interpolation=cv2.INTER_CUBIC)
plain_r = cv2.resize(dvor[:, -int(0.5 * WPM):], (832 - plain.shape[1] - dvor.shape[1] - arrow.shape[1], WH))
wall = np.hstack([plain, dvor, arrow, plain_r])
put('wall_dvor', sharpen(wall, 0.5), X0, 0)

crown = rectify(persp, [[613, 290], [725, 250], [727, 302], [616, 345]], 512, 205)
put('block_face', sharpen(crown, 0.5), X0, 216)
conc = crop(top, 772, 210, 900, 250, 320, 205)
put('concrete', sharpen(conc, 0.4), X0 + 512, 216)

put('ac_top', sharpen(crop(top, 90, 314, 136, 360, 128, 128), 0.5), X0, 421)
acs = np.empty((96, 128, 3), np.float32)
acs[:] = bgr('#c9c6cc')
acs *= (0.92 + 0.1 * noise(96, 128, 16))[..., None]
for yy in range(14, 84, 7):
    cv2.line(acs, (70, yy), (118, yy), bgr('#8d8a93').tolist(), 2)
cv2.circle(acs, (36, 48), 26, bgr('#7a7781').tolist(), 3)
cv2.circle(acs, (36, 48), 6, bgr('#5c5962').tolist(), -1)
cv2.rectangle(acs, (0, 0), (127, 95), bgr('#9a97a0').tolist(), 3)
put('ac_side', np.clip(acs, 0, 255).astype(np.uint8), X0 + 128, 421)

def leaves(size, leaf, count, seed):
    r = np.random.default_rng(seed)
    img = np.empty((size, size, 3), np.float32)
    img[:] = bgr('#3b4a1c')
    pal = [bgr(c) for c in ('#4f6420', '#7d8f2a', '#a9b034', '#c9c43a', '#e2d75a')]
    for _ in range(count):
        x, y = r.integers(0, size, 2)
        light = 0.5 * (x / size) + 0.5 * (1 - y / size)
        k = int(np.clip(light * 3.2 + r.normal(0, 0.9), 0, 4))
        col = (pal[k] * (0.85 + 0.3 * r.random())).tolist()
        ax = (int(leaf * (0.7 + 0.6 * r.random())), int(leaf * 0.45 * (0.7 + 0.6 * r.random())))
        ang = float(r.uniform(0, 180))
        for dx in (-size, 0, size):
            for dy in (-size, 0, size):
                cv2.ellipse(img, (int(x + dx), int(y + dy)), ax, ang, 0, 360, col, -1, cv2.LINE_AA)
                cv2.line(img, (int(x + dx), int(y + dy)), (int(x + dx + ax[0] * 0.8 * np.cos(np.radians(ang))),
                         int(y + dy + ax[0] * 0.8 * np.sin(np.radians(ang)))), (pal[0] * 0.8).tolist(), 1, cv2.LINE_AA)
    return np.clip(img, 0, 255).astype(np.uint8)


put('bush', leaves(256, 13, 700, 11), X0, 805)
put('canopy', leaves(256, 16, 520, 12), X0 + 256, 805)

side = crop(persp, 226, 336, 274, 396, 128, 192)
put('barrel_blue', side, X0 + 512, 805)
lum = cv2.cvtColor(side, cv2.COLOR_BGR2GRAY).astype(np.float32)[..., None] / 140.0
put('barrel_rust', np.clip(lum * bgr('#8a5a45'), 0, 255).astype(np.uint8), X0 + 640, 805)
put('barrel_top', crop(top, 582, 94, 616, 124, 64, 64), X0 + 768, 805)

CS = 256
cr = np.empty((CS, CS, 3), np.float32)
cr[:] = bgr('#c97a3e')
cr *= (0.85 + 0.25 * noise(CS, CS, 24))[..., None]
for k in range(1, 5):
    y = k * CS // 5
    cv2.line(cr, (0, y), (CS, y), bgr('#7a4422').tolist(), 3)
cv2.rectangle(cr, (0, 0), (CS - 1, CS - 1), bgr('#9a5a2e').tolist(), 22)
cv2.rectangle(cr, (0, 0), (CS - 1, CS - 1), bgr('#5e3218').tolist(), 3)
cv2.rectangle(cr, (22, 22), (CS - 23, CS - 23), bgr('#5e3218').tolist(), 3)
cv2.line(cr, (26, CS - 26), (CS - 26, 26), bgr('#9a5a2e').tolist(), 20)
cv2.line(cr, (26, CS - 26), (CS - 26, 26), bgr('#5e3218').tolist(), 2)
for cx, cy in [(11, 11), (CS - 12, 11), (11, CS - 12), (CS - 12, CS - 12)]:
    cv2.circle(cr, (cx, cy), 3, bgr('#3b2a20').tolist(), -1)
put('crate', np.clip(cr, 0, 255).astype(np.uint8), X0, 1061)
gb = cv2.cvtColor(cv2.cvtColor(np.clip(cr, 0, 255).astype(np.uint8), cv2.COLOR_BGR2GRAY), cv2.COLOR_GRAY2BGR)
gb = np.clip(gb.astype(np.float32) * (bgr('#a7a3ad') / 150.0), 0, 255).astype(np.uint8)
put('box_grey', gb, X0 + 256, 1061)

asph = np.empty((128, 128, 3), np.float32)
asph[:] = bgr('#5d5560')
asph *= (0.93 + 0.12 * noise(128, 128, 16))[..., None]
put('asphalt', np.clip(asph, 0, 255).astype(np.uint8), X0 + 512, 1061)
put('roof_edge', np.full((64, 64, 3), bgr('#8e8a96'), np.uint8), X0 + 640, 1061)
put('trunk', np.full((64, 64, 3), bgr('#5a4130'), np.uint8), X0 + 704, 1061)

used = np.zeros((ATLAS, ATLAS), bool)
for r in regions.values():
    x, y, w, h = r['px']
    used[y:y + h, x:x + w] = True
atlas[~used] = (110, 108, 112)

for r in regions.values():
    x, y, w, h = r['px']
    i = 1.5
    r['uv_in'] = [(x + i) / ATLAS, (y + i) / ATLAS, (x + w - i) / ATLAS, (y + h - i) / ATLAS]

cv2.imwrite(os.path.join(OUT, 'MAP_atlas_2048.jpg'), atlas, [cv2.IMWRITE_JPEG_QUALITY, 88])

LW, LH = 256, 176
link = np.zeros((LH, LW, 4), np.uint8)
wire = (150, 146, 152, 255)
step = 14
for k in range(-LH, LW + LH, step):
    cv2.line(link, (k, 0), (k + LH, LH), wire, 2, cv2.LINE_AA)
    cv2.line(link, (k, LH), (k + LH, 0), wire, 2, cv2.LINE_AA)
cv2.rectangle(link, (0, 0), (LW, 9), (175, 172, 180, 255), -1)
cv2.rectangle(link, (0, 0), (11, LH), (190, 188, 196, 255), -1)
cv2.rectangle(link, (0, 0), (11, LH), (120, 118, 124, 255), 1)
link[..., 3] = np.where(link[..., 3] > 110, 255, 0)
cv2.imwrite(os.path.join(OUT, 'MAP_chainlink_256.png'), cv2.resize(link, (256, 176), interpolation=cv2.INTER_NEAREST))

PS = 256
pav = np.empty((PS, PS, 3), np.float32)
pav[:] = bgr('#7f7887')
pav *= (0.9 + 0.16 * noise(PS, PS, 32))[..., None]
slab = PS // 4
for i in range(4):
    for j in range(4):
        off = (slab // 2) if i % 2 else 0
        x0 = (j * slab + off) % PS
        tone = 0.9 + 0.18 * rng.random()
        xs = [(x0 + k) % PS for k in range(slab)]
        pav[i * slab:(i + 1) * slab, xs] *= tone
for i in range(5):
    y = i * slab % PS
    cv2.line(pav, (0, y), (PS, y), bgr('#3f3944').tolist(), 2)
for i in range(4):
    off = (slab // 2) if i % 2 else 0
    for j in range(5):
        x = (j * slab + off) % PS
        cv2.line(pav, (x, i * slab), (x, (i + 1) * slab), bgr('#3f3944').tolist(), 2)
for _ in range(14):
    x, y = rng.integers(0, PS, 2)
    pts = [(int(x), int(y))]
    for _k in range(5):
        x, y = x + rng.integers(-14, 15), y + rng.integers(-14, 15)
        pts.append((int(x) % PS, int(y) % PS))
    for a, b in zip(pts, pts[1:]):
        if abs(a[0] - b[0]) < 40 and abs(a[1] - b[1]) < 40:
            cv2.line(pav, a, b, bgr('#6a6372').tolist(), 1, cv2.LINE_AA)
cv2.imwrite(os.path.join(OUT, 'MAP_pavement_256.jpg'), np.clip(pav, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])

RS = 256
roof = np.empty((RS, RS, 3), np.float32)
roof[:] = bgr('#b3a7b6')
roof *= (0.9 + 0.14 * noise(RS, RS, 48))[..., None]
cell = RS // 5
for i in range(5):
    for j in range(5):
        roof[i * cell:(i + 1) * cell, j * cell:(j + 1) * cell] *= 0.94 + 0.1 * rng.random()
for k in range(6):
    cv2.line(roof, (0, k * cell), (RS, k * cell), bgr('#8d8291').tolist(), 2)
    cv2.line(roof, (k * cell, 0), (k * cell, RS), bgr('#8d8291').tolist(), 2)
stain = noise(RS, RS, 96, 2)
roof *= (1 - 0.18 * np.clip((stain - 0.55) * 4, 0, 1))[..., None]
cv2.imwrite(os.path.join(OUT, 'MAP_roof_256.jpg'), np.clip(roof, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 85])

meta = {
    'atlas': 'MAP_atlas_2048.jpg', 'size': ATLAS, 'regions': regions,
    'floor': {'world_size_m': [FLOOR_W, FLOOR_D], 'src_quad_px': FLOOR_SRC},
    'facade': {'size_m': [12.8, 12.0]},
    'wall_dvor': {'size_m': [10.0, 2.6], 'segments_m': {'plain': 2.0, 'dvor': 4.5, 'arrow': 2.7}},
    'chainlink': {'file': 'MAP_chainlink_256.png', 'tile_m': [2.5, 1.7]},
    'pavement': {'file': 'MAP_pavement_256.jpg', 'tile_m': [2.0, 2.0]},
    'roof': {'file': 'MAP_roof_256.jpg', 'tile_m': [3.0, 3.0]},
}
with open(os.path.join(OUT, 'atlas.json'), 'w') as f:
    json.dump(meta, f, indent=1, ensure_ascii=False)
print('atlas', os.path.getsize(os.path.join(OUT, 'MAP_atlas_2048.jpg')), 'bytes;',
      'chainlink', os.path.getsize(os.path.join(OUT, 'MAP_chainlink_256.png')), 'bytes')
