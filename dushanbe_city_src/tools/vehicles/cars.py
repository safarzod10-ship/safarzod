"""DUSHANBE-X car generator (own work, CC0): Mercedes-Benz W124, BMW M5 (F90), Range Rover (L405),
Mercedes-AMG G63 (W463), Lexus LX 570, VAZ-2107.

Run:  blender -b --python cars.py -- OUT_DIR [car ...]

Every body is LOFTED from cross-sections along the length (rounded-box sections whose width, sill and
top follow per-model keyframes: nose, hood, cowl, belt line, boot, tail), the greenhouse is a second loft
(windscreen rake, roof, rear glass, tumblehome) whose faces are split into glass / pillars / roof by
position, the wheel arches are cut with booleans. Lamps, grilles, bumpers, mirrors, handles, plates,
exhausts and model features (W124 chrome, BMW kidneys, G63 spare wheel and round lamps, ...) are added.

Conventions for the game (VehicleCar, "names" wheels):
  Blender +Y = front (glTF / Godot -Z), ground at z = 0, axle midpoint at y = 0, left = -X.
  wheels: objects "tire_lf" / "hubcap_lf" ... (separate per wheel so they spin and steer)
  materials: "paint" (repaintable), "glass", "trim", "chrome", "headlight rf", "taillight rr",
  "body.3" (high stop lamp), "body.5" (reversing), "fari.4" (front indicators), "fari.3" / "fari.2"
  (left / right indicators) - the names VehicleLights drives.
A JSON with the game geometry (size, door cut, seat, lamps, collision boxes) is written next to the GLBs.
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = ARGS[0] if ARGS else "/tmp/cars"
ONLY = ARGS[1:]
os.makedirs(OUT, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


MATS = {}


def mat(name, col, metal=0.0, rough=0.5, alpha=1.0, emit=None):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if alpha < 1.0:
        b.inputs["Alpha"].default_value = alpha
        m.blend_method = 'BLEND'
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1.0)
        b.inputs["Emission Strength"].default_value = 0.4
    MATS[name] = m
    return m


def materials(paint):
    MATS.clear()
    mat("paint", paint, 0.4, 0.3)
    mat("trim", (0.03, 0.03, 0.035), 0.0, 0.6)
    mat("chrome", (0.85, 0.86, 0.88), 1.0, 0.12)
    mat("glass", (0.05, 0.07, 0.09), 0.0, 0.05, alpha=0.55)
    mat("headlight rf", (0.92, 0.93, 0.95), 0.6, 0.1)
    mat("taillight rr", (0.55, 0.02, 0.02), 0.0, 0.2)
    mat("body.3", (0.5, 0.02, 0.02), 0.0, 0.2)
    mat("body.5", (0.9, 0.9, 0.9), 0.0, 0.2)
    mat("fari.4", (0.95, 0.5, 0.05), 0.0, 0.2)
    mat("fari.3", (0.95, 0.5, 0.05), 0.0, 0.2)
    mat("fari.2", (0.95, 0.5, 0.05), 0.0, 0.2)
    mat("wheel_tyre", (0.025, 0.025, 0.028), 0.0, 0.9)
    mat("wheel2_rim", (0.7, 0.71, 0.73), 0.9, 0.3)
    mat("plate", (0.95, 0.95, 0.95), 0.0, 0.5)
    mat("arch", (0.02, 0.02, 0.02), 0.0, 0.9)
    mat("grille", (0.015, 0.015, 0.018), 0.3, 0.4)


class Kit:
    def __init__(self):
        self.objs = []       # (obj, material name)
        self.wheels = []

    def add(self, o, m):
        o.data.materials.clear()
        o.data.materials.append(MATS[m])
        self.objs.append(o)
        return o

    def box(self, size, loc, m, rot=(0, 0, 0), bevel=0.0):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        o = bpy.context.object
        o.scale = size
        bpy.ops.object.transform_apply(scale=True, rotation=True, location=False)
        if bevel > 0:
            bm = bmesh.new(); bm.from_mesh(o.data)
            bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, segments=2, affect='EDGES')
            bm.to_mesh(o.data); bm.free()
        return self.add(o, m)

    def cyl(self, r, depth, loc, m, rot=(0, 0, 0), verts=16, r2=None):
        if r2 is None:
            bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
        else:
            bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc, rotation=rot)
        o = bpy.context.object
        bpy.ops.object.transform_apply(scale=True, rotation=True, location=False)
        return self.add(o, m)

    def sphere(self, r, loc, m, scale=(1, 1, 1), seg=16):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
        o = bpy.context.object
        o.scale = scale
        bpy.ops.object.transform_apply(scale=True)
        return self.add(o, m)

    def mirror_x(self, fn):
        """call fn(sx) for both sides"""
        for sx in (-1, 1):
            fn(sx)


# ------------------------------------------------------------------ lofting
def lerp_keys(keys, y):
    """keys: list of (y, dict) sorted by y; linear interpolation of every field"""
    if y <= keys[0][0]:
        return dict(keys[0][1])
    for (y0, a), (y1, b) in zip(keys, keys[1:]):
        if y0 <= y <= y1:
            t = (y - y0) / (y1 - y0) if y1 > y0 else 0.0
            return {k: a[k] + (b[k] - a[k]) * t for k in a}
    return dict(keys[-1][1])


def section(p, n_side=4, n_arc=3):
    """rounded box (optionally trapezoid: 'wt' = half width at the top) -> list of (x, z), counter-clockwise
    starting bottom-centre"""
    w, zb, zt = p["w"], p["zb"], p["zt"]
    wt = p.get("wt", w)
    rt = min(p.get("rt", 0.1), (zt - zb) * 0.45, wt * 0.45)
    rb = min(p.get("rb", 0.05), (zt - zb) * 0.3, w * 0.45)
    pts = []
    # bottom edge (centre -> right)
    for i in range(n_side):
        pts.append(((w - rb) * i / n_side, zb))
    # bottom-right arc
    for i in range(n_arc + 1):
        a = -math.pi / 2 + (math.pi / 2) * i / n_arc
        pts.append((w - rb + rb * math.cos(a), zb + rb + rb * math.sin(a)))
    # right side (bottom -> top), slanting in to wt
    for i in range(1, n_side):
        t = i / n_side
        pts.append((w + (wt - w) * t, zb + rb + (zt - rt - zb - rb) * t))
    # top-right arc
    for i in range(n_arc + 1):
        a = (math.pi / 2) * i / n_arc
        pts.append((wt - rt + rt * math.cos(a), zt - rt + rt * math.sin(a)))
    # top edge (right -> centre)
    for i in range(1, n_side):
        pts.append(((wt - rt) * (1 - i / n_side), zt))
    right = pts
    left = [(-x, z) for (x, z) in reversed(right[1:])]   # mirror, skip the shared bottom-centre point
    ring = right + [(0.0, zt)] + left[:-1] if False else right + left
    # remove a duplicated top-centre point
    out = []
    for q in ring:
        if not out or (abs(out[-1][0] - q[0]) > 1e-6 or abs(out[-1][1] - q[1]) > 1e-6):
            out.append(q)
    if abs(out[0][0] - out[-1][0]) < 1e-6 and abs(out[0][1] - out[-1][1]) < 1e-6:
        out.pop()
    return out


def loft(name, stations, keys, mat_fn=None):
    bm = bmesh.new()
    rings = []
    for y in stations:
        p = lerp_keys(keys, y)
        rings.append([bm.verts.new((x, y, z)) for (x, z) in section(p)])
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    return o


def assign_by_face(o, fn, names):
    """per-face material from fn(center, normal) -> material name"""
    o.data.materials.clear()
    for nm in names:
        o.data.materials.append(MATS[nm])
    for f in o.data.polygons:
        f.material_index = names.index(fn(Vector(f.center), Vector(f.normal)))


def cut_arches(o, wheels, r, depth=0.6):
    for (x, y, z) in wheels:
        bpy.ops.mesh.primitive_cylinder_add(vertices=28, radius=r, depth=depth, location=(x, y, z), rotation=(0, math.pi / 2, 0))
        c = bpy.context.object
        c.data.materials.append(MATS["arch"])
        md = o.modifiers.new("arch", 'BOOLEAN')
        md.operation = 'DIFFERENCE'
        md.solver = 'EXACT'
        md.object = c
        bpy.context.view_layer.objects.active = o
        bpy.ops.object.modifier_apply(modifier=md.name)
        bpy.data.objects.remove(c)


def stations_for(y0, y1, extra, step=0.18):
    s = set(round(y0 + (y1 - y0) * i / max(1, int((y1 - y0) / step)), 4) for i in range(int((y1 - y0) / step) + 1))
    s |= set(round(v, 4) for v in extra if y0 <= v <= y1)
    s.add(round(y0, 4)); s.add(round(y1, 4))
    return sorted(s)


# ------------------------------------------------------------------ wheels
def wheel(k, key, x, y, r, tw, rim_r, style="multi", sx=1):
    # tyre: a lathed rounded profile (sidewall + tread), axis along X
    bm = bmesh.new()
    prof = []
    for i in range(9):
        a = -math.pi / 2 + math.pi * i / 8
        prof.append((tw / 2 * math.cos(a) * 0.9 + 0.0, r - 0.04 + 0.04 * math.cos(a) * 0 + (0.045 * math.cos(a))))
    # simple tyre: outer tread ring + sidewalls down to rim_r
    seg = 28
    rings = []
    profile = [(-tw / 2, rim_r), (-tw / 2, r - 0.05), (-tw / 2 + 0.03, r - 0.01), (0.0, r), (tw / 2 - 0.03, r - 0.01),
               (tw / 2, r - 0.05), (tw / 2, rim_r)]
    for (px, pr) in profile:
        ring = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring.append(bm.verts.new((px, pr * math.cos(a), pr * math.sin(a))))
        rings.append(ring)
    for a_, b_ in zip(rings, rings[1:]):
        for i in range(seg):
            j = (i + 1) % seg
            bm.faces.new((a_[i], a_[j], b_[j], b_[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    me = bpy.data.meshes.new("tire_" + key)
    bm.to_mesh(me); bm.free()
    t = bpy.data.objects.new("tire_" + key, me)
    bpy.context.collection.objects.link(t)
    t.location = (x, y, r)
    k.add(t, "wheel_tyre")
    parts = []
    # rim: dish + spokes + hub (outer face towards sx)
    face = sx * (tw / 2 - 0.03)
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=rim_r, depth=tw - 0.04, location=(x, y, r), rotation=(0, math.pi / 2, 0))
    parts.append(bpy.context.object)
    bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=rim_r * 0.98, depth=0.02, location=(x + face, y, r), rotation=(0, math.pi / 2, 0))
    parts.append(bpy.context.object)
    n = {"multi": 10, "five": 5, "steel": 0, "g": 6, "classic": 8}[style]
    for i in range(n):
        a = 2 * math.pi * i / n
        w = 0.035 if style == "multi" else 0.07
        bpy.ops.mesh.primitive_cube_add(size=1, location=(x + face + sx * 0.012, y + math.cos(a) * rim_r * 0.5, r + math.sin(a) * rim_r * 0.5),
                                        rotation=(a, 0, 0))
        o = bpy.context.object
        o.scale = (0.03, w, rim_r * 0.95)
        parts.append(o)
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=rim_r * (0.32 if style != "steel" else 0.55), depth=0.06,
                                        location=(x + face + sx * 0.02, y, r), rotation=(0, math.pi / 2, 0))
    parts.append(bpy.context.object)
    for o in parts:
        bpy.ops.object.select_all(action='DESELECT')
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.transform_apply(scale=True, rotation=True, location=False)
    bpy.ops.object.join()
    h = bpy.context.object
    h.name = "hubcap_" + key
    k.add(h, "wheel2_rim")
    k.wheels += [t, h]


# ------------------------------------------------------------------ the car builder
def build(c):
    reset()
    materials(c["paint"])
    k = Kit()
    L, W, H, wb, r = c["L"], c["W"], c["H"], c["wb"], c["r"]
    hw = W / 2
    yF = wb / 2 + c["fo"]
    yR = -(wb / 2 + (L - wb - c["fo"]))
    sill, belt, roof = c["sill"], c["belt"], H
    yA, yW, yRr, yC, yB = c["yA"], c["yW"], c["yRr"], c["yC"], c["yB"]
    yDf = min(wb / 2 - r - 0.12, yA - 0.02)  # front door's front edge (behind the arch, at the A-pillar)
    tw = c["tw"]
    track = hw - tw / 2 - c.get("inset", 0.04)
    # ---- lower body
    lk = c["lower"](c, yF, yR, hw)
    st = stations_for(yR, yF, [yA, yC, yB, yDf, yB - 0.02, yDf + 0.02, wb / 2 - r - 0.1, wb / 2 + r + 0.1,
                               -wb / 2 - r - 0.1, -wb / 2 + r + 0.1] + [q[0] for q in lk])
    body = loft("body", st, lk)
    body.data.materials.append(MATS["paint"])
    cut_arches(body, [(sx * hw, sy * wb / 2, r) for sx in (-1, 1) for sy in (-1, 1)], r + 0.07)
    k.objs.append(body)
    # ---- greenhouse
    tum = c.get("tumble", 0.12)
    gw = hw - c.get("gin", 0.08)
    ck = [(yC, {"w": gw, "wt": gw - 0.02, "zb": belt - 0.06, "zt": belt + 0.01, "rt": 0.02, "rb": 0.0}),
          (yRr, {"w": gw, "wt": gw - tum, "zb": belt - 0.06, "zt": roof - c.get("rear_drop", 0.0), "rt": c.get("roof_r", 0.1), "rb": 0.0}),
          (yW, {"w": gw, "wt": gw - tum, "zb": belt - 0.06, "zt": roof, "rt": c.get("roof_r", 0.1), "rb": 0.0}),
          (yA, {"w": gw, "wt": gw - 0.02, "zb": belt - 0.06, "zt": belt + 0.01, "rt": 0.02, "rb": 0.0})]
    gst = stations_for(yC, yA, [yB - 0.05, yB + 0.05, yDf, yW, yRr, yB], step=0.12)
    cab = loft("cabin", gst, ck)
    pill = c.get("pillar", "paint")
    roofm = c.get("roof_mat", "paint")

    def gmat(cn, nm):
        rel_top = roof - (abs(cn.y - (yW + yRr) / 2) * 0.0)
        if nm.z > 0.75 and cn.z > roof - 0.08:
            return roofm
        if abs(nm.x) > 0.55:                           # sides
            if belt + 0.04 < cn.z < roof - 0.07 and abs(cn.y - yB) > 0.06 and yC + 0.08 < cn.y < yA - 0.08:
                return "glass"
            return pill if cn.z > belt + 0.03 else "paint"
        if nm.y > 0.2:                                   # windscreen
            if cn.z > belt + 0.05 and cn.z < roof - 0.05 and abs(cn.x) < gw - tum - 0.07:
                return "glass"
            return pill if cn.z > belt + 0.03 else "paint"
        if nm.y < -0.2:                                  # rear glass
            if cn.z > belt + 0.07 and cn.z < roof - 0.06 and abs(cn.x) < gw - tum - 0.08:
                return "glass"
            return pill if cn.z > belt + 0.03 else "paint"
        return roofm if cn.z > roof - 0.1 else "paint"
    assign_by_face(cab, gmat, ["paint", "glass", "trim", "chrome"])
    k.objs.append(cab)
    # ---- wheels
    for (key, sx, sy) in (("lf", -1, 1), ("rf", 1, 1), ("lb", -1, -1), ("rb", 1, -1)):
        wheel(k, key, sx * track, sy * wb / 2, r, tw, c["rim_r"], c.get("rim", "multi"), sx)
    # ---- standard details
    z_bump = c.get("bump_z", sill + 0.12)
    # plates
    k.box((0.52, 0.02, 0.12), (0, yF + 0.01, z_bump + 0.05), "plate")
    k.box((0.52, 0.02, 0.12), (0, yR - 0.01, c.get("rear_plate_z", z_bump + 0.18)), "plate")
    # mirrors
    for sx in (-1, 1):
        k.box((0.2, 0.1, 0.12), (sx * (gw + 0.08), yA - 0.12, belt + 0.1), c.get("mirror", "paint"), bevel=0.02)
        k.box((0.06, 0.04, 0.04), (sx * (gw + 0.01), yA - 0.1, belt + 0.06), "trim")
        # door handles (front + rear doors)
        for yy in (yB - 0.18, (yB + yC) / 2 - 0.15 if c.get("rear_doors", True) else None):
            if yy is not None:
                k.box((0.03, 0.16, 0.035), (sx * (hw + 0.003), yy, belt - 0.12), c.get("handle", "chrome"))
        # side indicators on the front wings
        k.box((0.02, 0.07, 0.03), (sx * (hw + 0.002), wb / 2 + r * 0.4, belt - 0.12), "fari.3" if sx < 0 else "fari.2")
    # door shut lines (dark thin strips on the sides)
    for sx in (-1, 1):
        for yy in ([yDf, yB] + ([c["yRd"]] if c.get("rear_doors", True) else [])):
            k.box((0.008, 0.012, belt - sill - 0.05), (sx * (hw + 0.002), yy, (belt + sill) / 2 + 0.02), "trim")
    # high-mounted stop lamp
    k.box((0.36, 0.03, 0.035), (0, yRr - 0.02 if c.get("chmsl_roof") else yC - 0.02, (roof - 0.04) if c.get("chmsl_roof") else belt + 0.04), "body.3")
    # exhausts
    for ex in c.get("exhaust", [(-0.45,)]):
        k.cyl(0.04, 0.16, (ex[0], yR + 0.03, sill + 0.06), "chrome", rot=(math.pi / 2, 0, 0), verts=12)
    # under-body dark shadow plate between the wheels (no see-through)
    k.box((W - 0.25, L - 0.6, 0.04), (0, (yF + yR) / 2, sill + 0.03), "arch")
    c["details"](k, c, yF, yR, hw, gw)
    # ---- export: join everything per material except the wheels
    groups = {}
    for o in k.objs:
        groups.setdefault(o.data.materials[0].name if len(o.data.materials) == 1 else "_multi_%s" % o.name, []).append(o)
    for name, g in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in g:
            o.select_set(True)
        bpy.context.view_layer.objects.active = g[0]
        if len(g) > 1:
            bpy.ops.object.join()
        bpy.context.object.name = name.replace(" ", "_")
    for o in bpy.data.objects:
        if o.type == 'MESH':
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.select_all(action='DESELECT')
            o.select_set(True)
            bpy.ops.object.shade_auto_smooth(angle=math.radians(35)) if hasattr(bpy.ops.object, "shade_auto_smooth") else bpy.ops.object.shade_smooth()
    tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
    path = os.path.join(OUT, c["id"] + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True)
    print("BUILD %s tris %d" % (c["id"], tris))
    # geometry for the game (Godot model space: x right, y up from the axle-ground offset, z = -blender y)
    g = -(r + 0.18)
    return {"size": [W, H, L], "r": r, "ground": g,
            "door_cut": {"x": -(gw - 0.25), "y": [g + sill + 0.02, g + roof - 0.04], "z": [-(yB - 0.01), -(yDf + 0.01)]},
            "door": [-(hw + 0.1), 0.6, -((yB + yDf) / 2)],
            "seat": [-(gw * 0.42), c["seat_h"], -(yB - 0.35)],
            "lamp": [0, c["lamp_h"], -(yF - 0.05)],
            "boxes": [[[W - 0.04, belt - sill, L - 0.05], [0, g + (belt + sill) / 2, -(yF + yR) / 2]],
                      [[2 * gw - 0.1, roof - belt, yA - yC], [0, g + (roof + belt) / 2, -(yA + yC) / 2]]],
            "cabin_top": g + roof, "cabin_rear": -yC}


# ------------------------------------------------------------------ the models
def lower_sedan(c, yF, yR, hw):
    s, b = c["sill"], c["belt"]
    return [(yR, {"w": hw - 0.09, "zb": s + 0.06, "zt": c["tail_top"] - 0.05, "rt": 0.06, "rb": 0.05}),
            (yR + 0.06, {"w": hw - 0.03, "zb": s, "zt": c["tail_top"], "rt": 0.07, "rb": 0.05}),
            (yR + 0.35, {"w": hw - 0.01, "zb": s, "zt": c["deck"], "rt": 0.09, "rb": 0.05}),
            (c["yC"], {"w": hw, "zb": s, "zt": b + 0.02, "rt": 0.08, "rb": 0.05}),
            (c["yA"], {"w": hw, "zb": s, "zt": b, "rt": 0.08, "rb": 0.05}),
            (yF - 0.32, {"w": hw - 0.01, "zb": s, "zt": c["hood_front"], "rt": 0.09, "rb": 0.05}),
            (yF - 0.06, {"w": hw - 0.04, "zb": s, "zt": c["nose_top"], "rt": 0.08, "rb": 0.05}),
            (yF, {"w": hw - 0.1, "zb": s + 0.06, "zt": c["nose_top"] - 0.05, "rt": 0.06, "rb": 0.05})]


def lower_suv(c, yF, yR, hw):
    s, b = c["sill"], c["belt"]
    return [(yR, {"w": hw - 0.08, "zb": s + 0.05, "zt": b - 0.02, "rt": c.get("edge", 0.06), "rb": 0.05}),
            (yR + 0.07, {"w": hw - 0.02, "zb": s, "zt": b, "rt": c.get("edge", 0.06), "rb": 0.05}),
            (c["yA"], {"w": hw, "zb": s, "zt": b, "rt": c.get("edge", 0.06), "rb": 0.05}),
            (yF - 0.25, {"w": hw - 0.01, "zb": s, "zt": c["hood_front"], "rt": c.get("edge", 0.06), "rb": 0.05}),
            (yF - 0.05, {"w": hw - 0.03, "zb": s, "zt": c["nose_top"], "rt": c.get("edge", 0.05), "rb": 0.05}),
            (yF, {"w": hw - 0.08, "zb": s + 0.05, "zt": c["nose_top"] - 0.04, "rt": c.get("edge", 0.05), "rb": 0.05})]


def tail_cluster(k, yR, hw, z, h, w, sx, wrap=0.12):
    k.box((w, 0.04, h), (sx * (hw - w / 2 - 0.02), yR - 0.005, z), "taillight rr")
    k.box((0.04, wrap, h), (sx * (hw - 0.005), yR + wrap / 2, z), "taillight rr")
    k.box((w * 0.3, 0.045, h * 0.4), (sx * (hw - w * 0.8), yR - 0.008, z - h * 0.2), "body.5")
    k.box((w * 0.3, 0.045, h * 0.35), (sx * (hw - w * 0.25), yR - 0.008, z + h * 0.2), "fari.3" if sx < 0 else "fari.2")


def details_w124(k, c, yF, yR, hw, gw):
    z = 0.62
    # wide rectangular headlamps with the indicators outboard, upright chrome grille with the star
    for sx in (-1, 1):
        k.box((0.36, 0.04, 0.17), (sx * 0.42, yF - 0.035, z), "headlight rf")
        k.box((0.13, 0.04, 0.17), (sx * 0.71, yF - 0.04, z), "fari.4")
        k.box((0.5, 0.05, 0.015), (sx * 0.52, yF - 0.03, z + 0.095), "chrome")
        tail_cluster(k, yR + 0.02, hw, 0.72, 0.17, 0.5, sx)
        # chrome waist strip + the plastic side cladding (Sacco plates)
        k.box((0.012, c["L"] - 0.5, 0.02), (sx * (hw + 0.004), (yF + yR) / 2, c["belt"] + 0.005), "chrome")
        k.box((0.012, c["wb"] - 2 * c["r"] - 0.25, 0.08), (sx * (hw + 0.004), 0.0, c["sill"] + 0.14), "trim")
    k.box((0.3, 0.05, 0.22), (0, yF - 0.02, z + 0.01), "chrome", bevel=0.01)
    for i in range(6):
        k.box((0.24, 0.055, 0.012), (0, yF - 0.02, z - 0.08 + i * 0.033), "grille")
    k.cyl(0.03, 0.08, (0, yF - 0.04, z + 0.15), "chrome", rot=(math.pi / 2, 0, 0), verts=12)       # the star's ring
    k.box((0.004, 0.02, 0.06), (0, yF + 0.0, z + 0.18), "chrome")
    # bumpers: black with a chrome strip
    for yy, s in ((yF + 0.02, 1), (yR - 0.02, -1)):
        k.box((c["W"] - 0.06, 0.12, 0.17), (0, yy, c["sill"] + 0.12), "trim", bevel=0.03)
        k.box((c["W"] - 0.1, 0.13, 0.015), (0, yy, c["sill"] + 0.17), "chrome")


def details_m5(k, c, yF, yR, hw, gw):
    z = 0.68
    for sx in (-1, 1):
        # angular LED headlamps with the corona rings, the kidney (two tall frames)
        k.box((0.42, 0.06, 0.1), (sx * 0.6, yF - 0.12, z), "headlight rf", rot=(0.2, 0, -sx * 0.1))
        k.box((0.12, 0.06, 0.03), (sx * 0.78, yF - 0.15, z - 0.05), "fari.4")
        k.box((0.2, 0.05, 0.2), (sx * 0.13, yF - 0.06, z - 0.03), "grille", bevel=0.02)
        k.box((0.22, 0.04, 0.22), (sx * 0.13, yF - 0.05, z - 0.03), "chrome", bevel=0.03)
        # big front intakes, side gills
        k.box((0.36, 0.06, 0.16), (sx * 0.55, yF - 0.03, c["sill"] + 0.18), "grille", bevel=0.02)
        k.box((0.02, 0.18, 0.06), (sx * (hw + 0.004), c["wb"] / 2 + 0.05, c["belt"] - 0.12), "trim")
        # L-shaped tail lamps
        k.box((0.42, 0.05, 0.1), (sx * (hw - 0.24), yR + 0.05, 0.86), "taillight rr")
        k.box((0.05, 0.22, 0.1), (sx * (hw - 0.02), yR + 0.12, 0.86), "taillight rr")
        k.box((0.1, 0.055, 0.05), (sx * (hw - 0.4), yR + 0.05, 0.82), "body.5")
        k.box((0.1, 0.055, 0.03), (sx * (hw - 0.12), yR + 0.05, 0.89), "fari.3" if sx < 0 else "fari.2")
    k.box((c["W"] - 0.2, 0.08, 0.12), (0, yR - 0.01, c["sill"] + 0.1), "grille")          # diffuser
    k.box((1.1, 0.06, 0.02), (0, yR + 0.25, c["deck"] + 0.01), "paint")                     # boot lip
    for sx in (-1, 1):
        for dx in (0.0, 0.11):
            k.cyl(0.045, 0.14, (sx * (0.5 + dx), yR + 0.0, c["sill"] + 0.1), "chrome", rot=(math.pi / 2, 0, 0), verts=14)


def details_rr(k, c, yF, yR, hw, gw):
    z = 0.95
    for sx in (-1, 1):
        k.box((0.4, 0.05, 0.11), (sx * 0.62, yF - 0.04, z), "headlight rf")
        k.box((0.14, 0.05, 0.03), (sx * 0.62, yF - 0.05, z - 0.08), "fari.4")
        # vertical slim tail lamps
        k.box((0.12, 0.05, 0.42), (sx * (hw - 0.08), yR - 0.01, 1.05), "taillight rr")
        k.box((0.1, 0.055, 0.08), (sx * (hw - 0.08), yR - 0.015, 0.88), "body.5")
        k.box((0.1, 0.055, 0.06), (sx * (hw - 0.08), yR - 0.015, 1.22), "fari.3" if sx < 0 else "fari.2")
        # side vents ("power vents"), roof rails
        k.box((0.02, 0.28, 0.08), (sx * (hw + 0.004), c["wb"] / 2 - 0.05, c["belt"] - 0.15), "grille")
        k.box((0.04, c["yA"] - c["yC"] - 0.2, 0.04), (sx * (gw - 0.2), (c["yA"] + c["yC"]) / 2, c["H"] + 0.03), "trim")
    # grille: dark mesh band across the nose
    k.box((0.82, 0.05, 0.18), (0, yF - 0.03, z - 0.02), "grille", bevel=0.02)
    for i in range(4):
        k.box((0.8, 0.055, 0.012), (0, yF - 0.035, z - 0.08 + i * 0.05), "chrome")
    k.box((c["W"] - 0.1, 0.12, 0.22), (0, yF + 0.02, c["sill"] + 0.18), "paint", bevel=0.04)
    k.box((c["W"] - 0.1, 0.12, 0.2), (0, yR - 0.02, c["sill"] + 0.16), "paint", bevel=0.04)
    k.box((c["W"] - 0.4, 0.14, 0.06), (0, yR - 0.02, c["sill"] + 0.05), "trim")


def details_g63(k, c, yF, yR, hw, gw):
    z = 1.0
    for sx in (-1, 1):
        # round headlamps with chrome rings, indicators ON TOP of the wings
        k.cyl(0.11, 0.06, (sx * 0.63, yF - 0.03, z), "headlight rf", rot=(math.pi / 2, 0, 0), verts=20)
        k.cyl(0.125, 0.04, (sx * 0.63, yF - 0.04, z), "chrome", rot=(math.pi / 2, 0, 0), verts=20)
        k.box((0.12, 0.1, 0.05), (sx * 0.72, yF - 0.18, c["belt"] + 0.03), "fari.4")
        # square tail lamps low on the body corners
        k.box((0.22, 0.05, 0.2), (sx * (hw - 0.17), yR - 0.01, 0.82), "taillight rr")
        k.box((0.09, 0.055, 0.07), (sx * (hw - 0.2), yR - 0.015, 0.76), "body.5")
        k.box((0.09, 0.055, 0.06), (sx * (hw - 0.12), yR - 0.015, 0.89), "fari.3" if sx < 0 else "fari.2")
        # fender flares, side steps, side exhausts (AMG)
        for yy in (c["wb"] / 2, -c["wb"] / 2):
            k.box((0.08, 2.0 * c["r"] + 0.3, 0.1), (sx * (hw + 0.02), yy, 2 * c["r"] + 0.05), "trim")
        k.box((0.18, c["wb"] - 2 * c["r"] - 0.3, 0.04), (sx * (hw + 0.04), 0, c["sill"] + 0.02), "trim")
        k.cyl(0.035, 0.12, (sx * (hw + 0.02), -c["wb"] / 2 + c["r"] + 0.25, c["sill"] + 0.04), "chrome", rot=(0, math.pi / 2, 0), verts=12)
        k.cyl(0.035, 0.12, (sx * (hw + 0.02), -c["wb"] / 2 + c["r"] + 0.36, c["sill"] + 0.04), "chrome", rot=(0, math.pi / 2, 0), verts=12)
        # exposed hinges on the doors, the long side protection strip
        for yy in (c["yA"] - 0.08, c["yB"] - 0.05):
            for dz in (-0.25, 0.08):
                k.box((0.03, 0.06, 0.08), (sx * (hw + 0.012), yy, c["belt"] + dz - 0.1), "trim")
        k.box((0.025, c["L"] - 1.9, 0.07), (sx * (hw + 0.012), -0.1, c["belt"] - 0.32), "trim")
    # grille: three chrome slats + the star
    k.box((0.82, 0.05, 0.3), (0, yF - 0.02, z - 0.02), "grille")
    for i in range(3):
        k.box((0.8, 0.06, 0.03), (0, yF - 0.025, z - 0.1 + i * 0.09), "chrome")
    k.cyl(0.07, 0.03, (0, yF - 0.035, z - 0.01), "chrome", rot=(math.pi / 2, 0, 0), verts=16)
    # bumpers, the spare wheel on the side-hinged tailgate
    k.box((c["W"] - 0.1, 0.16, 0.2), (0, yF + 0.05, c["sill"] + 0.15), "trim", bevel=0.03)
    k.box((c["W"] - 0.1, 0.16, 0.2), (0, yR - 0.05, c["sill"] + 0.15), "trim", bevel=0.03)
    k.cyl(c["r"] * 0.95, 0.24, (0, yR - 0.14, 1.12), "wheel_tyre", rot=(math.pi / 2, 0, 0), verts=24)
    k.cyl(c["r"] * 0.97, 0.18, (0, yR - 0.17, 1.12), "paint", rot=(math.pi / 2, 0, 0), verts=24)
    k.cyl(0.08, 0.04, (0, yR - 0.27, 1.12), "chrome", rot=(math.pi / 2, 0, 0), verts=16)


def details_lx(k, c, yF, yR, hw, gw):
    z = 0.98
    for sx in (-1, 1):
        k.box((0.36, 0.06, 0.14), (sx * 0.66, yF - 0.06, z), "headlight rf", rot=(0, 0, -sx * 0.15))
        k.box((0.1, 0.06, 0.04), (sx * 0.8, yF - 0.08, z - 0.1), "fari.4")
        k.box((0.36, 0.05, 0.14), (sx * (hw - 0.2), yR - 0.01, 1.08), "taillight rr")
        k.box((0.05, 0.16, 0.14), (sx * (hw - 0.01), yR + 0.07, 1.08), "taillight rr")
        k.box((0.1, 0.055, 0.05), (sx * (hw - 0.32), yR - 0.015, 1.03), "body.5")
        k.box((0.1, 0.055, 0.04), (sx * (hw - 0.1), yR - 0.015, 1.13), "fari.3" if sx < 0 else "fari.2")
        k.box((0.04, c["yA"] - c["yC"] - 0.3, 0.05), (sx * (gw - 0.2), (c["yA"] + c["yC"]) / 2, c["H"] + 0.03), "chrome")
        k.box((0.16, c["wb"] - 2 * c["r"] - 0.3, 0.05), (sx * (hw + 0.04), 0, c["sill"] + 0.03), "trim")
        k.box((0.015, c["L"] - 1.8, 0.03), (sx * (hw + 0.004), -0.1, c["belt"] - 0.25), "chrome")
    # the spindle grille: hourglass of chrome bars
    for i in range(8):
        zz = z - 0.32 + i * 0.07
        wv = 0.95 - abs(i - 3.5) * 0.06
        k.box((wv, 0.06, 0.03), (0, yF - 0.03, zz), "chrome")
    k.box((1.0, 0.05, 0.56), (0, yF - 0.02, z - 0.08), "grille")
    k.box((c["W"] - 0.1, 0.14, 0.22), (0, yF + 0.03, c["sill"] + 0.16), "paint", bevel=0.04)
    k.box((c["W"] - 0.1, 0.14, 0.2), (0, yR - 0.03, c["sill"] + 0.16), "paint", bevel=0.04)
    k.box((0.9, 0.06, 0.04), (0, yR - 0.02, 1.0), "chrome")


def details_2107(k, c, yF, yR, hw, gw):
    z = 0.68
    for sx in (-1, 1):
        # rectangular headlamps, amber indicators below, the big chrome grille between
        k.box((0.24, 0.04, 0.15), (sx * 0.5, yF - 0.03, z), "headlight rf")
        k.box((0.27, 0.035, 0.18), (sx * 0.5, yF - 0.025, z), "chrome")
        k.box((0.16, 0.04, 0.06), (sx * 0.55, yF - 0.01, c["sill"] + 0.25), "fari.4")
        # tall rear lamp clusters (red / amber / white bands)
        k.box((0.28, 0.04, 0.2), (sx * (hw - 0.17), yR + 0.015, 0.74), "taillight rr")
        k.box((0.28, 0.045, 0.05), (sx * (hw - 0.17), yR + 0.012, 0.66), "fari.3" if sx < 0 else "fari.2")
        k.box((0.1, 0.045, 0.05), (sx * (hw - 0.3), yR + 0.012, 0.82), "body.5")
        # chrome moulding along the sides, drip rails, small round mirror
        k.box((0.012, c["L"] - 0.6, 0.025), (sx * (hw + 0.004), (yF + yR) / 2, c["belt"] - 0.1), "chrome")
        k.box((0.02, c["yA"] - c["yC"] - 0.1, 0.02), (sx * (gw - 0.08), (c["yA"] + c["yC"]) / 2, c["H"] - 0.06), "chrome")
    k.box((0.48, 0.05, 0.18), (0, yF - 0.02, z), "chrome", bevel=0.01)
    for i in range(10):
        k.box((0.012, 0.055, 0.15), (-0.2 + i * 0.045, yF - 0.025, z), "grille")
    # chrome bumpers with black rubber strips (the 2107's classic look)
    for yy in (yF + 0.04, yR - 0.04):
        k.box((c["W"] - 0.04, 0.1, 0.12), (0, yy, c["sill"] + 0.12), "chrome", bevel=0.03)
        k.box((c["W"] - 0.06, 0.11, 0.035), (0, yy, c["sill"] + 0.13), "trim")


CARS = {
    "w124": {"id": "w124", "paint": (0.62, 0.63, 0.66), "L": 4.74, "W": 1.74, "H": 1.44, "wb": 2.80, "fo": 0.88,
             "r": 0.317, "rim_r": 0.2, "tw": 0.2, "rim": "classic", "sill": 0.24, "belt": 0.9,
             "yA": 0.86, "yW": 0.12, "yRr": -1.12, "yC": -1.68, "yB": -0.42, "yRd": -0.99,
             "nose_top": 0.72, "hood_front": 0.8, "deck": 0.92, "tail_top": 0.86, "tumble": 0.13,
             "lower": lower_sedan, "details": details_w124, "seat_h": 0.48, "lamp_h": 0.62, "pillar": "paint",
             "exhaust": [(-0.5,)]},
    "m5": {"id": "m5", "paint": (0.05, 0.12, 0.3), "L": 4.97, "W": 1.90, "H": 1.47, "wb": 2.98, "fo": 0.93,
           "r": 0.35, "rim_r": 0.255, "tw": 0.26, "rim": "multi", "sill": 0.2, "belt": 0.92, "roof_r": 0.14,
           "yA": 0.98, "yW": 0.08, "yRr": -1.12, "yC": -1.78, "yB": -0.28, "yRd": -1.04,
           "nose_top": 0.68, "hood_front": 0.76, "deck": 0.96, "tail_top": 0.92, "tumble": 0.17,
           "lower": lower_sedan, "details": details_m5, "seat_h": 0.46, "lamp_h": 0.68, "pillar": "trim",
           "mirror": "paint", "handle": "paint", "exhaust": []},
    "rangerover": {"id": "rangerover", "paint": (0.08, 0.09, 0.1), "L": 5.0, "W": 1.98, "H": 1.84, "wb": 2.92, "fo": 0.92,
                   "r": 0.39, "rim_r": 0.28, "tw": 0.27, "rim": "five", "sill": 0.36, "belt": 1.12, "roof_r": 0.08,
                   "yA": 1.12, "yW": 0.42, "yRr": -1.98, "yC": -2.1, "yB": 0.12, "yRd": -0.98,
                   "nose_top": 0.98, "hood_front": 1.06, "tumble": 0.1, "edge": 0.07, "chmsl_roof": True,
                   "lower": lower_suv, "details": details_rr, "seat_h": 0.72, "lamp_h": 0.95, "pillar": "trim",
                   "roof_mat": "trim", "rear_drop": 0.03, "rear_plate_z": 0.85, "exhaust": [(-0.6,), (0.6,)]},
    "g63": {"id": "g63", "paint": (0.12, 0.13, 0.12), "L": 4.87, "W": 1.98, "H": 1.97, "wb": 2.85, "fo": 0.82,
            "r": 0.385, "rim_r": 0.27, "tw": 0.28, "rim": "g", "sill": 0.42, "belt": 1.18, "roof_r": 0.04, "gin": 0.06,
            "yA": 1.22, "yW": 0.98, "yRr": -2.0, "yC": -2.02, "yB": 0.2, "yRd": -0.98, "inset": 0.0,
            "nose_top": 1.12, "hood_front": 1.14, "tumble": 0.05, "edge": 0.03, "chmsl_roof": True,
            "lower": lower_suv, "details": details_g63, "seat_h": 0.8, "lamp_h": 1.0, "pillar": "paint",
            "mirror": "trim", "handle": "chrome", "rear_plate_z": 0.6, "exhaust": []},
    "lx570": {"id": "lx570", "paint": (0.92, 0.92, 0.9), "L": 5.07, "W": 1.98, "H": 1.92, "wb": 2.85, "fo": 1.0,
              "r": 0.39, "rim_r": 0.27, "tw": 0.27, "rim": "five", "sill": 0.4, "belt": 1.16, "roof_r": 0.1,
              "yA": 1.18, "yW": 0.45, "yRr": -2.04, "yC": -2.16, "yB": 0.1, "yRd": -0.98,
              "nose_top": 1.02, "hood_front": 1.1, "tumble": 0.11, "edge": 0.07, "chmsl_roof": True,
              "lower": lower_suv, "details": details_lx, "seat_h": 0.78, "lamp_h": 0.98, "pillar": "trim",
              "rear_plate_z": 0.85, "exhaust": [(-0.55,)]},
    "vaz2107": {"id": "vaz2107", "paint": (0.75, 0.1, 0.08), "L": 4.145, "W": 1.62, "H": 1.44, "wb": 2.42, "fo": 0.75,
                "r": 0.29, "rim_r": 0.17, "tw": 0.17, "rim": "steel", "sill": 0.26, "belt": 0.9, "roof_r": 0.06,
                "yA": 0.74, "yW": 0.16, "yRr": -0.86, "yC": -1.18, "yB": -0.18, "yRd": -0.84, "gin": 0.06,
                "nose_top": 0.82, "hood_front": 0.84, "deck": 0.9, "tail_top": 0.88, "tumble": 0.1,
                "lower": lower_sedan, "details": details_2107, "seat_h": 0.5, "lamp_h": 0.68, "pillar": "paint",
                "mirror": "chrome", "exhaust": [(0.45,)]},
}

spec_all = {}
for cid, c in CARS.items():
    if ONLY and cid not in ONLY:
        continue
    spec_all[cid] = build(c)
with open(os.path.join(OUT, "cars_spec.json"), "w") as f:
    json.dump(spec_all, f, indent=1)
print("SPEC written")
