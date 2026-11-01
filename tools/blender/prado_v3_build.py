"""Toyota Land Cruiser Prado J150 (2nd facelift, 2017-2023) - v3 rework of the existing mesh.

  blender -b --factory-startup --python tools/blender/prado_v3_build.py -- \
      <prado_v2.glb> <out_dir_source> <out.glb> <bake_dir> <report.json> [bake_px] [samples]

Base: the stage-2 GLB (wheels straightened, J150 width/height). Coordinates: Blender Z-up,
metres, FRONT = -Y, LEFT side (driver, LHD) = +X, ground z = 0. Every number used below is a
measurement of the mesh (ray-cast depth maps, see docs/PRADO_V3.md) or a published J150 figure
(docs/PRADO_REFERENCE_RESEARCH.md).

Steps
  body      overhangs stretched to the factory length (wheelbase/arches untouched), pseudo-glass
            (window openings filled with paint faces) and the old interior removed, normals split
            by angle + weighted normals (source had one smooth normal across 90 deg creases)
  panels    front/rear doors, hood, tailgate cut out with straight planes, 4 mm shut-line gap +
            3 cm dark return flange, hinge pivots (Empty parents) for animation
  glass     new glass surfaces fitted to the measured openings (tumblehome / windshield /
            backlight surfaces from the depth maps), separate objects, two glass materials
  lights    head/tail lamp faces split into their own objects
  wheels    new tyres (265/65 R17 tread blocks, sidewall bulge), 6-spoke alloy, 6 lug nuts,
            brake disc + caliper (caliper on a non-rotating hub node)
  interior  procedural cabin from J150 dimensions (seats, dash, wheel, console, door cards ...)
  bake/LOD  AO atlas, LOD1/LOD2, collision, GLB export
"""
import json
import math
import sys
import time
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:]
SRC_GLB, SRC_DIR, OUT_GLB, BAKE_DIR, OUT_JSON = (Path(a) for a in argv[:5])
BAKE_PX = int(argv[5]) if len(argv) > 5 else 2048
BAKE_SAMPLES = int(argv[6]) if len(argv) > 6 else 48
REPORT = {"timing_s": {}}
T0 = time.time()

FRONT_AXLE_Y, REAR_AXLE_Y = -1.3631, 1.4310          # from docs/reports/prado_v2.json (glTF z -> -Y)
LENGTH_TARGET = 4.78                                   # J150 2017+ without spare-wheel cover (research)
FLOOR_Z = 0.52


def tick(label):
    REPORT["timing_s"][label] = round(time.time() - T0, 1)
    print(f"[{time.time() - T0:7.1f}s] {label}", flush=True)


