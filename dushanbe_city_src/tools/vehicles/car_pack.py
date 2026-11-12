"""Splits the owner's car pack (car_pack_1.glb: BMW E30, BMW E30 lowered, Mercedes-Benz W123,
Renault 12; Sketchfab models supplied by the project owner) into one GLB per car for VehicleCar:

  * the car centred on the origin (x, y), ground at z = 0, front still at Blender -Y (yaw PI in game)
  * wheels renamed "tire_<n>" (VehicleCar "names" mode: separate spinning / steering wheels)
  * Tajik number plates: quads "plate_front" / "plate_rear" (material "tj_plate", the generated
    plate background) laid 6 mm over the European plates printed on the texture; the number itself is
    a Label3D the game puts on them (changeable at the auto service)
  * lamp lenses as their own quads over the lamps on the texture, with the material names the
    game's VehicleLights drives: "headlight rf", "taillight rr", "body.5" (reversing), "fari.4" (front
    indicators), "fari.3" / "fari.2" (left / right indicators). Left = Blender +X (the car faces -Y).
Positions (x, z) were measured from orthographic views; the y of every quad comes from a ray cast
onto the body, so it sits on the real surface.

  blender -b --python car_pack.py -- car_pack_1.glb OUT_DIR
"""
import bpy, sys, os, json
from mathutils import Vector

a = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = a[0], a[1]
PLATE_IMG = "/home/user/safarzod/dushanbe_city/assets/vehicles/plates/tj_plate.png"
os.makedirs(OUT, exist_ok=True)

# per car: pack root, plate centres (x rel, z) front / rear, lamp layout
# lamps: (material, side, x_rel, z, w, h) on the front ("f") or the rear ("r"); x_rel > 0 = left (+X)
CARS = {
    "e30": {"root": "D 30", "plates": {"f": (0.0, 0.31), "r": (0.0, 0.555)},
            "lamps": [("headlight rf", "f", 0.43, 0.53, 0.32, 0.11), ("headlight rf", "f", -0.43, 0.53, 0.32, 0.11),
                      ("fari.4", "f", 0.64, 0.31, 0.1, 0.05), ("fari.4", "f", -0.64, 0.31, 0.1, 0.05),
                      ("taillight rr", "r", 0.56, 0.575, 0.36, 0.12), ("taillight rr", "r", -0.56, 0.575, 0.36, 0.12),
                      ("body.5", "r", 0.34, 0.575, 0.08, 0.1), ("body.5", "r", -0.34, 0.575, 0.08, 0.1),
                      ("fari.3", "r", 0.72, 0.6, 0.06, 0.06), ("fari.2", "r", -0.72, 0.6, 0.06, 0.06)]},
    "e30_low": {"root": "D 30 low", "plates": {"f": (0.0, 0.31), "r": (0.0, 0.555)}, "same_as": "e30"},
    "w123": {"root": "m123", "plates": {"f": (0.0, 0.43), "r": (0.0, 0.625)},
             "lamps": [("headlight rf", "f", 0.5, 0.7, 0.3, 0.13), ("headlight rf", "f", -0.5, 0.7, 0.3, 0.13),
                       ("fari.4", "f", 0.72, 0.7, 0.08, 0.12), ("fari.4", "f", -0.72, 0.7, 0.08, 0.12),
                       ("taillight rr", "r", 0.55, 0.63, 0.42, 0.13), ("taillight rr", "r", -0.55, 0.63, 0.42, 0.13),
                       ("body.5", "r", 0.38, 0.63, 0.08, 0.1), ("body.5", "r", -0.38, 0.63, 0.08, 0.1),
                       ("fari.3", "r", 0.74, 0.63, 0.08, 0.1), ("fari.2", "r", -0.74, 0.63, 0.08, 0.1)]},
    "r12": {"root": "R 12", "plates": {"f": (0.0, 0.39), "r": (0.0, 0.55)},
            "lamps": [("headlight rf", "f", 0.53, 0.66, 0.3, 0.12), ("headlight rf", "f", -0.53, 0.66, 0.3, 0.12),
                      ("fari.4", "f", 0.6, 0.42, 0.1, 0.05), ("fari.4", "f", -0.6, 0.42, 0.1, 0.05),
                      ("taillight rr", "r", 0.49, 0.55, 0.3, 0.13), ("taillight rr", "r", -0.49, 0.55, 0.3, 0.13),
                      ("body.5", "r", 0.33, 0.55, 0.06, 0.1), ("body.5", "r", -0.33, 0.55, 0.06, 0.1),
                      ("fari.3", "r", 0.66, 0.55, 0.06, 0.1), ("fari.2", "r", -0.66, 0.55, 0.06, 0.1)]},
}
LAMP_COL = {"headlight rf": (0.9, 0.92, 0.95), "taillight rr": (0.5, 0.02, 0.02), "body.5": (0.85, 0.85, 0.85),
            "fari.4": (0.95, 0.5, 0.05), "fari.3": (0.95, 0.5, 0.05), "fari.2": (0.95, 0.5, 0.05)}


