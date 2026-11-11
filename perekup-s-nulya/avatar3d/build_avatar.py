"""3D avatar of Timur (Pixar-like stylised render) with Blender's Python module.

Usage: python3 build_avatar.py OUT.png [samples] [theme]
theme: amber (default) | navy
"""
import math
import sys

import bpy
from mathutils import Vector

OUT = sys.argv[1] if len(sys.argv) > 1 else 'avatar3d.png'
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 96
THEME = sys.argv[3] if len(sys.argv) > 3 else 'amber'
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


def mat(name, color, rough=0.5, metal=0.0, sss=0.0, coat=0.0, emit=None, emit_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb(color)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if sss:
        b.inputs['Subsurface Weight'].default_value = sss
        b.inputs['Subsurface Radius'].default_value = (1.0, 0.35, 0.2)
        b.inputs['Subsurface Scale'].default_value = 0.08
    if coat:
        b.inputs['Coat Weight'].default_value = coat
        b.inputs['Coat Roughness'].default_value = 0.08
    if emit:
        b.inputs['Emission Color'].default_value = srgb(emit)
        b.inputs['Emission Strength'].default_value = emit_strength
    return m


def smooth(obj, levels=2):
    for p in obj.data.polygons:
        p.use_smooth = True
    mod = obj.modifiers.new('sub', 'SUBSURF')
    mod.levels = levels
    mod.render_levels = levels
    return obj


def sphere(name, loc, scale, material, seg=48, rings=24, sub=1):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.scale = scale
    o.data.materials.append(material)
    return smooth(o, sub)


def put(o, material):
    o.data.materials.append(material)
    return o


SKIN = mat('skin', '#f2bf98', rough=0.48, sss=0.25)
SKIN_D = mat('skin_d', '#d9987a', rough=0.5, sss=0.2)
WHITE = mat('eye_white', '#fbfbf7', rough=0.15, coat=0.6)
IRIS = mat('iris', '#4a2f1d', rough=0.2, coat=1.0)
PUPIL = mat('pupil', '#0d0b0a', rough=0.1, coat=1.0)
GLINT = mat('glint', '#ffffff', emit='#ffffff', emit_strength=6)
BROW = mat('brow', '#3a2a1e', rough=0.7)
LIP = mat('lip', '#7a2d2a', rough=0.4)
CAP = mat('cap', '#e5383b', rough=0.55, coat=0.15)
CAP_D = mat('cap_d', '#b3262b', rough=0.6)
HOOD = mat('hoodie', '#1fae79', rough=0.85)
HOOD_D = mat('hoodie_d', '#168a5f', rough=0.85)
CORD = mat('cord', '#f3f3f3', rough=0.6)
GOLD = mat('gold', '#ffbf2e', rough=0.22, metal=1.0)
GOLD_D = mat('gold_d', '#d48b00', rough=0.3, metal=1.0)

# ---------------- head ----------------
head = sphere('head', (0, 0, 0), (1.0, 0.94, 1.04), SKIN, sub=2)
for sd in (-1, 1):
    ear = sphere(f'ear{sd}', (sd * 0.98, 0.05, -0.05), (0.2, 0.12, 0.27), SKIN, sub=1)
    sphere(f'ear_in{sd}', (sd * 1.02, -0.03, -0.05), (0.1, 0.05, 0.16), SKIN_D, sub=1)
nose = sphere('nose', (0, -0.95, -0.12), (0.16, 0.14, 0.14), SKIN, sub=1)
for sd in (-1, 1):
    sphere(f'cheek{sd}', (sd * 0.5, -0.78, -0.3), (0.2, 0.08, 0.13), mat(f'blush{sd}', '#f0a48a', rough=0.5, sss=0.2), sub=1)

# eyes (big, glossy) — looking slightly to camera-right for a cheeky look
for sd in (-1, 1):
    x = sd * 0.34
    sphere(f'eye{sd}', (x, -0.78, 0.14), (0.24, 0.16, 0.29), WHITE, sub=2)
    sphere(f'iris{sd}', (x + 0.04, -0.92, 0.1), (0.135, 0.05, 0.16), IRIS, sub=2)
    sphere(f'pupil{sd}', (x + 0.045, -0.955, 0.1), (0.075, 0.03, 0.09), PUPIL, sub=2)
    sphere(f'glint{sd}', (x + 0.0, -0.975, 0.17), (0.035, 0.015, 0.035), GLINT, sub=1)
    # upper lid line gives attitude: the left one slightly lower
    bpy.ops.mesh.primitive_torus_add(major_radius=0.25, minor_radius=0.03, location=(x, -0.8, 0.16))
    lid = put(bpy.context.object, SKIN_D)
    lid.scale = (1.0, 0.62, 1.12)
    lid.rotation_euler = (math.radians(90), 0, 0)
    smooth(lid, 1)

# eyebrows: one raised (smirk)
for sd, rot, z in ((-1, -8, 0.4), (1, 16, 0.46)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(sd * 0.36, -0.9, z))
    br = put(bpy.context.object, BROW)
    br.scale = (0.3, 0.07, 0.07)
    br.rotation_euler = (math.radians(-12), math.radians(sd * rot), 0)
    bev = br.modifiers.new('bev', 'BEVEL')
    bev.width = 0.03
    bev.segments = 6
    smooth(br, 2)

# smirk: a bevelled bezier curve hugging the face
cu = bpy.data.curves.new('smile', 'CURVE')
cu.dimensions = '3D'
cu.bevel_depth = 0.045
cu.bevel_resolution = 6
sp = cu.splines.new('BEZIER')
pts = [(-0.3, -0.89, -0.4), (0.0, -0.95, -0.49), (0.34, -0.86, -0.33)]
sp.bezier_points.add(len(pts) - 1)
for bp, p in zip(sp.bezier_points, pts):
    bp.co = p
    bp.handle_left_type = bp.handle_right_type = 'AUTO'
smile = bpy.data.objects.new('smile', cu)
scene.collection.objects.link(smile)
smile.data.materials.append(LIP)
sphere('dimple', (0.37, -0.83, -0.3), (0.035, 0.02, 0.035), LIP, sub=1)

# hair peeking from under the cap
for sd in (-1, 1):
    sphere(f'burn{sd}', (sd * 0.9, -0.12, 0.3), (0.09, 0.16, 0.22), BROW, sub=1)


# ---------------- cap (worn backwards) ----------------
bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=1.1, location=(0, 0.03, 0.05))
cap = bpy.context.object
cap.name = 'cap'
cap.scale = (1.0, 0.98, 0.96)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.bisect(plane_co=(0, 0, 0.5), plane_no=(0, 0.25, -1), clear_inner=False, clear_outer=True)
bpy.ops.object.mode_set(mode='OBJECT')
cap.rotation_euler = (math.radians(-8), 0, 0)
put(cap, CAP)
sol = cap.modifiers.new('sol', 'SOLIDIFY')
sol.thickness = 0.05
smooth(cap, 2)
# seams + button
for ang in range(0, 360, 60):
    a = math.radians(ang)
    cu2 = bpy.data.curves.new(f'seam{ang}', 'CURVE')
    cu2.dimensions = '3D'
    cu2.bevel_depth = 0.012
    s2 = cu2.splines.new('POLY')
    arc = [(math.sin(a) * math.sin(t) * 1.09, -math.cos(a) * math.sin(t) * 1.07 + 0.02, math.cos(t) * 1.04 + 0.08) for t in [i / 10 * 1.15 for i in range(11)]]
    s2.points.add(len(arc) - 1)
    for p, c in zip(s2.points, arc):
        p.co = (*c, 1)
    o2 = bpy.data.objects.new(f'seam{ang}', cu2)
    scene.collection.objects.link(o2)
    o2.data.materials.append(CAP_D)
    o2.rotation_euler = (math.radians(-8), 0, 0)
