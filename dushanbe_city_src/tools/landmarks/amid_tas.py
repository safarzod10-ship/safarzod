"""AMID supermarket and the TAS Group tower for DUSHANBE-X (own work, CC0), after the owner's
reference pictures. Street front = Blender -Y (Godot +Z), ground z = 0, footprint centred.

  blender -b --python amid_tas.py -- <out dir>
"""
import bpy, bmesh, math, sys, os
FONT_PATH = "/home/user/safarzod/dushanbe_city/assets/fonts/DejaVuSans-Bold.ttf"
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index("--") + 1]
sys.path.insert(0, os.path.dirname(__file__))
FLAG = "/home/user/safarzod/dushanbe_city/assets/models/extra/tajik_flag_0.jpg"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, col, metal=0.0, rough=0.5, emit=None, strength=1.0, img=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = strength
    if img:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(img)
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 0.5
    return m


class K:
    def __init__(self, mats):
        self.M = mats
        self.objs = []

    def add(self, o, m):
        o.data.materials.clear()
        o.data.materials.append(self.M[m])
        self.objs.append(o)
        return o

    def box(self, size, loc, m, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
        o = bpy.context.object
        o.scale = size
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        return self.add(o, m)

    def cyl(self, r, h, loc, m, verts=24, r2=None, rot=(0, 0, 0)):
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=loc, rotation=rot)
        o = bpy.context.object
        bpy.ops.object.transform_apply(rotation=True)
        return self.add(o, m)

    def text(self, s, loc, size, m, extrude=0.15, face_minus_y=True):
        bpy.ops.object.text_add(location=(0, 0, 0))
        t = bpy.context.object
        t.data.font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
        t.data.body = s
        t.data.align_x = 'CENTER'
        t.data.align_y = 'CENTER'
        t.data.size = size
        t.data.extrude = extrude
        bpy.ops.object.convert(target='MESH')
        t = bpy.context.object
        # stand the text up, readable from -Y (the street side)
        t.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
        t.data.transform(Matrix.Translation(loc))
        t.location = (0, 0, 0)
        return self.add(t, m)

    def export(self, path):
        groups = {}
        for o in self.objs:
            groups.setdefault(o.data.materials[0].name, []).append(o)
        for name, g in groups.items():
            bpy.ops.object.select_all(action='DESELECT')
            for o in g:
                o.select_set(True)
            bpy.context.view_layer.objects.active = g[0]
            bpy.ops.object.join()
            bpy.context.object.name = name
            bpy.ops.object.shade_flat()
        faces = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')
        bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True)
        print("BUILD %s faces %d" % (os.path.basename(path), faces))


def cart_icon(k, cx, y, cz, s, m):
    """shopping-cart pictogram (as on AMID signs) from bars, facing -Y"""
    k.box((2.2 * s, 0.2, 0.22 * s), (cx, y, cz + 0.6 * s), m)                                  # top rim
    k.box((1.7 * s, 0.2, 0.22 * s), (cx + 0.1 * s, y, cz - 0.5 * s), m)                       # bottom
    k.box((0.22 * s, 0.2, 1.3 * s), (cx + 1.0 * s, y, cz + 0.05 * s), m, rot=(0, -0.25, 0))   # front side
    k.box((0.22 * s, 0.2, 1.3 * s), (cx - 0.8 * s, y, cz + 0.05 * s), m, rot=(0, 0.25, 0))     # back side
    k.box((0.9 * s, 0.2, 0.18 * s), (cx - 1.5 * s, y, cz + 0.85 * s), m, rot=(0, -0.5, 0))    # handle
    for i in range(3):
        k.box((0.12 * s, 0.2, 1.0 * s), (cx - 0.4 * s + i * 0.45 * s, y, cz + 0.05 * s), m)
    for dx in (-0.55, 0.75):
        k.cyl(0.25 * s, 0.25, (cx + dx * s, y, cz - 0.95 * s), m, verts=12, rot=(math.pi / 2, 0, 0))


