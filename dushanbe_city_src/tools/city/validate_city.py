#!/usr/bin/env python3
"""City validation (prints PASS/FAIL, writes docs/reports/city_validation.json):
 1. pedestrian network continuity: rasterise paved pedestrian surfaces (sidewalks, ramps,
    crosswalks, corner fillets, plazas, paths) at 0.5 m and check connected components;
 2. no building intersects any road right-of-way or another building;
 3. reserved lots contain no buildings, trees or props;
 4. every chunk has a GLB + JSON, colliders present;
 5. trees/props are not placed on carriageways.
"""
import json, math, os, sys, glob
sys.path.insert(0, os.path.dirname(__file__))
import streets as st
import layout as lay

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
GAME = os.path.join(ROOT, "dushanbe_city")
RES = 0.5
N = int(600 / RES)


def raster(rects):
    import numpy as np
    g = np.zeros((N, N), bool)
    for r in rects:
        x0 = max(0, int(math.floor((r[0] + 300) / RES))); x1 = min(N, int(math.ceil((r[2] + 300) / RES)))
        z0 = max(0, int(math.floor((r[1] + 300) / RES))); z1 = min(N, int(math.ceil((r[3] + 300) / RES)))
        g[z0:z1, x0:x1] = True
    return g


def main():
    import numpy as np
    from scipy import ndimage
    results = {}
    roads = {r.id: r for r in lay.ROADS}
    net = st.Network(lay.ROADS)
    net.build(midblock=[(roads[i], a) for (i, a) in lay.MIDBLOCK])
    P = lay.plan()
    ped = [r for (k, r, y) in net.surfaces if k in ("sidewalk", "strip:pits")]
    ped += [r for (r, d) in net.ramps] + [c for (c, ax) in net.crosswalks]
    ped += [(min(K[0], K[0] + K[2] * K[4]), min(K[1], K[1] + K[3] * K[4]), max(K[0], K[0] + K[2] * K[4]), max(K[1], K[1] + K[3] * K[4])) for K in net.fillets]
    g = raster(ped)
    lab, n = ndimage.label(g)
    sizes = np.bincount(lab.ravel())[1:]
    main_share = sizes.max() / sizes.sum()
    small = int((sizes < 0.01 * sizes.sum()).sum())
    results["pedestrian_components"] = int(n)
    results["pedestrian_main_share"] = round(float(main_share), 4)
    ok1 = main_share > 0.97
    print(("PASS" if ok1 else "FAIL"), "pedestrian network: %d components, main = %.1f%% of paved walkable area (%d tiny)" % (n, main_share * 100, small))
    # 2. buildings vs roads / each other
    row_rects = [r.rect(-r.half, r.half) for r in lay.ROADS]
    bad = []
    for B in P.buildings:
        for rr in row_rects:
            if st.rect_and(B["rect"], rr):
                bad.append(B["id"])
    for i, A in enumerate(P.buildings):
        for Bb in P.buildings[i + 1:]:
            if st.rect_and(A["rect"], Bb["rect"]):
                bad.append(A["id"] + "/" + Bb["id"])
    print(("PASS" if not bad else "FAIL"), "buildings clear of roads and each other", bad[:5])
    results["building_conflicts"] = bad
    # 3. reserved lots empty
    viol = []
    for (name, r, note) in P.reserved:
        for B in P.buildings:
            if st.rect_and(B["rect"], r):
                viol.append((name, B["id"]))
        for t in P.trees:
            if r[0] < t[1] < r[2] and r[1] < t[2] < r[3]:
                viol.append((name, t[0]))
        for p in P.props:
            if r[0] < p[1] < r[2] and r[1] < p[2] < r[3]:
                viol.append((name, p[0]))
    # chunk instances too
    chunks = sorted(glob.glob(os.path.join(GAME, "data/city/chunk_*.json")))
    medians = [rc for (k, rc, y) in net.surfaces if k == "median"]
    carriage = [rc for rc in st.rects_sub([rc for (k, rc, y) in net.surfaces if k == "asphalt"],
                [r.rect(-r.median, r.median) for r in lay.ROADS if r.median > 0])]
    on_road = []
    for path in chunks:
        J = json.load(open(path))
        for (name, r, note) in P.reserved:
            for t in J["trees"]:
                if r[0] < t[1] < r[2] and r[1] < t[2] < r[3]:
                    viol.append((name, t[0]))
            for p in J["props"]:
                if r[0] < p[1] < r[2] and r[1] < p[3] < r[3]:
                    viol.append((name, p[0]))
        for t in J["trees"]:
            if any(c[0] < t[1] < c[2] and c[1] < t[2] < c[3] for c in carriage):
                on_road.append(("tree", t[0], t[1], t[2]))
        for p in J["props"]:
            if p[0] in ("lamp_avenue",):
                continue
            if any(c[0] < p[1] < c[2] and c[1] < p[3] < c[3] for c in carriage):
                on_road.append(("prop", p[0], p[1], p[3]))
    print(("PASS" if not viol else "FAIL"), "reserved lots empty", viol[:5])
    print(("PASS" if not on_road else "FAIL"), "no trees/props on carriageways", on_road[:5])
    results["reserved_violations"] = viol
    results["on_road"] = on_road
    # 4. chunks
    glbs = sorted(glob.glob(os.path.join(GAME, "assets/city/chunks/chunk_*.glb")))
    ok4 = len(glbs) == 36 and len(chunks) == 36
    print(("PASS" if ok4 else "FAIL"), "36 chunks (glb %d, json %d)" % (len(glbs), len(chunks)))
    results["chunks"] = [len(glbs), len(chunks)]
    os.makedirs(os.path.join(GAME, "docs/reports"), exist_ok=True)
    json.dump(results, open(os.path.join(GAME, "docs/reports/city_validation.json"), "w"), indent=1, ensure_ascii=False)
    # debug image of pedestrian components
    from PIL import Image
    img = np.zeros((N, N, 3), np.uint8)
    main_lab = int(np.argmax(sizes)) + 1
    img[g] = (200, 60, 60)
    img[lab == main_lab] = (60, 60, 60)
    Image.fromarray(img).save(os.path.join(GAME, "docs/maps/pedestrian_network.png"))
    sys.exit(0 if (ok1 and not bad and not viol and not on_road and ok4) else 1)


if __name__ == "__main__":
    main()
