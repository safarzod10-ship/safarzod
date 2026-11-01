"""Monument v3, step 2: geometry refinement, UV atlases, AO/cavity bakes, LODs,
collision and GLB export (Blender background, Cycles CPU).

  blender -b --factory-startup --python tools/blender/monument_v3_build.py -- \
      <elements.blend> <out_dir_source> <out.glb> <bake_dir> <report.json> [bake_px]

Input: source_assets/monument_v3/monument_elements.blend (monument_elements.py),
i.e. the CURRENT monument mesh split into named elements - shapes untouched.

What is changed (all measured / reported, nothing invented):
  * hard-surface stone (platform, pedestal, plinth caps, entablatures): welded,
    30-degree angle-limited bevel (3 cm, 2 segments) + weighted normals; the
    source had one smooth normal across 90-degree step edges, which produced the
    "melted plastic" gradients on the steps;
  * sculpture (statue, statue details, lions): one Catmull-Clark level (smooth
    silhouette at 1-2 m), custom split normals cleared, smooth shading;
  * crown, arch, pilasters, columns: no topology change, smooth-by-angle normals
    (crisp mouldings, smooth shafts);
  * arch: faces classified into outer stone shell vs. gilded ornament/trim by
    measured geometry (see classify_arch) - no new arch geometry is invented;
  * UV: two non-overlapping atlases with uniform texel density
    ("sculpt" and "arch"), used for baked AO/cavity; tiling PBR detail is
    applied in the engine (object-space triplanar) so close-up resolution does
    not depend on the atlas;
  * LOD1/LOD2: collapse decimation; geometric error measured against LOD0
    (BVH nearest-surface, p99/max) and reported as switch distances for <=1 px
    error at 1080p / 70 deg FOV;
  * collision: LOD2 of walkable/blocking parts exported with Godot's
    "-colonly" suffix (static trimesh, invisible).
"""
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
IN_BLEND, SRC_DIR, OUT_GLB, BAKE_DIR, OUT_JSON = (Path(a) for a in argv[:5])
BAKE_PX_BASE = int(argv[5]) if len(argv) > 5 else 2048
# per-atlas size: the architecture atlas covers ~5600 m2 in thousands of small islands -> 2x
ATLAS_SCALE = {"sculpt": 1, "lions": 1, "arch": 2}
BAKE_SAMPLES = int(argv[6]) if len(argv) > 6 else 64

# element -> processing
HARD_STONE = {"Base_Platform", "Statue_Pedestal", "Lion_Plinth_Caps", "Colonnade_Entablatures"}
LIONS = ("Lion_L", "Lion_R")
LION_LOD0_TRIS = 32000   # decimated from the 86k-tri old-model lions; detail kept by the baked normal map
CFG = {
    #                         subdiv bevel_m smooth_deg atlas     lod1   lod2  collision
    "Base_Platform":          (0, 0.03, None, "arch", 1.0, 0.5, True),
    "Statue_Pedestal":        (0, 0.025, None, "arch", 1.0, 0.5, True),
    "Lion_Plinth_Caps":       (0, 0.015, None, "arch", 1.0, 0.5, True),
    "Colonnade_Entablatures": (0, 0.02, None, "arch", 1.0, 0.5, True),
    "Colonnade_Columns":      (0, 0.0, 40, "arch", 0.5, 0.15, True),
    "Arch":                   (0, 0.0, 32, "arch", 0.6, 0.45, True),
    "Arch_Pilasters":         (0, 0.0, 40, "arch", 0.5, 0.15, True),
    "Statue":                 (1, 0.0, None, "sculpt", 0.25, 0.06, False),
    "Statue_Details":         (1, 0.0, None, "sculpt", 0.25, 0.06, False),
    "Statue_Sceptre":         (1, 0.0, None, "sculpt", 0.25, 0.06, False),
    "Crown":                  (0, 0.0, 35, "sculpt", 0.5, 0.15, False),
    "Crown_Base":             (0, 0.0, 35, "sculpt", 0.5, 0.15, False),
    "Lion_L":                 (0, 0.0, 180, "lions", 0.3, 0.08, True),
    "Lion_R":                 (0, 0.0, 180, "lions", 0.3, 0.08, True),
}
# material slots (names are the contract with Godot: assets/materials/monument_v3/*.tres)
M_GOLD = "M_Mon_Gold"            # gilding: arch lining (stalactites, vault cubes), rods, crown, sceptre
M_BRONZE = "M_Mon_Bronze"        # dark patinated bronze: statue, lions, crown bowl
M_ARCH = "M_Mon_ArchStone"       # light cream stone cladding of the arch frame
M_COLUMN = "M_Mon_ColumnStone"   # colonnade columns + entablatures
M_GRANITE = "M_Mon_Granite"      # red-brown polished granite: platform, steps, pedestal, plinths
ELEMENT_MAT = {
    "Base_Platform": M_GRANITE, "Statue_Pedestal": M_GRANITE, "Lion_Plinth_Caps": M_GRANITE,
    "Colonnade_Entablatures": M_COLUMN, "Colonnade_Columns": M_COLUMN, "Arch_Pilasters": M_GOLD,
    "Statue": M_BRONZE, "Statue_Details": M_BRONZE, "Statue_Sceptre": M_GOLD, "Crown": M_GOLD,
    "Crown_Base": M_BRONZE, "Lion_L": M_BRONZE, "Lion_R": M_BRONZE,
}
LIONS_HI_BLEND = Path(__file__).resolve().parents[2] / "source_assets" / "monument_v3" / "lions_from_old_hi.blend"
REPORT = {"elements": {}, "lod": {}, "bake": {}, "timing_s": {}}
T0 = time.time()


