"""Traffic data for stage 6 (NPC cars / pedestrians) - DATA ONLY, no agents yet.

Built from the same road network as the geometry (layout.ROADS / streets.Network), so lanes,
stop lines and crossings always match the painted markings. Right-hand traffic.

data/city/traffic.json:
  lanes       directed lane segments between junctions: id, road, dir (+1/-1 along the road axis),
              lane index (0 = next to the centre line / median), width, speed limit (km/h),
              points [[x, y, z], ...] on the relief, from / to node ids
  nodes       junction ids: centre, type (signal / priority / edge / T), roads
  connectors  junction movements: from lane -> to lane, turn (straight / right / left), points
              (quadratic curve through the junction), light group or rule (yield)
  stop_lines  per incoming lane end: position, heading, light group or rule
  lights      groups: id, node, members (incoming lanes), positions of the signal heads
  phases      per signalised node: [{groups, green, yellow, all_red}] (seconds)
  crossings   pedestrian crosswalks: rect, axis, ped light group (if signalised)
  parking     spots: x, y, z, yaw, kind (yard stall / street bay), length, width
  bus_stops   x, y, z, yaw, lane id, distance along the lane
  edges       city-edge entry/exit lanes (continue to the country roads)
"""
import json, math
from relief import city_relief

SIGNAL = {("av", "com"), ("av", "a"), ("av", "c"), ("d", "com")}
SPEED = {"av": 60, "com": 40, "a": 50, "c": 50, "d": 50, "e": 50, "l1": 20, "l2": 20}


def _y(x, z):
    return round(float(city_relief(x, z)), 3)


def _pt(R, along, off):
    x, z = R.p(along, off)
    return [round(x, 2), _y(x, z), round(z, 2)]


def lane_offsets(R):
    """[(dir, lane, offset, width)] right-hand traffic"""
    out = []
    for d in (1, -1):
        # right side of travel: axis z moving +z (south) -> right is -x; axis x moving +x (east) -> right is +z
        side = (-d) if R.axis == "z" else d
        if R.lanes == 0:
            out.append((d, 0, side * R.carriage / 2.0, R.carriage))
            continue
        w = R.carriage / R.lanes
        for k in range(R.lanes):
            out.append((d, k, side * (R.median + (k + 0.5) * w), w))
    return out


def _stop_dist(road, other):
    """distance from the junction centre (other road axis) to the stop line on `road`"""
    r = min(road.corner_r, other.corner_r, road.strip + road.sidewalk, other.strip + other.sidewalk)
    return other.cw + r + 0.6 + 4.0 + 1.0        # behind the crosswalk (see Network.build)


def _bezier(p0, c, p1, n=8):
    pts = []
    for i in range(n + 1):
        t = i / n
        a = (1 - t) ** 2; b = 2 * (1 - t) * t; e = t * t
        x = a * p0[0] + b * c[0] + e * p1[0]
        z = a * p0[1] + b * c[1] + e * p1[1]
        pts.append([round(x, 2), _y(x, z), round(z, 2)])
    return pts


