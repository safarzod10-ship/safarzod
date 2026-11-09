"""Ismoili Somoni monument (Dushanbe, Dusti square) for DUSHANBE-X - own work, CC0.
Built from the reference photos supplied by the project owner: stepped octagonal red-granite base
with stairs, granite pedestal with the gilded name, four golden lions, white marble arch with gilded
ornament panels and a gilded crown on top, the gilded statue (the game's hero model, posed: right
hand raising the sceptre with a crown; crowned head). Real scale (~42 m).
Front = Blender +Y (Godot -Z).

  blender -b --python somoni_monument.py -- <out.glb>
"""
import bpy, bmesh, math, sys
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index("--") + 1]
PLAYER = "/home/user/safarzod/dushanbe_city/assets/characters/player/player.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, col, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


MARBLE = mat("marble", (0.9, 0.88, 0.83), 0.0, 0.32)
GRANITE = mat("granite", (0.42, 0.2, 0.16), 0.0, 0.45)
GRANITE_D = mat("granite_dark", (0.3, 0.14, 0.11), 0.0, 0.4)
GOLD = mat("gold", (1.0, 0.74, 0.3), 1.0, 0.26)
PAVE = mat("paving", (0.62, 0.55, 0.5), 0.0, 0.8)

objs = []


def add(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)
    objs.append(o)
    return o


