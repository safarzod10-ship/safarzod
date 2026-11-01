"""Geometry helpers for procedural DUSHANBE props (run inside Blender 4.5).

All coordinates passed to the helpers are GAME coordinates (Godot): metres, +Y up,
the prop "front" faces +Z.  Internally vertices are stored in Blender space
(x, -z, y) so that the glTF exporter (+Y up) gives back exactly the game coordinates.

UVs: faces built without explicit UVs get a world-space box projection in metres
(1 UV unit = 1 m).  Materials scale it via uv1_scale to the real texture tile size.
"""
import math
import bmesh
import bpy
from mathutils import Matrix, Vector


def G2B(p):
    return Vector((p[0], -p[2], p[1]))


def B2G(v):
    return Vector((v.x, v.z, -v.y))


def tr(pos=(0, 0, 0), rot=(0, 0, 0), scale=None):
    """Game-space transform. rot = (pitch X, yaw Y, roll Z) in degrees, applied Z, X, then Y."""
    rx, ry, rz = (math.radians(a) for a in rot)
    m = Matrix.Translation(Vector(pos)) @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(rz, 4, 'Z')
    if scale is not None:
        s = scale if isinstance(scale, (tuple, list)) else (scale, scale, scale)
        m = m @ Matrix.Diagonal((s[0], s[1], s[2], 1.0))
    return m


I4 = Matrix.Identity(4)


def perp_basis(d):
    d = d.normalized()
    a = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(a).normalized()
    v = d.cross(u).normalized()
    return u, v


def round_path(pts, radius, steps=4):
    """Fillet the interior corners of a polyline (game coords)."""
    pts = [Vector(p) for p in pts]
    if len(pts) < 3 or radius <= 0:
        return pts
    out = [pts[0]]
    for i in range(1, len(pts) - 1):
        a, b, c = pts[i - 1], pts[i], pts[i + 1]
        d1 = (a - b)
        d2 = (c - b)
        l1, l2 = d1.length, d2.length
        r = min(radius, l1 * 0.49, l2 * 0.49)
        p1 = b + d1.normalized() * r
        p2 = b + d2.normalized() * r
        for k in range(steps + 1):
            t = k / steps
            q = (1 - t) ** 2 * p1 + 2 * (1 - t) * t * b + t * t * p2
            out.append(q)
    out.append(pts[-1])
    return out


def arc_pts(center, radius, a0, a1, steps, plane="xy"):
    c = Vector(center)
    out = []
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        if plane == "xy":
            out.append(c + Vector((math.cos(a) * radius, math.sin(a) * radius, 0)))
        elif plane == "zy":
            out.append(c + Vector((0, math.sin(a) * radius, math.cos(a) * radius)))
        else:  # xz
            out.append(c + Vector((math.cos(a) * radius, 0, math.sin(a) * radius)))
    return out


