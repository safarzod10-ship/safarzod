"""Step 1: import source mesh, clean + decimate, build armature, bind with heat weights.
blender -b --python step1_rig.py -- <out.blend> [ratio]"""
import bpy, bmesh, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from rig_def import BONES
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/home/user/safarzod/dushanbe_city_src/blend/player_rig_step1.blend'
RATIO = float(argv[1]) if len(argv) > 1 else 0.47
SRC = '/home/user/safarzod/assets/characters/main_character/main_character.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
mesh_obj = bpy.data.objects['MainCharacter_Mesh']
# unparent from the empty and apply transforms
mw = mesh_obj.matrix_world.copy()
mesh_obj.parent = None
mesh_obj.matrix_world = mw
for o in list(bpy.data.objects):
    if o.type == 'EMPTY':
        bpy.data.objects.remove(o)
bpy.context.view_layer.objects.active = mesh_obj
mesh_obj.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh_obj.name = 'PlayerMesh'
mesh_obj.data.name = 'PlayerMesh'

me = mesh_obj.data
# drop imported custom normals (would be invalid after decimation)
if me.has_custom_normals:
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
bm.to_mesh(me); bm.free()
print('merged verts', len(me.vertices), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))

if RATIO < 1.0:
    mod = mesh_obj.modifiers.new('dec', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = RATIO
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier='dec')
for p in me.polygons:
    p.use_smooth = True
print('final verts', len(me.vertices), 'tris', sum(len(p.vertices) - 2 for p in me.polygons))

# armature
arm_data = bpy.data.armatures.new('PlayerArmature')
arm = bpy.data.objects.new('PlayerArmature', arm_data)
bpy.context.scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
for name, h, t, par, conn in BONES:
    b = eb.new(name)
    b.head = Vector(h); b.tail = Vector(t)
for name, h, t, par, conn in BONES:
    b = eb[name]
    if par:
        b.parent = eb[par]
        b.use_connect = conn
    # roll: keep X axis pointing to character's right/left consistently (+X world) for hinge bones
    b.align_roll(Vector((0, -1, 0)) if abs(b.vector.normalized().y) < 0.9 else Vector((0, 0, 1)))
for b in eb:
    b.use_deform = b.name != 'root'
bpy.ops.object.mode_set(mode='OBJECT')

# heat weights
bpy.ops.object.select_all(action='DESELECT')
mesh_obj.select_set(True); arm.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
vg = mesh_obj.vertex_groups
unweighted = sum(1 for v in me.vertices if not any(g.weight > 1e-4 for g in v.groups))
print('HEAT unweighted verts:', unweighted, '/', len(me.vertices))
bpy.ops.wm.save_as_mainfile(filepath=OUT)
