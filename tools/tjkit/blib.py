"""Blender-side helpers: explicit mesh builder with atlas UVs, PBR material, GLB export."""
import bpy, bmesh, math, os, json
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KIT = os.path.join(ROOT, 'kit')
TEXOUT = os.path.join(ROOT, 'work', 'texout')

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

class Atlas:
    """Pixel-space island lookup. islands: name -> (x0, y0, w, h, px_m) with top-left origin."""
    def __init__(self, size, islands):
        self.S = size; self.isl = islands
    def uv(self, name, xm, ym):
        x0, y0, w, h, px = self.isl[name]
        col = x0 + xm / px; row = y0 + h - ym / px
        return (col / self.S, 1.0 - row / self.S)
    def uv_px(self, name, cx, cy_from_bottom):
        x0, y0, w, h, px = self.isl[name]
        return ((x0 + cx) / self.S, 1.0 - (y0 + h - cy_from_bottom) / self.S)

class MB:
    def __init__(self):
        self.v = []; self.f = []; self.uv = []; self.sm = []; self.mat = []
    def face(self, pts, uvs, smooth=False, mat=0):
        base = len(self.v)
        self.v.extend([tuple(p) for p in pts])
        self.f.append(list(range(base, base + len(pts))))
        self.uv.append([tuple(u) for u in uvs]); self.sm.append(smooth); self.mat.append(mat)
    def grid(self, P, U, smooth=True, closed=False, mat=0, flip=False):
        """P[i][j] points (i along u ring, j along v). U same shape uvs. If closed, U must have
        an extra column i=n duplicating i=0 (seam) and P n entries."""
        ni = len(P); nj = len(P[0])
        base = len(self.v)
        for i in range(ni):
            for j in range(nj):
                self.v.append(tuple(P[i][j]))
        idx = lambda i, j: base + (i % ni) * nj + j
        rng = ni if closed else ni - 1
        for i in range(rng):
            for j in range(nj - 1):
                q = [idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)]
                uq = [U[i][j], U[i + 1][j], U[i + 1][j + 1], U[i][j + 1]]
                if flip:
                    q = q[::-1]; uq = uq[::-1]
                self.f.append(q); self.uv.append(uq); self.sm.append(smooth); self.mat.append(mat)
    def merge(self, other, M=None):
        base = len(self.v)
        for p in other.v:
            self.v.append(tuple(M @ Vector(p)) if M is not None else p)
        for f, u, s, m in zip(other.f, other.uv, other.sm, other.mat):
            self.f.append([i + base for i in f]); self.uv.append(u); self.sm.append(s); self.mat.append(m)
    def tris(self):
        return sum(len(f) - 2 for f in self.f)
    def to_object(self, name, mats, parent=None, loc=(0, 0, 0)):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        uvl = me.uv_layers.new(name='UVMap')
        li = 0
        for poly, uvs in zip(me.polygons, self.uv):
            for k, l in enumerate(poly.loop_indices):
                uvl.data[l].uv = uvs[k]
        for poly, s, m in zip(me.polygons, self.sm, self.mat):
            poly.use_smooth = s; poly.material_index = m
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = loc
        if parent is not None:
            ob.parent = parent
        return ob

