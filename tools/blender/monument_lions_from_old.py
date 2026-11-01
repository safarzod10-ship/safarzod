"""Monument v3: replace the SITTING lions of the current model with the LYING
lions of the old (textured) model - the only geometry taken from the old model.

  blender -b --factory-startup --python tools/blender/monument_lions_from_old.py -- \
      <artifact_dir> <elements.blend> <out.blend> <report.json>

Why: every reference photo (docs/MONUMENT_REFERENCE_RESEARCH.md) shows two
lying ("sphinx" pose) lions facing forward; the current model has sitting
lions. The old model has lying lions whose measured proportions
(W:H:L = 1 : 1.36 : 2.03) match the photos (H ~3.5 m at L ~5.2 m) and fit the
current lion footprint (5.25 m deep) - so no shape is invented.

How: the old mesh is one connected shell (1.93 M tris). Each lion is cut out
by a measured box above its plinth top plane (y = 0.1205 model units, the
dominant up-facing plane under the lion), loose fragments < 1 % are dropped,
then the lion is uniformly scaled so its length equals the current lion
footprint depth and placed on the current plinth (footprint centre, base
height). The cut faces lie on the plinth top and are hidden. The original
UVs and the old 4K colour/normal/RM maps are kept on this high-res copy, so
the old normal-map detail (mane, fur) can be BAKED onto the new UV layout of
the game mesh - an exact transfer because it is the same surface.
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
import build_glb_from_artifact as B  # noqa: E402

PLINTH_TOP_Y = 0.1205
BOXES = {  # old model units (glTF Y-up), measured in docs/MONUMENT_TEXTURE_TRANSFER.md
    "Lion_L": ((-0.262, PLINTH_TOP_Y, 0.112), (-0.184, 0.235, 0.256)),
    "Lion_R": ((0.184, PLINTH_TOP_Y, 0.112), (0.262, 0.235, 0.256)),
}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    art, elements, out_blend, out_json = Path(argv[0]), Path(argv[1]), Path(argv[2]), Path(argv[3])
    m = am.load(art, "oldmonument")
    pos, nrm, uv, tris = m["position"], m["normal"], m["uv"], m["index"].reshape(-1, 3)
    cen = pos[tris].mean(1)
    # targets from the current model (Blender Z-up, metres)
    bpy.ops.wm.open_mainfile(filepath=str(elements))
    targets = {}
    for name in BOXES:
        ob = bpy.data.objects[name]
        co = np.array([ob.matrix_world @ v.co for v in ob.data.vertices])
        targets[name] = {"min": co.min(0), "max": co.max(0)}
    B.reset_scene()
    tex_dir = art / "oldmonument"
    mat = B.textured_material("M_OldMonument_PBR", tex_dir)
    report = {"plinth_top_old_units": PLINTH_TOP_Y, "lions": {}}
    for name, (lo, hi) in BOXES.items():
        sel = np.all((cen >= lo) & (cen <= hi), axis=1)
        sub = tris[sel]
        used, inv = np.unique(sub, return_inverse=True)
        sub = inv.reshape(-1, 3)
        p, n, u = pos[used], nrm[used], uv[used]
        # drop loose fragments (< 1 % of the triangles)
        wid = am.weld(p)  # the old mesh is split at UV seams: connectivity on welded ids
        comp = am.components(wid[sub], int(wid.max()) + 1)[wid[sub[:, 0]]]
        ids, cnt = np.unique(comp, return_counts=True)
        keep_c = ids[cnt >= 0.01 * len(sub)]
        keep = np.isin(comp, keep_c)
        dropped = int((~keep).sum())
        sub = sub[keep]
        used2, inv2 = np.unique(sub, return_inverse=True)
        p, n, u, sub = p[used2], n[used2], u[used2], inv2.reshape(-1, 3)
        pz = B.to_zup(p)
        nz = B.to_zup(n)
        lo_, hi_ = pz.min(0), pz.max(0)
        t = targets[name]
        length_target = float(t["max"][1] - t["min"][1])      # footprint depth (Blender Y)
        scale = length_target / float(hi_[1] - lo_[1])
        centre_t = (t["min"] + t["max"]) / 2
        pz = (pz - np.array([(lo_[0] + hi_[0]) / 2, (lo_[1] + hi_[1]) / 2, lo_[2]])) * scale
        pz += np.array([centre_t[0], centre_t[1], t["min"][2]])
        me = B.build_mesh(f"{name}_old_hi", pz, nz, u, sub)
        me.materials.append(mat)
        ob = bpy.data.objects.new(f"{name}_old_hi", me)
        bpy.context.scene.collection.objects.link(ob)
        size = pz.max(0) - pz.min(0)
        report["lions"][name] = {
            "old_triangles": int(sel.sum()), "fragments_dropped_tris": dropped, "triangles": len(sub),
            "scale_old_units_to_m": round(scale, 3), "size_m_xyz": size.round(3).tolist(),
            "proportion_W_H_L": [1.0, round(float(size[2] / size[0]), 2), round(float(size[1] / size[0]), 2)],
            "current_sitting_lion_size_m": (t["max"] - t["min"]).round(3).tolist(),
        }
        print(name, report["lions"][name])
    out_blend.parent.mkdir(parents=True, exist_ok=True)
    for img in bpy.data.images:
        img.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend), compress=True)
    Path(out_json).write_text(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
