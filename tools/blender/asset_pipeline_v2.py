"""Stage-2 asset corrections (Blender background).

  blender -b --factory-startup --python tools/blender/asset_pipeline_v2.py -- \
      <artifact_dir> <prado|monument> <out.glb> <report.json>

Works from the untouched artifact source (same decoder as stage 1) and applies
ONLY measured, documented corrections:

prado:
  * wheel axle direction from the plane of the 8 lug nuts (SVD, planarity
    residual ~1e-3 m) -> wheels rotated about their own vertical axis to toe 0
    (front wheels were modelled steered ~17 deg, rear had +-6 deg toe);
  * proportions: body/interior scaled (K, K, 1) in (width, height, length) so
    width 1.885 m and height ~1.85 m match the J150 while the measured
    wheelbase (2.79 m) is kept; wheels scaled uniformly to 0.776 m
    (265/65 R17), never non-uniformly;
  * per-island material classification (paint, chrome, trim, lights, interior,
    tyre, rim) + Smart-UV unwrap for future texturing.
monument:
  * crown (2 islands) lowered by the measured unsupported gap onto the arch;
  * per-island material groups (gilded metal, sculpture, decor, light/dark
    stone) checked against expected triangle counts; Smart-UV unwrap.
"""
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "validation"))
import artifact_mesh as am  # noqa: E402
import build_glb_from_artifact as B  # noqa: E402

PRADO_REAL = {"wheelbase": 2.79, "width": 1.885, "height": 1.845, "length": 4.84, "tyre_diameter": 0.776}

# --------------------------------------------------------------------- common


def clean(m, raw, tri_comp, fixes):
    pos, nrm, tris = m["position"], m["normal"], m["index"]
    a, b, c = pos[tris[:, 0]], pos[tris[:, 1]], pos[tris[:, 2]]
    fn = np.cross(b - a, c - a)
    keep = 0.5 * np.linalg.norm(fn, axis=1) >= 1e-10
    if (~keep).any():
        fixes.append(f"removed {int((~keep).sum())} zero-area triangles")
    bad = np.linalg.norm(nrm, axis=1) < 0.5
    if bad.any():
        acc = np.zeros_like(pos)
        for k in range(3):
            np.add.at(acc, tris[:, k], fn)
        nrm = nrm.copy()
        nrm[bad] = acc[bad]
        fixes.append(f"replaced {int(bad.sum())} zero-length normals")
    nrm = nrm / np.maximum(np.linalg.norm(nrm, axis=1, keepdims=True), 1e-20)
    return pos.copy(), nrm, tris[keep], tri_comp[keep]


def islands(pos, tris, tri_comp):
    out = {}
    for ci in np.unique(tri_comp):
        mask = tri_comp == ci
        v = pos[np.unique(tris[mask])]
        out[int(ci)] = {"mask": mask, "n": int(mask.sum()), "min": v.min(0), "max": v.max(0),
                        "c": (v.min(0) + v.max(0)) / 2}
    return out


def add_object(name, pos, nrm, tris, mat_index, materials, parent, pivot=np.zeros(3), uv_unwrap=True):
    used, inv = np.unique(tris, return_inverse=True)
    me = B.build_mesh(name, B.to_zup(pos[used] - pivot), B.to_zup(nrm[used]), None, inv.reshape(-1, 3))
    for mat in materials:
        me.materials.append(mat)
    me.polygons.foreach_set("material_index", mat_index.astype(np.int32))
    me.update()
    ob = bpy.data.objects.new(name, me)
    ob.location = B.to_zup(pivot[None])[0]
    ob.parent = parent
    bpy.context.scene.collection.objects.link(ob)
    if uv_unwrap:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003)
        bpy.ops.object.mode_set(mode="OBJECT")
        ob.select_set(False)
    return ob


def mat(name, rgb, metallic, rough, clearcoat=0.0):
    m = B.principled(name, (*rgb, 1.0), metallic, rough)
    if clearcoat:
        bsdf = m.node_tree.nodes["Principled BSDF"]
        bsdf.inputs["Coat Weight"].default_value = clearcoat
        bsdf.inputs["Coat Roughness"].default_value = 0.05
    return m


def rot_y(t):
    c, s = math.cos(t), math.sin(t)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

# ---------------------------------------------------------------------- prado


