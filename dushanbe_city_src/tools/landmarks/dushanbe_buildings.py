"""Modern Dushanbe building set for DUSHANBE-X (own work, CC0), after the reference pictures supplied
by the project owner: cream stone towers with blue glass and domes, a round glass tower, cream
residential blocks with balconies and an arcade on top, a shopping centre with a glass front,
green signs and LED screens. Each model: footprint centred at the origin, ground at z = 0, the
street front facing -Y (Godot +Z after export; the game turns them with the building's yaw).

  blender -b --python dushanbe_buildings.py -- <out dir>
"""
import bpy, bmesh, math, sys, os
FONT_PATH = "/home/user/safarzod/dushanbe_city/assets/fonts/DejaVuSans-Bold.ttf"
from mathutils import Vector, Matrix

OUT = sys.argv[sys.argv.index("--") + 1]
FLAG = "/home/user/safarzod/dushanbe_city/assets/models/extra/tajik_flag_0.jpg"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, col, metal=0.0, rough=0.5, emit=None, img=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = 1.0
    if img:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(img)
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = 0.6
    return m


class Kit:
    def __init__(self):
        self.objs = []
        self.M = {
            "stone": mat("stone", (0.9, 0.84, 0.72), 0.0, 0.6),
            "stone_d": mat("stone_dark", (0.74, 0.66, 0.54), 0.0, 0.6),
            "glass": mat("glass", (0.12, 0.3, 0.52), 0.6, 0.08),
            "glass_l": mat("glass_light", (0.35, 0.55, 0.72), 0.5, 0.1),
            "gold": mat("gold", (1.0, 0.76, 0.32), 1.0, 0.3),
            "dark": mat("dark", (0.1, 0.11, 0.13), 0.3, 0.4),
            "white": mat("white", (0.95, 0.95, 0.93), 0.0, 0.4),
            "roof": mat("roof", (0.42, 0.24, 0.18), 0.0, 0.7),
            "green": mat("sign_green", (0.15, 0.95, 0.25), 0.0, 0.4, emit=(0.1, 0.9, 0.2)),
            "screen": mat("screen", (1, 1, 1), 0.0, 0.3, img=FLAG),
            "steel": mat("steel", (0.7, 0.72, 0.75), 0.8, 0.3),
        }

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

    def cyl(self, r, h, loc, m, verts=24, r2=None):
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=loc)
        return self.add(bpy.context.object, m)

    def dome(self, r, loc, m, flat=1.0, seg=24):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
        o = bpy.context.object
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.01], context='VERTS')
        bm.to_mesh(o.data)
        o.scale = (1, 1, flat)
        bpy.ops.object.transform_apply(scale=True)
        return self.add(o, m)

    def text(self, s, loc, size, m, rot_z=0.0, extrude=0.08):
        bpy.ops.object.text_add(location=loc)
        t = bpy.context.object
        t.data.font = bpy.data.fonts.load(FONT_PATH, check_existing=True)
        t.data.body = s
        t.data.align_x = 'CENTER'
        t.data.align_y = 'CENTER'
        t.data.size = size
        t.data.extrude = extrude
        bpy.ops.object.convert(target='MESH')
        t = bpy.context.object
        t.rotation_euler = (math.pi / 2, 0, rot_z)
        bpy.ops.object.transform_apply(rotation=True)
        return self.add(t, m)

    def plane_img(self, w, h, loc, m, rot_z=0.0):
        bpy.ops.mesh.primitive_plane_add(size=1, location=loc, rotation=(math.pi / 2, 0, rot_z))
        o = bpy.context.object
        o.scale = (w, h, 1)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        return self.add(o, m)

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


