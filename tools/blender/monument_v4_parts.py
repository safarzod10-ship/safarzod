"""Monument v4: rebuild the elements whose source geometry does not match the photos,
as real modelled shapes (no smoothing tricks):

  blender -b --factory-startup --python tools/blender/monument_v4_parts.py -- \
      <elements_in.blend> <elements_out.blend> <report.json>

  * Statue_Sceptre head  -> gilded half-disc "fan" with radial rays, rim, hub boss, end balls
                            and 7 five-pointed stars on stems (photo front_lowangle_statue_arch_2015)
  * Crown + Crown_Base   -> 5.0 m crown (published diameter): ornamented band with medallions,
                            8 stepped "ziggurat" teeth with a ball and corner beads, dark drum below
                            (photo crown_arch_vault_closeup_2021; source crown was 7.26 m wide)
  * Arch lining          -> the crude stepped boxes inside the opening are removed and replaced by
                            vertical gilded prismatic pendants ("stalactites") in stepped layers and a
                            checkerboard of cubes on the vault (photos front_lowangle_*, crown_arch_vault_*)
  * Museum_Portal        -> entrance on the REAR face of the platform at plaza level: granite surround,
                            2+2 light columns, gilded double doors with raised panels
                            (photo three_quarter_base_portal_golden_hour_2018 - rear view)
All coordinates: Blender Z-up, metres, front of the monument = -Y.
"""
import json
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
IN, OUT, REP = (Path(a) for a in argv[:3])
REPORT = {}
rng = random.Random(1999)

ARCH_R_INNER, ARCH_TOP, ARCH_R_OUTER = 5.85, 38.78, 8.90
SPRING_Z = ARCH_TOP - ARCH_R_OUTER          # 29.88 m, centre of the semicircular head
PYLON_BOTTOM = 6.92


# ----------------------------------------------------------------- helpers

def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = bpy.data.objects["Monument_IsmoiliSomoni"]
    return ob


def box(bm, c, size, rot=None):
    """Axis box (or rotated by 3x3 rot) centred at c with full size (sx, sy, sz)."""
    m = Matrix.Translation(c) @ ((rot.to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1)))
    bmesh.ops.create_cube(bm, size=1.0, matrix=m)


def cyl(bm, c, r, h, seg=24, axis="Z", r2=None):
    rot = {"Z": Matrix.Identity(4), "X": Matrix.Rotation(math.pi / 2, 4, "Y"), "Y": Matrix.Rotation(math.pi / 2, 4, "X")}[axis]
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h,
                          matrix=Matrix.Translation(c) @ rot)


def sphere(bm, c, r, seg=12):
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r, matrix=Matrix.Translation(c))


def star_prism(bm, c, r_out, thick, normal_axis="Y", points=5, rot_deg=90.0):
    """Five-pointed star, extruded `thick` along the axis (flat star facing the viewer)."""
    verts = []
    for k in range(points * 2):
        a = math.radians(rot_deg) + k * math.pi / points
        r = r_out if k % 2 == 0 else r_out * 0.42
        verts.append((r * math.cos(a), r * math.sin(a)))
    front = [bm.verts.new(Vector((x, -thick / 2, y)) + c) for x, y in verts]
    back = [bm.verts.new(Vector((x, thick / 2, y)) + c) for x, y in verts]
    cf = bm.verts.new(c + Vector((0, -thick / 2 - thick * 0.6, 0)))  # raised centre (faceted star)
    cb = bm.verts.new(c + Vector((0, thick / 2, 0)))
    n = len(front)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((cf, front[j], front[i]))
        bm.faces.new((cb, back[i], back[j]))
        bm.faces.new((front[i], front[j], back[j], back[i]))


def bevel_all(ob, w, seg=1):
    m = ob.modifiers.new("Bevel", "BEVEL")
    m.width, m.segments, m.limit_method, m.angle_limit = w, seg, "ANGLE", math.radians(30)
    m.harden_normals = True
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.ops.object.modifier_apply(modifier="Bevel")
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))


# ----------------------------------------------------------------- sceptre

