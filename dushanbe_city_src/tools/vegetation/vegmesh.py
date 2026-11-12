"""Mesh building helpers + minimal glTF 2.0 binary (GLB) writer for DUSHANBE vegetation.

Vertex layout written to GLB:
  POSITION, NORMAL, TANGENT, TEXCOORD_0, COLOR_0 (float RGBA)
COLOR_0 semantic (read by foliage/bark/grass shaders):
  r = ambient occlusion (1 = open)
  g = flutter weight (leaf-local motion; 0 for wood; for grass = blade height factor 0 root..1 tip)
  b = branch phase (0..1, per main limb)
  a = branch sway weight (0..1 secondary branch motion)
Materials carry only a name; Godot .tres materials are bound by name.
"""
import json, math, struct
import numpy as np


def normalize(v, axis=-1):
    n = np.linalg.norm(v, axis=axis, keepdims=True)
    return v / np.maximum(n, 1e-9)


def any_perp(d):
    a = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    p = np.cross(d, a)
    return p / np.linalg.norm(p)


class Surface:
    def __init__(self, material):
        self.material = material
        self.P, self.N, self.T, self.UV, self.C = [], [], [], [], []
        self.I = []
        self.nv = 0

    def add(self, P, N, T, UV, C, I):
        P = np.asarray(P, np.float32); n = len(P)
        self.P.append(P)
        self.N.append(np.asarray(N, np.float32).reshape(n, 3))
        self.T.append(np.asarray(T, np.float32).reshape(n, 4))
        self.UV.append(np.asarray(UV, np.float32).reshape(n, 2))
        self.C.append(np.asarray(C, np.float32).reshape(n, 4))
        self.I.append(np.asarray(I, np.int64) + self.nv)
        self.nv += n

    def arrays(self):
        if self.nv == 0:
            return None
        return (np.concatenate(self.P), normalize(np.concatenate(self.N)), np.concatenate(self.T),
                np.concatenate(self.UV), np.clip(np.concatenate(self.C), 0, 1), np.concatenate(self.I).astype(np.uint32))

    @property
    def tris(self):
        return sum(len(i) for i in self.I) // 3


