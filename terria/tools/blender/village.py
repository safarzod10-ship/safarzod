"""
TERRIA village buildings for Blender: every building of the game but the
town hall, level by level.

  blender -b --python tools/blender/village.py -- <type> <level> <out.png> [samples]

Types (lot size in cells, levels):
  builder   1x1  1    the builder's hut: the hut is the builder
  house     2x2  10   homes: taxes
  ... (more types are added here one by one)

All of them share the town hall's camera, light and pixel density, so they
sit together at one scale. None of them gets a tower, a clock, a flag or the
blue-and-gold of the town hall: each type has its own colours and outline.
"""
import math
import os
import sys

from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
import parts  # noqa: E402
from parts import (Build, ashlar, balustrade, barrels, bench, brick_walls, column, crates, door, fence,  # noqa: E402,F401
                   figure, flowerbed, gable, hip, lamp_post, lantern, logs, palette, plaster_wall, plot, shed_roof, steps,
                   string_course, timber_frame, window, yard)

#: ground level: village buildings stand on the grass, only a thin yard under them
G = parts.G = 0.14

PX_PER_CELL = 430  # same pixel density as the town hall renders (1290 px for 3 cells)


def chimney(B, x, y, z0, z1, key='stone', s=1.0):
    rows = max(2, int((z1 - z0) / 0.7))
    for r in range(rows):
        z = z0 + r * (z1 - z0) / rows
        B.p(key).box((1.4 * s, 1.4 * s, (z1 - z0) / rows - 0.05), (x, y, z + (z1 - z0) / rows / 2))
    B.p(key).box((1.8 * s, 1.8 * s, 0.35), (x, y, z1 + 0.15), rnd=0.2)
    B.p('stone_core', bevel=0.0).box((0.8 * s, 0.8 * s, 0.4), (x, y, z1 + 0.35))
    return (x, y, z1 + 0.6)


# ============================================================================
# builder's hut (1x1): one level, never upgraded
# ============================================================================
def builder(B, L=1):
    x0, x1, y0, y1 = -3.6, 2.4, -2.0, 3.6
    yard(B, 'earth', -6.6, 5.4, -6.6, 5.0, r=2.0)
    zf = G + 0.3
    B.p('stone').box((x1 - x0 + 0.6, y1 - y0 + 0.6, 0.3), ((x0 + x1) / 2, (y0 + y1) / 2, G + 0.15))
    # plank walls
    core = B.p('planks')
    core.box((x1 - x0, y1 - y0, 3.4), ((x0 + x1) / 2, (y0 + y1) / 2, zf + 1.7))
    for i in range(int((x1 - x0) / 0.5)):
        B.p('planks').box((0.46, 0.12, 3.4 + (i % 3) * 0.05), (x0 + 0.25 + i * 0.5, y0 - 0.06, zf + 1.7))
    for i in range(int((y1 - y0) / 0.5)):
        B.p('planks').box((0.12, 0.46, 3.4 + 0.4 * (i / ((y1 - y0) / 0.5))), (x1 + 0.06, y0 + 0.25 + i * 0.5, zf + 1.7 + 0.2 * (i / ((y1 - y0) / 0.5))))
    for (x, y) in ((x0, y0), (x1, y0), (x1, y1)):
        B.p('timber').box((0.32, 0.32, 4.0), (x, y, zf + 2.0))
    shed_roof(B, x0, x1, y0, y1, zf + 3.4, zf + 4.4, tile='roof_brown', over=0.5, tw=0.75, tl=0.95)
    door(B, (-1.4, y0 - 0.12, zf), 'S', w=1.3, h=2.3, arch_key=None, planks='door')
    window(B, (x1 + 0.12, 1.0, zf + 2.0), 'E', w=0.9, h=0.9, shutters=True, surround=None)
    # the builder's sign: a yellow board with a hammer
    B.p('yellow').box((1.3, 0.1, 0.7), (0.9, y0 - 0.18, zf + 2.7))
    B.p('iron').box((0.6, 0.06, 0.14), (0.9, y0 - 0.26, zf + 2.75), (0, math.radians(35), 0))
    B.p('timber').box((0.12, 0.06, 0.55), (0.75, y0 - 0.27, zf + 2.62), (0, math.radians(35), 0))
    # workshop yard: a trestle with a plank, a stack of planks, a ladder, a barrel
    for x in (-4.6, -2.2):
        B.p('timber').box((0.18, 0.9, 1.0), (x, -4.6, G + 0.5))
    B.p('planks').box((3.6, 0.55, 0.14), (-3.4, -4.6, G + 1.06))
    for k in range(4):
        B.p('planks').box((3.2, 0.5, 0.16), (3.9, -1.0 + (k % 2) * 0.1, G + 0.12 + k * 0.17), (0, 0, math.radians(90)))
    for side in (-1, 1):
        B.p('timber').box((0.12, 0.12, 4.0), (x1 + 0.45, y1 - 1.2 + side * 0.35, zf + 1.85), (0, math.radians(-14), 0))
    for k in range(6):
        B.p('timber').box((0.1, 0.8, 0.08), (x1 + 0.45 + 0.24 - k * 0.12 * 0.5 + 0.2 - k * 0.0, y1 - 1.2, zf + 0.4 + k * 0.6), (0, math.radians(-14), 0))
    barrels(B, [(-5.6, 3.0)])
    # the builder himself, hammer in hand
    figure(B, -0.4, -5.3, h=2.1, face=(0.6, -1.0))
    B.points['builder'] = (-0.4, -5.3, G + 2.2)


# ============================================================================
# house (2x2): ten levels, from a log hut to a villa
# ============================================================================
HOUSE_YARD = [None, 'earth', 'earth', 'gravel', 'gravel', 'cobble', 'cobble', 'paved', 'paved', 'paved', 'paved']