def box(size, loc, m, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    return add(o, m)


def cyl(r, h, loc, m, verts=24, r2=None, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=loc, rotation=rot)
    o = bpy.context.object
    bpy.ops.object.transform_apply(rotation=True)
    return add(o, m)


def sphere(r, loc, m, scale=(1, 1, 1), seg=16):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    o = bpy.context.object
    o.scale = scale
    bpy.ops.object.transform_apply(scale=True)
    return add(o, m)


def octagon(rad, h, z, m):
    return cyl(rad, h, (0, 0, z + h / 2), m, verts=8, rot=(0, 0, math.pi / 8))


# ------------------------------------------------------------------ base: three octagonal tiers + stairs
octagon(24.0, 0.3, 0.0, PAVE)
for k, (rad, h) in enumerate([(20.0, 1.1), (16.5, 1.1), (13.0, 1.1)]):
    octagon(rad, h, k * 1.1, GRANITE)
    octagon(rad + 0.15, 0.12, k * 1.1 + h - 0.06, GRANITE_D)          # cornice line
TOP = 3.3
for sgn in (1, -1):                                                    # stairs front and back
    for s in range(11):
        z = s * 0.3
        box((10.0, 0.45, 0.3), (0, sgn * (21.5 - s * 0.82), z + 0.15), GRANITE)
    for sx in (-1, 1):
        box((0.9, 9.5, 1.6), (sx * 5.45, sgn * 17.6, 0.8), GRANITE_D)   # balustrade blocks

# ------------------------------------------------------------------ pedestal with the name
box((8.4, 7.4, 1.0), (0, 0.6, TOP + 0.5), GRANITE_D)
box((7.4, 6.4, 5.4), (0, 0.6, TOP + 1.0 + 2.7), GRANITE)
box((8.0, 7.0, 0.6), (0, 0.6, TOP + 6.4 + 0.3), GRANITE_D)
PED_TOP = TOP + 7.0
bpy.ops.object.text_add(location=(0, 0.6 + 3.21, TOP + 3.9), rotation=(math.pi / 2, 0, math.pi))
t = bpy.context.object
t.data.body = "ИСМОИЛИ\nСОМОНӢ"
t.data.align_x = 'CENTER'
t.data.align_y = 'CENTER'
t.data.size = 0.95
t.data.extrude = 0.04
t.data.space_line = 1.1
bpy.ops.object.convert(target='MESH')
t = bpy.context.object
t.rotation_euler = (math.pi / 2, 0, 0)
bpy.ops.object.transform_apply(rotation=True)
# read from the front (+Y): turn the letters about the vertical through the text centre
cen = sum((v.co for v in t.data.vertices), Vector()) / max(len(t.data.vertices), 1)
t.data.transform(Matrix.Translation(cen) @ Matrix.Rotation(math.pi, 4, 'Z') @ Matrix.Translation(-cen))
add(t, GOLD)

# ------------------------------------------------------------------ the arch
PX = 8.2          # pillar centre x
PY = -2.6         # behind the statue
PW = 3.0
P_TOP = 30.0
for sx in (-1, 1):
    box((PW, PW, P_TOP - TOP), (sx * PX, PY, TOP + (P_TOP - TOP) / 2), MARBLE)
    box((PW + 0.6, PW + 0.6, 1.4), (sx * PX, PY, TOP + 0.7), MARBLE)             # plinth
    box((PW + 0.4, PW + 0.4, 0.6), (sx * PX, PY, P_TOP - 0.3), MARBLE)          # capital
    # gilded ornament panels on the front, back and inner faces + a lattice of gold rhombi
    for fy in (1, -1):
        box((1.5, 0.08, P_TOP - TOP - 3.0), (sx * PX, PY + fy * (PW / 2 + 0.02), TOP + (P_TOP - TOP) / 2), GOLD)
        for k in range(18):
            z = TOP + 2.4 + k * 1.35
            box((0.55, 0.12, 0.55), (sx * PX, PY + fy * (PW / 2 + 0.06), z), MARBLE, rot=(0, math.pi / 4, 0))
    box((0.08, 1.4, P_TOP - TOP - 3.0), (sx * (PX - PW / 2 - 0.02), PY, TOP + (P_TOP - TOP) / 2), GOLD)


def arch_ring(cx, cz, r_in, r_out, depth, y, m, seg=40, a0=0.0, a1=math.pi):
    bm = bmesh.new()
    rings = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        c, s = math.cos(a), math.sin(a)
        ring = []
        for (r, dy) in ((r_in, -depth / 2), (r_out, -depth / 2), (r_out, depth / 2), (r_in, depth / 2)):
            ring.append(bm.verts.new((cx + c * r, y + dy, cz + s * r)))
        rings.append(ring)
    for i in range(seg):
        for j in range(4):
            a, b = rings[i][j], rings[i][(j + 1) % 4]
            c2, d = rings[i + 1][(j + 1) % 4], rings[i + 1][j]
            bm.faces.new((a, b, c2, d))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    me = bpy.data.meshes.new("arch")
    bm.to_mesh(me)
    o = bpy.data.objects.new("arch", me)
    bpy.context.collection.objects.link(o)
    return add(o, m)


R_MID = PX
arch_ring(0, P_TOP, R_MID - PW / 2, R_MID + PW / 2, PW, PY, MARBLE)
arch_ring(0, P_TOP, R_MID - PW / 2 - 0.05, R_MID - PW / 2 + 0.25, 1.5, PY, GOLD)         # gilded inner rim
for fy in (1, -1):
    arch_ring(0, P_TOP, R_MID - 0.75, R_MID + 0.75, 0.1, PY + fy * (PW / 2 + 0.03), GOLD)  # front / back bands
ARCH_TOP = P_TOP + R_MID + PW / 2

# ------------------------------------------------------------------ crown on the top of the arch
CZ = ARCH_TOP - 0.3
cyl(2.6, 1.2, (0, PY, CZ + 0.6), GOLD, verts=32)
cyl(2.75, 0.3, (0, PY, CZ + 0.15), GOLD, verts=32)
for k in range(8):
    a = k * math.tau / 8
    x, y = math.cos(a) * 2.4, PY + math.sin(a) * 2.4
    cyl(0.5, 2.6 if k % 2 == 0 else 1.8, (x, y, CZ + 1.2 + (1.3 if k % 2 == 0 else 0.9)), GOLD, verts=8, r2=0.05)
    sphere(0.28, (x, y, CZ + 1.2 + (2.65 if k % 2 == 0 else 1.85)), GOLD, seg=10)
sphere(1.9, (0, PY, CZ + 1.2), GOLD, scale=(1, 1, 0.9))
sphere(0.6, (0, PY, CZ + 3.4), GOLD)
cyl(0.12, 1.4, (0, PY, CZ + 4.4), GOLD, verts=8)

# ------------------------------------------------------------------ four golden lions


def lion(x, y, face):
    """sitting lion facing `face` (radians about Z; 0 = +Y), ~3.2 m high"""
    parts = []
    def P(o):
        parts.append(o)
        return o
    P(sphere(1.0, (0, -0.6, 1.25), GOLD, scale=(1.0, 1.5, 0.95)))       # haunches / body
    P(sphere(0.9, (0, 0.5, 1.75), GOLD, scale=(0.95, 0.9, 1.25)))       # chest
    P(sphere(0.95, (0, 0.85, 2.75), GOLD, scale=(1.15, 0.9, 1.05)))     # mane
    P(sphere(0.55, (0, 1.35, 2.8), GOLD, scale=(1.0, 1.1, 1.0)))        # face
    P(box((0.5, 0.45, 0.4), (0, 1.8, 2.6), GOLD))                      # muzzle
    for sx in (-1, 1):
        P(cyl(0.2, 1.6, (sx * 0.38, 0.95, 0.85), GOLD, verts=10))       # front legs
        P(sphere(0.25, (sx * 0.38, 1.1, 0.1), GOLD, scale=(1, 1.5, 0.6)))
        P(sphere(0.6, (sx * 0.6, -0.9, 0.7), GOLD, scale=(0.7, 1.3, 0.9)))   # hind legs
        P(sphere(0.22, (sx * 0.5, 1.35, 3.3), GOLD))                    # ears
    P(cyl(0.12, 1.8, (0.55, -1.9, 0.5), GOLD, verts=8, rot=(1.2, 0, 0.4)))   # tail
    P(box((2.4, 3.6, 0.5), (0, -0.1, -0.25), GRANITE_D))                # its plinth
    for o in parts:
        o.location = Vector((0, 0, 0))
    # move the whole lion: rotate verts, then translate
    for o in parts:
        o.data.transform(Matrix.Scale(1.5, 4))
        o.data.transform(Matrix.Rotation(face, 4, 'Z'))
        o.data.transform(Matrix.Translation((x, y, TOP + 0.5)))


for (lx, ly, f) in [(-7.2, 7.0, 0.25), (7.2, 7.0, -0.25), (-7.2, -10.0, math.pi - 0.25), (7.2, -10.0, math.pi + 0.25)]:
    lion(lx, ly, f)

# ------------------------------------------------------------------ the statue (hero model, gilded)
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=PLAYER)
new = [o for o in bpy.data.objects if o not in before]
arm = next(o for o in new if o.type == 'ARMATURE')
body = next(o for o in new if o.type == 'MESH' and o.name.startswith("Player"))
for o in list(new):
    if o.type == 'MESH' and o is not body:
        new.remove(o)
        bpy.data.objects.remove(o, do_unlink=True)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')


