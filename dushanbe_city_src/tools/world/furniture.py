"""Road furniture of DUSHANBE-X, computed on the final road geometry:

  fillets    rounded kerb corners at the at-grade junctions of city streets (curb returns): the
             asphalt between the two carriageway edges and a tangent arc, + the sidewalk around it
  crossings  zebra crossings on every arm of those junctions
  billboards one advertising billboard (DushanbeCity bank) per kilometre of road, beside the road,
             facing the traffic, on free ground (no road, building, water, bridge, tunnel, landmark)
  guardrails W-beam steel barriers along the edges of country / mountain roads wherever the ground
             beside the road drops away (embankments, cliffs, outer side of hairpins)
"""
import math
import numpy as np
from scipy.spatial import cKDTree
import network as NW


def _dirs(P):
    d = np.gradient(P, axis=0)
    d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    return d


def _struct_mask(r):
    m = np.zeros(len(r["P"]), bool)
    for a, b in r["bridges"] + r["tunnels"]:
        m[max(a - 3, 0):b + 4] = True
    return m


def _seg_intersect(p1, p2, q1, q2):
    d1 = p2 - p1; d2 = q2 - q1
    den = d1[0] * d2[1] - d1[1] * d2[0]
    if abs(den) < 1e-9:
        return None
    t = ((q1[0] - p1[0]) * d2[1] - (q1[1] - p1[1]) * d2[0]) / den
    u = ((q1[0] - p1[0]) * d1[1] - (q1[1] - p1[1]) * d1[0]) / den
    if -0.02 <= t <= 1.02 and -0.02 <= u <= 1.02:
        return t, u
    return None


def junctions(roads):
    """at-grade crossings / T-junctions between city (grid) roads: list of (ia, ka, ib, kb, point)"""
    city = [i for i, r in enumerate(roads) if not r["routed"]]
    trees = {i: cKDTree(roads[i]["P"]) for i in city}
    out = []
    for n, ia in enumerate(city):
        A = roads[ia]
        for ib in city[n + 1:]:
            B = roads[ib]
            pairs = trees[ia].query_ball_tree(trees[ib], r=6.0)
            cand = [(ka, kb) for ka, lst in enumerate(pairs) for kb in lst]
            if not cand:
                continue
            found = []
            for ka, kb in cand:
                for da in (-1, 0):
                    for db in (-1, 0):
                        a0, b0 = ka + da, kb + db
                        if a0 < 0 or b0 < 0 or a0 + 1 >= len(A["P"]) or b0 + 1 >= len(B["P"]):
                            continue
                        res = _seg_intersect(A["P"][a0], A["P"][a0 + 1], B["P"][b0], B["P"][b0 + 1])
                        if res is None:
                            continue
                        t, u = res
                        pt = A["P"][a0] + (A["P"][a0 + 1] - A["P"][a0]) * t
                        if any(np.hypot(*(pt - f[4])) < 20 for f in found):
                            continue
                        ha = A["H"][a0] + (A["H"][a0 + 1] - A["H"][a0]) * t
                        hb = B["H"][b0] + (B["H"][b0 + 1] - B["H"][b0]) * u
                        if abs(ha - hb) > 1.0:
                            continue          # different levels (bridge / underpass)
                        found.append((ia, a0, ib, b0, pt, (ha + hb) / 2))
            out += found
    return out


def _arm_exists(r, k, direction, dist):
    """does road r have carriageway `dist` metres from point k in `direction` (unit xz)?"""
    P = r["P"]
    q = P[k] + direction * dist
    return np.min(np.hypot(P[:, 0] - q[0], P[:, 1] - q[1])) < 1.5


