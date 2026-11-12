"""Measure ground contact / foot sliding of the authored animations on the deformed mesh, and
render contact sheets.  blender -b --python eval_anims.py -- <rig.blend> <outdir> [render]"""
import bpy, sys, os, math, json
import numpy as np
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0]); OUT = argv[1]; RENDER = len(argv) > 2
os.makedirs(OUT, exist_ok=True)
arm = bpy.data.objects['PlayerArmature']; mesh = bpy.data.objects['PlayerMesh']
SPEED = {'walk': 1.40, 'run': 4.0}
gi = {g.name: g.index for g in mesh.vertex_groups}
foot_sets = {}
for s in ('L', 'R'):
    idx = []
    for v in mesh.data.vertices:
        w = sum(g.weight for g in v.groups if mesh.vertex_groups[g.group].name in (f'foot.{s}', f'toe.{s}'))
        if w > 0.6: idx.append(v.index)
    foot_sets[s] = np.array(idx)
sc = bpy.context.scene
res = {}
def mesh_co():
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mesh.evaluated_get(dg)
    m = ev.to_mesh()
    co = np.empty(len(m.vertices) * 3); m.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    return co.reshape(-1, 3)
for name in ('idle', 'walk', 'run', 'jump_start', 'fall', 'land'):
    act = bpy.data.actions[name]; arm.animation_data.action = act
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    v = SPEED.get(name, 0.0)
    prev = None; minz = 9; slide = []; contact_frames = {'L': 0, 'R': 0}; float_ = []
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        co = mesh_co()
        co[:, 1] -= v * f / 30.0           # character moves towards -Y in the world
        minz = min(minz, co[:, 2].min())
        for s in ('L', 'R'):
            fc = co[foot_sets[s]]
            low = fc[:, 2].min()
            if prev is not None:
                pc = prev[foot_sets[s]]
                c = (fc[:, 2] < 0.008) & (pc[:, 2] < 0.008)   # vertices touching the ground in both frames
                if c.sum() >= 5:
                    contact_frames[s] += 1
                    d = (fc[c, :2] - pc[c, :2]); sp = np.linalg.norm(d, axis=1) * 30.0
                    slide.append(float(np.median(sp)))
        prev = co
        # lowest foot point per frame (stance foot should be ~0)
        float_.append(min(co[foot_sets['L'], 2].min(), co[foot_sets['R'], 2].min()))
    res[name] = dict(min_z_mm=round(minz * 1000, 1),
                     lowest_foot_mm_range=[round(min(float_) * 1000, 1), round(max(float_) * 1000, 1)],
                     stance_slide_median_mps=round(float(np.median(slide)), 3) if slide else None,
                     stance_slide_p90_mps=round(float(np.percentile(slide, 90)), 3) if slide else None,
                     contact_frames=contact_frames)
    print(name, res[name])
json.dump(res, open(os.path.join(OUT, 'eval.json'), 'w'), indent=1)

if RENDER:
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'STUDIO'; sc.display.shading.color_type = 'TEXTURE'
    sc.render.resolution_x = 300; sc.render.resolution_y = 450
    cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 2.0
    co_ = bpy.data.objects.new('c', cam); sc.collection.objects.link(co_); sc.camera = co_
    arm.hide_render = True
    # ground line helper: thin plane
    bpy.ops.mesh.primitive_plane_add(size=6, location=(0, 0, -0.001))
    for name in ('walk', 'run', 'idle', 'jump_start', 'fall', 'land'):
        act = bpy.data.actions[name]; arm.animation_data.action = act
        f1 = int(act.frame_range[1])
        frames = np.linspace(0, f1, 8, endpoint=False).astype(int) if f1 > 8 else range(f1 + 1)
        for view, loc, rot in (('side', (5, 0, 0.9), (90, 0, 90)), ('front', (0, -5, 0.9), (90, 0, 0))):
            co_.location = loc; co_.rotation_euler = [math.radians(r) for r in rot]
            paths = []
            for f in frames:
                sc.frame_set(int(f)); p = os.path.join(OUT, f'_{name}_{view}_{f}.png')
                sc.render.filepath = p; bpy.ops.render.render(write_still=True); paths.append(p)
            pass
