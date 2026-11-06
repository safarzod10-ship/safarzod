import bpy, sys, math
argv=sys.argv[sys.argv.index('--')+1:]
src=argv[0]; out=argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
if src.endswith('.blend'):
    bpy.ops.wm.open_mainfile(filepath=src)
else:
    bpy.ops.import_scene.gltf(filepath=src)
sc=bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'
sc.display.shading.light='STUDIO'; sc.display.shading.color_type='TEXTURE'
sc.render.resolution_x=600; sc.render.resolution_y=900
cam=bpy.data.cameras.new('c'); cam.type='ORTHO'; cam.ortho_scale=2.0
co=bpy.data.objects.new('c',cam); sc.collection.objects.link(co); sc.camera=co
for name,loc,rot in [('front',(0,-5,0.9),(90,0,0)),('side',(5,0,0.9),(90,0,90)),('back',(0,5,0.9),(90,0,180))]:
    co.location=loc; co.rotation_euler=[math.radians(r) for r in rot]
    sc.render.filepath=out+'_'+name+'.png'
    bpy.ops.render.render(write_still=True)