# ------------------------------------------------------------------ helpers: facade grids
def facade_grid(k, face_center, width, z0, z1, floors, normal, cols, glass="glass", frame="stone", depth=0.35):
    """a stone frame grid (pilasters + floor bands) over a glass wall on one face"""
    n = Vector(normal)
    t = Vector((-n.y, n.x, 0))
    c = Vector(face_center)
    h = z1 - z0
    k.box(((width if abs(t.x) > 0.5 else 0.1), (width if abs(t.y) > 0.5 else 0.1), h), (c.x, c.y, z0 + h / 2), glass)
    for i in range(cols + 1):
        p = c + t * (-width / 2 + width * i / cols) + n * depth * 0.5
        k.box(((0.7 if abs(t.x) > 0.5 else depth), (0.7 if abs(t.y) > 0.5 else depth), h), (p.x, p.y, z0 + h / 2), frame)
    fh = h / floors
    for f in range(floors + 1):
        p = c + n * depth * 0.5
        k.box(((width if abs(t.x) > 0.5 else depth), (width if abs(t.y) > 0.5 else depth), 0.45), (p.x, p.y, z0 + f * fh), frame)


# ------------------------------------------------------------------ A: cream tower, blue glass, dome
def tower_a():
    reset(); k = Kit()
    W = 24.0; H = 72.0
    k.box((W + 2, W + 2, 6.0), (0, 0, 3.0), "stone_d")                       # podium
    k.box((W + 3, 4.0, 0.6), (0, -W / 2 - 2.5, 4.6), "dark")                 # entrance canopy
    k.box((W - 0.2, W - 0.2, H), (0, 0, H / 2), "stone")                     # core
    for nx, ny in ((0, -1), (0, 1), (1, 0), (-1, 0)):
        c = (nx * W / 2, ny * W / 2, 0)
        facade_grid(k, c, W * 0.62, 7.0, H - 4.0, 18, (nx, ny, 0), 5)
    for sx in (-1, 1):                                                         # corner piers
        for sy in (-1, 1):
            k.box((3.2, 3.2, H + 2), (sx * (W / 2 - 1.2), sy * (W / 2 - 1.2), (H + 2) / 2), "stone")
    k.box((W + 1.0, W + 1.0, 1.0), (0, 0, H + 0.5), "stone_d")                # cornice
    k.cyl(W * 0.36, 6.0, (0, 0, H + 4.0), "stone", verts=32)                  # drum
    for i in range(16):
        a = i * math.tau / 16
        k.box((0.6, 0.6, 5.0), (math.cos(a) * W * 0.37, math.sin(a) * W * 0.37, H + 4.0), "white")
    k.dome(W * 0.36, (0, 0, H + 7.0), "glass_l", flat=0.8)
    k.cyl(0.5, 3.0, (0, 0, H + 7.0 + W * 0.36 * 0.8 + 1.5), "gold", verts=8)
    k.cyl(0.25, 6.0, (0, 0, H + 7.0 + W * 0.36 * 0.8 + 6.0), "gold", verts=8, r2=0.02)
    k.export(os.path.join(OUT, "lux_tower_a.glb"))


# ------------------------------------------------------------------ B: round glass tower with dome
def tower_b():
    reset(); k = Kit()
    R = 12.0; H = 58.0
    k.cyl(R + 3.0, 6.0, (0, 0, 3.0), "stone_d", verts=40)
    k.cyl(R, H, (0, 0, H / 2), "glass", verts=40)
    for i in range(20):                                                         # vertical stone ribs
        a = i * math.tau / 20
        k.box((0.8, 0.8, H), (math.cos(a) * R, math.sin(a) * R, H / 2), "stone", rot=(0, 0, a))
    for f in range(0, 17):
        k.cyl(R + 0.35, 0.4, (0, 0, 6.0 + f * (H - 6.0) / 16), "stone", verts=40)
    k.cyl(R + 0.8, 1.2, (0, 0, H + 0.6), "stone_d", verts=40)
    k.cyl(R * 0.75, 3.0, (0, 0, H + 2.7), "stone", verts=40)
    k.dome(R * 0.75, (0, 0, H + 4.2), "gold", flat=0.75)
    k.cyl(0.4, 4.0, (0, 0, H + 4.2 + R * 0.75 * 0.75 + 2.0), "gold", verts=8, r2=0.05)
    k.export(os.path.join(OUT, "lux_tower_b.glb"))


