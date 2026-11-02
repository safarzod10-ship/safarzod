"""Prepare the uploaded Prado GLB for the game (Blender, background):
  blender -b --python prepare_prado.py -- [--low] <source.glb> <out.glb>
* uniform scale 1.047 -> real J150 5-door proportions (L 4.83 m, wheelbase 2.77 m, H 1.87 m, tyre r 0.398 m)
* node structure kept: body (+ doors, windscreen, interior, steering wheel), wheel pivots at hub centres
* triangle budget for mobile: careful collapse-decimation, mostly of interior/steering/wheels (hidden or
  small on screen); exterior shell keeps most detail. Shape keys/UVs/materials untouched.
Prints per-object triangles before/after."""
import bpy, sys
src, out = sys.argv[-2], sys.argv[-1]
LOW = "--low" in sys.argv          # Low-preset variant: ~35 % of the triangles
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
SCALE = 1.047
RATIO = {   # object -> decimate ratio
    "body": 0.70, "door_lf_ok": 0.55, "door_rf_ok": 0.55, "door_lr_ok": 0.55, "door_rr_ok": 0.55,
    "int": 0.10, "int1": 0.14, "steeringwheel": 0.15, "windscreen": 0.45, "fari": 0.75,
    "wheel": 0.22,
}
WHEELS = ["wheel_lf", "wheel_lb", "wheel_rb"]   # share the mesh of "wheel" (instanced data kept shared)
def tris(o):
    return sum(len(p.vertices) - 2 for p in o.data.polygons)
total0 = total1 = 0
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        continue
    t0 = tris(o)
    r = RATIO.get(o.name)
    if r and LOW:
        r *= 0.38
    if o.name in WHEELS:
        continue
    if r:
        if o.data.users > 1:
            o.data = o.data.copy()
        bpy.context.view_layer.objects.active = o
        m = o.modifiers.new("dec", 'DECIMATE')
        m.decimate_type = 'COLLAPSE'
        m.ratio = r
        m.use_collapse_triangulate = True
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier="dec")
        # decimation drops the custom split normals: rebuild smooth shading with hard edges by angle
        import math
        o.data.set_sharp_from_angle(angle=math.radians(35))
        for p in o.data.polygons:
            p.use_smooth = True
    t1 = tris(o)
    total0 += t0; total1 += t1
    print("PREP %-16s %7d -> %7d" % (o.name, t0, t1))
for n in WHEELS:
    w = bpy.data.objects[n]
    t0 = tris(w)
    w.data = bpy.data.objects["wheel"].data
    total0 += t0; total1 += tris(w)
    print("PREP %-16s %7d -> %7d (shared mesh)" % (n, t0, tris(w)))
root = bpy.data.objects["LandCruiserPrado"]
root.scale = (SCALE, SCALE, SCALE)
print("PREP TOTAL %d -> %d" % (total0, total1))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_apply=False, export_yup=True,
                          export_image_format='AUTO', export_materials='EXPORT')