class MeshBuilder:
    def __init__(self):
        self.surfaces = {}

    def surf(self, material):
        if material not in self.surfaces:
            self.surfaces[material] = Surface(material)
        return self.surfaces[material]

    @property
    def tris(self):
        return sum(s.tris for s in self.surfaces.values())

    def tri_report(self):
        return {k: s.tris for k, s in self.surfaces.items()}

    def aabb(self):
        P = np.concatenate([np.concatenate(s.P) for s in self.surfaces.values() if s.nv])
        return P.min(0), P.max(0)

    # ------------------------------------------------------------------ primitives
    def tube(self, material, pts, radii, sides, uv_scale=(1.0, 1.0), colors=None, close_tip=False,
             flare=None, twist=0.0, noise=None):
        """Tapered generalized cylinder along polyline pts (n,3) with radii (n,).
        u around (0..repeats), v along arc length / uv_scale[1]. colors: (n,4) per ring."""
        pts = np.asarray(pts, np.float64)
        n = len(pts)
        if n < 2:
            return
        tang = np.zeros_like(pts)
        tang[1:-1] = pts[2:] - pts[:-2]
        tang[0] = pts[1] - pts[0]
        tang[-1] = pts[-1] - pts[-2]
        tang = normalize(tang)
        # parallel transport frame
        nrm = np.zeros_like(pts)
        nrm[0] = any_perp(tang[0])
        for i in range(1, n):
            v = nrm[i - 1] - tang[i] * np.dot(nrm[i - 1], tang[i])
            if np.linalg.norm(v) < 1e-6:
                v = any_perp(tang[i])
            nrm[i] = v / np.linalg.norm(v)
        bin_ = np.cross(tang, nrm)
        seg = np.linalg.norm(np.diff(pts, axis=0), axis=1)
        arc = np.concatenate([[0], np.cumsum(seg)])
        reps = max(1, int(round(2 * math.pi * radii[0] / uv_scale[0])))
        P, N, T, UV, C = [], [], [], [], []
        for i in range(n):
            for j in range(sides + 1):
                a = 2 * math.pi * j / sides + twist * arc[i]
                d = math.cos(a) * nrm[i] + math.sin(a) * bin_[i]
                r = radii[i]
                if flare is not None:
                    r = r * flare(i, a)
                if noise is not None:
                    r = r * noise(i, a)
                P.append(pts[i] + d * r)
                N.append(d)
                tt = np.cross(tang[i], d)  # around direction
                T.append(np.append(-tt, 1.0))
                UV.append((reps * j / sides, -arc[i] / uv_scale[1]))
                C.append(colors[i] if colors is not None else (1, 0, 0, 0))
        I = []
        w = sides + 1
        for i in range(n - 1):
            for j in range(sides):
                a0 = i * w + j; a1 = a0 + 1; b0 = a0 + w; b1 = b0 + 1
                I += [a0, b0, a1, a1, b0, b1]
        if close_tip:
            c0 = len(P)
            P.append(pts[-1] + tang[-1] * radii[-1] * 0.5); N.append(tang[-1]); T.append(np.append(nrm[-1], 1))
            UV.append((0.5, -arc[-1] / uv_scale[1])); C.append(colors[-1] if colors is not None else (1, 0, 0, 0))
            base = (n - 1) * w
            for j in range(sides):
                I += [base + j, c0, base + j + 1]
        self.surf(material).add(P, N, T, UV, C, I)

    def card(self, material, center, right, up, rect, anchor=(0.5, 0.5), normals=None, colors=None,
             fold=0.0, segs=1):
        """Quad card. `right`,`up` are full-size half-axis vectors (width=2|right|, height=2|up|)?
        No: right/up are full extents. Pivot `center` sits at the sprite anchor.
        rect = [u0,v0,u1,v1]; anchor in sprite-local (0..1, v down).
        fold>0 bends the card along its vertical centre line toward its normal (V shape) -> 4 tris.
        normals: callable(pos)->normal or None (face normal). colors: callable(local_uv)->rgba."""
        right = np.asarray(right, np.float64); up = np.asarray(up, np.float64)
        fn = normalize(np.cross(right, up))
        u0, v0, u1, v1 = rect
        ax, ay = anchor
        cols = [0.0, 0.5, 1.0] if fold > 0 else [0.0, 1.0]
        rows = np.linspace(0.0, 1.0, segs + 1)
        P, UV, L = [], [], []
        for sy in rows:
            for sx in cols:
                lx, ly = sx - ax, (1 - sy) - (1 - ay)
                p = np.asarray(center) + right * lx + up * ly
                if fold > 0 and sx == 0.5:
                    p = p + fn * fold * np.linalg.norm(right)
                P.append(p)
                UV.append((u0 + (u1 - u0) * sx, v0 + (v1 - v0) * sy))
                L.append((sx, sy))
        P = np.array(P)
        N = np.array([normals(p) if normals else fn for p in P])
        T = np.tile(np.append(normalize(right), 1.0), (len(P), 1))
        C = np.array([colors(l) if colors else (1, 0, 0, 0) for l in L])
        w = len(cols)
        I = []
        for r in range(segs):
            for c in range(w - 1):
                a0 = r * w + c; a1 = a0 + 1; b0 = a0 + w; b1 = b0 + 1
                I += [a0, b0, a1, a1, b0, b1]
        self.surf(material).add(P, N, T, UV, C, I)

    def merge(self, other):
        for k, s in other.surfaces.items():
            a = s.arrays()
            if a is None:
                continue
            P, N, T, UV, C, I = a
            self.surf(k).add(P, N, T, UV, C, I)

    # ------------------------------------------------------------------ GLB
    def write_glb(self, path, name="mesh", double_sided=()):
        bin_chunks = []
        offset = 0
        buffer_views, accessors, prims, materials = [], [], [], []

        def add_view(data, target=None):
            nonlocal offset
            b = data.tobytes()
            pad = (4 - len(b) % 4) % 4
            bv = {"buffer": 0, "byteOffset": offset, "byteLength": len(b)}
            if target:
                bv["target"] = target
            bin_chunks.append(b + b"\0" * pad)
            offset += len(b) + pad
            buffer_views.append(bv)
            return len(buffer_views) - 1

        def add_acc(data, typ, ctype=5126, target=34962, minmax=False):
            v = add_view(np.ascontiguousarray(data), target)
            acc = {"bufferView": v, "componentType": ctype, "count": int(len(data)), "type": typ}
            if minmax:
                acc["min"] = [float(x) for x in data.min(0)]
                acc["max"] = [float(x) for x in data.max(0)]
            accessors.append(acc)
            return len(accessors) - 1

        for k, s in self.surfaces.items():
            a = s.arrays()
            if a is None:
                continue
            P, N, T, UV, C, I = a
            attrs = {
                "POSITION": add_acc(P.astype(np.float32), "VEC3", minmax=True),
                "NORMAL": add_acc(N.astype(np.float32), "VEC3"),
                "TANGENT": add_acc(T.astype(np.float32), "VEC4"),
                "TEXCOORD_0": add_acc(UV.astype(np.float32), "VEC2"),
                "COLOR_0": add_acc(C.astype(np.float32), "VEC4"),
            }
            ind = add_acc(I.astype(np.uint32), "SCALAR", ctype=5125, target=34963)
            mat = {"name": k, "pbrMetallicRoughness": {"baseColorFactor": [1, 1, 1, 1], "metallicFactor": 0, "roughnessFactor": 0.8}}
            if k in double_sided or k.startswith(("foliage", "grass", "impostor", "flower")):
                mat["doubleSided"] = True
            materials.append(mat)
            prims.append({"attributes": attrs, "indices": ind, "material": len(materials) - 1, "mode": 4})
        gltf = {
            "asset": {"version": "2.0", "generator": "dushanbe vegmesh.py"},
            "scene": 0, "scenes": [{"nodes": [0]}],
            "nodes": [{"name": name, "mesh": 0}],
            "meshes": [{"name": name, "primitives": prims}],
            "materials": materials,
            "buffers": [{"byteLength": offset}],
            "bufferViews": buffer_views, "accessors": accessors,
        }
        js = json.dumps(gltf, separators=(",", ":")).encode()
        js += b" " * ((4 - len(js) % 4) % 4)
        binb = b"".join(bin_chunks)
        total = 12 + 8 + len(js) + 8 + len(binb)
        with open(path, "wb") as f:
            f.write(struct.pack("<III", 0x46546C67, 2, total))
            f.write(struct.pack("<II", len(js), 0x4E4F534A)); f.write(js)
            f.write(struct.pack("<II", len(binb), 0x004E4942)); f.write(binb)


def load_atlas(tex_root, species):
    return json.load(open(f"{tex_root}/foliage_{species}/atlas.json"))["sprites"]
