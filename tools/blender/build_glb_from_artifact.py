"""Blender (background) pipeline: artifact packed mesh -> validated GLB.

Run:
  blender -b --factory-startup --python tools/blender/build_glb_from_artifact.py -- \
      <artifact_dir> <prado|monument|character> <out.glb> <report.json>

Steps: decode -> build Blender mesh (Y-up -> Z-up) -> diagnose -> safe fixes ->
(prado) split movable parts -> materials -> export GLB -> re-import -> compare.
The source files are only read, never written.
"""
import json
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "validation"))
import artifact_mesh as am  # noqa: E402

# Uniform scale factors (model units -> metres). See docs/ASSET_REGISTRY.md.
#  monument: overall height 1.0 -> 43 m (statue 13 m / total 43 m, ratio matches model 0.30)
#  prado:    measured wheelbase 0.6241 -> 2.79 m (J150 5-door wheelbase)
#  character: already metric (height 1.75 m)
PRADO_WHEELBASE_M = 2.79
SCALE = {"monument": 43.0, "character": 1.0}


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def to_zup(v: np.ndarray) -> np.ndarray:
    # glTF Y-up (x, y, z) -> Blender Z-up (x, -z, y)
    return np.stack([v[:, 0], -v[:, 2], v[:, 1]], axis=1)


def build_mesh(name, pos, nrm, uv, tris):
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(pos))
    me.vertices.foreach_set("co", pos.astype(np.float32).ravel())
    me.loops.add(len(tris) * 3)
    me.loops.foreach_set("vertex_index", tris.astype(np.int32).ravel())
    me.polygons.add(len(tris))
    me.polygons.foreach_set("loop_start", np.arange(0, len(tris) * 3, 3, dtype=np.int32))
    me.polygons.foreach_set("loop_total", np.full(len(tris), 3, dtype=np.int32))
    me.polygons.foreach_set("use_smooth", np.ones(len(tris), dtype=bool))
    if uv is not None:
        layer = me.uv_layers.new(name="UVMap")
        luv = uv[tris.ravel()].copy()
        luv[:, 1] = 1.0 - luv[:, 1]  # glTF top-left origin -> Blender bottom-left
        layer.data.foreach_set("uv", luv.astype(np.float32).ravel())
    me.update(calc_edges=True)
    me.validate(clean_customdata=False)
    if nrm is not None:
        me.normals_split_custom_set_from_vertices([tuple(n) for n in nrm])
    return me


def bmesh_checks(obj) -> dict:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    r = {
        "verts": len(bm.verts),
        "faces": len(bm.faces),
        "edges": len(bm.edges),
        "non_manifold_edges": sum(1 for e in bm.edges if not e.is_manifold),
        "boundary_edges": sum(1 for e in bm.edges if e.is_boundary),
        "loose_verts": sum(1 for v in bm.verts if not v.link_edges),
        "zero_area_faces": sum(1 for f in bm.faces if f.calc_area() < 1e-12),
    }
    bm.free()
    return r