def house(B, L):
    pts = B.points
    # the yard: around the house and out in front, where the life is
    k = HOUSE_YARD[L]
    ext = [None, (8.5, 7.5, 9.0, 6.0), (9.5, 8.5, 9.5, 6.5), (10.5, 10.0, 9.5, 7.0), (11.0, 10.5, 10.0, 7.0), (11.5, 11.5, 10.5, 7.5),
           (12.0, 12.0, 11.0, 8.0), (12.5, 13.0, 11.0, 8.5), (13.0, 13.0, 11.5, 9.0), (13.5, 13.5, 13.0, 9.5), (14.5, 14.5, 14.5, 10.5)][L]
    yard(B, k, -ext[0], ext[1], -ext[2], ext[3])
    if L == 1:
        # a small log hut with a shingled roof, a woodpile and a bit of fence
        x0, x1, y0, y1 = -5.5, 5.0, -3.0, 4.5
        zf = G + 0.35
        B.p('stone').box((x1 - x0 + 0.6, y1 - y0 + 0.6, 0.35), (0, (y0 + y1) / 2, G + 0.17))
        logs(B, x0, x1, y0, y1, zf, zf + 3.6, d=0.5, over=0.5)
        gable(B, x0, x1, y0, y1, zf + 3.6, pitch=42, over=0.8, end_over=0.6, tile='shingle', wall='planks', tw=1.0, tl=1.3)
        door(B, (-1.6, y0 - 0.25, zf), 'S', w=1.3, h=2.5, arch_key=None, planks='door')
        window(B, (1.8, y0 - 0.25, zf + 1.9), 'S', w=1.0, h=1.0, shutters=True, surround=None)
        window(B, (x1 + 0.25, 1.0, zf + 1.9), 'E', w=1.0, h=1.0, shutters=True, surround=None)
        pts['smoke1'] = chimney(B, 2.6, 2.0, zf + 3.6, zf + 7.4)
        for i in range(4):
            for j in range(3 - i // 2):
                B.p('logs', bevel=0.12).box((0.4, 2.6, 0.4), (x1 + 1.2 + j * 0.42 + (i % 2) * 0.2, -0.5, G + 0.2 + i * 0.38))
        fence(B, (-13.5, -13.5), (-4.0, -13.5))
        fence(B, (4.0, -13.5), (13.5, -13.5))
        fence(B, (13.5, -13.5), (13.5, 6.0))
        B.p('timber').box((2.6, 0.12, 0.12), (0, -13.5, G + 0.9))
    elif L == 2:
        x0, x1, y0, y1 = -6.5, 6.0, -3.5, 5.0
        zf = G + 0.4
        B.p('stone').box((x1 - x0 + 0.6, y1 - y0 + 0.6, 0.4), (0, (y0 + y1) / 2, G + 0.2))
        logs(B, x0, x1, y0, y1, zf, zf + 4.0, d=0.52, over=0.55)
        gable(B, x0, x1, y0, y1, zf + 4.0, pitch=44, over=0.9, end_over=0.7, tile='shingle', wall='planks', tw=1.0, tl=1.3)
        # porch
        for x in (-3.4, -0.6):
            B.p('timber').box((0.3, 0.3, 2.9), (x, y0 - 2.0, zf + 1.45))
        shed_roof(B, -3.8, -0.2, y0 - 2.3, y0 - 0.1, zf + 2.9, zf + 3.6, tile='shingle', over=0.25, tw=0.8, tl=1.0)
        B.p('planks').box((3.8, 2.3, 0.25), (-2.0, y0 - 1.15, zf - 0.1))
        door(B, (-2.0, y0 - 0.25, zf), 'S', w=1.4, h=2.6, arch_key=None, planks='door')
        window(B, (2.6, y0 - 0.25, zf + 2.0), 'S', w=1.1, h=1.1, shutters=True, surround=None)
        for y in (-0.6, 2.6):
            window(B, (x1 + 0.25, y, zf + 2.0), 'E', w=1.1, h=1.1, shutters=True, surround=None)
        pts['smoke1'] = chimney(B, 3.2, 2.4, zf + 4.0, zf + 8.2)
        barrels(B, [(-8.4, -1.0)])
        crates(B, [(-8.2, 1.4, 1.0)])
        fence(B, (-13.5, -13.5), (-4.0, -13.5))
        fence(B, (4.0, -13.5), (13.5, -13.5))
        fence(B, (13.5, -13.5), (13.5, 13.5))
    elif L == 3:
        x0, x1, y0, y1 = -6.0, 6.0, -3.5, 5.0
        zf = G + 1.0
        ashlar(B, x0, x1, y0, y1, G, zf, rows=1, block=(0.9, 1.5), depth=0.6, quoins=False)
        logs(B, x0 + 0.2, x1 - 0.2, y0 + 0.2, y1 - 0.2, zf, zf + 4.2, d=0.55, over=0.5)
        gable(B, x0 + 0.2, x1 - 0.2, y0 + 0.2, y1 - 0.2, zf + 4.2, pitch=45, over=1.0, end_over=0.7, tile='shingle', wall='planks', tw=1.0, tl=1.3)
        door(B, (-2.8, y0 + 0.0, zf), 'S', w=1.4, h=2.7, arch_key=None, planks='door')
        steps(B, (-2.8, y0, G), 'S', 1.8, n=2, key='stone', depth=0.6, rise=0.5)
        for x in (0.4, 3.4):
            window(B, (x, y0 + 0.0, zf + 2.1), 'S', w=1.2, h=1.3, shutters=True, surround=None)
        for y in (-0.8, 2.6):
            window(B, (x1 - 0.0, y, zf + 2.1), 'E', w=1.2, h=1.3, shutters=True, surround=None)
        window(B, (x1 - 0.1, (y0 + y1) / 2, zf + 5.6), 'E', w=0.9, h=0.9, surround=None)
        pts['smoke1'] = chimney(B, 3.4, 2.6, zf + 4.2, zf + 9.0)
        lantern(B, (-1.6, y0 + 0.1, zf + 2.4), 'S')
        barrels(B, [(-9.0, -1.2), (-9.8, 0.2)])
        flowerbed(B, 2.0, -6.4, 3.2, 1.2, seed=3)
    elif L == 4:
        # half-timbered cottage with an attic
        x0, x1, y0, y1 = -6.5, 6.5, -4.0, 5.0
        zf = G + 0.8
        ashlar(B, x0, x1, y0, y1, G, zf, rows=1, block=(0.9, 1.5), depth=0.6, quoins=False)
        plaster_wall(B, x0 + 0.15, x1 - 0.15, y0 + 0.15, y1 - 0.15, zf, zf + 4.4)
        timber_frame(B, x0, x1, y0, y1, zf, zf + 4.4, spacing=2.2, skip=(3.6,))
        gable(B, x0, x1, y0, y1, zf + 4.4, pitch=50, over=1.0, end_over=0.8, tile='roof', wall='plaster', tw=1.0, tl=1.3)
        door(B, (-3.0, y0 - 0.05, zf), 'S', w=1.5, h=2.8, arch_key=None, planks='door')
        steps(B, (-3.0, y0, G), 'S', 1.9, n=2, key='stone', depth=0.6, rise=0.4)
        for x in (0.6, 3.6):
            window(B, (x, y0 - 0.05, zf + 2.2), 'S', w=1.2, h=1.5, shutters=True, surround=None)
        for y in (-1.6, 2.4):
            window(B, (x1 + 0.05, y, zf + 2.2), 'E', w=1.2, h=1.5, shutters=True, surround=None)
        window(B, (x1 + 0.1, (y0 + y1) / 2, zf + 6.2), 'E', w=1.1, h=1.2, surround=None)
        pts['smoke1'] = chimney(B, -3.2, 2.4, zf + 4.4, zf + 10.2)
        lantern(B, (-1.6, y0 - 0.05, zf + 2.6), 'S')
        flowerbed(B, 2.2, -6.6, 3.6, 1.2, seed=4)
        barrels(B, [(-9.6, 0.0)])
        bench(B, 9.6, -6.0, along='y')
    elif L == 5:
        # stone ground floor, jettied timber-framed upper floor
        x0, x1, y0, y1 = -7.0, 7.0, -4.5, 5.0
        z1 = G + 3.8
        z2 = z1 + 3.6
        J = 0.45
        ashlar(B, x0, x1, y0, y1, G, z1, rows=4, block=(1.0, 1.8), depth=0.7)
        ux0, ux1, uy0, uy1 = x0 - J, x1 + J, y0 - J, y1 + J
        plaster_wall(B, ux0 + 0.15, ux1 - 0.15, uy0 + 0.15, uy1 - 0.15, z1, z2)
        timber_frame(B, ux0, ux1, uy0, uy1, z1, z2, spacing=2.4)
        gable(B, ux0, ux1, uy0, uy1, z2, pitch=52, over=1.0, end_over=0.8, tile='roof', wall='plaster', tw=1.0, tl=1.3)
        door(B, (-3.6, y0 - 0.1, G), 'S', w=1.6, h=2.9, arch_key='stone', planks='door')
        for x in (0.4, 3.8):
            window(B, (x, y0 - 0.05, G + 2.0), 'S', w=1.2, h=1.5)
            window(B, (x, uy0 - 0.02, z1 + 1.8), 'S', w=1.1, h=1.4, shutters=True, surround=None)
        window(B, (-3.6, uy0 - 0.02, z1 + 1.8), 'S', w=1.1, h=1.4, shutters=True, surround=None)
        for y in (-1.6, 2.4):
            window(B, (x1 + 0.05, y, G + 2.0), 'E', w=1.2, h=1.5)
            window(B, (ux1 + 0.02, y, z1 + 1.8), 'E', w=1.1, h=1.4, shutters=True, surround=None)
        pts['smoke1'] = chimney(B, 3.6, 2.6, z2, z2 + 6.2)
        lantern(B, (-2.2, y0 - 0.05, G + 2.8), 'S')
        flowerbed(B, 2.0, -7.0, 4.0, 1.2, seed=5)
        bench(B, 10.2, -5.0, along='y')
        barrels(B, [(-10.2, 1.0)])
    elif L == 6:
        # two storeys of stone, a wooden balcony, two chimneys
        x0, x1, y0, y1 = -7.5, 7.5, -4.5, 5.5
        ztop = G + 7.6
        ashlar(B, x0, x1, y0, y1, G, ztop, rows=8, block=(1.0, 1.9), depth=0.7)
        string_course(B, x0, x1, y0, y1, G + 3.9, h=0.35, out=0.2)
        gable(B, x0, x1, y0, y1, ztop, pitch=48, over=1.0, end_over=0.8, tile='roof', wall='stone', tw=1.0, tl=1.3)
        door(B, (-4.0, y0 - 0.1, G), 'S', w=1.6, h=3.0, arch_key='stone', planks='door')
        steps(B, (-4.0, y0, G), 'S', 2.2, n=2, key='stone', depth=0.6, rise=0.35)
        for x in (-0.6, 3.4):
            window(B, (x, y0 - 0.05, G + 2.0), 'S', w=1.3, h=1.7, shutters=True)
        for x in (-4.0, -0.6, 3.4):
            window(B, (x, y0 - 0.05, G + 5.7), 'S', w=1.3, h=1.7, shutters=True)
        for y in (-1.6, 2.6):
            window(B, (x1 + 0.05, y, G + 2.0), 'E', w=1.3, h=1.7, shutters=True)
            window(B, (x1 + 0.05, y, G + 5.7), 'E', w=1.3, h=1.7, shutters=True)
        # balcony over the door
        B.p('planks').box((3.4, 1.4, 0.25), (-4.0, y0 - 0.7, G + 4.5))
        balustrade(B, (-5.7, y0 - 1.35), (-2.3, y0 - 1.35), G + 4.6, h=1.0, key='timber', spacing=0.45)
        for x in (-5.5, -2.5):
            B.p('timber').box((0.25, 1.4, 0.25), (x, y0 - 0.7, G + 4.25), (math.radians(-35), 0, 0))
        pts['smoke1'] = chimney(B, -4.6, 2.4, ztop, ztop + 6.0)
        pts['smoke2'] = chimney(B, 4.6, 2.4, ztop, ztop + 6.0)
        flowerbed(B, 1.4, -6.8, 4.6, 1.2, seed=6)
        lamp_post(B, -9.8, -8.0, h=4.6)
        bench(B, 10.6, -4.0, along='y')
    elif L == 7:
        # red brick, a bay window, grey slate hip roof
        x0, x1, y0, y1 = -8.0, 8.0, -4.5, 6.0
        ztop = G + 8.0
        brick_walls(B, x0, x1, y0, y1, G, ztop)
        string_course(B, x0, x1, y0, y1, G + 4.0, key='trim', h=0.35, out=0.2)
        string_course(B, x0, x1, y0, y1, ztop, key='trim', h=0.45, out=0.35)
        hip(B, x0, x1, y0, y1, ztop + 0.25, pitch=40, over=0.8, tile='slate_grey', caps='slate_grey_dark', tw=0.9, tl=1.25)
        # bay window on the east side
        bx0, bx1, by0, by1 = x1, x1 + 1.6, -1.6, 2.2
        brick_walls(B, bx0 - 0.2, bx1, by0, by1, G, G + 3.6, quoin=False)
        hip(B, bx0 - 0.2, bx1, by0, by1, G + 3.6, pitch=35, over=0.3, tile='slate_grey', caps='slate_grey_dark', tw=0.7, tl=0.9)
        window(B, (bx1 + 0.05, (by0 + by1) / 2, G + 2.0), 'E', w=2.4, h=1.8, surround='trim', frame_key='white')
        door(B, (-4.4, y0 - 0.1, G), 'S', w=1.7, h=3.0, arch_key='trim', planks='door')
        steps(B, (-4.4, y0, G), 'S', 2.4, n=2, key='trim', depth=0.6, rise=0.35)
        for x in (-0.8, 3.2, 6.0):
            window(B, (x, y0 - 0.05, G + 2.1), 'S', w=1.3, h=1.8, surround='trim', frame_key='white')
        for x in (-4.4, -0.8, 3.2, 6.0):
            window(B, (x, y0 - 0.05, G + 6.0), 'S', w=1.3, h=1.8, surround='trim', frame_key='white')
        for y in (-3.2, 4.2):
            window(B, (x1 + 0.05, y, G + 6.0), 'E', w=1.3, h=1.8, surround='trim', frame_key='white')
        pts['smoke1'] = chimney(B, -5.0, 3.0, ztop + 1.0, ztop + 7.0, key='trim')
        pts['smoke2'] = chimney(B, 5.0, 3.0, ztop + 1.0, ztop + 7.0, key='trim')
        flowerbed(B, 1.6, -7.0, 5.0, 1.2, seed=7)
        lamp_post(B, -9.8, -8.4, h=4.6)
        bench(B, 11.2, -6.0, along='y')
    elif L == 8:
        # a tall brick town house: three storeys, balconies, hip roof
        x0, x1, y0, y1 = -8.5, 8.5, -4.5, 6.5
        ztop = G + 11.4
        brick_walls(B, x0, x1, y0, y1, G, ztop)
        for z in (G + 3.9, G + 7.6):
            string_course(B, x0, x1, y0, y1, z, key='trim', h=0.35, out=0.2)
        string_course(B, x0, x1, y0, y1, ztop, key='trim', h=0.5, out=0.4)
        hip(B, x0, x1, y0, y1, ztop + 0.3, pitch=42, over=0.9, tile='slate_grey', caps='slate_grey_dark', tw=0.9, tl=1.25)
        door(B, (0.0, y0 - 0.1, G), 'S', w=1.8, h=3.0, arch_key='trim', planks='door')
        steps(B, (0.0, y0, G), 'S', 2.6, n=3, key='trim', depth=0.55, rise=0.3)
        for x in (-6.0, -3.0, 3.0, 6.0):
            window(B, (x, y0 - 0.05, G + 2.1), 'S', w=1.3, h=1.8, surround='trim', frame_key='white')
        for z in (G + 5.8, G + 9.5):
            for x in (-6.0, -3.0, 0.0, 3.0, 6.0):
                window(B, (x, y0 - 0.05, z), 'S', w=1.3, h=1.8, surround='trim', frame_key='white')
            for y in (-2.0, 1.2, 4.4):
                window(B, (x1 + 0.05, y, z), 'E', w=1.3, h=1.8, surround='trim', frame_key='white')
        for y in (-2.0, 1.2, 4.4):
            window(B, (x1 + 0.05, y, G + 2.1), 'E', w=1.3, h=1.8, surround='trim', frame_key='white')
        for x in (-4.5, 4.5):
            B.p('trim').box((3.4, 1.2, 0.25), (x, y0 - 0.6, G + 4.7))
            balustrade(B, (x - 1.6, y0 - 1.15), (x + 1.6, y0 - 1.15), G + 4.8, h=1.0, key='iron', spacing=0.35)
        pts['smoke1'] = chimney(B, -5.6, 3.0, ztop + 1.0, ztop + 7.0, key='trim')
        pts['smoke2'] = chimney(B, 5.6, 3.0, ztop + 1.0, ztop + 7.0, key='trim')
        flowerbed(B, -5.0, -7.2, 4.0, 1.2, seed=8)
        flowerbed(B, 5.0, -7.2, 4.0, 1.2, seed=9)
        lamp_post(B, -10.4, -8.8, h=4.8)
        lamp_post(B, 10.4, -8.8, h=4.8)
    elif L == 9:
        # a limestone manor with a columned veranda
        x0, x1, y0, y1 = -9.0, 9.0, -3.5, 7.0
        ztop = G + 9.0
        ashlar(B, x0, x1, y0, y1, G, ztop, key='lime', rows=8, block=(1.4, 2.4), quoins=False)
        string_course(B, x0, x1, y0, y1, G + 0.5, key='lime', h=1.0, out=0.25)
        string_course(B, x0, x1, y0, y1, G + 4.6, key='trim', h=0.35, out=0.2)
        string_course(B, x0, x1, y0, y1, ztop, key='trim', h=0.6, out=0.5)
        hip(B, x0, x1, y0, y1, ztop + 0.4, pitch=36, over=0.9, tile='roof', caps='roof_brown', tw=0.9, tl=1.25)
        # veranda across the front
        B.p('lime').box((14.0, 3.6, 0.6), (0.0, y0 - 1.8, G + 0.3))
        steps(B, (0.0, y0 - 3.6, G), 'S', 3.4, n=2, key='lime', depth=0.5, rise=0.3)
        for x in (-6.4, -3.2, 0.0, 3.2, 6.4):
            column(B, x, y0 - 3.0, G + 0.6, 3.8, r=0.34, key='trim')
        B.p('trim').box((14.2, 3.8, 0.5), (0.0, y0 - 1.75, G + 4.65))
        balustrade(B, (-7.0, y0 - 3.4), (7.0, y0 - 3.4), G + 4.9, h=0.9, key='trim', spacing=0.5)
        door(B, (0.0, y0 - 0.1, G + 0.6), 'S', w=1.9, h=3.1, arch_key='trim', planks='door')
        for x in (-6.0, -3.0, 3.0, 6.0):
            window(B, (x, y0 - 0.05, G + 2.6), 'S', w=1.3, h=2.2, surround='trim', frame_key='white', shutters=True)
        for x in (-6.0, -3.0, 0.0, 3.0, 6.0):
            window(B, (x, y0 - 0.05, G + 7.0), 'S', w=1.3, h=2.0, surround='trim', frame_key='white', shutters=True)
        for y in (-0.6, 2.6, 5.4):
            window(B, (x1 + 0.05, y, G + 2.6), 'E', w=1.3, h=2.2, surround='trim', frame_key='white', shutters=True)
            window(B, (x1 + 0.05, y, G + 7.0), 'E', w=1.3, h=2.0, surround='trim', frame_key='white', shutters=True)
        pts['smoke1'] = chimney(B, -5.4, 3.4, ztop + 1.0, ztop + 6.6, key='lime')
        pts['smoke2'] = chimney(B, 5.4, 3.4, ztop + 1.0, ztop + 6.6, key='lime')
        flowerbed(B, -8.6, -10.2, 4.0, 1.4, seed=10)
        flowerbed(B, 8.6, -10.2, 4.0, 1.4, seed=11)
        lamp_post(B, -4.2, -11.0, h=4.6)
        lamp_post(B, 4.2, -11.0, h=4.6)
    elif L == 10:
        # a grand villa: the main house and two wings around a forecourt
        from parts import fountain
        mx0, mx1, my0, my1 = -7.0, 7.0, -0.5, 9.5
        ztop = G + 10.6
        plaster_wall(B, mx0, mx1, my0, my1, G, ztop, key='white')
        string_course(B, mx0, mx1, my0, my1, G + 0.6, key='lime', h=1.2, out=0.25)
        string_course(B, mx0, mx1, my0, my1, G + 5.2, key='lime', h=0.4, out=0.25)
        string_course(B, mx0, mx1, my0, my1, ztop, key='lime', h=0.7, out=0.55)
        hip(B, mx0, mx1, my0, my1, ztop + 0.45, pitch=32, over=1.0, tile='roof', caps='roof_brown', tw=0.9, tl=1.25)
        for (wx0, wx1) in ((-13.5, -7.0), (7.0, 13.5)):
            wy0, wy1 = -9.0, 9.5
            wt = G + 8.2
            plaster_wall(B, wx0, wx1, wy0, wy1, G, wt, key='white')
            string_course(B, wx0, wx1, wy0, wy1, G + 0.6, key='lime', h=1.2, out=0.25)
            string_course(B, wx0, wx1, wy0, wy1, wt, key='lime', h=0.6, out=0.5)
            hip(B, wx0, wx1, wy0, wy1, wt + 0.4, pitch=32, over=0.9, tile='roof', caps='roof_brown', tw=0.9, tl=1.25)
            cx = (wx0 + wx1) / 2
            window(B, (cx, wy0 - 0.05, G + 2.8), 'S', w=1.6, h=2.8, arch=True, surround='lime', frame_key='white', shutters=True)
            window(B, (cx, wy0 - 0.05, G + 6.4), 'S', w=1.4, h=2.0, surround='lime', frame_key='white', shutters=True)
            # the courtyard-facing side of the west wing, the street side of the east wing
            fx = wx1 + 0.05
            for y in (-6.0, -2.6, 1.0, 4.6, 8.0):
                if wx0 < 0 and y > -0.5:
                    continue
                window(B, (fx, y, G + 2.8), 'E', w=1.3, h=2.6, arch=True, surround='lime', frame_key='white', shutters=True)
                window(B, (fx, y, G + 6.4), 'E', w=1.2, h=2.0, surround='lime', frame_key='white', shutters=True)
        # the main front: a columned porch with a balcony over it
        for x in (-4.6, -2.3, 2.3, 4.6):
            window(B, (x, my0 - 0.05, G + 2.8), 'S', w=1.3, h=2.6, arch=True, surround='lime', frame_key='white')
        for x in (-4.6, -2.3, 0.0, 2.3, 4.6):
            window(B, (x, my0 - 0.05, G + 7.8), 'S', w=1.3, h=2.2, surround='lime', frame_key='white', shutters=True)
        door(B, (0.0, my0 - 0.1, G), 'S', w=1.9, h=3.4, arch_key='lime', planks='door')
        B.p('lime').box((5.0, 2.6, 0.4), (0.0, my0 - 1.3, G + 0.2))
        for x in (-2.0, 2.0):
            column(B, x, my0 - 2.2, G + 0.4, 4.8, r=0.32, key='trim')
        B.p('lime').box((5.4, 2.8, 0.45), (0.0, my0 - 1.3, G + 5.45))
        balustrade(B, (-2.6, my0 - 2.6), (2.6, my0 - 2.6), G + 5.7, h=1.0, key='lime', spacing=0.42)
        pts['smoke1'] = chimney(B, -4.6, 5.0, ztop + 1.0, ztop + 6.0, key='lime')
        pts['smoke2'] = chimney(B, 4.6, 5.0, ztop + 1.0, ztop + 6.0, key='lime')
        fountain(B, 0.0, -6.0, r=2.2)
        flowerbed(B, -4.6, -6.0, 2.2, 3.2, seed=12)
        flowerbed(B, 4.6, -6.0, 2.2, 3.2, seed=13)
        for x in (-4.2, 4.2):
            B.p('lime').box((1.0, 1.0, 2.0), (x, -13.2, G + 1.0))
            B.p('lime', smooth=True, bevel=0.0).lathe([(0.45, G + 2.0), (0.5, G + 2.3), (0.0, G + 2.6)], (x, -13.2, 0), segments=16)
            lamp_post(B, x * 1.9, -12.0, h=4.6)



# ============================================================================
# shared pieces for the farm, the mine, the warehouse and the treasury
# ============================================================================
def gambrel(B, x0, x1, y0, y1, z, tile='roof_brown', wall='barn_red', low=62, high=28, knee=0.55, over=0.6, end_over=0.5, tw=1.0, tl=1.3):
    """Barn roof with two pitches on each side (ridge along x); returns the ridge height."""
    yc = (y0 + y1) / 2
    half = (y1 - y0) / 2
    kd = half * knee              # horizontal run of the steep lower part
    zk = z + kd * math.tan(math.radians(low))
    zr = zk + (half - kd) * math.tan(math.radians(high))
    X0, X1 = x0 - end_over, x1 + end_over
    tiles = B.p(tile)
    from parts import solid, tile_face
    for s_ in (-1, 1):
        ye = yc + s_ * (half + over)
        yk = yc + s_ * (half - kd)
        ze = z - over * math.tan(math.radians(low))
        if s_ < 0:
            tile_face(tiles, (X0, ye, ze), (X1, ye, ze), (X1, yk, zk), (X0, yk, zk), tw, tl)
            tile_face(tiles, (X0, yk, zk), (X1, yk, zk), (X1, yc, zr), (X0, yc, zr), tw, tl)
        else:
            tile_face(tiles, (X1, ye, ze), (X0, ye, ze), (X0, yk, zk), (X1, yk, zk), tw, tl)
            tile_face(tiles, (X1, yk, zk), (X0, yk, zk), (X0, yc, zr), (X1, yc, zr), tw, tl)
    for x, sgn in ((x1 - 0.1, 1), (x0 + 0.1, -1)):
        v = [(x, y0, z), (x, y0 + kd, zk), (x, yc, zr - 0.3), (x, y1 - kd, zk), (x, y1, z)]
        v2 = [(x - sgn * 0.5, p_[1], p_[2]) for p_ in v]
        solid(B.p(wall), v + v2, [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5), (0, 5, 6, 1), (1, 6, 7, 2), (2, 7, 8, 3), (3, 8, 9, 4), (4, 9, 5, 0)])
    under = B.p('roof_under', bevel=0.0)
    vv = [(X0, y0 - over * 0.5, z), (X0, y0 + kd, zk - 0.2), (X0, yc, zr - 0.3), (X0, y1 - kd, zk - 0.2), (X0, y1 + over * 0.5, z)]
    vv2 = [(X1, p_[1], p_[2]) for p_ in vv]
    solid(under, vv + vv2, [(0, 1, 2, 3, 4), (9, 8, 7, 6, 5), (0, 5, 6, 1), (1, 6, 7, 2), (2, 7, 8, 3), (3, 8, 9, 4), (4, 9, 5, 0)])
    for i in range(int((X1 - X0) / 1.1)):
        B.p(tile).box((1.12, 0.8, 0.8), (X0 + 0.55 + i * 1.1, yc, zr + 0.45), (math.radians(45), 0, 0), rnd=0.5)
    return zr


