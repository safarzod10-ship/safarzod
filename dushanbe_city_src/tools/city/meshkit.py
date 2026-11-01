"""Minimal mesh-building kit + GLB writer for the DUSHANBE city generator.

Geometry is accumulated per *material name* (one glTF primitive per material).
Vertex colour RGB = tint * baked ambient occlusion (used as albedo multiplier in Godot).
UVs are in metres (world scale); Godot materials set uv1_scale for texel density.
Coordinates: metres, +X east, +Y up, -Z north (Godot convention).
"""
import json, math, struct
import numpy as np


class Mesh:
    """Geometry for one material."""
    __slots__ = ("pos", "nrm", "uv", "col", "idx")

    def __init__(self):
        self.pos, self.nrm, self.uv, self.col, self.idx = [], [], [], [], []

    def ntris(self):
        return len(self.idx) // 3


class Builder:
    """Collects geometry by material. Optional transform (yaw + offset) for building-local coords."""

    def __init__(self):
        self.meshes = {}
        self.set_transform(0.0, 0.0, 0.0, 0.0)
        self.tint = (1.0, 1.0, 1.0)
        self.ao_ground = True

    # ---- transform -------------------------------------------------------------------------
    def set_transform(self, ox, oy, oz, yaw):
        self.ox, self.oy, self.oz = ox, oy, oz
        self.c, self.s = math.cos(yaw), math.sin(yaw)

    def _xf(self, p):
        x, y, z = p
        return (self.ox + x * self.c + z * self.s, self.oy + y, self.oz - x * self.s + z * self.c)

    def _xn(self, n):
        x, y, z = n
        return (x * self.c + z * self.s, y, -x * self.s + z * self.c)

    def mesh(self, mat):
        m = self.meshes.get(mat)
        if m is None:
            m = self.meshes[mat] = Mesh()
        return m

    # ---- primitives --------------------------------------------------------------------------
    def quad(self, mat, p0, p1, p2, p3, uv=None, ao=1.0, tint=None, uvmode="auto"):
        """Quad p0..p3 counter-clockwise when seen from the front (normal side)."""
        m = self.mesh(mat)
        P = [self._xf(p) for p in (p0, p1, p2, p3)]
        a = np.subtract(P[2], P[0]); b = np.subtract(P[3], P[1])
        n = np.cross(a, b)
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            return
        n = n / ln
        if uv is None:
            uv = self._auto_uv(P, n)
        t = tint or self.tint
        base = len(m.pos)
        for i in range(4):
            m.pos.append(P[i]); m.nrm.append(tuple(n)); m.uv.append(uv[i])
            y = P[i][1]
            g = 1.0
            if self.ao_ground and y < 1.2:
                g = 0.72 + 0.28 * max(y, 0.0) / 1.2
            k = ao * g
            m.col.append((t[0] * k, t[1] * k, t[2] * k))
        m.idx += [base, base + 1, base + 2, base, base + 2, base + 3]

    @staticmethod
    def _auto_uv(P, n):
        ax = np.argmax(np.abs(n))
        out = []
        for p in P:
            if ax == 1:      # horizontal surface: x,z
                out.append((p[0], p[2]))
            elif ax == 0:    # facing x: z,y
                out.append((p[2] * (1 if n[0] < 0 else -1), -p[1]))
            else:            # facing z: x,y
                out.append((p[0] * (1 if n[2] > 0 else -1), -p[1]))
        return out

    def box(self, mat, x0, y0, z0, x1, y1, z1, ao=1.0, tint=None, faces="xXyYzZ", ao_bottom=None):
        """Axis-aligned (in local frame) box. faces: subset of x X y Y z Z (min/max faces)."""
        if "Y" in faces:
            self.quad(mat, (x0, y1, z1), (x1, y1, z1), (x1, y1, z0), (x0, y1, z0), ao=ao, tint=tint)
        if "y" in faces:
            self.quad(mat, (x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1), ao=ao_bottom or ao * 0.8, tint=tint)
        if "Z" in faces:
            self.quad(mat, (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1), ao=ao, tint=tint)
        if "z" in faces:
            self.quad(mat, (x1, y0, z0), (x0, y0, z0), (x0, y1, z0), (x1, y1, z0), ao=ao, tint=tint)
        if "X" in faces:
            self.quad(mat, (x1, y0, z1), (x1, y0, z0), (x1, y1, z0), (x1, y1, z1), ao=ao, tint=tint)
        if "x" in faces:
            self.quad(mat, (x0, y0, z0), (x0, y0, z1), (x0, y1, z1), (x0, y1, z0), ao=ao, tint=tint)

    def cylinder(self, mat, x, z, y0, y1, r, seg=8, ao=1.0, tint=None, cap=True, r1=None):
        """Vertical cylinder/cone in local frame."""
        r1 = r if r1 is None else r1
        for i in range(seg):
            a0 = 2 * math.pi * i / seg; a1 = 2 * math.pi * (i + 1) / seg
            c0, s0, c1, s1 = math.cos(a0), math.sin(a0), math.cos(a1), math.sin(a1)
            u0, u1 = i / seg * 2 * math.pi * r, (i + 1) / seg * 2 * math.pi * r
            self.quad(mat, (x + c1 * r, y0, z + s1 * r), (x + c0 * r, y0, z + s0 * r),
                      (x + c0 * r1, y1, z + s0 * r1), (x + c1 * r1, y1, z + s1 * r1),
                      uv=[(u1, -y0), (u0, -y0), (u0, -y1), (u1, -y1)], ao=ao, tint=tint)
            if cap:
                self.tri(mat, (x, y1, z), (x + c1 * r1, y1, z + s1 * r1), (x + c0 * r1, y1, z + s0 * r1), ao=ao, tint=tint)

    def htube(self, mat, p0, p1, r, seg=6, ao=1.0, tint=None):
        """Tube between two local points (any direction)."""
        p0 = np.array(p0, float); p1 = np.array(p1, float)
        d = p1 - p0; L = np.linalg.norm(d)
        if L < 1e-6:
            return
        d /= L
        up = np.array([0, 1, 0]) if abs(d[1]) < 0.9 else np.array([1, 0, 0])
        u = np.cross(d, up); u /= np.linalg.norm(u); v = np.cross(u, d)
        for i in range(seg):
            a0 = 2 * math.pi * i / seg; a1 = 2 * math.pi * (i + 1) / seg
            o0 = (u * math.cos(a0) + v * math.sin(a0)) * r
            o1 = (u * math.cos(a1) + v * math.sin(a1)) * r
            q = [tuple(p0 + o0), tuple(p0 + o1), tuple(p1 + o1), tuple(p1 + o0)]
            if np.dot(np.cross(o1 - o0, d), o0 + o1) < 0:
                q = q[::-1]
            self.quad(mat, *q, uv=[(0, 0), (r, 0), (r, L), (0, L)], ao=ao, tint=tint)

    def tri(self, mat, p0, p1, p2, ao=1.0, tint=None, uv=None):
        m = self.mesh(mat)
        P = [self._xf(p) for p in (p0, p1, p2)]
        n = np.cross(np.subtract(P[1], P[0]), np.subtract(P[2], P[0]))
        ln = np.linalg.norm(n)
        if ln < 1e-12:
            return
        n = n / ln
        if uv is None:
            uv = self._auto_uv(P, n)
        t = tint or self.tint
        base = len(m.pos)
        for i in range(3):
            m.pos.append(P[i]); m.nrm.append(tuple(n)); m.uv.append(uv[i])
            m.col.append((t[0] * ao, t[1] * ao, t[2] * ao))
        m.idx += [base, base + 1, base + 2]

    def stats(self):
        return {k: v.ntris() for k, v in self.meshes.items()}