def point_bone(name, target):
    pb = arm.pose.bones[name]
    bpy.context.view_layer.update()
    head = pb.head.copy()
    cur = (pb.tail - pb.head).normalized()
    q = cur.rotation_difference(Vector(target).normalized())
    R = q.to_matrix().to_4x4()
    pb.matrix = Matrix.Translation(head) @ R @ Matrix.Translation(-head) @ pb.matrix
    bpy.context.view_layer.update()


# armature space: find which way the model faces (toes ahead of the heels)
bpy.context.view_layer.update()
fwd = (arm.pose.bones["toe.R"].tail - arm.pose.bones["foot.R"].head)
fwd.z = 0
fwd.normalize()
side_r = (arm.pose.bones["upper_arm.R"].head - arm.pose.bones["spine2"].head)
side_r.z = 0
side_r.normalize()
# right arm raised high, a little forward and out; forearm continues; left hand at the belt
point_bone("upper_arm.R", Vector((0, 0, 1)) * 1.0 + side_r * 0.28 + fwd * 0.12)
point_bone("forearm.R", Vector((0, 0, 1)) * 1.0 + side_r * 0.1 + fwd * 0.08)
point_bone("hand.R", Vector((0, 0, 1)))
for sd, sgn in (("R", 1.0), ("L", -1.0)):
    point_bone("thigh." + sd, Vector((0, 0, -1)) + side_r * 0.05 * sgn)
    point_bone("shin." + sd, Vector((0, 0, -1)) + side_r * 0.03 * sgn + fwd * 0.02)
