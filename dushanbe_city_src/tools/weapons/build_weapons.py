"""Weapons for Dushanbe City, modelled procedurally in Blender (own work, CC0):
pistol (compact polymer-frame 9 mm), AK-type assault rifle (wood furniture), baseball bat.
Each GLB: origin at the hand grip point, barrel / bat tip towards -Y in Blender (= -Z in Godot,
forward), up +Z (= +Y). Metres.
  blender -b -P build_weapons.py -- <out_dir>"""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index("--") + 1]


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, col, metal=0.0, rough=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


def box(name, size, loc, m, bevel=0.002, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.name = name
    o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel > 0:
        md = o.modifiers.new("b", "BEVEL"); md.width = bevel; md.segments = 2; md.limit_method = "ANGLE"
    o.data.materials.append(m)
    return o


def cyl(name, r, depth, loc, m, rot=(math.pi / 2, 0, 0), verts=24, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.name = name
    if bevel > 0:
        md = o.modifiers.new("b", "BEVEL"); md.width = bevel; md.segments = 2
    o.data.materials.append(m)
    return o


def finish(fname):
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            bpy.context.view_layer.objects.active = o
            for md in list(o.modifiers):
                bpy.ops.object.modifier_apply(modifier=md.name)
            o.select_set(True)
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = [o for o in bpy.context.scene.objects if o.type == "MESH"][0]
    bpy.ops.object.join()
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, fname), export_format="GLB", export_apply=True)


# ------------------------------------------------------------------ pistol (grip at origin)
clear()
poly = mat("polymer", (0.045, 0.045, 0.05), 0.0, 0.62)
steel = mat("steel", (0.09, 0.09, 0.1), 0.9, 0.32)
# grip, angled back ~18 deg, origin = where the palm holds it
g = box("grip", (0.032, 0.05, 0.105), (0, 0.012, -0.01), poly, 0.006, rot=(math.radians(-18), 0, 0))
box("frame", (0.03, 0.15, 0.03), (0, -0.045, 0.05), poly, 0.004)
box("slide", (0.03, 0.19, 0.032), (0, -0.06, 0.08), steel, 0.004)
for k in range(7):        # rear serrations
    box("serr%d" % k, (0.031, 0.002, 0.026), (0, 0.012 + k * 0.004, 0.08), steel, 0.0)
cyl("barrel", 0.0065, 0.02, (0, -0.158, 0.078), steel, verts=16)
box("port", (0.031, 0.03, 0.004), (0, -0.03, 0.097), mat("dark", (0.01, 0.01, 0.01), 0.5, 0.4), 0.0)
box("sight_f", (0.004, 0.006, 0.006), (0, -0.148, 0.099), steel, 0.0)
box("sight_r", (0.02, 0.006, 0.006), (0, 0.022, 0.099), steel, 0.0)
# trigger guard + trigger
bpy.ops.mesh.primitive_torus_add(major_radius=0.02, minor_radius=0.0035, location=(0, -0.03, 0.024), rotation=(0, math.pi / 2, 0))
tg = bpy.context.active_object; tg.data.materials.append(poly); tg.scale = (1, 1.2, 0.8)
box("trigger", (0.006, 0.006, 0.02), (0, -0.026, 0.026), steel, 0.001, rot=(math.radians(15), 0, 0))
box("mag_base", (0.034, 0.046, 0.008), (0, 0.03, -0.062), poly, 0.003, rot=(math.radians(-18), 0, 0))
finish("pistol.glb")

