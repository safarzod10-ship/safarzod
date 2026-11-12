"""Quick look at a car GLB in Blender (EEVEE): 3/4 front, side, 3/4 rear.
blender -b --python preview.py -- model.glb out_prefix"""
import bpy, sys, math
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
src, out = a[0], a[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
sc.render.resolution_x, sc.render.resolution_y = 960, 540
w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.66, 0.75, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
bpy.ops.mesh.primitive_plane_add(size=40)
g = bpy.context.object
m = bpy.data.materials.new("g"); m.use_nodes = True
m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.25, 0.25, 0.26, 1)
g.data.materials.append(m)
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(30)))
bpy.context.object.data.energy = 3.5
bpy.ops.object.camera_add()
cam = bpy.context.object
sc.camera = cam
cam.data.lens = 40
for name, pos in (("front", (4.2, 5.2, 1.7)), ("side", (-7.0, 0.0, 1.2)), ("rear", (-4.0, -5.4, 1.9))):
    cam.location = pos
    d = Vector((0, 0, 0.75)) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = "%s_%s.png" % (out, name)
    bpy.ops.render.render(write_still=True)
