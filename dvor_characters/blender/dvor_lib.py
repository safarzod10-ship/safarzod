from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field

import bmesh
import bpy
from mathutils import Euler, Matrix, Quaternion, Vector

ATLAS = 512
CELL = 64
FPS = 30

BONES = [
    ("root", None), ("pelvis", "root"), ("spine", "pelvis"), ("chest", "spine"),
    ("neck", "chest"), ("head", "neck"),
    ("upper_arm.L", "chest"), ("forearm.L", "upper_arm.L"), ("hand.L", "forearm.L"),
    ("upper_arm.R", "chest"), ("forearm.R", "upper_arm.R"), ("hand.R", "forearm.R"),
    ("thigh.L", "pelvis"), ("shin.L", "thigh.L"), ("foot.L", "shin.L"),
    ("thigh.R", "pelvis"), ("shin.R", "thigh.R"), ("foot.R", "shin.R"),
]
BONE_NAMES = [b for b, _ in BONES]
CLIPS = ["Idle", "Run", "Attack", "Ability", "Hit", "Defeat", "Victory"]


def V(*a) -> Vector:
    return Vector(a[0] if len(a) == 1 else a)


def sgnpow(x: float, p: float) -> float:
    return math.copysign(abs(x) ** p, x)


def mirror_x(v: Vector) -> Vector:
    return Vector((-v.x, v.y, v.z))


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.unit_settings.system = "METRIC"
    sc.render.fps = FPS