# ---- facade wall with rectangular holes ------------------------------------------------------
def wall_with_holes(b, mat, x0, x1, y0, y1, z, holes, ao=1.0, tint=None, normal=+1):
    """Wall in local plane z=const spanning [x0,x1]x[y0,y1], facing +Z (normal=+1) or -Z.
    holes: list of (hx0, hx1, hy0, hy1). Decomposed into a grid; runs merged per row."""
    xs = sorted(set([x0, x1] + [h[0] for h in holes] + [h[1] for h in holes]))
    ys = sorted(set([y0, y1] + [h[2] for h in holes] + [h[3] for h in holes]))
    xs = [x for x in xs if x0 <= x <= x1]
    ys = [y for y in ys if y0 <= y <= y1]
    for j in range(len(ys) - 1):
        ya, yb = ys[j], ys[j + 1]
        ym = (ya + yb) / 2
        run = None
        for i in range(len(xs) - 1):
            xa, xb = xs[i], xs[i + 1]
            xm = (xa + xb) / 2
            inside = any(h[0] < xm < h[1] and h[2] < ym < h[3] for h in holes)
            if not inside:
                run = (run[0], xb) if run else (xa, xb)
            if inside or i == len(xs) - 2:
                if run:
                    ra, rb = run
                    if normal > 0:
                        b.quad(mat, (ra, ya, z), (rb, ya, z), (rb, yb, z), (ra, yb, z), ao=ao, tint=tint)
                    else:
                        b.quad(mat, (rb, ya, z), (ra, ya, z), (ra, yb, z), (rb, yb, z), ao=ao, tint=tint)
                    run = None


