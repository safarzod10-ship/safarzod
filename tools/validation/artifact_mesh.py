"""Decoder and analyzer for the packed mesh format used by the model viewer
artifact (manifest.json + base64 gzip chunks).

Format (reverse-engineered from the viewer's index.html and verified by the
`total` / `compressed` byte counts in each manifest):
  base64(gzip(position f32x3 | normal f32x3 | [uv f32x2] | index u32))
Coordinates are glTF convention: Y-up, metres, UV origin top-left (flipY=false).

Usage (run with an isolated interpreter):
  python -I tools/validation/artifact_mesh.py <artifact_dir> <key> [--json out.json]
"""
from __future__ import annotations

import base64
import gzip
import json
import sys
from pathlib import Path

import numpy as np


def load(artifact_dir: Path, key: str) -> dict:
    manifest = json.loads((artifact_dir / key / "manifest.json").read_text())
    packed = b"".join(base64.b64decode((artifact_dir / c).read_text().strip()) for c in manifest["chunks"])
    if len(packed) != manifest["compressed"]:
        raise ValueError(f"{key}: compressed size {len(packed)} != manifest {manifest['compressed']}")
    raw = gzip.decompress(packed)
    if len(raw) != manifest["total"]:
        raise ValueError(f"{key}: raw size {len(raw)} != manifest {manifest['total']}")
    parts = manifest["parts"]

    def view(name: str, dtype, width: int):
        p = parts[name]
        return np.frombuffer(raw, dtype=dtype, count=p["count"] * width, offset=p["offset"]).reshape(-1, width).copy()

    out = {
        "manifest": manifest,
        "position": view("position", np.float32, 3),
        "normal": view("normal", np.float32, 3) if "normal" in parts else None,
        "uv": view("uv", np.float32, 2) if "uv" in parts else None,
        "index": view("index", np.uint32, 1).reshape(-1, 3),
    }
    return out


def weld(position: np.ndarray, eps: float = 1e-5) -> np.ndarray:
    """Map each vertex to a canonical id by quantised position (merges UV/normal seams)."""
    q = np.round(position / eps).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    return inv.reshape(-1)


def components(tris: np.ndarray, n_verts: int) -> np.ndarray:
    parent = np.arange(n_verts)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for a, b, c in tris:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    roots = np.array([find(i) for i in range(n_verts)])
    _, labels = np.unique(roots, return_inverse=True)
    return labels


def analyze(m: dict) -> dict:
    pos, idx, nrm = m["position"], m["index"], m["normal"]
    rep: dict = {}
    rep["vertices"] = int(len(pos))
    rep["triangles"] = int(len(idx))
    rep["has_normals"] = nrm is not None
    rep["has_uv"] = m["uv"] is not None
    rep["finite"] = bool(np.isfinite(pos).all())
    rep["index_in_range"] = bool(idx.max() < len(pos))
    mn, mx = pos.min(0), pos.max(0)
    rep["bbox_min"] = mn.round(4).tolist()
    rep["bbox_max"] = mx.round(4).tolist()
    rep["size_xyz_m"] = (mx - mn).round(4).tolist()
    if nrm is not None:
        ln = np.linalg.norm(nrm, axis=1)
        rep["normal_len_min_max"] = [round(float(ln.min()), 4), round(float(ln.max()), 4)]
        rep["normals_bad_count"] = int(((ln < 0.9) | (ln > 1.1)).sum())
    if m["uv"] is not None:
        uv = m["uv"]
        rep["uv_min"] = uv.min(0).round(4).tolist()
        rep["uv_max"] = uv.max(0).round(4).tolist()
    # triangle quality
    a, b, c = pos[idx[:, 0]], pos[idx[:, 1]], pos[idx[:, 2]]
    cross = np.cross(b - a, c - a)
    area = 0.5 * np.linalg.norm(cross, axis=1)
    rep["surface_area_m2"] = round(float(area.sum()), 3)
    rep["degenerate_tris"] = int((area < 1e-10).sum())
    # winding vs stored normals
    if nrm is not None:
        fn = cross / np.maximum(np.linalg.norm(cross, axis=1, keepdims=True), 1e-20)
        vn = nrm[idx].mean(1)
        rep["tris_facing_against_normals"] = int(((fn * vn).sum(1) < 0).sum())
    w = weld(pos)
    wt = w[idx]
    rep["welded_vertices"] = int(w.max() + 1)
    # duplicate triangles
    st = np.sort(wt, axis=1)
    rep["duplicate_tris"] = int(len(st) - len(np.unique(st, axis=0)))
    # edge manifoldness
    e = np.concatenate([wt[:, [0, 1]], wt[:, [1, 2]], wt[:, [2, 0]]])
    e = np.sort(e, axis=1)
    _, counts = np.unique(e, axis=0, return_counts=True)
    rep["edges"] = int(len(counts))
    rep["boundary_edges"] = int((counts == 1).sum())
    rep["non_manifold_edges"] = int((counts > 2).sum())
    labels = components(wt, int(w.max() + 1))
    tri_comp = labels[wt[:, 0]]
    n_comp = int(labels.max() + 1)
    rep["connected_components"] = n_comp
    comps = []
    for ci in range(n_comp):
        sel = tri_comp == ci
        if not sel.any():
            continue
        vsel = np.unique(idx[sel].reshape(-1))
        p = pos[vsel]
        comps.append({"id": ci, "tris": int(sel.sum()), "min": p.min(0).round(3).tolist(), "max": p.max(0).round(3).tolist()})
    comps.sort(key=lambda c: -c["tris"])
    rep["largest_components"] = comps[:25]
    rep["tri_component"] = tri_comp  # stripped before JSON
    return rep


def main(argv: list[str]) -> int:
    art, key = Path(argv[1]), argv[2]
    m = load(art, key)
    rep = analyze(m)
    rep.pop("tri_component")
    text = json.dumps(rep, indent=1, ensure_ascii=False)
    if "--json" in argv:
        Path(argv[argv.index("--json") + 1]).write_text(text)
    print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