def classify_prado(isl, body_main):
    """Material name for a non-wheel island (coordinates: stage-1 metres)."""
    if isl is body_main:
        return "M_Prado_Paint"
    c, mn, mx = isl["c"], isl["min"], isl["max"]
    ax = abs(c[0])
    if c[1] > 2.0 and ax > 0.5:
        return "M_Prado_TrimBlack"            # roof rails
    if max(abs(mn[0]), abs(mx[0])) < 0.9 and mn[1] > 0.55 and mx[1] < 1.95 and mn[2] > -1.45 and mx[2] < 1.0:
        return "M_Prado_Interior"             # seats, dashboard, mirror, footwells
    if c[2] > 1.7 and 0.95 < c[1] < 1.3 and ax > 0.5:
        return "M_Prado_LightLens"            # headlamp units
    if c[2] > 1.9 and c[1] < 0.55 and 0.1 < ax < 0.55:
        return "M_Prado_LightLens"            # fog lamps
    if c[2] > 1.9 and 0.7 < c[1] < 0.85 and ax > 0.8:
        return "M_Prado_LightLens"            # bumper side lamps
    if c[2] > 1.9 and ax < 0.75:
        return "M_Prado_TrimBlack" if c[1] < 0.45 else "M_Prado_Chrome"  # skid plate / grille, emblem
    if c[2] < -1.8 and ax > 0.7 and 0.6 < c[1] < 1.7:
        return "M_Prado_TailLight"            # rear combination lamps
    if c[2] < -2.0 and ax < 0.5:
        if c[1] > 1.4:
            return "M_Prado_TailLight"        # high-mount stop lamp
        return "M_Prado_Chrome" if c[1] > 0.6 else "M_Prado_TrimBlack"
    return "M_Prado_TrimBlack"                # running boards, underbody, small trim