def sceptre():
    sc = bpy.data.objects["Statue_Sceptre"]
    co = np.array([v.co[:] for v in sc.data.vertices])
    # keep the shaft (below the head), remove the source ring head (z > 22.75)
    head_z0 = 23.30   # measured: shaft cylinder 19.9 .. 23.14-23.25 m, ring head above
    bm = bmesh.new()
    bm.from_mesh(sc.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > head_z0], context="VERTS")
    # the shaft is a long cylinder with vertices only near its ends: take its top ring
    shaft = co[(co[:, 2] > 23.10) & (co[:, 2] < head_z0)]   # top ring of the shaft
    axis_c = shaft.mean(0)
    REPORT["sceptre_shaft_top_xy"] = [round(float(axis_c[0]), 3), round(float(axis_c[1]), 3)]
    top = Vector((axis_c[0], axis_c[1], head_z0))
    # shaft extension + collar up to the fan (photo: gilded handle, collar under the fan)
    cyl(bm, top + Vector((0, 0, 0.05)), 0.15, 0.14, seg=20)       # collar under the fan
    base = top + Vector((0, 0, 0.12))              # centre of the fan's straight base line
    R, rim_w, th = 0.82, 0.11, 0.09
    # rim: half annulus R-rim_w..R, thickness th (plane X-Z facing -Y)
    seg = 32
    for k in range(seg):
        a0, a1 = math.pi * k / seg, math.pi * (k + 1) / seg
        quad = []
        for a, r in ((a0, R - rim_w), (a0, R), (a1, R), (a1, R - rim_w)):
            quad.append((r * math.cos(a), r * math.sin(a)))
        fv = [bm.verts.new(base + Vector((x, -th / 2, z))) for x, z in quad]
        bv = [bm.verts.new(base + Vector((x, th / 2, z))) for x, z in quad]
        bm.faces.new(fv[::-1])
        bm.faces.new(bv)
        for i in range(4):
            j = (i + 1) % 4
            bm.faces.new((fv[i], fv[j], bv[j], bv[i]))
    # base bar + radial rays (sunburst) between hub and rim
    box(bm, base + Vector((0, 0, 0.04)), (2 * R, th, 0.08))
    for k in range(1, 14):
        a = math.pi * k / 14
        mid = (0.24 + (R - rim_w)) / 2
        c = base + Vector((mid * math.cos(a), 0, mid * math.sin(a)))
        rot = Matrix.Rotation(-a, 3, "Y")
        box(bm, c, ((R - rim_w) - 0.24, th * 0.7, 0.035), rot)
    # hub disc + boss, end balls
    cyl(bm, base + Vector((0, 0, 0.05)), 0.24, th * 1.1, seg=24, axis="Y")
    sphere(bm, base + Vector((0, -0.07, 0.07)), 0.11)
    for sx in (-1, 1):
        sphere(bm, base + Vector((sx * (R + 0.02), 0, 0.05)), 0.09)
    # 7 stars on stems around the arc
    for k in range(7):
        a = math.radians(15 + k * 25)
        p = base + Vector((R * math.cos(a), 0, R * math.sin(a)))
        d = Vector((math.cos(a), 0, math.sin(a)))
        cyl(bm, p + d * 0.08, 0.018, 0.16, seg=8)
        star_prism(bm, p + d * 0.19, 0.11, 0.035, rot_deg=90 + math.degrees(a) - 90)
    me = sc.data
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = False
    REPORT["sceptre"] = {"fan_radius_m": R, "rays": 13, "stars": 7, "triangles": sum(len(p.vertices) - 2 for p in me.polygons)}


# ----------------------------------------------------------------- crown