def principled(name, color=(0.8, 0.8, 0.8, 1), metallic=0.0, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def textured_material(name, tex_dir: Path):
    mat = principled(name)
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    col = nt.nodes.new("ShaderNodeTexImage")
    col.image = bpy.data.images.load(str(tex_dir / "color.jpg"))
    nt.links.new(col.outputs["Color"], bsdf.inputs["Base Color"])
    rm = nt.nodes.new("ShaderNodeTexImage")
    rm.image = bpy.data.images.load(str(tex_dir / "rm.jpg"))
    rm.image.colorspace_settings.name = "Non-Color"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(rm.outputs["Color"], sep.inputs["Color"])
    nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])  # glTF: G = roughness
    nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])  # glTF: B = metallic
    nm = nt.nodes.new("ShaderNodeTexImage")
    nm.image = bpy.data.images.load(str(tex_dir / "normal.png"))
    nm.image.colorspace_settings.name = "Non-Color"
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def scene_stats() -> dict:
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    dg = bpy.context.evaluated_depsgraph_get()
    tris = verts = 0
    mn = np.full(3, np.inf)
    mx = np.full(3, -np.inf)
    uv_objs = 0
    for o in meshes:
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        verts += len(me.vertices)
        co = np.empty(len(me.vertices) * 3, dtype=np.float32)
        me.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3) @ np.array(o.matrix_world)[:3, :3].T + np.array(o.matrix_world)[:3, 3]
        if len(co):
            mn = np.minimum(mn, co.min(0))
            mx = np.maximum(mx, co.max(0))
        uv_objs += 1 if me.uv_layers else 0
        o.evaluated_get(dg).to_mesh_clear()
    mats = {s.material.name for o in meshes for s in o.material_slots if s.material}
    return {
        "objects_total": len(bpy.context.scene.objects),
        "mesh_objects": sorted(o.name for o in meshes),
        "empties": sorted(o.name for o in bpy.context.scene.objects if o.type == "EMPTY"),
        "armatures": sorted(o.name for o in bpy.context.scene.objects if o.type == "ARMATURE"),
        "actions": len(bpy.data.actions),
        "triangles": tris,
        "vertices": verts,
        "materials": sorted(mats),
        "images": sorted(i.name for i in bpy.data.images if i.source == "FILE" or i.packed_file),
        "objects_with_uv": uv_objs,
        "bbox_min_zup": mn.round(4).tolist(),
        "bbox_max_zup": mx.round(4).tolist(),
        "size_zup_m": (mx - mn).round(4).tolist(),
    }


