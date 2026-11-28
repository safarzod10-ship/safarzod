"""
TERRIA building parts for Blender: walls (logs, ashlar, brick, plaster,
timber frame), roofs (gable, hip, pyramid, cone, dome) laid with real tiles
or shingles, towers, windows, doors, clocks, columns, flags, lamps, props and
lot paving. Every part adds pieces to a Build, which merges all pieces of one
material into one object at the end.

Convention: the building's front faces south (-Y). The game camera sees the
south face on the left (in sun) and the east face on the right (in shade),
so detail goes on those two faces; the others get plain volume.
"""
import math

from kit import Pieces, cobble_material, glass_material, hexc, material
from mathutils import Euler, Matrix, Vector

import bpy

G = 0.4  # top of the lot paving


# --------------------------------------------------------------------------
# materials
# --------------------------------------------------------------------------
def brick_material(name, brick=('#a63a24', '#86301e'), mortar='#a89a84', scale=1.0):
    """Bricks laid along both visible faces: the texture runs on (X + Y, Z)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    add = nt.nodes.new('ShaderNodeMath')
    add.operation = 'ADD'
    comb = nt.nodes.new('ShaderNodeCombineXYZ')
    nt.links.new(tc.outputs['Object'], sep.inputs[0])
    nt.links.new(sep.outputs['X'], add.inputs[0])
    nt.links.new(sep.outputs['Y'], add.inputs[1])
    nt.links.new(add.outputs[0], comb.inputs['X'])
    nt.links.new(sep.outputs['Z'], comb.inputs['Y'])
    br = nt.nodes.new('ShaderNodeTexBrick')
    br.inputs['Scale'].default_value = scale
    br.inputs['Color1'].default_value = (*hexc(brick[0]), 1)
    br.inputs['Color2'].default_value = (*hexc(brick[1]), 1)
    br.inputs['Mortar'].default_value = (*hexc(mortar), 1)
    br.inputs['Mortar Size'].default_value = 0.018
    br.inputs['Brick Width'].default_value = 0.5
    br.inputs['Row Height'].default_value = 0.25
    nt.links.new(comb.outputs[0], br.inputs['Vector'])
    nt.links.new(br.outputs['Color'], bsdf.inputs['Base Color'])
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = 0.5
    bump.invert = True
    nt.links.new(br.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def ground_material(name, a, b, scale=0.6, rough=0.95, bump=0.35):
    """Earth or gravel: two tones mixed by noise, small pebbles from Voronoi."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    tc = nt.nodes.new('ShaderNodeTexCoord')
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale * 0.25
    noise.inputs['Detail'].default_value = 6
    nt.links.new(tc.outputs['Object'], noise.inputs['Vector'])
    vor = nt.nodes.new('ShaderNodeTexVoronoi')
    vor.inputs['Scale'].default_value = scale * 6
    nt.links.new(tc.outputs['Object'], vor.inputs['Vector'])
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = (*hexc(b), 1)
    ramp.color_ramp.elements[1].color = (*hexc(a), 1)
    mix = nt.nodes.new('ShaderNodeMath')
    mix.operation = 'MULTIPLY_ADD'
    mix.inputs[1].default_value = 0.35
    nt.links.new(vor.outputs['Distance'], mix.inputs[0])
    nt.links.new(noise.outputs['Fac'], mix.inputs[2])
    nt.links.new(mix.outputs[0], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    bn = nt.nodes.new('ShaderNodeBump')
    bn.inputs['Strength'].default_value = bump
    nt.links.new(vor.outputs['Distance'], bn.inputs['Height'])
    nt.links.new(bn.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def water_material():
    m = bpy.data.materials.new('water')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*hexc('#2f8fc0'), 1)
    b.inputs['Roughness'].default_value = 0.05
    b.inputs['Emission Color'].default_value = (*hexc('#58b8e0'), 1)
    b.inputs['Emission Strength'].default_value = 0.25
    return m


def palette():
    return {
        'stone': material('stone', hexc('#b9a68c'), rough=0.85, var=0.14, hue_var=0.02, bump=0.25, bump_scale=3.0),
        'stone_grey': material('stone_grey', hexc('#a7a39b'), rough=0.85, var=0.12, bump=0.25, bump_scale=3.0),
        'stone_core': material('stone_core', hexc('#6e655a'), rough=0.9, var=0.05),
        'lime': material('lime', hexc('#e8dcc2'), rough=0.75, var=0.06, hue_var=0.01, bump=0.12, bump_scale=3.0),
        'marble': material('marble', hexc('#f3f0ea'), rough=0.35, var=0.04, noise_amt=0.05, bump=0.04),
        'marble_dark': material('marble_dark', hexc('#9aa3ad'), rough=0.35, var=0.05),
        'trim': material('trim', hexc('#f0e9dc'), rough=0.6, var=0.03),
        'kerb': material('kerb', hexc('#a89a86'), rough=0.85, var=0.12, bump=0.2),
        'plaster': material('plaster', hexc('#f2e3c4'), rough=0.9, var=0.03, noise_amt=0.1, noise_scale=0.8, bump=0.08, bump_scale=8),
        'timber': material('timber', hexc('#5b3418'), rough=0.7, var=0.12, bump=0.15, bump_scale=14),
        'logs': material('logs', hexc('#8a5a32'), rough=0.8, var=0.14, hue_var=0.01, bump=0.3, bump_scale=9),
        'planks': material('planks', hexc('#7d5230'), rough=0.8, var=0.15, bump=0.2, bump_scale=12),
        'shingle': material('shingle', hexc('#6f4a2c'), rough=0.85, var=0.16, hue_var=0.01),
        'roof': material('roof', hexc('#c0502b'), rough=0.6, var=0.07, hue_var=0.008, noise_amt=0.08),
        'roof_under': material('roof_under', hexc('#4a1c10'), rough=0.8, var=0.0),
        'slate': material('slate', hexc('#3f62a0'), rough=0.45, var=0.07, hue_var=0.005, noise_amt=0.06),
        'slate_dark': material('slate_dark', hexc('#26375a'), rough=0.6, var=0.0),
        'copper': material('copper', hexc('#57a68e'), rough=0.5, var=0.06, noise_amt=0.12, noise_scale=3),
        'gold': material('gold', hexc('#f5bd4f'), rough=0.25, var=0.0, metallic=1.0, noise_amt=0.0),
        'iron': material('iron', hexc('#2a2a2f'), rough=0.45, var=0.05, metallic=0.6),
        'door': material('door', hexc('#7c4a22'), rough=0.7, var=0.12, bump=0.2, bump_scale=10),
        'banner': material('banner', hexc('#b5141c'), rough=0.8, var=0.0, noise_amt=0.05),
        'banner_blue': material('banner_blue', hexc('#1f4fa8'), rough=0.8, var=0.0, noise_amt=0.05),
        'clock': material('clock', hexc('#f6f0e1'), rough=0.6, var=0.0, noise_amt=0.0),
        'shutter': material('shutter', hexc('#2f6f8f'), rough=0.7, var=0.08),
        'cobble': cobble_material('cobble', a=hexc('#a8987c'), b=hexc('#7d705e'), mortar=hexc('#4c443a'), scale=0.85),
        'earth': ground_material('earth', '#7c6446', '#54412c', scale=0.5),
        'gravel': ground_material('gravel', '#7f7666', '#575044', scale=1.6, bump=0.5),
        'brick': brick_material('brick'),
        'glass': glass_material(),
        'lamp': glass_material('lamp', glow=(1.0, 0.75, 0.4), strength=6.0),
        'bell': material('bell', hexc('#c9963b'), rough=0.3, var=0.0, metallic=1.0, noise_amt=0.0),
        'flag': material('flag', hexc('#c8161f'), rough=0.85, var=0.0, noise_amt=0.0),
        'water': water_material(),
        'hay': material('hay', hexc('#d6b25a'), rough=0.95, var=0.1),
        'shutter_green': material('shutter_green', hexc('#3e7a4c'), rough=0.7, var=0.08),
        'slate_grey': material('slate_grey', hexc('#5b6670'), rough=0.5, var=0.08, noise_amt=0.06),
        'slate_grey_dark': material('slate_grey_dark', hexc('#373e46'), rough=0.6, var=0.0),
        'roof_brown': material('roof_brown', hexc('#8f4a2b'), rough=0.6, var=0.08, hue_var=0.008),
        'thatch': material('thatch', hexc('#c7a253'), rough=0.95, var=0.12, noise_amt=0.25, noise_scale=6, bump=0.6, bump_scale=18),
        'yellow': material('yellow', hexc('#f4c430'), rough=0.45, var=0.0, noise_amt=0.0),
        'orange': material('orange', hexc('#ea7a24'), rough=0.6, var=0.0, noise_amt=0.0),
        'skin': material('skin', hexc('#eab38a'), rough=0.6, var=0.0, noise_amt=0.0),
        'cloth': material('cloth', hexc('#3e5a8c'), rough=0.85, var=0.0, noise_amt=0.05),
        'white': material('white', hexc('#f3efe6'), rough=0.6, var=0.02, noise_amt=0.04),
        'red': material('red', hexc('#c9302c'), rough=0.55, var=0.0, noise_amt=0.0),
        'wheat': material('wheat', hexc('#ecc65a'), rough=0.9, var=0.12, noise_amt=0.35, noise_scale=5, bump=0.8, bump_scale=26),
        'sprout': material('sprout', hexc('#6fae3a'), rough=0.9, var=0.12, noise_amt=0.2, noise_scale=5, bump=0.4, bump_scale=20),
        'soil': ground_material('soil', '#6a4a2c', '#4a321d', scale=0.9, bump=0.5),
        'rock': material('rock', hexc('#8f8473'), rough=0.9, var=0.14, hue_var=0.01, bump=0.5, bump_scale=2.5),
        'barn_red': material('barn_red', hexc('#a53b2a'), rough=0.7, var=0.06, bump=0.15, bump_scale=10),
        'canvas': material('canvas', hexc('#ece1c6'), rough=0.9, var=0.04, noise_amt=0.08),
        'ochre': material('ochre', hexc('#e6bf6c'), rough=0.85, var=0.03, noise_amt=0.08, bump=0.06, bump_scale=8),
        'leaf': material('leaf', hexc('#4f8f34'), rough=0.85, var=0.15, hue_var=0.02, noise_amt=0.25, noise_scale=3, bump=0.5, bump_scale=6),
        'flower_red': material('flower_red', hexc('#e0384a'), rough=0.6, var=0.1),
        'flower_yellow': material('flower_yellow', hexc('#f5d33c'), rough=0.6, var=0.1),
        'flower_white': material('flower_white', hexc('#f7f3ea'), rough=0.6, var=0.05),
        'bronze': material('bronze', hexc('#9a6a3a'), rough=0.35, var=0.0, metallic=0.9, noise_amt=0.1),
        'lawn': material('lawn', hexc('#6aa83c'), rough=0.95, var=0.08, noise_amt=0.3, noise_scale=3, bump=0.3, bump_scale=30),
        'sand': material('sand', hexc('#e6d3a0'), rough=0.95, var=0.05, noise_amt=0.2, bump=0.2, bump_scale=20),
        'post_red': material('post_red', hexc('#b8282a'), rough=0.5, var=0.0, noise_amt=0.0),
        'green_paint': material('green_paint', hexc('#2f6b45'), rough=0.6, var=0.04),
    }


# --------------------------------------------------------------------------
# build context
# --------------------------------------------------------------------------
BEVEL = {
    'stone': 0.14, 'stone_grey': 0.14, 'lime': 0.1, 'marble': 0.08, 'marble_dark': 0.06, 'trim': 0.05, 'kerb': 0.12,
    'plaster': 0.05, 'timber': 0.08, 'logs': 0.22, 'planks': 0.05, 'shingle': 0.06, 'roof': 0.07,
    'slate': 0.05, 'slate_dark': 0.06, 'copper': 0.05, 'gold': 0.03, 'iron': 0.02, 'door': 0.04, 'banner': 0.02,
    'banner_blue': 0.02, 'clock': 0.0, 'shutter': 0.04, 'brick': 0.04, 'glass': 0.0, 'lamp': 0.02, 'bell': 0.0,
    'flag': 0.0, 'water': 0.0, 'cobble': 0.25, 'earth': 0.2, 'gravel': 0.2, 'roof_under': 0.0, 'stone_core': 0.0, 'hay': 0.15,
    'shutter_green': 0.04, 'slate_grey': 0.05, 'slate_grey_dark': 0.06, 'roof_brown': 0.07, 'thatch': 0.12, 'yellow': 0.03,
    'orange': 0.03, 'skin': 0.0, 'cloth': 0.03, 'white': 0.05, 'red': 0.03, 'wheat': 0.1, 'sprout': 0.08, 'soil': 0.25,
    'rock': 0.0, 'barn_red': 0.05, 'canvas': 0.03, 'ochre': 0.05, 'leaf': 0.0, 'flower_red': 0.02, 'flower_yellow': 0.02,
    'flower_white': 0.02, 'bronze': 0.0, 'lawn': 0.3, 'sand': 0.3, 'post_red': 0.04, 'green_paint': 0.04,
}


class Build:
    def __init__(self, mats, seed=1):
        self.mats = mats
        self.parts = {}
        self.seed = seed
        self.points = {}

    def p(self, key, smooth=False, bevel=None, segments=None):
        b = BEVEL.get(key, 0.06) if bevel is None else bevel
        k = (key, smooth, round(b, 3))
        if k not in self.parts:
            seg = segments or (3 if key in ('logs', 'cobble', 'earth', 'gravel') else 2)
            self.parts[k] = (Pieces(f'{key}{"_s" if smooth else ""}', self.mats[key], bevel=b, segments=seg, seed=self.seed + len(self.parts) * 17), smooth)
        return self.parts[k][0]

    def finish(self):
        objs = []
        for (key, smooth, _b), (pc, sm) in self.parts.items():
            objs.append(pc.build(smooth=sm))
        return objs


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
FACES = {
    # face: (start corner picker, direction) such that the outward normal is on the left of the direction
    'S': lambda x0, x1, y0, y1: ((x1, y0), (-1, 0)),
    'E': lambda x0, x1, y0, y1: ((x1, y1), (0, -1)),
    'N': lambda x0, x1, y0, y1: ((x0, y1), (1, 0)),
    'W': lambda x0, x1, y0, y1: ((x0, y0), (0, 1)),
}
NORMAL = {'S': Vector((0, -1, 0)), 'E': Vector((1, 0, 0)), 'N': Vector((0, 1, 0)), 'W': Vector((-1, 0, 0))}


def frame(x_axis, z_hint=Vector((0, 0, 1))):
    """Rotation (Euler) whose local x is x_axis and local z is as close to z_hint as possible."""
    x = Vector(x_axis).normalized()
    y = Vector(z_hint).cross(x).normalized()
    z = x.cross(y).normalized()
    return Matrix((x, y, z)).transposed().to_euler()


def bar(p, a, b, w, h=None, z_hint=Vector((0, 0, 1)), rnd=None):
    """A beam from point a to point b."""
    a = Vector(a)
    b = Vector(b)
    d = b - a
    if abs(d.normalized().dot(Vector(z_hint))) > 0.95:
        z_hint = Vector((1, 0, 0))
    p.box((d.length, w, h or w), (a + b) / 2, frame(d, z_hint), rnd=rnd)


# --------------------------------------------------------------------------
# walls
# --------------------------------------------------------------------------
def core(B, x0, x1, y0, y1, z0, z1, key='stone_core', inset=0.4):
    B.p(key, bevel=0.0).box((x1 - x0 - inset * 2, y1 - y0 - inset * 2, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def ashlar(B, x0, x1, y0, y1, z0, z1, key='stone', block=(1.3, 2.4), rows=None, depth=0.85, faces='SE', quoins=True):
    """Coursed stone on the visible faces, a plain core inside, big corner stones."""
    core(B, x0, x1, y0, y1, z0, z1)
    p = B.p(key)
    rows = rows or max(1, int(round((z1 - z0) / 0.95)))
    rh = (z1 - z0) / rows
    for f in faces:
        (sx, sy), d = FACES[f](x0, x1, y0, y1)
        d = Vector((*d, 0))
        side = Vector((-d.y, d.x, 0))
        L = (x1 - x0) if f in 'SN' else (y1 - y0)
        for r in range(rows):
            x = -p.rng.uniform(0.3, 0.9) if r % 2 else 0.0
            while x < L:
                bl = p.rng.uniform(*block)
                a = max(0.0, x)
                b = min(L, x + bl)
                if b - a > 0.3:
                    dd = depth + p.rng.uniform(-0.05, 0.1)
                    c = Vector((sx, sy, 0)) + d * ((a + b) / 2) + side * (-dd / 2) + Vector((0, 0, z0 + r * rh + rh / 2))
                    p.box((b - a - 0.08, dd, rh - 0.08), c, (0, 0, math.atan2(d.y, d.x)))
                x += bl
    if quoins:
        for (cx, cy) in ((x0, y0), (x1, y0), (x1, y1)):
            for r in range(rows):
                lx = r % 2 == 0
                sx_, sy_ = (2.1, 1.25) if lx else (1.25, 2.1)
                ix = -1 if cx > (x0 + x1) / 2 else 1
                iy = -1 if cy > (y0 + y1) / 2 else 1
                p.box((sx_, sy_, rh - 0.05), (cx + ix * (sx_ / 2 - 0.62), cy + iy * (sy_ / 2 - 0.62), z0 + r * rh + rh / 2))


def logs(B, x0, x1, y0, y1, z0, z1, d=0.62, over=0.7):
    """Log walls with interlocking corners."""
    core(B, x0, x1, y0, y1, z0, z1, key='planks', inset=0.35)
    p = B.p('logs')
    n = int((z1 - z0) / d)
    for i in range(n):
        za = z0 + d * (i + 0.5)
        zb = z0 + d * (i + 1.0)
        for y in (y0, y1):
            if zb - d / 2 > z1:
                continue
            p.box((x1 - x0 + over * 2, d, d), ((x0 + x1) / 2, y, za))
        for x in (x0, x1):
            if zb + d / 2 > z1 + 0.01:
                continue
            p.box((d, y1 - y0 + over * 2, d), (x, (y0 + y1) / 2, zb))


def plaster_wall(B, x0, x1, y0, y1, z0, z1, key='plaster'):
    B.p(key).box((x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))


def timber_frame(B, x0, x1, y0, y1, z0, z1, faces='SE', bw=0.42, spacing=2.6, skip=()):
    """Half-timbering on a plastered box: sill, plate, rail, posts and braces."""
    p = B.p('timber')
    for f in faces:
        (sx, sy), d = FACES[f](x0, x1, y0, y1)
        d = Vector((*d, 0))
        n = Vector((-d.y, d.x, 0))
        L = (x1 - x0) if f in 'SN' else (y1 - y0)
        a = Vector((sx, sy, 0)) + n * 0.12
        ang = math.atan2(d.y, d.x)
        for z in (z0 + bw / 2, z1 - bw / 2):
            p.box((L + 0.3, bw, bw), a + d * (L / 2) + Vector((0, 0, z)), (0, 0, ang))
        p.box((L, bw * 0.8, bw * 0.8), a + d * (L / 2) + Vector((0, 0, (z0 + z1) / 2 + 0.5)), (0, 0, ang))
        k = max(2, int(round(L / spacing)))
        for i in range(k + 1):
            s = i * L / k
            if any(abs(s - q) < 0.8 for q in skip):
                continue
            p.box((bw, bw, z1 - z0), a + d * s + Vector((0, 0, (z0 + z1) / 2)), (0, 0, ang))
        w = L / k
        h = z1 - z0 - bw * 2
        for s0, sign in ((0.0, 1), (L - w, -1)):
            tilt = math.atan2(h, w) * sign
            p.box((math.hypot(w, h), bw * 0.8, bw * 0.8), a + d * (s0 + w / 2) + Vector((0, 0, (z0 + z1) / 2)), (0, -tilt, ang))


def string_course(B, x0, x1, y0, y1, z, key='stone', h=0.5, out=0.35):
    B.p(key).box((x1 - x0 + out * 2, y1 - y0 + out * 2, h), ((x0 + x1) / 2, (y0 + y1) / 2, z), rnd=0.4)


def brick_walls(B, x0, x1, y0, y1, z0, z1, trim='trim', quoin=True):
    core(B, x0, x1, y0, y1, z0, z1)
    B.p('brick', bevel=0.02).box((x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    if quoin:
        p = B.p(trim)
        rows = int((z1 - z0) / 0.9)
        rh = (z1 - z0) / rows
        for (cx, cy) in ((x0, y0), (x1, y0), (x1, y1)):
            for r in range(rows):
                lx = r % 2 == 0
                sx_, sy_ = (1.7, 1.0) if lx else (1.0, 1.7)
                ix = -1 if cx > (x0 + x1) / 2 else 1
                iy = -1 if cy > (y0 + y1) / 2 else 1
                p.box((sx_, sy_, rh - 0.06), (cx + ix * (sx_ / 2 - 0.55), cy + iy * (sy_ / 2 - 0.55), z0 + r * rh + rh / 2))


# --------------------------------------------------------------------------
# roofs
# --------------------------------------------------------------------------
def tile_face(p, A, Bv, C, D, tw=1.1, tl=1.5, thick=0.22, overlap=0.42, jitter=0.012):
    """
    Tiles in staggered rows on the planar face A-B (eave, left to right as seen
    from outside) up to D-C (top; D == C for a triangle).
    """
    A, Bv, C, D = Vector(A), Vector(Bv), Vector(C), Vector(D)
    L = max((D - A).length, (C - Bv).length)
    normal = (Bv - A).cross(D - A)
    if normal.length < 1e-6:
        normal = (Bv - A).cross(C - Bv)
    normal.normalize()
    if normal.z < 0:
        normal = -normal
    step = tl * (1 - overlap)
    rows = max(1, int(math.ceil(L / step)))
    for r in range(rows):
        dist = min(L - tl * 0.45, r * step + tl / 2)
        v = 1 - dist / L
        lp = A.lerp(D, v)
        rp = Bv.lerp(C, v)
        width = (rp - lp).length
        if width < 0.3:
            continue
        along = (rp - lp).normalized()
        down = along.cross(normal).normalized()
        if down.dot(A - D) < 0:
            down = -down
        m = Matrix((along, down, normal)).transposed()
        if m.determinant() < 0:
            m = Matrix((-along, down, normal)).transposed()
        e = m.to_euler()
        n = max(1, int(round(width / tw)))
        w = width / n
        off = 0.5 if r % 2 else 0.0
        for i in range(n + (1 if off else 0)):
            t0 = max(0.0, (i - off) * w)
            t1 = min(width, (i - off + 1) * w)
            if t1 - t0 < 0.3 * w:
                continue
            c = lp + along * ((t0 + t1) / 2) + normal * (thick / 2 + 0.05 * ((r * 7 + i * 3) % 3))
            p.box(((t1 - t0) * 0.96, tl, thick), c, Euler((e.x + p.rng.uniform(-jitter, jitter), e.y, e.z + p.rng.uniform(-jitter, jitter))))


def solid(p, verts, faces):
    p.mesh_from([tuple(v) for v in verts], faces, rnd=0.5)


def gable(B, x0, x1, y0, y1, z, pitch=50, over=1.1, end_over=0.9, tile='roof', wall='plaster', along='x', tw=1.1, tl=1.5,
          caps=None, barge='timber'):
    """Gable roof standing on the wall box top z; returns the ridge height."""
    t = math.tan(math.radians(pitch))
    tiles = B.p(tile)
    under = B.p('roof_under', bevel=0.0)
    if along == 'x':
        yc = (y0 + y1) / 2
        half = (y1 - y0) / 2
        zr = z + half * t
        ze = z - over * t
        X0, X1 = x0 - end_over, x1 + end_over
        tile_face(tiles, (X0, y0 - over, ze), (X1, y0 - over, ze), (X1, yc, zr + 0.1), (X0, yc, zr + 0.1), tw, tl)
        tile_face(tiles, (X1, y1 + over, ze), (X0, y1 + over, ze), (X0, yc, zr + 0.1), (X1, yc, zr + 0.1), tw, tl)
        v = [(X0 + 0.1, y0 - over + 0.2, ze - 0.05), (X1 - 0.1, y0 - over + 0.2, ze - 0.05), (X1 - 0.1, y1 + over - 0.2, ze - 0.05),
             (X0 + 0.1, y1 + over - 0.2, ze - 0.05), (X0 + 0.1, yc, zr - 0.15), (X1 - 0.1, yc, zr - 0.15)]
        solid(under, v, [(0, 1, 5, 4), (2, 3, 4, 5), (1, 2, 5), (3, 0, 4), (0, 3, 2, 1)])
        w = B.p(wall)
        for x, s in ((x1 - 0.1, 1), (x0 + 0.1, -1)):
            gv = [(x, y0, z), (x, y1, z), (x, yc, zr - 0.3), (x - s * 0.5, y0, z), (x - s * 0.5, y1, z), (x - s * 0.5, yc, zr - 0.3)]
            solid(w, gv, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
        for i in range(int((X1 - X0) / 1.1)):
            B.p(caps or tile).box((1.12, 0.9, 0.9), (X0 + 0.55 + i * 1.1, yc, zr + 0.55), (math.radians(45), 0, 0), rnd=0.5)
        if barge:
            for x in (X1 + 0.12, X0 - 0.12):
                for s in (-1, 1):
                    bar(B.p(barge), (x, yc, zr + 0.4), (x, yc + s * (half + over), ze + 0.2), 0.4, 0.7)
    else:
        xc = (x0 + x1) / 2
        half = (x1 - x0) / 2
        zr = z + half * t
        ze = z - over * t
        Y0, Y1 = y0 - end_over, y1 + end_over
        tile_face(tiles, (x1 + over, Y0, ze), (x1 + over, Y1, ze), (xc, Y1, zr + 0.1), (xc, Y0, zr + 0.1), tw, tl)
        tile_face(tiles, (x0 - over, Y1, ze), (x0 - over, Y0, ze), (xc, Y0, zr + 0.1), (xc, Y1, zr + 0.1), tw, tl)
        v = [(x0 - over + 0.2, Y0 + 0.1, ze - 0.05), (x1 + over - 0.2, Y0 + 0.1, ze - 0.05), (x1 + over - 0.2, Y1 - 0.1, ze - 0.05),
             (x0 - over + 0.2, Y1 - 0.1, ze - 0.05), (xc, Y0 + 0.1, zr - 0.15), (xc, Y1 - 0.1, zr - 0.15)]
        solid(under, v, [(0, 1, 4), (1, 2, 5, 4), (2, 3, 5), (3, 0, 4, 5), (0, 3, 2, 1)])
        w = B.p(wall)
        for y, s in ((y0 + 0.1, -1), (y1 - 0.1, 1)):
            gv = [(x0, y, z), (x1, y, z), (xc, y, zr - 0.3), (x0, y - s * 0.5, z), (x1, y - s * 0.5, z), (xc, y - s * 0.5, zr - 0.3)]
            solid(w, gv, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
        for i in range(int((Y1 - Y0) / 1.1)):
            B.p(caps or tile).box((0.9, 1.12, 0.9), (xc, Y0 + 0.55 + i * 1.1, zr + 0.55), (0, math.radians(45), 0), rnd=0.5)
        if barge:
            for y in (Y0 - 0.12, Y1 + 0.12):
                for s in (-1, 1):
                    bar(B.p(barge), (xc, y, zr + 0.4), (xc + s * (half + over), y, ze + 0.2), 0.4, 0.7)
    return zr


def hip(B, x0, x1, y0, y1, z, pitch=40, over=1.0, tile='slate', caps='slate_dark', tw=1.0, tl=1.4):
    """Hip roof (a pyramid when the plan is square); returns the top height."""
    t = math.tan(math.radians(pitch))
    X0, X1, Y0, Y1 = x0 - over, x1 + over, y0 - over, y1 + over
    ze = z - over * t
    half = min(X1 - X0, Y1 - Y0) / 2
    zr = ze + half * t
    xc, yc = (X0 + X1) / 2, (Y0 + Y1) / 2
    if X1 - X0 >= Y1 - Y0:
        r0 = Vector((X0 + half, yc, zr))
        r1 = Vector((X1 - half, yc, zr))
    else:
        r0 = Vector((xc, Y0 + half, zr))
        r1 = Vector((xc, Y1 - half, zr))
    a, b, c, d = Vector((X0, Y0, ze)), Vector((X1, Y0, ze)), Vector((X1, Y1, ze)), Vector((X0, Y1, ze))
    tiles = B.p(tile)
    if X1 - X0 >= Y1 - Y0:
        faces = [(a, b, r1, r0), (c, d, r0, r1), (b, c, r1, r1), (d, a, r0, r0)]
    else:
        faces = [(a, b, r0, r0), (c, d, r1, r1), (b, c, r1, r0), (d, a, r0, r1)]
    for f in faces:
        tile_face(tiles, *f, tw=tw, tl=tl)
    lift = Vector((0, 0, -0.15))
    solid(B.p('roof_under', bevel=0.0), [a + lift, b + lift, c + lift, d + lift, r0 + lift, r1 + lift],
          [(0, 1, 5, 4) if X1 - X0 >= Y1 - Y0 else (0, 1, 4), (2, 3, 4, 5) if X1 - X0 >= Y1 - Y0 else (2, 3, 5),
           (1, 2, 5) if X1 - X0 >= Y1 - Y0 else (1, 2, 5, 4), (3, 0, 4) if X1 - X0 >= Y1 - Y0 else (3, 0, 4, 5), (0, 3, 2, 1)])
    cp = B.p(caps)
    for e0, e1 in ((a, r0), (b, r1), (c, r1), (d, r0)):
        bar(cp, e0 + Vector((0, 0, 0.25)), e1 + Vector((0, 0, 0.35)), 0.45, 0.45)
    if (r1 - r0).length > 0.2:
        bar(cp, r0 + Vector((0, 0, 0.35)), r1 + Vector((0, 0, 0.35)), 0.55, 0.55)
    return zr


def pyramid(B, cx, cy, half, z, height, tile='slate', caps='slate_dark', over=0.8, tw=0.9, tl=1.3):
    pitch = math.degrees(math.atan2(height, half + over))
    return hip(B, cx - half, cx + half, cy - half, cy + half, z + over * math.tan(math.radians(pitch)), pitch, over, tile, caps, tw, tl)


def cone(B, cx, cy, r, z, h, key='slate', rows=9, lip=0.35):
    """Round turret roof with rows of shingles (a stepped lathe)."""
    prof = []
    for i in range(rows):
        t0 = i / rows
        t1 = (i + 1) / rows
        rb = r * (1 - t0) + lip * (1 - t0)
        rt = r * (1 - t1)
        prof.append((rb, z + h * t0 - 0.12))
        prof.append((rt + lip * 0.2 * (1 - t1), z + h * t1))
    prof.append((0.0, z + h + 0.01))
    B.p(key, smooth=True, bevel=0.0).lathe(prof, (cx, cy, 0), segments=40)
    return z + h


def dome(B, cx, cy, r, z, key='copper', ribs='gold', n_ribs=12, lantern=True, drum=0.0):
    """Dome on an optional drum, with ribs and a small lantern on top; returns the top height."""
    if drum > 0:
        B.p('lime', smooth=True, bevel=0.0).lathe([(r * 1.04, z), (r * 1.04, z + drum), (r * 1.1, z + drum), (r * 1.1, z + drum + 0.4)], (cx, cy, 0), segments=48)
        z += drum + 0.4
    prof = [(r * math.cos(a), z + r * 0.92 * math.sin(a)) for a in [i * math.pi / 2 / 14 for i in range(15)]]
    B.p(key, smooth=True, bevel=0.0).lathe([(r * 1.06, z - 0.05)] + prof, (cx, cy, 0), segments=56)
    rp = B.p(ribs)
    for k in range(n_ribs):
        ang = 2 * math.pi * k / n_ribs
        pts = [Vector((cx + math.cos(ang) * r * math.cos(a) * 1.01, cy + math.sin(ang) * r * math.cos(a) * 1.01, z + r * 0.92 * math.sin(a) * 1.01))
               for a in [i * math.pi / 2 / 10 for i in range(10)]]
        for p0, p1 in zip(pts, pts[1:]):
            bar(rp, p0, p1, 0.28, 0.28)
    top = z + r * 0.92
    if lantern:
        lr = r * 0.22
        lp = B.p(key, smooth=True, bevel=0.0)
        lp.lathe([(lr, top - 0.2), (lr, top + lr * 1.6), (lr * 1.3, top + lr * 1.6), (lr * 1.3, top + lr * 1.8)], (cx, cy, 0), segments=24)
        for k in range(6):
            ang = 2 * math.pi * k / 6
            B.p('trim').box((0.35, 0.35, lr * 1.6), (cx + math.cos(ang) * lr * 1.05, cy + math.sin(ang) * lr * 1.05, top + lr * 0.8))
        top = top + lr * 1.8
        B.p(ribs, smooth=True, bevel=0.0).lathe([(lr * 1.2, top), (lr * 0.8, top + lr * 0.8), (0.2, top + lr * 1.3), (0.0, top + lr * 1.4)], (cx, cy, 0), segments=24)
        top += lr * 1.4
    return top


def finial(B, x, y, z, h=3.0, key='gold'):
    p = B.p(key, smooth=True, bevel=0.0)
    p.lathe([(0.0, 0.0), (0.5, 0.2), (0.65, 0.65), (0.48, 1.1), (0.0, 1.3)], (x, y, z - 0.3), segments=24)
    p.lathe([(0.14, 0.0), (0.14, h), (0.0, h + 0.25)], (x, y, z + 0.9), segments=12)
    return z + 0.9 + h


# --------------------------------------------------------------------------
# openings and details
# --------------------------------------------------------------------------
def window(B, c, face, w=1.6, h=2.6, shutters=False, surround='stone', arch=False, frame_key='timber', mull=True):
    c = Vector(c)
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    gp = B.p('glass', bevel=0.0)
    fp = B.p(frame_key)
    gp.box((w, 0.2, h), c + n * 0.02, (0, 0, ang))
    if arch:
        r = w / 2
        top = c + Vector((0, 0, h / 2))
        pts = [(top + t * (math.cos(a) * r) + Vector((0, 0, math.sin(a) * r)) + n * 0.02) for a in [i * math.pi / 12 for i in range(13)]]
        verts = [top + n * 0.02] + pts
        gp.mesh_from([tuple(v) for v in verts], [(0, i + 1, i + 2) for i in range(12)], rnd=0.5)
        if surround:
            sp = B.p(surround)
            for k in range(9):
                a = math.pi * k / 8
                pc = top + t * (math.cos(a) * (r + 0.32)) + Vector((0, 0, math.sin(a) * (r + 0.32))) + n * 0.15
                sp.box((0.42, 0.42, 0.62), pc, (0, -a + math.pi / 2, 0) if face in 'SN' else (-a + math.pi / 2, 0, 0))
    for dz in ((-h / 2,) if arch else (-h / 2, h / 2)):
        fp.box((w + 0.35, 0.3, 0.22), c + n * 0.12 + Vector((0, 0, dz)), (0, 0, ang))
    for s in (-1, 1):
        fp.box((0.22, 0.3, h + 0.2), c + n * 0.12 + t * (s * w / 2), (0, 0, ang))
    if mull:
        fp.box((0.12, 0.22, h), c + n * 0.14, (0, 0, ang))
        fp.box((w, 0.22, 0.12), c + n * 0.14 + Vector((0, 0, h * 0.12)), (0, 0, ang))
    if surround:
        sp = B.p(surround)
        sp.box((w + 0.8, 0.6, 0.3), c + n * 0.25 + Vector((0, 0, -h / 2 - 0.2)), (0, 0, ang))
        if not arch:
            sp.box((w + 0.8, 0.5, 0.42), c + n * 0.2 + Vector((0, 0, h / 2 + 0.25)), (0, 0, ang))
    if shutters:
        for s in (-1, 1):
            B.p('shutter').box((w * 0.55, 0.16, h + 0.1), c + n * 0.18 + t * (s * (w / 2 + w * 0.3)), (0, 0, ang))


def door(B, c, face, w=3.2, h=4.4, arch_key='stone', planks='door'):
    c = Vector(c)
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    dp = B.p(planks)
    k = 6
    for i in range(k):
        dp.box((w / k - 0.06, 0.3, h), c + t * (-w / 2 + w / k * (i + 0.5)) + Vector((0, 0, h / 2)), (0, 0, ang))
    ip = B.p('iron')
    for z in (1.0, h - 1.2):
        ip.box((w + 0.1, 0.12, 0.28), c + n * 0.2 + Vector((0, 0, z)), (0, 0, ang))
    if arch_key:
        ap = B.p(arch_key)
        r0 = w / 2 + 0.55
        for kk in range(9):
            a = math.pi * kk / 8
            pc = c + t * (math.cos(a) * r0) + n * 0.2 + Vector((0, 0, h - 0.4 + math.sin(a) * r0 * 0.6))
            ap.box((0.9, 0.7, 0.75), pc, (0, -a + math.pi / 2, 0) if face in 'SN' else (-a + math.pi / 2, 0, 0))
        for s in (-1, 1):
            ap.box((0.9, 0.7, h - 0.4), c + t * (s * r0) + n * 0.2 + Vector((0, 0, (h - 0.4) / 2)), (0, 0, ang))


def steps(B, c, face, w, n=3, key='stone', depth=1.1, rise=0.32):
    c = Vector(c)
    nn = NORMAL[face]
    t = Vector((-nn.y, nn.x, 0))
    ang = math.atan2(t.y, t.x)
    for i in range(n):
        B.p(key).box((w + (n - i) * 0.8, depth, rise), c + nn * (depth * (n - i - 0.5)) + Vector((0, 0, rise * (i + 0.5))), (0, 0, ang), rnd=0.3 + i * 0.1)


def clock(B, c, face, r=1.7):
    """A clock face with gold numerals and iron hands."""
    c = Vector(c)
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    cp = B.p('clock', smooth=True, bevel=0.0)
    # local frame of the face: x along the wall, y up, z out of the wall
    m = Matrix((t, Vector((0, 0, 1)), n)).transposed()
    if m.determinant() < 0:
        m = Matrix((-t, Vector((0, 0, 1)), n)).transposed()
    ring = []
    seg = 40
    for k in range(seg):
        a = 2 * math.pi * k / seg
        ring.append(c + m @ Vector((math.cos(a) * r, math.sin(a) * r, 0.3)))
    verts = [c + n * 0.3] + ring
    cp.mesh_from([tuple(v) for v in verts], [(0, 1 + k, 1 + (k + 1) % seg) for k in range(seg)], rnd=0.5)
    back = [c + m @ Vector((math.cos(2 * math.pi * k / seg) * r, math.sin(2 * math.pi * k / seg) * r, 0.0)) for k in range(seg)]
    B.p('stone_core', bevel=0.0).mesh_from([tuple(v) for v in back + ring], [(k, (k + 1) % seg, seg + (k + 1) % seg, seg + k) for k in range(seg)], rnd=0.5)
    gp = B.p('gold')
    for k in range(12):
        a = 2 * math.pi * k / 12
        pos = c + n * 0.38 + m @ Vector((math.cos(a) * r * 0.8, math.sin(a) * r * 0.8, 0))
        gp.box((0.2, 0.12, 0.42 if k % 3 == 0 else 0.24), pos, frame(t * math.cos(a + math.pi / 2) + Vector((0, 0, math.sin(a + math.pi / 2))), n))
    for k in range(24):
        a0 = 2 * math.pi * k / 24
        a1 = 2 * math.pi * (k + 1) / 24
        p0 = c + n * 0.35 + m @ Vector((math.cos(a0) * (r + 0.12), math.sin(a0) * (r + 0.12), 0))
        p1 = c + n * 0.35 + m @ Vector((math.cos(a1) * (r + 0.12), math.sin(a1) * (r + 0.12), 0))
        bar(gp, p0, p1, 0.22, 0.2, z_hint=n)
    ip = B.p('iron')
    for ang, ln in ((math.radians(60), r * 0.55), (math.radians(-35), r * 0.8)):
        d = t * math.sin(ang) + Vector((0, 0, math.cos(ang)))
        bar(ip, c + n * 0.42, c + n * 0.42 + d * ln, 0.16, 0.1, z_hint=n)


def banner(B, c, face, w=1.5, h=3.2, key='banner'):
    c = Vector(c)
    n = NORMAL[face]
    t = Vector((-n.y, n.x, 0))
    ang = math.atan2(t.y, t.x)
    B.p(key).box((w, 0.12, h), c + n * 0.25, (0, 0, ang))
    low = c + n * 0.25 + Vector((0, 0, -h / 2))
    B.p(key).mesh_from([tuple(low - t * w / 2), tuple(low + t * w / 2), tuple(low + Vector((0, 0, -0.7)))], [(0, 1, 2)])
    B.p('gold').box((w + 0.4, 0.25, 0.18), c + n * 0.3 + Vector((0, 0, h / 2 + 0.1)), (0, 0, ang))
    B.p('gold').box((0.42, 0.14, 0.42), c + n * 0.33 + Vector((0, 0, 0.3)), (0, math.radians(45), ang) if face in 'SN' else (math.radians(45), 0, 0))


def lantern(B, c, face):
    c = Vector(c)
    n = NORMAL[face]
    ip = B.p('iron')
    ip.box((0.12, 0.12, 0.12), c + n * 0.3)
    bar(ip, c, c + n * 0.85 + Vector((0, 0, 0.4)), 0.12)
    h = c + n * 0.85
    ip.box((0.75, 0.75, 0.12), h + Vector((0, 0, 0.6)))
    ip.box((0.7, 0.7, 0.12), h + Vector((0, 0, -0.55)))
    B.p('lamp').box((0.55, 0.55, 1.0), h)


def lamp_post(B, x, y, h=5.5):
    B.p('iron', smooth=True, bevel=0.0).lathe([(0.35, G), (0.35, G + 0.4), (0.16, G + 0.6), (0.12, G + h - 0.6), (0.2, G + h - 0.5)], (x, y, 0), segments=16)
    B.p('lamp').box((0.6, 0.6, 0.9), (x, y, G + h))
    B.p('iron').box((0.85, 0.85, 0.14), (x, y, G + h + 0.52))
    B.p('gold', smooth=True, bevel=0.0).lathe([(0.15, G + h + 0.58), (0.0, G + h + 0.95)], (x, y, 0), segments=12)


def flag(B, x, y, z, pole=6.0, size=(4.2, 2.6), key='flag', pole_key='gold'):
    """A pole from z with a flag flying towards the north-east (across the view)."""
    B.p(pole_key, smooth=True, bevel=0.0).lathe([(0.13, z), (0.13, z + pole), (0.28, z + pole + 0.15), (0.0, z + pole + 0.45)], (x, y, 0), segments=12)
    fw, fh = size
    top = z + pole - 0.1
    seg = 12
    verts = []
    for i in range(seg + 1):
        u = i / seg
        wave = math.sin(u * math.pi * 1.7) * 0.4 * u
        for j in (0, 1):
            verts.append((x + 0.15 + u * fw * 0.7 - wave * 0.7, y + 0.15 + u * fw * 0.7 + wave * 0.7, top - j * fh - u * 0.3))
    B.p(key, bevel=0.0).mesh_from(verts, [(i * 2, i * 2 + 2, i * 2 + 3, i * 2 + 1) for i in range(seg)])
    return (x + fw * 0.35, y + fw * 0.35, top - fh / 2)


def bell(B, x, y, z, s=1.0):
    B.p('bell', smooth=True, bevel=0.0).lathe([(p[0] * s, p[1] * s) for p in [(0.12, 2.15), (0.55, 2.1), (0.8, 1.7), (0.95, 0.9), (1.3, 0.25), (1.42, 0.0), (1.2, 0.05), (0.2, 0.3)]], (x, y, z), segments=32)


def column(B, x, y, z, h, r=0.75, key='lime'):
    B.p(key, smooth=True, bevel=0.0).lathe([(r * 1.35, z), (r * 1.35, z + 0.35), (r * 1.1, z + 0.55), (r, z + 0.8), (r * 0.9, z + h - 0.9),
                                             (r * 1.05, z + h - 0.6), (r * 1.3, z + h - 0.3), (r * 1.3, z + h)], (x, y, 0), segments=28)
    B.p(key).box((r * 2.9, r * 2.9, 0.4), (x, y, z + h + 0.2))


def pediment(B, x0, x1, y, z, h, depth=1.2, key='lime', emblem=True):
    xc = (x0 + x1) / 2
    v = [(x0, y, z), (x1, y, z), (xc, y, z + h), (x0, y + depth, z), (x1, y + depth, z), (xc, y + depth, z + h)]
    solid(B.p(key), v, [(0, 1, 2), (3, 5, 4), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)])
    # cornice along the slopes
    bar(B.p(key), (x0 - 0.4, y - 0.2, z + 0.1), (xc, y - 0.2, z + h + 0.25), 0.5, 0.45)
    bar(B.p(key), (xc, y - 0.2, z + h + 0.25), (x1 + 0.4, y - 0.2, z + 0.1), 0.5, 0.45)
    if emblem:
        r = h * 0.28
        seg = 28
        c = Vector((xc, y - 0.15, z + h * 0.42))
        ring = [c + Vector((math.cos(2 * math.pi * k / seg) * r, 0, math.sin(2 * math.pi * k / seg) * r)) for k in range(seg)]
        B.p('gold', bevel=0.0).mesh_from([tuple(c + Vector((0, -0.1, 0)))] + [tuple(v) for v in ring], [(0, 1 + k, 1 + (k + 1) % seg) for k in range(seg)])


def balustrade(B, a, b, z, h=1.1, key='trim', spacing=0.6):
    a = Vector((*a, z))
    b = Vector((*b, z))
    d = b - a
    L = d.length
    n = max(2, int(L / spacing))
    for i in range(n + 1):
        p = a + d * (i / n)
        B.p(key, smooth=True, bevel=0.0).lathe([(0.16, 0), (0.24, 0.25), (0.14, 0.55), (0.2, h - 0.2), (0.16, h - 0.1)], (p.x, p.y, p.z), segments=10)
    bar(B.p(key), a + Vector((0, 0, h)), b + Vector((0, 0, h)), 0.4, 0.25)
    bar(B.p(key), a + Vector((0, 0, 0.05)), b + Vector((0, 0, 0.05)), 0.45, 0.2)


def fountain(B, x, y, r=4.0):
    sp = B.p('marble', smooth=True, bevel=0.0)
    sp.lathe([(r, G), (r, G + 0.9), (r - 0.5, G + 0.9), (r - 0.5, G + 0.3), (0.0, G + 0.3)], (x, y, 0), segments=48)
    B.p('water', smooth=True, bevel=0.0).lathe([(r - 0.5, G + 0.7), (0.0, G + 0.7)], (x, y, 0), segments=48)
    sp.lathe([(0.6, G + 0.6), (0.45, G + 2.6), (1.8, G + 2.9), (1.8, G + 3.2), (0.4, G + 3.0), (0.3, G + 4.2), (0.8, G + 4.4), (0.0, G + 4.6)], (x, y, 0), segments=32)
    B.p('water', smooth=True, bevel=0.0).lathe([(1.6, G + 3.1), (0.0, G + 3.1)], (x, y, 0), segments=32)
    B.p('water', smooth=True, bevel=0.0).lathe([(0.12, G + 4.5), (0.25, G + 5.6), (0.05, G + 6.1), (0.0, G + 6.15)], (x, y, 0), segments=12)


def obelisk(B, x, y, h=7.0, key='marble'):
    B.p(key).box((2.2, 2.2, 1.0), (x, y, G + 0.5))
    p = B.p(key)
    v = [(x - 0.7, y - 0.7, G + 1.0), (x + 0.7, y - 0.7, G + 1.0), (x + 0.7, y + 0.7, G + 1.0), (x - 0.7, y + 0.7, G + 1.0),
         (x - 0.4, y - 0.4, G + h), (x + 0.4, y - 0.4, G + h), (x + 0.4, y + 0.4, G + h), (x - 0.4, y + 0.4, G + h)]
    solid(p, v, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)])
    g = B.p('gold')
    solid(g, [(x - 0.4, y - 0.4, G + h), (x + 0.4, y - 0.4, G + h), (x + 0.4, y + 0.4, G + h), (x - 0.4, y + 0.4, G + h), (x, y, G + h + 1.2)],
          [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4)])


def well(B, x, y):
    """A stone well with a little shingled roof, a winch and a bucket."""
    B.p('stone', smooth=True, bevel=0.0).lathe([(1.6, G), (1.6, G + 1.2), (1.25, G + 1.2), (1.25, G + 0.4), (0.0, G + 0.4)], (x, y, 0), segments=32)
    B.p('water', smooth=True, bevel=0.0).lathe([(1.25, G + 0.8), (0.0, G + 0.8)], (x, y, 0), segments=32)
    for s in (-1, 1):
        B.p('timber').box((0.3, 0.3, 3.0), (x + s * 1.45, y, G + 1.5 + 0.6))
    B.p('timber').box((3.2, 0.3, 0.3), (x, y, G + 3.3))
    B.p('door', smooth=True, bevel=0.0).lathe([(0.32, G + 1.6), (0.38, G + 2.2), (0.0, G + 2.2)], (x + 0.4, y - 0.3, 0), segments=14)
    gable(B, x - 1.6, x + 1.6, y - 1.3, y + 1.3, G + 3.4, pitch=40, over=0.3, end_over=0.25, tile='shingle', wall='planks', tw=0.8, tl=1.0, barge=None)


def fence(B, a, b, h=1.3, spacing=2.4):
    """Split-rail fence from a to b (x, y) on the ground."""
    a = Vector((*a, G))
    b = Vector((*b, G))
    d = b - a
    n = max(1, int(d.length / spacing))
    for i in range(n + 1):
        p = a + d * (i / n)
        B.p('timber').box((0.28, 0.28, h), p + Vector((0, 0, h / 2)))
    for z in (h * 0.45, h * 0.85):
        bar(B.p('planks'), a + Vector((0, 0, z)), b + Vector((0, 0, z)), 0.2, 0.16)


def barrels(B, spots):
    for (x, y) in spots:
        B.p('door', smooth=True, bevel=0.0).lathe([(0.55, G), (0.7, G + 0.4), (0.75, G + 0.75), (0.7, G + 1.1), (0.55, G + 1.5), (0.0, G + 1.5)], (x, y, 0), segments=18)
        for z in (0.3, 1.2):
            B.p('iron', smooth=True, bevel=0.0).lathe([(0.74, G + z), (0.74, G + z + 0.12)], (x, y, 0), segments=18)


def crates(B, spots):
    for (x, y, s) in spots:
        B.p('planks').box((s, s, s), (x, y, G + s / 2), (0, 0, B.p('planks').rng.uniform(-0.3, 0.3)))


# --------------------------------------------------------------------------
# the lot
# --------------------------------------------------------------------------
def plot(B, kind, cells=3, margin=1.5):
    """Paving of a lot of `cells` x `cells` cells (16 m each) and its kerb."""
    half = cells * 8.0 - margin
    size = half * 2
    kh = half + 0.1
    if kind in ('earth', 'gravel', 'cobble'):
        B.p(kind).box((size, size, 0.4), (0, 0, 0.2))
    elif kind in ('paved', 'marble'):
        B.p('stone_core', bevel=0.0).box((size, size, 0.3), (0, 0, 0.15))
        a, b = ('lime', 'stone') if kind == 'paved' else ('marble', 'marble_dark')
        n = max(3, int(round(size / 3.0)) | 1)
        st = size / n
        for i in range(n):
            for j in range(n):
                x = -half + st * (i + 0.5)
                y = -half + st * (j + 0.5)
                ring = max(abs(i - n // 2), abs(j - n // 2))
                key = b if (kind == 'marble' and (i + j) % 2) or (kind == 'paved' and ring == n // 2) else a
                B.p(key, bevel=0.06).box((st - 0.12, st - 0.12, 0.12), (x, y, 0.34))
    kp = B.p('logs' if kind == 'earth' else 'marble' if kind == 'marble' else 'kerb')
    kw = 1.1 if cells >= 3 else 0.8
    for side in range(4):
        x = -kh
        while x < kh:
            l = kp.rng.uniform(1.6, 2.6) if kind != 'earth' else kh * 2 + 0.1
            x1 = min(kh, x + l)
            cx = (x + x1) / 2
            hgt = 0.62 if kind != 'earth' else 0.6
            sz = (x1 - x - 0.1, kw, hgt) if side < 2 else (kw, x1 - x - 0.1, hgt)
            pos = (cx, -kh if side == 0 else kh, hgt / 2) if side < 2 else (-kh if side == 2 else kh, cx, hgt / 2)
            kp.box(sz, pos)
            x = x1


def yard(B, kind, x0, x1, y0, y1, r=1.6):
    """A yard around a building that stands on the grass: a rounded pad of earth,
    gravel or cobbles, or a paved terrace; its top is the ground level G."""
    if kind == 'paved':
        B.p('stone_core', bevel=0.0).box((x1 - x0, y1 - y0, G), ((x0 + x1) / 2, (y0 + y1) / 2, G / 2))
        st = 2.4
        nx = max(1, int(round((x1 - x0) / st)))
        ny = max(1, int(round((y1 - y0) / st)))
        for i in range(nx):
            for j in range(ny):
                key = 'stone' if (i in (0, nx - 1) or j in (0, ny - 1)) else 'lime'
                B.p(key, bevel=0.05).box(((x1 - x0) / nx - 0.1, (y1 - y0) / ny - 0.1, 0.1),
                                         (x0 + (x1 - x0) / nx * (i + 0.5), y0 + (y1 - y0) / ny * (j + 0.5), G - 0.02))
    else:
        B.p(kind, bevel=min(r, (x1 - x0) / 2 - 0.1, (y1 - y0) / 2 - 0.1), segments=4).box((x1 - x0, y1 - y0, G + 0.02), ((x0 + x1) / 2, (y0 + y1) / 2, (G + 0.02) / 2))


# --------------------------------------------------------------------------
# props for the village
# --------------------------------------------------------------------------
def blob(p, c, r, sx=1.0, sy=1.0, sz=0.7, rough=0.22, subdiv=2, seed=1):
    """A rough rock or mound: an icosphere pushed in and out at random."""
    import bmesh
    import random
    rng = random.Random(seed)
    res = bmesh.ops.create_icosphere(p.bm, subdivisions=subdiv, radius=r)
    for v in res['verts']:
        k = 1 + rng.uniform(-rough, rough)
        v.co = Vector((v.co.x * sx * k + c[0], v.co.y * sy * k + c[1], max(0.0, v.co.z) * sz * k + c[2]))
    faces = {f for v in res['verts'] for f in v.link_faces}
    val = rng.random()
    for f in faces:
        f[p.rnd_layer] = val


def figure(B, x, y, z=G, h=2.0, face=(1, -1), body='cloth', helmet='yellow', vest='orange', tool=True):
    """A little worker: legs, body, vest, arms, head and a hard hat, facing `face` (x, y)."""
    fx, fy = face
    ang = math.atan2(fy, fx)
    s = h / 2.0
    for side in (-1, 1):
        ox = -math.sin(ang) * side * 0.16 * s
        oy = math.cos(ang) * side * 0.16 * s
        B.p(body, smooth=True, bevel=0.0).lathe([(0.11 * s, 0), (0.12 * s, 0.75 * s), (0.0, 0.76 * s)], (x + ox, y + oy, z), segments=10)
    B.p(vest, smooth=True, bevel=0.0).lathe([(0.0, 0.7 * s), (0.3 * s, 0.72 * s), (0.33 * s, 1.0 * s), (0.3 * s, 1.35 * s), (0.18 * s, 1.45 * s), (0.0, 1.46 * s)], (x, y, z), segments=16)
    for side in (-1, 1):
        ox = -math.sin(ang) * side * 0.36 * s
        oy = math.cos(ang) * side * 0.36 * s
        bar(B.p(body), (x + ox, y + oy, z + 1.38 * s), (x + ox + fx * 0.25 * s, y + oy + fy * 0.25 * s, z + 0.95 * s), 0.13 * s, 0.13 * s)
    B.p('skin', smooth=True, bevel=0.0).lathe([(0.0, 1.45 * s), (0.2 * s, 1.52 * s), (0.25 * s, 1.68 * s), (0.2 * s, 1.84 * s), (0.0, 1.9 * s)], (x, y, z), segments=16)
    B.p(helmet, smooth=True, bevel=0.0).lathe([(0.34 * s, 1.78 * s), (0.27 * s, 1.84 * s), (0.25 * s, 1.95 * s), (0.15 * s, 2.03 * s), (0.0, 2.05 * s)], (x, y, z), segments=18)
    if tool:
        hx = x - math.sin(ang) * 0.42 * s + fx * 0.3 * s
        hy = y + math.cos(ang) * 0.42 * s + fy * 0.3 * s
        bar(B.p('timber'), (hx, hy, z + 0.75 * s), (hx, hy, z + 1.3 * s), 0.07 * s)
        B.p('iron').box((0.28 * s, 0.12 * s, 0.12 * s), (hx, hy, z + 1.33 * s), (0, 0, ang))


def shed_roof(B, x0, x1, y0, y1, z_low, z_high, tile='shingle', over=0.6, tw=1.0, tl=1.3, rise_to='N'):
    """Single-slope roof, rising towards `rise_to` (N or E)."""
    tiles = B.p(tile)
    if rise_to == 'N':
        a, b = (x0 - over, y0 - over, z_low), (x1 + over, y0 - over, z_low)
        c, d = (x1 + over, y1 + over, z_high), (x0 - over, y1 + over, z_high)
    else:
        a, b = (x0 - over, y1 + over, z_low), (x0 - over, y0 - over, z_low)
        c, d = (x1 + over, y0 - over, z_high), (x1 + over, y1 + over, z_high)
    tile_face(tiles, a, b, c, d, tw=tw, tl=tl)
    lift = Vector((0, 0, -0.12))
    va = [Vector(v) + lift for v in (a, b, c, d)]
    solid(B.p('roof_under', bevel=0.0), va + [v + Vector((0, 0, -0.25)) for v in va], [(0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)])


def wheel(B, c, r, axis='x', key='timber', rim='iron', spokes=8, w=0.3):
    """A spoked wheel standing upright, its axle along `axis`."""
    c = Vector(c)
    if axis == 'x':
        u, v = Vector((0, 1, 0)), Vector((0, 0, 1))
    else:
        u, v = Vector((1, 0, 0)), Vector((0, 0, 1))
    n = 24
    pts = [c + u * math.cos(2 * math.pi * k / n) * r + v * math.sin(2 * math.pi * k / n) * r for k in range(n)]
    for p0, p1 in zip(pts, pts[1:] + pts[:1]):
        bar(B.p(rim), p0, p1, w, w * 0.8, z_hint=(Vector((1, 0, 0)) if axis == 'x' else Vector((0, 1, 0))))
    for k in range(spokes):
        a = 2 * math.pi * k / spokes
        bar(B.p(key), c, c + u * math.cos(a) * r + v * math.sin(a) * r, w * 0.6, w * 0.6, z_hint=(Vector((1, 0, 0)) if axis == 'x' else Vector((0, 1, 0))))
    B.p(rim).box((w * 2.2, w * 2.2, w * 2.2), c)


def rails(B, a, b, gauge=1.2):
    a = Vector((*a, G))
    b = Vector((*b, G))
    d = (b - a)
    L = d.length
    t = d.normalized()
    n = Vector((-t.y, t.x, 0))
    for k in range(int(L / 0.9) + 1):
        p = a + t * (k * 0.9)
        bar(B.p('timber'), p - n * (gauge * 0.85) + Vector((0, 0, 0.08)), p + n * (gauge * 0.85) + Vector((0, 0, 0.08)), 0.32, 0.16)
    for s in (-1, 1):
        bar(B.p('iron'), a + n * s * gauge / 2 + Vector((0, 0, 0.24)), b + n * s * gauge / 2 + Vector((0, 0, 0.24)), 0.14, 0.16)


def cart(B, x, y, along='x', load='gold'):
    """A mine cart on rails, heaped with gold."""
    L, W, H = 2.4, 1.6, 1.1
    if along == 'y':
        L, W = W, L
    p = B.p('iron')
    z = G + 0.75
    v = [(x - L / 2, y - W / 2, z + H), (x + L / 2, y - W / 2, z + H), (x + L / 2, y + W / 2, z + H), (x - L / 2, y + W / 2, z + H),
         (x - L / 2 + 0.3, y - W / 2 + 0.3, z), (x + L / 2 - 0.3, y - W / 2 + 0.3, z), (x + L / 2 - 0.3, y + W / 2 - 0.3, z), (x - L / 2 + 0.3, y + W / 2 - 0.3, z)]
    solid(p, v, [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)])
    B.p('timber').box((L + 0.15, W + 0.15, 0.2), (x, y, z + H))
    for sx in (-1, 1):
        for sy in (-1, 1):
            cx = x + sx * (L / 2 - 0.45 if along == 'x' else W / 2 - 0.1)
            cy = y + sy * (W / 2 - 0.1 if along == 'x' else L / 2 - 0.45)
            B.p('iron').box((0.25 if along == 'y' else 0.7, 0.7 if along == 'y' else 0.25, 0.7), (cx, cy, G + 0.45))
    if load == 'gold':
        coins(B, x, y, z + H - 0.1, r=min(L, W) / 2 - 0.1, h=0.7, n=14)


def coins(B, x, y, z, r=1.5, h=1.0, n=30, seed=3):
    """A heap of gold: a lumpy golden mound with loose coins all over it."""
    import random
    rng = random.Random(seed + int(x * 7 + y * 13))
    blob(B.p('gold', bevel=0.0), (x, y, z), r, 1.0, 1.0, h / r, rough=0.18, subdiv=2, seed=seed + int(x * 3))
    for _ in range(n):
        a = rng.uniform(0, 2 * math.pi)
        d = math.sqrt(rng.uniform(0.0, 1.0)) * r * 1.05
        zz = z + h * max(0.0, 1 - (d / r) ** 2) * 0.92 + 0.04
        cr = rng.uniform(0.3, 0.42)
        B.p('gold', bevel=0.03).box((cr * 2, cr * 2, 0.12), (x + math.cos(a) * d, y + math.sin(a) * d, zz),
                                    (rng.uniform(-0.5, 0.5), rng.uniform(-0.5, 0.5), rng.uniform(0, 3)))


def chest(B, x, y, s=1.0, rot=0.0):
    B.p('door').box((1.6 * s, 1.0 * s, 0.9 * s), (x, y, G + 0.45 * s), (0, 0, rot))
    B.p('door').box((1.6 * s, 1.0 * s, 0.35 * s), (x, y, G + 1.05 * s), (0, 0, rot))
    for k in (-0.5, 0.5):
        B.p('gold').box((0.14 * s, 1.08 * s, 1.3 * s), (x + math.cos(rot) * k * s, y + math.sin(rot) * k * s, G + 0.62 * s), (0, 0, rot))


def bench(B, x, y, along='x', key='planks'):
    L = 2.6
    sx, sy = (L, 0.55) if along == 'x' else (0.55, L)
    B.p(key).box((sx, sy, 0.14), (x, y, G + 0.55))
    bx, by = (0, 0.3) if along == 'x' else (0.3, 0)
    B.p(key).box((sx, 0.12, 0.55) if along == 'x' else (0.12, sy, 0.55), (x + bx, y + by, G + 0.95))
    for k in (-1, 1):
        ox, oy = (k * (L / 2 - 0.3), 0) if along == 'x' else (0, k * (L / 2 - 0.3))
        B.p('iron').box((0.12, 0.6, 0.55) if along == 'x' else (0.6, 0.12, 0.55), (x + ox, y + oy, G + 0.28))


def shrub(B, x, y, r=1.0, seed=1):
    blob(B.p('leaf', bevel=0.0), (x, y, G), r, 1.0, 1.0, 0.9, rough=0.25, subdiv=2, seed=seed)


def flowerbed(B, x, y, sx=2.6, sy=1.6, seed=1):
    import random
    rng = random.Random(seed)
    B.p('kerb').box((sx + 0.4, sy + 0.4, 0.45), (x, y, G + 0.22))
    B.p('soil').box((sx, sy, 0.5), (x, y, G + 0.27))
    keys = ['flower_red', 'flower_yellow', 'flower_white']
    for i in range(int(sx * sy * 5)):
        fx = x + rng.uniform(-sx / 2 + 0.2, sx / 2 - 0.2)
        fy = y + rng.uniform(-sy / 2 + 0.2, sy / 2 - 0.2)
        B.p('leaf', bevel=0.0).box((0.2, 0.2, 0.35), (fx, fy, G + 0.65))
        B.p(keys[rng.randrange(3)], bevel=0.0).box((0.3, 0.3, 0.16), (fx, fy, G + 0.88), (0, 0, rng.uniform(0, 1.5)))


def tree(B, x, y, h=7.0, seed=1):
    """A decorative round-crowned tree (only for parks and decorations)."""
    B.p('timber', smooth=True, bevel=0.0).lathe([(0.45, G), (0.3, G + h * 0.45), (0.0, G + h * 0.46)], (x, y, 0), segments=10)
    import random
    rng = random.Random(seed)
    for k in range(5):
        a = rng.uniform(0, 6.28)
        d = rng.uniform(0.3, 1.2) if k else 0.0
        blob(B.p('leaf', bevel=0.0), (x + math.cos(a) * d, y + math.sin(a) * d, G + h * 0.45 + rng.uniform(0, h * 0.2)), h * 0.26, 1.0, 1.0, 1.0, rough=0.18, subdiv=2, seed=seed * 7 + k)
