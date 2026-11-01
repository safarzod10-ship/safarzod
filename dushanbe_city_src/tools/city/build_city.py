#!/usr/bin/env python3
"""DUSHANBE city build: layout -> per-chunk GLB meshes + JSON instance data for Godot.

Output (dushanbe_city/):
  assets/city/chunks/chunk_<i>_<j>.glb   nodes "base" (always) and "detail" (near only)
  data/city/chunk_<i>_<j>.json            trees, props, fence lines, colliders, lights, attachments
  data/city/city.json                     roads, zones, reserved lots, lawn rects, spawn, stats
  docs/maps/city_plan.png                 top-down plan
"""
import json, math, os, random, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import meshkit as mk
import buildings as bl
import streets as st
import layout as lay
import extras

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
GAME = os.path.join(ROOT, "dushanbe_city")
CH = 100.0
ORIGIN = -300.0
H = st.H
RNG = random.Random(7)

GROUND_MAT = {"soil_garden": "soil", "flowerbed": "soil", "plaza_reserved": "plaza", "lawn_park": "lawn",
              "concrete_yard": "concrete", "tiles_out": "tiles", "lawn": "lawn", "gravel": "gravel",
              "sport": "sport", "cobble": "cobble", "plaza": "plaza", "sidewalk": "sidewalk",
              "asphalt_yard": "asphalt_yard", "lawn_worn": "lawn_worn", "concrete": "concrete"}
LAWN_KINDS = {"lawn", "lawn_park", "median", "strip:lawn", "strip:aryk"}


