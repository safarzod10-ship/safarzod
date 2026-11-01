"""Cycles CPU review renders of a GLB (Blender background).

  blender -b --factory-startup --python tools/blender/render_views.py -- <in.glb> <out_dir> <prefix> [WxH] [samples] [views]

Views are defined as fractions of the model bounding box (front = -Y in Blender,
i.e. +Z in glTF, the direction the statue faces), so the old and the current
monument (different sizes) are framed comparably. Sun + Nishita sky, Filmic-free
'Standard' view transform with AgX would hide clipping; we use AgX (Blender
default) for neutral review images. Real renders, no post-processing.
"""
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
glb, out_dir, prefix = Path(argv[0]), Path(argv[1]), argv[2]
W, H = (int(v) for v in (argv[3] if len(argv) > 3 else "1280x720").split("x"))
SAMPLES = int(argv[4]) if len(argv) > 4 else 48
ONLY = argv[5].split(",") if len(argv) > 5 else None

# name: (camera position in bbox fractions (x, y, z), target in bbox fractions, lens mm)
# bbox fractions: x 0..1 left->right, y 0 = front (-Y) .. 1 = back, z 0..1 bottom->top
VIEWS = {
    "overview":       ((1.05, -1.25, 0.30), (0.5, 0.45, 0.42), 26),
    "front":          ((0.5, -1.25, 0.20), (0.5, 0.5, 0.45), 30),
    "statue":         ((0.60, 0.02, 0.32), (0.5, 0.62, 0.38), 35),
    "statue_face":    ((0.53, 0.30, 0.47), (0.5, 0.66, 0.47), 60),
    "arch_inner":     ((0.5, 0.35, 0.45), (0.5, 0.55, 0.80), 24),
    "crown":          ((0.70, -0.30, 1.05), (0.5, 0.40, 0.95), 50),
    "lion":           ((0.12, -0.05, 0.16), (0.12, 0.22, 0.13), 40),
    "columns":        ((0.97, 0.05, 0.22), (0.85, 0.30, 0.25), 30),
    "steps":          ((0.40, -0.12, 0.05), (0.50, 0.25, 0.08), 28),
}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(glb))
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
size = hi - lo
print("BBOX", tuple(round(v, 2) for v in lo), tuple(round(v, 2) for v in hi))


def frac(f):
    return Vector((lo.x + f[0] * size.x, lo.y + f[1] * size.y, lo.z + f[2] * size.z))


sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.samples = SAMPLES
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.image_settings.file_format = "JPEG"
sc.render.image_settings.quality = 90
sc.view_settings.view_transform = "AgX"
sc.view_settings.exposure = -1.3

world = bpy.data.worlds.new("Sky")
sc.world = world
world.use_nodes = True
nt = world.node_tree
sky = nt.nodes.new("ShaderNodeTexSky")
sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(38)
sky.sun_rotation = math.radians(215)
sky.sun_intensity = 0.6
nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
nt.nodes["Background"].inputs["Strength"].default_value = 0.35

sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.energy = 4.0
sun_d.angle = math.radians(0.6)
sun = bpy.data.objects.new("Sun", sun_d)
sun.rotation_euler = (math.radians(52), 0, math.radians(215 - 180))
sc.collection.objects.link(sun)

# ground plane (neutral concrete-ish) so contact shadows read
bpy.ops.mesh.primitive_plane_add(size=max(size.x, size.y) * 6, location=(0.5 * (lo.x + hi.x), 0.5 * (lo.y + hi.y), lo.z - 0.005))
g = bpy.context.active_object
gm = bpy.data.materials.new("Ground")
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.30, 0.28, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.85
g.data.materials.append(gm)

cam_d = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam
cam_d.clip_start = 0.05
cam_d.clip_end = 2000
out_dir.mkdir(parents=True, exist_ok=True)
for name, (cp, tp, lens) in VIEWS.items():
    if ONLY and name not in ONLY:
        continue
    p, t = frac(cp), frac(tp)
    cam.location = p
    cam.rotation_euler = (t - p).to_track_quat("-Z", "Y").to_euler()
    cam_d.lens = lens
    sc.render.filepath = str(out_dir / f"{prefix}_{name}.jpg")
    bpy.ops.render.render(write_still=True)
    print("RENDERED", sc.render.filepath, "cam", tuple(round(v, 2) for v in p), "dist_to_target_m", round((t - p).length, 2))