# ------------------------------------------------------------------ AK (pistol grip at origin)
clear()
wood = mat("wood", (0.32, 0.14, 0.05), 0.0, 0.55)
steel = mat("steel", (0.08, 0.08, 0.085), 0.85, 0.38)
blk = mat("black", (0.03, 0.03, 0.03), 0.2, 0.6)
box("receiver", (0.045, 0.3, 0.06), (0, -0.08, 0.06), steel, 0.004)
box("cover", (0.04, 0.26, 0.022), (0, -0.07, 0.1), steel, 0.006)
box("grip", (0.03, 0.04, 0.1), (0, 0.02, -0.01), blk, 0.006, rot=(math.radians(-20), 0, 0))
cyl("barrel", 0.011, 0.42, (0, -0.44, 0.07), steel)
cyl("gas", 0.011, 0.26, (0, -0.34, 0.1), steel)
box("guard_lo", (0.05, 0.2, 0.045), (0, -0.33, 0.06), wood, 0.012)
box("guard_hi", (0.042, 0.2, 0.025), (0, -0.33, 0.1), wood, 0.01)
box("fsight", (0.012, 0.02, 0.05), (0, -0.6, 0.095), steel, 0.002)
cyl("muzzle", 0.014, 0.05, (0, -0.665, 0.07), steel)
box("rsight", (0.03, 0.05, 0.02), (0, -0.21, 0.115), steel, 0.002)
# curved magazine: one lofted piece along an arc (the AK "banana" magazine)
bm = bmesh.new()
rings = []
N = 10
for i in range(N + 1):
    t = i / N
    ang = math.radians(10 + 38 * t)                      # forward lean grows downwards
    cy = -0.11 - 0.09 * (1 - math.cos(math.radians(38) * t)) * 2.2 - 0.03 * t
    cz = 0.035 - 0.2 * t
    d = Vector((0, -math.sin(ang), -math.cos(ang)))     # down / forward along the mag
    n = Vector((0, math.cos(ang), -math.sin(ang)))      # front-back of the section
    depth = 0.06 + 0.012 * t
    ring = []
    for (sx, sn) in ((-0.014, -0.5), (0.014, -0.5), (0.014, 0.5), (-0.014, 0.5)):
        ring.append(bm.verts.new(Vector((sx, cy, cz)) + n * sn * depth))
    rings.append(ring)
for a_, b_ in zip(rings[:-1], rings[1:]):
    for k in range(4):
        bm.faces.new((a_[k], a_[(k + 1) % 4], b_[(k + 1) % 4], b_[k]))
bm.faces.new(list(reversed(rings[0])))
bm.faces.new(rings[-1])
me = bpy.data.meshes.new("mag"); bm.to_mesh(me); bm.free()
mo = bpy.data.objects.new("mag", me); bpy.context.collection.objects.link(mo)
md = mo.modifiers.new("b", "BEVEL"); md.width = 0.003; md.segments = 2; md.limit_method = "ANGLE"
mo.data.materials.append(steel)
# stock: tapered wooden block
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0.22, 0.05))
st = bpy.context.active_object; st.scale = (0.045, 0.32, 0.06); bpy.ops.object.transform_apply(scale=True)
bm = bmesh.new(); bm.from_mesh(st.data)
for v in bm.verts:
    if v.co.y > 0.3:
        v.co.z = v.co.z * 2.1 - 0.06
bm.to_mesh(st.data); bm.free()
md = st.modifiers.new("b", "BEVEL"); md.width = 0.008; md.segments = 2
st.data.materials.append(wood)
box("butt", (0.047, 0.012, 0.125), (0, 0.385, -0.0), blk, 0.003)
box("trig_guard", (0.006, 0.07, 0.005), (0, -0.04, 0.01), steel, 0.0)
box("trigger", (0.006, 0.006, 0.025), (0, -0.03, 0.025), steel, 0.001)
finish("ak47.glb")

# ------------------------------------------------------------------ baseball bat (handle at origin)
clear()
woodl = mat("ash", (0.72, 0.52, 0.3), 0.0, 0.45)
tape = mat("tape", (0.05, 0.05, 0.05), 0.0, 0.85)
prof = [(0.0, 0.03), (0.015, 0.03), (0.02, 0.017), (0.3, 0.014), (0.45, 0.022), (0.6, 0.03), (0.78, 0.034), (0.83, 0.032), (0.84, 0.02), (0.845, 0.0)]
bm = bmesh.new()
segs = 24
rings = []
for (y, r) in prof:
    ring = [bm.verts.new((r * math.cos(2 * math.pi * i / segs), -(y - 0.1), r * math.sin(2 * math.pi * i / segs))) for i in range(segs)]
    rings.append(ring)
for a, b in zip(rings[:-1], rings[1:]):
    for i in range(segs):
        bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
bm.faces.new(list(reversed(rings[0])))
me = bpy.data.meshes.new("bat"); bm.to_mesh(me); bm.free()
o = bpy.data.objects.new("bat", me); bpy.context.collection.objects.link(o)
o.data.materials.append(woodl)
bpy.context.view_layer.objects.active = o
cyl("tape", 0.0185, 0.2, (0, 0.0, 0), tape, verts=24)
finish("bat.glb")
print("WEAPONS OK")