def tick(label):
    REPORT["timing_s"][label] = round(time.time() - T0, 1)
    print(f"[{time.time() - T0:7.1f}s] {label}", flush=True)


def activate(ob):
    bpy.ops.object.mode_set(mode="OBJECT") if bpy.context.object and bpy.context.object.mode != "OBJECT" else None
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def tri_count(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    me = ob.evaluated_get(dg).to_mesh()
    me.calc_loop_triangles()
    n = len(me.loop_triangles)
    ob.evaluated_get(dg).to_mesh_clear()
    return n


def apply_all(ob):
    activate(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def edit(ob, fn):
    activate(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    fn()
    bpy.ops.object.mode_set(mode="OBJECT")


# ------------------------------------------------------------------ geometry

def refine(ob):
    sub, bev, smooth, *_ = CFG[ob.name]
    before = len(ob.data.polygons)
    edit(ob, lambda: bpy.ops.mesh.remove_doubles(threshold=1e-4))
    activate(ob)
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    if bev:
        edit(ob, lambda: (bpy.ops.mesh.remove_doubles(threshold=1e-3), bpy.ops.mesh.dissolve_limited(angle_limit=math.radians(0.5))))
        stash = ob.data.copy()  # pre-bevel shape: used for LOD1/LOD2/collision of hard stone
        stash.name = f"{ob.name}_prebevel"
        stash.use_fake_user = True
        m = ob.modifiers.new("Bevel", "BEVEL")
        m.width, m.segments, m.limit_method = bev, 2, "ANGLE"
        m.angle_limit = math.radians(30)
        m.harden_normals = True
        m.miter_outer = "MITER_ARC"
        ob.data.shade_smooth()
        apply_all(ob)
        wn = ob.modifiers.new("WN", "WEIGHTED_NORMAL")
        wn.keep_sharp = True
        apply_all(ob)
    elif sub:
        m = ob.modifiers.new("Subsurf", "SUBSURF")
        m.levels = m.render_levels = sub
        m.boundary_smooth = "PRESERVE_CORNERS"
        m.use_limit_surface = True
        ob.data.shade_smooth()
        apply_all(ob)
    else:
        activate(ob)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth), keep_sharp_edges=True)
    edit(ob, lambda: bpy.ops.mesh.quads_convert_to_tris(quad_method="BEAUTY", ngon_method="BEAUTY"))
    REPORT["elements"][ob.name] = {"tris_source": before, "tris_lod0": len(ob.data.polygons),
                                   "subdivision_levels": sub, "bevel_m": bev, "smooth_by_angle_deg": smooth}


ARCH_R_INNER = 5.85      # measured: inner face of the pylons |x| (dominant inward-facing plane, 353 m2)
ARCH_R_OUTER = 8.90      # measured: outer half width of the arch
ARCH_TOP = 38.78         # measured: top of the arch (Blender Z, m)


def classify_arch(ob):
    """Split the single arch island into stone frame vs. gilded lining.

    Reference photos: the arch is a light-stone frame (front/back bands ~3.3 m
    wide and the outer sides); everything INSIDE the opening - the stepped
    'stalactites' on the pylons and the cube grid of the vault - is gilded.
    Measured on the mesh: inner pylon face at |x| = 5.85 m, outer half width
    8.90 m, top 38.78 m -> semicircular head centred at z = 38.78 - 8.90.
    A face is gold when its centre lies inside the inner contour in the
    front projection: |x| (below the springing line) or the distance from the
    arc centre (above it) is < 5.85 m + 5 cm."""
    zc = ARCH_TOP - ARCH_R_OUTER
    c = np.array([p.center[:] for p in ob.data.polygons])
    r = np.where(c[:, 2] < zc, np.abs(c[:, 0]), np.hypot(c[:, 0], c[:, 2] - zc))
    return r < ARCH_R_INNER + 0.05


def set_materials(ob, mats):
    if ob.name == "Arch":
        orn = classify_arch(ob)
        ob.data.materials.clear()
        ob.data.materials.append(mats[M_ARCH])
        ob.data.materials.append(mats[M_GOLD])
        ob.data.polygons.foreach_set("material_index", orn.astype(np.int32))
        REPORT["elements"]["Arch"]["faces_gold_ornament"] = int(orn.sum())
        REPORT["elements"]["Arch"]["faces_stone"] = int((~orn).sum())
    else:
        name = ELEMENT_MAT[ob.name]
        # one Godot material instance per (material, bake atlas): gold/bronze exist in two atlases
        atlas = CFG[ob.name][3]
        if name == M_GOLD and atlas == "sculpt":
            name = M_GOLD + "_Sculpt"
        elif name == M_BRONZE and atlas == "lions":
            name = M_BRONZE + "_Lion"
        ob.data.materials.clear()
        ob.data.materials.append(mats[name])
        ob.data.polygons.foreach_set("material_index", np.zeros(len(ob.data.polygons), np.int32))


def make_materials():
    # Blender preview values only; the in-game look comes from the Godot shader
    # (assets/shaders/monument_surface.gdshader). Colours: docs/MONUMENT_MATERIALS.md
    spec = {M_GOLD: ((0.745, 0.507, 0.150), 1.0, 0.30), M_ARCH: ((0.672, 0.591, 0.468), 0.0, 0.62),
            M_COLUMN: ((0.686, 0.665, 0.617), 0.0, 0.42), M_GRANITE: ((0.296, 0.145, 0.093), 0.0, 0.30),
            M_BRONZE: ((0.114, 0.102, 0.084), 0.6, 0.55)}
    spec[M_GOLD + "_Sculpt"] = spec[M_GOLD]
    spec[M_BRONZE + "_Lion"] = spec[M_BRONZE]
    out = {}
    for name, (rgb, met, rough) in spec.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*rgb, 1)
        b.inputs["Metallic"].default_value = met
        b.inputs["Roughness"].default_value = rough
        out[name] = m
    return out


