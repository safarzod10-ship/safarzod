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
def amid():
    reset()
    k = K({
        "panel": mat("amid_panel", (0.14, 0.15, 0.17), 0.3, 0.45),
        "stone": mat("amid_stone", (0.86, 0.82, 0.74), 0.0, 0.55),
        "glass": mat("amid_glass", (0.16, 0.28, 0.36), 0.7, 0.06, emit=(0.95, 0.85, 0.6), strength=0.35),
        "green": mat("amid_green", (0.1, 0.95, 0.25), 0.0, 0.35, emit=(0.08, 1.0, 0.25), strength=2.5),
        "white": mat("amid_white", (0.97, 0.97, 0.97), 0.0, 0.4, emit=(1, 1, 1), strength=0.8),
        "steel": mat("amid_steel", (0.72, 0.74, 0.77), 0.85, 0.3),
        "asph": mat("amid_asphalt", (0.17, 0.17, 0.18), 0.0, 0.9),
        "line": mat("amid_line", (0.92, 0.92, 0.9), 0.0, 0.6),
        "screen": mat("amid_screen", (1, 1, 1), 0.0, 0.3, img=FLAG),
        "unit": mat("amid_unit", (0.6, 0.62, 0.64), 0.4, 0.5),
        "hedge": mat("amid_hedge", (0.15, 0.36, 0.12), 0.0, 0.9),
    })
    L, D, H = 84.0, 50.0, 14.0
    fy = -D / 2
    # main hall: stone base walls (hollow: the game builds the interior) with the entrance opening
    EW, EH, T = 10.0, 3.6, 0.6
    k.box((L, T, 4.5), (0, -fy - T / 2, 2.25), "stone")                                  # back
    for sx in (-1, 1):
        k.box((T, D, 4.5), (sx * (L / 2 - T / 2), 0, 2.25), "stone")                     # sides
        w = L / 2 - EW / 2
        k.box((w, T, 4.5), (sx * (EW / 2 + w / 2), fy + T / 2, 2.25), "stone")           # front
    k.box((EW, T, 4.5 - EH), (0, fy + T / 2, EH + (4.5 - EH) / 2), "stone")              # lintel
    k.box((L, D, H - 4.5), (0, 0, 4.5 + (H - 4.5) / 2), "panel")
    k.box((L + 1.0, D + 1.0, 0.8), (0, 0, H + 0.4), "steel")                         # parapet cap
    # glass front: full-height curtain wall in the middle third with mullions + floors
    gw = L * 0.48
    for sx in (-1, 1):                         # left / right of the entrance: full height
        w = gw / 2 - EW / 2
        k.box((w, 0.3, H - 1.0), (sx * (EW / 2 + w / 2), fy - 0.1, (H - 1.0) / 2 + 0.3), "glass")
    k.box((EW, 0.3, H - 1.0 - EH + 0.3), (0, fy - 0.1, EH + (H - 1.0 - EH + 0.3) / 2), "glass")   # over the doors
    for i in range(13):
        x = -gw / 2 + i * gw / 12
        z0 = EH if abs(x) < EW / 2 else 0.3    # no mullion through the doorway
        k.box((0.3, 0.6, H - 0.7 - z0), (x, fy - 0.3, z0 + (H - 0.7 - z0) / 2), "steel")
    for sx in (-1, 1):                         # door jambs
        k.box((0.35, 0.7, EH), (sx * (EW / 2 + 0.17), fy - 0.3, EH / 2), "steel")
    k.box((EW + 0.7, 0.7, 0.3), (0, fy - 0.3, EH + 0.15), "steel")                     # door head
    for z in (4.6, 9.2):
        k.box((gw, 0.6, 0.3), (0, fy - 0.3, z), "steel")
    # side shop windows in the stone base
    for sx in (-1, 1):
        for i in range(4):
            x = sx * (gw / 2 + 3.0 + i * 4.6)
            k.box((3.6, 0.25, 3.0), (x, fy - 0.05, 2.1), "glass")
    # entrance: sliding doors + a cantilevered canopy with a light strip
    k.box((16.0, 7.0, 0.5), (0, fy - 3.5, 5.2), "panel")
    k.box((16.0, 0.3, 0.25), (0, fy - 7.0, 5.0), "white")
    # the name over the entrance: a dark board on the canopy with green AMID letters and a cart
    k.box((13.0, 0.4, 2.2), (0, fy - 6.6, 6.55), "panel")
    k.box((13.2, 0.45, 0.12), (0, fy - 6.6, 5.48), "green")
    k.text("АМИД", (1.2, fy - 6.85, 6.55), 1.75, "green", extrude=0.18)
    cart_icon(k, -4.4, fy - 6.85, 6.55, 1.2, "green")
    # THE SIGN: big green AMID letters + cart, a white subtitle, on the parapet over the glass
    k.box((34.0, 0.5, 6.0), (-L * 0.18, fy - 0.5, H + 2.4), "panel")
    k.text("АМИД", (-L * 0.18 + 3.0, fy - 0.85, H + 3.2), 3.6, "green", extrude=0.25)
    k.text("СУПЕРМАРКЕТ", (-L * 0.18 + 3.0, fy - 0.85, H + 0.4), 1.2, "white", extrude=0.1)
    cart_icon(k, -L * 0.18 - 12.0, fy - 0.85, H + 2.6, 1.6, "green")
    # side sign (visible along the avenue)
    k.box((0.5, 16.0, 4.0), (L / 2 + 0.3, 0, H - 2.5), "panel")
    bpy.ops.object.text_add(location=(0, 0, 0))
    t = bpy.context.object
    t.data.font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
    t.data.body = "АМИД"
    t.data.align_x = 'CENTER'
    t.data.align_y = 'CENTER'
    t.data.size = 2.6
    t.data.extrude = 0.2
    bpy.ops.object.convert(target='MESH')
    t = bpy.context.object
    t.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    t.data.transform(Matrix.Rotation(math.pi / 2, 4, 'Z'))
    t.data.transform(Matrix.Translation((L / 2 + 0.75, 0, H - 2.5)))
    k.add(t, "green")
    # LED screens with the flag on both sides of the glass
    for sx in (-1, 1):
        k.box((9.4, 0.4, 5.6), (sx * (gw / 2 + 8.0), fy - 0.3, 8.6), "panel")
        bpy.ops.mesh.primitive_plane_add(size=1, location=(sx * (gw / 2 + 8.0), fy - 0.55, 8.6), rotation=(math.pi / 2, math.pi, 0))
        p = bpy.context.object
        p.scale = (9.0, 5.2, 1)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        k.add(p, "screen")
    # roof: AC units, vents, a skylight band
    for i in range(6):
        for j in range(2):
            k.box((3.0, 2.0, 1.6), (-L / 2 + 10 + i * 12.0, 8 + j * 8.0, H + 1.6), "unit")
            k.cyl(0.6, 0.2, (-L / 2 + 10 + i * 12.0, 8 + j * 8.0, H + 2.5), "panel", verts=12)
    k.box((L * 0.6, 4.0, 0.6), (0, -6.0, H + 1.1), "glass")
    # parking in front: asphalt, white bays, lamp posts, hedges, trolley shelter
    PD = 28.0
    k.box((L + 8, PD, 0.45), (0, fy - PD / 2 - 1.0, 0.225), "asph")    # (the game sinks models 0.3 m)
    for row in (0, 1):
        y0 = fy - 6.0 - row * 13.0
        for i in range(28):
            x = -L / 2 + 4 + i * 2.8
            if abs(x) < 9.0:
                continue
            k.box((0.12, 5.0, 0.02), (x, y0 - 2.5, 0.46), "line")
        k.box((L - 6, 0.12, 0.02), (0, y0 - 5.0, 0.46), "line")
    for i in range(5):
        x = -L / 2 + 8 + i * (L - 16) / 4
        k.cyl(0.15, 8.0, (x, fy - 15.5, 4.0), "steel", verts=8)
        k.box((1.6, 0.5, 0.3), (x, fy - 15.5, 8.0), "white")
        k.box((3.0, 1.0, 0.8), (x, fy - 15.5, 0.4), "hedge")
    k.box((6.0, 2.4, 0.15), (L / 2 - 8, fy - 3.5, 2.6), "steel")
    for dx in (-2.8, 2.8):
        k.cyl(0.08, 2.6, (L / 2 - 8 + dx, fy - 3.5, 1.3), "steel", verts=8)
    k.export(os.path.join(OUT, "amid.glb"))


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