def barn_doors(B, c, face, w=4.0, h=4.4):
    """Big barn doors with white X bracing."""
    from parts import NORMAL
    c = Vector(c)
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    for s_ in (-1, 1):
        mid = c + t * (s_ * w / 4) + n * 0.1 + Vector((0, 0, h / 2))
        B.p('barn_red').box((w / 2 - 0.08, 0.2, h), mid, (0, 0, ang))
        for d in (1, -1):
            B.p('white').box((math.hypot(w / 2, h) - 0.4, 0.12, 0.22), mid + n * 0.12, (0, d * math.atan2(h, w / 2), ang) if face in 'SN' else (d * math.atan2(h, w / 2), 0, ang - math.pi / 2 + math.pi / 2))
        B.p('white').box((w / 2, 0.14, 0.22), mid + n * 0.12 + Vector((0, 0, h / 2 - 0.1)), (0, 0, ang))
        B.p('white').box((w / 2, 0.14, 0.22), mid + n * 0.12 + Vector((0, 0, -h / 2 + 0.1)), (0, 0, ang))
        B.p('white').box((0.22, 0.14, h), mid + n * 0.12 + t * (s_ * (w / 4 - 0.1)), (0, 0, ang))


def crop_rows(B, x0, x1, y0, y1, kind='wheat', height=1.1, spacing=1.15, along='x', seed=1):
    """Rows of a crop on a bed of soil: each row a chain of bushy clumps of uneven height."""
    import random
    rng = random.Random(seed * 101 + int(x0 * 3 + y0 * 7))
    B.p('soil', bevel=0.6, segments=2).box((x1 - x0, y1 - y0, G + 0.1), ((x0 + x1) / 2, (y0 + y1) / 2, (G + 0.1) / 2))
    length = (x1 - x0 - 0.6) if along == 'x' else (y1 - y0 - 0.6)
    n = int(((y1 - y0) if along == 'x' else (x1 - x0)) / spacing)
    seg = 1.6
    for i in range(n):
        off = spacing * (i + 0.5)
        t = -length / 2
        while t < length / 2:
            sl = min(seg * rng.uniform(0.7, 1.2), length / 2 - t)
            if sl < 0.3:
                break
            h = height * rng.uniform(0.82, 1.15)
            wdt = spacing * rng.uniform(0.78, 0.92)
            c = t + sl / 2
            if along == 'x':
                pos = ((x0 + x1) / 2 + c, y0 + off, G + 0.1 + h / 2)
                size = (sl + 0.12, wdt, h)
            else:
                pos = (x0 + off, (y0 + y1) / 2 + c, G + 0.1 + h / 2)
                size = (wdt, sl + 0.12, h)
            B.p(kind, bevel=min(0.42, h * 0.48, wdt * 0.48), segments=3).box(size, pos, (0, 0, rng.uniform(-0.04, 0.04)))
            t += sl


