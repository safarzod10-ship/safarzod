"""Monument v3, step 1: decode the CURRENT monument source and split it into
named architectural elements (Blender background, no shape changes).

  blender -b --factory-startup --python tools/blender/monument_elements.py -- \
      <artifact_dir> <out.blend> <report.json>

Reproduces the stage-2 (v2) transform exactly (cleanup, crown gap fix, rescale
to 43 m) and asserts the result matches the v2 bounding box, then creates one
object per architectural element so that each can get its own treatment
(bevels / subdivision / UV density / material). The old monument is NOT used
for geometry here: its shapes differ (see docs/MONUMENT_TEXTURE_TRANSFER.md).
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "validation"))
import artifact_mesh as am  # noqa: E402
import asset_pipeline_v2 as V2  # noqa: E402
import build_glb_from_artifact as B  # noqa: E402

V2_SIZE_ZUP = (42.2264, 29.3758, 43.0)  # docs/reports/monument_v2.json

# island id -> element name (ids are connected components of the source mesh,
# identified in docs/MONUMENT_GEOMETRY_ANALYSIS.md by size/position)
ELEMENTS = {
    "Base_Platform": [38],
    "Statue_Pedestal": [15],
    "Lion_Plinth_Caps": [0, 42],
    "Arch": [29],
    "Arch_Pilasters": [6, 7, 8, 9, 10, 11, 13, 14, 27, 28, 30, 31, 32, 33, 34, 35, 12],
    "Colonnade_Columns": [2, 4, 5, 36, 37, 39],
    "Colonnade_Entablatures": [3, 40],
    "Statue": [24],
    "Statue_Sceptre": [16, 17, 18, 19],      # raised sceptre: shaft + head (gilded in photos)
    "Statue_Details": [20, 21, 22, 23],      # crown on the head, belt buckle, boots (bronze)
    "Lion_L": [1],                           # SITTING lions of the current model: kept here for
    "Lion_R": [41],                          # reference only, replaced in v3 (monument_lions_from_old.py)
    "Crown": [26],                           # gilded crown
    "Crown_Base": [25],                      # bowl under the crown (dark in photos)
}


def source_positions():
    m = am.load(Path(sys.argv[sys.argv.index("--") + 1]), "monument")
    raw = am.analyze(m)
    tri_comp = raw.pop("tri_component")
    fixes = []
    pos, nrm, tris, tri_comp = V2.clean(m, raw, tri_comp, fixes)
    # --- identical to asset_pipeline_v2.build_monument (geometry part)
    pos = pos * 43.0
    isl = V2.islands(pos, tris, tri_comp)
    gap = float(min(isl[c]["min"][1] for c in V2.CROWN) - isl[V2.ARCH]["max"][1])
    vid = np.unique(tris[np.isin(tri_comp, V2.CROWN)])
    pos[vid, 1] -= gap
    pos *= 43.0 / float(pos[:, 1].max())
    return pos, nrm, tris, tri_comp, fixes, raw


def fix_winding(pos, nrm, tris):
    """Flip triangles whose winding disagrees with the authored vertex normals
    (source analysis: 419 such triangles). The authored normals are the
    reference because they encode the intended outside of open shells."""
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    vn = nrm[tris].sum(1)
    bad = (fn * vn).sum(1) < 0
    out = tris.copy()
    out[bad] = out[bad][:, [0, 2, 1]]
    return out, int(bad.sum())


def element_stats(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    nm = sum(1 for e in bm.edges if not e.is_manifold)
    bd = sum(1 for e in bm.edges if e.is_boundary)
    co = np.array([v.co[:] for v in bm.verts])
    area = sum(f.calc_area() for f in bm.faces)
    bm.free()
    mn, mx = co.min(0), co.max(0)
    return {"triangles": len(ob.data.polygons), "vertices": len(ob.data.vertices),
            "non_manifold_edges": nm, "boundary_edges": bd, "surface_m2": round(area, 2),
            "bbox_min": mn.round(3).tolist(), "bbox_max": mx.round(3).tolist(),
            "tri_density_per_m2": round(len(ob.data.polygons) / max(area, 1e-6), 1)}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out_blend, out_json = Path(argv[1]), Path(argv[2])
    B.reset_scene()
    pos, nrm, tris, tri_comp, fixes, raw = source_positions()
    size = np.ptp(B.to_zup(pos), axis=0)
    assert np.allclose(size, V2_SIZE_ZUP, atol=2e-3), f"v2 transform not reproduced: {size}"
    tris, flipped = fix_winding(pos, nrm, tris)
    report = {"v2_bbox_reproduced": True, "size_zup_m": size.round(4).tolist(), "v2_fixes": fixes,
              "winding_flipped_to_match_normals": flipped, "elements": {}}
    assigned = set()
    root = bpy.data.objects.new("Monument_IsmoiliSomoni", None)
    bpy.context.scene.collection.objects.link(root)
    for name, ids in ELEMENTS.items():
        mask = np.isin(tri_comp, ids)
        assigned.update(ids)
        used, inv = np.unique(tris[mask], return_inverse=True)
        me = B.build_mesh(name, B.to_zup(pos[used]), B.to_zup(nrm[used]), None, inv.reshape(-1, 3))
        ob = bpy.data.objects.new(name, me)
        ob.parent = root
        bpy.context.scene.collection.objects.link(ob)
        report["elements"][name] = {"source_islands": ids, **element_stats(ob)}
    missing = sorted(set(np.unique(tri_comp).tolist()) - assigned)
    assert not missing, f"unassigned islands: {missing}"
    # mirror symmetry of paired elements (x -> -x), mean nearest distance
    from mathutils.kdtree import KDTree
    def sym(a, b):
        va = [v.co.copy() for v in bpy.data.objects[a].data.vertices]
        vb = [v.co.copy() for v in bpy.data.objects[b].data.vertices]
        kd = KDTree(len(vb))
        for i, v in enumerate(vb):
            kd.insert(v, i)
        kd.balance()
        d = [kd.find((-v.x, v.y, v.z))[2] for v in va]
        return {"mean_m": round(float(np.mean(d)), 4), "max_m": round(float(np.max(d)), 4)}
    report["mirror_symmetry"] = {"Lion_L_vs_Lion_R": sym("Lion_L", "Lion_R"),
                                 "Statue_self": sym("Statue", "Statue"),
                                 "Arch_self": sym("Arch", "Arch"),
                                 "Base_self": sym("Base_Platform", "Base_Platform")}
    out_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend), compress=True)
    out_json.write_text(json.dumps(report, indent=1, ensure_ascii=False))
    print("ELEMENTS OK", json.dumps({k: v["triangles"] for k, v in report["elements"].items()}))


if __name__ == "__main__":
    main()