def mat(name, col=None, img=None):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    if col:
        b.inputs["Base Color"].default_value = (*col, 1.0)
    b.inputs["Roughness"].default_value = 0.3
    if img:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = bpy.data.images.load(img)
        m.node_tree.links.new(t.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = 0.5
    return m


def quad(name, centre, w, h, normal_y, material):
    """a w x h quad facing +-Y at centre"""
    bpy.ops.mesh.primitive_plane_add(size=1, location=centre, rotation=(1.5708, 0, 0 if normal_y < 0 else 3.14159))
    o = bpy.context.object
    o.scale = (w, h, 1)
    bpy.ops.object.transform_apply(scale=True, rotation=True)
    o.name = name
    o.data.materials.append(material)
    return o


def surface_y(depsgraph, x, z, side):
    """y of the body surface at (x, z) seen from the front (side 'f': -Y) or the rear ('r': +Y)"""
    sc = bpy.context.scene
    if side == "f":
        hit, loc, *_ = sc.ray_cast(depsgraph, Vector((x, -50.0, z)), Vector((0, 1, 0)))
    else:
        hit, loc, *_ = sc.ray_cast(depsgraph, Vector((x, 50.0, z)), Vector((0, -1, 0)))
    return loc.y if hit else None


import bmesh, numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform


class Probe:
    """ray casts onto the car body that return the texture colour at the hit"""
    def __init__(self, meshes):
        self.items = []
        for o in meshes:
            if o.name.startswith("tire_") or not o.data.materials:
                continue
            img = None
            m = o.data.materials[0]
            if m and m.use_nodes:
                for nd in m.node_tree.nodes:
                    if nd.type == 'TEX_IMAGE' and nd.image:
                        img = nd.image
                        break
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bm.transform(o.matrix_world)
            bmesh.ops.triangulate(bm, faces=bm.faces[:])
            bm.faces.ensure_lookup_table()
            uv = bm.loops.layers.uv.active
            px = None
            if img is not None:
                w, h = img.size
                px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)
            self.items.append((BVHTree.FromBMesh(bm), bm, uv, px))

    def cast(self, origin, d):
        best = None
        for tree, bm, uv, px in self.items:
            loc, nrm, idx, dist = tree.ray_cast(origin, d, 100.0)
            if loc is None or (best and dist >= best[0]):
                continue
            col = None
            if px is not None and uv is not None:
                f = bm.faces[idx]
                v = [l.vert.co for l in f.loops]
                t = [Vector((l[uv].uv.x, l[uv].uv.y, 0.0)) for l in f.loops]
                u = barycentric_transform(loc, v[0], v[1], v[2], t[0], t[1], t[2])
                hh, ww = px.shape[:2]
                ix = int((u.x % 1.0) * (ww - 1))
                iy = int((u.y % 1.0) * (hh - 1))
                col = px[iy, ix, :3]
            best = (dist, loc, col)
        return best


def classify(c):
    if c is None:
        return ""
    r, g, b = float(c[0]), float(c[1]), float(c[2])
    mx, mn = max(r, g, b), min(r, g, b)
    if r > 0.35 and g < 0.6 * r * 0.55 + 0.05 and b < 0.25 and r - g > 0.18:
        return "red"
    if r > 0.55 and 0.25 < g < 0.75 and b < 0.3 and r - b > 0.4:
        return "amber"
    if b > 0.35 and b > r + 0.15 and b > g + 0.05:
        return "blue"
    if mx > 0.62 and mx - mn < 0.12:
        return "white"
    return ""