def activate(ob):
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_mods(ob):
    activate(ob)
    for m in list(ob.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def link(ob, parent=None):
    bpy.context.scene.collection.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def obj_from_bm(name, bm, mat=None, parent=None, smooth_angle=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    if mat:
        me.materials.append(mat)
    if smooth_angle is not None:
        activate(ob)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(smooth_angle))
    return ob


# ---------------------------------------------------------------- materials (Blender preview)
MATS = {}


def mat(name, rgb, metal=0.0, rough=0.5, alpha=1.0, coat=0.0, emit=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if coat:
        b.inputs["Coat Weight"].default_value = coat
        b.inputs["Coat Roughness"].default_value = 0.03
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    if emit:
        b.inputs["Emission Color"].default_value = (*rgb, 1)
        b.inputs["Emission Strength"].default_value = emit
    MATS[name] = m
    return m


def materials():
    # names = contract with Godot (assets/materials/prado_v3/*.tres); colours: PRADO_REFERENCE_RESEARCH.md
    mat("M_Prado_Paint", (0.86, 0.86, 0.84), 0.0, 0.32, coat=1.0)          # Super White II 040
    mat("M_Prado_Chrome", (0.9, 0.9, 0.92), 1.0, 0.08)
    mat("M_Prado_TrimBlack", (0.03, 0.03, 0.03), 0.0, 0.55)
    mat("M_Prado_GapDark", (0.012, 0.012, 0.012), 0.0, 0.8)
    mat("M_Prado_Glass_Tint", (0.02, 0.025, 0.025), 0.0, 0.02, alpha=0.8)   # 20 % VLT
    mat("M_Prado_Glass_Clear", (0.1, 0.12, 0.11), 0.0, 0.02, alpha=0.25)   # windshield ~75 % VLT
    mat("M_Prado_LightLens", (0.85, 0.86, 0.88), 0.0, 0.05)
    mat("M_Prado_TailLight", (0.45, 0.02, 0.02), 0.0, 0.1)
    mat("M_Prado_Tyre", (0.03, 0.03, 0.03), 0.0, 0.88)
    mat("M_Prado_Rim", (0.62, 0.63, 0.65), 1.0, 0.28)
    mat("M_Prado_Brake", (0.25, 0.25, 0.26), 1.0, 0.45)
    mat("M_Prado_Leather_Beige", (0.62, 0.52, 0.40), 0.0, 0.55)
    mat("M_Prado_Dash_Graphite", (0.06, 0.06, 0.065), 0.0, 0.6)
    mat("M_Prado_Trim_BeigeGrey", (0.50, 0.46, 0.40), 0.0, 0.65)
    mat("M_Prado_Leather_Black", (0.03, 0.03, 0.03), 0.0, 0.5)
    mat("M_Prado_Console_Dark", (0.045, 0.045, 0.05), 0.0, 0.45)
    mat("M_Prado_Metal_Insert", (0.55, 0.55, 0.57), 1.0, 0.3)
    mat("M_Prado_Headliner", (0.72, 0.67, 0.58), 0.0, 0.9)
    mat("M_Prado_Carpet", (0.09, 0.09, 0.095), 0.0, 0.95)
    mat("M_Prado_Screen", (0.01, 0.015, 0.02), 0.0, 0.08, emit=0.0)
    mat("M_Prado_Belt", (0.08, 0.08, 0.085), 0.0, 0.7)


# ---------------------------------------------------------------- body

def stretch_y(co):
    """Piecewise-linear stretch of the overhangs only (outside the wheel arches)."""
    y = co[:, 1]
    fy0, ry0 = FRONT_AXLE_Y - 0.48, REAR_AXLE_Y + 0.48       # arch edges (tyre r 0.39 + 9 cm)
    ymin, ymax = y.min(), y.max()
    extra = LENGTH_TARGET - (ymax - ymin)
    f_len, r_len = fy0 - ymin, ymax - ry0
    kf = 1 + extra * f_len / (f_len + r_len) / f_len
    kr = 1 + extra * r_len / (f_len + r_len) / r_len
    out = co.copy()
    m = y < fy0
    out[m, 1] = fy0 + (y[m] - fy0) * kf
    m = y > ry0
    out[m, 1] = ry0 + (y[m] - ry0) * kr
    REPORT["stretch"] = {"length_before": round(float(ymax - ymin), 3), "length_after": round(float(out[:, 1].ptp()), 3),
                         "front_overhang_scale": round(kf, 3), "rear_overhang_scale": round(kr, 3)}
    return out


def window_polys():
    """Side daylight openings (y, z) of the LEFT side, measured on the side depth map."""
    return {
        "Glass_FrontDoor": [(-0.39, 1.235), (0.29, 1.235), (0.30, 1.665), (0.02, 1.645), (-0.13, 1.585),
                            (-0.31, 1.47), (-0.40, 1.34)],
        "Glass_RearDoor": [(0.40, 1.235), (1.12, 1.235), (1.12, 1.665), (0.40, 1.67)],
        "Glass_Quarter": [(1.33, 1.31), (1.70, 1.33), (1.78, 1.46), (1.79, 1.54), (1.75, 1.62), (1.72, 1.68),
                          (1.22, 1.68), (1.24, 1.55), (1.31, 1.40)],
    }


def inside(poly, y, z):
    n, c = len(poly), False
    j = n - 1
    for i in range(n):
        yi, zi = poly[i]
        yj, zj = poly[j]
        if (zi > z) != (zj > z) and y < (yj - yi) * (z - zi) / (zj - zi + 1e-12) + yi:
            c = not c
        j = i
    return c


def tumble_x(z):
    return 0.795 - 0.34 * (z - 1.20)          # side-glass surface x(z), measured (0.79 @1.20 .. 0.62 @1.70)


def windshield_y(x, z):
    return -1.09 + (z - 1.22) * 1.96 + 0.25 * x * x     # fitted to the front depth map


def backlight_y(x, z):
    return 2.17 - (z - 1.22) * 0.56 - 0.12 * x * x       # fitted to the back depth map


def body(b):
    me = b.data
    co = np.array([v.co[:] for v in me.vertices])
    co = stretch_y(co)
    me.vertices.foreach_set("co", co.astype(np.float32).ravel())
    me.update()
    polys = window_polys()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    # orient the shell OUTWARDS: the source has inconsistently wound faces (AO bake rays went into the
    # cabin, offsets went the wrong way). Reference = direction from the car's centre line segment.
    flipped = []
    for f in bm.faces:
        c = f.calc_center_median()
        r = c - Vector((0.0, max(-1.75, min(1.95, c.y)), max(0.55, min(1.35, c.z))))
        if r.length > 1e-3 and f.normal.dot(r) < 0:
            flipped.append(f)
    bmesh.ops.reverse_faces(bm, faces=flipped)
    REPORT["faces_flipped_outwards"] = len(flipped)
    # straight cuts along every opening outline first -> clean, straight glass edges
    def cut(co_, no_):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co_, plane_no=no_)
    for poly in polys.values():
        for i in range(len(poly)):
            (y0, z0), (y1, z1) = poly[i], poly[(i + 1) % len(poly)]
            cut(Vector((0, y0, z0)), Vector((0, -(z1 - z0), y1 - y0)).normalized())
    for zc in (1.235, 1.71, 1.72):
        cut(Vector((0, 0, zc)), Vector((0, 0, 1)))
    for sx in (-1, 1):   # windshield sides (0.74 @1.235 -> 0.62 @1.71) and backlight sides (0.60 -> 0.57)
        cut(Vector((sx * 0.74, 0, 1.235)), Vector((0.475, 0, sx * 0.12)).normalized() * sx)
        cut(Vector((sx * 0.60, 0, 1.24)), Vector((0.48, 0, sx * 0.03)).normalized() * sx)
    mats = [m.name for m in me.materials]
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        n = f.normal
        nm = mats[f.material_index] if f.material_index < len(mats) else ""
        if nm == "M_Prado_Interior":
            kill.append(f)                                  # old crude interior
        elif abs(c.x) < 0.72 and -1.0 < c.y < 2.0 and FLOOR_Z + 0.02 < c.z < 1.62:
            kill.append(f)                                  # shell faces modelled INSIDE the cabin (old dash etc.)
        elif abs(c.x) > 0.5 and any(inside(p, c.y, c.z) for p in polys.values()) and abs(n.x) > 0.5:
            kill.append(f)                                  # pseudo side glass
        elif 1.235 < c.z < 1.71 and abs(c.x) < 0.74 - 0.12 * (c.z - 1.235) / 0.475 and c.y < -0.1 \
                and abs(c.y - windshield_y(c.x, c.z)) < 0.12:
            kill.append(f)                                  # pseudo windshield
        elif 1.24 < c.z < 1.72 and abs(c.x) < 0.60 - 0.03 * (c.z - 1.24) / 0.48 and c.y > 1.75 and n.y > 0.2:
            kill.append(f)                                  # pseudo backlight (any rear-facing face in the opening)
    REPORT["pseudo_glass_and_old_interior_faces_removed"] = len(kill)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    activate(b)
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32), keep_sharp_edges=True)
    wn = b.modifiers.new("WN", "WEIGHTED_NORMAL")
    wn.keep_sharp = True
    apply_mods(b)


