"""Build terrain chunk meshes + outskirts ring from assets/world (Blender background).

  blender -b --factory-startup --python tools/blender/build_terrain.py -- <out.glb> <report.json>

* 8 x 8 chunks of 100 m (2 m grid, 50 x 50 cells = 5 000 triangles each), object
  origin at the chunk centre so Godot culls/LODs per chunk.
* Normals come from the GLOBAL heightmap (central differences) -> no lighting seams.
* Every chunk has a 0.8 m vertical skirt so LOD simplification never opens cracks.
* Outskirts ring (+-400 m .. +-1600 m) on a 16 m grid split into 4 objects, inner
  edge sampled from the detailed heightmap (sunk 0.15 m to avoid z-fighting).
* UV0 = world XZ mapped to the splat (detailed area 0..1, outside clamps).
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_glb_from_artifact as B  # noqa: E402

CFG = json.loads((ROOT / "assets/world/world_config.json").read_text())
T = CFG["terrain"]
N = T["heightmap_size"][0]
STEP = T["grid_step_m"]
HALF = CFG["bounds"]["detailed_terrain"][2]
H = np.fromfile(ROOT / "assets/world/terrain/heightmap_2m.bin", dtype="<f4").reshape(N, N)
SN = T["skirt_size"][0]
SK = np.fromfile(ROOT / "assets/world/terrain/skirt_heights.bin", dtype="<f4").reshape(SN, SN)
SSTEP, SHALF = T["skirt_step_m"], T["skirt_half_m"]


def height(x, z):
    fx, fz = (x + HALF) / STEP, (z + HALF) / STEP
    ix = np.clip(np.floor(fx).astype(int), 0, N - 2)
    iz = np.clip(np.floor(fz).astype(int), 0, N - 2)
    tx, tz = fx - ix, fz - iz
    return (H[iz, ix] * (1 - tx) * (1 - tz) + H[iz, ix + 1] * tx * (1 - tz) + H[iz + 1, ix] * (1 - tx) * tz
            + H[iz + 1, ix + 1] * tx * tz)


GZ, GX = np.gradient(H, STEP)


def normal_at(ix, iz):
    n = np.stack([-GX[iz, ix], np.ones_like(GX[iz, ix]), -GZ[iz, ix]], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def make_obj(name, verts_gltf, normals_gltf, tris, uvs, mat, origin):
    me = B.build_mesh(name, B.to_zup(verts_gltf - origin), B.to_zup(normals_gltf), None, tris)
    layer = me.uv_layers.new(name="UVMap")
    luv = uvs[tris.ravel()].copy()
    luv[:, 1] = 1.0 - luv[:, 1]
    layer.data.foreach_set("uv", luv.astype(np.float32).ravel())
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    ob.location = B.to_zup(origin[None])[0]
    bpy.context.scene.collection.objects.link(ob)
    return ob


def grid_tris(nx, nz, offset=0):
    t = []
    for j in range(nz):
        for i in range(nx):
            a = offset + j * (nx + 1) + i
            b, c, d = a + 1, a + nx + 1, a + nx + 2
            t += [(a, c, b), (b, c, d)]
    return t


def chunk(ch, mat):
    cells = int(ch["size"] / STEP)
    i0, j0 = int((ch["x0"] + HALF) / STEP), int((ch["z0"] + HALF) / STEP)
    ii, jj = np.meshgrid(np.arange(i0, i0 + cells + 1), np.arange(j0, j0 + cells + 1))
    X = ii * STEP - HALF
    Z = jj * STEP - HALF
    Y = H[jj, ii]
    verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
    nrm = normal_at(ii, jj).reshape(-1, 3)
    tris = grid_tris(cells, cells)
    # skirts: duplicate border vertices 0.8 m lower
    border = []
    nx = cells + 1
    for i in range(nx):
        border.append(i)                                   # north edge (j=0)
    for j in range(1, nx):
        border.append(j * nx + cells)                      # east
    for i in range(cells - 1, -1, -1):
        border.append(cells * nx + i)                      # south
    for j in range(cells - 1, 0, -1):
        border.append(j * nx)                              # west
    base = len(verts)
    low = verts[border] - np.array([0, 0.8, 0])
    verts = np.vstack([verts, low])
    nrm = np.vstack([nrm, nrm[border]])
    for k in range(len(border)):
        a, b = border[k], border[(k + 1) % len(border)]
        la, lb = base + k, base + (k + 1) % len(border)
        tris += [(a, la, b), (b, la, lb)]
    uv = np.stack([(verts[:, 0] + HALF) / (2 * HALF), (verts[:, 2] + HALF) / (2 * HALF)], -1)
    origin = np.array([ch["x0"] + ch["size"] / 2, 0.0, ch["z0"] + ch["size"] / 2])
    return make_obj(ch["id"], verts, nrm, np.array(tris, np.int32), uv, mat, origin)


def ring(mat, name_prefix, inner, outer, step, sink_inner):
    """Square ring between |x|,|z| = inner .. outer on a regular grid of `step` (aligned)."""
    stride = int(step / SSTEP)
    G = SK[::stride, ::stride]
    n = G.shape[0]
    xs = np.linspace(-SHALF, SHALF, n)
    X, Z = np.meshgrid(xs, xs)
    Y = G.copy()
    cheb = np.maximum(np.abs(X), np.abs(Z))
    if inner == HALF:
        edge = np.abs(cheb - HALF) < 1e-3
        Y[edge] = height(np.clip(X[edge], -HALF, HALF), np.clip(Z[edge], -HALF, HALF)) - 0.15
        near = (cheb > HALF) & (cheb <= HALF + 2 * step)
        Y[near] = 0.5 * Y[near] + 0.5 * height(np.clip(X[near], -HALF, HALF), np.clip(Z[near], -HALF, HALF))
    gz, gx = np.gradient(Y, step)
    nrm = np.stack([-gx, np.ones_like(gx), -gz], -1)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    V = np.stack([X.ravel(), Y.ravel(), Z.ravel()], -1)
    NN = nrm.reshape(-1, 3)
    sides = {"N": lambda cx, cz: cz < -inner, "S": lambda cx, cz: cz > inner,
             "W": lambda cx, cz: cx < -inner and abs(cz) <= inner, "E": lambda cx, cz: cx > inner and abs(cz) <= inner}
    objs = []
    for side, sel in sides.items():
        tris = []
        for j in range(n - 1):
            for i in range(n - 1):
                cx, cz = (xs[i] + xs[i + 1]) / 2, (xs[j] + xs[j + 1]) / 2
                c = max(abs(cx), abs(cz))
                if c < inner or c > outer or not sel(cx, cz):
                    continue
                a = j * n + i
                tris += [(a, a + n, a + 1), (a + 1, a + n, a + n + 1)]
        tris = np.array(tris, np.int32)
        used, inv = np.unique(tris, return_inverse=True)
        v = V[used].copy()
        nn = NN[used]
        if sink_inner:
            v[np.abs(np.maximum(np.abs(v[:, 0]), np.abs(v[:, 2])) - inner) < 1e-3, 1] -= sink_inner
        uv = np.stack([(v[:, 0] + HALF) / (2 * HALF), (v[:, 2] + HALF) / (2 * HALF)], -1)
        origin = np.array([v[:, 0].mean(), 0.0, v[:, 2].mean()])
        objs.append(make_obj(f"{name_prefix}_{side}", v, nn, inv.reshape(-1, 3), uv, mat, origin))
    return objs


def outskirts(mat):
    # near ring 400..800 m @16 m; far ring 800..1600 m @32 m. The far ring's inner edge is sunk
    # 0.6 m below the near ring so the T-junction at 800 m cannot show the sky.
    return ring(mat, "Outskirts_Near", HALF, 800.0, 16.0, 0.0) + ring(mat, "Outskirts_Far", 800.0, SHALF, 32.0, 0.6)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    out_glb, out_json = Path(argv[0]), Path(argv[1])
    B.reset_scene()
    mat = B.principled("M_Terrain", (0.45, 0.42, 0.33, 1), 0.0, 0.9)
    for ch in CFG["chunks"]:
        chunk(ch, mat)
    outskirts(mat)
    stats = B.scene_stats()
    bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_normals=True, export_texcoords=True)
    rep = {"objects": len(stats["mesh_objects"]), "triangles": stats["triangles"], "vertices": stats["vertices"],
           "size_m": stats["size_zup_m"], "glb_bytes": out_glb.stat().st_size}
    out_json.write_text(json.dumps(rep, indent=1))
    print("TERRAIN", json.dumps(rep))


if __name__ == "__main__":
    main()