def furrows(B, x0, x1, y0, y1, spacing=1.1):
    """A freshly ploughed field: soil ridges."""
    B.p('soil', bevel=0.6, segments=2).box((x1 - x0, y1 - y0, G + 0.05), ((x0 + x1) / 2, (y0 + y1) / 2, (G + 0.05) / 2))
    n = int((y1 - y0) / spacing)
    for i in range(n):
        B.p('soil', bevel=0.18, segments=2).box((x1 - x0 - 0.6, spacing * 0.6, 0.35), ((x0 + x1) / 2, y0 + spacing * (i + 0.5), G + 0.2))


def hay_bales(B, spots, s=1.0):
    for (x, y, rot) in spots:
        B.p('hay', bevel=0.25 * s, segments=3).box((2.0 * s, 1.2 * s, 1.1 * s), (x, y, G + 0.55 * s), (0, 0, rot))


def scarecrow(B, x, y):
    B.p('timber').box((0.18, 0.18, 3.0), (x, y, G + 1.5))
    B.p('timber').box((2.2, 0.15, 0.15), (x, y, G + 2.3))
    B.p('cloth').box((1.1, 0.5, 1.1), (x, y, G + 2.0))
    B.p('hay', smooth=True, bevel=0.0).lathe([(0.0, G + 2.6), (0.38, G + 2.75), (0.42, G + 3.0), (0.3, G + 3.25), (0.0, G + 3.3)], (x, y, 0), segments=14)
    B.p('shingle', smooth=True, bevel=0.0).lathe([(0.75, G + 3.15), (0.32, G + 3.25), (0.28, G + 3.7), (0.0, G + 3.72)], (x, y, 0), segments=16)


def silo(B, x, y, r=2.2, h=9.0, key='white', roof='iron'):
    B.p(key, smooth=True, bevel=0.0).lathe([(r, G), (r, G + h)], (x, y, 0), segments=32)
    for z in (G + h * 0.25, G + h * 0.5, G + h * 0.75):
        B.p('iron', smooth=True, bevel=0.0).lathe([(r + 0.06, z), (r + 0.06, z + 0.25), (r, z + 0.26)], (x, y, 0), segments=32)
    B.p(roof, smooth=True, bevel=0.0).lathe([(r + 0.25, G + h), (r * 0.8, G + h + r * 0.45), (r * 0.4, G + h + r * 0.72), (0.0, G + h + r * 0.8)], (x, y, 0), segments=32)


def mound(B, cx, cy, r, h, seed=1):
    """The rock hill a mine digs into: a heap of big crags of different shades, and loose rocks."""
    from parts import blob
    import random
    rng = random.Random(seed)
    blob(B.p('rock', bevel=0.0), (cx, cy, 0.0), r * 0.9, 1.0, 0.85, h * 0.8 / (r * 0.9), rough=0.1, subdiv=3, seed=seed)
    for k in range(9):
        a = rng.uniform(0, 2 * math.pi)
        d = r * rng.uniform(0.2, 0.75)
        rr = r * rng.uniform(0.32, 0.5)
        blob(B.p('rock', bevel=0.0), (cx + math.cos(a) * d, cy + math.sin(a) * d * 0.85, 0.0), rr, 1.0, 1.0,
             (h * rng.uniform(0.55, 1.0)) / rr, rough=0.2, subdiv=2, seed=seed * 31 + k)
    for k in range(10):
        a = rng.uniform(0, 2 * math.pi)
        d = r * rng.uniform(0.9, 1.2)
        blob(B.p('rock', bevel=0.0), (cx + math.cos(a) * d, cy + math.sin(a) * d * 0.85, 0.0), rng.uniform(0.6, 1.6), 1.0, 1.0, 0.75, rough=0.28, subdiv=1, seed=seed * 13 + k)


def portal(B, x, y, w=4.4, h=4.6, face='S', key='timber', heavy=False, gold=False):
    """A mine tunnel entrance: a dark hole framed in beams."""
    from parts import NORMAL
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    c = Vector((x, y, G))
    B.p('stone_core', bevel=0.0).box((w, 3.0, h), c - n * 1.2 + Vector((0, 0, h / 2)), (0, 0, ang))
    B.p('iron', bevel=0.0).box((w - 0.4, 3.2, h - 0.4), c - n * 1.0 + Vector((0, 0, (h - 0.4) / 2)), (0, 0, ang))
    bw = 0.8 if heavy else 0.55
    for s_ in (-1, 1):
        B.p(key).box((bw, bw, h + 0.4), c + t * (s_ * (w / 2 + bw / 2)) + n * 0.3 + Vector((0, 0, (h + 0.4) / 2)), (0, 0, ang))
    B.p(key).box((w + bw * 2 + 0.8, bw, bw), c + n * 0.3 + Vector((0, 0, h + 0.4)), (0, 0, ang))
    if heavy:
        B.p(key).box((w + bw * 2 + 1.4, bw * 0.8, bw * 0.8), c + n * 0.45 + Vector((0, 0, h + 1.2)), (0, 0, ang))
    if gold:
        B.p('gold').box((w + bw * 2 + 1.0, 0.3, 0.5), c + n * 0.75 + Vector((0, 0, h + 0.4)), (0, 0, ang))
        B.p('gold', smooth=True, bevel=0.0).lathe([(0.0, 0.0), (0.7, 0.3), (0.8, 0.8), (0.0, 1.4)], (c + n * 0.8 + Vector((0, 0, h + 0.75))).to_tuple(), segments=16)


def headframe(B, x, y, h=12.0, key='timber', wheels=1):
    """The tower over a shaft with its winding wheel(s)."""
    from parts import bar, wheel
    p = B.p(key)
    for sx in (-1, 1):
        bar(p, (x + sx * 2.6, y - 1.6, G), (x + sx * 0.7, y, G + h), 0.45)
        bar(p, (x + sx * 2.6, y + 1.6, G), (x + sx * 0.7, y, G + h), 0.45)
    for z in (G + h * 0.35, G + h * 0.7):
        k = 1 - (z - G) / h
        p.box((0.7 * 2 + 3.8 * k, 0.3, 0.3), (x, y - 1.6 * k, z))
        p.box((0.3, 3.2 * k, 0.3), (x + 0.7 + 1.9 * k, y, z))
    B.p(key).box((2.2, 1.0, 0.4), (x, y, G + h))
    for k in range(wheels):
        wheel(B, (x - 0.5 + k * 1.0, y, G + h + 1.9), 1.9, axis='x', key=key, rim='iron', spokes=8, w=0.22)


def ore_pile(B, x, y, r=1.8, seed=1):
    from parts import blob
    blob(B.p('rock', bevel=0.0), (x, y, G), r, 1.0, 1.0, 0.55, rough=0.3, subdiv=2, seed=seed)


def wood_stack(B, x, y, n=4, length=4.0, along='y'):
    for i in range(n):
        for j in range(n - i):
            if along == 'y':
                B.p('logs', bevel=0.18).box((0.5, length, 0.5), (x + (j - (n - i - 1) / 2) * 0.54, y, G + 0.25 + i * 0.47))
            else:
                B.p('logs', bevel=0.18).box((length, 0.5, 0.5), (x, y + (j - (n - i - 1) / 2) * 0.54, G + 0.25 + i * 0.47))


def stone_stack(B, x, y, nx=2, ny=2, nz=2, s=1.1):
    for i in range(nx):
        for j in range(ny):
            for k in range(nz - (1 if (i + j) % 3 == 2 else 0)):
                B.p('stone').box((s, s * 0.9, s * 0.8), (x + (i - (nx - 1) / 2) * (s + 0.06), y + (j - (ny - 1) / 2) * (s * 0.9 + 0.06), G + s * 0.4 + k * s * 0.8))


def crane(B, x, y, h=7.0, reach=4.0, key='timber'):
    from parts import bar
    p = B.p(key)
    p.box((0.5, 0.5, h), (x, y, G + h / 2))
    bar(p, (x, y, G + h - 0.3), (x - reach, y - reach * 0.2, G + h - 0.3), 0.35)
    bar(p, (x, y, G + h * 0.6), (x - reach * 0.7, y - reach * 0.14, G + h - 0.4), 0.25)
    B.p('iron').box((0.06, 0.06, h * 0.45), (x - reach + 0.2, y - reach * 0.2, G + h * 0.75))
    B.p('planks').box((1.2, 1.2, 1.0), (x - reach + 0.2, y - reach * 0.2, G + h * 0.5))