def chunk_of(x, z):
    i = min(5, max(0, int((x - ORIGIN) // CH)))
    j = min(5, max(0, int((z - ORIGIN) // CH)))
    return (i, j)


class Chunks:
    def __init__(self):
        self.base, self.detail, self.data = {}, {}, {}

    def B(self, k):
        if k not in self.base:
            self.base[k] = mk.Builder()
        return self.base[k]

    def D(self, k):
        if k not in self.detail:
            self.detail[k] = mk.Builder()
        return self.detail[k]

    def J(self, k):
        if k not in self.data:
            self.data[k] = {"trees": [], "props": [], "lines": [], "colliders": [], "lights": [], "attach": []}
        return self.data[k]


def main():
    t0 = time.time()
    C = Chunks()
    P = lay.plan()
    roads = {r.id: r for r in lay.ROADS}
    net = st.Network(lay.ROADS)
    net.build(midblock=[(roads[i], a) for (i, a) in lay.MIDBLOCK])
    st.emit(net, C.B, chunk_of)
    lawn_rects = []
    for (kind, r, y) in net.surfaces:
        if kind in LAWN_KINDS:
            lawn_rects.append(("strip" if kind.startswith("strip") else "median", r))

    # ---- block ground (painter with priority, no overlaps) -----------------------------------
    blocks = []
    for ci, (x0, x1) in lay.COLS.items():
        for rj, (z0, z1) in lay.ROWS.items():
            blocks.append((x0, z0, x1, z1))
    # mahalla lanes cut blocks of row 3
    lane_cut = [roads["l1"].rect(-roads["l1"].half, roads["l1"].half), roads["l2"].rect(-roads["l2"].half, roads["l2"].half)]
    blocks = st.rects_sub(blocks, lane_cut)
    bld_rects = [B["rect"] for B in P.buildings]
    entries = [(r, m, b) for (r, m, b) in P.ground]
    for blk in blocks:
        mine = []
        for (r, m, border) in entries:
            c = st.rect_and(r, blk)
            if c:
                mine.append((c, m, border))
        # resolve priority: later entries win
        for idx, (r, m, border) in enumerate(mine):
            higher = [q for (q, _, _) in mine[idx + 1:]]
            pieces = st.rects_sub([r], higher + bld_rects)
            for p in pieces:
                emit_ground(C, p, m)
                if m in ("lawn", "lawn_park"):
                    lawn_rects.append(("lawn", p))
            if border and m not in ("lawn",):
                border_box(C, r, m)
        base = st.rects_sub([blk], [q for (q, _, _) in mine] + bld_rects)
        for p in base:
            emit_ground(C, p, "lawn")
            lawn_rects.append(("lawn", p))

    # ---- buildings -----------------------------------------------------------------------------
    tris = {"buildings": 0}
    for B in P.buildings:
        k = chunk_of(B["x"], B["z"])
        ctx = bl.Ctx(C.B(k), C.D(k), random.Random(hash(B["id"]) & 0xffffffff))
        bl.build(ctx, B)
        J = C.J(k)
        for (cat, p, yaw) in ctx.attach:
            J["attach"].append([cat, round(p[0], 3), round(p[1], 3), round(p[2], 3), round(yaw, 4)])
        for (_, c, s, yaw) in ctx.colliders:
            J["colliders"].append([round(v, 3) for v in (*c, *s, yaw)])
        for (kind, p) in ctx.lights:
            J["lights"].append([kind, round(p[0], 2), round(p[1], 2), round(p[2], 2)])
        J.setdefault("doors", [])
        for (bid, p, yaw) in ctx.doors:
            J["doors"].append([bid, round(p[0], 2), round(p[1], 2), round(p[2], 2), round(yaw, 4)])
        C.B(k).set_transform(0, 0, 0, 0)
        C.D(k).set_transform(0, 0, 0, 0)

    # ---- plan elements -------------------------------------------------------------------------
    for (cat, x, z) in P.trees:
        C.J(chunk_of(x, z))["trees"].append([cat, round(x, 2), round(z, 2), round(RNG.uniform(0, 6.283), 3), round(RNG.uniform(0.85, 1.15), 3)])
    for (cat, x, z, yaw) in P.props:
        C.J(chunk_of(x, z))["props"].append([cat, round(x, 2), H, round(z, 2), round(yaw, 4)])
    for (cat, x0, z0, x1, z1) in P.lines:
        if cat == "havli_wall":
            havli_wall(C, x0, z0, x1, z1)
        else:
            C.J(chunk_of((x0 + x1) / 2, (z0 + z1) / 2))["lines"].append([cat, round(x0, 2), round(z0, 2), round(x1, 2), round(z1, 2)])
    for (r, axis) in P.parking:
        parking_paint(C, r)
    street_furniture(C, net, roads)

    # ---- raised ground colliders (one box per block / raised road band) ------------------------
    for blk in blocks:
        for q in st.split_grid(blk):
            add_ground_collider(C, q)
    for (kind, r, y) in net.surfaces:
        if y > 0:
            for q in st.split_grid(r):
                add_ground_collider(C, q)
    for (r, d) in net.ramps:
        pass  # ramps: walkable via step-up (0.13 m)

    # ---- procedural small structures (not in prop library) -> geometry ----------------------
    for k, J in C.data.items():
        keep = []
        for p in J["props"]:
            fn = extras.BUILDERS.get(p[0])
            if fn:
                fn(C.B(k), C.D(k), J["colliders"], p[1], p[3], p[4], RNG)
                C.B(k).set_transform(0, 0, 0, 0); C.D(k).set_transform(0, 0, 0, 0)
            elif p[0] != "flagpole":
                keep.append(p)
        J["props"] = keep

    # ---- write -----------------------------------------------------------------------------------
    os.makedirs(os.path.join(GAME, "assets/city/chunks"), exist_ok=True)
    os.makedirs(os.path.join(GAME, "data/city"), exist_ok=True)
    stats = {}
    for k in sorted(set(C.base) | set(C.detail) | set(C.data)):
        name = "chunk_%d_%d" % k
        nodes = [("base", C.base[k].meshes if k in C.base else {}), ("detail", C.detail[k].meshes if k in C.detail else {})]
        mk.write_glb(os.path.join(GAME, "assets/city/chunks", name + ".glb"), nodes, origin=(ORIGIN + (k[0] + 0.5) * CH, 0.0, ORIGIN + (k[1] + 0.5) * CH))
        J = C.J(k)
        J["glb"] = "res://assets/city/chunks/%s.glb" % name
        J["origin"] = [ORIGIN + k[0] * CH, ORIGIN + k[1] * CH]
        json.dump(J, open(os.path.join(GAME, "data/city", name + ".json"), "w"), ensure_ascii=False, separators=(",", ":"))
        tb = sum(C.base[k].stats().values()) if k in C.base else 0
        td = sum(C.detail[k].stats().values()) if k in C.detail else 0
        stats[name] = {"tris_base": tb, "tris_detail": td, "trees": len(J["trees"]), "props": len(J["props"]) + len(J["attach"])}
    city = {
        "size": [600, 600], "chunk": CH, "origin": ORIGIN, "ground_y": H,
        "spawn": [-58.0, H, -90.0, 0.0],
        "roads": [{"id": r.id, "name": r.name, "axis": r.axis, "c": r.c, "a0": r.a0, "a1": r.a1, "half": r.half,
                   "carriage_half": r.cw, "lanes": r.lanes} for r in lay.ROADS],
        "zones": [[n, list(r)] for (n, r) in P.zones],
        "reserved_lots": [{"name": n, "rect": list(r), "note": note} for (n, r, note) in P.reserved],
        "lawns": [[k, [round(v, 2) for v in r]] for (k, r) in lawn_rects],
        "buildings": [{"id": B["id"], "kind": B["kind"], "rect": list(B["rect"]), "floors": B["floors"], "height": round(B["H"], 2)} for B in P.buildings],
        "stats": stats,
    }
    json.dump(city, open(os.path.join(GAME, "data/city/city.json"), "w"), ensure_ascii=False, indent=0)
    tot_b = sum(s["tris_base"] for s in stats.values()); tot_d = sum(s["tris_detail"] for s in stats.values())
    print("buildings", len(P.buildings), "trees", len(P.trees), "props", len(P.props), "tris base", tot_b, "detail", tot_d,
          "time %.1fs" % (time.time() - t0))
    plan_png(P, net, lawn_rects)


def emit_ground(C, r, m):
    mat = GROUND_MAT.get(m, m)
    for q in st.split_grid(r):
        b = C.B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
        b.ao_ground = False
        y = H + (0.005 if mat in ("soil",) else 0.0)
        b.quad(mat, (q[0], y, q[3]), (q[2], y, q[3]), (q[2], y, q[1]), (q[0], y, q[1]))
        b.ao_ground = True


def border_box(C, r, m):
    """Low concrete border (поребрик) along the edges of paved paths / beds."""
    x0, z0, x1, z1 = r
    w, h = 0.08, 0.07
    t = (0.85, 0.85, 0.82)
    for (a, b_, c, d) in ((x0, z0, x1, z0 + w), (x0, z1 - w, x1, z1), (x0, z0, x0 + w, z1), (x1 - w, z0, x1, z1)):
        for q in st.split_grid((a, b_, c, d)):
            bb = C.B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
            bb.ao_ground = False
            bb.box("curb", q[0], H - 0.02, q[1], q[2], H + h, q[3], tint=t, faces="YxXzZ")
            bb.ao_ground = True


def havli_wall(C, x0, z0, x1, z1):
    """2.2 m plastered wall with brick cap, typical of private houses (havli)."""
    k = chunk_of((x0 + x1) / 2, (z0 + z1) / 2)
    b = C.B(k)
    t = RNG.choice([(0.95, 0.93, 0.88), (0.93, 0.87, 0.76), (0.86, 0.90, 0.85), (0.92, 0.84, 0.74), (0.97, 0.97, 0.95)])
    th = 0.25
    hgt = 2.2
    if abs(x1 - x0) > abs(z1 - z0):
        a, c = min(x0, x1), max(x0, x1)
        b.box("wall_plaster", a, H, z0 - th / 2, c, H + hgt, z0 + th / 2, tint=t, faces="xXzZ")
        b.box("wall_brick_red", a - 0.03, H + hgt, z0 - th / 2 - 0.04, c + 0.03, H + hgt + 0.12, z0 + th / 2 + 0.04, faces="YxXzZy")
        b.box("plinth", a, H, z0 - th / 2 - 0.02, c, H + 0.4, z0 + th / 2 + 0.02, tint=(0.8, 0.8, 0.78), faces="zZ")
        C.J(k)["colliders"].append([round((a + c) / 2, 2), H + hgt / 2, z0, round(c - a, 2), hgt, th, 0.0])
    else:
        a, c = min(z0, z1), max(z0, z1)
        b.box("wall_plaster", x0 - th / 2, H, a, x0 + th / 2, H + hgt, c, tint=t, faces="xXzZ")
        b.box("wall_brick_red", x0 - th / 2 - 0.04, H + hgt, a - 0.03, x0 + th / 2 + 0.04, H + hgt + 0.12, c + 0.03, faces="YxXzZy")
        b.box("plinth", x0 - th / 2 - 0.02, H, a, x0 + th / 2 + 0.02, H + 0.4, c, tint=(0.8, 0.8, 0.78), faces="xX")
        C.J(k)["colliders"].append([x0, H + hgt / 2, round((a + c) / 2, 2), th, hgt, round(c - a, 2), 0.0])


def parking_paint(C, r):
    x0, z0, x1, z1 = r
    t = (1, 1, 1)
    def line(a, b_, c, d):
        for q in st.split_grid((a, b_, c, d)):
            bb = C.B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
            bb.ao_ground = False
            bb.quad("road_paint", (q[0], H + 0.01, q[3]), (q[2], H + 0.01, q[3]), (q[2], H + 0.01, q[1]), (q[0], H + 0.01, q[1]), tint=t)
            bb.ao_ground = True
    if (x1 - x0) >= (z1 - z0):
        x = x0 + 0.5
        while x < x1 - 0.5:
            line(x, z0, x + 0.1, z0 + 5.0)
            if z1 - z0 > 12:
                line(x, z1 - 5.0, x + 0.1, z1)
            x += 2.6
    else:
        z = z0 + 0.5
        while z < z1 - 0.5:
            line(x0, z, x0 + 5.0, z + 0.1)
            if x1 - x0 > 12:
                line(x1 - 5.0, z, x1, z + 0.1)
            z += 2.6
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    C.J(chunk_of(x0, z0))["props"].append(["sign_parking", round(x0 + 0.3, 2), H, round(z0 + 0.3, 2), 0.0])


def add_ground_collider(C, q):
    k = chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2)
    C.J(k)["colliders"].append([round((q[0] + q[2]) / 2, 3), H / 2 - 0.25, round((q[1] + q[3]) / 2, 3),
                                round(q[2] - q[0], 3), H + 0.5, round(q[3] - q[1], 3), 0.0])


def occupied(x, z, P_rects):
    return any(r[0] <= x <= r[2] and r[1] <= z <= r[3] for r in P_rects)


def street_furniture(C, net, roads):
    """Street trees, lamps, traffic lights, signs, bus stops, benches, urns along roads."""
    def add(cat, x, z, yaw=0.0):
        C.J(chunk_of(x, z))["props"].append([cat, round(x, 2), H, round(z, 2), round(yaw, 4)])

    def tree(cat, x, z):
        C.J(chunk_of(x, z))["trees"].append([cat, round(x, 2), round(z, 2), round(RNG.uniform(0, 6.283), 3), round(RNG.uniform(0.85, 1.15), 3)])

    no_go = [c for (c, ax) in net.crosswalks]
    inter_boxes = []
    for (za, xb) in net.intersections:
        inter_boxes.append((za.c - za.half - 2, xb.c - xb.half - 2, za.c + za.half + 2, xb.c + xb.half + 2))
    bus = {"av": [-112.0, 118.0], "com": [86.0], "d": [-64.0]}
    bus_rects = []
    for rid, alongs in bus.items():
        R = roads[rid]
        for a in alongs:
            for s in (1, -1):
                # right-hand traffic: stop on the right of travel direction
                off = s * (R.cw + R.strip + 1.6)
                x, z = R.p(a + s * 12, off)
                yaw = (math.pi / 2 if s > 0 else -math.pi / 2) if R.axis == "z" else (0.0 if s > 0 else math.pi)
                # front faces the road: yaw so local +Z points to road centre
                yaw = {("z", 1): -math.pi / 2, ("z", -1): math.pi / 2, ("x", 1): math.pi, ("x", -1): 0.0}[(R.axis, s)]
                add("bus_stop", x, z, yaw)
                sx, sz = R.p(a + s * 12 + 4.0 * (1 if R.axis == "x" else 1), s * (R.cw + 0.6))
                add("sign_bus_stop", sx, sz, yaw)
                ux, uz = R.p(a + s * 12 - 3.5, off)
                add("urn", ux, uz, yaw)
                lo = a + s * 12 - 10
                bus_rects.append(R.rect(-R.half, R.half, lo - 4, lo + 24))
                # yellow zig-zag stop marking (1.17)
                for k in range(8):
                    za_ = lo + k * 2.5
                    o0 = s * (R.cw - 0.3)
                    q = R.rect(min(o0, o0 - s * 2.6), max(o0, o0 - s * 2.6), za_, za_ + 0.12)
                    net.paint.append((q, "yellow"))
    for R in net.roads:
        cuts = no_go + inter_boxes + bus_rects
        lo, hi = R.a0 + 4, R.a1 - 4
        if R.id == "av":
            a = lo
            k = 0
            while a < hi:
                x, z = R.p(a, 0.0)
                if not occupied(x, z, cuts):
                    add("lamp_avenue", x, z, 0.0)
                    tree("median_shrub", *R.p(a + 8, RNG.uniform(-1.2, 1.2)))
                    tree("median_shrub", *R.p(a + 18, RNG.uniform(-1.2, 1.2)))
                for s in (1, -1):
                    # trees both sides of the aryk; lamps on sidewalk edge
                    for o in (R.cw + 0.6, R.cw + R.strip - 0.6):
                        tx, tz = R.p(a + RNG.uniform(-1.5, 1.5) + (4 if o > R.cw + 1 else 0), s * o)
                        if not occupied(tx, tz, cuts) and RNG.random() > 0.06:
                            tree("avenue_tree", tx, tz)
                    if k % 2 == 0:
                        lx, lz = R.p(a + 6, s * (R.cw + R.strip + 0.4))
                        if not occupied(lx, lz, cuts):
                            add("lamp_street", lx, lz, -math.pi / 2 if s > 0 else math.pi / 2)
                    if k % 3 == 1:
                        bx, bz = R.p(a + 10, s * (R.half - 0.6))
                        if not occupied(bx, bz, cuts):
                            add("bench_street", bx, bz, -math.pi / 2 if s < 0 else math.pi / 2)
                            ux, uz = R.p(a + 11.6, s * (R.half - 0.5))
                            add("urn", ux, uz, 0.0)
                a += 30.0
                k += 1
            # low fence along the median (keeps pedestrians at crossings)
            for s in (1, -1):
                o = s * (R.median - 0.35)
                segs = st.rects_sub([R.rect(min(o, o + 0.01), max(o, o + 0.01))], [c for c in no_go] + [b for b in inter_boxes])
                for q in segs:
                    C.J(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))["lines"].append(["fence_median", round(q[0], 2), round(q[1], 2), round(q[0], 2), round(q[3], 2)])
        elif R.lanes == 0:
            a = lo + 10
            while a < hi:
                x, z = R.p(a, R.cw + 0.5)
                if not occupied(x, z, inter_boxes):
                    add("power_pole", x, z, 0.0 if R.axis == "z" else math.pi / 2)
                a += 32.0
        else:
            a = lo
            k = 0
            while a < hi:
                for s in (1, -1):
                    if R.strip > 0:
                        tx, tz = R.p(a + RNG.uniform(-1.2, 1.2), s * (R.cw + R.strip / 2))
                    else:  # tree pits on the commercial street sidewalk
                        tx, tz = R.p(a + RNG.uniform(-0.4, 0.4), s * (R.cw + 1.3))
                    if not occupied(tx, tz, cuts) and RNG.random() > 0.08:
                        tree("street_tree", tx, tz)
                        if R.strip == 0:
                            add("tree_grate", tx, tz, 0.0)
                    if k % 3 == 1:
                        lx, lz = R.p(a + 4.5, s * (R.cw + (R.strip / 2 if R.strip else 0.6)))
                        if not occupied(lx, lz, cuts):
                            add("lamp_street", lx, lz, (-math.pi / 2 if s > 0 else math.pi / 2) if R.axis == "z" else (math.pi if s > 0 else 0.0))
                    if R.id == "com" and k % 4 == 2:
                        bx, bz = R.p(a + 4.5, s * (R.cw + 1.3))
                        if not occupied(bx, bz, cuts):
                            add("bench_street", bx, bz, (math.pi if s > 0 else 0.0))
                            add("urn", *R.p(a + 6.3, s * (R.cw + 1.3)), 0.0)
                    if R.id == "com" and k % 7 == 3:
                        add("bike_rack", *R.p(a + 2, s * (R.half - 1.0)), 0.0)
                a += 9.0 if R.strip == 0 else 8.5
                k += 1
    # traffic lights at signalized intersections, crossing signs everywhere
    signal = {("av", "com"), ("av", "a"), ("av", "c"), ("d", "com")}
    for (road, along, sgn) in net.signal_points:
        pair = None
        for (za, xb) in net.intersections:
            if road in (za, xb):
                other = xb if road is za else za
                if abs((other.c) - (along - sgn * (other.cw + 4))) < other.cw + 20:
                    pair = (za.id, xb.id)
        for s in (1, -1):
            x, z = road.p(along, s * (road.cw + 0.7))
            face = {("z", 1): -math.pi / 2, ("z", -1): math.pi / 2, ("x", 1): math.pi, ("x", -1): 0.0}[(road.axis, s)]
            if pair in signal or (pair and (pair[1], pair[0]) in signal):
                add("traffic_light_ped", *road.p(along + 2.6, s * (road.cw + 0.5)), face)
                if (road.axis == "z" and s == sgn) or (road.axis == "x" and s == -sgn):
                    add("traffic_light", *road.p(along + sgn * 3.5, s * (road.cw + 0.6)), face)
            else:
                add("sign_crossing", x, z, face)
    for (road, along) in [(roads[i], a) for (i, a) in lay.MIDBLOCK]:
        for s in (1, -1):
            face = {("z", 1): -math.pi / 2, ("z", -1): math.pi / 2, ("x", 1): math.pi, ("x", -1): 0.0}[(road.axis, s)]
            add("traffic_light_ped", *road.p(along + 2.6, s * (road.cw + 0.5)), face)
            add("sign_crossing", *road.p(along - 2.6, s * (road.cw + 0.6)), face)
    # paint added for bus zig-zags after emit -> emit those now
    for (r, col) in net.paint[-200:]:
        if col != "yellow":
            continue
        for q in st.split_grid(r):
            b = C.B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
            b.ao_ground = False
            b.quad("road_paint", (q[0], 0.013, q[3]), (q[2], 0.013, q[3]), (q[2], 0.013, q[1]), (q[0], 0.013, q[1]), tint=(0.95, 0.78, 0.15))
            b.ao_ground = True


def plan_png(P, net, lawns):
    from PIL import Image, ImageDraw
    S = 2.0
    W = int(600 * S)
    im = Image.new("RGB", (W, W), (225, 222, 210))
    d = ImageDraw.Draw(im)
    def R(r):
        return [(r[0] + 300) * S, (r[1] + 300) * S, (r[2] + 300) * S, (r[3] + 300) * S]
    for (k, r) in lawns:
        d.rectangle(R(r), fill=(150, 190, 120))
    col = {"asphalt": (70, 70, 72), "sidewalk": (190, 185, 175), "median": (130, 175, 110)}
    for (kind, r, y) in net.surfaces:
        d.rectangle(R(r), fill=col.get(kind, (140, 180, 120)))
    for (r, m, b) in P.ground:
        c = {"plaza": (205, 200, 190), "plaza_reserved": (255, 210, 120), "asphalt_yard": (110, 110, 112), "sport": (160, 90, 80),
             "gravel": (200, 190, 160), "cobble": (190, 180, 170), "soil_garden": (120, 90, 60), "flowerbed": (200, 80, 120)}.get(m)
        if c:
            d.rectangle(R(r), fill=c)
    kc = {"panel5": (230, 210, 170), "panel9": (220, 190, 150), "brick5": (200, 140, 100), "tower": (240, 230, 200),
          "school": (250, 230, 120), "hospital": (240, 250, 255), "house": (230, 200, 180), "shop": (120, 160, 220),
          "office": (180, 180, 200), "admin": (200, 200, 220), "hotel": (220, 170, 200), "garage": (150, 150, 150)}
    for B in P.buildings:
        d.rectangle(R(B["rect"]), fill=kc.get(B["kind"], (200, 200, 200)), outline=(40, 40, 40))
    for (cat, x, z) in P.trees:
        rr = 1.5 if cat in ("rose", "flowers", "shrub") else 3.0
        d.ellipse([(x + 300 - rr) * S, (z + 300 - rr) * S, (x + 300 + rr) * S, (z + 300 + rr) * S], fill=(60, 120, 50))
    for (n, r, note) in P.reserved:
        d.rectangle(R(r), outline=(230, 120, 0), width=4)
        d.text(((r[0] + 302) * S, (r[1] + 302) * S), n, fill=(120, 60, 0))
    os.makedirs(os.path.join(GAME, "docs/maps"), exist_ok=True)
    im.save(os.path.join(GAME, "docs/maps/city_plan.png"))


if __name__ == "__main__":
    main()
