"""Old vs current monument: can the old model's geometry/texture be transferred
onto the current mesh? Measured answer (docs/MONUMENT_TEXTURE_TRANSFER.md).

  /opt/dushanbe-venv/bin/python -I tools/validation/compare_monuments.py [out.json]

For each element of the CURRENT model (statue, lions, crown) the matching region
of the OLD model (box in old model units, located by bounding boxes in
orthographic views) is registered with a similarity transform (trimmed ICP,
Umeyama), then surface distances are measured both ways. A texture/normal bake
from old to current is only valid where surfaces coincide within a few cm.
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.spatial import cKDTree

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).resolve().parent))
import artifact_mesh as am  # noqa: E402

ART = ROOT / "source_assets" / "artifact_V319FyaEBZx5atFp4i7bg3"
H = 43.0 / 0.9995 * 1.02349   # current model units -> metres (stage-2 scale incl. crown fix)
JOBS = {  # name: (current-model island ids, old-model crop box min, max)
    "statue": ([24], [-0.10, 0.17, -0.05], [0.12, 0.58, 0.16]),
    "lion_left": ([1], [-0.31, 0.09, 0.05], [-0.14, 0.25, 0.32]),
    "lion_right": ([41], [0.14, 0.09, 0.05], [0.31, 0.25, 0.32]),
    "crown": ([25, 26], [-0.15, 0.70, -0.2], [0.15, 0.85, 0.2]),
}


def sample(p, t, n, seed=0):
    a, b, c = p[t[:, 0]], p[t[:, 1]], p[t[:, 2]]
    ar = np.linalg.norm(np.cross(b - a, c - a), axis=1)
    r = np.random.default_rng(seed)
    i = r.choice(len(t), n, p=ar / ar.sum())
    u = r.random((n, 2))
    m = u.sum(1) > 1
    u[m] = 1 - u[m]
    return a[i] + (b[i] - a[i]) * u[:, :1] + (c[i] - a[i]) * u[:, 1:]


def umeyama(src, dst):
    ms, md = src.mean(0), dst.mean(0)
    s0, d0 = src - ms, dst - md
    U, S, Vt = np.linalg.svd(d0.T @ s0 / len(src))
    D = np.eye(3)
    if np.linalg.det(U) * np.linalg.det(Vt) < 0:
        D[2, 2] = -1
    R = U @ D @ Vt
    sc = np.trace(np.diag(S) @ D) / (s0 ** 2).sum(1).mean()
    return sc, R, md - sc * R @ ms


def icp(src, dst, iters=60, trim=0.85):
    tree = cKDTree(dst)
    sc = np.ptp(dst[:, 1]) / np.ptp(src[:, 1])
    R = np.eye(3)
    t = (dst.min(0) + dst.max(0)) / 2 - sc * (src.min(0) + src.max(0)) / 2
    for _ in range(iters):
        x = (sc * (R @ src.T)).T + t
        d, j = tree.query(x)
        keep = d <= np.quantile(d, trim)
        sc, R, t = umeyama(src[keep], dst[j[keep]])
    x = (sc * (R @ src.T)).T + t
    d, _ = tree.query(x)
    d2, _ = cKDTree(x).query(dst)
    return sc, R, d, d2


def main():
    cur, old = am.load(ART, "monument"), am.load(ART, "oldmonument")
    cp, ct = cur["position"], cur["index"].reshape(-1, 3)
    op = old["position"]
    comp = am.analyze(cur)["tri_component"]
    out = {}
    for name, (ids, lo, hi) in JOBS.items():
        src = sample(cp, ct[np.isin(comp, ids)], 20000)
        dst = op[np.all((op >= lo) & (op <= hi), axis=1)]
        if len(dst) > 200000:
            dst = dst[np.random.default_rng(1).choice(len(dst), 200000, replace=False)]
        sc, R, d, d2 = icp(src, dst)
        size = float(np.ptp(src[:, 1]) * H)
        m = lambda v: round(float(v / sc * H), 3)  # noqa: E731  (old units -> current metres)
        out[name] = {"current_height_m": round(size, 2), "rotation_deg": round(float(np.degrees(np.arccos(np.clip((np.trace(R) - 1) / 2, -1, 1)))), 1),
                     "current_to_old_median_m": m(np.median(d)), "current_to_old_p90_m": m(np.quantile(d, 0.9)),
                     "old_to_current_median_m": m(np.median(d2)),
                     "fraction_within_2cm": round(float((d / sc * H < 0.02).mean()), 3),
                     "fraction_within_2pct_of_height": round(float((d / sc * H < 0.02 * size).mean()), 3)}
        print(name, out[name], flush=True)
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "reports" / "monument_old_vs_current.json"
    path.write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