def box_faces(mb, x0, y0, z0, x1, y1, z1, uvfun, skip=()):
    """Axis aligned box; uvfun(face_key, pts) -> uvs. Keys: -y +y -x +x -z +z."""
    P = {
        '-y': [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
        '+y': [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
        '-x': [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
        '+x': [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
        '-z': [(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)],
        '+z': [(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)],
    }
    for k, pts in P.items():
        if k in skip:
            continue
        mb.face(pts, uvfun(k, pts))

def plain_fit(atlas, island, pts, seed=0, along=None, px_m=None):
    """Map a planar face into a plain-grain island: grain (island v axis) follows the face's
    longest edge (or `along` vector); true scale across, fit/true scale along."""
    import random
    rnd = random.Random(seed)
    x0, y0, w, h, px = atlas.isl[island]
    px = px_m or px
    P = [Vector(p) for p in pts]
    if along is None:
        best = None
        for i in range(len(P)):
            e = P[(i + 1) % len(P)] - P[i]
            if best is None or e.length > best.length:
                best = e
        along = best
    a = Vector(along).normalized()
    nrm = (P[1] - P[0]).cross(P[2] - P[0])
    if nrm.length < 1e-9:
        nrm = Vector((0, 0, 1))
    nrm.normalize()
    b = nrm.cross(a).normalized()
    us = [(p - P[0]).dot(b) for p in P]; vs = [(p - P[0]).dot(a) for p in P]
    umin, vmin = min(us), min(vs); ul = max(us) - umin; vl = max(vs) - vmin
    sv = 1.0
    if vl / px > h - 2:
        sv = (h - 2) * px / vl
    su = 1.0
    if ul / px > w - 2:
        su = (w - 2) * px / ul
    ou = rnd.uniform(1, max(1, w - 1 - ul * su / px)); ov = rnd.uniform(1, max(1, h - 1 - vl * sv / px))
    out = []
    for u, v in zip(us, vs):
        cx = ou + (u - umin) * su / px; cy = ov + (v - vmin) * sv / px
        out.append(atlas.uv_px(island, cx, cy))
    return out

def gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g:
        return g
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g

def load_img(path, noncolor):
    im = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        im.colorspace_settings.name = 'Non-Color'
    return im

def pbr_material(name, base, orm, nrm, alpha_clip=False, emission=None, double_sided=False):
    m = bpy.data.materials.new(name)
    m.use_backface_culling = not double_sided
    m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    bsdf = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    tb = nt.nodes.new('ShaderNodeTexImage'); tb.image = load_img(base, False)
    nt.links.new(tb.outputs['Color'], bsdf.inputs['Base Color'])
    if alpha_clip:
        nt.links.new(tb.outputs['Alpha'], bsdf.inputs['Alpha'])
        m.blend_method = 'CLIP' if hasattr(m, 'blend_method') else None
        try:
            m.surface_render_method = 'DITHERED'
        except Exception:
            pass
    to = nt.nodes.new('ShaderNodeTexImage'); to.image = load_img(orm, True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(to.outputs['Color'], sep.inputs[0])
    nt.links.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    grp = nt.nodes.new('ShaderNodeGroup'); grp.node_tree = gltf_output_group()
    nt.links.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    tn = nt.nodes.new('ShaderNodeTexImage'); tn.image = load_img(nrm, True)
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m

def export_glb(path, objects=None):
    bpy.ops.object.select_all(action='DESELECT')
    for o in (objects or bpy.context.scene.objects):
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=True, export_image_format='AUTO',
                              export_texcoords=True, export_normals=True, export_materials='EXPORT',
                              export_extras=False, export_animations=False)

def tri_count(objs):
    n = 0
    for o in objs:
        if o.type == 'MESH':
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n

def lathe(profile, n, z_off=0.0, u_island=None, atlas=None, u_range=(0, 1), mirror_u=1, smooth=True, mat=0, phase=0.0):
    """Revolve profile [(r, z), ...] around Z. UV: u = angle fraction mapped across the island
    width `mirror_u` times (mirrored repeats), v = cumulative profile arc length (metres)."""
    mb = MB()
    import math as _m
    s = [0.0]
    for k in range(1, len(profile)):
        s.append(s[-1] + _m.hypot(profile[k][0] - profile[k - 1][0], profile[k][1] - profile[k - 1][1]))
    P = []; U = []
    for i in range(n + 1):
        a = 2 * _m.pi * i / n + phase
        ca, sa = _m.cos(a), _m.sin(a)
        if i < n:
            P.append([(r * ca, r * sa, z + z_off) for r, z in profile])
        f = (i / n) * mirror_u
        fu = f % 2.0
        fu = fu if fu <= 1.0 else 2.0 - fu
        row = []
        x0, y0, w, h, px = atlas.isl[u_island]
        for k in range(len(profile)):
            cx = u_range[0] * w + fu * (u_range[1] - u_range[0]) * w
            cy = s[k] / px
            row.append(atlas.uv_px(u_island, cx, cy))
        U.append(row)
    mb.grid(P, U, smooth=smooth, closed=True, mat=mat)
    return mb, s[-1]
