"""Mercedes-Benz GLS 580 (model supplied by the project owner) -> a game car for VehicleCar:
  * scaled to the real size (5.21 m long), centred, ground z = 0, front at Blender -Y (yaw PI in game)
  * the four wheels cut out of the body into "tire_lf" ... (every face inside a wheel's cylinder)
  * decimated for phones (~370k -> ~130k triangles), interior kept
  * BLACK: metallic black paint, smoked (dark) lamp glass; lamp glow overlays (additive, dark when
    off) duplicated from the lamp glass with the VehicleLights names
  * Tajik plate quads over the model's plates (number = Label3D in the game)

  blender -b --python gls.py -- src.glb out.glb
"""
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

a = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = a[0], a[1]
PLATE_IMG = "/home/user/safarzod/dushanbe_city/assets/vehicles/plates/tj_plate.png"
REAL_LEN = 5.21

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
# bake transforms, unparent
for o in meshes:
    mw = o.matrix_world.copy()
    o.parent = None
    o.matrix_world = mw
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        bpy.data.objects.remove(o)
pts = [v.co for o in meshes for v in o.data.vertices]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
k = REAL_LEN / (mx.y - mn.y)
c = (mn + mx) * 0.5
M = Matrix.Scale(k, 4) @ Matrix.Translation((-c.x, -c.y, -mn.z))
for o in meshes:
    o.data.transform(M)
print("scale", round(k, 3))


def obj(name):
    for o in meshes:
        if o.name.endswith(name) or name in o.name:
            return o
    return None


# ---- wheels: centres from the tyre mesh's loose parts
tyres = obj("Tyres_0")
bm = bmesh.new()
bm.from_mesh(tyres.data)
parts = []
seen = set()
bm.verts.ensure_lookup_table()
for v in bm.verts:
    if v.index in seen:
        continue
    stack = [v]
    seen.add(v.index)
    grp = []
    while stack:
        q = stack.pop()
        grp.append(q.co.copy())
        for e in q.link_edges:
            w = e.other_vert(q)
            if w.index not in seen:
                seen.add(w.index)
                stack.append(w)
    parts.append(grp)
bm.free()
quad = {}
for g in parts:
    cx = sum(p.x for p in g) / len(g)
    cy = sum(p.y for p in g) / len(g)
    key = ("l" if cx > 0 else "r") + ("f" if cy < 0 else "b")      # left = +X (the car faces -Y)
    quad.setdefault(key, []).extend(g)
wheels = {}
for key, g in quad.items():
    x0, x1 = min(p.x for p in g), max(p.x for p in g)
    y0, y1 = min(p.y for p in g), max(p.y for p in g)
    z0, z1 = min(p.z for p in g), max(p.z for p in g)
    wheels[key] = (Vector(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)), (z1 - z0) / 2, x0, x1)
print("wheels", {k2: (tuple(round(t, 2) for t in v[0]), round(v[1], 3)) for k2, v in wheels.items()})


def in_wheel(p):
    for key, (ctr, r, x0, x1) in wheels.items():
        if x0 - 0.03 <= p.x <= x1 + 0.03 and (Vector((0, p.y, p.z)) - Vector((0, ctr.y, ctr.z))).length < r * 0.98:
            return key
    return None


# split every mesh's faces inside the wheel cylinders into per-wheel objects
wheel_parts = {key: [] for key in wheels}
for o in list(meshes):
    if "Interior" in o.name or "WindowsTint" in o.name:
        continue
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bm.faces.ensure_lookup_table()
    sel = {key: [] for key in wheels}
    for f in bm.faces:
        key = in_wheel(f.calc_center_median())
        if key and all(in_wheel(v.co) == key for v in f.verts):
            sel[key].append(f)
    for key, fs in sel.items():
        if not fs:
            continue
        nb = bmesh.new()
        vm = {}
        uvl = bm.loops.layers.uv.active
        nuv = nb.loops.layers.uv.new() if uvl else None
        for f in fs:
            vs = []
            for v in f.verts:
                if v not in vm:
                    vm[v] = nb.verts.new(v.co)
                vs.append(vm[v])
            try:
                nf = nb.faces.new(vs)
                nf.material_index = f.material_index
                if uvl:
                    for l_new, l_old in zip(nf.loops, f.loops):
                        l_new[nuv].uv = l_old[uvl].uv
            except ValueError:
                pass
        me = bpy.data.meshes.new("w_%s_%s" % (key, o.name))
        nb.to_mesh(me)
        nb.free()
        for m in o.data.materials:
            me.materials.append(m)
        no = bpy.data.objects.new(me.name, me)
        bpy.context.collection.objects.link(no)
        wheel_parts[key].append(no)
        bmesh.ops.delete(bm, geom=fs, context='FACES')
    bm.to_mesh(o.data)
    bm.free()
for key, objs in wheel_parts.items():
    if not objs:
        continue
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    bpy.context.object.name = "tire_" + key

# ---- decimate the heavy body meshes for phones
for o in bpy.data.objects:
    if o.type != 'MESH' or o.name.startswith("tire_"):
        continue
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    if tris > 12000:
        md = o.modifiers.new("dec", 'DECIMATE')
        md.ratio = max(0.12, 6000.0 / tris) if "Interior" in o.name else (max(0.55, 24000.0 / tris) if "Polar_White" in o.name else max(0.3, 15000.0 / tris))
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=md.name)