# ------------------------------------------------------------------ AMID supermarket
# 0.24 site plan (after the owner's six reference views): the hall in the middle of its plot, the main
# entrance (glass vestibule, AMID sign) at the front, a pedestrian axis with the FOUNTAIN from the street
# sidewalk to the doors, the car park in two halves on either side of it, access lanes round the sides
# and the back of the hall (the plot is ringed by roads), flower / tree strips along every sidewalk,
# a technical yard at the back (loading docks, outside stair, plant, containers, transformer).
# Plot 116 x 115 m; Blender -Y = street. Printed: the hall centre's offset from the model's AABB centre.
SITE = {"front": -63.0, "back": 52.0, "half": 58.0}


def amid():
    reset()
    k = K({
        "panel": mat("amid_panel", (0.06, 0.065, 0.075), 0.35, 0.4),
        "grey": mat("amid_grey", (0.55, 0.56, 0.58), 0.2, 0.6),
        "stone": mat("amid_stone", (0.82, 0.76, 0.66), 0.0, 0.6),
        "glass": mat("amid_glass", (0.2, 0.28, 0.32), 0.6, 0.08, emit=(1.0, 0.86, 0.62), strength=1.1),
        "darkglass": mat("amid_darkglass", (0.08, 0.12, 0.16), 0.7, 0.05, emit=(0.3, 0.4, 0.5), strength=0.15),
        "green": mat("amid_green", (0.1, 0.95, 0.25), 0.0, 0.35, emit=(0.08, 1.0, 0.25), strength=2.5),
        "white": mat("amid_white", (0.97, 0.97, 0.97), 0.0, 0.4, emit=(1, 1, 1), strength=0.8),
        "steel": mat("amid_steel", (0.62, 0.64, 0.67), 0.85, 0.3),
        "asph": mat("amid_asphalt", (0.17, 0.17, 0.18), 0.0, 0.9),
        "line": mat("amid_line", (0.92, 0.92, 0.9), 0.0, 0.6),
        "screen": mat("amid_screen", (1, 1, 1), 0.0, 0.3, img=FLAG),
        "unit": mat("amid_unit", (0.6, 0.62, 0.64), 0.4, 0.5),
        "pave": mat("amid_pave", (0.78, 0.72, 0.62), 0.0, 0.8),
        "pave_red": mat("amid_pave_red", (0.62, 0.34, 0.26), 0.0, 0.8),
        "lawn": mat("amid_lawn", (0.2, 0.42, 0.14), 0.0, 0.95),
        "kerb": mat("amid_kerb", (0.72, 0.72, 0.7), 0.0, 0.8),
        "dock": mat("amid_dock", (0.18, 0.18, 0.2), 0.3, 0.6),
        "yellow": mat("amid_yellow", (0.95, 0.75, 0.05), 0.0, 0.5),
        "rubber": mat("amid_rubber", (0.03, 0.03, 0.03), 0.0, 0.9),
    })
    L, D, H = 84.0, 50.0, 14.0
    fy, by = -D / 2, D / 2
    F, B, HW = SITE["front"], SITE["back"], SITE["half"]
    T0 = 0.45                                     # top of the site slab (the game sinks models 0.3 m)

    def slab(x0, x1, y0, y1, m, t=0.03, z=T0):
        k.box((x1 - x0, y1 - y0, t), ((x0 + x1) / 2, (y0 + y1) / 2, z + t / 2), m)

    def kerb_rect(x0, x1, y0, y1, h=0.15):
        for (a, b2, c, d) in ((x0, x1, y0, y0), (x0, x1, y1, y1), (x0, x0, y0, y1), (x1, x1, y0, y1)):
            if a == b2:
                k.box((0.18, d - c, h), (a, (c + d) / 2, T0 + h / 2), "kerb")
            else:
                k.box((b2 - a, 0.18, h), ((a + b2) / 2, c, T0 + h / 2), "kerb")

    # ================= ground: one asphalt slab under the whole plot, finishes on top
    k.box((2 * HW, B - F, T0), (0, (F + B) / 2, T0 / 2), "asph")
    # street sidewalk (front), flower strip, plaza axis, fountain circle, building-front sidewalk
    slab(-HW, HW, F, F + 4.0, "pave")
    for sx in (-1, 1):
        slab(sx * 7.0, sx * 44.0, F + 4.0, F + 7.0, "lawn", t=0.12) if sx > 0 else slab(-44.0, -7.0, F + 4.0, F + 7.0, "lawn", t=0.12)
        kerb_rect(min(sx * 7.0, sx * 44.0), max(sx * 7.0, sx * 44.0), F + 4.0, F + 7.0)
    slab(-6.0, 6.0, F + 4.0, fy - 4.0, "pave")
    for i in range(int((fy - 4.0 - F - 4.0) / 3.0)):
        slab(-6.0, 6.0, F + 5.0 + i * 3.0, F + 5.4 + i * 3.0, "pave_red", t=0.035)
    fcy = (F + 7.0 + fy - 12.0) / 2                       # the fountain circle on the axis
    k.cyl(10.0, 0.04, (0, fcy, T0 + 0.02), "pave", verts=40)
    k.cyl(10.4, 0.035, (0, fcy, T0 + 0.015), "pave_red", verts=40)
    slab(-HW + 5.0, HW - 5.0, fy - 4.0, fy, "pave")                     # along the building front
    slab(-44.0, 44.0, fy - 11.0, fy - 4.0, "asph", t=0.01)               # the fire / drop-off lane
    # ================= the car park: two halves, two rows of bays each, a tree island between
    for sx in (-1, 1):
        x0, x1 = (8.0, 44.0) if sx > 0 else (-44.0, -8.0)
        yA, yB = F + 7.0, fy - 11.0                       # car park depth (front lawn .. drop-off lane)
        # island (kerbed lawn) along the middle of each half
        ym = (yA + yB) / 2
        slab(x0 + 2.0, x1 - 2.0, ym - 1.0, ym + 1.0, "lawn", t=0.14)
        kerb_rect(x0 + 2.0, x1 - 2.0, ym - 1.0, ym + 1.0)
        # bays: rows facing the aisles (white lines every 2.6 m), arrows
        for row_y, dirn in ((yA + 0.2, 1), (ym - 1.2, -1), (ym + 1.2, 1), (yB - 0.2, -1)):
            x = x0 + 1.0
            while x <= x1 - 1.0:
                k.box((0.12, 5.0, 0.01), (x, row_y + dirn * 2.5, T0 + 0.005), "line")
                x += 2.6
        # axis kerb
        k.box((0.2, yB - yA, 0.15), (sx * 7.6, (yA + yB) / 2, T0 + 0.075), "kerb")
    # zebra across the drop-off lane at the axis
    for i in range(6):
        k.box((0.5, 6.4, 0.012), (-2.75 + i * 1.1, fy - 7.5, T0 + 0.006), "line")
    # ================= side lanes round the hall, side lawns, outer sidewalks; back lane
    for sx in (-1, 1):
        lx0 = sx * 46.0
        # lawn strip along the hall wall
        a, b2 = sorted((sx * 42.5, sx * 45.5))
        slab(a, b2, fy, by, "lawn", t=0.12)
        kerb_rect(a, b2, fy, by)
        # lane centre line (dashed) and edge lines
        cx = sx * 49.5
        y = F + 2.0
        while y < B - 6.0:
            k.box((0.14, 3.0, 0.01), (cx, y + 1.5, T0 + 0.005), "line")
            y += 6.0
        # outer sidewalk + lawn with the plot fence line
        a, b2 = sorted((sx * 53.0, sx * 55.0))
        slab(a, b2, F + 4.0, B - 4.0, "pave")
        a, b2 = sorted((sx * 55.0, sx * HW))
        slab(a, b2, F + 4.0, B, "lawn", t=0.12)
        kerb_rect(a, b2, F + 4.0, B)
        # lawn between the car park and the side lane (gaps at the two aisles)
        a, b2 = sorted((sx * 44.0, sx * 46.0))
        slab(a, b2, F + 7.0, F + 12.0, "lawn", t=0.12)
        slab(a, b2, fy - 13.5, fy - 11.5, "lawn", t=0.12)
    y = -46.0
    while y < 46.0:
        k.box((3.0, 0.14, 0.01), (y + 1.5, by + 19.5, T0 + 0.005), "line")
        y += 6.0
    slab(-HW, HW, B - 4.0, B, "pave")
    # ================= the hall
    EW, EH, Tw = 10.0, 3.6, 0.6
    k.box((L, Tw, 4.5), (0, by - Tw / 2, 2.25 + T0 - 0.45), "grey")                                  # back (yard side)
    for sx in (-1, 1):
        k.box((Tw, D, 4.5), (sx * (L / 2 - Tw / 2), 0, 2.25), "stone")
        w = L / 2 - EW / 2
        k.box((w, Tw, 4.5), (sx * (EW / 2 + w / 2), fy + Tw / 2, 2.25), "stone")
    k.box((EW, Tw, 4.5 - EH), (0, fy + Tw / 2, EH + (4.5 - EH) / 2), "stone")
    # upper volumes: black composite panels; a raised grey block over the right / back half
    k.box((L, D, H - 4.5), (0, 0, 4.5 + (H - 4.5) / 2), "panel")
    k.box((L * 0.42, D * 0.7, 3.0), (L * 0.27, D * 0.12, H + 1.5), "grey")
    k.box((L + 1.0, D + 1.0, 0.8), (0, 0, H + 0.4), "steel")
    # panel joints on the black cladding (front + sides)
    for i in range(1, 14):
        x = -L / 2 + i * L / 14
        k.box((0.06, 0.12, H - 4.6), (x, fy - 0.03, 4.5 + (H - 4.5) / 2), "steel")
    for zz in (7.6, 10.8):
        k.box((L, 0.12, 0.05), (0, fy - 0.03, zz), "steel")
    # left end of the front: beige stone pavilion with a tall slit window
    k.box((12.0, 2.0, H + 1.0), (-L / 2 + 6.0, fy - 0.6, (H + 1.0) / 2), "stone")
    for i in range(3):
        k.box((1.4, 0.3, H - 3.0), (-L / 2 + 2.5 + i * 3.4, fy - 1.65, (H - 3.0) / 2 + 1.0), "glass")
    # the glass curtain wall in the middle (2 storeys), mullions + transoms
    gw = L * 0.5
    for sx in (-1, 1):
        w = gw / 2 - EW / 2
        k.box((w, 0.3, H - 2.0), (sx * (EW / 2 + w / 2), fy - 0.1, (H - 2.0) / 2 + 0.3), "glass")
    k.box((EW, 0.3, H - 2.0 - EH), (0, fy - 0.1, EH + (H - 2.0 - EH) / 2 + 0.3), "glass")
    for i in range(17):
        x = -gw / 2 + i * gw / 16
        z0 = EH if abs(x) < EW / 2 else 0.3
        k.box((0.22, 0.5, H - 1.7 - z0), (x, fy - 0.3, z0 + (H - 1.7 - z0) / 2), "steel")
    for zz in (EH + 0.1, 7.0, 10.2):
        k.box((gw, 0.5, 0.2), (0, fy - 0.3, zz), "steel")
    # ground-floor shop windows along the rest of the front and both sides
    for sx in (-1, 1):
        for i in range(3):
            x = sx * (gw / 2 + 3.0 + i * 4.6)
            if abs(x) < L / 2 - 12.0 or sx > 0:
                k.box((3.8, 0.25, 3.0), (x, fy - 0.05, 2.1), "glass")
        for i in range(8):
            yy = fy + 4.0 + i * 5.6
            k.box((0.25, 4.2, 3.0), (sx * (L / 2 + 0.05), yy, 2.1), "glass")
        # tall glass corner at the front of each side
        k.box((0.3, 6.0, H - 2.0), (sx * (L / 2 + 0.1), fy + 3.0, (H - 2.0) / 2 + 0.3), "glass")
    # ---- the entrance vestibule (glass box) + canopy with the AMID sign
    k.box((13.0, 4.5, 0.4), (0, fy - 2.6, 4.7), "panel")
    for sx in (-1, 1):
        k.box((0.25, 4.3, 4.5), (sx * 6.4, fy - 2.6, 2.25), "steel")
        k.box((0.06, 4.0, 4.0), (sx * 6.25, fy - 2.6, 2.3), "glass")
        k.box((1.2, 0.08, 4.0), (sx * 5.7, fy - 4.75, 2.3), "glass")
    k.box((13.4, 0.5, 1.5), (0, fy - 4.9, 5.4), "panel")
    k.text("АМИД", (1.0, fy - 5.2, 5.4), 1.05, "green", extrude=0.12)
    cart_icon(k, -3.4, fy - 5.2, 5.4, 0.62, "green")
    k.box((13.4, 0.55, 0.1), (0, fy - 4.9, 4.62), "white")
    # ---- THE SIGN: big AMID letters + cart, SUPERMARKET, on a raised board over the left half
    k.box((34.0, 0.6, 6.5), (-L * 0.16, fy - 0.5, H + 2.6), "panel")
    k.text("АМИД", (-L * 0.16 + 3.5, fy - 0.85, H + 3.4), 3.8, "white", extrude=0.25)
    k.text("СУПЕРМАРКЕТ", (-L * 0.16 + 3.5, fy - 0.85, H + 0.6), 1.3, "white", extrude=0.1)
    cart_icon(k, -L * 0.16 - 12.0, fy - 0.85, H + 2.8, 1.7, "green")
    # side sign + flag screen on the side facing the side lane (+X)
    k.box((0.5, 18.0, 5.0), (L / 2 + 0.3, -6.0, H - 3.0), "panel")
    bpy.ops.object.text_add(location=(0, 0, 0))
    t = bpy.context.object
    t.data.font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
    t.data.body = "АМИД"
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.data.size = 2.8
    t.data.extrude = 0.2
    bpy.ops.object.convert(target='MESH')
    t = bpy.context.object
    t.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    t.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
    t.data.transform(Matrix.Translation((L / 2 + 0.75, -4.0, H - 3.0)))
    k.add(t, "white")
    for sx, yy in ((-1, 2.0), (1, 9.0)):
        k.box((0.4, 8.4, 5.4), (sx * (L / 2 + 0.25), yy, 8.6), "panel")
        bpy.ops.mesh.primitive_plane_add(size=1, location=(sx * (L / 2 + 0.5), yy, 8.6), rotation=(math.pi / 2, math.pi, sx * math.pi / 2))
        p = bpy.context.object
        p.scale = (8.0, 5.0, 1)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        k.add(p, "screen")
    # LED screens with the flag on both sides of the glass
    for sx in (-1, 1):
        k.box((9.4, 0.4, 5.6), (sx * (gw / 2 + 8.0), fy - 0.3, 8.6), "panel")
        bpy.ops.mesh.primitive_plane_add(size=1, location=(sx * (gw / 2 + 8.0), fy - 0.55, 8.6), rotation=(math.pi / 2, math.pi, 0))
        p = bpy.context.object
        p.scale = (9.0, 5.2, 1)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        k.add(p, "screen")
    # ---- roof: plant, vents, a skylight band, parapet
    for i in range(6):
        for j in range(2):
            k.box((3.0, 2.0, 1.6), (-L / 2 + 10 + i * 12.0, -8 + j * 8.0, H + 1.6), "unit")
            k.cyl(0.6, 0.2, (-L / 2 + 10 + i * 12.0, -8 + j * 8.0, H + 2.5), "panel", verts=12)
    k.box((L * 0.5, 4.0, 0.6), (-L * 0.2, 8.0, H + 1.1), "darkglass")
    # ================= the back: technical yard
    # grey back facade with vertical seams, 4 loading docks with shelters, bumpers and levellers
    for i in range(1, 12):
        k.box((0.08, 0.15, H - 1.0), (-L / 2 + i * L / 12, by + 0.05, (H - 1.0) / 2 + 0.5), "steel")
    for i in range(4):
        x = -24.0 + i * 8.0
        k.box((3.4, 0.2, 3.6), (x, by + 0.1, 2.25), "dock")                     # the roller door
        for zz in range(6):
            k.box((3.3, 0.22, 0.04), (x, by + 0.12, 0.7 + zz * 0.55), "steel")
        k.box((4.2, 0.9, 0.4), (x, by + 0.45, 4.2), "rubber")                   # dock shelter head
        for sx in (-1, 1):
            k.box((0.4, 0.9, 3.8), (x + sx * 1.9, by + 0.45, 2.3), "rubber")
            k.box((0.35, 0.3, 0.45), (x + sx * 1.1, by + 0.5, 1.0), "rubber")   # bumpers
        k.box((3.2, 2.0, 0.1), (x, by + 1.0, 1.0), "yellow")                    # dock leveller lip
    k.box((36.0, 3.0, 1.0), (-12.0, by + 1.5, 0.5 + T0 - 0.45), "grey")        # the dock platform
    # outside steel stair to the roof (switchback), right side of the back
    sx0 = 30.0
    for f in range(4):
        z0 = f * 3.5
        for s in range(10):
            k.box((1.2, 0.3, 0.05), (sx0 + (s * 0.3 if f % 2 == 0 else 3.0 - s * 0.3), by + 1.2, z0 + s * 0.35 + 0.35), "steel")
        k.box((1.4, 1.4, 0.08), (sx0 + (3.4 if f % 2 == 0 else -0.4), by + 1.2, z0 + 3.5), "steel")
        k.box((3.6, 0.05, 0.05), (sx0 + 1.5, by + 1.9, z0 + 2.3), "steel")
    for px in (sx0 - 0.4, sx0 + 3.4):
        k.box((0.12, 0.12, H), (px, by + 1.9, H / 2), "steel")
    # plant in the yard: chillers, transformer box, containers, pallets
    for i in range(3):
        k.box((3.0, 2.2, 2.0), (-38.0 + i * 3.6, by + 9.0, T0 + 1.0), "unit")
        k.cyl(0.8, 0.3, (-38.0 + i * 3.6, by + 9.0, T0 + 2.15), "panel", verts=16)
    k.box((4.0, 3.0, 2.6), (22.0, by + 10.0, T0 + 1.3), "grey")
    k.box((4.2, 0.1, 0.4), (22.0, by + 8.45, T0 + 2.0), "yellow")
    for i in range(3):
        k.box((2.0, 1.4, 1.4), (6.0 + i * 2.4, by + 12.0, T0 + 0.7), "dock")
    for i in range(4):
        k.box((1.2, 1.0, 0.15), (-2.0 + i * 1.4, by + 12.5, T0 + 0.08), "stone")
    # yard markings
    for i in range(4):
        x = -24.0 + i * 8.0
        k.box((0.15, 12.0, 0.01), (x - 2.0, by + 9.0, T0 + 0.005), "yellow")
        k.box((0.15, 12.0, 0.01), (x + 2.0, by + 9.0, T0 + 0.005), "yellow")
    k.export(os.path.join(OUT, "amid.glb"))
    c = (F + B) / 2
    print("AMID site: %.1f x %.1f m; hall centre is %.2f m from the AABB centre along Blender Y (Godot HALL_Z = %.2f)"
          % (2 * HW, B - F, -c, c))