def crown():
    old = bpy.data.objects["Crown"]
    oco = np.array([v.co[:] for v in old.data.vertices])
    cx, cy = 0.0, float((oco[:, 1].min() + oco[:, 1].max()) / 2)
    z0 = float(np.array([v.co.z for v in bpy.data.objects["Crown_Base"].data.vertices]).min())
    REPORT["crown_source"] = {"width_m": round(float(np.ptp(oco[:, 0])), 2), "seat_z": round(z0, 2)}
    for n in ("Crown", "Crown_Base"):
        bpy.data.objects.remove(bpy.data.objects[n])
    D = 5.0                                  # published diameter (ru.wikipedia, traveltajikistan)
    Rb = D / 2
    total = 43.0 - z0                        # keep the published total height 43 m
    h_drum, h_band = 0.38 * total, 0.19 * total   # research v4: bowl ~0.3 D, crown ~0.5 D
    h_teeth = total - h_drum - h_band        # photo ratio drum : band : teeth = 1.4 : 0.85 : 2.4
    c0 = Vector((cx, cy, z0))
    # dark drum (bronze), slightly narrower, flared lip
    bm = bmesh.new()
    cyl(bm, c0 + Vector((0, 0, h_drum / 2)), Rb * 0.93, h_drum, seg=48, r2=Rb * 0.97)
    cyl(bm, c0 + Vector((0, 0, h_drum * 0.08)), Rb * 0.80, h_drum * 0.16, seg=48)
    for k in range(24):                                  # radial ribs on the underside of the bowl
        a = 2 * math.pi * k / 24
        rot = Matrix.Rotation(a, 3, "Z")
        box(bm, c0 + rot @ Vector((Rb * 0.86, 0, h_drum * 0.35)), (Rb * 0.16, 0.08, h_drum * 0.6), rot)
    base_ob = new_obj("Crown_Base", bm)
    # band with medallions
    bm = bmesh.new()
    zb = z0 + h_drum
    bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=Rb, radius2=Rb, depth=h_band,
                          matrix=Matrix.Translation(c0 + Vector((0, 0, h_drum + h_band / 2))))
    bmesh.ops.create_cone(bm, cap_ends=False, segments=64, radius1=Rb - 0.12, radius2=Rb - 0.12, depth=h_band,
                          matrix=Matrix.Translation(c0 + Vector((0, 0, h_drum + h_band / 2))))
    for zz in (zb + 0.04, zb + h_band - 0.04):          # beaded mouldings top and bottom
        cyl(bm, Vector((cx, cy, zz)), Rb + 0.04, 0.08, seg=64)
    n_teeth = 6   # research v4: most likely 6 large stepped teeth
    for k in range(n_teeth * 2):                         # medallions + rhombs on the band
        a = 2 * math.pi * k / (n_teeth * 2)
        p = Vector((cx + (Rb + 0.03) * math.cos(a), cy + (Rb + 0.03) * math.sin(a), zb + h_band / 2))
        rot = Matrix.Rotation(a, 3, "Z")
        if k % 2 == 0:
            cyl(bm, p, h_band * 0.30, 0.08, seg=20, axis="X")
            bm2 = None
            sphere(bm, p + rot @ Vector((0.05, 0, 0)), h_band * 0.14, seg=10)
        else:
            box(bm, p, (0.06, h_band * 0.45, h_band * 0.45), rot @ Matrix.Rotation(math.pi / 4, 3, "X"))
    # stepped (ziggurat) teeth: 3 steps each side, ball in the middle, beads on step corners
    zt = zb + h_band
    w0, th = 2 * math.pi * Rb / n_teeth * 0.72, 0.12
    for k in range(n_teeth):
        a = 2 * math.pi * (k + 0.5) / n_teeth
        rot = Matrix.Rotation(a, 3, "Z")
        out = rot @ Vector((1, 0, 0))
        steps = [(w0, h_teeth * 0.30), (w0 * 0.70, h_teeth * 0.28), (w0 * 0.42, h_teeth * 0.22), (w0 * 0.20, h_teeth * 0.20)]
        z = zt
        for i, (w, h) in enumerate(steps):
            c = Vector((cx, cy, 0)) + out * (Rb - 0.03) + Vector((0, 0, z + h / 2))
            box(bm, c, (th, w, h), rot)
            if i < 3:
                for s in (-1, 1):
                    side = rot @ Vector((0, s * w / 2, 0))
                    sphere(bm, c + side + Vector((0, 0, h / 2)), 0.07, seg=8)
            z += h
        sphere(bm, Vector((cx, cy, 0)) + out * (Rb + 0.05) + Vector((0, 0, zt + h_teeth * 0.33)), w0 * 0.17, seg=14)
        sphere(bm, Vector((cx, cy, 0)) + out * (Rb - 0.03) + Vector((0, 0, z + 0.08)), 0.09, seg=8)
    crown_ob = new_obj("Crown", bm)
    for ob in (crown_ob, base_ob):
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.select_all(action="DESELECT")
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(35))
    REPORT["crown"] = {"diameter_m": D, "drum_h": round(h_drum, 2), "band_h": round(h_band, 2), "teeth_h": round(h_teeth, 2),
                       "teeth": n_teeth, "triangles": sum(len(p.vertices) - 2 for p in crown_ob.data.polygons)}


# ----------------------------------------------------------- arch lining

def inner_contour_r(x, z):
    return abs(x) if z < SPRING_Z else math.hypot(x, z - SPRING_Z)