# ---------------------------------------------------------------- panels

def bisect(ob, co, no):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
    bm.to_mesh(ob.data)
    bm.free()


DOOR_POLYS = {  # side view (y, z) outlines of the opening panels (left side; mirrored), J150 layout fitted to the mesh
    # cut at the belt line: the source window frames are too irregular to separate cleanly (shards);
    # the frames stay on the body (documented limitation), the glass is parented to the door
    "Door_FL": [(-0.82, 0.47), (0.33, 0.47), (0.33, 1.235), (-0.82, 1.235)],
    "Door_RL": [(0.36, 0.47), (0.93, 0.47), (0.96, 0.72), (1.12, 0.92), (1.13, 1.235), (0.36, 1.235)],
}


def split_panel(body_ob, name, select, pivot, parent, gap=0.004, flange=0.03):
    """Move the faces chosen by `select(center, normal)` into a new object with a shut-line
    gap and a dark return flange, pivot = hinge position (object origin)."""
    bm = bmesh.new()
    bm.from_mesh(body_ob.data)
    faces = [f for f in bm.faces if select(f.calc_center_median(), f.normal)]
    keep = set(faces)
    nb = bmesh.new()
    vmap = {}
    for f in faces:
        vs = []
        for v in f.verts:
            if v not in vmap:
                vmap[v] = nb.verts.new(v.co - pivot)
            vs.append(vmap[v])
        try:
            nf = nb.faces.new(vs)
            nf.material_index = f.material_index
            nf.smooth = f.smooth
        except ValueError:
            pass
    bmesh.ops.delete(bm, geom=list(keep), context="FACES")
    bm.to_mesh(body_ob.data)
    bm.free()
    # shut-line: shrink the panel boundary inwards by `gap`, add a dark flange
    nb.verts.ensure_lookup_table()
    bnd = [e for e in nb.edges if e.is_boundary]
    for e in bnd:
        for v in e.verts:
            ln = [x for x in v.link_edges if not x.is_boundary]
            if ln:
                d = Vector((0, 0, 0))
                for x in ln:
                    d += (x.other_vert(v).co - v.co).normalized()
                v.co += d.normalized() * gap
    nb.normal_update()
    ret = bmesh.ops.extrude_edge_only(nb, edges=bnd)
    newv = [x for x in ret["geom"] if isinstance(x, bmesh.types.BMVert)]
    for v in newv:
        w = v.co + pivot                               # world position (panel verts are pivot-relative)
        inward = Vector((0.0, max(-1.75, min(1.95, w.y)), max(0.55, min(1.35, w.z)))) - w
        v.co += inward.normalized() * flange           # return flange goes INTO the car
    for f in [x for x in ret["geom"] if isinstance(x, bmesh.types.BMFace)]:
        f.material_index = 99   # flange marker -> dark material below
    me = bpy.data.meshes.new(name)
    nb.to_mesh(me)
    nb.free()
    for m in body_ob.data.materials:
        me.materials.append(m)
    me.materials.append(MATS["M_Prado_GapDark"])
    gi = len(me.materials) - 1
    for p in me.polygons:
        if p.material_index == 99 or p.material_index >= gi:
            p.material_index = gi
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = pivot
    activate(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(32), keep_sharp_edges=True)
    REPORT.setdefault("panels", {})[name] = {"faces": len(faces), "pivot": [round(v, 3) for v in pivot]}
    return ob


def panels(b, root):
    # straight cut lines first (so shut lines are straight, not triangle-jagged)
    for poly in DOOR_POLYS.values():
        for i in range(len(poly)):
            (y0, z0), (y1, z1) = poly[i], poly[(i + 1) % len(poly)]
            t = Vector((0, y1 - y0, z1 - z0))
            n = Vector((0, -t.z, t.y)).normalized()
            bisect(b, Vector((0, y0, z0)), n)
    for x in (-0.80, 0.80):
        bisect(b, Vector((x, 0, 0)), Vector((1, 0, 0)))          # hood / fender seams
    bisect(b, Vector((0, -1.07, 0)), Vector((0, 1, 0.35)))         # hood rear edge (cowl)
    for x in (-0.66, 0.66):
        bisect(b, Vector((x, 0, 0)), Vector((1, 0, 0)))          # tailgate sides
    bisect(b, Vector((0, 0, 0.56)), Vector((0, 0, 1)))             # tailgate bottom (bumper top)
    out = {}
    for name, poly in DOOR_POLYS.items():
        for side, sx in (("L", 1), ("R", -1)):
            nm = name[:-1] + side
            hinge = Vector((sx * 0.86, poly[0][0] + 0.02, 1.0))     # front edge, mid height (doors hinge at the front)
            out[nm] = split_panel(b, nm, lambda c, n, poly=poly, sx=sx: c.x * sx > 0.55 and abs(n.x) > 0.35
                                  and inside(poly, c.y, c.z), hinge, root)
    hood_pivot = Vector((0, -1.06, 1.20))                           # hinge at the cowl
    out["Hood"] = split_panel(b, "Hood", lambda c, n: abs(c.x) < 0.79 and c.y < -1.08 and c.z > 0.98 and n.z > 0.35,
                              hood_pivot, root)
    tg_pivot = Vector((-0.66, 2.20, 1.10))                          # J150 tailgate: side-hinged (right side, LHD)
    out["Tailgate"] = split_panel(b, "Tailgate", lambda c, n: abs(c.x) < 0.65 and c.y > 1.95 and 0.57 < c.z < 1.80
                                  and n.y > 0.4, tg_pivot, root)
    return out


# ---------------------------------------------------------------- glass