def fillets_and_crossings(roads):
    fil = []
    cross = []
    for (ia, ka, ib, kb, O, h) in junctions(roads):
        A, B = roads[ia], roads[ib]
        hwA = NW.CLASSES[A["cls"]]["w"] / 2; hwB = NW.CLASSES[B["cls"]]["w"] / 2
        a = A["P"][ka + 1] - A["P"][ka]; a /= np.linalg.norm(a)
        b = B["P"][kb + 1] - B["P"][kb]; b /= np.linalg.norm(b)
        nA = np.array([-a[1], a[0]]); nB = np.array([-b[1], b[0]])
        big = max(hwA, hwB) > 6.0
        R = 14.0 if big else 10.0
        # which arms exist (T-junctions have three)
        armA = {s: _arm_exists(A, ka, a * s, hwB + 10.0) for s in (-1, 1)}
        armB = {s: _arm_exists(B, kb, b * s, hwA + 10.0) for s in (-1, 1)}
        for sA in (-1, 1):
            for sB in (-1, 1):
                # quadrant: side sA of A (normal nA*sA), side sB of B
                rayA = a * (1 if np.dot(a, nB * sB) > 0 else -1)      # along A's edge into the quadrant
                rayB = b * (1 if np.dot(b, nA * sA) > 0 else -1)
                sa = 1 if np.dot(rayA, a) > 0 else -1
                sb = 1 if np.dot(rayB, b) > 0 else -1
                if not armA[sa] or not armB[sb]:
                    continue
                # corner C: intersection of A's edge (offset hwA * sA) and B's edge (offset hwB * sB)
                pA = O + nA * sA * hwA; pB = O + nB * sB * hwB
                M = np.array([[rayA[0], -rayB[0]], [rayA[1], -rayB[1]]])
                try:
                    t, u = np.linalg.solve(M, pB - pA)
                except np.linalg.LinAlgError:
                    continue
                C = pA + rayA * t
                cosang = float(np.clip(np.dot(rayA, rayB), -0.99, 0.99))
                theta = math.acos(cosang)
                if theta < 0.5 or theta > 2.6:
                    continue
                tl = R / math.tan(theta / 2)
                T1 = C + rayA * tl; T2 = C + rayB * tl
                bis = rayA + rayB; bis /= np.linalg.norm(bis)
                Ctr = C + bis * (R / math.sin(theta / 2))
                fil.append({"c": [round(float(C[0]), 2), round(float(h), 3), round(float(C[1]), 2)],
                            "t1": [round(float(T1[0]), 2), round(float(T1[1]), 2)],
                            "t2": [round(float(T2[0]), 2), round(float(T2[1]), 2)],
                            "o": [round(float(Ctr[0]), 2), round(float(Ctr[1]), 2)], "r": R})
        # zebra crossings on every existing arm, just outside the other road's carriageway
        for (r, k, d, hwo, hws, arms) in ((A, ka, a, hwB, hwA, armA), (B, kb, b, hwA, hwB, armB)):
            for s in (-1, 1):
                if not arms[s]:
                    continue
                p = O + d * s * (hwo + R * 0.55 + 2.0)
                cross.append({"x": round(float(p[0]), 2), "z": round(float(p[1]), 2), "y": round(float(h), 3),
                              "yaw": round(math.atan2(d[0], d[1]), 4), "w": round(hws * 2 - 1.0, 2)})
    return fil, cross


def _free_point(x, z, rad, road_tree, road_hw, bld_tree, bld_r, lm, water_ok):
    d, i = road_tree.query((x, z))
    if d < road_hw[i] + rad:
        return False
    if bld_tree is not None:
        near = bld_tree.query_ball_point((x, z), r=rad + 40.0)
        for j in near:
            if math.hypot(bld_tree.data[j][0] - x, bld_tree.data[j][1] - z) < rad + bld_r[j]:
                return False
    for (lx, lz, L, D) in lm:
        if abs(x - lx) < L / 2 + rad and abs(z - lz) < D / 2 + rad:
            return False
    return water_ok(x, z)