def arch_lining():
    arch = bpy.data.objects["Arch"]
    co = np.array([v.co[:] for v in arch.data.vertices])
    y0, y1 = float(co[:, 1].min()), float(co[:, 1].max())
    # remove the crude stepped boxes: faces INSIDE the inner wall (r < 5.80 m)
    bm = bmesh.new()
    bm.from_mesh(arch.data)
    kill = [f for f in bm.faces if inner_contour_r(f.calc_center_median().x, f.calc_center_median().z) < ARCH_R_INNER - 0.05
            and f.calc_center_median().z > PYLON_BOTTOM + 0.2]
    REPORT["arch_faces_removed"] = len(kill)
    bmesh.ops.delete(bm, geom=kill, context="FACES")
    bm.to_mesh(arch.data)
    bm.free()
    # depth range of the lining (front frame band to back frame band, ~0.5 m inside each)
    fy0, fy1 = y0 + 0.55, y1 - 0.55
    bm = bmesh.new()
    pitch, bar_w, bar_t = 0.58, 0.50, 0.30
    n_bars = int((fy1 - fy0) / pitch)
    # research v4: flat rectangular slats (0.45-0.6 m), flat-cut ends, 3 tiers separated by
    # horizontal bands, total projection ~2.4 m per side; the bottom edge steps diagonally from
    # ~3 m above the platform at the wall (z~10) to ~8 m at the inner edge (z~15)
    n_layers = 6
    layers = [(k * 0.48, 10.0 + k * 1.0) for k in range(n_layers)]
    bands = (17.6, 23.8)
    bars = 0
    for side in (-1, 1):
        for k, (prot, zbot) in enumerate(layers):
            xin = ARCH_R_INNER - prot - bar_t / 2
            for i in range(n_bars):
                y = fy0 + (i + 0.5) * pitch
                zb = zbot + rng.uniform(-0.35, 0.35)
                ztop = SPRING_Z + 0.5
                c = Vector((side * xin, y, (zb + ztop) / 2))
                box(bm, c, (bar_t, bar_w, ztop - zb))
                bars += 1
            for zband in bands:                                   # horizontal tier bands
                box(bm, Vector((side * (xin - 0.04), (fy0 + fy1) / 2, zband)), (bar_t + 0.08, fy1 - fy0, 0.32))
    # vault: checkerboard of cubes on the intrados (radius 5.85, from springing to the key)
    cell = 0.62
    n_arc = int(math.pi * ARCH_R_INNER / cell)
    cubes = 0
    for j in range(n_arc):
        a = math.pi * (j + 0.5) / n_arc
        for i in range(int((fy1 - fy0) / cell)):
            y = fy0 + (i + 0.5) * cell
            depth = 0.42 if (i + j) % 2 == 0 else 0.16
            r = ARCH_R_INNER - depth / 2
            c = Vector((r * math.cos(a), y, SPRING_Z + r * math.sin(a)))
            rot = Matrix.Rotation(-(a - math.pi / 2), 3, "Y")
            box(bm, c, (cell * 0.92, cell * 0.92, depth), rot)
            cubes += 1
    ob = new_obj("Arch_Lining", bm)
    bevel_all(ob, 0.015)
    REPORT["arch_lining"] = {"pendant_bars": bars, "vault_cubes": cubes, "lining_depth_y": [round(fy0, 2), round(fy1, 2)],
                             "triangles": sum(len(p.vertices) - 2 for p in ob.data.polygons)}


# --------------------------------------------------------------- portal