def glass_surface(name, outline, surf, m, parent, res=0.04, offset=0.0):
    """Grid inside a 2-D outline (u, v) mapped to 3-D by surf(u, v) -> Vector."""
    us = [p[0] for p in outline]
    vs = [p[1] for p in outline]
    bm = bmesh.new()
    grid = {}
    nu, nv = int((max(us) - min(us)) / res) + 2, int((max(vs) - min(vs)) / res) + 2
    for i in range(nu):
        for j in range(nv):
            u, v = min(us) + i * res, min(vs) + j * res
            if inside(outline, u, v):
                grid[i, j] = bm.verts.new(surf(u, v))
    for (i, j), v00 in grid.items():
        q = [grid.get(k) for k in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
        if all(q):
            bm.faces.new(q)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = obj_from_bm(name, bm, m, parent)
    activate(ob)
    bpy.ops.object.shade_smooth()
    s = ob.modifiers.new("Solid", "SOLIDIFY")
    s.thickness, s.offset = 0.005, 0.0
    apply_mods(ob)
    return ob


def glass(root, doors):
    tint, clear = MATS["M_Prado_Glass_Tint"], MATS["M_Prado_Glass_Clear"]
    out = []
    for nm, poly in window_polys().items():
        for side, sx in (("L", 1), ("R", -1)):
            parent = doors.get("Door_FL" if "Front" in nm else "Door_RL") if "Door" in nm else root
            parent = doors.get(("Door_F" if "Front" in nm else "Door_R") + side) if "Door" in nm else root
            ob = glass_surface(f"{nm}_{side}", poly, lambda y, z, sx=sx: Vector((sx * (tumble_x(z) - 0.01), y, z)), tint, None)
            if parent is not root and parent is not None:     # glass moves with its door
                ob.parent = parent
                ob.matrix_parent_inverse = parent.matrix_world.inverted()
            else:
                ob.parent = root
            out.append(ob)
    ws = [(-0.74, 1.235), (0.74, 1.235), (0.62, 1.71), (-0.62, 1.71)]
    out.append(glass_surface("Glass_Windshield", ws, lambda x, z: Vector((x, windshield_y(x, z) + 0.01, z)), clear, root))
    bl = [(-0.60, 1.24), (0.60, 1.24), (0.57, 1.72), (-0.57, 1.72)]
    tg = doors.get("Tailgate")
    ob = glass_surface("Glass_Backlight", bl, lambda x, z: Vector((x, backlight_y(x, z) - 0.01, z)), tint, None)
    ob.parent = tg
    ob.matrix_parent_inverse = tg.matrix_world.inverted()
    out.append(ob)
    REPORT["glass"] = {o.name: len(o.data.polygons) for o in out}
    return out


def lights(b, root):
    """Head / tail lamp faces (stage-2 material classification) become their own objects
    (needed for emissive lamps and later damage / switching)."""
    res = {}
    for nm, matname in (("Headlights", "M_Prado_LightLens"), ("TailLights", "M_Prado_TailLight")):
        idx = [i for i, m in enumerate(b.data.materials) if m.name == matname]
        bm = bmesh.new()
        bm.from_mesh(b.data)
        faces = [f for f in bm.faces if f.material_index in idx]
        sub = bmesh.new()
        vmap = {}
        for f in faces:
            vs = [vmap.setdefault(v, sub.verts.new(v.co)) for v in f.verts]
            try:
                sub.faces.new(vs)
            except ValueError:
                pass
        bmesh.ops.delete(bm, geom=faces, context="FACES")
        bm.to_mesh(b.data)
        bm.free()
        res[nm] = obj_from_bm(nm, sub, MATS[matname], root, smooth_angle=35)
    REPORT["lights"] = {k: len(v.data.polygons) for k, v in res.items()}
    return res


def brakes(root):
    """Ventilated disc + caliper per wheel on a static hub node (the wheel itself rotates)."""
    for w in ("Wheel_FL", "Wheel_FR", "Wheel_RL", "Wheel_RR"):
        wo = bpy.data.objects[w]
        c = wo.matrix_world.translation.copy()
        sx = 1 if c.x > 0 else -1
        hub = bpy.data.objects.new(w.replace("Wheel", "Hub"), None)
        link(hub, root)
        hub.location = c
        bm = bmesh.new()
        cyl_bm(bm, Vector((-sx * 0.10, 0, 0)), 0.16, 0.028, seg=40, axis="X")
        disc = obj_from_bm(w.replace("Wheel", "BrakeDisc"), bm, MATS["M_Prado_Brake"], hub, 30)
        cal = rbox(w.replace("Wheel", "Caliper"), Vector((-sx * 0.10, 0.10 if "F" in w else -0.10, 0.10)), (0.06, 0.07, 0.14),
                   MATS["M_Prado_Console_Dark"], hub, 0.012)


# ---------------------------------------------------------------- interior

def rbox(name, c, size, m, parent, bevel=0.02, seg=3, rot=None, smooth=True):
    """Rounded box (bevelled cube) - the basic upholstered / moulded part."""
    bm = bmesh.new()
    M = Matrix.Translation(c) @ ((rot.to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    ob = obj_from_bm(name, bm, m, parent)
    if bevel:
        b = ob.modifiers.new("B", "BEVEL")
        b.width, b.segments, b.limit_method = min(bevel, min(size) * 0.45), seg, "NONE"
        apply_mods(ob)
    activate(ob)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40)) if smooth else bpy.ops.object.shade_flat()
    return ob


def join(name, parts, parent):
    activate(parts[0])
    for p in parts[1:]:
        p.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.parent = parent
    return ob


def channel_stitch(ob, axis, n, depth=0.004):
    """Upholstery channels: cut the top surface into n strips along `axis` and sink the seams
    (real geometry grooves = stitch lines readable at 1 m)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    co = np.array([v.co[:] for v in bm.verts])
    lo, hi = co[:, axis].min(), co[:, axis].max()
    for k in range(1, n):
        p = Vector((0, 0, 0))
        p[axis] = lo + (hi - lo) * k / n
        no = Vector((0, 0, 0))
        no[axis] = 1
        res = bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=p, plane_no=no)
        for v in [g for g in res["geom_cut"] if isinstance(g, bmesh.types.BMVert)]:
            v.co -= v.normal * depth
    bm.to_mesh(ob.data)
    bm.free()


def seat(name, c, w, d, cushion_h, back_h, recline, parent, beige, dark, rot_y=0.0, headrests=1, bench=False):
    parts = []
    cx, cy, cz = c
    # cushion with side bolsters
    cu = rbox(name + "_cu", Vector((cx, cy, cz - cushion_h / 2)), (w * (0.78 if not bench else 1.0), d, cushion_h), beige, None, 0.04)
    channel_stitch(cu, 0, 5 if bench else 3)
    parts.append(cu)
    if not bench:
        for s in (-1, 1):
            parts.append(rbox(name + "_bol", Vector((cx + s * w * 0.44, cy, cz - cushion_h * 0.35)), (w * 0.14, d, cushion_h * 1.3), beige, None, 0.035))
    # backrest (reclined about its bottom edge)
    R = Matrix.Rotation(math.radians(recline), 3, "X")
    bc = Vector((cx, cy + d / 2 - 0.05, cz + back_h / 2 - 0.02))
    piv = Vector((cx, cy + d / 2 - 0.05, cz))
    bc = piv + R @ (bc - piv)
    ba = rbox(name + "_back", bc, (w * (0.80 if not bench else 1.0), 0.12, back_h), beige, None, 0.045, rot=R)
    channel_stitch(ba, 0, 5 if bench else 3)
    parts.append(ba)
    if not bench:
        for s in (-1, 1):
            parts.append(rbox(name + "_bb", piv + R @ (Vector((cx + s * w * 0.44, cy + d / 2 - 0.02, cz + back_h * 0.42)) - piv),
                              (w * 0.13, 0.17, back_h * 0.85), beige, None, 0.04, rot=R))
    # headrests on chrome posts
    top = piv + R @ Vector((0, 0, back_h)) - Vector((0, 0, 0))
    xs = [cx] if headrests == 1 else [cx + (k - (headrests - 1) / 2) * w / headrests for k in range(headrests)]
    for hx in xs:
        hc = Vector((hx, top.y + 0.02, top.z + 0.16))
        parts.append(rbox(name + "_hr", hc, (0.26, 0.11, 0.20), beige, None, 0.04, rot=R))
        for s in (-1, 1):
            bm = bmesh.new()
            cyl_bm(bm, Vector((hx + s * 0.07, top.y + 0.02, top.z + 0.04)), 0.006, 0.12)
            parts.append(obj_from_bm(name + "_post", bm, MATS["M_Prado_Metal_Insert"], None, 30))
    # seat base / rails
    parts.append(rbox(name + "_base", Vector((cx, cy, (FLOOR_Z + cz - cushion_h) / 2)), (w * 0.7, d * 0.8, max(0.02, cz - cushion_h - FLOOR_Z)), dark, None, 0.01))
    ob = join(name, parts, parent)
    return ob


def cyl_bm(bm, c, r, h, seg=16, axis="Z"):
    rot = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=h, matrix=Matrix.Translation(c) @ rot)


def torus_ob(name, c, R, r, m, parent, rot, seg=48, rseg=10):
    bm = bmesh.new()
    rings = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        ring = []
        for j in range(rseg):
            b = 2 * math.pi * j / rseg
            p = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b) * 1.25))
            ring.append(bm.verts.new(c + rot @ p))
        rings.append(ring)
    for i in range(seg):
        for j in range(rseg):
            bm.faces.new((rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % rseg], rings[i][(j + 1) % rseg]))
    ob = obj_from_bm(name, bm, m, parent)
    activate(ob)
    bpy.ops.object.shade_smooth()
    return ob


def steering_wheel(root):
    """3-spoke leather wheel, 380 mm, airbag pad, spoke buttons; pivot = wheel centre, the
    object's local -Y axis points along the steering column (for steering animation)."""
    centre = Vector((0.40, -0.47, 1.16))
    tilt = math.radians(-64)                      # wheel plane leans ~26 deg from vertical, faces the driver
    R = Matrix.Rotation(tilt, 3, "X")
    piv = bpy.data.objects.new("SteeringWheel_Pivot", None)
    link(piv, root)
    piv.location = centre
    piv.rotation_euler = (tilt, 0, 0)
    ident = Matrix.Identity(3)
    parts = [torus_ob("SW_rim", Vector((0, 0, 0)), 0.175, 0.016, MATS["M_Prado_Leather_Black"], None, ident)]
    parts.append(rbox("SW_hub", Vector((0, 0, 0.02)), (0.15, 0.12, 0.05), MATS["M_Prado_Leather_Black"], None, 0.02))
    for a in (0.0, math.pi, -math.pi / 2):        # spokes left, right, down
        c = Vector((0.11 * math.cos(a), 0.11 * math.sin(a), 0.0))
        parts.append(rbox("SW_spoke", c, (0.13 if a != -math.pi / 2 else 0.05, 0.05 if a != -math.pi / 2 else 0.11, 0.022),
                          MATS["M_Prado_Console_Dark"], None, 0.008))
    for s in (-1, 1):                             # button clusters (audio / cruise)
        for k in range(4):
            parts.append(rbox("SW_btn", Vector((s * (0.075 + 0.018 * (k % 2)), -0.012 + 0.024 * (k // 2), 0.014)), (0.014, 0.014, 0.006),
                              MATS["M_Prado_Metal_Insert"] if k == 0 else MATS["M_Prado_Console_Dark"], None, 0.002))
    parts.append(rbox("SW_logo", Vector((0, 0.005, 0.047)), (0.045, 0.03, 0.004), MATS["M_Prado_Chrome"], None, 0.002))
    sw = join("SteeringWheel", parts, piv)
    sw.location = (0, 0, 0)
    # column shroud (static)
    bm = bmesh.new()
    cyl_bm(bm, Vector((0, 0, -0.16)), 0.045, 0.28)
    col = obj_from_bm("SteeringColumn", bm, MATS["M_Prado_Dash_Graphite"], piv, 30)
    REPORT["steering_wheel"] = {"centre": list(centre), "diameter_m": 0.382, "tilt_from_vertical_deg": 90 - 64}
    return piv


def interior(root, b):
    beige, dark = MATS["M_Prado_Leather_Beige"], MATS["M_Prado_Carpet"]
    graph, lower = MATS["M_Prado_Dash_Graphite"], MATS["M_Prado_Trim_BeigeGrey"]
    cab = bpy.data.objects.new("Interior", None)
    link(cab, root)
    # seats: driver (+X, LHD) / passenger, 3-seat rear bench (60/40)
    seat("Seat_Driver", Vector((0.40, 0.10, 0.96)), 0.54, 0.52, 0.13, 0.70, 18, cab, beige, dark)
    seat("Seat_Passenger", Vector((-0.40, 0.10, 0.96)), 0.54, 0.52, 0.13, 0.70, 18, cab, beige, dark)
    seat("Seat_Rear", Vector((0.0, 1.02, 0.98)), 1.36, 0.50, 0.12, 0.64, 14, cab, beige, dark, headrests=3, bench=True)
    # dashboard: graphite top, beige-grey lower
    parts = [rbox("dash_top", Vector((0, -0.86, 1.13)), (1.52, 0.42, 0.12), graph, None, 0.04),
             rbox("dash_face", Vector((0, -0.72, 0.98)), (1.50, 0.16, 0.24), lower, None, 0.03),
             rbox("dash_low", Vector((0, -0.80, 0.74)), (1.46, 0.24, 0.28), lower, None, 0.03),
             rbox("cluster_hood", Vector((0.40, -0.74, 1.235)), (0.40, 0.20, 0.08), graph, None, 0.035)]
    dash = join("Dashboard", parts, cab)
    # instrument cluster: 2 dials + centre display
    for k, dx in enumerate((-0.10, 0.10)):
        bm = bmesh.new()
        cyl_bm(bm, Vector((0.40 + dx, -0.68, 1.155)), 0.058, 0.01, seg=32, axis="Y")
        obj_from_bm(f"Gauge_{k}", bm, MATS["M_Prado_Screen"], cab, 30)
        torus_ob(f"GaugeRing_{k}", Vector((0.40 + dx, -0.672, 1.155)), 0.06, 0.004, MATS["M_Prado_Metal_Insert"], cab,
                 Matrix.Rotation(math.pi / 2, 3, "X"), seg=32, rseg=6)
    rbox("Cluster_Display", Vector((0.40, -0.676, 1.15)), (0.07, 0.006, 0.06), MATS["M_Prado_Screen"], cab, 0.003)
    # centre screen (8 in), vents, climate panel
    rbox("Screen_Bezel", Vector((0, -0.705, 1.10)), (0.24, 0.03, 0.15), MATS["M_Prado_Console_Dark"], cab, 0.01)
    rbox("Screen", Vector((0, -0.688, 1.10)), (0.20, 0.004, 0.12), MATS["M_Prado_Screen"], cab, 0.002)
    for vx in (-0.17, 0.17, -0.66, 0.66):
        rbox("Vent_Frame", Vector((vx, -0.64, 1.07)), (0.11, 0.03, 0.07), MATS["M_Prado_Metal_Insert"], cab, 0.006)
        for k in range(4):
            rbox("Vent_Slat", Vector((vx, -0.63, 1.045 + k * 0.016)), (0.10, 0.02, 0.004), MATS["M_Prado_Console_Dark"], cab, 0.001)
    rbox("Climate_Panel", Vector((0, -0.66, 0.95)), (0.30, 0.03, 0.08), MATS["M_Prado_Console_Dark"], cab, 0.008)
    for k in range(6):
        rbox("Climate_Knob", Vector((-0.11 + k * 0.044, -0.645, 0.95)), (0.022, 0.012, 0.022), MATS["M_Prado_Metal_Insert"], cab, 0.004)
    # centre console with metal inserts, shifter, armrest
    rbox("Console", Vector((0, -0.12, 0.72)), (0.28, 1.02, 0.36), MATS["M_Prado_Console_Dark"], cab, 0.025)
    for s in (-1, 1):
        rbox("Console_Insert", Vector((s * 0.141, -0.25, 0.84)), (0.006, 0.60, 0.025), MATS["M_Prado_Metal_Insert"], cab, 0.002)
    rbox("Shifter_Gate", Vector((0, -0.35, 0.905)), (0.12, 0.20, 0.012), MATS["M_Prado_Metal_Insert"], cab, 0.004)
    bm = bmesh.new()
    cyl_bm(bm, Vector((0, -0.33, 0.95)), 0.012, 0.09)
    obj_from_bm("Shifter_Stem", bm, MATS["M_Prado_Metal_Insert"], cab, 30)
    rbox("Shifter_Knob", Vector((0, -0.33, 1.01)), (0.05, 0.075, 0.06), MATS["M_Prado_Leather_Black"], cab, 0.022)
    rbox("Terrain_Dial", Vector((0, -0.48, 0.905)), (0.06, 0.06, 0.02), MATS["M_Prado_Metal_Insert"], cab, 0.01)
    rbox("Armrest", Vector((0, 0.22, 0.93)), (0.26, 0.36, 0.08), beige, cab, 0.03)
    # pedals (automatic: brake + accelerator), footrest
    rbox("Pedal_Brake", Vector((0.36, -0.93, 0.66)), (0.10, 0.03, 0.08), MATS["M_Prado_Console_Dark"], cab, 0.008,
         rot=Matrix.Rotation(math.radians(-30), 3, "X"))
    rbox("Pedal_Accel", Vector((0.50, -0.95, 0.63)), (0.05, 0.02, 0.17), MATS["M_Prado_Console_Dark"], cab, 0.006,
         rot=Matrix.Rotation(math.radians(-25), 3, "X"))
    # floor carpet + mats, cargo floor
    rbox("Floor", Vector((0, 0.55, FLOOR_Z - 0.015)), (1.58, 3.10, 0.03), dark, cab, 0.005)
    for mx, my, w, d in ((0.40, -0.55, 0.52, 0.62), (-0.40, -0.55, 0.52, 0.62), (0.0, 0.62, 1.30, 0.42)):
        rbox("Mat", Vector((mx, my, FLOOR_Z + 0.006)), (w, d, 0.012), MATS["M_Prado_Leather_Black"], cab, 0.004)
    rbox("Cargo_Floor", Vector((0, 1.72, 0.66)), (1.30, 0.70, 0.04), dark, cab, 0.006)
    # rear-view mirror, sun visors, belts
    rbox("Mirror_Inner", Vector((0, -0.93, 1.60)), (0.25, 0.045, 0.07), MATS["M_Prado_Console_Dark"], cab, 0.015)
    rbox("Mirror_Glass", Vector((0, -0.905, 1.60)), (0.23, 0.004, 0.055), MATS["M_Prado_Chrome"], cab, 0.003)
    for s in (-1, 1):
        rbox("SunVisor", Vector((s * 0.36, -0.88, 1.66)), (0.34, 0.16, 0.02), MATS["M_Prado_Headliner"], cab, 0.008,
             rot=Matrix.Rotation(math.radians(-15), 3, "X"))
        # 3-point belt: pillar anchor -> across the back -> buckle
        pts = [Vector((s * 0.74, 0.30, 1.55)), Vector((s * 0.56, 0.20, 1.40)), Vector((s * 0.30, 0.18, 1.18)),
               Vector((s * 0.16, 0.12, 0.98))]
        bm = bmesh.new()
        prev = None
        for i, p in enumerate(pts):
            side = Vector((0, 0.0, 0.0)) + (Vector((0, 1, 0)).cross((pts[min(i + 1, 3)] - pts[max(i - 1, 0)]).normalized())) * 0.024
            pair = (bm.verts.new(p - side), bm.verts.new(p + side))
            if prev:
                bm.faces.new((prev[0], prev[1], pair[1], pair[0]))
            prev = pair
        belt = obj_from_bm("SeatBelt", bm, MATS["M_Prado_Belt"], cab)
        sol = belt.modifiers.new("S", "SOLIDIFY")
        sol.thickness = 0.003
        apply_mods(belt)
        rbox("Belt_Buckle", Vector((s * 0.16, 0.12, 0.96)), (0.03, 0.05, 0.06), MATS["M_Prado_Console_Dark"], cab, 0.006)
    steering_wheel(root)
    trim_shell(b, cab)
    door_cards(cab)
    n = sum(len(o.data.polygons) for o in cab.children_recursive if o.type == "MESH")
    REPORT["interior_tris"] = n


def trim_shell(b, cab):
    """Cabin trim as modelled parts (headliner, pillar trims, cargo side trims, tailgate card):
    closes the cabin so the single-sided paint shell is never seen from inside."""
    hl, tr = MATS["M_Prado_Headliner"], MATS["M_Prado_Trim_BeigeGrey"]
    # headliner: grid following the measured roof underside (ray cast down onto the body), 45 mm below
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(b, dg)
    bm = bmesh.new()
    grid = {}
    for i in range(16):
        for j in range(30):
            x, y = -0.72 + i * 0.096, -0.92 + j * 0.10
            h = bvh.ray_cast(Vector((x, y, 2.5)), Vector((0, 0, -1)), 1.2)
            if h[0] is not None and h[0].z > 1.55:
                grid[i, j] = bm.verts.new(Vector((x, y, h[0].z - 0.045)))
    for (i, j), v in grid.items():
        q = [grid.get(k) for k in ((i, j), (i, j + 1), (i + 1, j + 1), (i + 1, j))]
        if all(q):
            bm.faces.new(q)
    head = obj_from_bm("Headliner", bm, hl, cab)
    activate(head)
    bpy.ops.object.shade_smooth()
    sol = head.modifiers.new("S", "SOLIDIFY")
    sol.thickness = 0.012
    apply_mods(head)
    REPORT["headliner_cells"] = len(grid)
    for s_ in (-1, 1):
        # pillar trims follow the glass line (tumblehome): x = tumble_x(z) - 6 cm, below the roof rail
        for nm, yc, dy in (("Trim_B", 0.345, 0.11), ("Trim_C", 1.18, 0.14), ("Trim_D", 1.90, 0.18)):
            rbox(nm, Vector((s_ * (tumble_x(1.42) - 0.06), yc, 1.41)), (0.05, dy, 0.32), tr, cab, 0.02)
        rbox("Trim_CargoSide", Vector((s_ * 0.74, 1.62, 0.96)), (0.06, 0.95, 0.62), tr, cab, 0.02)
        rbox("Trim_Sill", Vector((s_ * 0.80, 0.10, FLOOR_Z + 0.05)), (0.10, 1.95, 0.10), MATS["M_Prado_Dash_Graphite"], cab, 0.02)
        rbox("Trim_RearArch", Vector((s_ * 0.76, 1.22, 0.78)), (0.08, 0.30, 0.42), tr, cab, 0.03)
    tg = bpy.data.objects.get("Tailgate")
    if tg:
        card = rbox("Tailgate_Card", Vector((0.66, -0.12, -0.25)), (1.18, 0.05, 0.62), tr, tg, 0.02)


def door_cards(cab):
    """Door cards: inner face of each door skin, offset 6 cm inwards, beige centre / dark rails,
    with armrest + pull handle (metal insert). Parented to the door (moves when it opens)."""
    for dn in ("Door_FL", "Door_FR", "Door_RL", "Door_RR"):
        d = bpy.data.objects[dn]
        bm = bmesh.new()
        bm.from_mesh(d.data)
        gi = len(d.data.materials) - 1
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index == gi or abs(f.normal.x) < 0.4], context="FACES")
        bmesh.ops.reverse_faces(bm, faces=bm.faces)
        bm.normal_update()
        sx = 1 if dn.endswith("L") else -1
        for v in bm.verts:
            v.co.x -= sx * 0.06                       # card sits 6 cm inside the skin (towards the cabin)
        for f in bm.faces:
            z = f.calc_center_median().z + d.location.z
            f.material_index = 1 if 0.80 < z < 1.10 else 0
        me = bpy.data.meshes.new(dn + "_Card")
        bm.to_mesh(me)
        bm.free()
        me.materials.append(MATS["M_Prado_Dash_Graphite"])
        me.materials.append(MATS["M_Prado_Leather_Beige"])
        card = link(bpy.data.objects.new(dn + "_Card", me), d)
        activate(card)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(40))
        ylen = 0.9 if "F" in dn[-2] else 0.6
        arm = rbox(dn + "_Armrest", Vector((-sx * 0.10, 0.30 if "F" in dn[-2] else 0.25, -0.05)), (0.08, ylen * 0.55, 0.05),
                   MATS["M_Prado_Leather_Beige"], d, 0.02)
        rbox(dn + "_Handle", Vector((-sx * 0.085, 0.10, 0.10)), (0.02, 0.12, 0.03), MATS["M_Prado_Metal_Insert"], d, 0.008)



def merge_static_interior():
    """Join the static cabin parts (everything under 'Interior') into one mesh: ~14 surfaces
    (one per material) instead of ~80 objects = far fewer draw calls on mobile."""
    cab = bpy.data.objects["Interior"]
    parts = [o for o in cab.children_recursive if o.type == "MESH"]
    activate(parts[0])
    for p in parts:
        p.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = "Interior_Static"
    ob.parent = cab
    for e in [o for o in cab.children if o.type == "EMPTY"]:
        bpy.data.objects.remove(e)
    REPORT["interior_merged"] = {"objects": len(parts), "materials": len(ob.data.materials), "tris": len(ob.data.polygons)}


def bake_and_export(root):
    """One AO/cavity atlas for all opaque parts (UV1 unique), source .blend, GLB."""
    merge_static_interior()
    meshes = [o for o in bpy.data.objects if o.type == "MESH" and not o.name.startswith("Glass")]
    for o in meshes:
        if not o.data.uv_layers:
            o.data.uv_layers.new(name="UVMap")
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, shape_method="CONCAVE", margin_method="FRACTION", margin=0.002)
    bpy.ops.object.mode_set(mode="OBJECT")
    tick("uv")
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("W")
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    imgs = {}
    bmat = bpy.data.materials.new("BAKE")
    bmat.use_nodes = True
    nt = bmat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    nt.nodes.active = tex
    saved = {o.name: ([sl.material for sl in o.material_slots], [p.material_index for p in o.data.polygons]) for o in meshes}
    for o in meshes:
        o.data.materials.clear()
        o.data.materials.append(bmat)
    for ch, dist, smp in (("ao_large", 0.9, BAKE_SAMPLES), ("ao_local", 0.06, max(16, BAKE_SAMPLES // 2))):
        img = bpy.data.images.new(ch, BAKE_PX, BAKE_PX, float_buffer=True)
        img.colorspace_settings.name = "Non-Color"
        tex.image = img
        sc.world.light_settings.distance = dist
        sc.cycles.samples = smp
        bpy.ops.object.bake(type="AO", use_clear=True, margin=6)
        imgs[ch] = np.array(img.pixels[:], dtype=np.float32).reshape(BAKE_PX, BAKE_PX, 4)[..., 0]
        tick("bake " + ch)
    rgb = np.stack([imgs["ao_large"], imgs["ao_local"], np.full_like(imgs["ao_large"], 0.5)], -1)
    BAKE_DIR.mkdir(parents=True, exist_ok=True)
    np.save(BAKE_DIR / "prado_bake.npy", (np.clip(rgb, 0, 1) * 65535).astype(np.uint16))
    for o in meshes:
        ms, idx = saved[o.name]
        o.data.materials.clear()
        for m in ms:
            o.data.materials.append(m)
        o.data.polygons.foreach_set("material_index", np.array(idx, dtype=np.int32))
    bpy.data.materials.remove(bmat)
    SRC_DIR.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SRC_DIR / "prado_v3_source.blend"), compress=True)
    bpy.ops.export_scene.gltf(filepath=str(OUT_GLB), export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_normals=True, export_texcoords=True,
                              export_tangents=False, export_animations=False)
    REPORT["glb_bytes"] = OUT_GLB.stat().st_size
    REPORT["triangles"] = {o.name: len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH"}
    REPORT["triangles_total"] = sum(REPORT["triangles"].values())
    tick("export")


tick_names = []


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SRC_GLB), merge_vertices=True)
    materials()
    root = bpy.data.objects["Prado"]
    b = bpy.data.objects["Body"]
    body(b)
    tick("body")
    doors = panels(b, root)
    tick("panels")
    glass(root, doors)
    tick("glass")
    if "SteeringWheel" in bpy.data.objects:
        bpy.data.objects.remove(bpy.data.objects["SteeringWheel"])   # old wheel (replaced)
    interior(root, b)
    tick("interior")
    lights(b, root)
    brakes(root)
    tick("lights/brakes")
    bake_and_export(root)
    Path(OUT_JSON).write_text(json.dumps(REPORT, indent=1, default=float))
    print("PRADO V3 DONE", REPORT["triangles_total"], REPORT["glb_bytes"])


if __name__ == "__main__":
    main()
