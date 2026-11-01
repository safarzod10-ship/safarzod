"""Procedural vegetation for Dushanbe (Blender background, deterministic seeds).

  blender -b --factory-startup --python tools/blender/build_vegetation.py -- <out_dir> <report.json>

Per species one GLB with two meshes: <Name>_LOD0 (full: tapered trunk, branch
hierarchy, leaf-cluster cards) and <Name>_LOD1 (4-sided trunk, main branches,
~30 % of the cards at 1.7x size: same silhouette, far fewer triangles/overdraw).
Leaf-card normals point away from the crown centre (soft, volumetric shading).
Card UVs pick one of the 4 cells of the species' foliage atlas.
Grass clumps are real geometry blades (opaque: no alpha test on mobile GPUs).
Species reference: common urban trees of Dushanbe (see docs/DUSHANBE_ENVIRONMENT_RESEARCH.md).
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_glb_from_artifact as B  # noqa: E402

SPECIES = {
    # name: trunk_h (to crown base), height, trunk_r, crown centre y, crown radii (xz, y), n_main,
    #       cards LOD0, card size, bark, leaves, crown shape
    "Plane": dict(trunk_h=4.5, height=18.0, trunk_r=0.36, crown_c=11.5, crown_rx=7.0, crown_ry=6.2, n_main=7,
                  cards=430, card=2.3, bark="M_Bark_Light", leaves="M_Leaves_Plane", shape="ellipsoid", seed=101),
    "Elm": dict(trunk_h=3.0, height=13.0, trunk_r=0.30, crown_c=8.6, crown_rx=5.0, crown_ry=4.3, n_main=6,
                cards=470, card=1.7, bark="M_Bark_Dark", leaves="M_Leaves_Elm", shape="ellipsoid", seed=102),
    "Poplar": dict(trunk_h=2.5, height=22.0, trunk_r=0.30, crown_c=12.0, crown_rx=1.9, crown_ry=9.6, n_main=14,
                   cards=380, card=1.5, bark="M_Bark_Light", leaves="M_Leaves_Poplar", shape="spindle", seed=103),
    "Thuja": dict(trunk_h=0.4, height=6.5, trunk_r=0.12, crown_c=3.3, crown_rx=1.5, crown_ry=3.1, n_main=0,
                  cards=260, card=1.25, bark="M_Bark_Dark", leaves="M_Leaves_Thuja", shape="cone", seed=104),
    "Boxwood": dict(trunk_h=0.0, height=1.1, trunk_r=0.0, crown_c=0.55, crown_rx=0.75, crown_ry=0.55, n_main=0,
                    cards=70, card=0.62, bark=None, leaves="M_Leaves_Elm", shape="dome", seed=201),
    "Juniper": dict(trunk_h=0.0, height=0.9, trunk_r=0.0, crown_c=0.42, crown_rx=1.25, crown_ry=0.42, n_main=0,
                    cards=64, card=0.75, bark=None, leaves="M_Leaves_Thuja", shape="dome", seed=202),
    "Rose": dict(trunk_h=0.0, height=1.2, trunk_r=0.0, crown_c=0.65, crown_rx=0.6, crown_ry=0.6, n_main=0,
                 cards=55, card=0.55, bark=None, leaves="M_Leaves_Shrub", shape="ellipsoid", seed=203),
}


class MeshBuilder:
    def __init__(self):
        self.v, self.n, self.uv, self.t, self.m = [], [], [], [], []

    def add(self, verts, norms, uvs, tris, mat):
        base = len(self.v)
        self.v += list(map(tuple, verts))
        self.n += list(map(tuple, norms))
        self.uv += list(map(tuple, uvs))
        self.t += [tuple(np.array(tri) + base) for tri in tris]
        self.m += [mat] * len(tris)

    def tri_count(self):
        return len(self.t)


def tube(mb, pts, radii, sides, mat, uv_scale=1.0):
    pts = np.asarray(pts, float)
    verts, norms, uvs, tris = [], [], [], []
    L = 0.0
    for i, p in enumerate(pts):
        d = pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]
        d /= np.linalg.norm(d) + 1e-9
        a = np.cross(d, [0, 0, 1] if abs(d[2]) < 0.9 else [1, 0, 0])
        a /= np.linalg.norm(a)
        b = np.cross(d, a)
        if i > 0:
            L += np.linalg.norm(pts[i] - pts[i - 1])
        circ = max(2 * math.pi * radii[i], 0.05)
        for s in range(sides + 1):
            ang = 2 * math.pi * s / sides
            nn = a * math.cos(ang) + b * math.sin(ang)
            verts.append(p + nn * radii[i])
            norms.append(nn)
            uvs.append((s / sides * max(1.0, round(circ / 0.8)) * uv_scale, L / 0.8 * uv_scale))
    for i in range(len(pts) - 1):
        for s in range(sides):
            a = i * (sides + 1) + s
            b, c, d = a + 1, a + sides + 1, a + sides + 2
            tris += [(a, c, b), (b, c, d)]
    mb.add(verts, norms, uvs, tris, mat)


def branch_path(rng, start, direction, length, segs, droop, curl):
    pts = [np.array(start, float)]
    d = np.array(direction, float)
    d /= np.linalg.norm(d)
    for _ in range(segs):
        d = d + np.array([rng.normal(0, curl), -droop, rng.normal(0, curl)])
        d /= np.linalg.norm(d)
        pts.append(pts[-1] + d * length / segs)
    return pts


def crown_point(rng, sp):
    """Point in the crown volume, biased to the outer shell."""
    for _ in range(100):
        u = rng.normal(size=3)
        u /= np.linalg.norm(u)
        r = rng.uniform(0.55, 1.0) ** 0.5
        p = u * r
        if sp["shape"] == "cone":
            yn = rng.uniform(-1, 1)
            rad = (1 - (yn + 1) / 2) * 1.0
            ang = rng.uniform(0, 2 * math.pi)
            p = np.array([math.cos(ang) * rad * r, yn, math.sin(ang) * rad * r])
        elif sp["shape"] == "spindle":          # narrow ellipsoid, slightly fuller low down
            p = np.array([p[0] * (1.1 - 0.3 * p[1]), p[1], p[2] * (1.1 - 0.3 * p[1])])
        elif sp["shape"] == "dome" and p[1] < -0.55:
            continue
        return np.array([p[0] * sp["crown_rx"], sp["crown_c"] + p[1] * sp["crown_ry"], p[2] * sp["crown_rx"]])
    return np.array([0, sp["crown_c"], 0])


def leaf_cards(mb, rng, sp, count, size, mat):
    centre = np.array([0, sp["crown_c"], 0])
    verts, norms, uvs, tris = [], [], [], []
    for k in range(count):
        p = crown_point(rng, sp)
        out = p - centre
        out[1] *= 0.6
        out = out / (np.linalg.norm(out) + 1e-6)
        # card plane: roughly facing outward, random roll, slight upward tilt
        f = out + rng.normal(0, 0.5, 3)
        f[1] += 0.25
        f /= np.linalg.norm(f)
        a = np.cross(f, [0, 1, 0])
        if np.linalg.norm(a) < 1e-3:
            a = np.array([1.0, 0, 0])
        a /= np.linalg.norm(a)
        b = np.cross(a, f)
        roll = rng.uniform(-0.6, 0.6)
        a, b = a * math.cos(roll) + b * math.sin(roll), -a * math.sin(roll) + b * math.cos(roll)
        s = size * rng.uniform(0.8, 1.2) / 2
        c = p
        quad = [c - a * s - b * s, c + a * s - b * s, c + a * s + b * s, c - a * s + b * s]
        cell = rng.integers(0, 4)
        u0, v0 = (cell % 2) * 0.5, (cell // 2) * 0.5
        q_uv = [(u0, v0 + 0.5), (u0 + 0.5, v0 + 0.5), (u0 + 0.5, v0), (u0, v0)]
        base = len(verts)
        for qv in quad:
            nn = qv - centre
            nn[1] = nn[1] * 0.7 + 0.35 * np.linalg.norm(nn)   # bias up: brighter tops
            verts.append(qv)
            norms.append(nn / (np.linalg.norm(nn) + 1e-6))
        uvs += q_uv
        tris += [(base, base + 1, base + 2), (base, base + 2, base + 3)]
    mb.add(verts, norms, uvs, tris, mat)


def build_tree(name, sp, lod):
    rng = np.random.default_rng(sp["seed"])
    mb = MeshBuilder()
    sides = 8 if lod == 0 else 4
    if sp["trunk_r"] > 0:
        top = sp["height"] * (0.92 if sp["shape"] != "spindle" else 0.97)
        trunk = branch_path(rng, (0, -0.2, 0), (0, 1, 0), top + 0.2, 7 if lod == 0 else 3, 0.0, 0.03)
        radii = [sp["trunk_r"] * (1.25 if i == 0 else 1.0) * (1 - i / len(trunk)) ** 0.7 + 0.03 for i in range(len(trunk))]
        tube(mb, trunk, radii, sides, "bark")
        for m in range(sp["n_main"] if lod == 0 else max(2, sp["n_main"] // 2)):
            t = rng.uniform(0.0, 1.0)
            y0 = sp["trunk_h"] + t * (sp["crown_c"] + sp["crown_ry"] * 0.3 - sp["trunk_h"])
            if sp["shape"] == "spindle":
                y0 = sp["trunk_h"] + t * (sp["height"] * 0.8 - sp["trunk_h"])
            ang = rng.uniform(0, 2 * math.pi)
            up = 0.9 if sp["shape"] == "spindle" else rng.uniform(0.35, 0.8)
            d = (math.cos(ang), up, math.sin(ang))
            length = (sp["crown_rx"] * rng.uniform(0.75, 1.05)) if sp["shape"] != "spindle" else rng.uniform(1.2, 2.2)
            pts = branch_path(rng, (0, y0, 0), d, length, 4 if lod == 0 else 2, 0.04, 0.15)
            r0 = sp["trunk_r"] * rng.uniform(0.35, 0.5)
            tube(mb, pts, [r0 * (1 - i / len(pts)) + 0.02 for i in range(len(pts))], 6 if lod == 0 else 3, "bark")
            if lod == 0 and sp["shape"] != "spindle":
                for _ in range(3):
                    k = rng.integers(1, len(pts) - 1)
                    d2 = np.array(d) + rng.normal(0, 0.6, 3)
                    d2[1] = abs(d2[1]) * 0.6 + 0.2
                    sub = branch_path(rng, pts[k], d2, length * 0.45, 3, 0.05, 0.2)
                    tube(mb, sub, [r0 * 0.45 * (1 - i / len(sub)) + 0.012 for i in range(len(sub))], 4, "bark")
    count = sp["cards"] if lod == 0 else max(12, int(sp["cards"] * 0.3))
    size = sp["card"] if lod == 0 else sp["card"] * 1.7
    leaf_cards(mb, rng, sp, count, size, "leaves")
    return mb


def grass_clump(name, rng, blades, h_range, radius, width, lean):
    mb = MeshBuilder()
    for _ in range(blades):
        ang = rng.uniform(0, 2 * math.pi)
        r = radius * math.sqrt(rng.uniform(0, 1))
        base = np.array([math.cos(ang) * r, 0.0, math.sin(ang) * r])
        h = rng.uniform(*h_range)
        facing = rng.uniform(0, 2 * math.pi)
        side = np.array([math.cos(facing), 0, math.sin(facing)])
        bend_dir = np.array([math.cos(ang), 0, math.sin(ang)]) * lean * rng.uniform(0.3, 1.0)
        w = width * rng.uniform(0.7, 1.3)
        p1 = base + np.array([0, h * 0.5, 0]) + bend_dir * h * 0.15
        p2 = base + np.array([0, h, 0]) + bend_dir * h * 0.5
        verts = [base - side * w / 2, base + side * w / 2, p1 - side * w * 0.35, p1 + side * w * 0.35, p2]
        nrm = np.cross(side, [0, 1, 0])
        nrm = nrm * 0.4 + np.array([0, 0.9, 0])
        nrm /= np.linalg.norm(nrm)
        # UV.y carries the height along the blade (0 root .. 1 tip) for shading / wind
        uvs = [(0, 0), (1, 0), (0.15, 0.5), (0.85, 0.5), (0.5, 1.0)]
        mb.add(verts, [nrm] * 5, uvs, [(0, 1, 2), (1, 3, 2), (2, 3, 4)], "grass")
    return mb


def to_object(name, mb, mats, single_surface=False):
    v = np.array(mb.v, float)
    n = np.array(mb.n, float)
    uv = np.array(mb.uv, float)
    t = np.array(mb.t, np.int32)
    me = B.build_mesh(name, B.to_zup(v), B.to_zup(n), None, t)
    layer = me.uv_layers.new(name="UVMap")
    luv = uv[t.ravel()].copy()
    luv[:, 1] = 1.0 - luv[:, 1]
    layer.data.foreach_set("uv", luv.astype(np.float32).ravel())
    if single_surface:
        # one draw call per instance batch: bark triangles keep the leaves material but are
        # flagged with vertex colour alpha = 0 (foliage shader renders them as opaque bark)
        col = np.ones((len(v), 4), np.float32)
        bark_v = np.unique(t[np.array([m == "bark" for m in mb.m], bool)].ravel()) if "bark" in mb.m else []
        col[bark_v] = (0.30, 0.25, 0.20, 0.0)
        ca = me.color_attributes.new(name="Col", type="FLOAT_COLOR", domain="POINT")
        ca.data.foreach_set("color", col.ravel())
        mb.m = ["leaves"] * len(mb.m)
    keys = sorted(set(mb.m))
    for k in keys:
        me.materials.append(mats[k])
    me.polygons.foreach_set("material_index", np.array([keys.index(k) for k in mb.m], np.int32))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def export(path):
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_normals=True, export_texcoords=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=False)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out_dir, out_json = Path(argv[0]), Path(argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)
    report = {}
    for name, sp in SPECIES.items():
        B.reset_scene()
        mats = {"bark": B.principled(sp["bark"] or "M_Bark_Dark", (0.35, 0.3, 0.25, 1), 0, 0.9),
                "leaves": B.principled(sp["leaves"], (0.3, 0.45, 0.2, 1), 0, 0.6)}
        info = {}
        for lod in (0, 1):
            mb = build_tree(name, sp, lod)
            ob = to_object(f"{name}_LOD{lod}", mb, mats, single_surface=(lod == 1))
            info[f"LOD{lod}_triangles"] = mb.tri_count()
            info["height_m"] = round(float(np.array(mb.v)[:, 1].max()), 2)
        export(out_dir / f"{name.lower()}.glb")
        info["glb_bytes"] = (out_dir / f"{name.lower()}.glb").stat().st_size
        report[name] = info
    B.reset_scene()
    gm = {"grass": B.principled("M_Grass", (0.3, 0.45, 0.18, 1), 0, 0.8)}
    rng = np.random.default_rng(301)
    for name, args in {"Grass_Lawn": (10, (0.10, 0.20), 0.22, 0.035, 0.25),
                       "Grass_Wild": (12, (0.28, 0.55), 0.30, 0.045, 0.45)}.items():
        mb = grass_clump(name, rng, *args)
        to_object(name, mb, gm)
        report[name] = {"triangles": mb.tri_count()}
    export(out_dir / "grass.glb")
    report["grass_glb_bytes"] = (out_dir / "grass.glb").stat().st_size
    out_json.write_text(json.dumps(report, indent=1))
    print("VEGETATION", json.dumps(report))


if __name__ == "__main__":
    main()