def blobs(grid, kind):
    """connected components (4-neighbour) of cells == kind -> list of (count, x0, x1, z0, z1)"""
    H, W = len(grid), len(grid[0])
    seen = [[False] * W for _ in range(H)]
    out = []
    for j in range(H):
        for i in range(W):
            if seen[j][i] or grid[j][i][0] != kind:
                continue
            stack = [(j, i)]
            seen[j][i] = True
            cells = []
            while stack:
                a2, b2 = stack.pop()
                cells.append(grid[a2][b2])
                for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    p2, q2 = a2 + da, b2 + db
                    if 0 <= p2 < H and 0 <= q2 < W and not seen[p2][q2] and grid[p2][q2][0] == kind:
                        seen[p2][q2] = True
                        stack.append((p2, q2))
            xs = [c[1] for c in cells]
            zs = [c[2] for c in cells]
            ys = [c[3] for c in cells]
            out.append((len(cells), min(xs), max(xs), min(zs), max(zs), sum(ys) / len(ys)))
    return sorted(out, reverse=True)


def scan(probe, side, half_w):
    """sample the front / rear face on a 1.2 cm grid -> grid of (kind, x, z, y)"""
    step = 0.012
    grid = []
    z = 0.15
    while z < 1.05:
        row = []
        x = -half_w
        while x <= half_w:
            if side == "f":
                h = probe.cast(Vector((x, -40.0, z)), Vector((0, 1, 0)))
            else:
                h = probe.cast(Vector((x, 40.0, z)), Vector((0, -1, 0)))
            row.append((classify(h[2]) if h else "", x, z, h[1].y if h else 0.0))
            x += step
        grid.append(row)
        z += step
    return grid