sphere('button', (0, 0.12, 1.15), (0.09, 0.09, 0.05), CAP_D, sub=1)
# backwards brim
bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.62, depth=0.07, location=(0.32, 1.12, 0.78))
brim = put(bpy.context.object, CAP)
brim.scale = (1.2, 0.85, 1.0)
brim.rotation_euler = (math.radians(32), math.radians(-14), math.radians(-28))
bev = brim.modifiers.new('bev', 'BEVEL')
bev.width = 0.025
bev.segments = 4
# hole of a snapback with hair tuft

# ---------------- body ----------------
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.33, depth=0.6, location=(0, 0.05, -1.05))
put(bpy.context.object, SKIN)
smooth(bpy.context.object, 1)
torso = sphere('torso', (0, 0.15, -2.5), (1.65, 0.92, 1.15), HOOD, sub=2)
for sd in (-1, 1):
    sphere(f'shoulder{sd}', (sd * 1.05, 0.15, -1.85), (0.62, 0.62, 0.42), HOOD, sub=2)
bpy.ops.mesh.primitive_torus_add(major_radius=0.62, minor_radius=0.2, location=(0, 0.02, -1.28))
collar = put(bpy.context.object, HOOD_D)
collar.scale = (1.15, 0.95, 0.75)
smooth(collar, 2)
# hood bunched behind the neck
sphere('hood_back', (0, 0.7, -1.2), (0.9, 0.35, 0.5), HOOD_D, sub=2)
for sd in (-1, 1):
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=0.035, depth=0.75, location=(sd * 0.2, -0.78, -1.75))
    c = put(bpy.context.object, CORD)
    c.rotation_euler = (math.radians(-12), math.radians(sd * 4), 0)
    smooth(c, 1)
    sphere(f'aglet{sd}', (sd * 0.21, -0.86, -2.12), (0.055, 0.055, 0.09), CORD, sub=1)

