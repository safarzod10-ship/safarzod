"""
TERRIA town hall, levels 1-10 (3x3 cells = 48 m lot).

  blender -b --python tools/blender/townhall.py -- <out.png> <level> [resolution] [samples]

The town hall is the one building with a bell tower, later a clock, always a
flag, and blue-and-gold accents; nothing else in the village looks like it.
It grows from a log hut with a bell on its ridge to a marble palace with a
golden dome:

   1  log hall, bell-cote on the ridge, porch, flag pole      (earth yard)
   2  log hall on stone, wooden bell tower                    (gravel)
   3  stone and half-timber, tower with a blue spire          (cobbles)
   4  bigger, the tower gets clocks, chimneys, banners        (cobbles)
   5  all stone, east wing, tall clock tower                  (cobbles)
   6  brick with stone trim, hip roof, turrets, balcony       (paving)
   7  limestone, columned portico, clock tower with a cupola  (paving)
   8  palace: two wings, central tower, turrets, fountain     (paving)
   9  marble, copper dome, twin clock towers, portico         (marble)
  10  marble and gold: golden dome, four towers, great spire  (marble)

Every level is framed by the same camera, so they keep one scale.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from parts import (G, Build, ashlar, balustrade, banner, barrels, bell, brick_walls, clock, column, cone, core, crates,  # noqa: E402
                   dome, door, fence, finial, flag, fountain, gable, hip, lamp_post, lantern, logs, obelisk, palette, pediment,
                   plaster_wall, plot, pyramid, steps, string_course, timber_frame, well, window)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'townhall_1.png')
LEVEL = int(argv[1]) if len(argv) > 1 else 1
RES = int(argv[2]) if len(argv) > 2 else 1300
SAMPLES = int(argv[3]) if len(argv) > 3 else 96


def belfry_posts(B, x0, x1, y0, y1, z, h, key='timber', w=0.55):
    for (x, y) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        B.p(key).box((w, w, h), (x + (w / 2 if x == x0 else -w / 2), y + (w / 2 if y == y0 else -w / 2), z + h / 2))
    B.p(key).box((x1 - x0 + 0.5, y1 - y0 + 0.5, 0.45), ((x0 + x1) / 2, (y0 + y1) / 2, z + h))


def piers(B, x0, x1, y0, y1, z, h, key='stone', w=1.3):
    """Belfry of four stone piers with an arch-like lintel on the two visible sides."""
    for (x, y) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
        B.p(key).box((w, w, h), (x + (w / 2 if x == x0 else -w / 2), y + (w / 2 if y == y0 else -w / 2), z + h / 2))
    B.p(key).box((x1 - x0 + 0.6, y1 - y0 + 0.6, 0.8), ((x0 + x1) / 2, (y0 + y1) / 2, z + h + 0.4))
    B.p(key).box((x1 - x0, y1 - y0, 0.5), ((x0 + x1) / 2, (y0 + y1) / 2, z + 0.25))


def chimney(B, x, y, z0, z1, key='stone'):
    rows = max(2, int((z1 - z0) / 0.8))
    for r in range(rows):
        z = z0 + r * (z1 - z0) / rows
        B.p(key).box((1.9, 1.9, (z1 - z0) / rows - 0.06), (x, y, z + (z1 - z0) / rows / 2))
    B.p(key).box((2.5, 2.5, 0.45), (x, y, z1 + 0.2), rnd=0.2)
    B.p(key).box((1.2, 1.2, 0.5), (x, y, z1 + 0.6), rnd=0.05)


def round_tower(B, cx, cy, r, z0, z1, key='lime', roof_h=9.0, roof='slate', trim='trim', windows=2):
    B.p(key, smooth=True, bevel=0.0).lathe([(r, z0), (r, z1)], (cx, cy, 0), segments=40)
    B.p(trim, smooth=True, bevel=0.0).lathe([(r * 1.08, z1 - 0.6), (r * 1.12, z1 - 0.3), (r * 1.12, z1), (r * 0.5, z1 + 0.01)], (cx, cy, 0), segments=40)
    B.p(trim, smooth=True, bevel=0.0).lathe([(r * 1.06, z0), (r * 1.06, z0 + 0.8), (r, z0 + 1.0)], (cx, cy, 0), segments=40)
    for k in range(windows):
        z = z0 + (z1 - z0) * (0.35 + 0.35 * k)
        # a narrow window on the camera-facing side (south-east)
        B.p('glass', bevel=0.0).box((0.9, 0.3, 1.8), (cx + r * 0.72, cy - r * 0.72, z), (0, 0, math.radians(45)))
        B.p(trim).box((1.3, 0.35, 0.3), (cx + r * 0.74, cy - r * 0.74, z - 1.0), (0, 0, math.radians(45)))
    top = cone(B, cx, cy, r * 1.18, z1, roof_h, key=roof)
    return finial(B, cx, cy, top - 0.2, h=2.2)


# ----------------------------------------------------------------------------
def level1(B):
    plot(B, 'earth')
    x0, x1, y0, y1 = -12.0, 12.0, -6.0, 8.0
    zf = G + 0.6
    B.p('stone').box((x1 - x0 + 1.0, y1 - y0 + 1.0, 0.6), (0, (y0 + y1) / 2, G + 0.3))
    logs(B, x0, x1, y0, y1, zf, zf + 5.6)
    zr = gable(B, x0, x1, y0, y1, zf + 5.6, pitch=42, over=1.3, end_over=1.1, tile='shingle', wall='planks', tw=1.3, tl=1.7)
    # bell-cote on the ridge
    bx, by, zb = 3.0, (y0 + y1) / 2, zr - 0.6
    belfry_posts(B, bx - 1.5, bx + 1.5, by - 1.5, by + 1.5, zb, 3.2, w=0.42)
    bell(B, bx, by, zb + 0.7, 0.68)
    B.p('timber').box((2.8, 0.3, 0.3), (bx, by, zb + 2.8))
    pyramid(B, bx, by, 1.7, zb + 3.4, 2.8, tile='shingle', caps='timber', over=0.45, tw=0.8, tl=1.0)
    B.points['bell'] = (bx, by, zb + 1.5)
    # porch over the door
    door(B, (0, y0 - 0.35, zf), 'S', w=2.4, h=3.4, arch_key=None, planks='planks')
    for x in (-2.1, 2.1):
        B.p('timber').box((0.42, 0.42, 3.6), (x, y0 - 2.9, zf + 1.8))
    gable(B, -2.5, 2.5, y0 - 3.2, y0 - 0.3, zf + 3.6, pitch=40, over=0.5, end_over=0.35, tile='shingle', wall='planks', along='y', tw=1.0, tl=1.3, barge=None)
    steps(B, (0, y0 - 0.3, G), 'S', 2.6, n=1, key='planks', depth=1.3, rise=0.55)
    for x in (-8.0, -4.6, 4.6, 8.0):
        window(B, (x, y0 - 0.3, zf + 2.8), 'S', w=1.3, h=1.6, shutters=True, surround=None)
    for y in (-2.0, 2.0, 5.5):
        window(B, (x1 + 0.3, y, zf + 2.8), 'E', w=1.3, h=1.6, shutters=True, surround=None)
    B.points['flag'] = flag(B, 6.5, -10.5, G, pole=12, size=(3.8, 2.3), pole_key='timber')
    well(B, -15.5, -12.5)
    barrels(B, [(-17.0, -2.0), (-18.3, -0.6)])
    crates(B, [(-17.0, 2.2, 1.3), (-18.2, 3.5, 1.1)])
    # firewood stacked against the east wall
    for i in range(5):
        for j in range(4 - i // 2):
            B.p('logs', bevel=0.16).box((0.48, 3.6, 0.48), (x1 + 1.5 + j * 0.5 + (i % 2) * 0.25, 2.0, G + 0.25 + i * 0.45))
    # split-rail fence around the yard, open at the front
    for a, b in (((-21.5, -21.5), (-4.0, -21.5)), ((4.0, -21.5), (21.5, -21.5)), ((21.5, -21.5), (21.5, 21.5)), ((-21.5, 21.5), (21.5, 21.5)), ((-21.5, -21.5), (-21.5, 21.5))):
        fence(B, a, b)


def level2(B):
    plot(B, 'gravel')
    x0, x1, y0, y1 = -13.5, 6.5, -4.5, 9.5
    zf = G + 1.2
    ashlar(B, x0, x1, y0, y1, G, zf, rows=2, block=(1.0, 1.8), depth=0.7, quoins=False)
    logs(B, x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, zf, zf + 5.6)
    gable(B, x0 + 0.3, x1 - 0.3, y0 + 0.3, y1 - 0.3, zf + 5.6, pitch=45, over=1.3, tile='shingle', wall='planks', tw=1.3, tl=1.7)
    # the wooden bell tower
    tx0, tx1, ty0, ty1 = 6.5, 13.5, -7.5, -0.5
    cx, cy = (tx0 + tx1) / 2, (ty0 + ty1) / 2
    ashlar(B, tx0, tx1, ty0, ty1, G, zf + 0.4, rows=2, block=(1.0, 1.8), depth=0.7, quoins=False)
    logs(B, tx0 + 0.3, tx1 - 0.3, ty0 + 0.3, ty1 - 0.3, zf + 0.4, zf + 10.6)
    zt = zf + 10.6
    B.p('planks').box((tx1 - tx0 + 0.6, ty1 - ty0 + 0.6, 0.4), (cx, cy, zt + 0.2))
    belfry_posts(B, tx0, tx1, ty0, ty1, zt, 4.2)
    for (a, b) in (((tx0, ty0), (tx1, ty0)), ((tx1, ty0), (tx1, ty1))):
        B.p('timber').box((abs(b[0] - a[0]) or 0.3, abs(b[1] - a[1]) or 0.3, 0.3), ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, zt + 1.3))
    bell(B, cx, cy, zt + 0.9, 0.9)
    B.p('timber').box((tx1 - tx0, 0.4, 0.4), (cx, cy, zt + 3.6))
    top = pyramid(B, cx, cy, (tx1 - tx0) / 2 + 0.3, zt + 4.4, 7.0, tile='shingle', caps='timber', over=0.7, tw=0.9, tl=1.2)
    B.points['flag'] = flag(B, cx, cy, top - 0.5, pole=4.5, size=(3.8, 2.3))
    B.points['bell'] = (cx, cy, zt + 2)
    door(B, (-3.5, y0 + 0.0, zf), 'S', w=2.6, h=3.6, arch_key=None, planks='door')
    steps(B, (-3.5, y0, G), 'S', 3.0, n=3, key='stone', depth=0.7, rise=0.4)
    for x in (-10.5, -7.0, 0.5, 4.0):
        window(B, (x, y0 - 0.0, zf + 3.0), 'S', w=1.4, h=1.7, shutters=True, surround=None)
    for y in (2.0, 6.0):
        window(B, (x1 + 0.0, y, zf + 3.0), 'E', w=1.4, h=1.7, shutters=True, surround=None)
    window(B, (tx1 + 0.0, cy, zf + 6.5), 'E', w=1.2, h=1.6, shutters=True, surround=None)
    window(B, (cx, ty0, zf + 6.5), 'S', w=1.2, h=1.6, shutters=True, surround=None)
    lantern(B, (-5.6, y0 + 0.2, zf + 3.6), 'S')
    banner(B, (cx, ty0 - 0.1, zf + 3.6), 'S', w=1.5, h=2.8, key='banner_blue')
    barrels(B, [(-17.0, -2.0), (-18.2, -0.6)])
    crates(B, [(-17.0, 2.5, 1.3), (-18.0, 3.8, 1.0)])


def level3(B):
    plot(B, 'cobble')
    x0, x1, y0, y1 = -13.0, 13.0, -5.0, 9.0
    z1 = G + 5.4
    z2 = z1 + 5.0
    J = 0.5
    ashlar(B, x0, x1, y0, y1, G, z1, rows=6)
    ux0, ux1, uy0, uy1 = x0 - J, x1 + J, y0 - J, y1 + J
    plaster_wall(B, ux0 + 0.15, ux1 - 0.15, uy0 + 0.15, uy1 - 0.15, z1, z2)
    timber_frame(B, ux0, ux1, uy0, uy1, z1, z2)
    gable(B, ux0, ux1, uy0, uy1, z2, pitch=50, over=1.2, tile='roof', wall='plaster')
    # front tower with an open belfry and a blue spire
    tx0, tx1, ty0, ty1 = -3.6, 3.6, -9.6, -2.4
    cx, cy = 0.0, (ty0 + ty1) / 2
    ashlar(B, tx0, tx1, ty0, ty1, G, G + 7.0, rows=7)
    string_course(B, tx0, tx1, ty0, ty1, G + 7.2)
    plaster_wall(B, tx0 + 0.15, tx1 - 0.15, ty0 + 0.15, ty1 - 0.15, G + 7.0, G + 12.6)
    timber_frame(B, tx0, tx1, ty0, ty1, G + 7.0, G + 12.6, spacing=3.6)
    zt = G + 12.6
    B.p('timber').box((tx1 - tx0 + 0.4, ty1 - ty0 + 0.4, 0.4), (cx, cy, zt + 0.2))
    belfry_posts(B, tx0, tx1, ty0, ty1, zt, 4.4)
    bell(B, cx, cy, zt + 0.9, 0.95)
    B.p('timber').box((tx1 - tx0, 0.45, 0.45), (cx, cy, zt + 3.8))
    top = pyramid(B, cx, cy, (tx1 - tx0) / 2 + 0.3, zt + 4.6, 10.0, tile='slate', caps='slate_dark', over=0.9, tw=0.9, tl=1.3)
    top = finial(B, cx, cy, top - 0.3, h=2.0)
    B.points['flag'] = flag(B, cx, cy, top - 0.3, pole=0.4, size=(4.0, 2.4))
    door(B, (0, ty0 - 0.1, G), 'S', w=3.0, h=4.2)
    steps(B, (0, ty0 - 0.2, G), 'S', 3.4, n=2, key='stone', depth=1.0)
    for x in (-10.0, -6.5, 6.5, 10.0):
        window(B, (x, y0 - 0.05, G + 2.9), 'S', w=1.5, h=2.4)
        window(B, (x, uy0 - 0.02, z1 + 2.5), 'S', w=1.4, h=2.0, shutters=True, surround=None)
    for y in (-1.5, 2.5, 6.0):
        window(B, (x1 + 0.05, y, G + 2.9), 'E', w=1.5, h=2.4)
        window(B, (ux1 + 0.02, y, z1 + 2.5), 'E', w=1.4, h=2.0, shutters=True, surround=None)
    window(B, (tx1 + 0.02, cy, G + 9.8), 'E', w=1.2, h=1.7, surround=None)
    window(B, (cx, ty0 - 0.02, G + 9.8), 'S', w=1.2, h=1.7, surround=None)
    chimney(B, 7.0, 5.0, z2, z2 + 8.5)
    for x in (-4.6, 4.6):
        banner(B, (x, y0 - 0.1, G + 3.6), 'S', w=1.3, h=2.8)
    lantern(B, (-2.4, ty0 - 0.2, G + 4.6), 'S')
    lantern(B, (2.4, ty0 - 0.2, G + 4.6), 'S')
    barrels(B, [(-17.0, -2.0), (-18.0, -0.6)])


def level4(B):
    plot(B, 'cobble')
    x0, x1, y0, y1 = -15.5, 15.5, -6.5, 11.0
    F1 = G + 7.2
    F2 = F1 + 6.2
    J = 0.6
    ashlar(B, x0, x1, y0, y1, G, F1, rows=7)
    ux0, ux1, uy0, uy1 = x0 - J, x1 + J, y0 - J, y1 + J
    plaster_wall(B, ux0 + 0.15, ux1 - 0.15, uy0 + 0.15, uy1 - 0.15, F1, F2)
    timber_frame(B, ux0, ux1, uy0, uy1, F1, F2)
    for i in range(int((ux1 - ux0) / 1.5)):
        B.p('timber').box((0.45, J + 0.5, 0.5), (ux0 + 0.8 + i * 1.5, y0 - J / 2 + 0.1, F1 - 0.05))
    zr = gable(B, ux0, ux1, uy0, uy1, F2, pitch=52, over=1.3, tile='roof', wall='plaster')
    tx0, tx1, ty0, ty1 = -5.2, 5.2, -14.2, -3.8
    cx, cy = 0.0, (ty0 + ty1) / 2
    ashlar(B, tx0, tx1, ty0, ty1, G, G + 9.6, rows=9)
    string_course(B, tx0, tx1, ty0, ty1, G + 9.8)
    plaster_wall(B, tx0 + 0.15, tx1 - 0.15, ty0 + 0.15, ty1 - 0.15, G + 9.6, G + 19.0)
    timber_frame(B, tx0, tx1, ty0, ty1, G + 9.6, G + 19.0, spacing=5.0)
    clock(B, (cx, ty0 - 0.1, G + 15.0), 'S', r=2.2)
    clock(B, (tx1 + 0.1, cy, G + 15.0), 'E', r=2.2)
    zt = G + 19.0
    B.p('timber').box((tx1 - tx0 + 0.5, ty1 - ty0 + 0.5, 0.45), (cx, cy, zt + 0.2))
    belfry_posts(B, tx0, tx1, ty0, ty1, zt, 5.6, w=0.7)
    for (a, b) in (((tx0, ty0), (tx1, ty0)), ((tx1, ty0), (tx1, ty1))):
        balustrade(B, a, b, zt + 0.4, h=1.2, key='timber', spacing=0.9)
    bell(B, cx, cy, zt + 1.2, 1.2)
    B.p('timber').box((tx1 - tx0, 0.5, 0.5), (cx, cy, zt + 4.7))
    top = pyramid(B, cx, cy, (tx1 - tx0) / 2 + 0.4, zt + 5.8, 15.0, tile='slate', caps='slate_dark', over=1.2, tw=1.0, tl=1.4)
    top = finial(B, cx, cy, top - 0.3, h=2.6)
    B.points['flag'] = flag(B, cx, cy, top - 0.3, pole=0.4, size=(5.0, 3.0))
    door(B, (0, ty0 - 0.1, G), 'S', w=3.4, h=4.6)
    steps(B, (0, ty0 - 0.2, G), 'S', 3.8, n=3)
    for x in (-12.5, -8.5, 8.5, 12.5):
        window(B, (x, y0 - 0.05, G + 3.7), 'S', w=1.6, h=2.9)
        window(B, (x, uy0 - 0.02, F1 + 3.0), 'S', w=1.5, h=2.2, shutters=True, surround=None)
    for y in (-2.5, 2.0, 6.5):
        window(B, (x1 + 0.05, y, G + 3.7), 'E', w=1.6, h=2.9)
        window(B, (ux1 + 0.02, y, F1 + 3.0), 'E', w=1.5, h=2.2, shutters=True, surround=None)
    window(B, (ux1 + 0.05, (y0 + y1) / 2, F2 + 3.6), 'E', w=1.4, h=2.0, surround=None)
    window(B, (tx1 + 0.02, cy, G + 11.6), 'E', w=1.3, h=1.7, surround=None)
    chimney(B, -10.0, 6.5, F2 + 2.0, zr + 3.0)
    chimney(B, 10.5, 6.5, F2 + 2.0, zr + 3.0)
    for x in (-6.8, 6.8):
        banner(B, (x, y0 - 0.1, G + 4.4), 'S', w=1.5, h=3.2)
    lantern(B, (-2.7, ty0 - 0.2, G + 5.0), 'S')
    lantern(B, (2.7, ty0 - 0.2, G + 5.0), 'S')
    barrels(B, [(-19.0, -3.0), (-20.2, -1.5)])
    crates(B, [(-19.0, 1.0, 1.4), (-20.3, 2.4, 1.1)])


def level5(B):
    plot(B, 'cobble')
    x0, x1, y0, y1 = -15.5, 12.5, -6.0, 11.5
    ztop = G + 13.5
    ashlar(B, x0, x1, y0, y1, G, ztop, rows=13)
    string_course(B, x0, x1, y0, y1, G + 6.8)
    string_course(B, x0, x1, y0, y1, ztop - 0.2, h=0.6, out=0.45)
    zr = gable(B, x0, x1, y0, y1, ztop, pitch=48, over=1.2, tile='slate', wall='stone', tw=1.0, tl=1.4, caps='slate_dark')
    # east wing
    wx0, wx1, wy0, wy1 = 12.5, 20.5, -2.0, 11.5
    ashlar(B, wx0, wx1, wy0, wy1, G, G + 10.5, rows=10)
    string_course(B, wx0, wx1, wy0, wy1, G + 10.4, h=0.5, out=0.4)
    gable(B, wx0, wx1, wy0, wy1, G + 10.5, pitch=48, over=1.0, tile='slate', wall='stone', along='y', tw=1.0, tl=1.4, caps='slate_dark', barge=None)
    # clock tower
    tx0, tx1, ty0, ty1 = -5.2, 5.2, -13.0, -2.6
    cx, cy = 0.0, (ty0 + ty1) / 2
    ashlar(B, tx0, tx1, ty0, ty1, G, G + 26.0, rows=24)
    for z in (G + 6.8, G + 17.0, G + 25.8):
        string_course(B, tx0, tx1, ty0, ty1, z)
    clock(B, (cx, ty0 - 0.3, G + 21.4), 'S', r=2.4)
    clock(B, (tx1 + 0.3, cy, G + 21.4), 'E', r=2.4)
    zt = G + 26.0
    piers(B, tx0, tx1, ty0, ty1, zt, 5.4)
    bell(B, cx, cy, zt + 1.0, 1.3)
    top = pyramid(B, cx, cy, (tx1 - tx0) / 2 + 0.5, zt + 6.2, 16.0, tile='slate', caps='gold', over=1.2, tw=1.0, tl=1.4)
    top = finial(B, cx, cy, top - 0.3, h=3.0)
    B.points['flag'] = flag(B, cx, cy, top - 0.3, pole=0.4, size=(5.4, 3.2))
    door(B, (0, ty0 - 0.1, G), 'S', w=3.6, h=5.0)
    steps(B, (0, ty0 - 0.2, G), 'S', 4.0, n=3)
    for x in (-12.5, -8.5, 8.5):
        window(B, (x, y0 - 0.05, G + 3.4), 'S', w=1.7, h=2.6, arch=True)
        window(B, (x, y0 - 0.05, G + 10.0), 'S', w=1.6, h=2.6)
    for y in (-3.0, 1.5):
        window(B, (x1 + 0.05, y, G + 3.4), 'S' if False else 'E', w=1.7, h=2.6, arch=True)
        window(B, (x1 + 0.05, y, G + 10.0), 'E', w=1.6, h=2.6)
    for y in (2.5, 7.0):
        window(B, (wx1 + 0.05, y, G + 3.4), 'E', w=1.7, h=2.6, arch=True)
        window(B, (wx1 + 0.05, y, G + 7.8), 'E', w=1.6, h=2.2)
    window(B, (16.5, wy0 - 0.05, G + 3.4), 'S', w=1.7, h=2.6, arch=True)
    window(B, (16.5, wy0 - 0.05, G + 7.8), 'S', w=1.6, h=2.2)
    window(B, (tx1 + 0.05, cy, G + 12.0), 'E', w=1.4, h=2.4, arch=True)
    window(B, (cx, ty0 - 0.05, G + 12.0), 'S', w=1.4, h=2.4, arch=True)
    chimney(B, -10.0, 7.0, ztop + 2.0, zr + 3.0)
    for x in (-6.6, 6.6):
        banner(B, (x, y0 - 0.1, G + 5.0), 'S', w=1.6, h=3.6, key='banner_blue')
    lantern(B, (-3.0, ty0 - 0.2, G + 5.4), 'S')
    lantern(B, (3.0, ty0 - 0.2, G + 5.4), 'S')
    flag(B, 16.5, 4.0, G + 10.5 + 4.0, pole=5.0, size=(3.6, 2.2))
    lamp_post(B, -6.5, -17.0)
    lamp_post(B, 6.5, -17.0)


def level6(B):
    plot(B, 'paved')
    x0, x1, y0, y1 = -16.0, 16.0, -6.0, 12.0
    ztop = G + 14.5
    brick_walls(B, x0, x1, y0, y1, G, ztop)
    string_course(B, x0, x1, y0, y1, G + 7.2, key='trim', h=0.45, out=0.3)
    string_course(B, x0, x1, y0, y1, ztop, key='trim', h=0.7, out=0.5)
    string_course(B, x0, x1, y0, y1, G + 0.6, key='stone', h=1.2, out=0.25)
    hip(B, x0, x1, y0, y1, ztop + 0.3, pitch=42, over=1.0, tile='slate', caps='gold', tw=1.0, tl=1.4)
    for (cx_, cy_) in ((-16.0, -6.0), (16.0, -6.0)):
        round_tower(B, cx_, cy_, 3.3, G, G + 19.0, key='brick', roof_h=10.0, trim='trim')
    tx0, tx1, ty0, ty1 = -5.5, 5.5, -13.5, -2.5
    cx, cy = 0.0, (ty0 + ty1) / 2
    brick_walls(B, tx0, tx1, ty0, ty1, G, G + 28.5)
    for z in (G + 7.2, G + 18.0):
        string_course(B, tx0, tx1, ty0, ty1, z, key='trim', h=0.45, out=0.3)
    clock(B, (cx, ty0 - 0.3, G + 23.0), 'S', r=2.5)
    clock(B, (tx1 + 0.3, cy, G + 23.0), 'E', r=2.5)
    zt = G + 28.5
    B.p('trim').box((tx1 - tx0 + 2.0, ty1 - ty0 + 2.0, 0.6), (cx, cy, zt))
    for (a, b) in (((tx0 - 1.0, ty0 - 1.0), (tx1 + 1.0, ty0 - 1.0)), ((tx1 + 1.0, ty0 - 1.0), (tx1 + 1.0, ty1 + 1.0))):
        balustrade(B, a, b, zt + 0.3, h=1.2)
    piers(B, tx0 + 0.5, tx1 - 0.5, ty0 + 0.5, ty1 - 0.5, zt + 0.3, 5.4, key='trim', w=1.2)
    bell(B, cx, cy, zt + 1.4, 1.3)
    top = pyramid(B, cx, cy, (tx1 - tx0) / 2, zt + 6.6, 19.0, tile='slate', caps='gold', over=1.0, tw=1.0, tl=1.4)
    top = finial(B, cx, cy, top - 0.3, h=3.2)
    B.points['flag'] = flag(B, cx, cy, top - 0.3, pole=0.4, size=(5.6, 3.3))
    door(B, (0, ty0 - 0.1, G), 'S', w=3.8, h=5.2, arch_key='trim')
    steps(B, (0, ty0 - 0.2, G), 'S', 4.2, n=3, key='trim')
    for x in (-12.0, -8.6, 8.6, 12.0):
        window(B, (x, y0 - 0.05, G + 3.6), 'S', w=1.7, h=2.8, arch=True, surround='trim')
        window(B, (x, y0 - 0.05, G + 10.6), 'S', w=1.6, h=2.8, surround='trim')
    for y in (0.0, 4.0, 8.0):
        window(B, (x1 + 0.05, y, G + 3.6), 'E', w=1.7, h=2.8, arch=True, surround='trim')
        window(B, (x1 + 0.05, y, G + 10.6), 'E', w=1.6, h=2.8, surround='trim')
    for z in (G + 9.0, G + 14.0):
        window(B, (tx1 + 0.05, cy, z), 'E', w=1.4, h=2.4, arch=True, surround='trim')
        window(B, (cx, ty0 - 0.05, z), 'S', w=1.4, h=2.4, arch=True, surround='trim')
    for x in (-6.8, 6.8):
        banner(B, (x, y0 - 0.1, G + 5.0), 'S', w=1.7, h=3.8, key='banner_blue')
    lantern(B, (-3.2, ty0 - 0.2, G + 5.8), 'S')
    lantern(B, (3.2, ty0 - 0.2, G + 5.8), 'S')
    for (x, y) in ((-9.0, -18.0), (9.0, -18.0), (19.5, -12.0)):
        lamp_post(B, x, y)


def level7(B):
    plot(B, 'paved')
    x0, x1, y0, y1 = -17.0, 17.0, -5.0, 12.5
    ztop = G + 15.5
    ashlar(B, x0, x1, y0, y1, G, ztop, key='lime', rows=12, block=(2.0, 3.2), quoins=False)
    string_course(B, x0, x1, y0, y1, G + 0.7, key='lime', h=1.4, out=0.3)
    string_course(B, x0, x1, y0, y1, ztop, key='trim', h=0.9, out=0.6)
    hip(B, x0, x1, y0, y1, ztop + 0.5, pitch=32, over=0.9, tile='slate', caps='gold', tw=1.0, tl=1.4)
    # portico
    px0, px1 = -9.5, 9.5
    steps(B, (0, y0 - 6.0, G), 'S', 18.0, n=3, key='lime', depth=0.8)
    B.p('lime').box((px1 - px0 + 1.0, 6.4, 1.0), (0, y0 - 3.2, G + 0.5))
    for x in (-7.2, -2.4, 2.4, 7.2):
        column(B, x, y0 - 5.0, G + 1.0, 11.0, r=0.85)
    B.p('lime').box((px1 - px0 + 0.6, 6.6, 1.6), (0, y0 - 3.1, G + 12.9))
    B.p('trim').box((px1 - px0 + 1.0, 6.9, 0.5), (0, y0 - 3.1, G + 13.9))
    pediment(B, px0 - 0.3, px1 + 0.3, y0 - 6.5, G + 14.1, 4.2, depth=6.6)
    door(B, (0, y0 - 0.05, G + 1.0), 'S', w=3.6, h=5.6, arch_key='trim')
    # clock tower rising from the roof with a copper cupola
    tx0, tx1, ty0, ty1 = -4.6, 4.6, -1.0, 8.2
    cx, cy = 0.0, (ty0 + ty1) / 2
    ashlar(B, tx0, tx1, ty0, ty1, ztop - 1.0, G + 35.0, key='lime', rows=14, block=(1.8, 2.8))
    string_course(B, tx0, tx1, ty0, ty1, G + 35.0, key='trim', h=0.8, out=0.5)
    clock(B, (cx, ty0 - 0.3, G + 29.5), 'S', r=2.6)
    clock(B, (tx1 + 0.3, cy, G + 29.5), 'E', r=2.6)
    zt = G + 35.4
    for k in range(8):
        a = 2 * math.pi * k / 8
        column(B, cx + math.cos(a) * 3.6, cy + math.sin(a) * 3.6, zt, 4.6, r=0.42, key='trim')
    bell(B, cx, cy, zt + 0.6, 1.3)
    top = dome(B, cx, cy, 4.6, zt + 5.4, key='copper', ribs='gold', n_ribs=10, drum=0.6)
    top = finial(B, cx, cy, top - 0.2, h=2.6)
    B.points['flag'] = flag(B, cx, cy, top - 0.3, pole=0.4, size=(5.4, 3.2))
    for x in (-14.0, -11.5, 11.5, 14.0):
        window(B, (x, y0 - 0.05, G + 4.2), 'S', w=1.7, h=3.0, arch=True, surround='trim')
        window(B, (x, y0 - 0.05, G + 11.0), 'S', w=1.6, h=2.8, surround='trim')
    for y in (-1.5, 2.5, 6.5, 10.0):
        window(B, (x1 + 0.05, y, G + 4.2), 'E', w=1.7, h=3.0, arch=True, surround='trim')
        window(B, (x1 + 0.05, y, G + 11.0), 'E', w=1.6, h=2.8, surround='trim')
    for x in (-5.0, 5.0):
        banner(B, (x, y0 - 0.1, G + 8.0), 'S', w=1.6, h=4.0, key='banner_blue')
    flag(B, -15.5, -15.5, G, pole=13.0, size=(4.6, 2.8))
    flag(B, 15.5, -15.5, G, pole=13.0, size=(4.6, 2.8))
    for (x, y) in ((-10.0, -19.0), (10.0, -19.0), (20.0, -6.0)):
        lamp_post(B, x, y)


def level8(B):
    plot(B, 'paved')
    # main block behind, wings forward: a U open to the south
    mx0, mx1, my0, my1 = -13.0, 13.0, 0.0, 13.5
    ashlar(B, mx0, mx1, my0, my1, G, G + 17.0, key='lime', rows=13, block=(2.0, 3.2), quoins=False)
    string_course(B, mx0, mx1, my0, my1, G + 17.0, key='trim', h=0.9, out=0.6)
    hip(B, mx0, mx1, my0, my1, G + 17.5, pitch=34, over=0.9, tile='slate', caps='gold')
    for (wx0, wx1) in ((-21.0, -13.0), (13.0, 21.0)):
        ashlar(B, wx0, wx1, -13.0, 13.5, G, G + 15.0, key='lime', rows=12, block=(2.0, 3.2), quoins=False)
        string_course(B, wx0, wx1, -13.0, 13.5, G + 15.0, key='trim', h=0.8, out=0.5)
        string_course(B, wx0, wx1, -13.0, 13.5, G + 7.6, key='trim', h=0.4, out=0.25)
        hip(B, wx0, wx1, -13.0, 13.5, G + 15.4, pitch=36, over=0.8, tile='slate', caps='gold')
        for y in (-9.0, -4.5, 0.0):
            window(B, (wx1 + 0.05 if wx0 > 0 else wx1 + 0.05, y, G + 4.0), 'E', w=1.6, h=2.8, arch=True, surround='trim')
            window(B, (wx1 + 0.05, y, G + 11.0), 'E', w=1.5, h=2.6, surround='trim')
        for x in ((wx0 + wx1) / 2 - 2.0, (wx0 + wx1) / 2 + 2.0):
            window(B, (x, -13.05, G + 4.0), 'S', w=1.6, h=2.8, arch=True, surround='trim')
            window(B, (x, -13.05, G + 11.0), 'S', w=1.5, h=2.6, surround='trim')
        banner(B, ((wx0 + wx1) / 2, -13.1, G + 8.2), 'S', w=1.6, h=3.6, key='banner_blue')
    for (cx_, cy_) in ((-21.0, -13.0), (21.0, -13.0)):
        round_tower(B, cx_, cy_, 2.8, G, G + 19.5, key='lime', roof_h=9.0)
    # central tower
    tx0, tx1, ty0, ty1 = -5.0, 5.0, -7.0, 2.0
    cx, cy = 0.0, (ty0 + ty1) / 2
    ashlar(B, tx0, tx1, ty0, ty1, G, G + 33.0, key='lime', rows=24, block=(1.8, 2.8))
    for z in (G + 15.0, G + 25.0):
        string_course(B, tx0, tx1, ty0, ty1, z, key='trim', h=0.5, out=0.35)
    clock(B, (cx, ty0 - 0.3, G + 29.0), 'S', r=2.7)
    clock(B, (tx1 + 0.3, cy, G + 29.0), 'E', r=2.7)
    B.p('trim').box((tx1 - tx0 + 2.0, ty1 - ty0 + 2.0, 0.6), (cx, cy, G + 33.0))
    for (a, b) in (((tx0 - 1.0, ty0 - 1.0), (tx1 + 1.0, ty0 - 1.0)), ((tx1 + 1.0, ty0 - 1.0), (tx1 + 1.0, ty1 + 1.0))):
        balustrade(B, a, b, G + 33.3, h=1.2)
    zt = G + 33.3
    piers(B, tx0 + 0.6, tx1 - 0.6, ty0 + 0.6, ty1 - 0.6, zt, 5.6, key='trim', w=1.2)
    bell(B, cx, cy, zt + 1.4, 1.3)
    top = pyramid(B, cx, cy, (tx1 - tx0) / 2 - 0.4, zt + 6.8, 18.0, tile='slate', caps='gold', over=1.0)
    top = finial(B, cx, cy, top - 0.3, h=3.4)
    B.points['flag'] = flag(B, cx, cy, top - 0.3, pole=0.4, size=(5.8, 3.4))
    # columned porch at the foot of the tower
    steps(B, (0, ty0 - 4.0, G), 'S', 11.0, n=2, key='lime', depth=0.8)
    for x in (-4.2, -1.4, 1.4, 4.2):
        column(B, x, ty0 - 3.0, G + 0.6, 8.0, r=0.7)
    B.p('lime').box((10.6, 4.2, 1.2), (0, ty0 - 1.8, G + 9.2))
    pediment(B, -5.6, 5.6, ty0 - 4.0, G + 9.8, 3.2, depth=4.0)
    door(B, (0, ty0 - 0.05, G), 'S', w=3.6, h=5.6, arch_key='trim')
    for x in (-10.0, -7.0, 7.0, 10.0):
        window(B, (x, my0 - 0.05, G + 4.0), 'S', w=1.6, h=2.8, arch=True, surround='trim')
        window(B, (x, my0 - 0.05, G + 11.5), 'S', w=1.5, h=2.6, surround='trim')
    fountain(B, 0.0, -17.0, r=3.6)
    for (x, y) in ((-8.0, -20.0), (8.0, -20.0)):
        lamp_post(B, x, y)


def level9(B):
    plot(B, 'marble')
    x0, x1, y0, y1 = -15.0, 15.0, -4.0, 14.0
    ztop = G + 16.0
    ashlar(B, x0, x1, y0, y1, G, ztop, key='marble', rows=12, block=(2.2, 3.4), quoins=False)
    string_course(B, x0, x1, y0, y1, G + 0.7, key='marble_dark', h=1.4, out=0.3)
    string_course(B, x0, x1, y0, y1, ztop, key='gold', h=0.5, out=0.55)
    hip(B, x0, x1, y0, y1, ztop + 0.4, pitch=26, over=0.8, tile='slate', caps='gold')
    top_d = dome(B, 0.0, 5.0, 7.6, ztop + 3.0, key='copper', ribs='gold', n_ribs=14, drum=4.0)
    top_d = finial(B, 0.0, 5.0, top_d - 0.2, h=3.2)
    B.points['flag'] = flag(B, 0.0, 5.0, top_d - 0.3, pole=0.4, size=(6.0, 3.6))
    # portico of six columns
    steps(B, (0, y0 - 7.0, G), 'S', 18.0, n=3, key='marble', depth=0.8)
    B.p('marble').box((19.0, 7.4, 1.0), (0, y0 - 3.7, G + 0.5))
    for x in (-8.0, -4.8, -1.6, 1.6, 4.8, 8.0):
        column(B, x, y0 - 6.0, G + 1.0, 12.0, r=0.8, key='marble')
    B.p('marble').box((18.8, 7.4, 1.6), (0, y0 - 3.6, G + 13.8))
    B.p('gold').box((19.2, 7.6, 0.4), (0, y0 - 3.6, G + 14.8))
    pediment(B, -9.6, 9.6, y0 - 7.3, G + 15.0, 4.4, depth=7.4, key='marble')
    door(B, (0, y0 - 0.05, G + 1.0), 'S', w=3.8, h=6.0, arch_key='gold')
    # twin clock towers
    for sx in (-1, 1):
        tx0, tx1 = sx * 13.5 - 3.2, sx * 13.5 + 3.2
        ty0, ty1 = -10.5, -4.0
        cx, cy = sx * 13.5, (ty0 + ty1) / 2
        ashlar(B, tx0, tx1, ty0, ty1, G, G + 29.0, key='marble', rows=20, block=(1.6, 2.6), quoins=False)
        for z in (G + 16.0, G + 29.0):
            string_course(B, tx0, tx1, ty0, ty1, z, key='gold' if z > G + 20 else 'marble_dark', h=0.5, out=0.4)
        clock(B, (cx, ty0 - 0.3, G + 24.0), 'S', r=1.9)
        if sx > 0:
            clock(B, (tx1 + 0.3, cy, G + 24.0), 'E', r=1.9)
        zt = G + 29.3
        for k in range(6):
            a = 2 * math.pi * k / 6
            column(B, cx + math.cos(a) * 2.3, cy + math.sin(a) * 2.3, zt, 4.0, r=0.32, key='marble')
        bell(B, cx, cy, zt + 0.5, 0.95)
        top = cone(B, cx, cy, 3.6, zt + 4.4, 11.0, key='slate')
        top = finial(B, cx, cy, top - 0.2, h=2.4)
        flag(B, cx, cy, top - 0.3, pole=0.4, size=(4.0, 2.4), key='flag')
        window(B, (cx, ty0 - 0.05, G + 8.0), 'S', w=1.5, h=3.0, arch=True, surround='gold')
        window(B, (cx, ty0 - 0.05, G + 16.8 + 2.4), 'S', w=1.3, h=2.4, arch=True, surround='marble_dark')
    for y in (0.0, 4.5, 9.0):
        window(B, (x1 + 0.05, y, G + 5.0), 'E', w=1.8, h=3.4, arch=True, surround='gold')
        window(B, (x1 + 0.05, y, G + 12.0), 'E', w=1.6, h=2.8, surround='marble_dark')
    for x in (-5.0, 5.0):
        banner(B, (x, y0 - 0.1, G + 8.0), 'S', w=1.6, h=4.2, key='banner_blue')
    fountain(B, 0.0, -18.0, r=4.0)
    obelisk(B, -19.5, -19.5)
    obelisk(B, 19.5, -19.5)
    for (x, y) in ((-9.0, -20.5), (9.0, -20.5), (20.5, -2.0)):
        lamp_post(B, x, y)


def level10(B):
    plot(B, 'marble')
    x0, x1, y0, y1 = -16.0, 16.0, -6.0, 16.0
    ztop = G + 18.0
    ashlar(B, x0, x1, y0, y1, G, ztop, key='marble', rows=13, block=(2.2, 3.4), quoins=False)
    string_course(B, x0, x1, y0, y1, G + 0.8, key='marble_dark', h=1.6, out=0.3)
    string_course(B, x0, x1, y0, y1, G + 9.0, key='gold', h=0.35, out=0.3)
    string_course(B, x0, x1, y0, y1, ztop, key='gold', h=0.6, out=0.6)
    hip(B, x0, x1, y0, y1, ztop + 0.4, pitch=24, over=0.8, tile='slate', caps='gold')
    # the great golden dome on a columned drum
    dcx, dcy = 0.0, 6.0
    zd = ztop + 3.0
    for k in range(16):
        a = 2 * math.pi * k / 16
        column(B, dcx + math.cos(a) * 8.6, dcy + math.sin(a) * 8.6, zd, 5.0, r=0.45, key='marble')
    B.p('marble', smooth=True, bevel=0.0).lathe([(8.0, zd - 0.2), (8.0, zd + 5.4), (9.4, zd + 5.4), (9.4, zd + 6.2), (8.4, zd + 6.2)], (dcx, dcy, 0), segments=56)
    top_d = dome(B, dcx, dcy, 8.4, zd + 6.2, key='gold', ribs='marble', n_ribs=16, drum=0.0)
    top_d = finial(B, dcx, dcy, top_d - 0.2, h=3.0)
    flag(B, dcx, dcy, top_d - 0.3, pole=0.4, size=(5.0, 3.0))
    # four corner towers
    for (cx_, cy_) in ((-16.0, -6.0), (16.0, -6.0), (-16.0, 16.0), (16.0, 16.0)):
        tp = round_tower(B, cx_, cy_, 3.6, G, G + 25.0, key='marble', roof_h=12.0, roof='slate', trim='gold')
        flag(B, cx_, cy_, tp - 0.3, pole=0.4, size=(3.8, 2.3))
    # the great clock tower in front
    tx0, tx1, ty0, ty1 = -5.2, 5.2, -15.5, -5.5
    cx, cy = 0.0, (ty0 + ty1) / 2
    ashlar(B, tx0, tx1, ty0, ty1, G, G + 35.0, key='marble', rows=24, block=(1.8, 2.8), quoins=False)
    for z in (G + 9.0, G + 18.0, G + 26.0):
        string_course(B, tx0, tx1, ty0, ty1, z, key='gold', h=0.4, out=0.35)
    clock(B, (cx, ty0 - 0.3, G + 30.6), 'S', r=3.0)
    clock(B, (tx1 + 0.3, cy, G + 30.6), 'E', r=3.0)
    B.p('marble').box((tx1 - tx0 + 2.2, ty1 - ty0 + 2.2, 0.7), (cx, cy, G + 35.0))
    for (a, b) in (((tx0 - 1.1, ty0 - 1.1), (tx1 + 1.1, ty0 - 1.1)), ((tx1 + 1.1, ty0 - 1.1), (tx1 + 1.1, ty1 + 1.1))):
        balustrade(B, a, b, G + 35.35, h=1.2, key='gold', spacing=0.7)
    zt = G + 35.35
    for k in range(8):
        a = 2 * math.pi * k / 8
        column(B, cx + math.cos(a) * 3.8, cy + math.sin(a) * 3.8, zt, 5.2, r=0.42, key='marble')
    bell(B, cx, cy, zt + 0.8, 1.4)
    B.p('gold', smooth=True, bevel=0.0).lathe([(4.6, zt + 5.2), (4.6, zt + 5.9), (3.9, zt + 5.9)], (cx, cy, 0), segments=40)
    top = cone(B, cx, cy, 4.2, zt + 5.9, 17.0, key='slate', rows=12)
    top = finial(B, cx, cy, top - 0.2, h=3.6)
    B.points['flag'] = flag(B, cx, cy, top - 0.3, pole=0.4, size=(6.4, 3.8))
    door(B, (0, ty0 - 0.05, G), 'S', w=4.2, h=6.4, arch_key='gold')
    steps(B, (0, ty0 - 0.2, G), 'S', 6.0, n=3, key='marble')
    for z in (G + 13.0, G + 22.0):
        window(B, (cx, ty0 - 0.05, z), 'S', w=1.6, h=3.2, arch=True, surround='gold')
        window(B, (tx1 + 0.05, cy, z), 'E', w=1.6, h=3.2, arch=True, surround='gold')
    for x in (-12.0, -8.5, 8.5, 12.0):
        window(B, (x, y0 - 0.05, G + 4.6), 'S', w=1.8, h=3.4, arch=True, surround='gold')
        window(B, (x, y0 - 0.05, G + 13.0), 'S', w=1.7, h=3.0, arch=True, surround='marble_dark')
    for y in (0.0, 4.5, 9.0, 13.0):
        window(B, (x1 + 0.05, y, G + 4.6), 'E', w=1.8, h=3.4, arch=True, surround='gold')
        window(B, (x1 + 0.05, y, G + 13.0), 'E', w=1.7, h=3.0, arch=True, surround='marble_dark')
    for x in (-7.5, 7.5):
        banner(B, (x, y0 - 0.1, G + 9.5), 'S', w=1.8, h=5.0, key='banner_blue')
    fountain(B, -12.0, -16.0, r=3.6)
    fountain(B, 12.0, -16.0, r=3.6)
    obelisk(B, -20.0, -20.0, h=8.0)
    obelisk(B, 20.0, -20.0, h=8.0)
    for (x, y) in ((-6.5, -20.5), (6.5, -20.5), (20.5, 0.0), (20.5, 10.0)):
        lamp_post(B, x, y)


LEVELS = [None, level1, level2, level3, level4, level5, level6, level7, level8, level9, level10]

kit.reset_scene()
kit.bpy.context.scene.cycles.samples = SAMPLES
kit.setup_world(0.95)
kit.setup_sun(energy=4.6)
# one camera for every level, so they keep one scale
kit.setup_camera(3, res=RES, margin=1.42, lift=21.0)
kit.shadow_catcher()
B = Build(palette(), seed=LEVEL * 101)
LEVELS[LEVEL](B)
B.finish()
meta = kit.lot_meta(3, extra={k: tuple(v) for k, v in B.points.items()})
meta['level'] = LEVEL
kit.render(OUT, OUT[:-4] + '.json', meta)
print('rendered', OUT, meta)