# ---- GLB writer --------------------------------------------------------------------------------
def write_glb(path, nodes, extras=None, origin=(0.0, 0.0, 0.0)):
    """nodes: list of (node_name, {material: Mesh}). Writes one glTF mesh per node."""
    bin_chunks = []
    offset = 0
    buffer_views, accessors, meshes_j, nodes_j, materials_j = [], [], [], [], []
    mat_index = {}

    def add_view(data, target=None):
        nonlocal offset
        pad = (-len(data)) % 4
        data = data + b"\x00" * pad
        bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(data) - pad}
        if target:
            bv["target"] = target
        buffer_views.append(bv)
        bin_chunks.append(data)
        offset += len(data)
        return len(buffer_views) - 1

    def add_acc(arr, ctype, typ, target, minmax=False):
        v = add_view(arr.tobytes(), target)
        a = {"bufferView": v, "componentType": ctype, "count": int(arr.shape[0]), "type": typ}
        if minmax:
            a["min"] = arr.min(axis=0).tolist(); a["max"] = arr.max(axis=0).tolist()
        accessors.append(a)
        return len(accessors) - 1

    for node_name, meshes in nodes:
        prims = []
        for mat, m in sorted(meshes.items()):
            if not m.idx:
                continue
            if mat not in mat_index:
                mat_index[mat] = len(materials_j)
                materials_j.append({"name": mat, "pbrMetallicRoughness": {"baseColorFactor": [0.8, 0.8, 0.8, 1], "metallicFactor": 0, "roughnessFactor": 0.8}})
            pos = (np.asarray(m.pos, np.float64) - np.asarray(origin)).astype(np.float32)
            nrm = np.asarray(m.nrm, np.float32)
            uv = np.asarray(m.uv, np.float32)
            col = np.clip(np.asarray(m.col, np.float32), 0, 1)
            col = np.concatenate([col, np.ones((len(col), 1), np.float32)], 1)
            col8 = (col * 255 + 0.5).astype(np.uint8)
            idx = np.asarray(m.idx, np.uint32)
            attrs = {
                "POSITION": add_acc(pos, 5126, "VEC3", 34962, True),
                "NORMAL": add_acc(nrm, 5126, "VEC3", 34962),
                "TEXCOORD_0": add_acc(uv, 5126, "VEC2", 34962),
            }
            v = add_view(col8.tobytes(), 34962)
            accessors.append({"bufferView": v, "componentType": 5121, "normalized": True, "count": len(col8), "type": "VEC4"})
            attrs["COLOR_0"] = len(accessors) - 1
            ia = add_acc(idx, 5125, "SCALAR", 34963)
            prims.append({"attributes": attrs, "indices": ia, "material": mat_index[mat]})
        if not prims:
            continue
        meshes_j.append({"name": node_name, "primitives": prims})
        nodes_j.append({"name": node_name, "mesh": len(meshes_j) - 1, "translation": [float(v) for v in origin]})
    gl = {
        "asset": {"version": "2.0", "generator": "dushanbe meshkit"},
        "scene": 0, "scenes": [{"nodes": list(range(len(nodes_j)))}],
        "nodes": nodes_j, "meshes": meshes_j, "materials": materials_j,
        "accessors": accessors, "bufferViews": buffer_views,
        "buffers": [{"byteLength": offset}],
    }
    if extras:
        gl["extras"] = extras
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    binb = b"".join(bin_chunks)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binb)))
        f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
        f.write(struct.pack("<II", len(binb), 0x004E4942)); f.write(binb)