def build(roads, net, parking_rects, props, buildings):
    R = {r.id: r for r in roads}
    nodes = {}
    on_road = {r.id: [] for r in roads}          # (along, node_id, other road)
    # junctions incl. T-junctions where a road ends inside the other carriageway (l1 at the avenue)
    inter = []
    for i, a in enumerate(roads):
        for b in roads[i + 1:]:
            if a.axis == b.axis:
                continue
            za, xb = (a, b) if a.axis == "z" else (b, a)
            if za.a0 - xb.cw - 1e-6 <= xb.c <= za.a1 + xb.cw + 1e-6 and xb.a0 - za.cw - 1e-6 <= za.c <= xb.a1 + za.cw + 1e-6:
                inter.append((za, xb))
    for n, (za, xb) in enumerate(inter):
        nid = "J%02d" % n
        pair = (za.id, xb.id)
        sig = pair in SIGNAL or (pair[1], pair[0]) in SIGNAL
        t_junction = not (za.a0 < xb.c - 1 and za.a1 > xb.c + 1 and xb.a0 < za.c - 1 and xb.a1 > za.c + 1)
        nodes[nid] = {"id": nid, "x": za.c, "y": _y(za.c, xb.c), "z": xb.c, "roads": [za.id, xb.id],
                      "type": "signal" if sig else "priority", "t_junction": t_junction}
        on_road[za.id].append((xb.c, nid, xb))
        on_road[xb.id].append((za.c, nid, za))
    lanes = []
    lane_index = {}                               # (road, dir, lane, seg) -> lane id
    seg_nodes = {}                                # road -> sorted list of (along, nid, other)
    edges = []
    for road in roads:
        js = sorted(on_road[road.id], key=lambda t: t[0])
        seg_nodes[road.id] = js
        # stations: road start, each junction, road end
        stations = [(road.a0, None, None)] + js + [(road.a1, None, None)]
        for (d, k, off, w) in lane_offsets(road):
            for si in range(len(stations) - 1):
                a, na, oa = stations[si]
                b, nb, ob = stations[si + 1]
                s0 = a + (_stop_dist(road, oa) if oa is not None else 0.0)
                s1 = b - (_stop_dist(road, ob) if ob is not None else 0.0)
                if s1 - s0 < 3.0:
                    continue
                # T junction where this road ends: no segment beyond the junction
                if (na is None and abs(a - road.a0) < 1e-6 and road.a0 > -299.0) or (nb is None and road.a1 < 299.0 and abs(b - road.a1) < 1e-6):
                    continue
                n_pts = max(2, int((s1 - s0) / 10.0) + 1)
                al = [s0 + (s1 - s0) * i / (n_pts - 1) for i in range(n_pts)]
                if d < 0:
                    al = al[::-1]
                lid = "%s_%s%d_l%d_s%d" % (road.id, "p" if d > 0 else "n", 1, k, si)
                from_n = na if d > 0 else nb
                to_n = nb if d > 0 else na
                ln = {"id": lid, "road": road.id, "name": road.name, "dir": d, "lane": k, "width": round(w, 2),
                      "speed_kmh": SPEED.get(road.id, 50), "points": [_pt(road, s, off) for s in al],
                      "from": from_n or "edge", "to": to_n or "edge", "length": round(s1 - s0, 2)}
                lanes.append(ln)
                lane_index[(road.id, d, k, si)] = lid
                if (from_n is None) or (to_n is None):
                    edges.append({"lane": lid, "kind": "entry" if from_n is None else "exit"})
    by_id = {l["id"]: l for l in lanes}
    # lane changes: neighbours in the same direction / segment (left = towards the centre line)
    for l in lanes:
        for (key, dk) in (("left", -1), ("right", 1)):
            nb = [o for o in lanes if o["road"] == l["road"] and o["dir"] == l["dir"] and o["from"] == l["from"]
                  and o["to"] == l["to"] and o["lane"] == l["lane"] + dk]
            l[key] = nb[0]["id"] if nb else None

    def incoming(road, d, nid):
        """lanes of `road` in direction d that END at node nid"""
        return [l for l in lanes if l["road"] == road and l["dir"] == d and l["to"] == nid]

    def outgoing(road, d, nid):
        return [l for l in lanes if l["road"] == road and l["dir"] == d and l["from"] == nid]

    def heading(road, d):
        return (0.0, float(d)) if road.axis == "z" else (float(d), 0.0)

    def right_of(v):
        # x east, z south: right of heading (vx, vz) is (-vz, vx)
        return (-v[1], v[0])

    connectors = []
    stop_lines = []
    lights = []
    phases = {}
    for nid, node in nodes.items():
        groups = {}
        for rid in node["roads"]:
            road = R[rid]
            other = R[[o for o in node["roads"] if o != rid][0]]
            for d in (1, -1):
                ins = incoming(rid, d, nid)
                if not ins:
                    continue
                v = heading(road, d)
                gid = "%s_%s" % (nid, road.axis) if node["type"] == "signal" else None
                minor = node["type"] != "signal" and (road.lanes < other.lanes or (road.lanes == other.lanes and road.cw < other.cw))
                rule = "signal" if gid else ("yield" if minor else "priority")
                for l in ins:
                    p = l["points"][-1]
                    stop_lines.append({"lane": l["id"], "x": p[0], "y": p[1], "z": p[2], "heading": [v[0], v[1]],
                                       "rule": rule, "group": gid})
                    if gid:
                        groups.setdefault(gid, []).append(l["id"])
                    nl = max(1, road.lanes)
                    movements = []
                    straight = [o for o in outgoing(rid, d, nid) if o["lane"] == l["lane"]]
                    if straight:
                        movements.append(("straight", straight[0]))
                    rv = right_of(v)
                    od_r = int(round(rv[0] if other.axis == "x" else rv[1]))
                    od_l = -od_r
                    if l["lane"] == nl - 1 or road.lanes == 0:
                        outs = [o for o in outgoing(other.id, od_r, nid)]
                        if outs:
                            movements.append(("right", max(outs, key=lambda o: o["lane"])))
                    if l["lane"] == 0:
                        outs = [o for o in outgoing(other.id, od_l, nid)]
                        if outs:
                            movements.append(("left", min(outs, key=lambda o: o["lane"])))
                    for (turn, o) in movements:
                        a = l["points"][-1]; b = o["points"][0]
                        if turn == "straight":
                            c = ((a[0] + b[0]) / 2, (a[2] + b[2]) / 2)
                        else:
                            # control point: intersection of the two lane lines
                            c = (b[0], a[2]) if road.axis == "z" else (a[0], b[2])
                            if road.axis == "z":
                                c = (a[0], b[2])
                            else:
                                c = (b[0], a[2])
                        connectors.append({"id": "%s>%s" % (l["id"], o["id"]), "node": nid, "from": l["id"], "to": o["id"],
                                           "turn": turn, "group": gid, "rule": rule if turn != "left" or gid is None else "signal_yield_oncoming",
                                           "points": _bezier((a[0], a[2]), c, (b[0], b[2]))})
        for gid, mem in groups.items():
            heads = []
            for lid in mem:
                p = by_id[lid]["points"][-1]
                heads.append([p[0], p[1] + 4.5, p[2]])
            lights.append({"id": gid, "node": nid, "members": sorted(mem), "heads": heads})
        if groups:
            gz = [g for g in groups if g.endswith("_z")]
            gx = [g for g in groups if g.endswith("_x")]
            phases[nid] = [{"groups": gz, "green": 28, "yellow": 3, "all_red": 2},
                           {"groups": gx, "green": 22, "yellow": 3, "all_red": 2}]
    # crossings (+ ped light group when at a signalised junction or a mid-block signal)
    crossings = []
    for (rect, axis) in net.crosswalks:
        cx, cz = (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
        near = None
        for nid, node in nodes.items():
            if node["type"] == "signal" and abs(node["x"] - cx) < 40 and abs(node["z"] - cz) < 40:
                near = nid
        crossings.append({"rect": [round(v, 2) for v in rect], "y": _y(cx, cz), "axis": axis,
                          "ped_group": ("%s_ped" % near) if near else None})
    # parking spots: yard stalls (painted, 2.6 x 5 m) + parallel bays on the commercial street
    parking = []
    for (r, axis) in parking_rects:
        x0, z0, x1, z1 = r
        if (x1 - x0) >= (z1 - z0):
            x = x0 + 0.5
            while x + 2.6 <= x1 - 0.4:
                parking.append(_spot(x + 1.3, z0 + 2.5, math.pi, "yard"))      # nose to the edge, facing -z
                if z1 - z0 > 12:
                    parking.append(_spot(x + 1.3, z1 - 2.5, 0.0, "yard"))
                x += 2.6
        else:
            z = z0 + 0.5
            while z + 2.6 <= z1 - 0.4:
                parking.append(_spot(x0 + 2.5, z + 1.3, -math.pi / 2, "yard"))
                if x1 - x0 > 12:
                    parking.append(_spot(x1 - 2.5, z + 1.3, math.pi / 2, "yard"))
                z += 2.6
    blocked = [c["rect"] for c in crossings]
    for road in roads:
        if road.parking <= 0:
            continue
        for d in (1, -1):
            side = (-d) if road.axis == "z" else d
            off = side * (road.median + road.carriage + road.parking / 2)
            js = [a for (a, _, _) in seg_nodes[road.id]]
            s = road.a0 + 8.0
            while s + 6.0 < road.a1 - 8.0:
                mid = s + 3.0
                if all(abs(mid - a) > 22.0 for a in js):
                    x, z = road.p(mid, off)
                    if not any(b[0] - 1 <= x <= b[2] + 1 and b[1] - 1 <= z <= b[3] + 1 for b in blocked):
                        yaw = (0.0 if d < 0 else math.pi) if road.axis == "z" else (-math.pi / 2 if d > 0 else math.pi / 2)
                        sp = _spot(x, z, yaw, "street")
                        sp["length"] = 5.8; sp["width"] = 2.3
                        parking.append(sp)
                s += 6.0
    # bus stops from the placed shelters: nearest outermost lane
    bus = []
    for p in props:
        if p[0] != "bus_stop":
            continue
        x, z = p[1], p[3]
        best = None
        for l in lanes:
            road = R[l["road"]]
            if l["lane"] != max(0, road.lanes - 1):
                continue
            for i, q in enumerate(l["points"]):
                dd = math.hypot(q[0] - x, q[2] - z)
                if best is None or dd < best[0]:
                    best = (dd, l["id"], i)
        if best and best[0] < 15.0:
            l = by_id[best[1]]
            s = sum(math.hypot(l["points"][j + 1][0] - l["points"][j][0], l["points"][j + 1][2] - l["points"][j][2]) for j in range(best[2]))
            bus.append({"x": x, "y": _y(x, z), "z": z, "yaw": p[4], "lane": best[1], "s": round(s, 1)})
    return {"version": 1, "right_hand": True, "units": "m, rad, km/h",
            "nodes": list(nodes.values()), "lanes": lanes, "connectors": connectors, "stop_lines": stop_lines,
            "lights": lights, "phases": phases, "crossings": crossings, "parking": parking, "bus_stops": bus,
            "edges": edges}


def _spot(x, z, yaw, kind):
    return {"x": round(x, 2), "y": _y(x, z), "z": round(z, 2), "yaw": round(yaw, 4), "kind": kind, "length": 5.0, "width": 2.6}


def check(T, carriage_rects, building_rects, fillets=()):
    """sanity checks: graph strongly connected (enough), points on carriageways, spots clear"""
    out = []
    succ = {}
    for c in T["connectors"]:
        succ.setdefault(c["from"], []).append(c["to"])
    for l in T["lanes"]:
        for k in ("left", "right"):
            if l.get(k):
                succ.setdefault(l["id"], []).append(l[k])
    ids = [l["id"] for l in T["lanes"]]
    # reachability from every entry edge
    def reach(s):
        seen = {s}; st = [s]
        while st:
            u = st.pop()
            for v in succ.get(u, []):
                if v not in seen:
                    seen.add(v); st.append(v)
        return seen
    entries = [e["lane"] for e in T["edges"] if e["kind"] == "entry"]
    inner = set(ids) - set(entries)
    worst = min((len(reach(e) & inner) for e in entries), default=0)
    out.append(("from every entry all inner lanes are reachable (worst %d / %d)" % (worst, len(inner)), worst == len(inner)))
    exits = {e["lane"] for e in T["edges"] if e["kind"] == "exit"}
    ok_exit = all(reach(e) & exits for e in entries)
    out.append(("every entry can leave the city again (%d entries, %d exits)" % (len(entries), len(exits)), ok_exit))
    dead = [l["id"] for l in T["lanes"] if l["to"] != "edge" and not succ.get(l["id"])]
    out.append(("no dead-end lanes inside the city %s" % dead[:5], not dead))
    # rounded junction corners are asphalt too (curb fillets)
    carriage_rects = list(carriage_rects) + [(min(Kx, Kx + sx * r), min(Kz, Kz + sz * r), max(Kx, Kx + sx * r), max(Kz, Kz + sz * r))
                                             for (Kx, Kz, sx, sz, r) in fillets]

    def on_carr(x, z):
        return any(r[0] - 0.6 <= x <= r[2] + 0.6 and r[1] - 0.6 <= z <= r[3] + 0.6 for r in carriage_rects)   # 0.6: square T corner without fillet
    bad = [l["id"] for l in T["lanes"] if not all(on_carr(p[0], p[2]) for p in l["points"])]
    bad += [c["id"] for c in T["connectors"] if not all(on_carr(p[0], p[2]) for p in c["points"])]
    out.append(("all lane / connector points on the carriageways (%d off)" % len(bad), not bad))
    sp_bad = [s for s in T["parking"] if any(b[0] <= s["x"] <= b[2] and b[1] <= s["z"] <= b[3] for b in building_rects)]
    out.append(("parking spots clear of buildings: %d spots, %d inside buildings" % (len(T["parking"]), len(sp_bad)), not sp_bad))
    sig_nodes = [n for n in T["nodes"] if n["type"] == "signal"]
    out.append(("signalised junctions have 2 phases and lights: %d" % len(sig_nodes), all(len(T["phases"].get(n["id"], [])) == 2 for n in sig_nodes) and len(sig_nodes) >= 4))
    out.append(("bus stops attached to lanes: %d" % len(T["bus_stops"]), len(T["bus_stops"]) >= 4))
    return out


def plan_png(T, path):
    from PIL import Image, ImageDraw
    S = 2.0
    im = Image.new("RGB", (int(600 * S), int(600 * S)), (240, 240, 236))
    d = ImageDraw.Draw(im)
    P = lambda x, z: ((x + 300) * S, (z + 300) * S)
    for s in T["parking"]:
        x, z = P(s["x"], s["z"])
        d.rectangle([x - 2, z - 2, x + 2, z + 2], fill=(120, 160, 220) if s["kind"] == "yard" else (60, 90, 200))
    for c in T["crossings"]:
        r = c["rect"]
        d.rectangle([*P(r[0], r[1]), *P(r[2], r[3])], fill=(250, 250, 250), outline=(120, 120, 120))
    for l in T["lanes"]:
        col = (200, 40, 40) if l["dir"] > 0 else (40, 120, 40)
        d.line([P(p[0], p[2]) for p in l["points"]], fill=col, width=2)
        a = l["points"][-1]
        d.ellipse([P(a[0], a[2])[0] - 2, P(a[0], a[2])[1] - 2, P(a[0], a[2])[0] + 2, P(a[0], a[2])[1] + 2], fill=col)
    for c in T["connectors"]:
        col = {"straight": (150, 150, 150), "right": (230, 150, 30), "left": (130, 60, 200)}[c["turn"]]
        d.line([P(p[0], p[2]) for p in c["points"]], fill=col, width=1)
    for s in T["stop_lines"]:
        x, z = P(s["x"], s["z"])
        col = (255, 0, 0) if s["rule"] == "signal" else ((255, 200, 0) if s["rule"] == "yield" else (0, 160, 0))
        d.rectangle([x - 3, z - 3, x + 3, z + 3], outline=col, width=2)
    for b in T["bus_stops"]:
        x, z = P(b["x"], b["z"])
        d.ellipse([x - 5, z - 5, x + 5, z + 5], outline=(0, 120, 200), width=3)
    d.text((10, 10), "lanes red(+)/green(-), turns grey/orange(right)/purple(left), stop lines: red signal, yellow yield, green priority; parking blue; bus stops circles", fill=(0, 0, 0))
    im.save(path)
