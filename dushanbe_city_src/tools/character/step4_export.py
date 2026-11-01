"""Step 4: export player.glb (mesh + skin + animations) for Godot.
blender -b --python step4_export.py -- <rig.blend> <out.glb>"""
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0])
for img in bpy.data.images:
    n = img.name.lower()
    if ('normal' in n or '_rm' in n or 'rough' in n or 'metal' in n) and img.size[0] > 1024:
        img.scale(1024, 1024); print('scaled', img.name)
arm = bpy.data.objects['PlayerArmature']
arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0)
bpy.ops.object.select_all(action='DESELECT')
for o in (arm, bpy.data.objects['PlayerMesh']):
    o.select_set(True)
bpy.ops.export_scene.gltf(filepath=argv[1], export_format='GLB', use_selection=True,
                          export_animations=True, export_animation_mode='ACTIONS',
                          export_force_sampling=True, export_frame_range=False,
                          export_skins=True, export_all_influences=False,
                          export_def_bones=False, export_yup=True, export_apply=False,
                          export_image_format='AUTO', export_jpeg_quality=90)
print('exported', argv[1])
