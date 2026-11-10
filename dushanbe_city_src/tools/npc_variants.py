"""NPC clothing variants of the hero's texture atlas (own work): recolour the striped chapan (hue
shift / desaturate), the white shirt and trousers (tint), the skin a little; boots / hat stay.
usage: python3 -I npc_variants.py <player_color.jpg> <out_dir>"""
import sys, colorsys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert("RGB")).astype(np.float32) / 255.0
r, g, b = im[..., 0], im[..., 1], im[..., 2]
mx = im.max(-1); mn = im.min(-1)
v = mx
s = np.where(mx > 1e-4, (mx - mn) / np.maximum(mx, 1e-4), 0)
# hue 0..1
d = np.maximum(mx - mn, 1e-5)
h = np.where(mx == r, ((g - b) / d) % 6, np.where(mx == g, (b - r) / d + 2, (r - g) / d + 4)) / 6.0
skin = (h > 0.0) & (h < 0.11) & (s > 0.18) & (s < 0.68) & (v > 0.32) & (r > g) & (g > b)
white = (s < 0.16) & (v > 0.55)
dark = v < 0.22
chapan = ~skin & ~white & ~dark

VARIANTS = [
    # hue shift, chapan sat, chapan val, shirt rgb, skin factor
    (0.33, 1.0, 1.0, (0.62, 0.74, 0.92), 0.92),
    (0.55, 0.9, 0.95, (0.62, 0.62, 0.64), 1.04),
    (0.14, 1.0, 1.05, (0.86, 0.79, 0.62), 0.86),
    (0.72, 0.9, 1.0, (0.70, 0.84, 0.70), 0.97),
    (0.45, 0.5, 0.75, (0.20, 0.24, 0.38), 1.0),
    (0.0, 0.12, 0.42, (0.95, 0.95, 0.95), 0.9),     # dark modern suit, white shirt
    (0.9, 1.0, 1.0, (0.80, 0.30, 0.28), 1.06),
    (0.25, 0.2, 0.55, (0.35, 0.42, 0.30), 0.84),
]
for k, (dh, cs, cv, shirt, sk) in enumerate(VARIANTS):
    o = im.copy()
    # chapan: hue shift via HSV
    hh = (h + dh) % 1.0
    ss = np.clip(s * cs, 0, 1)
    vv = np.clip(v * cv, 0, 1)
    i = np.floor(hh * 6).astype(int) % 6
    f = hh * 6 - np.floor(hh * 6)
    p = vv * (1 - ss); q = vv * (1 - f * ss); t = vv * (1 - (1 - f) * ss)
    rgb = np.stack([np.choose(i, [vv, q, p, p, t, vv]), np.choose(i, [t, vv, vv, q, p, p]), np.choose(i, [p, p, t, vv, vv, q])], -1)
    o[chapan] = rgb[chapan]
    # white cloth: keep the shading (value) with the new colour
    o[white] = (v[white][:, None] / 0.9) * np.array(shirt)[None, :]
    o[skin] = im[skin] * sk
    Image.fromarray((np.clip(o, 0, 1) * 255).astype(np.uint8)).resize((1024, 1024), Image.LANCZOS).save("%s/npc_%d.jpg" % (out, k), quality=90)
print("variants:", len(VARIANTS), "skin px %.1f%% white %.1f%% chapan %.1f%%" % (skin.mean() * 100, white.mean() * 100, chapan.mean() * 100))