def build_prado(pos, nrm, tris, tri_comp, raw, report):
    tyre_z = sorted(((np.array(c["min"]) + np.array(c["max"])) / 2)[2]
                    for c in raw["largest_components"] if 1300 < c["tris"] < 1400 and c["max"][1] < 0.21)
    scale = PRADO_REAL["wheelbase"] / (np.mean(tyre_z[2:]) - np.mean(tyre_z[:2]))
    pos = pos * scale
    isl = islands(pos, tris, tri_comp)
    pad = 0.005 * scale
    tyres = [k for k, v in isl.items() if 1300 < v["n"] < 1400 and v["min"][1] < 0.05 * scale]
    assert len(tyres) == 4, tyres
    used = set()
    wheels = []
    for t in tyres:
        mn, mx = isl[t]["min"] - pad, isl[t]["max"] + pad
        members = [k for k, v in isl.items() if (v["min"] >= mn).all() and (v["max"] <= mx).all()]
        used.update(members)
        nuts = [k for k in members if isl[k]["n"] in (33, 38)]
        cs = np.array([isl[k]["c"] for k in nuts])
        hub = cs.mean(0)
        _, sv, vt = np.linalg.svd(cs - hub)
        axis = vt[2] * np.sign(vt[2][0])
        tv = pos[np.unique(tris[isl[t]["mask"]])]
        d = tv - hub
        along = d @ axis
        centre = hub + axis * (along.min() + along.max()) / 2
        radial = np.linalg.norm(d - np.outer(along, axis), axis=1)
        wheels.append({"tyre": t, "members": members, "nuts": len(nuts), "centre": centre, "axis": axis,
                       "toe_deg": math.degrees(math.atan2(axis[2], axis[0])),
                       "camber_deg": math.degrees(math.asin(np.clip(axis[1], -1, 1))),
                       "planarity_m": float(sv[2]), "tyre_radius": float(radial.max()),
                       "tyre_width": float(np.ptp(along))})
    sw = [k for k, v in isl.items() if 1300 < v["n"] < 1400 and k not in used and v["min"][1] > 0.2 * scale]
    assert len(sw) == 1
    used.add(sw[0])
    body_ids = [k for k in isl if k not in used]
    body_main = max((isl[k] for k in body_ids), key=lambda v: v["n"])

    before = {"bbox_min": pos.min(0).round(3).tolist(), "bbox_max": pos.max(0).round(3).tolist()}
    width_body = float(max(abs(pos[(pos[:, 1] > 0.2) & (pos[:, 1] < 1.1)][:, 0])) * 2)  # excl. mirrors
    K = round(float(np.mean([PRADO_REAL["width"] / width_body, PRADO_REAL["height"] / pos[:, 1].max()])), 4)
    W = (PRADO_REAL["tyre_diameter"] / 2) / float(np.mean([w["tyre_radius"] for w in wheels]))
    report["measured"] = {"scale_from_wheelbase": round(float(scale), 4), "body_width_excl_mirrors_m": round(width_body, 3),
                          "height_m": round(float(pos[:, 1].max()), 3), "length_m": round(float(np.ptp(pos[:, 2])), 3)}
    report["correction"] = {"body_scale_xyz": [K, K, 1.0], "wheel_uniform_scale": round(W, 4)}

    mats = {n: mat(n, *p) for n, p in {
        "M_Prado_Paint": ((0.80, 0.80, 0.78), 0.0, 0.28, 1.0),
        "M_Prado_Chrome": ((0.90, 0.90, 0.92), 1.0, 0.12, 0.0),
        "M_Prado_TrimBlack": ((0.025, 0.025, 0.025), 0.0, 0.55, 0.0),
        "M_Prado_Interior": ((0.10, 0.085, 0.075), 0.0, 0.7, 0.0),
        "M_Prado_LightLens": ((0.85, 0.86, 0.88), 0.0, 0.05, 0.0),
        "M_Prado_TailLight": ((0.45, 0.02, 0.02), 0.0, 0.1, 0.0),
        "M_Prado_Tyre": ((0.03, 0.03, 0.03), 0.0, 0.9, 0.0),
        "M_Prado_Rim": ((0.55, 0.56, 0.58), 1.0, 0.3, 0.0),
    }.items()}

    root = bpy.data.objects.new("Prado", None)
    bpy.context.scene.collection.objects.link(root)
    S_body = np.array([K, K, 1.0])

    # body + interior islands, non-uniform affine (normals via inverse-transpose)
    bmask = np.isin(tri_comp, body_ids)
    names = sorted(set(classify_prado(isl[k], body_main) for k in body_ids))
    order = list(mats)
    used_mats = [m for m in order if m in names]
    tri_mat = np.zeros(len(tris), dtype=np.int32)
    class_counts = {}
    for k in body_ids:
        n = classify_prado(isl[k], body_main)
        tri_mat[isl[k]["mask"]] = used_mats.index(n)
        class_counts[n] = class_counts.get(n, 0) + isl[k]["n"]
    p2 = pos * S_body
    n2 = nrm / S_body
    n2 /= np.linalg.norm(n2, axis=1, keepdims=True)
    add_object("Body", p2, n2, tris[bmask], tri_mat[bmask], [mats[m] for m in used_mats], root)
    report["body_material_triangles"] = class_counts

    # steering wheel: same affine as the body, pivot at its centre
    swm = isl[sw[0]]["mask"]
    piv = isl[sw[0]]["c"] * S_body
    add_object("SteeringWheel", p2, n2, tris[swm], np.zeros(int(swm.sum())), [mats["M_Prado_Interior"]], root, piv)

    # wheels: straighten (rotate about own vertical axis), uniform scale, re-seat on ground
    report["wheels"] = {}
    pw, nw = pos.copy(), nrm.copy()
    # Target centres. The steered front wheels were modelled rotated about their kingpins, so
    # their centres are not mirror-symmetric (dz ~0.1 m). The body is symmetric (bbox +-x equal),
    # so each axle pair is placed symmetrically at the mean |x| and mean z of the pair.
    targets = {}
    for front in (True, False):
        pair = [w for w in wheels if (w["centre"][2] > 0) == front]
        mx_ = float(np.mean([abs(w["centre"][0]) for w in pair])) * K
        mz_ = float(np.mean([w["centre"][2] for w in pair]))
        for w in pair:
            targets[id(w)] = (math.copysign(mx_, w["centre"][0]), mz_)
    for w in wheels:
        side = "L" if w["centre"][0] > 0 else "R"
        axle = "F" if w["centre"][2] > 0 else "R"
        name = f"Wheel_{axle}{side}"
        R = rot_y(math.radians(w["toe_deg"]))
        mask = np.isin(tri_comp, w["members"])
        vid = np.unique(tris[mask])
        tx, tz = targets[id(w)]
        local = ((pos[vid] - w["centre"]) @ R.T) * W
        new_c = np.array([tx, -local[:, 1].min(), tz])  # lowest tyre point exactly on the ground (y=0)
        pw[vid] = local + new_c
        nw[vid] = nrm[vid] @ R.T
        tm = np.where(tri_comp[mask] == w["tyre"], 0, 1)
        add_object(name, pw, nw, tris[mask], tm, [mats["M_Prado_Tyre"], mats["M_Prado_Rim"]], root, new_c)
        # verify: refit nut plane after transform
        cs = np.array([pw[np.unique(tris[isl[k]["mask"]])].mean(0) for k in w["members"] if isl[k]["n"] in (33, 38)])
        _, _, vt = np.linalg.svd(cs - cs.mean(0))
        ax2 = vt[2] * np.sign(vt[2][0])
        report["wheels"][name] = {
            "lug_nuts_used": w["nuts"], "nut_plane_residual_m": round(w["planarity_m"], 4),
            "toe_before_deg": round(w["toe_deg"], 2), "camber_deg": round(w["camber_deg"], 2),
            "toe_after_deg": round(math.degrees(math.atan2(ax2[2], ax2[0])), 3),
            "tyre_diameter_before_m": round(2 * w["tyre_radius"], 3),
            "tyre_diameter_after_m": round(2 * w["tyre_radius"] * W, 3),
            "pivot_after_m": new_c.round(4).tolist(), "triangles": int(mask.sum())}
    fl, rl = report["wheels"]["Wheel_FL"]["pivot_after_m"], report["wheels"]["Wheel_RL"]["pivot_after_m"]
    fr = report["wheels"]["Wheel_FR"]["pivot_after_m"]
    allp = np.vstack([p2[np.unique(tris[bmask])], pw[np.unique(tris[~bmask & ~swm])]])
    report["after"] = {
        "length_m": round(float(np.ptp(allp[:, 2])), 3),
        "width_body_excl_mirrors_m": round(width_body * K, 3),
        "width_incl_mirrors_m": round(float(np.ptp(allp[:, 0])), 3),
        "height_m": round(float(allp[:, 1].max()), 3),
        "wheelbase_left_m": round(fl[2] - rl[2], 3),
        "track_front_m": round(fl[0] - fr[0], 3),
        "ground_min_y_m": round(float(allp[:, 1].min()), 4),
        "body_min_y_m": round(float(p2[np.unique(tris[bmask])][:, 1].min()), 3),
    }
    report["before"] = before
    report["reference_J150_facelift"] = PRADO_REAL