# ============================================================================
# farm (4x4): the field grows richer with each level
# ============================================================================
def farm(B, L):
    pts = B.points
    # the field: how much of it is planted and with what, by level
    if L == 1:
        furrows(B, -26.0, -6.0, -26.0, -10.0)
        crop_rows(B, -26.0, -6.0, -9.0, 4.0, 'sprout', height=0.45)
        scarecrow(B, -15.0, -2.5)
    elif L == 2:
        crop_rows(B, -27.0, -2.0, -27.0, -12.0, 'sprout', height=0.6)
        crop_rows(B, -27.0, -2.0, -11.0, 8.0, 'sprout', height=0.9)
        scarecrow(B, -14.0, -4.0)
    elif L == 3:
        crop_rows(B, -28.0, 2.0, -28.0, -12.0, 'wheat', height=1.1)
        crop_rows(B, -28.0, 2.0, -11.0, 12.0, 'sprout', height=0.9)
        scarecrow(B, -12.0, -2.0)
        hay_bales(B, [(5.0, -18.0, 0.2), (6.6, -16.4, 1.3)])
    elif L >= 4:
        crop_rows(B, -29.0, 6.0, -29.0, -4.0, 'wheat', height=1.25)
        crop_rows(B, -29.0, 6.0, -2.5, 16.0, 'wheat' if L >= 6 else 'sprout', height=1.25 if L >= 6 else 0.9)
        if L >= 7:
            crop_rows(B, -29.0, -14.0, 17.5, 28.0, 'sprout', height=0.8, along='y')
        scarecrow(B, -10.0, -14.0)
        hay_bales(B, [(9.0, -24.0, 0.1), (10.8, -22.2, 1.2), (12.4, -25.0, 0.5)] + ([(9.6, -20.0, 0.9), (13.5, -21.6, 0.3)] if L >= 6 else []))
    # fence along the front of the field
    if L >= 3:
        from parts import fence
        fence(B, (-30.0, -30.0), (8.0, -30.0))
        fence(B, (-30.0, -30.0), (-30.0, 18.0 if L < 7 else 29.0))
    # the farmyard: a shed, a barn, silos
    if L <= 2:
        yard(B, 'earth', 4.0, 22.0, -8.0, 12.0, r=2.5)
        x0, x1, y0, y1 = 9.0, 16.0, -2.0, 4.0
        logs(B, x0, x1, y0, y1, G, G + 3.0, d=0.5, over=0.4)
        from parts import shed_roof
        shed_roof(B, x0, x1, y0, y1, G + 3.0, G + 4.2, tile='shingle', over=0.5, tw=0.9, tl=1.1)
        door(B, (11.0, y0 - 0.25, G), 'S', w=1.6, h=2.4, arch_key=None, planks='door')
        if L == 2:
            hay_bales(B, [(18.0, -3.0, 0.3)])
            barrels(B, [(17.5, 2.0)])
        crates(B, [(7.0, -4.5, 1.0)])
    else:
        yard(B, 'earth' if L < 5 else 'gravel', 6.0, 30.0, -12.0, 29.0, r=3.0)
        bw = 7.0 + min(L, 8) * 0.8
        bd = 6.0 + min(L, 8) * 0.6
        x0, x1 = 21.0 - bw / 2, 21.0 + bw / 2
        y0, y1 = 2.0, 2.0 + bd * 1.25
        zt = G + 4.0 + L * 0.35
        plaster_wall(B, x0, x1, y0, y1, G, zt, key='barn_red')
        for x in [x0 + 0.1 + i * 0.5 for i in range(int((x1 - x0) / 0.5))]:
            B.p('barn_red', bevel=0.02).box((0.08, 0.06, zt - G), (x, y0 - 0.03, (G + zt) / 2))
        B.p('white').box((x1 - x0 + 0.3, 0.3, 0.3), ((x0 + x1) / 2, y0 - 0.1, zt))
        for x in (x0, x1):
            B.p('white').box((0.3, 0.3, zt - G), (x, y0 - 0.1, (G + zt) / 2))
        if L >= 6:
            zr = gambrel(B, x0, x1, y0, y1, zt, tile='roof_brown', wall='barn_red')
            # hay loft door in the gable is on the east end
            B.p('white').box((0.2, 2.0, 2.0), (x1 + 0.1, (y0 + y1) / 2, zt + 2.0))
        else:
            zr = gable(B, x0, x1, y0, y1, zt, pitch=45, over=0.8, end_over=0.6, tile='shingle' if L < 5 else 'roof_brown', wall='barn_red', tw=1.0, tl=1.3, barge=None)
        barn_doors(B, ((x0 + x1) / 2, y0, G), 'S', w=min(5.0, bw * 0.45), h=min(4.6, zt - G - 0.4))
        window(B, (x1 + 0.05, y0 + bd * 0.35, G + 2.6), 'E', w=1.1, h=1.1, surround=None, frame_key='white')
        if L >= 5:
            silo(B, 27.0, -4.0, r=2.4, h=9.0 + L * 0.6)
        if L >= 7:
            silo(B, 27.0, 22.0, r=2.2, h=10.0 + L * 0.5, key='stone_grey')
        hay_bales(B, [(13.0, -6.0, 0.2), (14.6, -8.0, 1.1)])
        crates(B, [(10.0, -2.0, 1.1), (10.0, -0.6, 0.9)])
        barrels(B, [(9.0, -9.0)])
        if L >= 4:
            # a hand cart loaded with hay
            B.p('planks').box((3.2, 1.8, 0.25), (16.0, -10.5, G + 1.1))
            B.p('hay', bevel=0.3).box((3.0, 1.6, 1.0), (16.0, -10.5, G + 1.7))
            from parts import wheel
            for sy in (-1, 1):
                wheel(B, (16.0, -10.5 + sy * 1.05, G + 0.9), 0.85, axis='y', key='timber', rim='iron', spokes=6, w=0.14)
        if L >= 8:
            lamp_post(B, 8.0, -12.0, h=4.6)


# ============================================================================
# mine (3x3): gold coins from the hill
# ============================================================================
def mine(B, L):
    pts = B.points
    yk = ['earth', 'earth', 'earth', 'gravel', 'gravel', 'gravel', 'cobble', 'cobble', 'cobble', 'paved'][L - 1]
    yard(B, yk, -21.0, 21.0, -21.0, 6.0, r=3.0)
    r = 10.0 + L * 0.9
    mound(B, -6.0, 9.0, r, 8.0 + L * 0.7, seed=L * 7 + 3)
    px, py = -6.0, 9.0 - r * 0.72
    portal(B, px, py, w=4.2 + L * 0.15, h=4.4 + L * 0.12, key='timber' if L < 8 else 'iron', heavy=L >= 3, gold=L >= 10)
    if L >= 7:
        portal(B, -6.0 - r * 0.62, 9.0 - r * 0.45, w=3.6, h=4.0, face='S', key='timber' if L < 8 else 'iron', heavy=True, gold=L >= 10)
    from parts import rails, cart, coins, lamp_post, chest
    if L >= 2:
        rails(B, (px, py), (px + 6.0, py - 12.0))
    cart(B, px + (3.0 if L >= 2 else 2.5), py - (6.0 if L >= 2 else 3.5), along='y')
    if L >= 3:
        cart(B, px + 5.0, py - 10.5, along='y')
    if L >= 7:
        rails(B, (-6.0 - r * 0.62, 9.0 - r * 0.45), (-14.0, -12.0))
        cart(B, -12.5, -8.0, along='y')
    coins(B, 6.0, -13.0, G, r=1.4 + L * 0.35, h=0.9 + L * 0.22, n=12 + L * 4)
    if L >= 5:
        coins(B, 11.5, -9.0, G, r=1.2 + L * 0.2, h=0.8 + L * 0.15, n=10 + L * 3)
    if L >= 8:
        coins(B, 0.5, -18.0, G, r=1.4 + L * 0.2, h=0.8 + L * 0.15, n=10 + L * 3)
        chest(B, 15.0, -15.0)
    if L >= 10:
        chest(B, 4.0, -19.5, rot=0.6)
        chest(B, 16.5, -4.0, rot=-0.4)
    # tools and light
    B.p('timber').box((0.12, 0.12, 2.0), (px - 3.6, py - 1.4, G + 1.0), (0, math.radians(18), 0))
    B.p('iron').box((1.2, 0.18, 0.25), (px - 3.9, py - 1.4, G + 2.0), (0, math.radians(18), 0))
    from parts import lantern as _l
    _l(B, (px + 2.8, py + 0.3, G + 3.6), 'S')
    if L >= 4:
        # a winch on the hill
        from parts import wheel
        wheel(B, (4.0, 6.0, G + 2.4), 2.0, axis='x', key='timber', rim='iron', spokes=6, w=0.22)
        for sy in (-1, 1):
            B.p('timber').box((0.4, 0.4, 2.8), (4.0, 6.0 + sy * 0.8, G + 1.4))
    if L >= 5:
        headframe(B, 12.0, 4.0, h=9.0 + L * 0.6, key='timber' if L < 8 else 'iron', wheels=1 if L < 9 else 2)
    if L >= 6:
        from parts import bar
        bar(B.p('planks'), (2.0, 12.0, G + 7.0), (8.0, -2.0, G + 2.0), 1.6, 0.25)
        B.p('planks').box((3.0, 3.0, 2.0), (8.5, -3.0, G + 1.0))
        ore_pile(B, 8.5, -3.0, 1.2, seed=L)
    if L >= 8:
        # engine house with a chimney
        ex0, ex1, ey0, ey1 = 14.0, 21.0, 8.0, 15.0
        if L >= 9:
            brick_walls(B, ex0, ex1, ey0, ey1, G, G + 5.5)
        else:
            plaster_wall(B, ex0, ex1, ey0, ey1, G, G + 5.0, key='planks')
        gable(B, ex0, ex1, ey0, ey1, G + (5.5 if L >= 9 else 5.0), pitch=35, over=0.6, end_over=0.5, tile='slate_grey', wall='planks', tw=0.9, tl=1.2, barge=None)
        pts['smoke1'] = chimney(B, 19.5, 13.0, G + 5.0, G + 13.0 + (2.0 if L >= 9 else 0), key='trim' if L >= 9 else 'stone', s=1.2)
        window(B, (ex1 + 0.05, 11.5, G + 2.6), 'E', w=1.4, h=1.6, surround=None)
    if L >= 7:
        lamp_post(B, -14.0, -17.0, h=4.6)
        lamp_post(B, 17.0, -17.0, h=4.6)
    barrels(B, [(-15.0, -5.0)] + ([(-16.2, -3.6)] if L >= 4 else []))
    crates(B, [(-14.0, -1.5, 1.2)])


# ============================================================================
# warehouse (3x3): wood and stone
# ============================================================================
def warehouse(B, L):
    pts = B.points
    yk = ['earth', 'earth', 'gravel', 'gravel', 'cobble', 'cobble', 'paved', 'paved'][L - 1]
    yard(B, yk, -21.0, 21.0, -21.0, 21.0, r=3.0)
    if L <= 2:
        # stock in the open, under a lean-to
        wood_stack(B, -10.0, -8.0, n=4, length=6.0)
        stone_stack(B, -2.0, -10.0, 2, 3, 2)
        if L == 2:
            wood_stack(B, -14.0, -8.0, n=3, length=6.0)
            stone_stack(B, 4.0, -12.0, 2, 2, 2)
        x0, x1, y0, y1 = -6.0, 6.0, 2.0, 9.0
        for (x, y) in ((x0, y0), (x1, y0), (x1, y1), (x0, y1)):
            B.p('timber').box((0.4, 0.4, 4.0), (x, y, G + 2.0))
        from parts import shed_roof
        shed_roof(B, x0, x1, y0, y1, G + 4.0, G + 5.0, tile='shingle', over=0.6, tw=0.9, tl=1.1)
        wood_stack(B, -2.0, 5.5, n=3, length=5.0, along='x')
        stone_stack(B, 3.5, 5.5, 2, 2, 2)
        crates(B, [(9.0, -4.0, 1.2)])
        return
    # a building of growing size and material
    w = 18.0 + (L - 3) * 2.2
    d = 11.0 + (L - 3) * 1.2
    x0, x1, y0, y1 = -w / 2 - 2.0, w / 2 - 2.0, 1.0, 1.0 + d
    zt = G + 6.0 + (L - 3) * 0.6
    if L <= 4:
        ashlar(B, x0, x1, y0, y1, G, G + 1.0, rows=1, block=(1.0, 1.8), depth=0.6, quoins=False)
        plaster_wall(B, x0 + 0.1, x1 - 0.1, y0 + 0.1, y1 - 0.1, G + 1.0, zt, key='planks')
        for x in [x0 + 0.2 + i * 0.55 for i in range(int((x1 - x0) / 0.55))]:
            B.p('planks', bevel=0.02).box((0.5, 0.1, zt - G - 1.0), (x, y0 - 0.02, (G + 1.0 + zt) / 2))
        gable(B, x0, x1, y0, y1, zt, pitch=40, over=1.0, end_over=0.8, tile='shingle', wall='planks', tw=1.1, tl=1.4)
    elif L <= 6:
        ashlar(B, x0, x1, y0, y1, G, zt, rows=6, block=(1.3, 2.4))
        gable(B, x0, x1, y0, y1, zt, pitch=38, over=1.0, end_over=0.8, tile='roof_brown', wall='stone', tw=1.1, tl=1.4)
    else:
        brick_walls(B, x0, x1, y0, y1, G, zt)
        string_course(B, x0, x1, y0, y1, zt, key='trim', h=0.5, out=0.35)
        gable(B, x0, x1, y0, y1, zt, pitch=36, over=1.0, end_over=0.8, tile='slate_grey', wall='trim', tw=1.0, tl=1.3, caps='slate_grey_dark')
    bays = 1 if L < 6 else 2
    for k in range(bays):
        bx = (x0 + x1) / 2 + (k - (bays - 1) / 2) * (w * 0.4)
        door(B, (bx, y0 - 0.1, G), 'S', w=3.6, h=4.2, arch_key='stone' if L >= 5 else None, planks='door')
    if L >= 6:
        # loading platform along the front
        B.p('planks' if L < 8 else 'stone').box((x1 - x0 - 1.0, 2.6, 1.1), ((x0 + x1) / 2, y0 - 1.3, G + 0.55))
    for y in (y0 + d * 0.3, y0 + d * 0.7):
        window(B, (x1 + 0.05, y, zt - 2.0), 'E', w=1.4, h=1.4, surround=None if L < 5 else 'stone', frame_key='timber' if L < 7 else 'white')
    # stock outside
    wood_stack(B, -15.0, -9.0, n=4, length=6.0)
    stone_stack(B, -6.0, -11.0, 2, 3, 2 + (1 if L >= 5 else 0))
    if L >= 4:
        crane(B, 12.0 + (L - 4) * 0.3, -2.0, h=7.0 + L * 0.3, reach=4.5, key='timber' if L < 7 else 'iron')
    if L >= 5:
        wood_stack(B, 6.0, -12.0, n=3, length=6.0, along='x')
        stone_stack(B, 14.0, -12.0, 2, 2, 2)
    if L >= 7:
        wood_stack(B, -15.0, -15.0, n=3, length=6.0)
        stone_stack(B, 0.0, -16.0, 3, 2, 2)
        lamp_post(B, -19.0, -19.0, h=4.6)
        lamp_post(B, 19.0, -19.0, h=4.6)
    crates(B, [(16.5, -6.0, 1.2), (17.8, -6.4, 1.0)])