# ---------------- coins with ruble sign ----------------
def coin(loc, rot, r=0.42):
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=r, depth=0.09, location=loc)
    c = put(bpy.context.object, GOLD)
    c.rotation_euler = rot
    bev = c.modifiers.new('bev', 'BEVEL')
    bev.width = 0.02
    bev.segments = 4
    bpy.ops.mesh.primitive_torus_add(major_radius=r * 0.82, minor_radius=r * 0.06, location=loc)
    rim = put(bpy.context.object, GOLD_D)
    rim.rotation_euler = rot
    for side in (1, -1):
        bpy.ops.object.text_add(location=loc)
        tx = bpy.context.object
        tx.data.body = '₽'
        try:
            tx.data.font = bpy.data.fonts.load(FONT)
        except Exception:
            pass
        tx.data.size = r * 1.05
        tx.data.extrude = 0.02
        tx.data.align_x = 'CENTER'
        tx.data.align_y = 'CENTER'
        tx.data.materials.append(GOLD_D)
        tx.rotation_euler = rot
        tx.rotation_mode = 'XYZ'
        # place the glyph on the coin face (local +Z of the cylinder)
        n = Vector((0, 0, 1))
        n.rotate(tx.rotation_euler)
        tx.location = Vector(loc) + n * 0.055 * side
        if side < 0:
            tx.rotation_euler.y += math.pi
    return c


coin((-1.75, -0.6, 0.75), (math.radians(80), math.radians(-25), math.radians(15)))
coin((1.85, -0.3, 1.05), (math.radians(70), math.radians(30), math.radians(-20)), r=0.36)
coin((1.65, -0.9, -0.55), (math.radians(95), math.radians(20), math.radians(40)), r=0.3)

# ---------------- backdrop ----------------
bg_a, bg_b = ('#ffd84d', '#ff9f1c') if THEME == 'amber' else ('#3b4fa8', '#121733')
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 4.0, 0), rotation=(math.radians(90), 0, 0))
plane = bpy.context.object
pm = bpy.data.materials.new('backdrop')
pm.use_nodes = True
nt = pm.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
outn = nt.nodes.new('ShaderNodeOutputMaterial')
emis = nt.nodes.new('ShaderNodeEmission')
ramp = nt.nodes.new('ShaderNodeValToRGB')
grad = nt.nodes.new('ShaderNodeTexGradient')
grad.gradient_type = 'SPHERICAL'
mapn = nt.nodes.new('ShaderNodeMapping')
tc = nt.nodes.new('ShaderNodeTexCoord')
mapn.inputs['Scale'].default_value = (0.19, 0.19, 0.19)
mapn.inputs['Location'].default_value = (0.0, 0.03, 0)
ramp.color_ramp.elements[0].color = srgb(bg_b)
ramp.color_ramp.elements[1].color = srgb(bg_a)
emis.inputs['Strength'].default_value = 1.0
ramp.color_ramp.elements[1].position = 0.45
nt.links.new(tc.outputs['Object'], mapn.inputs['Vector'])
nt.links.new(mapn.outputs['Vector'], grad.inputs['Vector'])
nt.links.new(grad.outputs['Color'], ramp.inputs['Fac'])
nt.links.new(ramp.outputs['Color'], emis.inputs['Color'])
nt.links.new(emis.outputs['Emission'], outn.inputs['Surface'])
plane.data.materials.append(pm)
plane.visible_shadow = False

world = bpy.data.worlds.new('w')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = srgb('#ffe9b0' if THEME == 'amber' else '#2a3570')
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35

# ---------------- lights ----------------
def area(name, loc, target, energy, size, color='#ffffff'):
    ld = bpy.data.lights.new(name, 'AREA')
    ld.energy = energy
    ld.size = size
    ld.color = srgb(color)[:3]
    lo = bpy.data.objects.new(name, ld)
    scene.collection.objects.link(lo)
    lo.location = loc
    d = Vector(target) - Vector(loc)
    lo.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    return lo


area('key', (-3.5, -5.0, 3.0), (0, 0, 0), 1100, 4.0, '#fff1de')
area('fill', (4.5, -4.0, 0.5), (0, 0, 0), 260, 5.0, '#dbe9ff')
area('rim_l', (-3.0, 3.0, 2.5), (0, 0, 0.2), 1100, 2.0, '#fff4d6')
area('rim_r', (3.2, 3.0, 2.0), (0, 0, 0.2), 1000, 2.0, '#ffe2b8')
area('top', (0, -1.0, 6.0), (0, 0, 0), 300, 3.0)

# ---------------- camera ----------------
cam_d = bpy.data.cameras.new('cam')
cam_d.lens = 70
cam_d.dof.use_dof = True
cam_d.dof.aperture_fstop = 4.0
cam = bpy.data.objects.new('cam', cam_d)
scene.collection.objects.link(cam)
cam.location = (0.35, -10.2, 0.1)
focus = bpy.data.objects.new('focus', None)
scene.collection.objects.link(focus)
focus.location = (0, -0.9, 0.05)
cam_d.dof.focus_object = focus
aim = Vector((0, 0, -0.25)) - cam.location
cam.rotation_euler = aim.to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam

# ---------------- render ----------------
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = SAMPLES
scene.cycles.use_denoising = True
scene.render.resolution_x = 1080
scene.render.resolution_y = 1080
scene.render.film_transparent = False
try:
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'None'
except Exception:
    pass
scene.render.image_settings.file_format = 'PNG'
scene.render.filepath = OUT
bpy.ops.render.render(write_still=True)
print('saved', OUT)
