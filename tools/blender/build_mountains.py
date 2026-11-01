"""Mountain backdrop from REAL elevation (SRTM, 120 m grid, +-62 km).

  blender -b --factory-startup --python tools/blender/build_mountains.py -- <region_dem.npy> <out.glb> <report.json>

Three layers (near 1.5-8 km, mid 8-25 km, far 25-62 km real distance) as polar
grids around the monument. Distances beyond 3 km are compressed (r' = 3 + (r-3)/5 km)
so everything fits a 16 km camera far plane; heights are scaled by r'/r, which keeps
the true angular size of every ridge as seen from the city. Earth curvature with
standard refraction (R_eff = 7.33e6 m) is applied. Vertex colours encode land cover
from true altitude and slope (valley fields, loess foothills, alpine grass, rock,
late-April snow above ~3300 m). Inside the outskirts square (+-1.6 km) the surface is
sunk 4 m below the DEM so the detailed terrain always wins.
"""
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_glb_from_artifact as B  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
CFG = json.loads((ROOT / "assets/world/world_config.json").read_text())
BASE = CFG["frame"]["origin_elevation_m"]
R_EFF = 7.33e6
R_LIN, K = 3000.0, 5.0
LAYERS = [("Mountains_Near", 1500.0, 8000.0, 0.035, 480),
          ("Mountains_Mid", 8000.0, 25000.0, 0.05, 360),
          ("Mountains_Far", 25000.0, 61500.0, 0.07, 240)]
# ARTISTIC ASSUMPTION (docs/TERRAIN_SYSTEM.md): true angular heights are only 3-5 deg from the
# city; a moderate vertical exaggeration, growing with distance, gives the Hisor range the
# presence it has in photographs while keeping every silhouette shape from the real DEM.
EXAGGERATION = {"Mountains_Near": 1.15, "Mountains_Mid": 1.5, "Mountains_Far": 1.7}


def compress(r):
    return np.where(r <= R_LIN, r, R_LIN + (r - R_LIN) / K)


def hash2(x, z):
    v = np.sin(x * 0.0123 + z * 0.0371) * 43758.5453
    return v - np.floor(v)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    dem = np.load(argv[0]).astype(np.float64)
    out_glb, out_json = Path(argv[1]), Path(argv[2])
    n = dem.shape[0]
    half, step = 62000.0, 120.0
    gz, gx = np.gradient(dem, step)
    slope = np.hypot(gx, gz)

    def sample(a, x, z):
        fx, fz = (x + half) / step, (z + half) / step
        ix = np.clip(np.floor(fx).astype(int), 0, n - 2)
        iz = np.clip(np.floor(fz).astype(int), 0, n - 2)
        tx, tz = fx - ix, fz - iz
        return (a[iz, ix] * (1 - tx) * (1 - tz) + a[iz, ix + 1] * tx * (1 - tz)
                + a[iz + 1, ix] * (1 - tx) * tz + a[iz + 1, ix + 1] * tx * tz)

    B.reset_scene()
    mat = B.principled("M_Mountains", (0.5, 0.48, 0.42, 1), 0.0, 0.95)
    report = {"layers": {}}
    for name, r0, r1, alpha, segs in LAYERS:
        rings = [r0]
        while rings[-1] < r1:
            rings.append(rings[-1] * (1 + alpha))
        rings = np.array(rings[:-1] + [r1])
        th = np.linspace(0, 2 * math.pi, segs, endpoint=False)
        Rr, TH = np.meshgrid(rings, th, indexing="ij")
        X = Rr * np.sin(TH)
        Z = -Rr * np.cos(TH)
        elev = sample(dem, X, Z)
        sl = sample(slope, X, Z)
        h_rel = elev - BASE - Rr ** 2 / (2 * R_EFF)
        inside = (np.abs(X) < 1600) & (np.abs(Z) < 1600)
        h_rel = np.where(inside, h_rel - 4.0, h_rel)
        s = compress(Rr) / Rr
        ex = np.where(inside, 1.0, EXAGGERATION[name])
        # blend exaggeration in over the first 1.5 km of the near layer (continuity with the city)
        ex = 1.0 + (ex - 1.0) * np.clip((Rr - 1600.0) / 1500.0, 0, 1)
        V = np.stack([X * s, h_rel * s * ex, Z * s], -1).reshape(-1, 3)
        # land-cover colour (sRGB) from true altitude / slope
        noise = hash2(X, Z)
        valley = np.array([0.43, 0.44, 0.31]) * (0.9 + 0.2 * noise[..., None])
        foot_g = np.array([0.46, 0.48, 0.30])
        foot_b = np.array([0.54, 0.47, 0.37])
        alpine = np.array([0.40, 0.43, 0.30])
        rock = np.array([0.50, 0.48, 0.45])
        snow = np.array([0.90, 0.92, 0.95])
        st = np.clip(sl[..., None] / 0.8, 0, 1)
        col = valley.copy() * np.ones_like(st)
        e = elev[..., None]
        foot = foot_g * (1 - st) + foot_b * st
        col = np.where(e > 950, foot, col)
        mid = alpine * (1 - st) + rock * st
        t = np.clip((e - 1800) / 400, 0, 1)
        col = col * (1 - t) + mid * t
        t = np.clip((e - 2900) / 300, 0, 1)
        col = col * (1 - t) + rock * t
        snowline = 3300 + (noise[..., None] - 0.5) * 300
        t = np.clip((e - snowline) / 200, 0, 1) * np.clip((1.2 - sl[..., None]) / 0.5, 0, 1)
        col = col * (1 - t) + snow * t
        C = col.reshape(-1, 3)
        # triangles (ring-major grid, wrap around)
        tris = []
        nr = len(rings)
        for i in range(nr - 1):
            for j in range(segs):
                a = i * segs + j
                b = i * segs + (j + 1) % segs
                c = (i + 1) * segs + j
                d = (i + 1) * segs + (j + 1) % segs
                tris += [(a, b, c), (b, d, c)]
        tris = np.array(tris, np.int32)
        me = B.build_mesh(name, B.to_zup(V), None, None, tris)
        me.polygons.foreach_set("use_smooth", np.ones(len(tris), dtype=bool))
        ca = me.color_attributes.new(name="Col", type="BYTE_COLOR", domain="POINT")
        rgba = np.hstack([np.clip(C, 0, 1), np.ones((len(C), 1))]).astype(np.float32)
        ca.data.foreach_set("color_srgb", rgba.ravel())
        me.materials.append(mat)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        if name == "Mountains_Near":
            # flat valley floor dominates the near ring: collapse-decimate it (silhouettes are kept)
            mod = ob.modifiers.new("dec", "DECIMATE")
            mod.ratio = 0.5
            bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier="dec")
        report["layers"][name] = {"rings": int(nr), "segments": segs, "real_radius_m": [r0, r1],
                                  "rendered_radius_m": [float(compress(np.array(r0))), float(compress(np.array(r1)))],
                                  "triangles": len(ob.data.polygons), "max_real_elev_m": round(float(elev.max()), 1),
                                  "vertical_exaggeration": EXAGGERATION[name]}
    nodes = mat.node_tree.nodes
    vc = nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mat.node_tree.links.new(vc.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_normals=True, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False)
    report["glb_bytes"] = out_glb.stat().st_size
    report["compression"] = f"r' = r (r <= {R_LIN} m), r' = {R_LIN} + (r - {R_LIN}) / {K}; heights x r'/r"
    out_json.write_text(json.dumps(report, indent=1))
    print("MOUNTAINS", json.dumps(report))


if __name__ == "__main__":
    main()