# ------------------------------------------------------------------------ UV

def unwrap_atlas(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    if name == "arch":
        # Large U-shaped islands (arch frame bands, platform rings) left ~80 % of the atlas
        # empty. Cut them into <= GRID m pieces: unwrap temporary copies whose edges crossing a
        # world grid are physically split (smart project cannot cross a split), then copy the
        # UVs back loop-by-loop (face/loop order is unchanged by split_edges). Smart project
        # never overlaps; a conformal re-unwrap was tried and produced overlapping islands.
        bpy.ops.object.mode_set(mode="OBJECT")
        grid = 3.0
        temps = []
        for o in objs:
            t = o.copy()
            t.data = o.data.copy()
            bpy.context.scene.collection.objects.link(t)
            bm = bmesh.new()
            bm.from_mesh(t.data)
            cut = [e for e in bm.edges
                   if any(math.floor(e.verts[0].co[k] / grid) != math.floor(e.verts[1].co[k] / grid) for k in range(3))]
            bmesh.ops.split_edges(bm, edges=cut)
            bm.to_mesh(t.data)
            bm.free()
            temps.append(t)
        bpy.ops.object.select_all(action="DESELECT")
        for t in temps:
            t.select_set(True)
        bpy.context.view_layer.objects.active = temps[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.average_islands_scale()
        bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, shape_method="CONCAVE",
                                margin_method="FRACTION", margin=0.0015)
        bpy.ops.object.mode_set(mode="OBJECT")
        for o, t in zip(objs, temps):
            assert len(o.data.polygons) == len(t.data.polygons)
            src, dst = t.data.uv_layers.active.data, o.data.uv_layers.active.data
            for po, pt in zip(o.data.polygons, t.data.polygons):
                for lo, lt in zip(po.loop_indices, pt.loop_indices):
                    dst[lo].uv = src[lt].uv
            bpy.data.objects.remove(t)
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.object.mode_set(mode="OBJECT")
        unwrap_report(objs, name)
        return
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(udim_source="CLOSEST_UDIM", rotate=True, shape_method="CONCAVE",
                            margin_method="FRACTION", margin=0.003)
    bpy.ops.object.mode_set(mode="OBJECT")
    unwrap_report(objs, name)


def unwrap_report(objs, name):
    """Texel density + overlap check (UV area must not exceed the atlas)."""
    area3d = area_uv = 0.0
    for o in objs:
        me = o.data
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        for p in me.polygons:
            idx = list(p.loop_indices)
            if len(idx) == 3:
                a, b, c = uv[idx[0]], uv[idx[1]], uv[idx[2]]
                area_uv += abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2
            area3d += p.area
    BAKE_PX = BAKE_PX_BASE * ATLAS_SCALE[name]
    px_per_m = math.sqrt(area_uv * BAKE_PX * BAKE_PX / max(area3d, 1e-9))
    # overlap check: rasterise UV triangles (texel centres, 512^2), count coverage per texel
    R = 512
    cnt = np.zeros((R, R), np.int32)
    for o in objs:
        me = o.data
        uv = np.empty(len(me.loops) * 2, np.float32)
        me.uv_layers.active.data.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2) * R - 0.5
        for p in me.polygons:
            a, b, c = (uv[i] for i in p.loop_indices)
            x0, x1 = int(max(0, math.floor(min(a[0], b[0], c[0])))), int(min(R - 1, math.ceil(max(a[0], b[0], c[0]))))
            y0, y1 = int(max(0, math.floor(min(a[1], b[1], c[1])))), int(min(R - 1, math.ceil(max(a[1], b[1], c[1]))))
            if x1 < x0 or y1 < y0:
                continue
            X, Y = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
            d = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
            if abs(d) < 1e-12:
                continue
            l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / d
            l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / d
            inside = (l1 > 0) & (l2 > 0) & (1 - l1 - l2 > 0)
            cnt[Y[inside], X[inside]] += 1
    covered = int((cnt > 0).sum())
    overlap = float((cnt > 1).sum()) / max(covered, 1)
    REPORT["bake"][name] = {"objects": [o.name for o in objs], "surface_m2": round(area3d, 1),
                            "uv_texels_covered_frac": round(covered / R / R, 3), "uv_overlap_frac": round(overlap, 4),
                            "uv_coverage": round(area_uv, 3), "atlas_px": BAKE_PX,
                            "texels_per_m": round(px_per_m, 1), "cm_per_texel": round(100 / px_per_m, 2)}


