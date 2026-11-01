"""Process Poly Haven props in Blender: keep wanted objects, join, decimate, re-origin, export GLB.

  blender -b --python build_polyhaven.py

Writes dushanbe_city/assets/models/props/<prop>.glb (no images: materials are bound in Godot by
make_props.gd from the .tres files created by make_materials.py) and merges entries into
build_report.json.
"""
import json, math, os, sys
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from ph_list import PH_ASSETS  # noqa: E402
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
RAW = os.path.join(ROOT, "dushanbe_city_src", "raw", "polyhaven")
OUT = os.path.join(ROOT, "dushanbe_city", "assets", "models", "props")
REMAP = json.load(open(os.path.join(HERE, "ph_materials.json")))["remap"]


def process(aid, cfg, o):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    d = os.path.join(RAW, aid)
    g = [f for f in os.listdir(d) if f.endswith(".gltf")][0]
    bpy.ops.import_scene.gltf(filepath=os.path.join(d, g))
    keep = o["keep"]
    meshes = [ob for ob in bpy.data.objects if ob.type == "MESH" and (keep is None or ob.name in keep)]
    for ob in meshes:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
    for ob in list(bpy.data.objects):
        if ob not in meshes:
            bpy.data.objects.remove(ob, do_unlink=True)
    # apply parenting / transforms
    for ob in meshes:
        mw = ob.matrix_world.copy()
        ob.parent = None
        ob.matrix_world = mw
    bpy.ops.object.select_all(action="DESELECT")
    for ob in meshes:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    me = ob.data
    tris0 = sum(len(p.vertices) - 2 for p in me.polygons)
    if o["tris"] and tris0 > o["tris"] * 1.1:
        mod = ob.modifiers.new("dec", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = o["tris"] / tris0
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if o.get("yaw"):
        ob.data.transform(Matrix.Rotation(math.radians(o["yaw"]), 4, "Z"))
    # origin (Blender space: z up, game +Z = Blender -Y)
    vs = [v.co for v in me.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    if o["origin"] == "wall":   # back (Blender +Y max) on z=0 game plane
        off = Vector(((mn.x + mx.x) / 2, mx.y, mn.z))
    else:
        off = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    me.transform(Matrix.Translation(-off))
    # material remap to project materials
    for i, slot in enumerate(ob.material_slots):
        if slot.material and slot.material.name in REMAP:
            nm = REMAP[slot.material.name]
            m = bpy.data.materials.get(nm) or bpy.data.materials.new(nm)
            slot.material = m
    # drop unused material slots
    used = {p.material_index for p in me.polygons}
    for i in reversed(range(len(ob.material_slots))):
        if i not in used:
            ob.active_material_index = i
            bpy.ops.object.material_slot_remove()
    me.update()
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    vs = [v.co for v in me.vertices]
    gmin = [min(v.x for v in vs), min(v.z for v in vs), min(-v.y for v in vs)]
    gmax = [max(v.x for v in vs), max(v.z for v in vs), max(-v.y for v in vs)]
    path = os.path.join(OUT, o["prop"] + ".glb")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    ob.name = o["prop"]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_image_format="NONE",
                              export_yup=True, export_apply=True)
    print(f"{o['prop']:32s} tris {tris0} -> {tris} size {[round(b - a, 2) for a, b in zip(gmin, gmax)]} mats {[s.material.name for s in ob.material_slots]}")
    return {"group": "polyhaven", "tris": tris, "min": gmin, "max": gmax, "materials": [s.material.name for s in ob.material_slots],
            "markers": {}, "lod_of": None, "source": f"polyhaven:{aid}"}


def main():
    rp = os.path.join(HERE, "build_report.json")
    report = json.load(open(rp)) if os.path.exists(rp) else {}
    for aid, cfg in PH_ASSETS.items():
        for o in cfg["out"]:
            report[o["prop"]] = process(aid, cfg, o)
    json.dump(report, open(rp, "w"), indent=1)


main()