def portal():
    """Rear museum entrance (plaza level) as a projecting granite block over the central terraces."""
    y_face, x_half, h = 15.40, 4.6, 6.0          # block front plane, half width, height (top of terraces ~5.8)
    bm = bmesh.new()
    box(bm, Vector((0, (9.55 + y_face) / 2, h / 2)), (2 * x_half, y_face - 9.55, h))
    granite = new_obj("Museum_Portal", bm)
    bm = bmesh.new()
    door_w, door_h, recess = 2.8, 4.2, 0.55
    # surround frame (light stone), lintel/cornice
    box(bm, Vector((0, y_face + 0.10, door_h + 0.55)), (6.6, 0.25, 0.5))
    box(bm, Vector((0, y_face + 0.22, door_h + 0.95)), (7.0, 0.45, 0.3))
    for sx in (-1, 1):
        for cxp in (2.15, 2.95):
            cyl(bm, Vector((sx * cxp, y_face + 0.45, door_h / 2 + 0.15)), 0.21, door_h - 0.1, seg=20)
            box(bm, Vector((sx * cxp, y_face + 0.45, 0.12)), (0.62, 0.62, 0.24))            # plinth
            box(bm, Vector((sx * cxp, y_face + 0.45, door_h + 0.2)), (0.58, 0.58, 0.18))    # capital abacus
            cyl(bm, Vector((sx * cxp, y_face + 0.45, door_h + 0.07)), 0.27, 0.12, seg=20, r2=0.21)
    stone = new_obj("Museum_Portal_Stone", bm)
    bm = bmesh.new()
    # gilded double doors in a recess, raised panels + handles
    for sx in (-1, 1):
        cxl = sx * door_w / 4
        box(bm, Vector((cxl, y_face - recess, door_h / 2 + 0.05)), (door_w / 2 - 0.02, 0.10, door_h))
        for row, (zc, ph) in enumerate(((0.95, 1.2), (2.35, 1.3), (3.65, 0.8))):
            box(bm, Vector((cxl, y_face - recess + 0.07, zc)), (door_w / 2 - 0.36, 0.06, ph))
            box(bm, Vector((cxl, y_face - recess + 0.11, zc)), (door_w / 2 - 0.56, 0.04, ph - 0.2))
        cyl(bm, Vector((sx * 0.16, y_face - recess + 0.16, 1.9)), 0.03, 0.5, seg=10)
    doors = new_obj("Museum_Doors", bm)
    bm = bmesh.new()
    for k in range(3):                                   # 3 granite steps in front of the portal (photo)
        box(bm, Vector((0, y_face + 0.25 + (2 - k) * 0.35, 0.09 + k * 0.17)), (7.4 - k * 0.3, 0.35 * (3 - k) + 0.5, 0.17))
    steps = new_obj("Museum_Portal_Steps", bm)
    # dark recess reveal (reuses granite)
    bm = bmesh.new()
    box(bm, Vector((0, y_face - recess / 2 + 0.01, door_h / 2 + 0.05)), (door_w + 0.3, recess, door_h + 0.2))
    reveal = new_obj("Museum_Portal_Reveal", bm)
    for ob in (granite, stone, doors, reveal, steps):
        bevel_all(ob, 0.012)
    # cut the reveal out of the granite block (boolean difference) so the doors sit in a real recess
    m = granite.modifiers.new("Recess", "BOOLEAN")
    m.object, m.operation, m.solver = reveal, "DIFFERENCE", "EXACT"
    bpy.context.view_layer.objects.active = granite
    bpy.ops.object.modifier_apply(modifier="Recess")
    bpy.data.objects.remove(reveal)
    REPORT["portal"] = {"location": "rear face of the platform, centre, plaza level (photo: rear view 2018)",
                        "block": [2 * x_half, round(y_face - 9.55, 2), h], "door_w_h": [door_w, door_h], "columns": 4,
                        "status": "[оценка] dimensions from people in the photo (person 1.7 m)"}


ARCH_DEPTH_M = 6.5   # research v4: 6.5 m +-1 m (3 independent photo methods); source mesh 10.8 m


def arch_depth():
    """Scale the arch, its gilded rods and the side colonnades in Y about the arch centre
    to the photo-measured depth (statue, crown and platform stay where they are)."""
    arch = bpy.data.objects["Arch"]
    ys = np.array([v.co.y for v in arch.data.vertices])
    yc, d0 = float((ys.min() + ys.max()) / 2), float(ys.max() - ys.min())
    k = ARCH_DEPTH_M / d0
    for n in ("Arch", "Arch_Pilasters", "Colonnade_Columns", "Colonnade_Entablatures"):
        me = bpy.data.objects[n].data
        co = np.array([v.co[:] for v in me.vertices])
        if n.startswith("Colonnade"):
            # colonnades are attached to the pylons' outer faces: move them with the arch, keep their size
            cy = float((co[:, 1].min() + co[:, 1].max()) / 2)
            co[:, 1] += (yc + (cy - yc) * k) - cy
        else:
            co[:, 1] = yc + (co[:, 1] - yc) * k
        me.vertices.foreach_set("co", co.astype(np.float32).ravel())
        me.update()
    REPORT["arch_depth"] = {"before_m": round(d0, 2), "after_m": ARCH_DEPTH_M, "scale_y": round(k, 3), "centre_y": round(yc, 2)}


def main():
    bpy.ops.wm.open_mainfile(filepath=str(IN))
    arch_depth()
    sceptre()
    crown()
    arch_lining()
    portal()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT), compress=True)
    Path(REP).write_text(json.dumps(REPORT, indent=1, ensure_ascii=False, default=float))
    print("PARTS V4", json.dumps({k: v.get("triangles") if isinstance(v, dict) else v for k, v in REPORT.items()}))


main()
