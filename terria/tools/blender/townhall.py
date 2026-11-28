"""
TERRIA town hall, level 1 (3x3 cells = 48 m lot).

  blender -b --python tools/blender/townhall.py -- <out.png> [resolution] [samples]

A sturdy village hall: a stone ground floor, a timber-framed upper floor
that juts out over it, a big terracotta roof, and a front tower with a
clock, an open belfry and a slate spire with a golden finial and a flag.
It stands on a cobbled square with a stone kerb; no greenery on the lot.
Writes <out>.json next to the picture: lot anchor, lot diamond width and
named points (chimney tops, flag) for the game's effects.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import kit  # noqa: E402
from mathutils import Matrix  # noqa: E402
from kit import Pieces, hexc, material, stone_course, tile_rows  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'townhall_1.png')
RES = int(argv[1]) if len(argv) > 1 else 1400
SAMPLES = int(argv[2]) if len(argv) > 2 else 160

kit.reset_scene()
kit.bpy.context.scene.cycles.samples = SAMPLES
kit.setup_world(0.95)
kit.setup_sun(energy=4.6)
kit.setup_camera(3, res=RES, margin=1.34, lift=17.0)
kit.shadow_catcher()

# ---------------------------------------------------------------- materials
M = {
    'stone': material('stone', hexc('#b9a68c'), rough=0.85, var=0.14, hue_var=0.02, bump=0.25, bump_scale=3.0),
    'stone_core': material('stone_core', hexc('#6e655a'), rough=0.9, var=0.05),
    'kerb': material('kerb', hexc('#a89a86'), rough=0.85, var=0.12, bump=0.2),
    'plaster': material('plaster', hexc('#f2e3c4'), rough=0.9, var=0.03, noise_amt=0.1, noise_scale=0.8, bump=0.08, bump_scale=8),
    'timber': material('timber', hexc('#5b3418'), rough=0.7, var=0.12, bump=0.15, bump_scale=14),
    'roof': material('roof', hexc('#c0502b'), rough=0.6, var=0.07, hue_var=0.008, noise_amt=0.08),
    'roof_under': material('roof_under', hexc('#5a2010'), rough=0.8, var=0.0),
    'slate': material('slate', hexc('#3f62a0'), rough=0.45, var=0.07, hue_var=0.005, noise_amt=0.06),
    'slate_dark': material('slate_dark', hexc('#26375a'), rough=0.6, var=0.0),
    'gold': material('gold', hexc('#f5bd4f'), rough=0.28, var=0.0, metallic=1.0, noise_amt=0.0),
    'iron': material('iron', hexc('#2a2a2f'), rough=0.45, var=0.05, metallic=0.6),
    'door': material('door', hexc('#7c4a22'), rough=0.7, var=0.12, bump=0.2, bump_scale=10),
    'banner': material('banner', hexc('#b5141c'), rough=0.8, var=0.0, noise_amt=0.05),
    'clock': material('clock', hexc('#f6f0e1'), rough=0.6, var=0.0, noise_amt=0.0),
    'shutter': material('shutter', hexc('#2f6f8f'), rough=0.7, var=0.08),
    'cobble': kit.cobble_material('cobble', a=hexc('#a8987c'), b=hexc('#7d705e'), mortar=hexc('#4c443a'), scale=0.85),
    'glass': kit.glass_material(),
    'bell': material('bell', hexc('#c9963b'), rough=0.3, var=0.0, metallic=1.0, noise_amt=0.0),
    'flag': material('flag', hexc('#c8161f'), rough=0.85, var=0.0, noise_amt=0.0),
}

# ------------------------------------------------------------ lot and square
LOT = 24.0
sq = Pieces('square', M['cobble'], bevel=0.25, segments=3)
sq.box((45.0, 45.0, 0.4), (0, 0, 0.2))
sq.build()
kerb = Pieces('kerb', M['kerb'], bevel=0.12, seed=5)
for side in range(4):
    x = -22.6
    while x < 22.6:
        l = kerb.rng.uniform(1.6, 2.6)
        x1 = min(22.6, x + l)
        cx = (x + x1) / 2
        if side == 0:
            kerb.box((x1 - x - 0.1, 1.2, 0.62), (cx, -22.6, 0.31))
        elif side == 1:
            kerb.box((x1 - x - 0.1, 1.2, 0.62), (cx, 22.6, 0.31))
        elif side == 2:
            kerb.box((1.2, x1 - x - 0.1, 0.62), (-22.6, cx, 0.31))
        else:
            kerb.box((1.2, x1 - x - 0.1, 0.62), (22.6, cx, 0.31))
        x = x1
kerb.build()

G = 0.4  # ground level on the square

# ------------------------------------------------------------- main hall
X0, X1, Y0, Y1 = -11.0, 11.0, -6.0, 8.0
F1 = G + 7.0      # top of the stone ground floor
F2 = F1 + 6.0     # top of the timber floor
JET = 0.55        # the upper floor juts out by this much

core = Pieces('hall_core', M['stone_core'], bevel=0.0)
core.box((X1 - X0 - 0.5, Y1 - Y0 - 0.5, F1 - G), (0, (Y0 + Y1) / 2, (G + F1) / 2))
core.build()

stones = Pieces('stones', M['stone'], bevel=0.14, segments=2, seed=11)
# outward normal -> direction along the wall with the inside on the right
walls = [((X1, Y0), (X0, Y0)), ((X1, Y1), (X1, Y0)), ((X0, Y1), (X1, Y1)), ((X0, Y0), (X0, Y1))]
for a, b in walls:
    d = Vector((b[0] - a[0], b[1] - a[1], 0))
    L = d.length
    stone_course(stones, (a[0], a[1], 0), d, L, G, F1 - G, 0.9, block=(1.3, 2.4), rows=7)
# corner quoins: big blocks alternating on the corners
for cx, cy in ((X0, Y0), (X1, Y0), (X0, Y1), (X1, Y1)):
    for r in range(7):
        h = (F1 - G) / 7
        long_x = r % 2 == 0
        sx = 2.2 if long_x else 1.3
        sy = 1.3 if long_x else 2.2
        stones.box((sx, sy, h - 0.06), (cx - math.copysign(sx / 2 - 0.65, cx), cy - math.copysign(sy / 2 - 0.65, cy), G + r * h + h / 2))
# plinth
for a, b in walls:
    d = Vector((b[0] - a[0], b[1] - a[1], 0))
    mid = (Vector((a[0], a[1], 0)) + Vector((b[0], b[1], 0))) / 2
    n = Vector((-d.y, d.x, 0)).normalized()  # outward
    size = (abs(d.x) + 1.4 if d.x else 1.0, abs(d.y) + 1.4 if d.y else 1.0, 0.7)
    stones.box(size, mid + n * 0.3 + Vector((0, 0, G + 0.35)), rnd=0.3)

# upper floor: plaster with a timber frame
ux0, ux1, uy0, uy1 = X0 - JET, X1 + JET, Y0 - JET, Y1 + JET
pl = Pieces('plaster', M['plaster'], bevel=0.05)
pl.box((ux1 - ux0 - 0.3, uy1 - uy0 - 0.3, F2 - F1), (0, (uy0 + uy1) / 2, (F1 + F2) / 2))
pl.build()
tim = Pieces('timber', M['timber'], bevel=0.08, seed=21)
B = 0.42  # beam width


def frame_wall(a, b, z0, z1, braces=True, skip=()):
    """Timber frame on a wall face from a to b (outward normal on the right of a->b... computed)."""
    a = Vector((a[0], a[1], 0))
    b = Vector((b[0], b[1], 0))
    d = b - a
    L = d.length
    t = d.normalized()
    n = Vector((t.y, -t.x, 0))
    ang = math.atan2(t.y, t.x)
    off = n * 0.12
    # sill and plate
    for z in (z0 + B / 2, z1 - B / 2):
        tim.box((L + 0.3, B, B), (a + d / 2 + off) + Vector((0, 0, z)), (0, 0, ang))
    # mid rail
    tim.box((L, B * 0.8, B * 0.8), (a + d / 2 + off) + Vector((0, 0, (z0 + z1) / 2 + 0.6)), (0, 0, ang))
    # posts
    k = max(2, int(round(L / 2.6)))
    for i in range(k + 1):
        s = i * L / k
        if any(abs(s - q) < 0.8 for q in skip):
            continue
        tim.box((B, B, z1 - z0), a + t * s + off + Vector((0, 0, (z0 + z1) / 2)), (0, 0, ang))
    # braces in the end panels
    if braces:
        h = z1 - z0 - B * 2
        w = L / k
        for s0, sign in ((0.0, 1), (L - w, -1)):
            ln = math.hypot(w, h)
            tilt = math.atan2(h, w) * sign
            c = a + t * (s0 + w / 2) + off + Vector((0, 0, (z0 + z1) / 2))
            tim.box((ln, B * 0.8, B * 0.8), c, (tilt * 0 + 0, -tilt if True else 0, ang))


frame_wall((ux0, uy0), (ux1, uy0), F1, F2, skip=())
frame_wall((ux1, uy0), (ux1, uy1), F1, F2)
frame_wall((ux1, uy1), (ux0, uy1), F1, F2)
frame_wall((ux0, uy1), (ux0, uy0), F1, F2)
# joist ends under the jetty
for x in [ux0 + 0.7 + i * 1.5 for i in range(int((ux1 - ux0 - 1.0) / 1.5) + 1)]:
    tim.box((0.45, JET + 0.5, 0.5), (x, Y0 - JET / 2 + 0.1, F1 - 0.05))
for y in [uy0 + 0.7 + i * 1.5 for i in range(int((uy1 - uy0 - 1.0) / 1.5) + 1)]:
    tim.box((JET + 0.5, 0.45, 0.5), (X1 + JET / 2 - 0.1, y, F1 - 0.05))

# ------------------------------------------------------------------ roof
PITCH = math.radians(52)
OVER = 1.3
ycen = (uy0 + uy1) / 2
half = (uy1 - uy0) / 2 + OVER
rise = half * math.tan(PITCH)
zr = F2 + rise - OVER * math.tan(PITCH)   # ridge height
ze = zr - half * math.tan(PITCH)          # eave height
rx0, rx1 = ux0 - 1.0, ux1 + 1.0
slope = half / math.cos(PITCH)
roof = Pieces('roof_tiles', M['roof'], bevel=0.07, segments=2, seed=31)
under = Pieces('roof_under', M['roof_under'], bevel=0.0)
for side in (-1, 1):
    down = Vector((0, side * math.cos(PITCH), -math.sin(PITCH)))
    origin = Vector((rx0, ycen, zr + 0.15))
    tile_rows(roof, origin, (1, 0, 0), down, rx1 - rx0, slope, tile_w=1.1, tile_l=1.5, thick=0.22, jitter=0.012)
    c = origin + Vector((rx1 - rx0, 0, 0)) / 2 + down * (slope / 2) + Vector((0, 0, -0.2))
    under.box((rx1 - rx0 - 0.2, slope, 0.3), c, (side * -PITCH, 0, 0) if side > 0 else (PITCH, 0, 0))
# ridge caps
for i in range(int((rx1 - rx0) / 1.1)):
    roof.box((1.12, 0.95, 0.95), (rx0 + 0.55 + i * 1.1, ycen, zr + 0.55), (math.radians(45), 0, 0), rnd=0.5)
roof.build()
under.build()

# gable walls (timber-framed triangles) on the east and west ends
gab = Pieces('gable', M['plaster'], bevel=0.04)
for x, s in ((ux1 - 0.15, 1), (ux0 + 0.15, -1)):
    v = [(x, uy0, F2), (x, uy1, F2), (x, ycen, zr - 0.4), (x - s * 0.6, uy0, F2), (x - s * 0.6, uy1, F2), (x - s * 0.6, ycen, zr - 0.4)]
    gab.mesh_from(v, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
gab.build()
for x in (ux1 + 0.05, ux0 - 0.05):
    # king post, collar and rafters of the gable frame
    tim.box((B, B, zr - F2 - 1.0), (x, ycen, (F2 + zr - 1.0) / 2))
    tim.box((B, uy1 - uy0 - 3.2, B), (x, ycen, F2 + (zr - F2) * 0.42))
    for side in (-1, 1):
        ln = slope + 0.6
        c = Vector((x, ycen + side * (half - OVER) / 2, (F2 + zr) / 2 - 0.25))
        tim.box((B, ln - OVER, B), c, (side * -PITCH if side > 0 else PITCH, 0, 0))
# barge boards along the gable edges
for x in (rx1 + 0.15, rx0 - 0.15):
    for side in (-1, 1):
        c = Vector((x, ycen + side * half / 2, (zr + ze) / 2 + 0.25))
        tim.box((0.35, slope + 0.4, 0.75), c, ((-PITCH if side > 0 else PITCH), 0, 0))

# --------------------------------------------------------------- tower
TX0, TX1, TY0, TY1 = -3.6, 3.6, -9.8, -2.6
T1 = G + 7.6     # stone base
T2 = T1 + 7.6    # plastered shaft with the clock
T3 = T2 + 5.4    # open belfry
tcore = Pieces('tower_core', M['stone_core'], bevel=0.0)
tcore.box((TX1 - TX0 - 0.5, TY1 - TY0 - 0.5, T1 - G), (0, (TY0 + TY1) / 2, (G + T1) / 2))
tcore.build()
for a, b in [((TX1, TY0), (TX0, TY0)), ((TX1, TY1), (TX1, TY0)), ((TX0, TY0), (TX0, TY1))]:
    d = Vector((b[0] - a[0], b[1] - a[1], 0))
    stone_course(stones, (a[0], a[1], 0), d, d.length, G, T1 - G, 0.9, block=(1.2, 2.1), rows=8)
for cx, cy in ((TX0, TY0), (TX1, TY0), (TX1, TY1), (TX0, TY1)):
    for r in range(8):
        h = (T1 - G) / 8
        long_x = r % 2 == 0
        sx = 1.9 if long_x else 1.2
        sy = 1.2 if long_x else 1.9
        stones.box((sx, sy, h - 0.06), (cx - math.copysign(sx / 2 - 0.6, cx), cy - math.copysign(sy / 2 - 0.6, cy - (TY0 + TY1) / 2), G + r * h + h / 2))
# string course between stone and plaster
stones.box((TX1 - TX0 + 0.9, TY1 - TY0 + 0.9, 0.55), (0, (TY0 + TY1) / 2, T1 + 0.2), rnd=0.4)
stones.build()

tp = Pieces('tower_plaster', M['plaster'], bevel=0.05)
tp.box((TX1 - TX0 - 0.2, TY1 - TY0 - 0.2, T2 - T1), (0, (TY0 + TY1) / 2, (T1 + T2) / 2))
tp.build()
# corner posts of the shaft and of the belfry
for cx, cy in ((TX0 + 0.25, TY0 + 0.25), (TX1 - 0.25, TY0 + 0.25), (TX1 - 0.25, TY1 - 0.25), (TX0 + 0.25, TY1 - 0.25)):
    tim.box((0.6, 0.6, T3 - T1), (cx, cy, (T1 + T3) / 2))
for z in (T1 + 0.3, T2, T3 - 0.25):
    for (a, b) in (((TX0, TY0), (TX1, TY0)), ((TX1, TY0), (TX1, TY1)), ((TX0, TY1), (TX1, TY1)), ((TX0, TY0), (TX0, TY1))):
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        sx = abs(b[0] - a[0]) + 0.6 or 0.55
        sy = abs(b[1] - a[1]) + 0.6 or 0.55
        tim.box((sx, sy, 0.5), (mid[0], mid[1], z))
# belfry: low parapet with balusters, a floor and the bell
tim.box((TX1 - TX0, TY1 - TY0, 0.35), (0, (TY0 + TY1) / 2, T2 + 0.2), rnd=0.2)
for (a, b) in (((TX0, TY0), (TX1, TY0)), ((TX1, TY0), (TX1, TY1))):
    n = 5
    for i in range(1, n):
        x = a[0] + (b[0] - a[0]) * i / n
        y = a[1] + (b[1] - a[1]) * i / n
        tim.box((0.28, 0.28, 1.1), (x, y, T2 + 0.9))
    tim.box((abs(b[0] - a[0]) or 0.3, abs(b[1] - a[1]) or 0.3, 0.3), ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, T2 + 1.5))
# arched openings: corbels under the top plate
for (a, b) in (((TX0, TY0), (TX1, TY0)), ((TX1, TY0), (TX1, TY1))):
    for f in (0.25, 0.75):
        x = a[0] + (b[0] - a[0]) * f
        y = a[1] + (b[1] - a[1]) * f
        tim.box((0.4 if a[1] == b[1] else 0.5, 0.5 if a[1] == b[1] else 0.4, 0.9), (x, y, T3 - 0.9))
tim.build()

bell = Pieces('bell', M['bell'], bevel=0.0)
bc = (0, (TY0 + TY1) / 2)
bell.lathe([(0.12, 2.15), (0.55, 2.1), (0.8, 1.7), (0.95, 0.9), (1.3, 0.25), (1.42, 0.0), (1.2, 0.05), (0.2, 0.3)], (bc[0], bc[1], T2 + 1.2), segments=32)
bell.build(smooth=True)
yoke = Pieces('yoke', M['timber'], bevel=0.05)
yoke.box((TX1 - TX0 - 0.6, 0.45, 0.45), (0, bc[1], T2 + 3.55))
yoke.build()

# spire: a square pyramid of slate with a golden finial
SO = 1.0
sx0, sx1, sy0, sy1 = TX0 - SO, TX1 + SO, TY0 - SO, TY1 + SO
apex = Vector((0, (TY0 + TY1) / 2, T3 + 13.0))
spire = Pieces('spire', M['slate'], bevel=0.05, segments=2, seed=41)
base = [Vector((sx0, sy0, T3)), Vector((sx1, sy0, T3)), Vector((sx1, sy1, T3)), Vector((sx0, sy1, T3))]
# shingles in rows on each face, rows shrink towards the apex
for k in range(4):
    a, b = base[k], base[(k + 1) % 4]
    rows = 16
    for r in range(rows):
        t0 = r / rows
        t1 = (r + 1) / rows
        pa0 = a.lerp(apex, t0)
        pb0 = b.lerp(apex, t0)
        pa1 = a.lerp(apex, t1)
        width = (pb0 - pa0).length
        n = max(1, int(width / 0.9))
        down = (pa0 - pa1).normalized()
        along = (pb0 - pa0).normalized()
        normal = along.cross(-down).normalized()
        if normal.z < 0:
            normal = -normal
        mid_t = (t0 + t1) / 2
        for i in range(n):
            f = (i + 0.5 + (0.5 if r % 2 else 0)) / (n + (1 if r % 2 else 0))
            p0 = a.lerp(apex, mid_t).lerp(b.lerp(apex, mid_t), f)
            c = p0 + normal * 0.13
            # orient the shingle on the face
            m = Matrix((along, -down, normal)).transposed()
            if m.determinant() < 0:
                m = Matrix((-along, -down, normal)).transposed()
            spire.box((width / n * 1.02, (pa0 - pa1).length * 1.45, 0.18), c, m.to_euler(), rnd=None)
hips = Pieces('spire_hips', M['slate_dark'], bevel=0.06, seed=43)
for k in range(4):
    a = base[k]
    e = apex - a
    L = e.length
    t = e.normalized()
    # a square bar along the hip edge
    zax = Vector((0, 0, 1))
    xax = t.cross(zax).normalized()
    yax = t
    zz = xax.cross(yax).normalized()
    mm = Matrix((xax, yax, zz)).transposed()
    if mm.determinant() < 0:
        mm = Matrix((-xax, yax, zz)).transposed()
    hips.box((0.5, L, 0.5), a + e / 2 + zz * 0.22, mm.to_euler())
for k in range(4):
    a, b = base[k], base[(k + 1) % 4]
    hips.box(((b - a).length + 0.6 if abs(b.x - a.x) > 0.1 else 0.45, (b - a).length + 0.6 if abs(b.y - a.y) > 0.1 else 0.45, 0.45), (a + b) / 2 + Vector((0, 0, 0.1)))
hips.build()
spire_core = Pieces('spire_core', M['slate_dark'], bevel=0.0)
spire_core.mesh_from([tuple(v) for v in base] + [tuple(apex)], [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)])
spire_core.build()
spire.build()
gold = Pieces('gold', M['gold'], bevel=0.0)
gold.lathe([(0.0, 0.0), (0.45, 0.2), (0.62, 0.65), (0.45, 1.1), (0.0, 1.3)], (apex.x, apex.y, apex.z - 0.3), segments=24)
gold.lathe([(0.12, 0.0), (0.12, 3.2), (0.0, 3.4)], (apex.x, apex.y, apex.z + 0.9), segments=12)
gold.build(smooth=True)

# flag on the spire pole
flag = Pieces('flag', M['flag'], bevel=0.0)
fz = apex.z + 3.2
fw, fh = 5.2, 3.0
seg = 10
verts = []
faces = []
for i in range(seg + 1):
    u = i / seg
    wave = math.sin(u * math.pi * 1.6) * 0.35 * u
    for j in (0, 1):
        # the flag flies towards the north-east: across the view, so it reads on screen
        verts.append((apex.x + 0.1 + u * fw * 0.7 - wave * 0.7, apex.y + 0.1 + u * fw * 0.7 + wave * 0.7, fz - j * fh - u * 0.3))
for i in range(seg):
    faces.append((i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1))
flag.mesh_from(verts, faces)
fo = flag.build()
sol = fo.modifiers.new('solid', 'SOLIDIFY')
sol.thickness = 0.08

# clock faces on the south and east sides of the shaft
clock = Pieces('clock', M['clock'], bevel=0.0)
hands = Pieces('hands', M['iron'], bevel=0.0)
cz = (T1 + T2) / 2 + 0.6
clock.lathe([(0.0, 0.0), (1.7, 0.0), (1.75, 0.12), (1.7, 0.25), (0.0, 0.25)], (0, 0, 0), segments=40)
clock_ob = clock.build(smooth=True)
# the lathe is built around Z at the origin: two copies, turned to face south and east
clock_ob.data.update()
import bpy  # noqa: E402
cs = clock_ob
cs.rotation_euler = (math.radians(90), 0, 0)
cs.location = (0, TY0 - 0.05, cz)
ce = cs.copy()
ce.data = cs.data
ce.rotation_euler = (math.radians(90), 0, math.radians(90))
ce.location = (TX1 + 0.05, (TY0 + TY1) / 2, cz)
bpy.context.scene.collection.objects.link(ce)
ring = Pieces('clock_ring', M['gold'], bevel=0.03)
for face in ('s', 'e'):
    for k in range(12):
        a = k / 12 * 2 * math.pi
        dx, dz = math.cos(a) * 1.35, math.sin(a) * 1.35
        if face == 's':
            ring.box((0.18, 0.12, 0.38 if k % 3 == 0 else 0.22), (dx, TY0 - 0.35, cz + dz), (0, -a + math.pi / 2, 0))
        else:
            ring.box((0.12, 0.18, 0.38 if k % 3 == 0 else 0.22), (TX1 + 0.35, (TY0 + TY1) / 2 + dx, cz + dz), (-a + math.pi / 2, 0, 0))
ring.build()
hands.box((0.16, 0.1, 1.05), (0.25, TY0 - 0.4, cz + 0.42), (0, math.radians(-30), 0))
hands.box((0.14, 0.1, 1.35), (-0.45, TY0 - 0.42, cz + 0.4), (0, math.radians(50), 0))
hands.box((0.1, 0.16, 1.05), (TX1 + 0.4, (TY0 + TY1) / 2 + 0.3, cz + 0.4), (math.radians(30), 0, 0))
hands.box((0.1, 0.14, 1.35), (TX1 + 0.42, (TY0 + TY1) / 2 - 0.4, cz + 0.42), (math.radians(-50), 0, 0))
hands.build()

# ------------------------------------------------------------- door and steps
door = Pieces('door', M['door'], bevel=0.04, seed=51)
DW, DH = 3.4, 4.6
for i in range(6):
    x = -DW / 2 + DW / 12 + i * DW / 6
    door.box((DW / 6 - 0.06, 0.3, DH), (x, TY0 - 0.05, G + DH / 2))
door.build()
iron = Pieces('iron', M['iron'], bevel=0.02)
for z in (G + 1.0, G + 3.3):
    iron.box((DW + 0.1, 0.12, 0.28), (0, TY0 - 0.25, z))
iron.box((0.25, 0.2, 0.25), (0.9, TY0 - 0.32, G + 2.2))
iron.box((0.25, 0.2, 0.25), (-0.9, TY0 - 0.32, G + 2.2))
# lanterns either side of the door
for x in (-2.6, 2.6):
    iron.box((0.12, 0.8, 0.12), (x, TY0 - 0.45, G + 5.0))
    iron.box((0.7, 0.7, 0.12), (x, TY0 - 0.85, G + 5.15))
    iron.box((0.7, 0.7, 0.12), (x, TY0 - 0.85, G + 4.0))
iron.build()
lamp = Pieces('lamp', kit.glass_material('lamp', glow=(1.0, 0.75, 0.4), strength=6.0), bevel=0.02)
for x in (-2.6, 2.6):
    lamp.box((0.55, 0.55, 1.0), (x, TY0 - 0.85, G + 4.55))
lamp.build()
# stone arch around the door (voussoirs)
arch = Pieces('arch', M['stone'], bevel=0.1, seed=61)
r0 = DW / 2 + 0.1
for k in range(9):
    a = math.pi * k / 8
    c = Vector((math.cos(a) * (r0 + 0.5), TY0 - 0.25, G + DH - 0.4 + math.sin(a) * (r0 + 0.5) * 0.65))
    arch.box((0.9, 0.7, 0.75), c, (0, -a + math.pi / 2, 0))
for x in (-r0 - 0.5, r0 + 0.5):
    arch.box((0.9, 0.7, DH - 0.4), (x, TY0 - 0.25, G + (DH - 0.4) / 2))
# steps
for i in range(3):
    arch.box((DW + 3.0 - i * 0.8, 1.1, 0.33), (0, TY0 - 1.95 + i * 0.55, G + 0.165 + i * 0.33), rnd=0.35 + i * 0.1)
arch.build()

# ------------------------------------------------------------------ windows
glass = kit.glass_material()
win_glass = Pieces('win_glass', glass, bevel=0.0)
win_frame = Pieces('win_frame', M['timber'], bevel=0.04, seed=71)
shut = Pieces('shutters', M['shutter'], bevel=0.04, seed=81)
sills = Pieces('sills', M['stone'], bevel=0.06, seed=91)


def window(c, normal, w=1.7, h=2.6, shutters=False, stone=True):
    """A window at centre c on a wall with the given outward normal (+x / -y)."""
    c = Vector(c)
    n = Vector(normal)
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    win_glass.box((w, 0.2, h), c + n * 0.02, (0, 0, ang))
    # frame and glazing bars
    for dz in (-h / 2, h / 2):
        win_frame.box((w + 0.35, 0.3, 0.22), c + n * 0.12 + Vector((0, 0, dz)), (0, 0, ang))
    for s in (-1, 1):
        win_frame.box((0.22, 0.3, h + 0.2), c + n * 0.12 + t * (s * w / 2), (0, 0, ang))
    win_frame.box((0.12, 0.22, h), c + n * 0.14, (0, 0, ang))
    win_frame.box((w, 0.22, 0.12), c + n * 0.14 + Vector((0, 0, h * 0.12)), (0, 0, ang))
    if stone:
        sills.box((w + 0.8, 0.6, 0.3), c + n * 0.25 + Vector((0, 0, -h / 2 - 0.2)), (0, 0, ang))
        sills.box((w + 0.8, 0.5, 0.42), c + n * 0.2 + Vector((0, 0, h / 2 + 0.25)), (0, 0, ang))
    if shutters:
        for s in (-1, 1):
            shut.box((w * 0.55, 0.16, h + 0.1), c + n * 0.18 + t * (s * (w / 2 + w * 0.3)), (0, 0, ang))


# ground floor (stone): south facade either side of the tower, east end
for x in (-8.3, -5.6, 5.6, 8.3):
    window((x, Y0 - 0.05, G + 3.6), (0, -1, 0), w=1.6, h=2.9)
for y in (-2.0, 1.5, 5.0):
    window((X1 + 0.05, y, G + 3.6), (1, 0, 0), w=1.6, h=2.9)
# upper floor (timber): shutters, no stone surrounds
for x in (-8.6, -5.4, 5.4, 8.6):
    window((x, uy0 - 0.02, F1 + 3.0), (0, -1, 0), w=1.5, h=2.2, shutters=True, stone=False)
for y in (-3.2, 0.3, 3.8, 7.0):
    window((ux1 + 0.02, y, F1 + 3.0), (1, 0, 0), w=1.5, h=2.2, shutters=True, stone=False)
# gable window and the tower's upper window
window((ux1 + 0.05, ycen, F2 + 3.6), (1, 0, 0), w=1.4, h=2.0, stone=False)
window((0, TY0 - 0.02, T1 + 1.9), (0, -1, 0), w=1.2, h=1.6, stone=False)
window((TX1 + 0.02, -6.2, T1 + 1.9), (1, 0, 0), w=1.2, h=1.6, stone=False)
win_glass.build()
win_frame.build()
shut.build()
sills.build()

# ------------------------------------------------------------- chimneys
chim = Pieces('chimneys', M['stone'], bevel=0.1, seed=101)
chim_tops = {}
for name, x in (('smoke1', -7.0), ('smoke2', 7.4)):
    y = ycen + 3.4
    top = zr + 3.0
    zb = ze + 2.0
    rows = int((top - zb) / 0.8)
    for r in range(rows):
        z = zb + r * (top - zb) / rows
        chim.box((1.9, 1.9, (top - zb) / rows - 0.06), (x, y, z + (top - zb) / rows / 2))
    chim.box((2.5, 2.5, 0.45), (x, y, top + 0.2), rnd=0.2)
    chim.box((1.2, 1.2, 0.5), (x, y, top + 0.6), rnd=0.05)
    chim_tops[name] = (x, y, top + 0.9)
chim.build()

# --------------------------------------------------------------- banners
ban = Pieces('banners', M['banner'], bevel=0.02)
trim = Pieces('banner_trim', M['gold'], bevel=0.02)
for x in (-4.4, 4.4):
    y = Y0 - 0.25
    ban.box((1.5, 0.12, 3.2), (x, y, G + 4.6))
    # swallowtail point
    ban.mesh_from([(x - 0.75, y, G + 3.0), (x + 0.75, y, G + 3.0), (x, y, G + 2.3)], [(0, 1, 2)])
    trim.box((1.9, 0.25, 0.18), (x, y - 0.05, G + 6.25))
    trim.box((0.42, 0.14, 0.42), (x, y - 0.1, G + 4.9), (0, math.radians(45), 0))
ban.build()
trim.build()

# ------------------------------------------------------------------ props
props = Pieces('props', M['door'], bevel=0.08, seed=111)
hoops = Pieces('hoops', M['iron'], bevel=0.0)
for (x, y) in ((-14.0, -3.0), (-15.4, -1.6), (-14.2, -0.2)):
    props.lathe([(0.55, 0.0), (0.7, 0.4), (0.75, 0.75), (0.7, 1.1), (0.55, 1.5), (0.0, 1.5)], (x, y, G), segments=18)
    for z in (0.3, 1.2):
        hoops.lathe([(0.73, z), (0.73, z + 0.12)], (x, y, G), segments=18)
for (x, y, s) in ((-13.6, 2.0, 1.4), (-15.2, 2.4, 1.2), (-14.3, 2.2, 1.0)):
    props.box((s, s, s), (x, y, G + s / 2 + (1.4 if s == 1.0 else 0)), (0, 0, props.rng.uniform(-0.3, 0.3)))
props.build()
hoops.build()

# ---------------------------------------------------------------- render
# the hall fills its lot (the square and kerb keep the lot's size)
S = 1.52
kit.scale_building(S, ground=G)
pts = {**chim_tops, 'flag': (apex.x, apex.y, fz), 'bell': (bc[0], bc[1], T2 + 2.2), 'door': (0, TY0 - 0.5, G + 1.0)}
meta = kit.lot_meta(3, extra={k: (v[0] * S, v[1] * S, v[2] * S - G * (S - 1)) for k, v in pts.items()})
kit.render(OUT, OUT[:-4] + '.json', meta)
print('rendered', OUT, meta)