report = {}
for cid, spec in CARS.items():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=SRC)
    root = bpy.data.objects[spec["root"]]
    keep = set([root] + list(root.children_recursive))
    for o in list(bpy.data.objects):
        if o not in keep and o.type == 'MESH':
            bpy.data.objects.remove(o)
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # world bbox of the car -> centre on the origin
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (mn + mx) * 0.5
    # bake transforms, unparent, move to the origin
    for o in meshes:
        mw = o.matrix_world.copy()
        o.parent = None
        o.matrix_world = mw
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in meshes:
        o.data.transform(__import__("mathutils").Matrix.Translation((-c.x, -c.y, -mn.z)))
    for o in list(bpy.data.objects):
        if o.type != 'MESH':
            bpy.data.objects.remove(o)
    n = 0
    for o in meshes:
        if "wheel" in o.name.lower():
            o.name = "tire_%d" % n
            n += 1
    depsgraph = bpy.context.evaluated_depsgraph_get()
    L = mx.y - mn.y
    # detect the printed plates and lamps on the texture, then lay the plates / lamp lenses over them
    probe = Probe([o for o in bpy.data.objects if o.type == 'MESH'])
    pm = mat("tj_plate", img=PLATE_IMG)
    plates = {}
    found = {}
    for side in ("f", "r"):
        grid = scan(probe, side, (mx.x - mn.x) * 0.5 - 0.02)
        found[side] = grid
        # plate: the largest white blob around the middle (|x| < 0.35)
        # the EU plate's blue band (left, full height) gives the plate's height and left edge; the
        # plate is 520 mm long
        blue = [b for b in blobs(grid, "blue") if b[0] >= 4 and abs((b[1] + b[2]) * 0.5) < 0.4 and 0.05 < b[4] - b[3] < 0.2]
        cand = [b for b in blobs(grid, "white") if abs((b[1] + b[2]) * 0.5) < 0.12 and 0.3 < b[2] - b[1] < 0.7 and 0.03 < b[4] - b[3] < 0.2]
        if blue:
            n_, x0, x1, z0, z1, yy = blue[0]
            # the band is on the plate's left as seen from outside: -X at the front, +X at the rear
            left = x0 if side == "f" else x1
            px = left + (0.26 if side == "f" else -0.26)
            pz, pw, ph = (z0 + z1) * 0.5, 0.55, max(0.125, z1 - z0 + 0.03)
        elif cand:
            n_, x0, x1, z0, z1, yy = cand[0]
            px, pz, pw, ph = (x0 + x1) * 0.5, (z0 + z1) * 0.5, max(0.53, x1 - x0 + 0.03), max(0.118, z1 - z0 + 0.025)
        else:
            px, pz = spec["plates"][side]
            pw, ph = 0.53, 0.118
            yy = surface_y(depsgraph, px, pz, side) or ((-L / 2) if side == "f" else (L / 2))
        y = yy + (-0.008 if side == "f" else 0.008)
        quad("plate_front" if side == "f" else "plate_rear", (px, y, pz), pw, ph, -1 if side == "f" else 1, pm)
        plates[side] = [round(px, 3), round(y, 3), round(pz, 3), round(pw, 3), round(ph, 3)]
        # lamps
        def lens(kind_mat, b, k):
            n_, x0, x1, z0, z1, yy = b
            yy += -0.006 if side == "f" else 0.006
            quad("lamp_%s_%d" % (side, k), ((x0 + x1) * 0.5, yy, (z0 + z1) * 0.5), x1 - x0 + 0.012, z1 - z0 + 0.012,
                 -1 if side == "f" else 1, mat(kind_mat, LAMP_COL[kind_mat]))
        k = 0
        if side == "r":
            for b in [b for b in blobs(grid, "red") if b[0] > 25][:4]:
                lens("taillight rr", b, k); k += 1
            for b in [b for b in blobs(grid, "amber") if b[0] > 6][:2]:
                lens("fari.3" if (b[1] + b[2]) > 0 else "fari.2", b, k); k += 1
            whites = [b for b in blobs(grid, "white") if b[0] > 6 and abs((b[1] + b[2]) * 0.5) > 0.2 and b[4] < pz + 0.25 and b[3] > pz - 0.15]
            for b in whites[:2]:
                lens("body.5", b, k); k += 1
        else:
            for b in [b for b in blobs(grid, "amber") if b[0] > 6][:2]:
                lens("fari.4", b, k); k += 1
            heads = [b for b in blobs(grid, "white") if b[0] > 20 and abs((b[1] + b[2]) * 0.5) > 0.2 and b[3] > pz + 0.04]
            for b in heads[:2]:
                lens("headlight rf", b, k); k += 1
            if not heads:
                for sx in (-1, 1):
                    hz = pz + 0.24
                    y0 = surface_y(depsgraph, sx * 0.55, hz, "f")
                    if y0 is not None:
                        lens("headlight rf", (1, sx * 0.55 - 0.15, sx * 0.55 + 0.15, hz - 0.06, hz + 0.06, y0), k); k += 1
    report_lamps = {s2: [o.name for o in bpy.data.objects if o.name.startswith("lamp_" + s2)] for s2 in ("f", "r")}
    print("LAMPS", cid, report_lamps)
    wheels = [o for o in bpy.data.objects if o.name.startswith("tire_")]
    wz = [(o.matrix_world @ Vector(cc)) for o in wheels for cc in o.bound_box]
    r = (max(p.z for p in wz) - min(p.z for p in wz)) * 0.5
    ys = sorted(set(round(sum((o.matrix_world @ Vector(cc)).y for cc in o.bound_box) / 8, 2) for o in wheels))
    report[cid] = {"size": [round(mx.x - mn.x, 3), round(mx.z - mn.z, 3), round(L, 3)], "r": round(r, 3),
                   "axles_y": ys, "plates": plates, "tris": sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')}
    # mobile: 4096 textures -> 2048 (a quarter of the memory; the cars are never that close on a phone)
    for im in bpy.data.images:
        if im.size[0] > 2048:
            im.scale(2048, 2048)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, cid + ".glb"), export_format='GLB', export_apply=True,
                              export_image_format='JPEG', export_jpeg_quality=88)
    print("BUILD", cid, report[cid])
json.dump(report, open(os.path.join(OUT, "car_pack.json"), "w"), indent=1)
