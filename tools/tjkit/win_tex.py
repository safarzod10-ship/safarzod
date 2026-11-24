"""python3 -I win_tex.py -> work/texout/window_*.jpg"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texlib import *
import win_layout as WL
OUT = os.path.join(os.path.dirname(HERE), 'work', 'texout')
base_a, orm_a, nrm_a = new_atlas(WL.S)
used = np.zeros((WL.S, WL.S), bool)
def put(name, b, o, n):
    paste(base_a, WL.ISL[name], b); paste(orm_a, WL.ISL[name], o); paste(nrm_a, WL.ISL[name], n)
    x0, y0, w, h, _ = WL.ISL[name]; used[y0:y0 + h, x0:x0 + w] = True
x0, y0, w, h, px = WL.ISL['front']
cv = Canvas(w * px, h * px, px)
X, Y = cv.full_xy()
lines = WL.hankin_lines()
segs = [((a[0] + WL.W / 2, a[1]), (b[0] + WL.W / 2, b[1])) for a, b in lines]
hw = WL.STRIP_W / 2
Dd = dist_to_segments(cv, segs, hw * 3)
s = np.clip((hw - Dd) / (hw * 0.45), 0, 1); s = s * s * (3 - 2 * s)
groove = np.clip(1 - Dd / (hw * 0.2), 0, 1)
hl = -0.004 * (1 - s) - 0.0012 * groove
# frame region: chip band + bead
inner = (X > WL.IN_X0 + WL.W / 2) & (X < WL.IN_X1 + WL.W / 2) & (Y > WL.IN_Z0) & (Y < WL.IN_Z1)
dd = np.minimum.reduce([X - 0, WL.W - X, Y - 0, WL.H - Y])
hf = np.zeros_like(hl)
band = (dd > 0.02) & (dd < 0.06)
t = np.where(np.minimum(X, WL.W - X) < np.minimum(Y, WL.H - Y), Y, X)
saw = np.abs(((t / 0.04) % 1) - 0.5) * 2
u = (dd - 0.02) / 0.04
pyr = np.minimum(np.abs(u - saw * 0.0) , 1)
chip = -0.005 * np.clip(1 - np.abs(u - 0.5) * 2 - np.abs(saw - 0.5) * 1.2, 0, 1)
hf = np.where(band, chip, 0) - 0.002 * np.exp(-((dd - 0.075) / 0.004) ** 2)
h_all = np.where(inner, hl, hf)
b, o, n = wood_finish(h_all, px, None, True, seed=41, streaks=0.2)
put('front', b, o, n)
x0, y0, w, h, px = WL.ISL['plain']
cv = Canvas(w * px, h * px, px)
b, o, n = wood_finish(cv.h, px, None, True, seed=42)
put('plain', b, o, n)
base_a, orm_a, nrm_a = dilate_atlas([base_a, orm_a, nrm_a], used)
save_set(os.path.join(OUT, 'window'), base_a, orm_a, nrm_a)
print('window textures done', len(lines), 'lines')