# ------------------------------------------------------------------ C: residential block, balconies
def res_c():
    reset(); k = Kit()
    L = 42.0; D = 16.0; F = 12; FH = 3.1; H = F * FH + 1.5
    k.box((L, D, H), (0, 0, H / 2), "stone")
    k.box((L + 0.4, D + 0.4, 1.4), (0, 0, 0.7), "stone_d")
    # windows: dark glass bands on both long sides + balconies with white rails
    for sy in (-1, 1):
        y = sy * (D / 2 + 0.05)
        for f in range(F):
            z = 1.5 + f * FH + 1.5
            for i in range(10):
                x = -L / 2 + 2.2 + i * (L - 4.4) / 9
                k.box((2.2, 0.12, 1.7), (x, y, z), "glass")
            if f > 0 and f < F - 1:
                for i in (1, 4, 7):
                    x = -L / 2 + 2.2 + i * (L - 4.4) / 9 + 2.0
                    k.box((5.2, 1.4, 0.2), (x, y + sy * 0.7, z - 1.0), "white")
                    k.box((5.2, 0.1, 1.0), (x, y + sy * 1.35, z - 0.45), "white")
    # top arcade: arches (columns) + a red hip roof
    for sy in (-1, 1):
        for i in range(13):
            x = -L / 2 + 1.5 + i * (L - 3) / 12
            k.box((0.6, 0.6, 3.0), (x, sy * (D / 2 + 0.3), H + 1.5), "white")
    k.box((L + 0.6, D + 0.6, 0.5), (0, 0, H + 3.2), "stone_d")
    k.box((L - 1.0, D - 1.0, 0.4), (0, 0, H + 3.6), "roof")                 # roof slab + pavilion
    k.box((L * 0.5, D * 0.6, 2.4), (0, 0, H + 5.0), "stone")
    k.box((L * 0.5 + 0.8, D * 0.6 + 0.8, 0.5), (0, 0, H + 6.4), "roof")
    # ground-floor shops with a dark canopy on the street side
    k.box((L - 2, 0.3, 3.0), (0, -D / 2 - 0.1, 2.0), "glass_l")
    k.box((L, 2.0, 0.3), (0, -D / 2 - 1.0, 3.7), "dark")
    k.export(os.path.join(OUT, "lux_res_c.glb"))


# ------------------------------------------------------------------ D: shopping centre
def mall():
    reset(); k = Kit()
    L = 96.0; D = 52.0; H = 18.0
    k.box((L, D, H), (0, 0, H / 2), "stone")
    k.box((L - 8, 0.4, H - 4), (0, -D / 2 - 0.05, (H - 4) / 2 + 1.0), "glass")         # glass front
    for i in range(13):
        x = -L / 2 + 4 + i * (L - 8) / 12
        k.box((0.5, 0.8, H - 4), (x, -D / 2 - 0.3, (H - 4) / 2 + 1.0), "steel")
    k.box((L + 1, 1.2, 4.0), (0, -D / 2 - 0.3, H - 1.0), "dark")                      # sign band
    k.text("СУПЕРМАРКЕТ", (-18, -D / 2 - 1.0, H - 1.2), 2.6, "green")
    k.text("ТЦ DUSHANBE-X", (24, -D / 2 - 1.0, H - 1.2), 2.6, "green")
    for x in (-36.0, 36.0):                                                             # LED screens with the flag
        k.box((10.4, 0.5, 6.4), (x, -D / 2 - 0.4, 8.5), "dark")
        k.plane_img(10.0, 6.0, (x, -D / 2 - 0.7, 8.5), "screen")
    k.box((20, 8, 0.5), (0, -D / 2 - 4, 5.5), "dark")                                    # entrance canopy
    for x in (-9.0, 9.0):
        k.box((0.6, 0.6, 5.5), (x, -D / 2 - 7.5, 2.75), "steel")
    # a glass rotunda tower on one corner (like the photo's curved glass tower)
    k.cyl(9.0, 38.0, (L / 2 - 10, D / 2 - 12, 19.0), "glass", verts=32)
    for f in range(9):
        k.cyl(9.3, 0.4, (L / 2 - 10, D / 2 - 12, 2.0 + f * 4.4), "steel", verts=32)
    k.cyl(4.0, 8.0, (L / 2 - 10, D / 2 - 12, 42.0), "steel", verts=16, r2=0.5)
    k.export(os.path.join(OUT, "mall.glb"))