# ============================================================================
# treasury (2x2): coins
# ============================================================================
def treasury(B, L):
    pts = B.points
    from parts import chest, coins, pediment, lamp_post as lp
    yk = ['earth', 'gravel', 'gravel', 'cobble', 'paved', 'paved', 'paved', 'paved'][L - 1]
    yard(B, yk, -13.5, 13.5, -13.5, 11.5, r=2.0)
    if L == 1:
        x0, x1, y0, y1 = -4.5, 4.5, -1.5, 5.5
        logs(B, x0, x1, y0, y1, G, G + 3.4, d=0.5, over=0.4)
        gable(B, x0, x1, y0, y1, G + 3.4, pitch=40, over=0.7, end_over=0.5, tile='shingle', wall='planks', tw=0.9, tl=1.2)
        for z in (G + 0.8, G + 2.6):
            B.p('iron').box((x1 - x0 + 0.3, y1 - y0 + 0.3, 0.22), (0, (y0 + y1) / 2, z))
        door(B, (0.0, y0 - 0.25, G), 'S', w=1.5, h=2.4, arch_key=None, planks='door')
        B.p('iron').box((0.5, 0.2, 0.6), (0.4, y0 - 0.5, G + 1.3))
        chest(B, -6.0, -5.0, rot=0.3)
        coins(B, 6.0, -5.0, G, r=1.2, h=0.7, n=10)
        return
    w = 9.0 + L * 1.1
    d = 7.0 + L * 0.7
    x0, x1, y0, y1 = -w / 2, w / 2, -d / 2 + 1.0, d / 2 + 1.0
    zt = G + 4.4 + L * 0.5
    if L <= 3:
        ashlar(B, x0, x1, y0, y1, G, zt, rows=5, block=(1.0, 1.8), depth=0.7)
        roof = hip(B, x0, x1, y0, y1, zt + 0.2, pitch=38, over=0.7, tile='roof_brown', caps='roof_brown', tw=0.9, tl=1.2)
        door(B, (0.0, y0 - 0.1, G), 'S', w=1.8, h=2.9, arch_key='stone', planks='iron' if L >= 3 else 'door')
        for k in (-1, 1):
            B.p('iron').box((0.9, 0.2, 1.1), (k * w * 0.3, y0 - 0.1, G + 2.4))
    elif L == 4:
        ashlar(B, x0, x1, y0, y1, G, zt, key='lime', rows=5, block=(1.2, 2.0))
        string_course(B, x0, x1, y0, y1, zt, key='trim', h=0.5, out=0.35)
        hip(B, x0, x1, y0, y1, zt + 0.3, pitch=36, over=0.7, tile='copper', caps='gold', tw=0.9, tl=1.2)
        door(B, (0.0, y0 - 0.1, G), 'S', w=1.9, h=3.0, arch_key='trim', planks='iron')
    else:
        key = 'lime' if L < 7 else 'marble'
        ashlar(B, x0, x1, y0, y1, G, zt, key=key, rows=6, block=(1.4, 2.4), quoins=False)
        string_course(B, x0, x1, y0, y1, G + 0.5, key=key, h=1.0, out=0.25)
        string_course(B, x0, x1, y0, y1, zt, key='gold' if L >= 7 else 'trim', h=0.5, out=0.4)
        hip(B, x0, x1, y0, y1, zt + 0.3, pitch=34, over=0.7, tile='copper', caps='gold', tw=0.9, tl=1.2)
        # columned front with a pediment and a golden coin
        ncol = 2 if L < 6 else 4
        span = 5.0 if ncol == 2 else 8.0
        B.p(key).box((span + 2.0, 3.2, 0.6), (0.0, y0 - 1.6, G + 0.3))
        from parts import steps as st_
        st_(B, (0.0, y0 - 3.2, G), 'S', span, n=2, key=key, depth=0.5, rise=0.3)
        for i in range(ncol):
            column(B, -span / 2 + span * i / (ncol - 1), y0 - 2.6, G + 0.6, zt - G - 1.2, r=0.38, key='trim' if key == 'lime' else 'marble')
        B.p(key).box((span + 2.2, 3.4, 0.7), (0.0, y0 - 1.6, zt - 0.25))
        pediment(B, -span / 2 - 1.2, span / 2 + 1.2, y0 - 3.3, zt + 0.1, 2.0 + L * 0.15, depth=3.4, key=key)
        door(B, (0.0, y0 - 0.1, G + 0.6), 'S', w=1.9, h=3.1, arch_key='gold' if L >= 7 else 'trim', planks='iron')
        for k in (-1, 1):
            lp(B, k * (span / 2 + 2.6), y0 - 4.5, h=4.4)
    for y in (y0 + d * 0.3, y0 + d * 0.7):
        B.p('iron').box((0.2, 1.0, 1.2), (x1 + 0.1, y, G + 2.6))
    # the riches
    chest(B, -w / 2 - 1.5, y0 - 3.5, rot=0.3)
    coins(B, w / 2 + 1.8, y0 - 3.0, G, r=1.0 + L * 0.25, h=0.6 + L * 0.15, n=8 + L * 3)
    if L >= 5:
        chest(B, w / 2 + 2.5, y0 + 2.0, rot=-0.4)
    if L >= 7:
        coins(B, -w / 2 - 2.0, y0 + 1.5, G, r=1.0 + L * 0.2, h=0.6 + L * 0.1, n=8 + L * 2)



# ============================================================================
# civic: hospital (3x3, 6), school (3x3, 6), post office (2x2, 5)
# ============================================================================
def red_cross(B, c, face, s=1.0, board=True):
    from parts import NORMAL
    c = Vector(c)
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    if board:
        B.p('white').box((2.0 * s, 0.15, 2.0 * s), c + n * 0.08, (0, 0, ang))
    B.p('red').box((1.4 * s, 0.12, 0.45 * s), c + n * 0.2, (0, 0, ang))
    B.p('red').box((0.45 * s, 0.12, 1.4 * s), c + n * 0.2, (0, 0, ang))


def envelope(B, c, face, s=1.0):
    from parts import NORMAL, solid
    c = Vector(c)
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    B.p('post_red').box((2.2 * s, 0.15, 1.6 * s), c + n * 0.08, (0, 0, ang))
    B.p('white').box((1.6 * s, 0.12, 1.05 * s), c + n * 0.2, (0, 0, ang))
    top = c + n * 0.28 + Vector((0, 0, 0.52 * s))
    solid(B.p('post_red', bevel=0.0), [top - t * 0.8 * s, top + t * 0.8 * s, c + n * 0.28 + Vector((0, 0, -0.05 * s))], [(0, 1, 2)])


def mailbox(B, x, y, h=1.6):
    B.p('post_red').box((0.9, 0.7, 1.1), (x, y, G + h - 0.3))
    B.p('post_red').box((0.95, 0.75, 0.2), (x, y, G + h + 0.3))
    B.p('iron').box((0.6, 0.06, 0.12), (x, y - 0.38, G + h))
    B.p('iron').box((0.18, 0.18, h - 0.8), (x, y, G + (h - 0.8) / 2))


def swing(B, x, y):
    from parts import bar
    for s_ in (-1, 1):
        bar(B.p('timber'), (x + s_ * 1.6, y - 0.8, G), (x + s_ * 1.6, y, G + 3.0), 0.25)
        bar(B.p('timber'), (x + s_ * 1.6, y + 0.8, G), (x + s_ * 1.6, y, G + 3.0), 0.25)
    B.p('timber').box((3.6, 0.22, 0.22), (x, y, G + 3.0))
    for k in (-0.7, 0.7):
        for s_ in (-0.3, 0.3):
            B.p('iron').box((0.04, 0.04, 2.1), (x + k + s_, y, G + 1.95))
        B.p('planks').box((0.8, 0.35, 0.08), (x + k, y, G + 0.9))


def sandbox(B, x, y, s=3.0):
    B.p('planks').box((s, s, 0.4), (x, y, G + 0.2))
    B.p('sand', bevel=0.2).box((s - 0.4, s - 0.4, 0.42), (x, y, G + 0.21))


