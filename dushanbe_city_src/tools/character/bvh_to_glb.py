"""Blender: convert CMU (cgspeed) BVH clips to GLB (armature + animation only) for Godot retargeting.
blender -b --python bvh_to_glb.py -- <out_dir> <clip.bvh> [...]"""
import bpy, sys, os
argv = sys.argv[sys.argv.index("--") + 1:]
out_dir, files = argv[0], argv[1:]
os.makedirs(out_dir, exist_ok=True)
for f in files:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # cgspeed CMU units: ~0.0585 m per unit (hip joint height 16.3 units ~ 0.95 m)
    bpy.ops.import_anim.bvh(filepath=f, global_scale=0.0585, frame_start=1, use_fps_scale=False,
                            update_scene_fps=True, update_scene_duration=True, rotate_mode='NATIVE',
                            axis_forward='-Z', axis_up='Y')
    arm = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE'][0]
    act = arm.animation_data.action
    name = os.path.splitext(os.path.basename(f))[0]
    act.name = "cmu_" + name
    sc = bpy.context.scene
    fr = act.frame_range
    sc.frame_start, sc.frame_end = int(fr[0]), int(fr[1])
    out = os.path.join(out_dir, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True,
                              export_frame_range=True, export_force_sampling=True, export_optimize_animation_size=False,
                              export_anim_single_armature=True, export_current_frame=False, export_def_bones=False,
                              export_skins=True, export_yup=True, export_animation_mode='ACTIONS')
    print("CONVERTED", name, "fps", sc.render.fps, "frames", fr[:], "->", out)
