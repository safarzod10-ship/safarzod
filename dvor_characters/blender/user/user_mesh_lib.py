from __future__ import annotations

import heapq
import math

import bmesh
import bpy
from mathutils import Vector

ARM = ("upper_arm", "forearm", "hand")
BODY = ("pelvis", "spine", "chest", "thigh", "shin")


def V(*a):
    return Vector(a[0] if len(a) == 1 else a)


def import_user_mesh(path: str, scale: float, name: str):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    assert len(meshes) == 1, f"expected one mesh in {path}, got {len(meshes)}"
    src = meshes[0]
    me = src.data.copy()
    me.transform(src.matrix_world)
    me.transform(__import__("mathutils").Matrix.Scale(scale, 4))
    obj = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(obj)
    for o in list(bpy.context.scene.objects):
        if o is not obj:
            bpy.data.objects.remove(o, do_unlink=True)
    for o in list(bpy.data.objects):
        if o.type == "EMPTY":
            bpy.data.objects.remove(o, do_unlink=True)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5 * scale)
    n1 = len(bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj, {"verts_imported": n0, "verts_welded": n1}


def build_joints(J: dict, scale: float) -> dict:
    s = lambda k: V(J[k]) * scale
    j = {
        "root": (V(0, 0, 0), V(0, 0, 0.12)),
        "pelvis": (s("pelvis"), s("spine")),
        "spine": (s("spine"), s("chest")),
        "chest": (s("chest"), s("neck")),
        "neck": (s("neck"), s("head")),
        "head": (s("head"), s("head_end")),
    }
    for side in ("L", "R"):
        j[f"upper_arm.{side}"] = (s(f"shoulder_{side}"), s(f"elbow_{side}"))
        j[f"forearm.{side}"] = (s(f"elbow_{side}"), s(f"wrist_{side}"))
        j[f"hand.{side}"] = (s(f"wrist_{side}"), s(f"hand_end_{side}"))
        j[f"thigh.{side}"] = (s(f"hip_{side}"), s(f"knee_{side}"))
        j[f"shin.{side}"] = (s(f"knee_{side}"), s(f"ankle_{side}"))
        j[f"foot.{side}"] = (s(f"ankle_{side}"), s(f"toe_{side}"))
    return j


def _seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (p - (a + ab * t)).length


def segment(bm, joints: dict, iters: int = 2) -> dict:
    bones = [b for b in joints if b != "root"]
    radius = {b: 1.0 for b in bones}
    label = {}
    for _ in range(iters + 1):
        dists = {b: [] for b in bones}
        for v in bm.verts:
            best, bd = None, 1e9
            for b in bones:
                d = _seg_dist(v.co, joints[b][0], joints[b][1])
                nd = d / radius[b]
                if nd < bd:
                    best, bd = b, nd
            label[v] = best
            dists[best].append(_seg_dist(v.co, joints[best][0], joints[best][1]))
        for b in bones:
            if dists[b]:
                ds = sorted(dists[b])
                radius[b] = max(0.02, ds[len(ds) // 2])
    return label, radius


def _group(b):
    return b.split(".")[0]


def cut_arms_free(obj, joints: dict, shoulder_keep: float):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv.active
    label, radius = segment(bm, joints)
    pre_boundary = {e for e in bm.edges if e.is_boundary}
    kill = []
    for f in bm.faces:
        groups = {_group(label[v]) for v in f.verts}
        sides = {label[v].split(".")[1] for v in f.verts if "." in label[v] and _group(label[v]) in ARM}
        if not (groups & set(ARM)) or not (groups & set(BODY)):
            continue
        side = next(iter(sides)) if sides else "L"
        sh = joints[f"upper_arm.{side}"][0]
        if all((v.co - sh).length < shoulder_keep for v in f.verts):
            continue
        kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
    loose_e = [e for e in bm.edges if not e.link_faces]
    bmesh.ops.delete(bm, geom=loose_e, context="EDGES")
    loose_v = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose_v, context="VERTS")
    new_boundary = [e for e in bm.edges if e.is_boundary and e not in pre_boundary]
    before = set(bm.faces)
    bmesh.ops.holes_fill(bm, edges=new_boundary, sides=0)
    filled = [f for f in bm.faces if f not in before]
    tri = bmesh.ops.triangulate(bm, faces=filled, quad_method="BEAUTY", ngon_method="BEAUTY")
    patch = tri["faces"]
    for f in patch:
        f.smooth = True
        for loop in f.loops:
            other = [l for l in loop.vert.link_loops if l.face not in patch]
            if other:
                loop[uvl].uv = other[0][uvl].uv.copy()
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=patch)
    bm.to_mesh(obj.data)
    bm.free()
    return {"faces_deleted": len(kill), "patch_faces": len(patch),
            "bone_radius_m": {k: round(v, 3) for k, v in radius.items()}}


def arm_paths(obj, joints: dict) -> dict:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    label, _ = segment(bm, joints)
    out = {}
    for side in ("L", "R"):
        tip = joints[f"hand.{side}"][1]
        hipj = joints[f"thigh.{side}"][0]
        hand = min((v for v in bm.verts if label[v] == f"hand.{side}"), key=lambda v: (v.co - tip).length)
        cand = [v for v in bm.verts if label[v] == f"thigh.{side}" and abs(v.co.z - hipj.z) < 0.08]
        sgn = 1 if side == "L" else -1
        hip = max(cand, key=lambda v: v.co.x * sgn)
        dist, prev, pq, done = {hand: 0.0}, {}, [(0.0, 0, hand)], set()
        cnt = 1
        while pq:
            d, _, v = heapq.heappop(pq)
            if v in done:
                continue
            done.add(v)
            if v is hip:
                break
            for e in v.link_edges:
                u = e.other_vert(v)
                nd = d + e.calc_length()
                if nd < dist.get(u, 1e9):
                    dist[u] = nd
                    prev[u] = v
                    cnt += 1
                    heapq.heappush(pq, (nd, cnt, u))
        if hip not in prev:
            out[side] = {"connected": False}
            continue
        path = [hip]
        while path[-1] is not hand:
            path.append(prev[path[-1]])
        out[side] = {"connected": True, "path_len_m": round(dist[hip], 3),
                     "path_max_z_m": round(max(v.co.z for v in path), 3),
                     "shoulder_z_m": round(joints[f"upper_arm.{side}"][0].z, 3)}
    bm.free()
    return out


def _components_connected(bm, a, b, removed: set) -> bool:
    seen, st = {a}, [a]
    while st:
        v = st.pop()
        if v is b:
            return True
        for e in v.link_edges:
            u = e.other_vert(v)
            if u not in seen and u not in removed:
                seen.add(u)
                st.append(u)
    return False


def arm_fused(obj, joints: dict, shoulder_r: float = 0.10) -> dict:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    out = {}
    torso_c = (joints["spine"][0] + joints["spine"][1]) / 2
    torso = min(bm.verts, key=lambda v: (v.co - torso_c).length)
    for side in ("L", "R"):
        sh = joints[f"upper_arm.{side}"][0]
        removed = {v for v in bm.verts if (v.co - sh).length < shoulder_r}
        hand = min((v for v in bm.verts if v not in removed),
                   key=lambda v: (v.co - joints[f"hand.{side}"][1]).length)
        out[side] = _components_connected(bm, hand, torso, removed)
    bm.free()
    return out


def cut_plane_between(obj, joints: dict, side: str, radius: float, dz: float, bins: int = 24,
                      offset: float = 0.0):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uvl = bm.loops.layers.uv.active
    H = (joints[f"hand.{side}"][0] + joints[f"hand.{side}"][1]) / 2
    P = joints[f"thigh.{side}"][0].copy()
    P.z = H.z
    n = H - P
    n.z = 0
    L = n.length
    n.normalize()

    def inside(co):
        s = (co - P).dot(n)
        perp = (co - P) - n * s
        perp_h = Vector((perp.x, perp.y, 0)).length
        return -0.02 <= s <= L and perp_h < radius and abs(co.z - H.z) < dz

    region = [v for v in bm.verts if inside(v.co)]
    if not region:
        bm.free()
        return {"side": side, "error": "empty region"}
    ss = [(v.co - P).dot(n) for v in region]
    lo, hi = 0.0, L
    hist = [0] * bins
    for s in ss:
        k = int((s - lo) / (hi - lo) * bins)
        if 0 <= k < bins:
            hist[k] += 1
    a, b = int(bins * 0.2), int(bins * 0.8)
    kmin = min(range(a, b), key=lambda k: (hist[k], abs(k - bins / 2)))
    s0 = lo + (kmin + 0.5) / bins * (hi - lo) + offset
    rset = set(region)
    kill = []
    for f in bm.faces:
        if not all(v in rset for v in f.verts) and not any(v in rset for v in f.verts):
            continue
        sv = [(v.co - P).dot(n) - s0 for v in f.verts]
        if min(sv) < 0 < max(sv) and sum(v in rset for v in f.verts) >= 2:
            kill.append(f)
    pre = {e for e in bm.edges if e.is_boundary}
    bmesh.ops.delete(bm, geom=kill, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[e for e in bm.edges if not e.link_faces], context="EDGES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    newb = [e for e in bm.edges if e.is_boundary and e not in pre]
    before = set(bm.faces)
    bmesh.ops.holes_fill(bm, edges=newb, sides=0)
    filled = [f for f in bm.faces if f not in before]
    patch = bmesh.ops.triangulate(bm, faces=filled, quad_method="BEAUTY", ngon_method="BEAUTY")["faces"]
    pset = set(patch)
    for f in patch:
        f.smooth = True
        for loop in f.loops:
            other = [l for l in loop.vert.link_loops if l.face not in pset]
            if other:
                loop[uvl].uv = other[0][uvl].uv.copy()
    bmesh.ops.recalc_face_normals(bm, faces=patch)
    bm.to_mesh(obj.data)
    bm.free()
    return {"side": side, "plane_s_m": round(s0, 3), "hand_hip_dist_m": round(L, 3),
            "hist": hist, "faces_deleted": len(kill), "patch_faces": len(patch)}


def _poly_dist(p, pts):
    return min(_seg_dist(p, pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def cut_min_bridge(obj, joints: dict, side: str, shoulder_r: float, core_r: float = 0.06,
                   dry_run: bool = False):
    from collections import deque
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    uvl = bm.loops.layers.uv.active
    sgn = 1 if side == "L" else -1
    sh = joints[f"upper_arm.{side}"][0]
    arm = [joints[f"upper_arm.{side}"][0], joints[f"forearm.{side}"][0],
           joints[f"hand.{side}"][0], joints[f"hand.{side}"][1]]
    removed = {v.index for v in bm.verts if (v.co - sh).length < shoulder_r}
    axis_x = joints["pelvis"][0].x
    src = set()
    a, b = joints[f"hand.{side}"]
    hc = (a + b) / 2
    for v in bm.verts:
        if v.index in removed:
            continue
        if _seg_dist(v.co, a, b) < core_r and (v.co.x - hc.x) * sgn > 0:
            src.add(v.index)
    sink = set()
    for v in bm.verts:
        if v.index in removed or v.index in src:
            continue
        torso_axis = [joints["pelvis"][0], joints["chest"][1]]
        opposite_hip = (v.co.x - axis_x) * sgn < -0.03 and v.co.z > joints[f"shin.{side}"][0].z
        if _seg_dist(v.co, *torso_axis) < 0.10 or opposite_hip:
            sink.add(v.index)
    adj = {}
    for e in bm.edges:
        a, b = e.verts[0].index, e.verts[1].index
        if a in removed or b in removed:
            continue
        adj.setdefault(a, set()).add(b)
        adj.setdefault(b, set()).add(a)
    S, T = -1, -2
    cap = {}
    def add(u, w, c):
        cap[(u, w)] = cap.get((u, w), 0) + c
        adj.setdefault(u, set()).add(w)
        adj.setdefault(w, set()).add(u)
    for (a, b) in [(e.verts[0].index, e.verts[1].index) for e in bm.edges]:
        if a in removed or b in removed:
            continue
        add(a, b, 1); add(b, a, 1)
    for s in src:
        add(S, s, 10 ** 6)
    for t in sink:
        add(t, T, 10 ** 6)
    flow = 0
    while True:
        par = {S: None}
        q = deque([S])
        while q and T not in par:
            u = q.popleft()
            for w in adj.get(u, ()):
                if w not in par and cap.get((u, w), 0) > 0:
                    par[w] = u
                    q.append(w)
        if T not in par:
            break
        w = T
        while par[w] is not None:
            u = par[w]
            cap[(u, w)] -= 1
            cap[(w, u)] = cap.get((w, u), 0) + 1
            w = u
        flow += 1
        if flow > 200:
            break
    reach = {S}
    q = deque([S])
    while q:
        u = q.popleft()
        for w in adj.get(u, ()):
            if w not in reach and cap.get((u, w), 0) > 0:
                reach.add(w)
                q.append(w)
    cut_edges = [e for e in bm.edges
                 if e.verts[0].index not in removed and e.verts[1].index not in removed
                 and ((e.verts[0].index in reach) != (e.verts[1].index in reach))]
    if dry_run:
        info = {"side": side, "flow": flow, "cut": [(tuple(round(x, 3) for x in e.verts[0].co),
                                                     tuple(round(x, 3) for x in e.verts[1].co)) for e in cut_edges]}
        bm.free()
        return info
    shared = set(cut_edges[0].verts) if cut_edges else set()
    for e in cut_edges[1:]:
        shared &= set(e.verts)
    if len(shared) == 1:
        v = next(iter(shared))
        faces = list(v.link_faces)
        fan_of = {}
        fans = []
        for f in faces:
            if f in fan_of:
                continue
            fan, st = [f], [f]
            fan_of[f] = len(fans)
            while st:
                g = st.pop()
                for e in g.edges:
                    if v not in e.verts:
                        continue
                    for h in e.link_faces:
                        if h is not g and h not in fan_of:
                            fan_of[h] = len(fans)
                            fan.append(h)
                            st.append(h)
            fans.append(fan)
        if len(fans) >= 2:
            hc = (joints[f"hand.{side}"][0] + joints[f"hand.{side}"][1]) / 2
            def fan_dist(fan):
                pts = [u.co for f in fan for u in f.verts if u is not v]
                return (sum(pts, Vector()) / len(pts) - hc).length
            keep = min(fans, key=fan_dist)
            moved = 0
            for fan in fans:
                if fan is keep:
                    continue
                new_verts = []
                for f in fan:
                    nv = bmesh.utils.face_vert_separate(f, v)
                    if nv is not v:
                        new_verts.append(nv)
                    moved += 1
                if len(new_verts) > 1:
                    bmesh.ops.weld_verts(bm, targetmap={nv: new_verts[0] for nv in new_verts[1:]})
            bmesh.ops.delete(bm, geom=[u for u in bm.verts if not u.link_edges], context="VERTS")
            bm.to_mesh(obj.data)
            bm.free()
            return {"side": side, "method": "bowtie_vertex_split", "fans": len(fans),
                    "min_cut_edges": len(cut_edges), "flow": flow, "faces_moved": moved, "patch_faces": 0}
    pre = {e for e in bm.edges if e.is_boundary}
    bmesh.ops.delete(bm, geom=cut_edges, context="EDGES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    newb = [e for e in bm.edges if e.is_boundary and e not in pre]
    before = set(bm.faces)
    bmesh.ops.holes_fill(bm, edges=newb, sides=0)
    filled = [f for f in bm.faces if f not in before]
    patch = bmesh.ops.triangulate(bm, faces=filled, quad_method="BEAUTY", ngon_method="BEAUTY")["faces"]
    pset = set(patch)
    for f in patch:
        f.smooth = True
        nb = [g for e in f.edges for g in e.link_faces if g not in pset]
        if nb:
            uv = sum((l[uvl].uv for l in nb[0].loops), Vector((0, 0))) / len(nb[0].loops)
            for loop in f.loops:
                loop[uvl].uv = uv
    bmesh.ops.recalc_face_normals(bm, faces=patch)
    bm.to_mesh(obj.data)
    bm.free()
    return {"side": side, "method": "delete_fill", "min_cut_edges": len(cut_edges), "flow": flow, "source_verts": len(src),
            "sink_verts": len(sink), "patch_faces": len(patch)}


def fist_connectivity(obj, joints: dict, shoulder_r: float, fist_r: float = 0.07) -> dict:
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    torso_c = (joints["spine"][0] + joints["spine"][1]) / 2
    out = {}
    for side in ("L", "R"):
        sh = joints[f"upper_arm.{side}"][0]
        removed = {v for v in bm.verts if (v.co - sh).length < shoulder_r}
        torso = min((v for v in bm.verts if v not in removed), key=lambda v: (v.co - torso_c).length)
        seen, st = {torso}, [torso]
        while st:
            v = st.pop()
            for e in v.link_edges:
                u = e.other_vert(v)
                if u not in seen and u not in removed:
                    seen.add(u)
                    st.append(u)
        a, b = joints[f"hand.{side}"]
        fist = [v for v in bm.verts if _seg_dist(v.co, a, b) < fist_r and v not in removed]
        out[side] = f"{sum(v in seen for v in fist)}/{len(fist)}"
    bm.free()
    return out