# ------------------------------------------------------------------- monument

MONUMENT_GROUPS = {  # island id: (expected triangles, material)
    29: (19394, "M_Mon_GoldGilded"), 25: (1392, "M_Mon_GoldGilded"), 26: (4243, "M_Mon_GoldGilded"),
    11: (294, "M_Mon_GoldGilded"), 34: (296, "M_Mon_GoldGilded"), 6: (271, "M_Mon_GoldGilded"),
    8: (252, "M_Mon_GoldGilded"), 9: (250, "M_Mon_GoldGilded"), 10: (250, "M_Mon_GoldGilded"),
    30: (250, "M_Mon_GoldGilded"), 31: (250, "M_Mon_GoldGilded"), 33: (252, "M_Mon_GoldGilded"),
    35: (278, "M_Mon_GoldGilded"), 13: (322, "M_Mon_GoldGilded"), 14: (274, "M_Mon_GoldGilded"),
    27: (322, "M_Mon_GoldGilded"), 28: (324, "M_Mon_GoldGilded"), 7: (427, "M_Mon_GoldGilded"),
    32: (426, "M_Mon_GoldGilded"), 12: (50, "M_Mon_GoldGilded"),
    24: (9232, "M_Mon_Sculpture"), 1: (4944, "M_Mon_Sculpture"), 41: (4940, "M_Mon_Sculpture"),
    22: (1620, "M_Mon_Sculpture"),
    20: (512, "M_Mon_Decor"), 23: (512, "M_Mon_Decor"), 21: (94, "M_Mon_Decor"), 19: (264, "M_Mon_Decor"),
    16: (300, "M_Mon_Decor"), 17: (588, "M_Mon_Decor"), 18: (72, "M_Mon_Decor"),
    15: (126, "M_Mon_StoneDark"), 0: (29, "M_Mon_StoneDark"), 42: (26, "M_Mon_StoneDark"),
}
CROWN = (25, 26)
ARCH = 29