# ---- black: paint, smoked lamps
def setcol(mname, col, metal=None, rough=None, alpha=None):
    m = bpy.data.materials.get(mname)
    if not m or not m.use_nodes:
        return
    b = m.node_tree.nodes.get("Principled BSDF")
    if not b:
        return
    b.inputs["Base Color"].default_value = (*col, 1.0)
    for lk in list(b.inputs["Base Color"].links):
        m.node_tree.links.remove(lk)
    if metal is not None:
        b.inputs["Metallic"].default_value = metal
    if rough is not None:
        b.inputs["Roughness"].default_value = rough
    if alpha is not None:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = 'BLEND'


setcol("Polar_White", (0.012, 0.012, 0.014), 0.6, 0.22)
# the light-grey parts are chrome / satin trim (window line, roof rails, grille, bumper inserts), not white
setcol("Color_M01", (0.55, 0.56, 0.58), 1.0, 0.18)
setcol("Color_M02", (0.5, 0.51, 0.53), 1.0, 0.2)
setcol("Color_M03", (0.38, 0.39, 0.4), 1.0, 0.25)
setcol("Color_M04", (0.3, 0.3, 0.32), 1.0, 0.25)
setcol("Color_A07", (0.45, 0.01, 0.01), 0.0, 0.3)
setcol("Color_A08", (0.32, 0.0, 0.0), 0.0, 0.3)
setcol("Lights_Glass", (0.03, 0.03, 0.035), 0.4, 0.05, alpha=0.75)
lgo = [o for o in bpy.data.objects if o.type == 'MESH' and "Lights_Glass" in o.name][0]
red = bpy.data.materials.new("lens_tail")          # opaque red lens (always red, like the real lamps)
red.use_nodes = True
rb = red.node_tree.nodes["Principled BSDF"]
rb.inputs["Base Color"].default_value = (0.55, 0.02, 0.02, 1.0)
rb.inputs["Roughness"].default_value = 0.08
lgo.data.materials.append(red)
for f in lgo.data.polygons:
    if f.center.y > 0:
        f.material_index = len(lgo.data.materials) - 1
for nm in ("Polar_White", "Lights_Glass"):
    m = bpy.data.materials.get(nm)
    if m:
        m.name = {"Polar_White": "primary", "Lights_Glass": "glass_lamps"}[nm]

# ---- lamp glow overlays (copies of the lamp glass, slightly outside), per lamp group
lg = [o for o in bpy.data.objects if o.type == 'MESH' and "Lights_Glass" in o.name][0]
L2 = REAL_LEN / 2


def overlay(name, test):
    bm = bmesh.new()
    bm.from_mesh(lg.data)
    bm.faces.ensure_lookup_table()
    kill = [f for f in bm.faces if not test(f.calc_center_median())]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    if not bm.faces:
        bm.free()
        return
    for v in bm.verts:                         # out of the lens, along the car's length (front -Y, rear +Y)
        v.co.y += 0.015 if v.co.y > 0 else -0.015
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    me.materials.clear()
    me.materials.append(m)
    o = bpy.data.objects.new("lamp_" + name, me)
    bpy.context.collection.objects.link(o)


overlay("headlight rf", lambda p: p.y < -L2 + 0.9 and p.z > 0.6)
overlay("fari.4", lambda p: p.y < -L2 + 0.9 and p.z > 0.6 and abs(p.x) > 0.7)
overlay("taillight rr", lambda p: p.y > L2 - 0.6)
overlay("fari.3", lambda p: p.y > L2 - 0.6 and p.x > 0.55)
overlay("fari.2", lambda p: p.y > L2 - 0.6 and p.x < -0.55)
overlay("body.5", lambda p: p.y > L2 - 0.6 and 0.45 < abs(p.x) < 0.72)

# ---- Tajik plates over the model's plate quads ("material")
pm = bpy.data.materials.new("tj_plate")
pm.use_nodes = True
t = pm.node_tree.nodes.new("ShaderNodeTexImage")
t.image = bpy.data.images.load(PLATE_IMG)
pm.node_tree.links.new(t.outputs["Color"], pm.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
po = [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith("material_0")]
if po:
    vs = [v.co for v in po[0].data.vertices]
    for side in ("f", "r"):
        g = [v for v in vs if (v.y < 0) == (side == "f")]
        if not g:
            continue
        cx = sum(v.x for v in g) / len(g)
        cy = (min(v.y for v in g) - 0.006) if side == "f" else (max(v.y for v in g) + 0.006)
        cz = (min(v.z for v in g) + max(v.z for v in g)) / 2 + 0.02
        bpy.ops.mesh.primitive_plane_add(size=1, location=(cx, cy, cz), rotation=(1.5708, 0, 0 if side == "f" else math.pi))
        q = bpy.context.object
        q.scale = (0.53, 0.125, 1)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        q.name = "plate_front" if side == "f" else "plate_rear"
        q.data.materials.append(pm)
        print("plate", side, round(cx, 3), round(cy, 3), round(cz, 3))
    bpy.data.objects.remove(po[0])

for o in bpy.data.objects:
    if o.type == 'MESH':
        for p in o.data.polygons:
            p.use_smooth = True
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
pts = [v.co for o in bpy.data.objects if o.type == 'MESH' for v in o.data.vertices]
print("SIZE", round(max(p.x for p in pts) - min(p.x for p in pts), 3), round(max(p.z for p in pts), 3),
      round(max(p.y for p in pts) - min(p.y for p in pts), 3), "tris", tris)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_apply=True)
print("BUILD done")