# ------------------------------------------------------------------ E: park rotunda (gazebo)
def rotunda():
    reset(); k = Kit()
    k.cyl(7.0, 0.5, (0, 0, 0.25), "stone_d", verts=32)
    k.cyl(6.4, 0.5, (0, 0, 0.75), "white", verts=32)
    for i in range(10):
        a = i * math.tau / 10
        k.cyl(0.35, 6.0, (math.cos(a) * 5.4, math.sin(a) * 5.4, 4.0), "white", verts=12)
    k.cyl(6.2, 1.0, (0, 0, 7.5), "white", verts=32)
    k.dome(6.0, (0, 0, 8.0), "steel", flat=0.6)
    k.cyl(0.25, 2.0, (0, 0, 12.5), "gold", verts=8)
    k.export(os.path.join(OUT, "rotunda.glb"))


# ------------------------------------------------------------------ F: ornate double street lamp
def lamp():
    reset(); k = Kit()
    k.cyl(0.32, 0.8, (0, 0, 0.4), "white", verts=12)
    k.cyl(0.14, 7.5, (0, 0, 4.4), "white", verts=10, r2=0.09)
    for i in range(3):
        k.cyl(0.2, 0.18, (0, 0, 1.2 + i * 2.2), "white", verts=12)
    for sx in (-1, 1):
        k.box((1.4, 0.08, 0.08), (sx * 0.7, 0, 7.7), "white")
        k.cyl(0.03, 0.4, (sx * 1.4, 0, 7.55), "white", verts=6)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.3, location=(sx * 1.4, 0, 7.1))
        lo = bpy.context.object
        lo.scale = (1, 1, 1.25)
        bpy.ops.object.transform_apply(scale=True)
        k.add(lo, "white")
        k.cyl(0.32, 0.12, (sx * 1.4, 0, 7.48), "white", verts=12)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.32, location=(0, 0, 8.4))
    k.add(bpy.context.object, "white")
    k.export(os.path.join(OUT, "lamp_ornate.glb"))


os.makedirs(OUT, exist_ok=True)
if "extra" not in sys.argv and "park" not in sys.argv:
    for f in (tower_a, tower_b, res_c, mall, rotunda, lamp):
        f()