def billboards(roads, buildings, landmarks, H_at, water_ok, every=400.0):
    pts = []; hw = []
    for r in roads:
        pts.extend(r["P"].tolist()); hw.extend([NW.CLASSES[r["cls"]]["w"] / 2] * len(r["P"]))
    road_tree = cKDTree(np.array(pts)); road_hw = np.array(hw)
    bld = np.array([[b[1], b[2]] for b in buildings]) if buildings else None
    bld_r = [math.hypot(b[4], b[5]) / 2 for b in buildings]
    bld_tree = cKDTree(bld) if bld is not None else None
    lm = [(l["x"], l["z"], l["L"], l["D"]) for l in landmarks]
    out = []
    for r in roads:
        if r["cls"] in ("lane", "dirt"):
            continue
        P = r["P"]; Hh = r["H"]
        hwr = NW.CLASSES[r["cls"]]["w"] / 2
        D = _dirs(P)
        S = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(P, axis=0).T))])
        bad = _struct_mask(r)
        n = int(S[-1] // every)
        for m in range(1, n + 1):
            placed = False
            for shift in (0, 60, -60, 120, -120, 180, -180, 240, -240, 300, -300, 360, -360, 420, -420, 480, -480):
                target = m * every - every * 0.5 + shift
                if target < 30 or target > S[-1] - 30:
                    continue
                k = int(np.searchsorted(S, target))
                if bad[max(k - 8, 0):k + 8].any():
                    continue
                d = D[k]; nrm = np.array([-d[1], d[0]])
                for side, off in [(sd, o) for o in (hwr + 9.0, hwr + 6.5, hwr + 13.0) for sd in ((1, -1) if m % 2 else (-1, 1))]:
                    # dense city streets: also just behind the kerb / a little further out
                    x, z = P[k] + nrm * off * side
                    g = float(H_at([x], [z])[0])
                    if abs(g - Hh[k]) > 5.0:
                        continue
                    if any(math.hypot(x - b["x"], z - b["z"]) < (300.0 if b["road"] == r["id"] else 120.0) for b in out):
                        continue          # ~400 m apart: never two boards close together (junctions, loops)
                    # the board is 11 m wide: both its ends must be free as well
                    ok = all(_free_point(x + d[0] * e, z + d[1] * e, 4.0, road_tree, road_hw, bld_tree, bld_r, lm, water_ok)
                             for e in (-7.5, 0.0, 7.5))      # the board is 15.5 m wide (x1.4 model)
                    if not ok:
                        continue
                    # the poster faces the oncoming traffic, turned 25 deg towards the road
                    face = -d * 1.0
                    ang = math.atan2(face[0], face[1]) + math.radians(25) * (-side)
                    # model: the poster's front faces local +X -> yaw so that +X = face
                    yaw = ang - math.pi / 2
                    out.append({"x": round(float(x), 2), "y": round(g, 2), "z": round(float(z), 2), "yaw": round(yaw, 4),
                                "road": r["id"]})
                    placed = True
                    break
                if placed:
                    break
    return out


def guardrails(roads, H_at, min_run=24.0):
    """runs of guardrail points [[x, y, z], ...] along road edges where the ground drops > 1.4 m"""
    pts = []; hw = []; rid = []
    for i, r in enumerate(roads):
        pts.extend(r["P"].tolist()); hw.extend([NW.CLASSES[r["cls"]]["w"] / 2] * len(r["P"])); rid.extend([i] * len(r["P"]))
    tree = cKDTree(np.array(pts)); hw = np.array(hw); rid = np.array(rid)
    runs = []
    for i, r in enumerate(roads):
        if r["cls"] not in ("highway", "road", "mountain") or not r["routed"]:
            continue
        P = r["P"]; Hh = r["H"]
        hwr = NW.CLASSES[r["cls"]]["w"] / 2
        D = _dirs(P)
        bad = _struct_mask(r)
        for side in (-1, 1):
            nrm = np.stack([-D[:, 1], D[:, 0]], 1) * side
            edge = P + nrm * (hwr + 1.2)
            # the ground 3 m and 9 m beyond the edge (the carved corridor reaches ~hw + 5 m)
            g1 = H_at(*(P + nrm * (hwr + 3.0)).T)
            g2 = H_at(*(P + nrm * (hwr + 9.0)).T)
            drop = Hh - np.minimum(g1, g2)
            mark = (drop > 2.0) & ~bad
            # never across another road (junctions)
            dd, ii = tree.query(edge, k=6)
            for c in range(6):
                other = rid[ii[:, c]] != i
                mark &= ~(other & (dd[:, c] < hw[ii[:, c]] + 6.0))
            # close short gaps, drop short runs
            k = 0
            n = len(P)
            while k < n:
                if not mark[k]:
                    k += 1
                    continue
                j = k
                while j + 1 < n and (mark[j + 1] or (j + 3 < n and mark[j + 2:j + 4].any() and not bad[j + 1])):
                    j += 1
                a, b = max(k - 1, 0), min(j + 1, n - 1)
                L = float(np.sum(np.hypot(*np.diff(edge[a:b + 1], axis=0).T))) if b > a else 0.0
                if L >= min_run:
                    run = [[round(float(edge[q][0]), 2), round(float(Hh[q]), 3), round(float(edge[q][1]), 2)] for q in range(a, b + 1)]
                    runs.append({"s": side, "p": run})
                k = j + 1
    return runs
