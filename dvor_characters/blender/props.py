"""
Ability props for the match: the Technik's deployable mini tank (turret) and the Tank's garage door.
Low-poly, flat painted materials (no textures), one GLB with two top-level nodes:

  PROP_Turret  (children: Hull..., PROP_TurretHead -> barrel/mantlet/...; head pivot at its origin)
  PROP_Door    (stands on the ground, face towards +Z in three.js, 1.5 m x 1.45 m)

A material named "Team" is recoloured per team in the game.
Forward is Blender -Y (= three.js +Z after glTF export).

    /opt/dvor-venv/bin/python blender/props.py   ->  dist/PROPS.raw.glb
"""
import math
import os

import bpy
import bmesh
from mathutils import Matrix, Vector

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "dist", "PROPS.raw.glb")

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

MATS = {}


def mat(name, rgb, rough=0.8, metal=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*[c ** 2.2 for c in rgb], 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    MATS[name] = m
    return m


def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


RUBBER = mat("Rubber", hexrgb("#2a292d"), 0.95)
STEEL = mat("Steel", hexrgb("#7b8088"), 0.6, 0.3)
HULL = mat("Hull", hexrgb("#c76a22"), 0.7)           # Technik orange, homemade paint
DARK = mat("Dark", hexrgb("#38373c"), 0.7)
TEAM = mat("Team", hexrgb("#3d8ef0"), 0.6)
DOOR = mat("DoorPaint", hexrgb("#5f8a86"), 0.85)      # faded garage green-blue
DOOR_RIB = mat("DoorRib", hexrgb("#456966"), 0.85)
RUST = mat("Rust", hexrgb("#8a4f2c"), 0.95)
FRAME = mat("Frame", hexrgb("#4a4a50"), 0.7, 0.2)
GLOW = mat("Glow", hexrgb("#ffb347"), 0.4)


def obj_from_bm(name, bm, material, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o


def box(name, size, loc, material, parent=None, bevel=0.0, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect="EDGES")
    if rot:
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(rot[1], 3, rot[0]))
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return obj_from_bm(name, bm, material, parent)


def cyl(name, r, depth, loc, material, axis="Z", segs=12, parent=None, r2=None):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    if axis == "X":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"))
    elif axis == "Y":
        bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))
    bmesh.ops.translate(bm, vec=Vector(loc), verts=bm.verts)
    return obj_from_bm(name, bm, material, parent)


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    e.location = loc
    scene.collection.objects.link(e)
    if parent:
        e.parent = parent
    return e


# ------------------------------------------------------------------ mini tank (turret)
T = empty("PROP_Turret")
for side in (-1, 1):
    x = side * 0.22
    # track: a box with rounded (cylinder) ends
    box(f"Track{side}", (0.13, 0.5, 0.16), (x, 0, 0.09), RUBBER, T, bevel=0.015)
    cyl(f"TrackF{side}", 0.08, 0.13, (x, -0.25, 0.09), RUBBER, "X", 10, T)
    cyl(f"TrackB{side}", 0.08, 0.13, (x, 0.25, 0.09), RUBBER, "X", 10, T)
    for i, y in enumerate((-0.25, 0.0, 0.25)):
        cyl(f"Wheel{side}{i}", 0.055, 0.02, (x + side * 0.068, y, 0.09), STEEL, "X", 8, T)
# hull: lower block + sloped front plate
box("Hull", (0.34, 0.56, 0.13), (0, 0.01, 0.215), HULL, T, bevel=0.02)
box("Glacis", (0.32, 0.14, 0.03), (0, -0.29, 0.2), HULL, T, rot=("X", math.radians(-35)))
box("Fender", (0.6, 0.5, 0.025), (0, 0.0, 0.18), DARK, T)
box("AmmoBox", (0.16, 0.1, 0.08), (0.0, 0.25, 0.3), DARK, T, bevel=0.01)
box("Lamp", (0.05, 0.03, 0.03), (-0.12, -0.3, 0.27), GLOW, T)
box("Lamp2", (0.05, 0.03, 0.03), (0.12, -0.3, 0.27), GLOW, T)