class Prop:
    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.exp = self.bm.faces.layers.int.new("exp")      # 1 = explicit UVs
        self.swap = self.bm.faces.layers.int.new("swap")    # 1 = swap u/v in auto projection
        self.uoff = self.bm.faces.layers.float.new("uoff")
        self.mats = []
        self.markers = []

    # ------------------------------------------------------------- basics
    def m(self, name):
        if name not in self.mats:
            self.mats.append(name)
        return self.mats.index(name)

    def v(self, p, T=None):
        p = Vector(p)
        if T is not None:
            p = T @ p
        return self.bm.verts.new(G2B(p))

    def face(self, verts, mat, smooth=False, uvs=None, swap=False, uoff=0.0):
        f = self.bm.faces.new(verts)
        f.material_index = self.m(mat)
        f.smooth = smooth
        if uvs is not None:
            for l, uv in zip(f.loops, uvs):
                l[self.uv].uv = uv
            f[self.exp] = 1
        f[self.swap] = 1 if swap else 0
        f[self.uoff] = uoff
        return f

    def marker(self, name, pos):
        self.markers.append((name, tuple(pos)))

    # ------------------------------------------------------------- primitives
    def box(self, c, s, mat, T=None, bevel=0.0, skip=(), swap=False, uoff=0.0, mats=None):
        """Axis-aligned (in local space) box. c = centre, s = size. skip: subset of
        {'top','bottom','left','right','front','back'}. mats: per-side material override dict."""
        c = Vector(c)
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        P = [c + Vector((sx * hx, sy * hy, sz * hz)) for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
        vs = [self.v(p, T) for p in P]
        idx = lambda sx, sy, sz: ((sx > 0) * 4 + (sy > 0) * 2 + (sz > 0))
        sides = {
            "right": [idx(1, -1, -1), idx(1, 1, -1), idx(1, 1, 1), idx(1, -1, 1)],
            "left": [idx(-1, -1, 1), idx(-1, 1, 1), idx(-1, 1, -1), idx(-1, -1, -1)],
            "top": [idx(-1, 1, -1), idx(-1, 1, 1), idx(1, 1, 1), idx(1, 1, -1)],
            "bottom": [idx(-1, -1, 1), idx(-1, -1, -1), idx(1, -1, -1), idx(1, -1, 1)],
            "front": [idx(-1, -1, 1), idx(1, -1, 1), idx(1, 1, 1), idx(-1, 1, 1)],
            "back": [idx(1, -1, -1), idx(-1, -1, -1), idx(-1, 1, -1), idx(1, 1, -1)],
        }
        faces = []
        for k, q in sides.items():
            if k in skip:
                continue
            # winding: ensure outward normal in game space -> blender handedness flips, so reverse
            mm = (mats or {}).get(k, mat)
            faces.append(self.face([vs[i] for i in q], mm, swap=swap, uoff=uoff))
        if bevel > 0 and faces:
            edges = list({e for f in faces for e in f.edges if len(e.link_faces) == 2 and all(lf in faces for lf in e.link_faces)})
            bmesh.ops.bevel(self.bm, geom=edges, offset=bevel, offset_type='OFFSET', segments=1, profile=0.5, affect='EDGES', clamp_overlap=True)
        return faces

    def beam(self, p0, p1, w, h, mat, up=(0, 1, 0), bevel=0.0, swap=None, uoff=0.0, skip_ends=False):
        """Box from p0 to p1 with cross-section w (side) x h (along 'up' projected)."""
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        L = d.length
        x = d.normalized()
        upv = Vector(up)
        if abs(x.dot(upv.normalized())) > 0.99:
            upv = Vector((0, 0, 1)) if abs(x.z) < 0.9 else Vector((1, 0, 0))
        z = x.cross(upv).normalized()
        y = z.cross(x).normalized()
        M = Matrix((
            (x.x, y.x, z.x, 0), (x.y, y.y, z.y, 0), (x.z, y.z, z.z, 0), (0, 0, 0, 1)))
        T = Matrix.Translation((p0 + p1) / 2) @ M
        # long axis local X; auto-UV grain along longest world axis is handled by projection
        return self.box((0, 0, 0), (L, h, w), mat, T=T, bevel=bevel, skip=("left", "right") if skip_ends else (),
                        swap=bool(swap), uoff=uoff)

    def cyl(self, p0, p1, r, mat, seg=12, r1=None, caps=(True, True), smooth=True, T=None, ang0=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        if T is not None:
            p0, p1 = T @ p0, T @ p1
        r1 = r if r1 is None else r1
        d = p1 - p0
        L = d.length
        u, v = perp_basis(d)
        ring0, ring1 = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg + ang0
            o = u * math.cos(a) + v * math.sin(a)
            ring0.append(self.v(p0 + o * r))
            ring1.append(self.v(p1 + o * r1))
        C = 2 * math.pi * max(r, r1)
        faces = []
        for i in range(seg):
            j = (i + 1) % seg
            u0, u1 = i / seg * C, (i + 1) / seg * C
            faces.append(self.face([ring0[i], ring0[j], ring1[j], ring1[i]], mat, smooth=smooth,
                                   uvs=[(u0, 0), (u1, 0), (u1, L), (u0, L)]))
        if caps[0] and r > 1e-5:
            faces.append(self.face(list(reversed(ring0)), mat))
        if caps[1] and r1 > 1e-5:
            faces.append(self.face(ring1, mat))
        return faces

    def tube(self, pts, r, mat, seg=8, closed=False, caps=True, smooth=True, T=None):
        pts = [Vector(p) for p in pts]
        if T is not None:
            pts = [T @ p for p in pts]
        n = len(pts)
        tang = []
        for i in range(n):
            if closed:
                a, b = pts[i - 1], pts[(i + 1) % n]
                t = (pts[(i + 1) % n] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            elif i == 0:
                t = pts[1] - pts[0]
            elif i == n - 1:
                t = pts[-1] - pts[-2]
            else:
                t = (pts[i + 1] - pts[i]).normalized() + (pts[i] - pts[i - 1]).normalized()
            tang.append(t.normalized())
        u, _ = perp_basis(tang[0])
        rings = []
        lengths = [0.0]
        for i in range(n):
            t = tang[i]
            u = (u - t * u.dot(t)).normalized()
            v = t.cross(u)
            # miter scale
            sc = 1.0
            if 0 < i < n - 1 or closed:
                seg_dir = (pts[(i + 1) % n] - pts[i]).normalized()
                c = max(0.3, abs(seg_dir.dot(t)))
                sc = 1.0 / c
            ring = []
            for k in range(seg):
                a = 2 * math.pi * k / seg
                ring.append(self.v(pts[i] + (u * math.cos(a) + v * math.sin(a)) * r * min(sc, 1.6)))
            rings.append(ring)
            if i > 0:
                lengths.append(lengths[-1] + (pts[i] - pts[i - 1]).length)
        C = 2 * math.pi * r
        faces = []
        npair = n if closed else n - 1
        for i in range(npair):
            j = (i + 1) % n
            l0 = lengths[i]
            l1 = lengths[j] if j > i else lengths[i] + (pts[0] - pts[-1]).length
            for k in range(seg):
                kk = (k + 1) % seg
                u0, u1 = k / seg * C, (k + 1) / seg * C
                faces.append(self.face([rings[i][k], rings[i][kk], rings[j][kk], rings[j][k]], mat, smooth=smooth,
                                       uvs=[(u0, l0), (u1, l0), (u1, l1), (u0, l1)]))
        if caps and not closed:
            faces.append(self.face(list(reversed(rings[0])), mat))
            faces.append(self.face(rings[-1], mat))
        return faces

    def lathe(self, prof, mat, seg=16, T=None, smooth=True, a0=0.0, a1=360.0, mats=None):
        """Revolve profile [(r, y), ...] (bottom to top) around local Y axis.
        Segments where both radii are 0 are skipped; r=0 points become poles."""
        full = abs(a1 - a0) >= 359.9
        nseg = seg
        cols = nseg if full else nseg + 1
        rings = []
        for (r, y) in prof:
            if r < 1e-6:
                rings.append([self.v((0, y, 0), T)])
            else:
                ring = []
                for i in range(cols):
                    a = math.radians(a0 + (a1 - a0) * i / nseg)
                    ring.append(self.v((math.cos(a) * r, y, -math.sin(a) * r), T))
                rings.append(ring)
        rmax = max(p[0] for p in prof)
        C = math.radians(a1 - a0) * rmax
        vacc = [0.0]
        for i in range(1, len(prof)):
            vacc.append(vacc[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
        faces = []
        for i in range(len(prof) - 1):
            A, B = rings[i], rings[i + 1]
            mm = mats[i] if mats else mat
            sm = smooth if not isinstance(smooth, (list, tuple)) else smooth[i]
            for k in range(nseg):
                k1 = (k + 1) % cols if full else k + 1
                u0, u1 = k / nseg * C, (k + 1) / nseg * C
                v0, v1 = vacc[i], vacc[i + 1]
                if len(A) == 1 and len(B) == 1:
                    continue
                if len(A) == 1:
                    faces.append(self.face([A[0], B[k1], B[k]], mm, smooth=sm, uvs=[((u0 + u1) / 2, v0), (u1, v1), (u0, v1)]))
                elif len(B) == 1:
                    faces.append(self.face([A[k], A[k1], B[0]], mm, smooth=sm, uvs=[(u0, v0), (u1, v0), ((u0 + u1) / 2, v1)]))
                else:
                    faces.append(self.face([A[k], A[k1], B[k1], B[k]], mm, smooth=sm, uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)]))
        return faces

    def disc(self, c, r, mat, seg=16, T=None, axis="y", uvfn=None, flip=False):
        """Flat disc facing +axis (local). uvfn(lx, ly) -> uv using local in-plane coords."""
        vs, uvs = [], []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ca, sa = math.cos(a) * r, math.sin(a) * r
            if axis == "y":
                p = (c[0] + ca, c[1], c[2] - sa)
                lx, ly = ca, sa
            elif axis == "z":
                p = (c[0] + ca, c[1] + sa, c[2])
                lx, ly = ca, sa
            else:  # x
                p = (c[0], c[1] + sa, c[2] - ca)
                lx, ly = ca, sa
            vs.append(self.v(p, T))
            uvs.append(uvfn(lx, ly) if uvfn else None)
        if flip:
            vs.reverse()
            uvs.reverse()
        return self.face(vs, mat, uvs=uvs if uvfn else None)

    def poly_extrude(self, poly, depth, mat, T=None, front_mat=None, front_uv=None, back_mat=None, side_mat=None, z0=None):
        """Polygon [(x, y)] (CCW seen from +Z) in local XY, extruded from z0 to z0+depth (default centred)."""
        z0 = -depth / 2 if z0 is None else z0
        F = [self.v((x, y, z0 + depth), T) for x, y in poly]
        Bk = [self.v((x, y, z0), T) for x, y in poly]
        faces = []
        uvs = [front_uv(x, y) for x, y in poly] if front_uv else None
        faces.append(self.face(F, front_mat or mat, uvs=uvs))
        faces.append(self.face(list(reversed(Bk)), back_mat or mat))
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            faces.append(self.face([Bk[i], F[i], F[j], Bk[j]][::-1], side_mat or mat))
        return faces

    def quad(self, pts, mat, uvs=None, smooth=False, double=False):
        vs = [self.v(p) for p in pts]
        f = self.face(vs, mat, uvs=uvs, smooth=smooth)
        if double:
            vs2 = [self.v(p) for p in pts]
            self.face(list(reversed(vs2)), mat, uvs=list(reversed(uvs)) if uvs else None, smooth=smooth)
        return f

    def tri_strip_surface(self, grid, mat, uvs=None, smooth=True):
        """grid: rows of points (game coords) -> quads. uvs same shape (optional)."""
        R = [[self.v(p) for p in row] for row in grid]
        for i in range(len(R) - 1):
            for k in range(len(R[i]) - 1):
                q = [R[i][k], R[i][k + 1], R[i + 1][k + 1], R[i + 1][k]]
                uv = None
                if uvs:
                    uv = [uvs[i][k], uvs[i][k + 1], uvs[i + 1][k + 1], uvs[i + 1][k]]
                self.face(q, mat, uvs=uv, smooth=smooth)

    # ------------------------------------------------------------- finalisation
    def auto_uv(self):
        bm = self.bm
        bm.normal_update()
        for f in bm.faces:
            if f[self.exp]:
                continue
            n = B2G(f.normal)
            ax, ay, az = abs(n.x), abs(n.y), abs(n.z)
            uo = f[self.uoff]
            for l in f.loops:
                p = B2G(l.vert.co)
                if ay >= ax and ay >= az:
                    uv = (p.x, -p.z if n.y > 0 else p.z)
                elif ax >= az:
                    uv = (-p.z if n.x > 0 else p.z, p.y)
                else:
                    uv = (p.x if n.z > 0 else -p.x, p.y)
                if f[self.swap]:
                    uv = (uv[1], uv[0])
                l[self.uv].uv = (uv[0] + uo, uv[1])

    def stats(self):
        tris = sum(len(f.verts) - 2 for f in self.bm.faces)
        pts = [B2G(v.co) for v in self.bm.verts]
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        return tris, mn, mx

    def to_object(self, collection=None):
        loose = [v for v in self.bm.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(self.bm, geom=loose, context='VERTS')
        self.auto_uv()
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me)
        for mname in self.mats:
            me.materials.append(get_material(mname))
        ob = bpy.data.objects.new(self.name, me)
        (collection or bpy.context.scene.collection).objects.link(ob)
        empties = []
        for name, pos in self.markers:
            e = bpy.data.objects.new(name, None)
            e.empty_display_type = 'SPHERE'
            e.empty_display_size = 0.1
            e.location = G2B(pos)
            (collection or bpy.context.scene.collection).objects.link(e)
            e.parent = ob
            empties.append(e)
        return ob, empties


PREVIEW = {}


def get_material(name):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        col = PREVIEW.get(name, (0.6, 0.6, 0.6))
        m.diffuse_color = (*col, 1)
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*col, 1)
    return m


def export_glb(ob, empties, path):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    for e in empties:
        e.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_image_format='NONE', export_yup=True, export_apply=True,
                              export_extras=False, export_animations=False, export_skins=False,
                              export_morph=False, export_lights=False, export_cameras=False)