def split_prado(pos, nrm, tris, tri_comp, comps_info, scale):
    """Return list of (name, tri_mask, pivot_gltf). Wheel groups = every island fully inside
    a tyre island's bounding box; steering wheel = the isolated ring inside the cabin."""
    pos_s = pos * scale
    comp_bbox = {}
    for ci in np.unique(tri_comp):
        v = pos_s[np.unique(tris[tri_comp == ci])]
        comp_bbox[int(ci)] = (v.min(0), v.max(0), int((tri_comp == ci).sum()))
    tyres = [c for c, (a, _, n) in comp_bbox.items() if 1300 < n < 1400 and a[1] < 0.05 * scale]  # touching the ground
    if len(tyres) != 4:
        raise RuntimeError(f"expected 4 tyre islands, found {len(tyres)}")
    used = set()
    parts = []
    for t in tyres:
        mn, mx, _ = comp_bbox[t]
        pad = 0.005 * scale
        members = [c for c, (a, b, _) in comp_bbox.items() if (a >= mn - pad).all() and (b <= mx + pad).all()]
        used.update(members)
        centre = (mn + mx) / 2
        side = "L" if centre[0] > 0 else "R"  # model faces +Z, so +X is the vehicle's left
        axle = "F" if centre[2] > 0 else "R"
        parts.append((f"Wheel_{axle}{side}", np.isin(tri_comp, members), centre, members))
    # steering wheel: island ~1344 tris above the floor, ahead of centre
    sw = [c for c, (a, b, n) in comp_bbox.items() if 1300 < n < 1400 and c not in used and a[1] > 0.2 * scale]
    if len(sw) == 1:
        a, b, _ = comp_bbox[sw[0]]
        used.add(sw[0])
        parts.append(("SteeringWheel", tri_comp == sw[0], (a + b) / 2, sw))
    body_mask = ~np.isin(tri_comp, list(used))
    parts.insert(0, ("Body", body_mask, np.zeros(3), sorted(set(comp_bbox) - used)))
    return parts


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    art, key, out_glb, out_json = Path(argv[0]), argv[1], Path(argv[2]), Path(argv[3])
    t0 = time.time()
    reset_scene()
    m = am.load(art, key)
    raw = am.analyze(m)
    tri_comp = raw.pop("tri_component")
    report = {"key": key, "blender": bpy.app.version_string, "source_analysis": raw, "fixes": []}

    pos, nrm, uv, tris = m["position"], m["normal"], m["uv"], m["index"]

    # --- scale
    if key == "prado":
        tyre_z = sorted(((np.array(c["min"]) + np.array(c["max"])) / 2)[2]
                        for c in raw["largest_components"] if 1300 < c["tris"] < 1400 and c["max"][1] < 0.21)
        wheelbase = float(np.mean(tyre_z[2:]) - np.mean(tyre_z[:2]))
        scale = PRADO_WHEELBASE_M / wheelbase
        report["measured_wheelbase_model_units"] = round(wheelbase, 4)
    else:
        scale = SCALE[key]
    report["scale_factor"] = round(scale, 4)

    # --- safe fixes (only clearly diagnosable problems)
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
    keep = area >= 1e-10
    if (~keep).sum():
        report["fixes"].append(f"removed {int((~keep).sum())} zero-area (degenerate) triangles; no visible surface")
    tris, tri_comp = tris[keep], tri_comp[keep]
    if nrm is not None:
        ln = np.linalg.norm(nrm, axis=1)
        bad = ln < 0.5
        if bad.any():
            fn = np.cross(b - a, c - a)
            acc = np.zeros_like(pos)
            for k in range(3):
                np.add.at(acc, m["index"][:, k], fn)
            fixed = acc[bad] / np.maximum(np.linalg.norm(acc[bad], axis=1, keepdims=True), 1e-20)
            nrm = nrm.copy()
            nrm[bad] = fixed
            report["fixes"].append(f"replaced {int(bad.sum())} zero-length vertex normals with area-weighted face normals")
        nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-20)

    # --- materials
    if key == "character":
        mat = textured_material("M_Character_PBR", art / "character")
        mat.use_backface_culling = True  # closed mesh (3 boundary edges) -> glTF doubleSided=false
    elif key == "monument":
        mat = principled("M_Monument_Provisional", (0.72, 0.68, 0.60, 1), 0.0, 0.6)
    else:
        mat = principled("M_Prado_Provisional", (0.78, 0.78, 0.76, 1), 0.3, 0.45)

    root = bpy.data.objects.new({"prado": "Prado", "monument": "Monument_IsmoiliSomoni",
                                 "character": "MainCharacter"}[key], None)
    bpy.context.scene.collection.objects.link(root)

    if key == "prado":
        parts = split_prado(pos, nrm, tris, tri_comp, raw["largest_components"], scale)
        report["parts"] = {}
        for name, mask, pivot, members in parts:
            sub = tris[mask]
            used_v, inv = np.unique(sub, return_inverse=True)
            p = (pos[used_v] * scale) - pivot
            me = build_mesh(name, to_zup(p), to_zup(nrm[used_v]), None, inv.reshape(-1, 3))
            me.materials.append(mat)
            ob = bpy.data.objects.new(name, me)
            ob.location = to_zup(pivot[None])[0]
            ob.parent = root
            bpy.context.scene.collection.objects.link(ob)
            report["parts"][name] = {"triangles": int(mask.sum()), "islands": len(members),
                                     "pivot_gltf_m": np.round(pivot, 4).tolist()}
    else:
        me = build_mesh(root.name + "_Mesh", to_zup(pos * scale), to_zup(nrm) if nrm is not None else None,
                        uv, tris)
        me.materials.append(mat)
        ob = bpy.data.objects.new(root.name + "_Mesh", me)
        ob.parent = root
        bpy.context.scene.collection.objects.link(ob)

    report["bmesh_checks"] = {o.name: bmesh_checks(o) for o in bpy.context.scene.objects if o.type == "MESH"}
    report["before_export"] = scene_stats()

    out_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB", export_yup=True,
                              export_apply=True, export_materials="EXPORT", export_normals=True,
                              export_texcoords=True, export_tangents=(key == "character"), export_animations=False,
                              export_image_format="AUTO")
    report["glb_bytes"] = out_glb.stat().st_size

    # --- round trip
    reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(out_glb))
    report["after_reimport"] = scene_stats()
    bf, af = report["before_export"], report["after_reimport"]
    report["roundtrip"] = {
        "triangles_equal": bf["triangles"] == af["triangles"],
        "mesh_objects_equal": bf["mesh_objects"] == af["mesh_objects"],
        "materials_equal": bf["materials"] == af["materials"],
        "bbox_max_abs_diff_m": float(np.max(np.abs(np.array(bf["size_zup_m"]) - np.array(af["size_zup_m"])))),
        "uv_preserved": bf["objects_with_uv"] == af["objects_with_uv"],
        "image_count": len(af["images"]),
    }
    report["seconds"] = round(time.time() - t0, 2)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(report, indent=1, ensure_ascii=False, default=float))
    print("ROUNDTRIP", key, json.dumps(report["roundtrip"]))


if __name__ == "__main__":
    main()