def build_monument(pos, nrm, tris, tri_comp, raw, report):
    pos = pos * 43.0
    isl = islands(pos, tris, tri_comp)
    for k, (n, _) in MONUMENT_GROUPS.items():
        # expected counts are pre-cleanup (stage-1 analysis); zero-area removal may drop a few
        assert abs(isl[k]["n"] - n) <= max(2, 0.01 * n), f"island {k}: {isl[k]['n']} tris, expected ~{n} - source changed?"
    gap = float(min(isl[c]["min"][1] for c in CROWN) - isl[ARCH]["max"][1])
    intermediate = [k for k, v in isl.items() if k not in CROWN and v["max"][1] > isl[ARCH]["max"][1]]
    report["crown_gap_before_m"] = round(gap, 3)
    report["islands_between_arch_and_crown"] = intermediate
    if gap > 0.05 and not intermediate:
        vid = np.unique(tris[np.isin(tri_comp, CROWN)])
        pos[vid, 1] -= gap
        report["crown_fix"] = f"islands {list(CROWN)} translated by {-gap:.3f} m in Y (no shape change)"
    # Stage-1 scale (x43) was derived from a bbox that included the unsupported gap; re-derive it
    # so the published total height (43 m) holds for the closed-gap model.
    rescale = 43.0 / float(pos[:, 1].max())
    pos *= rescale
    report["rescale_after_crown_fix"] = round(rescale, 5)
    isl = islands(pos, tris, tri_comp)
    report["statue_height_m"] = round(float(isl[24]["max"][1] - isl[24]["min"][1]), 2)
    report["crown_gap_after_m"] = round(float(min(isl[c]["min"][1] for c in CROWN) - isl[ARCH]["max"][1]), 4)

    mats = {n: mat(n, *p) for n, p in {
        "M_Mon_GoldGilded": ((1.0, 0.766, 0.336), 1.0, 0.28),
        "M_Mon_Sculpture": ((0.80, 0.55, 0.25), 1.0, 0.38),
        "M_Mon_Decor": ((0.95, 0.70, 0.30), 1.0, 0.22),
        "M_Mon_StoneLight": ((0.62, 0.58, 0.52), 0.0, 0.6),
        "M_Mon_StoneDark": ((0.10, 0.075, 0.065), 0.0, 0.35),
    }.items()}
    order = list(mats)
    tri_mat = np.full(len(tris), order.index("M_Mon_StoneLight"), dtype=np.int32)
    counts = {}
    for k, v in isl.items():
        name = MONUMENT_GROUPS.get(k, (0, "M_Mon_StoneLight"))[1]
        tri_mat[v["mask"]] = order.index(name)
        counts[name] = counts.get(name, 0) + v["n"]
    report["material_triangles"] = counts
    root = bpy.data.objects.new("Monument_IsmoiliSomoni", None)
    bpy.context.scene.collection.objects.link(root)
    add_object("Monument_IsmoiliSomoni_Mesh", pos, nrm, tris, tri_mat, [mats[m] for m in order], root)
    report["after"] = {"height_m": round(float(pos[:, 1].max()), 3), "size_m": np.ptp(pos, axis=0).round(3).tolist()}


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    art, key, out_glb, out_json = Path(argv[0]), argv[1], Path(argv[2]), Path(argv[3])
    t0 = time.time()
    B.reset_scene()
    m = am.load(art, key)
    raw = am.analyze(m)
    tri_comp = raw.pop("tri_component")
    report = {"key": key, "version": 2, "blender": bpy.app.version_string, "fixes": []}
    pos, nrm, tris, tri_comp = clean(m, raw, tri_comp, report["fixes"])
    {"prado": build_prado, "monument": build_monument}[key](pos, nrm, tris, tri_comp, raw, report)
    report["before_export"] = B.scene_stats()
    out_glb.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_normals=True, export_texcoords=True,
                              export_tangents=False, export_animations=False)
    report["glb_bytes"] = out_glb.stat().st_size
    B.reset_scene()
    bpy.ops.import_scene.gltf(filepath=str(out_glb))
    report["after_reimport"] = B.scene_stats()
    bf, af = report["before_export"], report["after_reimport"]
    report["roundtrip"] = {"triangles_equal": bf["triangles"] == af["triangles"],
                           "mesh_objects_equal": bf["mesh_objects"] == af["mesh_objects"],
                           "materials_equal": bf["materials"] == af["materials"],
                           "uv_preserved": bf["objects_with_uv"] == af["objects_with_uv"]}
    report["seconds"] = round(time.time() - t0, 2)
    out_json.write_text(json.dumps(report, indent=1, ensure_ascii=False, default=float))
    print("ROUNDTRIP", key, json.dumps(report["roundtrip"]))


if __name__ == "__main__":
    main()
