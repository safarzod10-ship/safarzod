import bpy, sys, math
OUT = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
D = "/home/user/safarzod/dushanbe_city/assets/weapons/"
for i, (f, z, y) in enumerate([("pistol.glb", 0.45, -0.5), ("ak47.glb", 0.15, 0.1), ("bat.glb", -0.2, 0.1)]):
    bpy.ops.import_scene.gltf(filepath=D + f)
    for o in bpy.context.selected_objects:
        o.location.z += z
        o.location.y += y
bpy.ops.object.camera_add(location=(1.7, -0.2, 0.25), rotation=(math.radians(88), 0, math.radians(90)))
bpy.context.scene.camera = bpy.context.active_object
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(40), math.radians(20), math.radians(30)))
bpy.context.active_object.data.energy = 4
w = bpy.data.worlds.new("w"); w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.6, 0.65, 0.7, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 0.8
bpy.context.scene.world = w
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.samples = 24; sc.cycles.device = "CPU"
sc.render.resolution_x = 1200; sc.render.resolution_y = 800
sc.render.filepath = OUT
bpy.ops.render.render(write_still=True)