class Atlas:

    def __init__(self, palette: dict[str, tuple[int, int, int]]):
        self.palette = palette
        self.index = {k: i for i, k in enumerate(palette)}
        assert len(palette) <= 48

    def cell_origin(self, key: str) -> tuple[int, int]:
        i = self.index[key]
        if i < 32:
            return 256 + (i % 4) * CELL, (i // 4) * CELL
        j = i - 32
        return (j % 4) * CELL, 256 + (j // 4) * CELL

    def uv(self, key: str, t: float = 0.5) -> tuple[float, float]:
        x0, y0 = self.cell_origin(key)
        t = min(1.0, max(0.0, t))
        y = y0 + 54 - t * 44
        return (x0 + 32) / ATLAS, 1.0 - y / ATLAS

    @staticmethod
    def face_uv(lon_deg: float, lat_deg: float) -> tuple[float, float]:
        x = (lon_deg + 90.0) / 180.0 * 256.0
        y = (90.0 - lat_deg) / 180.0 * 256.0
        x = min(255.5, max(0.5, x))
        y = min(255.5, max(0.5, y))
        return x / ATLAS, 1.0 - y / ATLAS


def paint_atlas(atlas: Atlas, face_painter, path: str):
    from PIL import Image, ImageDraw

    img = Image.new("RGB", (ATLAS, ATLAS), (128, 128, 128))
    px = img.load()
    for key, col in atlas.palette.items():
        x0, y0 = atlas.cell_origin(key)
        for yy in range(CELL):
            f = 1.06 - 0.20 * (yy / (CELL - 1))
            c = tuple(max(0, min(255, int(round(ch * f)))) for ch in col)
            for xx in range(CELL):
                px[x0 + xx, y0 + yy] = c
    SS = 4
    face = Image.new("RGB", (256 * SS, 256 * SS), atlas.palette["skin"])
    d = ImageDraw.Draw(face)

    def P(lon, lat):
        return ((lon + 90.0) / 180.0 * 256 * SS, (90.0 - lat) / 180.0 * 256 * SS)

    face_painter(d, P, SS)
    face = face.resize((256, 256), Image.LANCZOS)
    img.paste(face, (0, 0))
    img.save(path)
    return path


@dataclass
class Part:
    name: str
    verts: list
    faces: list
    face_uvs: list
    weight: tuple
    smooth: bool = True


class Kit:

    def __init__(self, name: str, atlas: Atlas):
        self.name = name
        self.atlas = atlas
        self.parts: list[Part] = []

    def _add(self, name, verts, faces, color, weight, smooth=True, zrange=None, face_colors=None,
             uv_fn=None):
        zs = [v.z for v in verts]
        z0, z1 = zrange if zrange else (min(zs), max(zs))
        span = max(1e-6, z1 - z0)
        fuv = []
        for fi, f in enumerate(faces):
            if uv_fn is not None:
                fuv.append(uv_fn(f, verts))
                continue
            key = face_colors[fi] if face_colors else color
            fuv.append([self.atlas.uv(key, (verts[i].z - z0) / span) for i in f])
        self.parts.append(Part(name, verts, faces, fuv, weight, smooth))
        return self.parts[-1]

    def loft(self, name, rings, color, weight, sides=10, power=1.0, cap0=True, cap1=True,
             front=V(0, -1, 0), face_color_fn=None, smooth=True, phase=0.0, closed=False):
        verts, faces = [], []
        n = len(rings)
        centers = [V(r[0]) for r in rings]
        if closed:
            cap0 = cap1 = False
        for i, r in enumerate(rings):
            c, rx, ry = V(r[0]), r[1], r[2]
            off = r[3] if len(r) > 3 else (0.0, 0.0)
            if closed:
                T = (centers[(i + 1) % n] - centers[i - 1]).normalized()
            elif i == 0:
                T = (centers[1] - centers[0]).normalized()
            elif i == n - 1:
                T = (centers[-1] - centers[-2]).normalized()
            else:
                T = (centers[i + 1] - centers[i - 1]).normalized()
            F = (front - front.dot(T) * T)
            if F.length < 1e-6:
                F = V(0, 0, 1) - V(0, 0, 1).dot(T) * T
            F.normalize()
            S = F.cross(T).normalized()
            for k in range(sides):
                a = 2 * math.pi * (k + phase) / sides
                ca, sa = math.cos(a), math.sin(a)
                p = c + S * (rx * sgnpow(ca, power) + off[0]) + F * (ry * sgnpow(sa, power) + off[1])
                verts.append(p)
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            for k in range(sides):
                a, b = i * sides + k, i * sides + (k + 1) % sides
                c_, d = j * sides + (k + 1) % sides, j * sides + k
                faces.append((a, b, c_, d))
        if cap0:
            faces.append(tuple(reversed(range(0, sides))))
        if cap1:
            faces.append(tuple(range((n - 1) * sides, n * sides)))
        fc = None
        if face_color_fn:
            fc = []
            for f in faces:
                cen = sum((verts[i] for i in f), Vector()) / len(f)
                fc.append(face_color_fn(cen, f) or color)
        return self._add(name, verts, faces, color, weight, smooth, face_colors=fc)

    def blob(self, name, center, radii, color, weight, seg=12, rings=8, power=1.0, power_z=None,
             rot=(0, 0, 0), face_color_fn=None, smooth=True, head_uv=False, back_color=None,
             squash_bottom=1.0):
        pz = power if power_z is None else power_z
        center = V(center)
        R = Euler([math.radians(a) for a in rot], "XYZ").to_matrix()
        verts, latlon = [], []
        for i in range(1, rings):
            lat = -math.pi / 2 + math.pi * i / rings
            for k in range(seg):
                lon = 2 * math.pi * k / seg - math.pi
                cl, sl = math.cos(lat), math.sin(lat)
                x = radii[0] * sgnpow(cl, pz) * sgnpow(math.sin(lon), power)
                y = -radii[1] * sgnpow(cl, pz) * sgnpow(math.cos(lon), power)
                z = radii[2] * sgnpow(sl, pz) * (squash_bottom if sl < 0 else 1.0)
                verts.append(center + R @ V(x, y, z))
                latlon.append((math.degrees(lat), math.degrees(lon)))
        south = len(verts)
        verts.append(center + R @ V(0, 0, -radii[2] * squash_bottom))
        latlon.append((-90.0, 0.0))
        north = len(verts)
        verts.append(center + R @ V(0, 0, radii[2]))
        latlon.append((90.0, 0.0))
        faces = []
        for i in range(rings - 2):
            for k in range(seg):
                a, b = i * seg + k, i * seg + (k + 1) % seg
                faces.append((a, b, b + seg, a + seg))
        for k in range(seg):
            faces.append((south, (k + 1) % seg, k))
            top = (rings - 2) * seg
            faces.append((north, top + k, top + (k + 1) % seg))
        if not head_uv:
            fc = None
            if face_color_fn:
                fc = []
                for f in faces:
                    cen = sum((verts[i] for i in f), Vector()) / len(f)
                    fc.append(face_color_fn(cen, f) or color)
            return self._add(name, verts, faces, color, weight, smooth, face_colors=fc)

        assert seg % 4 == 0
        atlas = self.atlas

        def uv_fn(f, vs):
            lons = []
            for i in f:
                lat, lon = latlon[i]
                lons.append(lon)
            real = [latlon[i][1] for i in f if abs(latlon[i][0]) < 89.9]
            mean_lon = sum(real) / len(real)
            front_face = abs(mean_lon) <= 90.0 + 1e-3 and all(abs(l) <= 90.0 + 1e-3 for l in real)
            out = []
            for i in f:
                lat, lon = latlon[i]
                if abs(lat) > 89.9:
                    lon = mean_lon
                if front_face:
                    out.append(atlas.face_uv(lon, lat))
                else:
                    out.append(atlas.uv(back_color or color, 0.8))
            return out

        return self._add(name, verts, faces, color, weight, smooth, uv_fn=uv_fn)

    def shape(self, name, pts2d, matrix, depth, color, weight, smooth=False, bevel_scale=1.0):
        n = len(pts2d)
        verts = [matrix @ V(x, y, 0.0) for x, y in pts2d]
        verts += [matrix @ V(x * bevel_scale, y * bevel_scale, -depth) for x, y in pts2d]
        faces = [tuple(range(n)), tuple(reversed(range(n, 2 * n)))]
        for k in range(n):
            a, b = k, (k + 1) % n
            faces.append((b, a, n + a, n + b))
        return self._add(name, verts, faces, color, weight, smooth)

    def mirror_part(self, part: Part, name: str, weight):
        verts = [mirror_x(v) for v in part.verts]
        faces = [tuple(reversed(f)) for f in part.faces]
        uvs = [list(reversed(u)) for u in part.face_uvs]
        self.parts.append(Part(name, verts, faces, uvs, weight, part.smooth))
        return self.parts[-1]


def build_armature(name: str, joints: dict) -> bpy.types.Object:
    arm = bpy.data.armatures.new(name + "_Skeleton")
    obj = bpy.data.objects.new(name + "_Rig", arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    for bname, parent in BONES:
        h, t = joints[bname]
        eb = arm.edit_bones.new(bname)
        eb.head, eb.tail = V(h), V(t)
        eb.roll = 0.0
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    arm.display_type = "STICK"
    return obj


def _chain_weights(p: Vector, segs: list, blend: float) -> dict:
    ws = {}
    best, best_a = None, 1e9
    for bone, a, b in segs:
        ab = b - a
        L = ab.length
        t = (p - a).dot(ab) / (L * L)
        outside = max(0.0, -t, t - 1.0) * L
        w = max(0.0, 1.0 - outside / blend)
        if w > 0:
            ws[bone] = w * w * (3 - 2 * w)
        if outside < best_a:
            best_a, best = outside, bone
    if not ws:
        ws = {best: 1.0}
    return ws


def skin_mesh(obj, parts: list[Part], part_ranges: list, joints: dict, max_inf=3):
    groups = {b: obj.vertex_groups.new(name=b) for b in BONE_NAMES if b != "root"}
    for part, (v0, v1) in zip(parts, part_ranges):
        kind = part.weight[0]
        for vi in range(v0, v1):
            p = obj.data.vertices[vi].co
            if kind == "rigid":
                ws = {part.weight[1]: 1.0}
            else:
                bones, blend = part.weight[1], part.weight[2]
                segs = [(b, V(joints[b][0]), V(joints[b][1])) for b in bones]
                ws = _chain_weights(p, segs, blend)
            items = sorted(ws.items(), key=lambda kv: -kv[1])[:max_inf]
            items = [(b, w) for b, w in items if w >= 0.03] or items[:1]
            tot = sum(w for _, w in items)
            for b, w in items:
                groups[b].add([vi], w / tot, "REPLACE")


def build_mesh_object(kit: Kit, joints: dict, material, rig) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(kit.name + "_LOD0")
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    ranges = []
    for part in kit.parts:
        base = len(bm.verts)
        bverts = [bm.verts.new(v) for v in part.verts]
        for f, uvs in zip(part.faces, part.face_uvs):
            try:
                bf = bm.faces.new([bverts[i] for i in f])
            except ValueError:
                continue
            bf.smooth = part.smooth
            for loop, uv in zip(bf.loops, uvs):
                loop[uvl].uv = uv
        ranges.append((base, len(bm.verts)))
    bmesh.ops.triangulate(bm, faces=bm.faces[:], quad_method="BEAUTY", ngon_method="BEAUTY")
    bm.verts.index_update()
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(material)
    if mesh.validate(clean_customdata=False):
        print("WARNING: LOD0 mesh needed validation fixes")
    obj = bpy.data.objects.new(kit.name + "_LOD0", mesh)
    bpy.context.scene.collection.objects.link(obj)
    skin_mesh(obj, kit.parts, ranges, joints)
    obj.parent = rig
    mod = obj.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    return obj


def make_material(name: str, image_path: str):
    img = bpy.data.images.load(image_path)
    img.pack()
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.78
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.3
    return mat


def make_lod(lod0, rig, target_tris: int):
    lod1 = lod0.copy()
    lod1.data = lod0.data.copy()
    lod1.name = lod0.name.replace("_LOD0", "_LOD1")
    lod1.data.name = lod1.name
    bpy.context.scene.collection.objects.link(lod1)
    for m in list(lod1.modifiers):
        lod1.modifiers.remove(m)
    tris0 = len(lod0.data.polygons)
    dec = lod1.modifiers.new("Decimate", "DECIMATE")
    dec.decimate_type = "COLLAPSE"
    dec.ratio = target_tris / tris0
    dec.use_symmetry = True
    dec.symmetry_axis = "X"
    bpy.context.view_layer.objects.active = lod1
    for o in bpy.context.view_layer.objects:
        o.select_set(o == lod1)
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bm = bmesh.new()
    bm.from_mesh(lod1.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges[:])
    bm.to_mesh(lod1.data)
    bm.free()
    lod1.data.validate(clean_customdata=False)
    bmd = bmesh.new()
    bmd.from_mesh(lod1.data)
    bmesh.ops.triangulate(bmd, faces=bmd.faces[:])
    bmd.to_mesh(lod1.data)
    bmd.free()
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=3)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    mod = lod1.modifiers.new("Armature", "ARMATURE")
    mod.object = rig
    lod1.parent = rig
    return lod1


def _bone_rest_quat(rig, bone):
    return rig.data.bones[bone].matrix_local.to_quaternion()


def pose_to_local(rig, bone: str, rot_deg) -> Quaternion:
    rx, ry, rz = rot_deg
    if bone.endswith(".R"):
        ry, rz = -ry, -rz
    qw = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_quaternion()
    R = _bone_rest_quat(rig, bone)
    return R.inverted() @ qw @ R


def make_action(rig, clip: str, keys: list, loop: bool, extra: dict | None = None):
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    act["loop"] = bool(loop)
    for k, v in (extra or {}).items():
        act[k] = v
    rig.animation_data_create()
    rig.animation_data.action = act
    pR = _bone_rest_quat(rig, "pelvis")
    last_q = {}
    for frame, pose in keys:
        for b in BONE_NAMES:
            pb = rig.pose.bones[b]
            pb.rotation_mode = "QUATERNION"
            q = pose_to_local(rig, b, pose.get(b, (0, 0, 0)))
            if b in last_q and last_q[b].dot(q) < 0:
                q.negate()
            last_q[b] = q.copy()
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
            if b == "pelvis":
                off = V(pose.get("loc", (0, 0, 0)))
                pb.location = pR.inverted() @ off
                pb.keyframe_insert("location", frame=frame, group=b)
            elif b == "root":
                pb.location = (0, 0, 0)
                pb.keyframe_insert("location", frame=frame, group=b)
    act.frame_range = (keys[0][0], keys[-1][0])
    tr = rig.animation_data.nla_tracks.new()
    tr.name = clip
    strip = tr.strips.new(clip, int(keys[0][0]), act)
    tr.mute = True
    rig.animation_data.action = None
    return act


def set_rest(rig):
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.location = (0, 0, 0)


def export_glb(path: str, objs: list):
    for o in bpy.context.view_layer.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_skins=True,
        export_def_bones=False,
        export_animations=True,
        export_animation_mode="ACTIONS",
        export_force_sampling=True,
        export_frame_step=1,
        export_optimize_animation_size=False,
        export_anim_single_armature=True,
        export_reset_pose_bones=True,
        export_all_influences=False,
        export_morph=False,
        export_extras=False,
    )


def mesh_report(obj) -> dict:
    me = obj.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    max_inf = 0
    unweighted = 0
    for v in me.vertices:
        n = sum(1 for g in v.groups if g.weight > 1e-4)
        max_inf = max(max_inf, n)
        if n == 0:
            unweighted += 1
    return {
        "object": obj.name,
        "triangles": tris,
        "vertices_blender": len(me.vertices),
        "materials": len([m for m in me.materials if m]),
        "max_influences": max_inf,
        "unweighted_vertices": unweighted,
        "bbox_m": [round(x, 3) for x in (
            max(v.co.x for v in me.vertices) - min(v.co.x for v in me.vertices),
            max(v.co.y for v in me.vertices) - min(v.co.y for v in me.vertices),
            max(v.co.z for v in me.vertices) - min(v.co.z for v in me.vertices))],
    }


def write_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
