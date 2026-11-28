"""
TERRIA clouds: a few puffy cumulus sprites in the game's camera and light.

  blender -b --python tools/blender/clouds.py -- <outDir> [count] [resolution] [samples]

Each cloud is a cluster of smooth, soft-shaded balls (a stylised cumulus with
a flat-ish base), white in the sun and slightly blue in its own shade, on a
transparent background. Written as cloud_<n>.png.
"""
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import kit  # noqa: E402
from mathutils import Vector  # noqa: E402

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if argv else 'clouds')
COUNT = int(argv[1]) if len(argv) > 1 else 4
RES = int(argv[2]) if len(argv) > 2 else 768
SAMPLES = int(argv[3]) if len(argv) > 3 else 96
os.makedirs(OUT, exist_ok=True)


def cloud_material():
    m = bpy.data.materials.new('cloud')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*kit.hexc('#ffffff'), 1)
    b.inputs['Roughness'].default_value = 1.0
    b.inputs['Subsurface Weight'].default_value = 0.6
    b.inputs['Subsurface Radius'].default_value = (1.0, 1.0, 1.3)
    b.inputs['Subsurface Scale'].default_value = 10.0
    b.inputs['Specular IOR Level'].default_value = 0.0
    # a little light of its own: clouds are bright even on their shaded side
    b.inputs['Emission Color'].default_value = (*kit.hexc('#eaf2ff'), 1)
    b.inputs['Emission Strength'].default_value = 0.28
    return m


for n in range(COUNT):
    kit.reset_scene()
    sc = bpy.context.scene
    sc.cycles.samples = SAMPLES
    sc.view_settings.exposure = 0.55
    kit.setup_world(1.25)
    kit.setup_sun(energy=4.0, angle_deg=10.0, color=(1.0, 0.97, 0.92))
    # a cloud about 140 m across: the camera frames a "lot" of 8 cells
    kit.setup_camera(8, res=RES, margin=1.0, lift=0.0)
    mat = cloud_material()
    rng = random.Random(1000 + n)
    balls = []
    length = rng.uniform(80, 120)
    width = rng.uniform(40, 60)
    for i in range(rng.randint(14, 20)):
        u = rng.uniform(-0.5, 0.5)
        x = u * length
        y = rng.uniform(-0.5, 0.5) * width * (1 - abs(u))
        # bigger and higher in the middle: a cumulus dome on a flat base
        r = rng.uniform(13, 22) * (1.15 - abs(u) * 0.7)
        z = r * rng.uniform(0.25, 0.55) + (1 - abs(u) * 2) * 8
        balls.append((x, y, z, r))
    for (x, y, z, r) in balls:
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=r, location=(x, y, z))
        ob = bpy.context.active_object
        ob.scale.z = 0.82
        bpy.ops.object.shade_smooth()
        ob.data.materials.append(mat)
    # one soft surface: merge the balls, re-mesh them as a single volume and
    # smooth away the seams between them
    meshes = [ob for ob in sc.objects if ob.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.join()
    cloud = bpy.context.active_object
    rm = cloud.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = 1.4
    sm = cloud.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 1.0
    sm.iterations = 14
    bpy.ops.object.shade_smooth()
    # turn the cloud so they are not all aligned the same way
    cloud.rotation_euler.z = rng.uniform(0, math.pi)
    path = os.path.join(OUT, f'cloud_{n}.png')
    kit.render(path)
    print('rendered', path)