# ------------------------------------------------------------------ G: median flower bed (10 m piece)
def median_bed():
    reset(); k = Kit()
    k.M["curb"] = mat("curb", (0.82, 0.8, 0.76), 0.0, 0.7)
    k.M["soil"] = mat("soil", (0.22, 0.32, 0.14), 0.0, 0.95)
    k.M["red"] = mat("flower_red", (0.85, 0.08, 0.08), 0.0, 0.7)
    k.M["pink"] = mat("flower_pink", (0.95, 0.45, 0.6), 0.0, 0.7)
    k.M["yel"] = mat("flower_yellow", (0.98, 0.82, 0.15), 0.0, 0.7)
    k.M["leaf"] = mat("hedge", (0.16, 0.36, 0.12), 0.0, 0.9)
    k.box((2.8, 10.0, 0.25), (0, 0, 0.125), "curb")
    k.box((2.3, 9.7, 0.08), (0, 0, 0.27), "soil")
    for sx in (-1, 1):                                   # low clipped hedges along both curbs
        k.box((0.4, 9.6, 0.45), (sx * 0.9, 0, 0.5), "leaf")
    import random
    rnd = random.Random(7)
    for i in range(40):
        y = -4.6 + i * 0.235
        for j in range(3):
            x = -0.45 + j * 0.45 + rnd.uniform(-0.06, 0.06)
            col = ["red", "red", "pink", "yel"][(i // 4 + j) % 4]
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.13, location=(x, y + rnd.uniform(-0.05, 0.05), 0.42))
            k.add(bpy.context.object, col)
    k.export(os.path.join(OUT, "median_bed.glb"))


# ------------------------------------------------------------------ H: flag pole with the flag of Tajikistan
def flagpole():
    reset(); k = Kit()
    k.M["flag"] = mat("flag", (1, 1, 1), 0.0, 0.6, img=FLAG)
    k.cyl(0.18, 0.5, (0, 0, 0.25), "white", verts=12)
    k.cyl(0.07, 9.0, (0, 0, 4.5), "white", verts=8, r2=0.05)
    bpy.ops.mesh.primitive_uv_sphere_add(segments=10, ring_count=5, radius=0.12, location=(0, 0, 9.05))
    k.add(bpy.context.object, "gold")
    # the cloth: a gently waved strip, 2.4 x 1.2 m, hanging off the pole on +X
    bm = bmesh.new()
    nx, nz = 12, 4
    verts = []
    for j in range(nz + 1):
        row = []
        for i in range(nx + 1):
            u, v = i / nx, j / nz
            x = 0.08 + u * 2.4
            yv = math.sin(u * 5.0) * 0.12 * u
            z = 8.85 - 1.2 + v * 1.2 - u * 0.15
            row.append(bm.verts.new((x, yv, z)))
        verts.append(row)
    uv = bm.loops.layers.uv.new()
    for j in range(nz):
        for i in range(nx):
            f = bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
            for lp, (a, b) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                lp[uv].uv = (a / nx, b / nz)
    me = bpy.data.meshes.new("cloth")
    bm.to_mesh(me)
    o = bpy.data.objects.new("cloth", me)
    bpy.context.collection.objects.link(o)
    k.add(o, "flag")
    k.export(os.path.join(OUT, "flagpole.glb"))


if "extra" in sys.argv:
    median_bed()
    flagpole()


# ------------------------------------------------------------------ I: Ferris wheel (~32 m)
def ferris():
    reset(); k = Kit()
    k.M["cab"] = mat("cabin", (0.95, 0.35, 0.2), 0.2, 0.4)
    k.M["cab2"] = mat("cabin2", (0.2, 0.55, 0.95), 0.2, 0.4)
    R = 15.0; C = (0, 0, R + 2.5)
    for sy in (-1.2, 1.2):                                         # two rims + spokes
        bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=0.18, major_segments=64, minor_segments=6,
                                         location=(0, sy, C[2]), rotation=(math.pi / 2, 0, 0))
        k.add(bpy.context.object, "white")
        for i in range(16):
            a = i * math.tau / 16
            k.box((0.12, 0.12, R), (math.cos(a) * R / 2, sy, C[2] + math.sin(a) * R / 2), "white", rot=(0, -a + math.pi / 2, 0))
    k.cyl(0.8, 3.0, (0, 0, C[2]), "steel", verts=16)
    k.objs[-1].rotation_euler = (math.pi / 2, 0, 0)
    for sy in (-1, 1):                                              # A-frame legs
        for sx in (-1, 1):
            L = math.hypot(R * 0.55, C[2])
            k.box((0.5, 0.5, L), (sx * R * 0.27, sy * 2.6, C[2] / 2), "white", rot=(0, sx * math.atan2(R * 0.55, C[2]), 0))
    for i in range(16):                                             # gondolas
        a = i * math.tau / 16
        x, z = math.cos(a) * R, C[2] + math.sin(a) * R
        k.box((1.6, 2.0, 1.6), (x, 0, z - 1.4), "cab" if i % 2 else "cab2")
        k.box((1.8, 2.2, 0.15), (x, 0, z - 0.5), "white")
    k.box((12, 8, 0.6), (0, 0, 0.3), "stone_d")
    for o in k.objs:
        bpy.context.view_layer.objects.active = o
    k.export(os.path.join(OUT, "ferris_wheel.glb"))


# ------------------------------------------------------------------ J: "I ♥ ДУШАНБЕ" letters (~2 m)
def love_sign():
    reset(); k = Kit()
    k.M["red"] = mat("heart_red", (0.9, 0.06, 0.08), 0.0, 0.4, emit=(0.4, 0.0, 0.0))
    k.box((15.0, 1.4, 0.4), (0, 0, 0.2), "stone_d")
    k.text("I", (-6.4, 0, 1.4), 2.4, "white", extrude=0.3)
    k.text("ДУШАНБЕ", (1.4, 0, 1.4), 2.4, "white", extrude=0.3)
    # heart: two spheres + a rotated box
    for sx in (-0.42, 0.42):
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=0.55, location=(-4.6 + sx, 0, 1.75))
        o = bpy.context.object
        o.scale = (1, 0.5, 1)
        bpy.ops.object.transform_apply(scale=True)
        k.add(o, "red")
    k.box((0.95, 0.5, 0.95), (-4.6, 0, 1.25), "red", rot=(0, math.pi / 4, 0))
    for o in k.objs:
        if o.name.startswith("Text"):
            pass
    k.export(os.path.join(OUT, "love_sign.glb"))


