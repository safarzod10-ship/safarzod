"""Preview render: blender -b -P render.py -- in.glb out.png [key=val ...]
keys: yaw (deg, 0 = straight front), pitch (deg), fit (distance factor), wall (y offset behind
bbox, or 'none'), samples, sun_az, sun_el, w, h, target_z (fraction of height to aim at), lens
"""
import bpy, sys, math, os
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
glb, out = argv[0], argv[1]
opt = dict(a.split('=') for a in argv[2:])
f = lambda k, d: float(opt.get(k, d))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEX = os.path.join(ROOT, 'tex')

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=glb)
lift = float(opt.get('lift', 0))
for o in sc.objects:
    if o.parent is None: o.location.z += lift
bpy.context.view_layer.update()
objs = [o for o in sc.objects if o.type == 'MESH']
mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
for o in objs:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
size = mx - mn
if opt.get('checkbf'):
    for m in bpy.data.materials:
        nt = m.node_tree; outn = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
        src = outn.inputs['Surface'].links[0].from_socket
        geo = nt.nodes.new('ShaderNodeNewGeometry'); em = nt.nodes.new('ShaderNodeEmission')
        em.inputs['Color'].default_value = (1, 0, 0, 1); em.inputs['Strength'].default_value = 5
        mix = nt.nodes.new('ShaderNodeMixShader')
        nt.links.new(geo.outputs['Backfacing'], mix.inputs[0]); nt.links.new(src, mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], outn.inputs['Surface'])
ctr = (mn + mx) / 2

def tex_mat(name, tex, scale, tint=(1, 1, 1), rough_add=0.0, wash=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping')
    mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs['Object'], mp.inputs[0])
    def img(kind, nc):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(os.path.join(TEX, f'{tex}_{kind}.jpg'), check_existing=True)
        if nc: t.image.colorspace_settings.name = 'Non-Color'
        t.projection = 'BOX'; t.projection_blend = 0.2
        nt.links.new(mp.outputs[0], t.inputs[0]); return t
    c = img('col', False)
    mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'
    mix.inputs['Factor'].default_value = 1.0
    nt.links.new(c.outputs[0], mix.inputs['A']); mix.inputs['B'].default_value = (*tint, 1)
    res = mix.outputs['Result']
    if wash:
        w2 = nt.nodes.new('ShaderNodeMix'); w2.data_type = 'RGBA'; w2.blend_type = 'MIX'
        w2.inputs['Factor'].default_value = wash[3]
        nt.links.new(res, w2.inputs['A']); w2.inputs['B'].default_value = (*wash[:3], 1)
        res = w2.outputs['Result']
    nt.links.new(res, b.inputs['Base Color'])
    a = img('arm', True); sp = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(a.outputs[0], sp.inputs[0])
    ma = nt.nodes.new('ShaderNodeMath'); ma.operation = 'ADD'; ma.inputs[1].default_value = rough_add
    nt.links.new(sp.outputs['Green'], ma.inputs[0]); nt.links.new(ma.outputs[0], b.inputs['Roughness'])
    n = img('nrm', True); nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(n.outputs[0], nm.inputs['Color']); nt.links.new(nm.outputs[0], b.inputs['Normal'])
    return m

# ground
bpy.ops.mesh.primitive_plane_add(size=40, location=(ctr.x, ctr.y, 0))
g = bpy.context.object; g.data.materials.append(tex_mat('ground', 'clay_plaster', 0.6, (1, 1, 1), 0.1, wash=(0.30, 0.26, 0.21, 0.45)))
# wall
wall = opt.get('wall', '0.0')
if wall != 'none':
    wy = mx.y + float(wall) + 0.002
    bpy.ops.mesh.primitive_plane_add(size=1, location=(ctr.x, wy, 0))
    w = bpy.context.object
    w.scale = (max(12, size.x * 4), 1, 1); w.rotation_euler = (math.radians(90), 0, 0)
    w.dimensions = (max(12, size.x * 4), max(6, size.z * 2.2), 0)
    w.location.z = max(3, size.z * 1.1)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    w.data.materials.append(tex_mat('wall', 'clay_plaster', 0.45, (1.0, 1.0, 1.0), wash=(0.52, 0.45, 0.36, 0.55)))

# world
wo = bpy.data.worlds.new('w'); sc.world = wo; wo.use_nodes = True
nt = wo.node_tree; bg = nt.nodes['Background']
env = nt.nodes.new('ShaderNodeTexEnvironment'); env.image = bpy.data.images.load(os.path.join(TEX, 'sky.hdr'))
mp = nt.nodes.new('ShaderNodeMapping'); tc = nt.nodes.new('ShaderNodeTexCoord')
mp.inputs['Rotation'].default_value = (0, 0, math.radians(f('sky_rot', 140)))
nt.links.new(tc.outputs['Generated'], mp.inputs[0]); nt.links.new(mp.outputs[0], env.inputs[0])
nt.links.new(env.outputs[0], bg.inputs[0]); bg.inputs[1].default_value = f('sky', 0.55)

# sun: warm afternoon
bpy.ops.object.light_add(type='SUN')
sun = bpy.context.object; sun.data.energy = f('sun', 4.2); sun.data.color = (1.0, 0.86, 0.70)
sun.data.angle = math.radians(1.2)
az = math.radians(f('sun_az', -35)); el = math.radians(f('sun_el', 34))
# light direction: comes from azimuth az (0 = from the front/-Y), elevation el
d = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
sun.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()

# camera
yaw = math.radians(f('yaw', 32)); pitch = math.radians(f('pitch', 8))
cam_d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
bpy.ops.object.camera_add(); cam = bpy.context.object; sc.camera = cam
cam.data.lens = f('lens', 40)
tgt = Vector((ctr.x, ctr.y, mn.z + size.z * f('target_z', 0.48)))
rad = max(size.length / 2, 0.3)
fov = 2 * math.atan(13.5 / cam.data.lens)  # vertical fov (36mm sensor, 4:3)
dist = rad / math.tan(fov / 2) * f('fit', 1.05)
cam.location = tgt + cam_d * dist
cam.rotation_euler = (-cam_d).to_track_quat('-Z', 'Y').to_euler()
cam.data.clip_end = 500

sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
sc.cycles.samples = int(f('samples', 48)); sc.cycles.use_denoising = True
sc.cycles.max_bounces = 6
sc.render.resolution_x = int(f('w', 1024)); sc.render.resolution_y = int(f('h', 768))
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
sc.view_settings.exposure = f('exposure', 0.0)
sc.render.filepath = out
sc.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('RENDERED', out, 'bbox', tuple(round(v, 3) for v in size))