point_bone("upper_arm.L", Vector((0, 0, -1)) * 1.0 - side_r * 0.15 + fwd * 0.12)
point_bone("forearm.L", fwd * 1.0 - side_r * 0.25 + Vector((0, 0, -0.1)))
bpy.ops.object.mode_set(mode='OBJECT')
hand = arm.matrix_world @ arm.pose.bones["hand.R"].tail
head_top = arm.matrix_world @ arm.pose.bones["head"].tail
bpy.context.view_layer.update()
dg = bpy.context.evaluated_depsgraph_get()
ev = body.evaluated_get(dg)
me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=False, depsgraph=dg)
me.transform(body.matrix_world)
statue = bpy.data.objects.new("statue", me)
bpy.context.collection.objects.link(statue)
for o in new:
    bpy.data.objects.remove(o, do_unlink=True)
add(statue, GOLD)
# crown on the head + the sceptre with a crown in the raised hand (in model units)
crown_parts = [cyl(0.11, 0.08, (head_top.x, head_top.y, head_top.z - 0.02), GOLD, verts=16)]
for k in range(6):
    a = k * math.tau / 6
    crown_parts.append(cyl(0.035, 0.12, (head_top.x + math.cos(a) * 0.1, head_top.y + math.sin(a) * 0.1, head_top.z + 0.07), GOLD, verts=6, r2=0.005))
sc = [cyl(0.018, 0.75, (hand.x, hand.y, hand.z + 0.3), GOLD, verts=8)]
sc.append(cyl(0.07, 0.06, (hand.x, hand.y, hand.z + 0.7), GOLD, verts=12))
for k in range(5):
    a = k * math.tau / 5
    sc.append(cyl(0.025, 0.11, (hand.x + math.cos(a) * 0.06, hand.y + math.sin(a) * 0.06, hand.z + 0.78), GOLD, verts=6, r2=0.004))
sc.append(sphere(0.035, (hand.x, hand.y, hand.z + 0.82), GOLD, seg=8))
# scale the figure (feet at z = 0) to 11 m, face +Y, stand on the pedestal
fig = [statue] + crown_parts + sc
zmin = min((statue.matrix_world @ v.co).z for v in statue.data.vertices)
h = max((statue.matrix_world @ v.co).z for v in statue.data.vertices) - zmin
S = 19.0 / h
ang = math.atan2(fwd.x, fwd.y)            # rotate model forward onto +Y
for o in fig:
    o.data.transform(Matrix.Translation((0, 0, -zmin)))
    o.data.transform(Matrix.Rotation(ang, 4, 'Z'))
    o.data.transform(Matrix.Scale(S, 4))
    o.data.transform(Matrix.Translation((0, 0.9, PED_TOP)))
    o.location = (0, 0, 0)

# ------------------------------------------------------------------ join per material, export
bpy.ops.object.select_all(action='DESELECT')
by_mat = {}
for o in objs:
    if o.name not in bpy.data.objects:
        continue
    by_mat.setdefault(o.data.materials[0].name, []).append(o)
for mname, group in by_mat.items():
    bpy.ops.object.select_all(action='DESELECT')
    for o in group:
        o.select_set(True)
    bpy.context.view_layer.objects.active = group[0]
    bpy.ops.object.join()
    bpy.context.object.name = "somoni_" + mname
for o in bpy.data.objects:
    if o.type == 'MESH':
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.select_all(action='DESELECT')
        o.select_set(True)
        bpy.ops.object.shade_flat()
tris = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
dims = [o.dimensions for o in bpy.data.objects if o.type == 'MESH']
print("SOMONI faces %d, objects %d" % (tris, len(dims)))
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True)
print("SOMONI written", OUT)
