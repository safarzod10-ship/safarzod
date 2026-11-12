"""Step 2: clean up heat weights with anatomical gating rules.
- arm bones only on the sleeve/hand region below the armpit (no hand->robe leaks)
- robe/shirt below the waist: procedural hips/thigh blend (cloth follows legs, back panel shared L/R)
- legs never influence the opposite side
blender -b --python step2_weights.py -- <in.blend> <out.blend>"""
import bpy, sys, os, numpy as np
sys.path.insert(0, os.path.dirname(__file__))
from rig_def import BONES

argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=argv[0])
o = bpy.data.objects['PlayerMesh']; me = o.data
arm = bpy.data.objects['PlayerArmature']
bone_names = [b[0] for b in BONES if b[0] != 'root']
for n in bone_names:
    if n not in o.vertex_groups:
        o.vertex_groups.new(name=n)
gi = {g.name: g.index for g in o.vertex_groups}
names = [g.name for g in o.vertex_groups]
nv = len(me.vertices)
W = np.zeros((nv, len(names)))
for v in me.vertices:
    for g in v.groups:
        W[v.index, g.group] = g.weight
co = np.array([v.co[:] for v in me.vertices])
B = {b[0]: (np.array(b[1]), np.array(b[2])) for b in BONES}

def seg_dist(p, a, b):
    ab = b - a; t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1), t

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)

# --- islands (connected components) for majority voting
import bmesh
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
lab = -np.ones(nv, int); k = 0
for v in bm.verts:
    if lab[v.index] >= 0: continue
    st = [v]; lab[v.index] = k
    while st:
        x = st.pop()
        for e in x.link_edges:
            y = e.other_vert(x)
            if lab[y.index] < 0: lab[y.index] = k; st.append(y)
    k += 1
bm.free()
print('islands', k, 'largest', sorted(np.bincount(lab))[-6:])

def col(n): return gi[n]
for side in ('R', 'L'):
    arm_bones = [f'{n}.{side}' for n in ('upper_arm', 'forearm', 'hand', 'fingers')]
    d_up, _ = seg_dist(co, *B[f'upper_arm.{side}'])
    d_fa, _ = seg_dist(co, *B[f'forearm.{side}'])
    d_h1, _ = seg_dist(co, *B[f'hand.{side}'])
    d_h2, _ = seg_dist(co, *B[f'fingers.{side}'])
    inside = (d_up < 0.105) | (d_fa < 0.11) | (d_h1 < 0.07) | (d_h2 < 0.055)
    # island majority vote
    mask = inside.copy()
    for isl in np.unique(lab):
        idx = np.where(lab == isl)[0]
        if len(idx) > 1500: continue      # big merged shells: per-vertex test only
        f = inside[idx].mean()
        if f > 0.85: mask[idx] = True
        elif f < 0.15: mask[idx] = False
    gated = co[:, 2] < 1.27           # below armpit: hard gating; above: keep heat weights
    sgn = -1 if side == 'R' else 1
    gated &= co[:, 0] * sgn > 0.0
    not_arm = gated & ~mask
    is_arm = gated & mask
    for n in arm_bones:
        W[not_arm, col(n)] = 0.0
    # inside the arm below armpit: only arm bones (+shoulder/spine2 near the top)
    keep = set(arm_bones) | {f'shoulder.{side}', 'spine2'}
    for n in names:
        if n not in keep:
            W[is_arm, col(n)] = 0.0
    top = co[:, 2] > 1.18
    W[is_arm & ~top, col('spine2')] = 0.0
    W[is_arm & ~top, col(f'shoulder.{side}')] = 0.0
    W[is_arm, col(f'upper_arm.{side}')] += 1e-4  # guarantee non-empty
    print(side, 'arm verts', is_arm.sum(), 'non-arm gated', not_arm.sum())
    globals()['ARM_' + side] = mask & (co[:, 2] < 1.30) & (co[:, 0] * sgn > 0.0)

arm_any = ARM_R | ARM_L
# --- cloth below the waist (robe, shirt hem, sash): procedural hips/thigh blend
dl, _ = seg_dist(co, B['thigh.L'][0] + np.array([0, 0, 0.1]), B['thigh.L'][1])
dr, _ = seg_dist(co, B['thigh.R'][0] + np.array([0, 0, 0.1]), B['thigh.R'][1])
radial = np.minimum(dl, dr)
zc = co[:, 2]
cloth = smoothstep(0.095, 0.125, radial) * smoothstep(0.40, 0.44, zc) * (1 - smoothstep(0.95, 1.02, zc))
cloth[arm_any] = 0.0
g = 0.92 * smoothstep(0.95, 0.60, zc)            # share of legs (vs hips)
s = smoothstep(-0.09, 0.09, co[:, 0])           # share of left
Wc = np.zeros_like(W)
Wc[:, col('hips')] = 1 - g
Wc[:, col('thigh.L')] = g * s
Wc[:, col('thigh.R')] = g * (1 - s)
W = W * (1 - cloth[:, None]) + Wc * cloth[:, None]
# trousers / boots: no cross-side leg influence
for side, sgn in (('L', 1), ('R', -1)):
    other = (co[:, 0] * sgn < -0.03) & (cloth < 0.5)
    for n in ('thigh', 'shin', 'foot', 'toe'):
        W[other, col(f'{n}.{side}')] = 0.0
    # nothing below the knee region belongs to the spine/arms
low = zc < 0.42
for n in names:
    if not any(n.startswith(p) for p in ('thigh', 'shin', 'foot', 'toe')):
        W[low, col(n)] = 0.0
# normalize
s_ = W.sum(1); bad = s_ < 1e-6
print('empty after gating', bad.sum())
W[bad, col('hips')] = 1.0; s_ = W.sum(1)
W /= s_[:, None]

for g_ in o.vertex_groups:
    o.vertex_groups.remove(g_)
for n in names:
    o.vertex_groups.new(name=n)
for j, n in enumerate(names):
    vg = o.vertex_groups[n]
    nz = np.where(W[:, j] > 1e-4)[0]
    for i in nz:
        vg.add([int(i)], float(W[i, j]), 'REPLACE')

bpy.context.view_layer.objects.active = o
o.select_set(True)
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.5, repeat=2)
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_as_mainfile(filepath=argv[1])
print('weights done')
