import bpy, sys, math
from mathutils import Matrix, Quaternion, Euler
argv=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.open_mainfile(filepath=argv[0]); out=argv[1]
arm=bpy.data.objects['PlayerArmature']
def setD(name, ex=0, ey=0, ez=0):
    """armature-space delta rotation (degrees, XYZ euler) -> local quaternion"""
    b=arm.data.bones[name]; R=b.matrix_local.to_3x3()
    D=Euler((math.radians(ex),math.radians(ey),math.radians(ez)),'XYZ').to_matrix()
    q=(R.inverted()@D@R).to_quaternion()
    pb=arm.pose.bones[name]; pb.rotation_mode='QUATERNION'; pb.rotation_quaternion=q
setD('upper_arm.R', -35, 0, 12); setD('forearm.R', -70,0,0)
setD('upper_arm.L', 35, 0, -12); setD('forearm.L', -30,0,0)
setD('thigh.L', -45,0,-8); setD('shin.L', 80,0,0)
setD('thigh.R', 25,0,8); setD('shin.R', 20,0,0); setD('foot.R', -20,0,0)
setD('spine', 8,0,0); setD('spine1',0,0,-10)
sc=bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'
sc.display.shading.light='STUDIO'; sc.display.shading.color_type='TEXTURE'
sc.render.resolution_x=600; sc.render.resolution_y=900
cam=bpy.data.cameras.new('c'); cam.type='ORTHO'; cam.ortho_scale=2.0
co=bpy.data.objects.new('c',cam); sc.collection.objects.link(co); sc.camera=co
arm.hide_render=True
for name,loc,rot in [('front',(0,-5,0.9),(90,0,0)),('side',(5,0,0.9),(90,0,90)),('q',(3.5,-3.5,1.4),(80,0,45))]:
    co.location=loc; co.rotation_euler=[math.radians(r) for r in rot]
    sc.render.filepath=out+'_'+name+'.png'
    bpy.ops.render.render(write_still=True)