# ------------------------------------------------------------------ K: park gate «БОҒИ КАЛОНИ ДУШАНБЕ»
def park_gate():
    reset(); k = Kit()
    for sx in (-1, 1):
        k.box((2.6, 2.6, 9.0), (sx * 6.2, 0, 4.5), "stone")
        k.box((3.0, 3.0, 0.6), (sx * 6.2, 0, 9.3), "stone_d")
        k.box((1.6, 1.0, 5.0), (sx * 6.2, -1.35, 3.6), "gold")
        k.box((1.2, 1.2, 4.6), (sx * 9.4, 0, 2.3), "stone")             # side pylons
        for i in range(6):                                              # wrought fence beyond the pylons
            k.box((0.08, 0.08, 2.4), (sx * (11.0 + i * 0.6), 0, 1.2), "dark")
        k.box((3.6, 0.1, 0.1), (sx * 12.5, 0, 2.3), "dark")
    # the arch over the gate
    bm_r_in, bm_r_out = 4.9, 6.2
    bm = bmesh.new()
    seg = 24
    rings = []
    for i in range(seg + 1):
        a = math.pi * i / seg
        ring = []
        for (r, dy) in ((bm_r_in, -1.2), (bm_r_out, -1.2), (bm_r_out, 1.2), (bm_r_in, 1.2)):
            ring.append(bm.verts.new((math.cos(a) * r, dy, 9.0 + math.sin(a) * r * 0.55)))
        rings.append(ring)
    for i in range(seg):
        for j in range(4):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % 4], rings[i + 1][(j + 1) % 4], rings[i + 1][j]))
    me = bpy.data.meshes.new("arch")
    bm.to_mesh(me)
    o = bpy.data.objects.new("arch", me)
    bpy.context.collection.objects.link(o)
    k.add(o, "stone")
    k.box((11.0, 0.5, 2.4), (0, -1.3, 10.2), "dark")                    # name board
    k.text("БОҒИ КАЛОНИ ДУШАНБЕ", (0, -1.6, 10.2), 0.75, "gold", extrude=0.05)
    k.export(os.path.join(OUT, "park_gate.glb"))


# ------------------------------------------------------------------ L: ornate lamp with two flag banners
def lamp_flags():
    reset(); k = Kit()
    k.M["flag"] = mat("flag", (1, 1, 1), 0.0, 0.6, img=FLAG)
    k.cyl(0.32, 0.8, (0, 0, 0.4), "white", verts=12)
    k.cyl(0.14, 7.5, (0, 0, 4.4), "white", verts=10, r2=0.09)
    for sx in (-1, 1):
        k.box((1.4, 0.08, 0.08), (sx * 0.7, 0, 7.7), "white")
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.3, location=(sx * 1.4, 0, 7.1))
        lo = bpy.context.object
        lo.scale = (1, 1, 1.25)
        bpy.ops.object.transform_apply(scale=True)
        k.add(lo, "white")
        k.cyl(0.32, 0.12, (sx * 1.4, 0, 7.48), "white", verts=12)
        # vertical banner with the flag (turned upright: stripes run down)
        bpy.ops.mesh.primitive_plane_add(size=1, location=(sx * 0.42, 0, 4.6), rotation=(math.pi / 2, math.pi / 2, 0))
        b = bpy.context.object
        b.scale = (1.8, 0.7, 1)
        bpy.ops.object.transform_apply(scale=True, rotation=True)
        k.add(b, "flag")
        k.box((0.75, 0.05, 0.05), (sx * 0.42, 0, 5.52), "white")
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=0.32, location=(0, 0, 8.4))
    k.add(bpy.context.object, "white")
    k.export(os.path.join(OUT, "lamp_ornate.glb"))


if "park" in sys.argv:
    ferris()
    love_sign()
    park_gate()
    lamp_flags()