# ------------------------------------------------------------------ TAS Group tower
def tas():
    reset()
    k = K({
        "glass": mat("tas_glass", (0.08, 0.2, 0.42), 0.8, 0.04, emit=(0.2, 0.35, 0.6), strength=0.15),
        "glass_l": mat("tas_glass_light", (0.3, 0.5, 0.75), 0.7, 0.05),
        "rib": mat("tas_rib", (0.94, 0.95, 0.96), 0.3, 0.25),
        "stone": mat("tas_stone", (0.88, 0.85, 0.8), 0.0, 0.45),
        "logo": mat("tas_logo", (1, 1, 1), 0.0, 0.3, emit=(1, 1, 1), strength=2.0),
        "dark": mat("tas_dark", (0.08, 0.09, 0.11), 0.4, 0.4),
    })
    H = 168.0
    FL = 42
    # podium with a glass atrium
    k.box((60.0, 44.0, 12.0), (0, 0, 6.0), "stone")
    k.box((36.0, 0.4, 10.0), (0, -22.1, 6.0), "glass_l")
    for i in range(10):
        k.box((0.4, 0.8, 10.0), (-18 + i * 4.0, -22.4, 6.0), "rib")
    k.box((40.0, 10.0, 0.6), (0, -27.0, 11.4), "rib")
    # the shaft: lens-shaped floor plates, twisting 40 deg over the height and slimming upwards
    bm = bmesh.new()
    rings = []
    N = 32
    for f in range(FL + 1):
        z = 12.0 + f * (H - 12.0) / FL
        t = f / FL
        a = math.radians(40.0) * t
        sx = 21.0 * (1.0 - 0.28 * t)
        sy = 13.0 * (1.0 - 0.22 * t)
        ring = []
        for i in range(N):
            u = i * math.tau / N
            # lens: pointed ends on X
            x = math.cos(u) * sx
            y = math.sin(u) * sy * (0.55 + 0.45 * abs(math.cos(u)) ** 0.0) * (1.0 - 0.35 * abs(math.cos(u)) ** 6)
            ring.append(bm.verts.new((x * math.cos(a) - y * math.sin(a), x * math.sin(a) + y * math.cos(a), z)))
        rings.append(ring)
    for f in range(FL):
        for i in range(N):
            bm.faces.new((rings[f][i], rings[f][(i + 1) % N], rings[f + 1][(i + 1) % N], rings[f + 1][i]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    me = bpy.data.meshes.new("shaft")
    bm.to_mesh(me)
    o = bpy.data.objects.new("shaft", me)
    bpy.context.collection.objects.link(o)
    k.add(o, "glass")
    # floor bands (white slab edges) every 2nd floor
    for f in range(0, FL + 1, 2):
        ring = rings[f]
        bm2 = bmesh.new()
        r_out, r_in = [], []
        for v in ring:
            c = Vector((0, 0, v.co.z))
            d = (v.co - c)
            r_out.append(bm2.verts.new(c + d * 1.02 + Vector((0, 0, 0.0))))
            r_in.append(bm2.verts.new(c + d * 1.02 + Vector((0, 0, 0.45))))
        for i in range(N):
            bm2.faces.new((r_out[i], r_out[(i + 1) % N], r_in[(i + 1) % N], r_in[i]))
        me2 = bpy.data.meshes.new("band")
        bm2.to_mesh(me2)
        o2 = bpy.data.objects.new("band", me2)
        bpy.context.collection.objects.link(o2)
        k.add(o2, "rib")
    # two sweeping white fins along the pointed ends, rising above the roof
    for side in (0, N // 2):
        for f in range(FL + 6):
            ff = min(f, FL)
            v = rings[ff][side].co
            z = 12.0 + f * (H - 12.0) / FL
            c = Vector((0, 0, z))
            d = Vector((v.x, v.y, 0)).normalized()
            p = c + d * (Vector((v.x, v.y, 0)).length + 0.9 - (0.12 * (f - FL) if f > FL else 0.0) * 6)
            k.box((1.4, 1.4, (H - 12.0) / FL + 0.2), (p.x, p.y, z), "rib")
    # crown + spire
    k.cyl(4.0, 6.0, (0, 0, H + 3.0), "rib", verts=24, r2=2.0)
    k.cyl(0.6, 26.0, (0, 0, H + 19.0), "rib", verts=8, r2=0.05)
    # the logo panels near the top on both broad faces: "TAS" over a mountain mark + "GROUP"
    a = math.radians(40.0) * 0.86
    for sgn in (-1, 1):
        R = Matrix.Rotation(a, 4, 'Z')
        base = R @ Vector((0, sgn * (13.0 * (1 - 0.22 * 0.86) + 0.7), 0))
        z0 = 12.0 + 0.86 * (H - 12.0)
        obj_start = len(k.objs)
        # mountain chevron
        for dx, rz in ((-3.2, 0.75), (3.2, -0.75)):
            k.box((1.3, 0.3, 9.4), (dx, 0, z0 + 12.0), "logo", rot=(0, rz, 0))
        bpy.ops.object.text_add(location=(0, 0, 0))
        t = bpy.context.object
        t.data.font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
        t.data.body = "TAS"
        t.data.align_x = 'CENTER'
        t.data.align_y = 'CENTER'
        t.data.size = 8.5
        t.data.extrude = 0.15
        bpy.ops.object.convert(target='MESH')
        t = bpy.context.object
        t.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
        t.data.transform(Matrix.Translation((0, 0, z0)))
        k.add(t, "logo")
        bpy.ops.object.text_add(location=(0, 0, 0))
        t = bpy.context.object
        t.data.font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
        t.data.body = "GROUP"
        t.data.align_x = 'CENTER'
        t.data.align_y = 'CENTER'
        t.data.size = 3.4
        t.data.extrude = 0.1
        bpy.ops.object.convert(target='MESH')
        t = bpy.context.object
        t.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
        t.data.transform(Matrix.Translation((0, 0, z0 - 7.0)))
        k.add(t, "logo")
        # face outwards on this side, then move onto the facade
        for o in k.objs[obj_start:]:
            if sgn > 0:                       # text faces -Y by default: turn it to face +Y
                o.data.transform(Matrix.Rotation(math.pi, 4, 'Z'))
            o.data.transform(R)
            o.data.transform(Matrix.Translation((base.x, base.y, 0)))
    k.export(os.path.join(OUT, "tas_tower.glb"))


os.makedirs(OUT, exist_ok=True)
amid()
tas()