def hospital(B, L):
    pts = B.points
    from parts import fountain, wheel
    yk = ['earth', 'gravel', 'gravel', 'cobble', 'paved', 'paved'][L - 1]
    yard(B, yk, -21.0, 21.0, -21.0, 15.0, r=3.0)
    if L == 1:
        x0, x1, y0, y1 = -6.0, 4.0, -1.0, 7.0
        logs(B, x0, x1, y0, y1, G, G + 3.6, d=0.5, over=0.45)
        gable(B, x0, x1, y0, y1, G + 3.6, pitch=40, over=0.8, end_over=0.6, tile='thatch', wall='planks', tw=1.2, tl=1.5)
        door(B, (-3.0, y0 - 0.25, G), 'S', w=1.4, h=2.5, arch_key=None, planks='door')
        red_cross(B, (0.6, y0 - 0.3, G + 2.4), 'S', s=0.8)
        # herbs drying on a rack, a cot under an awning
        for x in (6.5, 10.5):
            B.p('timber').box((0.2, 0.2, 2.4), (x, -3.0, G + 1.2))
        B.p('timber').box((4.4, 0.15, 0.15), (8.5, -3.0, G + 2.3))
        for k in range(6):
            B.p('leaf', bevel=0.0).box((0.35, 0.35, 0.8), (6.9 + k * 0.65, -3.0, G + 1.8))
        B.p('canvas').box((3.6, 2.6, 0.12), (-2.0, -5.0, G + 2.4), (math.radians(8), 0, 0))
        for (x, y) in ((-3.7, -6.2), (-0.3, -6.2), (-3.7, -3.8), (-0.3, -3.8)):
            B.p('timber').box((0.15, 0.15, 2.3), (x, y, G + 1.15))
        B.p('canvas').box((2.0, 0.9, 0.3), (-2.0, -5.0, G + 0.6))
        barrels(B, [(6.0, 3.0)])
        return
    w = 14.0 + L * 2.6
    d = 9.0 + L * 0.9
    x0, x1, y0, y1 = -w / 2, w / 2, 0.0, d
    floors = 1 if L <= 3 else 2
    zt = G + 4.2 * floors + 0.4
    if L == 2:
        plaster_wall(B, x0, x1, y0, y1, G, zt, key='white')
        timber_frame(B, x0, x1, y0, y1, G, zt, spacing=2.6)
        gable(B, x0, x1, y0, y1, zt, pitch=42, over=0.9, end_over=0.7, tile='shingle', wall='white', tw=1.0, tl=1.3)
    elif L == 3:
        ashlar(B, x0, x1, y0, y1, G, G + 1.0, rows=1, block=(1.0, 1.8), depth=0.6, quoins=False)
        plaster_wall(B, x0 + 0.1, x1 - 0.1, y0 + 0.1, y1 - 0.1, G + 1.0, zt, key='white')
        gable(B, x0, x1, y0, y1, zt, pitch=40, over=0.9, end_over=0.7, tile='slate_grey', wall='white', tw=1.0, tl=1.3, caps='slate_grey_dark')
    else:
        plaster_wall(B, x0, x1, y0, y1, G, zt, key='white')
        string_course(B, x0, x1, y0, y1, G + 0.6, key='stone_grey', h=1.2, out=0.25)
        string_course(B, x0, x1, y0, y1, G + 4.4, key='trim', h=0.35, out=0.2)
        string_course(B, x0, x1, y0, y1, zt, key='trim', h=0.5, out=0.4)
        hip(B, x0, x1, y0, y1, zt + 0.3, pitch=34, over=0.9, tile='slate_grey', caps='slate_grey_dark', tw=1.0, tl=1.3)
        if L >= 5:
            for (wx0, wx1) in (((x0 - 9.0, x0 + 0.2) if L >= 6 else (None, None)), (x1 - 0.2, x1 + 8.0)):
                if wx0 is None:
                    continue
                wy0, wy1 = y0 - 8.0, y1 - 2.0
                plaster_wall(B, wx0, wx1, wy0, wy1, G, G + 8.6, key='white')
                string_course(B, wx0, wx1, wy0, wy1, G + 0.6, key='stone_grey', h=1.2, out=0.25)
                string_course(B, wx0, wx1, wy0, wy1, G + 8.6, key='trim', h=0.5, out=0.4)
                hip(B, wx0, wx1, wy0, wy1, G + 8.9, pitch=34, over=0.8, tile='slate_grey', caps='slate_grey_dark', tw=1.0, tl=1.3)
                for z in (G + 2.4, G + 6.4):
                    window(B, ((wx0 + wx1) / 2, wy0 - 0.05, z), 'S', w=1.4, h=2.0, surround='trim', frame_key='white')
                    for y in (wy0 + 2.5, wy0 + 6.5):
                        if wx1 > 0:
                            window(B, (wx1 + 0.05, y, z), 'E', w=1.4, h=2.0, surround='trim', frame_key='white')
                red_cross(B, ((wx0 + wx1) / 2, wy0 - 0.1, G + 4.4), 'S', s=0.9)
    # entrance with a canopy and the red cross over it
    door(B, (0.0, y0 - 0.1, G), 'S', w=2.4, h=3.0, arch_key=None if L < 4 else 'trim', planks='door' if L < 4 else 'green_paint')
    B.p('white' if L >= 4 else 'planks').box((5.0, 2.4, 0.3), (0.0, y0 - 1.2, G + 3.5))
    for x in (-2.2, 2.2):
        B.p('trim' if L >= 4 else 'timber').box((0.3, 0.3, 3.4), (x, y0 - 2.2, G + 1.7))
    red_cross(B, (0.0, y0 - 0.1, zt - 1.8 if floors > 1 else G + 4.6 if L > 2 else zt + 1.2), 'S', s=1.5 + 0.15 * L)
    for k in range(floors):
        z = G + 2.3 + 4.2 * k
        for x in [x0 + 2.0 + i * 3.0 for i in range(int((w - 3.0) / 3.0))]:
            if abs(x) < 3.2 and k == 0:
                continue
            window(B, (x, y0 - 0.05, z), 'S', w=1.4, h=2.0, surround='trim' if L >= 4 else None, frame_key='white' if L >= 3 else 'timber', shutters=L <= 3)
        for y in [y0 + 2.0 + i * 3.0 for i in range(int((d - 2.0) / 3.0))]:
            window(B, (x1 + 0.05, y, z), 'E', w=1.4, h=2.0, surround='trim' if L >= 4 else None, frame_key='white' if L >= 3 else 'timber', shutters=L <= 3)
    # the grounds
    from parts import bench as bn, flowerbed as fb
    if L >= 3:
        # a wooden cart with a red cross
        B.p('white').box((3.2, 1.8, 1.6), (12.0, -10.0, G + 1.5))
        red_cross(B, (12.0, -10.95, G + 1.6), 'S', s=0.5, board=False)
        for sy in (-1, 1):
            wheel(B, (12.0, -10.0 + sy * 1.0, G + 0.75), 0.7, axis='y', key='timber', rim='iron', spokes=6, w=0.12)
    if L >= 4:
        bn(B, -9.0, -10.0, along='x')
        fb(B, -14.0, -15.0, 4.0, 1.6, seed=L)
        fb(B, 4.0, -15.0, 4.0, 1.6, seed=L + 1)
        lamp_post(B, -4.0, -12.0, h=4.6)
        lamp_post(B, 4.0, -12.0, h=4.6)
    if L >= 6:
        fountain(B, -12.0, -12.0, r=2.4)
    barrels(B, [(16.0, 4.0)])


def school(B, L):
    pts = B.points
    yk = ['earth', 'earth', 'gravel', 'gravel', 'cobble', 'paved'][L - 1]
    yard(B, yk, -21.0, 21.0, -21.0, 15.0, r=3.0)
    if L == 1:
        # lessons outdoors: a canopy, benches and a blackboard
        for (x, y) in ((-6.0, -4.0), (4.0, -4.0), (4.0, 4.0), (-6.0, 4.0)):
            B.p('timber').box((0.3, 0.3, 3.4), (x, y, G + 1.7))
        from parts import shed_roof
        shed_roof(B, -6.0, 4.0, -4.0, 4.0, G + 3.4, G + 4.4, tile='thatch', over=0.6, tw=1.2, tl=1.5)
        for y in (-2.0, 0.6):
            bench(B, -1.0, y, along='x')
        B.p('timber').box((3.2, 0.2, 2.0), (-1.0, 3.4, G + 1.8))
        B.p('green_paint').box((2.9, 0.1, 1.7), (-1.0, 3.28, G + 1.8))
        for x in (-2.3, 0.3):
            B.p('timber').box((0.15, 0.15, 2.8), (x, 3.5, G + 1.4))
        sandbox(B, 10.0, -6.0, 3.0)
        return
    w = 12.0 + L * 2.4
    d = 8.0 + L * 1.0
    x0, x1, y0, y1 = -w / 2 - 2.0, w / 2 - 2.0, 0.0, d
    floors = 1 if L <= 3 else 2
    zt = G + 4.0 * floors + 0.4
    if L == 2:
        logs(B, x0, x1, y0, y1, G, zt, d=0.55, over=0.5)
        gable(B, x0, x1, y0, y1, zt, pitch=42, over=0.9, end_over=0.7, tile='shingle', wall='planks', tw=1.0, tl=1.3)
    elif L == 3:
        ashlar(B, x0, x1, y0, y1, G, G + 0.9, rows=1, block=(1.0, 1.8), depth=0.6, quoins=False)
        plaster_wall(B, x0 + 0.1, x1 - 0.1, y0 + 0.1, y1 - 0.1, G + 0.9, zt, key='ochre')
        gable(B, x0, x1, y0, y1, zt, pitch=42, over=0.9, end_over=0.7, tile='roof', wall='ochre', tw=1.0, tl=1.3)
    else:
        plaster_wall(B, x0, x1, y0, y1, G, zt, key='ochre')
        string_course(B, x0, x1, y0, y1, G + 0.6, key='stone', h=1.2, out=0.25)
        string_course(B, x0, x1, y0, y1, G + 4.2, key='white', h=0.35, out=0.2)
        string_course(B, x0, x1, y0, y1, zt, key='white', h=0.5, out=0.4)
        gable(B, x0, x1, y0, y1, zt + 0.25, pitch=38, over=1.0, end_over=0.8, tile='roof', wall='ochre', tw=1.0, tl=1.3)
        if L >= 5:
            wx0, wx1, wy0, wy1 = x1 - 0.2, x1 + 7.5, y0 - 6.0, y1 - 1.0
            plaster_wall(B, wx0, wx1, wy0, wy1, G, G + 8.4, key='ochre')
            string_course(B, wx0, wx1, wy0, wy1, G + 0.6, key='stone', h=1.2, out=0.25)
            string_course(B, wx0, wx1, wy0, wy1, G + 8.4, key='white', h=0.5, out=0.4)
            gable(B, wx0, wx1, wy0, wy1, G + 8.6, pitch=38, over=0.9, end_over=0.7, tile='roof', wall='ochre', along='y', tw=1.0, tl=1.3, barge=None)
            for z in (G + 2.4, G + 6.2):
                window(B, ((wx0 + wx1) / 2, wy0 - 0.05, z), 'S', w=1.6, h=2.2, surround='white', frame_key='white')
                for y in (wy0 + 3.0, wy0 + 7.5, wy0 + 12.0):
                    window(B, (wx1 + 0.05, y, z), 'E', w=1.6, h=2.2, surround='white', frame_key='white')
    # entrance; a columned porch at the top level
    door(B, (0.0 - 2.0, y0 - 0.1, G), 'S', w=2.2, h=3.0, arch_key='white' if L >= 4 else None, planks='door')
    if L >= 6:
        B.p('stone').box((7.0, 3.0, 0.5), (-2.0, y0 - 1.5, G + 0.25))
        for x in (-4.6, -3.0, -1.0, 0.6):
            column(B, x, y0 - 2.6, G + 0.5, 4.0, r=0.3, key='white')
        from parts import pediment
        B.p('white').box((7.2, 3.2, 0.5), (-2.0, y0 - 1.5, G + 4.75))
        pediment(B, -5.8, 1.8, y0 - 3.1, G + 5.0, 1.8, depth=3.0, key='white', emblem=False)
    # the school sign: an open book
    B.p('white').box((1.0, 0.12, 0.8), (-3.0, y0 - 0.25, G + 4.1 if floors > 1 else zt + 0.6), (0, math.radians(-18), 0))
    B.p('white').box((1.0, 0.12, 0.8), (-1.0, y0 - 0.25, G + 4.1 if floors > 1 else zt + 0.6), (0, math.radians(18), 0))
    for k in range(floors):
        z = G + 2.2 + 4.0 * k
        for x in [x0 + 2.0 + i * 3.0 for i in range(int((w - 3.0) / 3.0))]:
            if abs(x + 2.0) < 2.8 and k == 0:
                continue
            window(B, (x, y0 - 0.05, z), 'S', w=1.6, h=2.2, surround='white' if L >= 4 else None, frame_key='white' if L >= 3 else 'timber', shutters=L <= 3)
        for y in [y0 + 2.2 + i * 3.2 for i in range(int((d - 2.0) / 3.2))]:
            window(B, (x1 + 0.05, y, z), 'E', w=1.6, h=2.2, surround='white' if L >= 4 else None, frame_key='white' if L >= 3 else 'timber', shutters=L <= 3)
    # playground
    swing(B, 12.0 if L < 5 else -14.0, -12.0)
    sandbox(B, 6.0 if L < 5 else -6.0, -14.0, 3.2)
    if L >= 4:
        bench(B, -14.0 if L < 5 else 6.0, -10.0, along='x')
        lamp_post(B, 2.0, -16.0, h=4.6)
    if L >= 6:
        swing(B, 14.0, -12.0)


