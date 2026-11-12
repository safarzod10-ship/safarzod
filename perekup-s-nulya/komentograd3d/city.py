"""Komentograd: a night isometric miniature city rendered with Blender (Cycles, CPU).

Usage: python3 city.py OUT_PREFIX [samples] [frames] [res_scale]
Renders a slow orbiting camera move: OUT_PREFIX_0001.png ... (1080x1920 * res_scale).
Also writes OUT_PREFIX_pins.json: screen positions of building rooftops for UI pins per frame.
"""
import json
import math
import random
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

OUT = sys.argv[1] if len(sys.argv) > 1 else 'city'
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 24
FRAMES = int(sys.argv[3]) if len(sys.argv) > 3 else 1
SCALE = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


def principled(name, col, rough=.6, metal=0., emit=None, es=0.):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(col)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = srgb(emit)
        b.inputs['Emission Strength'].default_value = es
    return m


def building_mat(name, wall, win, seed):
    """Wall with a grid of lit / dark windows (brick texture drives emission)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(wall)
    b.inputs['Roughness'].default_value = .7
    tc = nt.nodes.new('ShaderNodeTexCoord')
    brick = nt.nodes.new('ShaderNodeTexBrick')
    brick.offset = 0.0
    brick.squash = 1.0
    brick.inputs['Scale'].default_value = 7.0
    brick.inputs['Mortar Size'].default_value = 0.22
    brick.inputs['Brick Width'].default_value = 0.45
    brick.inputs['Row Height'].default_value = 0.35
    brick.inputs['Color1'].default_value = srgb(win)
    brick.inputs['Color2'].default_value = srgb('#1a1630')
    brick.inputs['Mortar'].default_value = (0, 0, 0, 1)
    noise = nt.nodes.new('ShaderNodeTexWhiteNoise')
    noise.noise_dimensions = '3D'
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].position = .55
    ramp.color_ramp.elements[0].color = (0, 0, 0, 1)
    ramp.color_ramp.elements[1].position = .56
    ramp.color_ramp.elements[1].color = (1, 1, 1, 1)
    snap = nt.nodes.new('ShaderNodeVectorMath')
    snap.operation = 'SNAP'
    snap.inputs[1].default_value = (0.14, 0.14, 0.2)
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mix = nt.nodes.new('ShaderNodeMixRGB')
    mix.blend_type = 'MULTIPLY'
    mix.inputs['Fac'].default_value = 1.0
    nt.links.new(tc.outputs['Object'], brick.inputs['Vector'])
    nt.links.new(tc.outputs['Object'], snap.inputs[0])
    nt.links.new(snap.outputs['Vector'], noise.inputs['Vector'])
    nt.links.new(noise.outputs['Value'], ramp.inputs['Fac'])
    nt.links.new(brick.outputs['Color'], mix.inputs['Color1'])
    nt.links.new(ramp.outputs['Color'], mix.inputs['Color2'])
    nt.links.new(mix.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 6.0
    return m


ROAD = principled('road', '#1b1a26', .9)
SIDEWALK = principled('walk', '#3a3550', .8)
GROUND = principled('ground', '#141322', .95)
LINE = principled('line', '#ffffff', .5, emit='#ffe9b0', es=1.5)
TRUNK = principled('trunk', '#3b2a22', .8)
LEAF = principled('leaf', '#1f6b4f', .7)
LAMP = principled('lamp', '#ffd38a', .3, emit='#ffcf7a', es=25)
ROOF = principled('roof', '#2a2540', .6)
NEON = [principled(f'neon{i}', c, .3, emit=c, es=18) for i, c in enumerate(['#ff4fa3', '#39c6ff', '#ffb84a', '#7c5cff'])]
CARS = [principled(f'car{i}', c, .25, metal=.4) for i, c in enumerate(['#e5484d', '#facc15', '#38bdf8', '#f8fafc'])]
HEAD = principled('head', '#fff3d0', .2, emit='#fff1c2', es=12)
TAIL = principled('tail', '#ff3355', .2, emit='#ff2244', es=10)
WALLS = ['#55488a', '#6a4f8f', '#43559a', '#7a5486', '#4d4884', '#3f6a8a']
WINS = ['#ffd27a', '#ffc46b', '#bfe3ff', '#ffe6a8']


def box(loc, dim, mat, bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.scale = dim
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    if bevel:
        m = o.modifiers.new('b', 'BEVEL')
        m.width = bevel
        m.segments = 2
    return o


# ground + road grid (blocks of 6x6 with roads of width 1.6)
box((0, 0, -0.06), (80, 80, 0.1), GROUND, 0)
N, BLK, RW = 5, 6.0, 1.8
span = N * BLK + (N + 1) * RW
half = span / 2
for i in range(N + 1):
    p = -half + i * (BLK + RW) + RW / 2
    box((p, 0, 0.0), (RW, span, 0.02), ROAD, 0)
    box((0, p, 0.0), (span, RW, 0.02), ROAD, 0)
    for k in range(int(span / 1.2)):
        q = -half + 0.6 + k * 1.2
        box((p, q, 0.015), (0.06, 0.5, 0.01), LINE, 0)
        box((q, p, 0.015), (0.5, 0.06, 0.01), LINE, 0)

rooftops = []
win_quads = []  # (verts, lit)
WIN_LIT = [principled(f'wl{i}', c, .2, emit=c, es=9) for i, c in enumerate(['#ffd27a', '#ffc46b', '#bfe3ff', '#ffe6a8'])]
WIN_DARK = principled('wd', '#0d1020', .1, metal=.3)
for bx in range(N):
    for by in range(N):
        cx = -half + RW + bx * (BLK + RW) + BLK / 2
        cy = -half + RW + by * (BLK + RW) + BLK / 2
        box((cx, cy, 0.06), (BLK, BLK, 0.12), SIDEWALK, 0.04)
        # 2x2 lots per block
        for lx in (-1, 1):
            for ly in (-1, 1):
                if random.random() < 0.12:
                    # small park
                    for _ in range(3):
                        tx, ty = cx + lx * 1.5 + random.uniform(-.8, .8), cy + ly * 1.5 + random.uniform(-.8, .8)
                        bpy.ops.mesh.primitive_cylinder_add(radius=.08, depth=.6, location=(tx, ty, .42))
                        bpy.context.object.data.materials.append(TRUNK)
                        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=.45, location=(tx, ty, .95))
                        bpy.context.object.data.materials.append(LEAF)
                    continue
                h = random.choice([1.2, 1.8, 2.4, 3.2, 4.5, 6.0, 8.0]) * (1.25 if abs(bx - 2) + abs(by - 2) <= 1 else 1)
                w = random.uniform(2.0, 2.6)
                x, y = cx + lx * 1.5, cy + ly * 1.5
                mat = principled(f'w{bx}{by}{lx}{ly}', random.choice(WALLS), .75)
                box((x, y, 0.12 + h / 2), (w, w, h), mat, 0.04)
                # windows on the two faces the camera sees (-x and -y)
                lit_p = random.uniform(.35, .7)
                fl = int((h - .3) / .55)
                cols = int((w - .3) / .42)
                for r in range(fl):
                    z0 = 0.12 + .3 + r * .55
                    for c in range(cols):
                        u0 = -w / 2 + .2 + c * .42 + .06
                        lit = random.random() < lit_p
                        for face in ('x', 'y'):
                            if face == 'x':
                                X = x - w / 2 - 0.012
                                v = [(X, y + u0, z0), (X, y + u0 + .26, z0), (X, y + u0 + .26, z0 + .32), (X, y + u0, z0 + .32)]
                            else:
                                Y = y - w / 2 - 0.012
                                v = [(x + u0, Y, z0), (x + u0 + .26, Y, z0), (x + u0 + .26, Y, z0 + .32), (x + u0, Y, z0 + .32)]
                            win_quads.append((v, lit and random.random() < .97))
                box((x, y, 0.12 + h + 0.06), (w * .9, w * .9, 0.12), ROOF, 0.02)
                if random.random() < 0.35:
                    nm = random.choice(NEON)
                    box((x, y - w / 2 - 0.02, 0.12 + h * random.uniform(.5, .85)), (w * .6, 0.04, 0.18), nm, 0.01)
                rooftops.append((x, y, 0.12 + h + 0.15))
        # street lamps at block corners
        for sx in (-1, 1):
            for sy in (-1, 1):
                lx_, ly_ = cx + sx * (BLK / 2 - .2), cy + sy * (BLK / 2 - .2)
                bpy.ops.mesh.primitive_cylinder_add(radius=.035, depth=.9, location=(lx_, ly_, .57))
                bpy.context.object.data.materials.append(ROOF)
                bpy.ops.mesh.primitive_uv_sphere_add(radius=.09, location=(lx_, ly_, 1.05))
                bpy.context.object.data.materials.append(LAMP)

import bmesh
me = bpy.data.meshes.new('windows')
bm = bmesh.new()
for v, lit in win_quads:
    f = bm.faces.new([bm.verts.new(p) for p in v])
    f.material_index = random.randrange(4) if lit else 4
bm.to_mesh(me)
bm.free()
wo = bpy.data.objects.new('windows', me)
sc.collection.objects.link(wo)
for m in WIN_LIT + [WIN_DARK]:
    me.materials.append(m)
print('windows', len(win_quads))

# cars on roads (animated along their road)
cars = []
for i in range(14):
    road = random.randrange(N + 1)
    p = -half + road * (BLK + RW) + RW / 2
    horiz = random.random() < .5
    lane = .4 if random.random() < .5 else -.4
    start = random.uniform(-half, half)
    speed = random.uniform(.03, .06) * (1 if lane > 0 else -1)
    body = box((0, 0, .22), (.9, .45, .25) if horiz else (.45, .9, .25), random.choice(CARS), .06)
    cab = box((0, 0, .42), (.5, .38, .18) if horiz else (.38, .5, .18), principled(f'glass{i}', '#0e1424', .1, metal=.2), .04)
    cars.append((body, cab, horiz, p + lane, start, speed))

# lights: moonlight + warm city bounce
sun = bpy.data.lights.new('moon', 'SUN')
sun.energy = 4.5
sun.color = srgb('#9fb4ff')[:3]
so = bpy.data.objects.new('moon', sun)
sc.collection.objects.link(so)
so.rotation_euler = (math.radians(55), 0, math.radians(35))
for nm, loc, col, e in [('pink', (-30, 10, 18), '#ff4fa3', 9000), ('cyan', (10, -30, 18), '#39c6ff', 9000)]:
    ld = bpy.data.lights.new(nm, 'AREA'); ld.energy = e; ld.size = 25; ld.color = srgb(col)[:3]
    lo = bpy.data.objects.new(nm, ld); sc.collection.objects.link(lo); lo.location = loc
    lo.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
w = bpy.data.worlds.new('w')
sc.world = w
w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = srgb('#1a1640')
w.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2
# camera: orthographic isometric, slow orbit
cd = bpy.data.cameras.new('cam')
cd.type = 'ORTHO'
cd.ortho_scale = 34
cam = bpy.data.objects.new('cam', cd)
sc.collection.objects.link(cam)
sc.camera = cam

sc.render.engine = 'CYCLES'
sc.cycles.device = 'CPU'
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.cycles.max_bounces = 4
sc.render.resolution_x = int(1080 * SCALE)
sc.render.resolution_y = int(1920 * SCALE)
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'AgX'
try:
    sc.view_settings.look = 'AgX - Punchy'
except Exception:
    pass

pins = []
for f in range(FRAMES):
    k = f / max(1, FRAMES - 1)
    ang = math.radians(225 + 18 * k)
    dist, elev = 60, math.radians(36)
    cam.location = (math.cos(ang) * dist * math.cos(elev), math.sin(ang) * dist * math.cos(elev), dist * math.sin(elev))
    cam.rotation_euler = (Vector((0, 0, 0)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    for body, cab, horiz, p, start, speed in cars:
        q = ((start + speed * f * 4 + half) % span) - half
        loc = (q, p, 0) if horiz else (p, q, 0)
        body.location = (loc[0], loc[1], .22)
        cab.location = (loc[0], loc[1], .42)
    sc.frame_set(f + 1)
    sc.render.filepath = f'{OUT}_{f + 1:04d}.png'
    bpy.ops.render.render(write_still=True)
    pins.append([[round(v, 4) for v in world_to_camera_view(sc, cam, Vector(r))[:2]] for r in rooftops])
json.dump({'rooftops': rooftops, 'pins': pins}, open(f'{OUT}_pins.json', 'w'))
print('done', FRAMES)