# ---------------------------------------------------------------------- bake

def bake_atlas(objs, name):
    """R = large-scale AO (4 m), G = local AO / cavity (0.25 m), B = convexity
    (Cycles pointiness, 0.5 = flat). Linear data, 16-bit source PNG."""
    imgs = {}
    BAKE_PX = BAKE_PX_BASE * ATLAS_SCALE[name]
    for ch in ("ao_large", "ao_local", "convex"):
        imgs[ch] = bpy.data.images.new(f"{name}_{ch}", BAKE_PX, BAKE_PX, float_buffer=True, alpha=False)
        imgs[ch].colorspace_settings.name = "Non-Color"
    saved = {o.name: [s.material for s in o.material_slots] for o in objs}
    saved_idx = {o.name: np.array([p.material_index for p in o.data.polygons]) for o in objs}
    bm = bpy.data.materials.new(f"BAKE_{name}")
    bm.use_nodes = True
    nt = bm.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.nodes.active = tex
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    ramp = nt.nodes.new("ShaderNodeMapRange")  # pointiness ~0.45..0.55 -> 0..1
    ramp.inputs["From Min"].default_value, ramp.inputs["From Max"].default_value = 0.42, 0.58
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(geo.outputs["Pointiness"], ramp.inputs["Value"])
    nt.links.new(ramp.outputs["Result"], emit.inputs["Color"])
    nt.links.new(emit.outputs["Emission"], nt.nodes["Material Output"].inputs["Surface"])
    for o in objs:
        o.data.materials.clear()
        o.data.materials.append(bm)
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.render.bake.margin = 8
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    for ch, (btype, dist, samples) in {"ao_large": ("AO", 4.0, BAKE_SAMPLES), "ao_local": ("AO", 0.25, max(16, BAKE_SAMPLES // 2)),
                                       "convex": ("EMIT", 0, 1)}.items():
        tex.image = imgs[ch]
        sc.cycles.samples = samples
        if dist:
            sc.world.light_settings.distance = dist
        t = time.time()
        bpy.ops.object.bake(type=btype, use_clear=True, margin=8)
        REPORT["bake"][name][f"{ch}_seconds"] = round(time.time() - t, 1)
        tick(f"bake {name} {ch}")
    px = [np.array(imgs[c].pixels[:], dtype=np.float32).reshape(BAKE_PX, BAKE_PX, 4)[..., 0] for c in imgs]
    rgb = np.clip(np.stack(px, -1), 0, 1)
    np.save(BAKE_DIR / f"{name}_bake.npy", (rgb * 65535).astype(np.uint16))  # converted to PNG outside Blender
    if name == "lions":
        # exact transfer of the old model's surface detail: the LOD0 lion IS the decimated
        # old lion, so the old 86k-tri surface + its 4K normal map project onto it 1:1.
        nimg = bpy.data.images.new("lions_normal", BAKE_PX, BAKE_PX, float_buffer=True, alpha=False)
        nimg.colorspace_settings.name = "Non-Color"
        tex.image = nimg
        sc.cycles.samples = 4
        sc.render.bake.use_selected_to_active = True
        sc.render.bake.use_cage = False
        sc.render.bake.cage_extrusion = 0.04
        sc.render.bake.max_ray_distance = 0.12
        t = time.time()
        for i, lo in enumerate(objs):
            hi = bpy.data.objects[f"{lo.name}_old_hi"]
            hi.hide_render = False
            bpy.ops.object.select_all(action="DESELECT")
            hi.select_set(True)
            lo.select_set(True)
            bpy.context.view_layer.objects.active = lo
            bpy.ops.object.bake(type="NORMAL", normal_space="TANGENT", use_clear=(i == 0), margin=8,
                                use_selected_to_active=True, cage_extrusion=0.04, max_ray_distance=0.12)
            hi.hide_render = True
        sc.render.bake.use_selected_to_active = False
        n = np.array(nimg.pixels[:], dtype=np.float32).reshape(BAKE_PX, BAKE_PX, 4)[..., :3]
        np.save(BAKE_DIR / "lions_normal.npy", (np.clip(n, 0, 1) * 65535).astype(np.uint16))
        REPORT["bake"][name]["normal_seconds"] = round(time.time() - t, 1)
        tick("bake lions normal (from old model)")
    REPORT["bake"][name]["mean_rgb"] = rgb.reshape(-1, 3).mean(0).round(3).tolist()
    for o in objs:
        o.data.materials.clear()
        for m in saved[o.name]:
            o.data.materials.append(m)
        o.data.polygons.foreach_set("material_index", saved_idx[o.name].astype(np.int32))
    bpy.data.materials.remove(bm)


# ----------------------------------------------------------------------- LOD

def surface_samples(ob, n):
    me = ob.data
    me.calc_loop_triangles()
    co = np.array([v.co[:] for v in me.vertices])
    t = np.array([lt.vertices[:] for lt in me.loop_triangles])
    a, b, c = co[t[:, 0]], co[t[:, 1]], co[t[:, 2]]
    ar = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    rng = np.random.default_rng(7)
    i = rng.choice(len(t), n, p=ar / ar.sum())
    u = rng.random((n, 2))
    f = u.sum(1) > 1
    u[f] = 1 - u[f]
    return a[i] + (b[i] - a[i]) * u[:, :1] + (c[i] - a[i]) * u[:, 1:]


def lod_error(src, lod, n=20000):
    bvh = BVHTree.FromObject(lod, bpy.context.evaluated_depsgraph_get())
    d = np.array([(Vector(p) - bvh.find_nearest(Vector(p))[0]).length for p in surface_samples(src, n)])
    return {"mean_m": round(float(d.mean()), 4), "p99_m": round(float(np.quantile(d, 0.99)), 4),
            "max_m": round(float(d.max()), 4)}


PX_PER_M_AT_1M = 1080 / (2 * math.tan(math.radians(70) / 2))  # ~771 px


def make_lod(ob, ratio, level):
    lod = ob.copy()
    lod.data = ob.data.copy()
    lod.name = f"{ob.name}_LOD{level}"
    bpy.context.scene.collection.objects.link(lod)
    if ob.name in HARD_STONE:
        # planar parts: the LODs are the welded pre-bevel blocks (bevels are 1.5-3 cm,
        # sub-pixel beyond the measured switch distance), flat faces / sharp edges
        mats = list(lod.data.materials)
        lod.data = bpy.data.meshes[f"{ob.name}_prebevel"].copy()
        for m in mats:
            lod.data.materials.append(m)
        uv_from = ob  # transfer the atlas UVs from LOD0 (nearest face) so the AO bake applies
        dt = lod.modifiers.new("UV", "DATA_TRANSFER")
        dt.object = uv_from
        dt.use_loop_data = True
        dt.data_types_loops = {"UV"}
        dt.loop_mapping = "POLYINTERP_NEAREST"
        apply_all(lod)
        edit(lod, lambda: bpy.ops.mesh.quads_convert_to_tris())
        activate(lod)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(30))
        return lod
    m = lod.modifiers.new("Dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = ratio
    m.use_collapse_triangulate = True
    m.use_symmetry = True
    m.symmetry_axis = "X"
    apply_all(lod)
    return lod


# -------------------------------------------------------------------- main

def main():
    BAKE_DIR.mkdir(parents=True, exist_ok=True)
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(IN_BLEND))
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    root = bpy.data.objects["Monument_IsmoiliSomoni"]
    # sitting lions (current model) -> lying lions (old model, photo-correct); see monument_lions_from_old.py
    for n in LIONS:
        bpy.data.objects.remove(bpy.data.objects[n])
    with bpy.data.libraries.load(str(LIONS_HI_BLEND)) as (src, dst):
        dst.objects = [f"{n}_old_hi" for n in LIONS]
    for hi in dst.objects:
        sc.collection.objects.link(hi)
        hi.hide_render = True
        lo = hi.copy()
        lo.data = hi.data.copy()
        lo.name = hi.name.replace("_old_hi", "")
        lo.hide_render = False
        lo.data.name = lo.name
        sc.collection.objects.link(lo)
        lo.parent = root
        lo.data.uv_layers.remove(lo.data.uv_layers[0])  # new atlas UVs are made below
        lo.data.materials.clear()
        m = lo.modifiers.new("Dec", "DECIMATE")
        m.decimate_type = "COLLAPSE"
        m.ratio = LION_LOD0_TRIS / len(hi.data.polygons)
        m.use_collapse_triangulate = True
        apply_all(lo)
        REPORT.setdefault("lions_from_old", {})[lo.name] = {"hi_tris": len(hi.data.polygons), "lod0_tris": len(lo.data.polygons)}
    objs = [o for o in sc.objects if o.type == "MESH" and not o.name.endswith("_old_hi")]
    for o in objs:
        refine(o)
    tick("geometry")
    mats = make_materials()
    for o in objs:
        set_materials(o, mats)
    tick("materials")
    atlases = {a: [o for o in objs if CFG[o.name][3] == a] for a in ("sculpt", "lions", "arch")}
    for a, group in atlases.items():
        unwrap_atlas(group, a)
    tick("uv")
    for a, group in atlases.items():
        bake_atlas(group, a)
    for n in LIONS:  # bake sources only (kept in lions_from_old_hi.blend)
        bpy.data.objects.remove(bpy.data.objects[f"{n}_old_hi"])
    # high-quality source (LOD0 only, before LOD/collision objects are added)
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC_DIR / "monument_v3_lod0_source.blend"), compress=True)
    tick("save source")

    lod_roots = {}
    for lvl in (0, 1, 2):
        e = bpy.data.objects.new(f"LOD{lvl}", None)
        e.parent = root
        sc.collection.objects.link(e)
        lod_roots[lvl] = e
    col_parts = []
    for o in objs:
        _, _, _, _, r1, r2, coll = CFG[o.name]
        l1 = make_lod(o, r1, 1)
        l2 = make_lod(o, r2, 2)
        for lod, lvl in ((l1, 1), (l2, 2)):
            lod.parent = lod_roots[lvl]
        e1, e2 = lod_error(o, l1), lod_error(o, l2)
        REPORT["lod"][o.name] = {
            "tris": [len(o.data.polygons), len(l1.data.polygons), len(l2.data.polygons)],
            "lod1_error": e1, "lod2_error": e2,
            # distance at which the p99 error projects to 1 px (1080p, 70 deg vfov)
            "lod1_min_distance_m_1px": round(e1["p99_m"] * PX_PER_M_AT_1M, 1),
            "lod2_min_distance_m_1px": round(e2["p99_m"] * PX_PER_M_AT_1M, 1),
        }
        if coll:
            col_parts.append(l2)
        o.name = f"{o.name}_LOD0"
        o.parent = lod_roots[0]
    tick("lods")
    # collision: join copies of the LOD2 parts into one invisible trimesh
    copies = []
    for p in col_parts:
        c = p.copy()
        c.data = p.data.copy()
        sc.collection.objects.link(c)
        copies.append(c)
    bpy.ops.object.select_all(action="DESELECT")
    for c in copies:
        c.select_set(True)
    bpy.context.view_layer.objects.active = copies[0]
    bpy.ops.object.join()
    colm = bpy.context.view_layer.objects.active
    colm.name = "Monument_Collision-colonly"
    colm.parent = root
    colm.data.materials.clear()
    while colm.data.uv_layers:  # collision needs positions only (no unused attributes in the GLB)
        colm.data.uv_layers.remove(colm.data.uv_layers[0])
    REPORT["collision_tris"] = len(colm.data.polygons)
    tick("collision")
    totals = {lvl: sum(len(o.data.polygons) for o in sc.objects if o.type == "MESH" and o.parent == lod_roots[lvl]) for lvl in (0, 1, 2)}
    REPORT["lod_totals_tris"] = totals
    bpy.ops.export_scene.gltf(filepath=str(OUT_GLB), export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_normals=True, export_texcoords=True,
                              export_tangents=False, export_animations=False, export_extras=False)
    # tangents: generated by Godot on import (meshes/ensure_tangents, MikkTSpace - the same
    # algorithm Blender used for the lion normal bake); exporting them gave zero-length
    # tangents on degenerate UV slivers and "unused tangent" warnings (no glTF normal textures)
    REPORT["glb_bytes"] = OUT_GLB.stat().st_size
    tick("export")
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC_DIR / "monument_v3_full.blend"), compress=True)
    OUT_JSON.write_text(json.dumps(REPORT, indent=1, ensure_ascii=False))
    print("V3 DONE", json.dumps(totals))


main()