def post(B, L):
    pts = B.points
    yk = ['earth', 'gravel', 'cobble', 'paved', 'paved'][L - 1]
    yard(B, yk, -13.5, 13.5, -13.5, 11.0, r=2.0)
    if L == 1:
        mailbox(B, -2.0, -6.0)
        x0, x1, y0, y1 = -2.0, 4.0, -1.0, 4.0
        plaster_wall(B, x0, x1, y0, y1, G, G + 3.0, key='planks')
        from parts import shed_roof
        shed_roof(B, x0, x1, y0, y1, G + 3.0, G + 3.8, tile='shingle', over=0.4, tw=0.8, tl=1.0)
        B.p('canvas').box((2.6, 0.12, 1.0), (1.0, y0 - 0.12, G + 1.8))
        envelope(B, (1.0, y0 - 0.15, G + 3.3), 'S', s=0.6)
        # a dovecote on a pole
        B.p('timber').box((0.25, 0.25, 4.5), (-6.0, -2.0, G + 2.25))
        B.p('white').box((1.6, 1.6, 1.2), (-6.0, -2.0, G + 5.0))
        from parts import pyramid as pyr
        pyr(B, -6.0, -2.0, 0.8, G + 5.6, 1.0, tile='shingle', caps='timber', over=0.3, tw=0.5, tl=0.6)
        return
    w = 8.0 + L * 1.4
    d = 7.0 + L * 0.6
    x0, x1, y0, y1 = -w / 2, w / 2, -1.0, -1.0 + d
    zt = G + (3.8 if L < 4 else 7.6)
    if L == 2:
        plaster_wall(B, x0, x1, y0, y1, G, zt, key='planks')
        gable(B, x0, x1, y0, y1, zt, pitch=42, over=0.8, end_over=0.6, tile='shingle', wall='planks', tw=0.9, tl=1.2)
    elif L == 3:
        plaster_wall(B, x0, x1, y0, y1, G, zt, key='plaster')
        timber_frame(B, x0, x1, y0, y1, G, zt, spacing=2.2)
        gable(B, x0, x1, y0, y1, zt, pitch=48, over=0.9, end_over=0.7, tile='roof', wall='plaster', tw=0.9, tl=1.2)
    elif L == 4:
        ashlar(B, x0, x1, y0, y1, G, zt, rows=7, block=(1.0, 1.8), depth=0.7)
        gable(B, x0, x1, y0, y1, zt, pitch=44, over=0.9, end_over=0.7, tile='roof', wall='stone', tw=0.9, tl=1.2)
    else:
        brick_walls(B, x0, x1, y0, y1, G, zt)
        string_course(B, x0, x1, y0, y1, zt, key='trim', h=0.45, out=0.35)
        hip(B, x0, x1, y0, y1, zt + 0.25, pitch=40, over=0.8, tile='slate_grey', caps='slate_grey_dark', tw=0.9, tl=1.2)
    door(B, (-1.5, y0 - 0.1, G), 'S', w=1.8, h=2.8, arch_key='stone' if L >= 4 else None, planks='green_paint')
    envelope(B, (1.6, y0 - 0.12, G + 3.0 if L < 4 else G + 4.6), 'S', s=0.8 if L < 4 else 1.0)
    window(B, (x0 + 1.8, y0 - 0.05, G + 2.0), 'S', w=1.3, h=1.7, shutters=True, surround='stone' if L >= 4 else None, frame_key='white')
    window(B, (x1 + 0.05, (y0 + y1) / 2, G + 2.0), 'E', w=1.3, h=1.7, shutters=True, surround='stone' if L >= 4 else None, frame_key='white')
    if L >= 4:
        for x in (-2.6, 0.0, 2.6):
            window(B, (x, y0 - 0.05, G + 6.0), 'S', w=1.2, h=1.6, shutters=True, surround='stone' if L == 4 else 'trim', frame_key='white')
        window(B, (x1 + 0.05, (y0 + y1) / 2, G + 6.0), 'E', w=1.2, h=1.6, shutters=True, surround='stone' if L == 4 else 'trim', frame_key='white')
        # a golden post horn
        B.p('gold', smooth=True, bevel=0.0).lathe([(0.05, 0.0), (0.12, 0.6), (0.45, 1.0)], (x1 - 1.2, y0 - 0.4, G + 3.8), segments=16)
    mailbox(B, -5.0 - L * 0.4, -6.0)
    if L >= 3:
        mailbox(B, 5.5, -6.5)
        bench(B, 0.0, -8.5, along='x')
    if L >= 5:
        # the mail coach
        from parts import wheel
        B.p('post_red').box((3.2, 1.9, 1.8), (8.5, -10.0, G + 1.8))
        B.p('timber').box((3.4, 2.0, 0.2), (8.5, -10.0, G + 2.8))
        for sx in (-1.1, 1.1):
            for sy in (-1, 1):
                wheel(B, (8.5 + sx, -10.0 + sy * 1.05, G + 0.85), 0.8, axis='y', key='timber', rim='iron', spokes=8, w=0.12)
        lamp_post(B, -10.0, -11.0, h=4.4)


# ============================================================================
# decorations (1 level each)
# ============================================================================
def deco(B, kind):
    from parts import fountain, flowerbed as fb, tree as tr, bench as bn, lamp_post as lp, cone as cn, figure as fg
    if kind == 'square':
        yard(B, 'paved', -13.5, 13.5, -13.5, 13.5)
        for (x, y) in ((-7.0, -7.0), (7.0, -7.0), (-7.0, 7.0), (7.0, 7.0)):
            B.p('lawn', bevel=0.5, segments=2).box((9.0, 9.0, 0.3), (x, y, G + 0.12))
        tr(B, -7.0, 7.0, h=8.0, seed=3)
        tr(B, 7.0, 7.0, h=7.0, seed=5)
        fb(B, -7.0, -7.0, 3.6, 3.6, seed=7)
        fb(B, 7.0, -7.0, 3.6, 3.6, seed=8)
        bn(B, 0.0, -2.6, along='x')
        bn(B, 2.6, 0.0, along='y')
        lp(B, -2.2, 2.2, h=4.6)
    elif kind == 'fountain':
        yard(B, 'paved', -13.5, 13.5, -13.5, 13.5)
        fountain(B, 0.0, 0.0, r=6.0)
        for (x, y) in ((-10.5, -10.5), (10.5, -10.5), (-10.5, 10.5), (10.5, 10.5)):
            lp(B, x, y, h=4.6)
    elif kind == 'monument':
        yard(B, 'paved', -13.5, 13.5, -13.5, 13.5)
        B.p('stone').box((7.0, 7.0, 0.8), (0, 0, G + 0.4))
        B.p('marble').box((4.4, 4.4, 4.0), (0, 0, G + 2.8))
        B.p('gold').box((4.0, 0.12, 1.2), (0, -2.25, G + 2.6))
        fg(B, 0.0, 0.0, z=G + 4.8, h=4.6, face=(0.7, -1.0), body='bronze', helmet='bronze', vest='bronze', tool=False)
        for (x, y) in ((-7.5, -7.5), (7.5, -7.5)):
            fb(B, x, y, 3.4, 3.4, seed=int(x))
    elif kind == 'flowerbed':
        fb(B, 0.0, 0.0, 9.0, 9.0, seed=21)
    elif kind == 'bench':
        yard(B, 'paved', -5.5, 5.5, -4.0, 4.0)
        bn(B, 0.0, 0.0, along='x')
        fb(B, 0.0, 2.6, 4.0, 1.2, seed=31)
    elif kind == 'lamp':
        yard(B, 'paved', -3.0, 3.0, -3.0, 3.0)
        lp(B, 0.0, 0.0, h=5.0)
    elif kind == 'gazebo':
        yard(B, 'paved', -12.0, 12.0, -12.0, 12.0)
        B.p('stone', smooth=False, bevel=0.0).lathe([(7.0, G), (7.0, G + 0.6), (0.0, G + 0.61)], (0, 0, 0), segments=6)
        for k in range(6):
            a = 2 * math.pi * k / 6
            B.p('white').box((0.45, 0.45, 4.6), (math.cos(a) * 6.3, math.sin(a) * 6.3, G + 0.6 + 2.3))
        B.p('white', smooth=False, bevel=0.0).lathe([(7.2, G + 5.2), (7.2, G + 5.6), (6.6, G + 5.61)], (0, 0, 0), segments=6)
        cn(B, 0.0, 0.0, 7.6, G + 5.6, 5.0, key='roof', rows=7)
        from parts import finial
        finial(B, 0.0, 0.0, G + 10.4, h=1.0, key='white')
        bn(B, 0.0, 3.2, along='x')
        fb(B, -9.0, -9.0, 3.0, 3.0, seed=41)
        fb(B, 9.0, -9.0, 3.0, 3.0, seed=42)


DECOS = ['square', 'fountain', 'monument', 'flowerbed', 'bench', 'lamp', 'gazebo']
DECO_CELLS = {'square': 2, 'fountain': 2, 'monument': 2, 'flowerbed': 1, 'bench': 1, 'lamp': 1, 'gazebo': 2}


TYPES = {
    # type: (function, cells, levels, camera lift in metres)
    'builder': (builder, 1, 1, 2.5),
    'house': (house, 2, 10, 6.0),
    'farm': (farm, 4, 8, 4.0),
    'mine': (mine, 3, 10, 8.0),
    'warehouse': (warehouse, 3, 8, 7.0),
    'treasury': (treasury, 2, 8, 6.0),
    'hospital': (hospital, 3, 6, 7.0),
    'school': (school, 3, 6, 7.0),
    'post': (post, 2, 5, 6.0),
}
for _d in DECOS:
    TYPES[_d] = ((lambda name: (lambda B, L: deco(B, name)))(_d), DECO_CELLS[_d], 1, 4.0 if DECO_CELLS[_d] == 2 else 2.0)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    kind, level, out = argv[0], int(argv[1]), os.path.abspath(argv[2])
    samples = int(argv[3]) if len(argv) > 3 else 80
    fn, cells, levels, lift = TYPES[kind]
    kit.reset_scene()
    kit.bpy.context.scene.cycles.samples = samples
    kit.setup_world(0.95)
    kit.setup_sun(energy=4.6)
    kit.setup_camera(cells, res=int(PX_PER_CELL * cells * float(os.environ.get('RES_SCALE', '1'))), margin=1.42, lift=lift)
    kit.shadow_catcher()
    B = Build(palette(), seed=level * 31 + len(kind))
    fn(B, level)
    B.finish()
    meta = kit.lot_meta(cells, extra={k: tuple(v) for k, v in B.points.items()})
    meta.update(type=kind, level=level)
    kit.render(out, out[:-4] + '.json', meta)
    print('rendered', out)