# head (rotates in game): pivot on the hull top
H = empty("PROP_TurretHead", (0, 0, 0.28), T)
cyl("Ring", 0.17, 0.035, (0, 0.01, 0.02), TEAM, "Z", 14, H)            # team colour band
cyl("Dome", 0.155, 0.11, (0, 0.01, 0.09), HULL, "Z", 14, H, r2=0.12)
box("Mantlet", (0.14, 0.08, 0.09), (0, -0.14, 0.085), DARK, H, bevel=0.01)
cyl("Barrel", 0.028, 0.34, (0, -0.33, 0.09), STEEL, "Y", 8, H)
cyl("Muzzle", 0.04, 0.06, (0, -0.5, 0.09), DARK, "Y", 8, H)
cyl("Hatch", 0.06, 0.02, (0.04, 0.05, 0.155), DARK, "Z", 10, H)
cyl("Antenna", 0.006, 0.3, (-0.09, 0.09, 0.28), DARK, "Z", 4, H)
box("AntennaTip", (0.025, 0.025, 0.025), (-0.09, 0.09, 0.43), GLOW, H)

# ------------------------------------------------------------------ garage door (Tank)
D = empty("PROP_Door")
W, HH, TH = 1.5, 1.45, 0.06
box("Panel", (W - 0.1, TH, HH - 0.08), (0, 0, HH / 2 + 0.02), DOOR, D)
# corrugation: horizontal ribs on both faces
for i in range(9):
    z = 0.14 + i * 0.145
    box(f"Rib{i}", (W - 0.12, TH + 0.04, 0.04), (0, 0, z), DOOR_RIB, D)
box("RustBand", (W - 0.11, TH + 0.012, 0.09), (0, 0, 0.07), RUST, D)
box("TeamStripe", (W - 0.11, TH + 0.04, 0.05), (0, 0, HH - 0.12), TEAM, D)
box("PostL", (0.07, 0.09, HH + 0.04), (-W / 2 + 0.02, 0, (HH + 0.04) / 2), FRAME, D)
box("PostR", (0.07, 0.09, HH + 0.04), (W / 2 - 0.02, 0, (HH + 0.04) / 2), FRAME, D)
box("Lintel", (W + 0.04, 0.1, 0.07), (0, 0, HH + 0.02), FRAME, D)
box("Handle", (0.22, 0.05, 0.04), (0, -0.06, 0.32), STEEL, D)
# back braces so it reads as standing on its own
for side in (-1, 1):
    box(f"Brace{side}", (0.05, 0.05, 0.75), (side * 0.55, 0.26, 0.33), FRAME, D, rot=("X", math.radians(-35)))
    box(f"Foot{side}", (0.09, 0.5, 0.04), (side * 0.55, 0.22, 0.02), FRAME, D)

# ------------------------------------------------------------------ merge parts (few draw calls)
def merge(name, parts, origin_world, parent):
    me = bpy.data.meshes.new(name)
    tgt = bpy.data.objects.new(name, me)
    scene.collection.objects.link(tgt)
    tgt.location = origin_world
    bpy.context.view_layer.update()
    bpy.ops.object.select_all(action="DESELECT")
    for o in parts:
        o.select_set(True)
    tgt.select_set(True)
    bpy.context.view_layer.objects.active = tgt
    bpy.ops.object.join()
    tgt.parent = parent
    tgt.matrix_parent_inverse = parent.matrix_world.inverted()
    return tgt


bpy.context.view_layer.update()
head_parts = [o for o in H.children if o.type == "MESH"]
base_parts = [o for o in T.children if o.type == "MESH"]
door_parts = [o for o in D.children if o.type == "MESH"]
pivot = H.matrix_world.translation.copy()
merge("PROP_TurretBase", base_parts, (0, 0, 0), T)
head = merge("PROP_TurretHead", head_parts, pivot, T)
bpy.data.objects.remove(H)
merge("PROP_DoorMesh", door_parts, (0, 0, 0), D)
H = head

# ------------------------------------------------------------------ report + export
tris = {}
for root in (T, D):
    n = 0
    stack = [root]
    while stack:
        o = stack.pop()
        stack.extend(o.children)
        if o.type == "MESH":
            o.data.calc_loop_triangles()
            n += len(o.data.loop_triangles)
    tris[root.name] = n
print("tris", tris)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_apply=True, export_yup=True,
                          export_materials="EXPORT", export_normals=True, export_texcoords=False)
print("wrote", OUT, os.path.getsize(OUT), "bytes")
