import argparse
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
ROOT = os.path.dirname(BL)
sys.path[:0] = [HERE, BL]

import bpy
import bmesh
import numpy as np
from mathutils import Vector
from PIL import Image, ImageDraw

import dvor_lib as L

NAMES = {"technik": "CH_Technik", "sprinter": "CH_Sprinter", "tank": "CH_Tank"}
STYLE = {
    "technik": dict(skin_fingers=True, fist=(1.32, 1.05, 1.25)),
    "sprinter": dict(skin_fingers=False, fist=(1.30, 1.0, 1.22), rebuild_forearm=True),
    "tank": dict(skin_fingers=False, fist=(1.15, 0.95, 1.05), wrist_taper=0.75),
}
RING = 10
FINGER_CHAMFER = 0.0


def hand_frame(bone, side):
    y = (bone.tail_local - bone.head_local).normalized()
    sg = 1 if side == "L" else -1
    n = Vector((-sg, 0, 0))
    n = (n - y * n.dot(y)).normalized()
    t = Vector((0, -1, 0))
    t = (t - y * t.dot(y) - n * t.dot(n)).normalized()
    return y, n, t


def kmeans2(cols):
    c = np.array(cols, dtype=float)
    lum = c.mean(1)
    a, b = c[lum <= np.median(lum)].mean(0), c[lum > np.median(lum)].mean(0)
    for _ in range(12):
        ma = ((c - a) ** 2).sum(1) <= ((c - b) ** 2).sum(1)
        if ma.all() or (~ma).all():
            break
        a, b = c[ma].mean(0), c[~ma].mean(0)
    return sorted([a, b], key=lambda x: x.mean())


def free_spots(tex, uv_tris, need, size, k):
    H, W = tex.shape[:2]
    mask = Image.new("L", (W, H), 0)
    d = ImageDraw.Draw(mask)
    for tri in uv_tris:
        d.polygon([(u * W, (1 - v) * H) for u, v in tri], fill=255, outline=255)
    m = np.array(mask) > 0
    pad = np.pad(m, k)
    dil = np.zeros_like(m)
    for dy in range(-k, k + 1, 2):
        for dx in range(-k, k + 1, 2):
            dil |= pad[k + dy:k + dy + H, k + dx:k + dx + W]
    spots = []
    for y in range(4, H - size - 4, max(4, size // 2)):
        for x in range(4, W - size - 4, max(4, size // 2)):
            if not dil[y:y + size, x:x + size].any() and all(abs(x - a) >= size or abs(y - b) >= size for a, b in spots):
                spots.append((x, y))
                if len(spots) == need:
                    return spots
    return None


def ring_points(c, n, t, w, d, m=RING, e=3.2):
    pts = []
    for i in range(m):
        a = 2 * math.pi * (i + 0.5) / m
        ca, sa = math.cos(a), math.sin(a)
        x = w / 2 * math.copysign(abs(ca) ** (2 / e), ca)
        z = d / 2 * math.copysign(abs(sa) ** (2 / e), sa)
        pts.append((a, c + t * x + n * z))
    return pts


def build(ch):
    name = NAMES[ch]
    st = STYLE[ch]
    blend = os.path.join(ROOT, "source", f"USER_{name}.blend")
    bpy.ops.wm.open_mainfile(filepath=blend)
    rig = bpy.data.objects[f"USER_{name}_Rig"]
    mesh = bpy.data.objects[f"USER_{name}_LOD0"]
    if mesh.get("hands_rebuilt"):
        raise SystemExit("hands already rebuilt in this .blend (rebuild the character first)")
    me = mesh.data
    img_node = next(n for n in me.materials[0].node_tree.nodes if n.type == "TEX_IMAGE")
    tex_path = os.path.join(ROOT, "textures", f"USER_{name}_basecolor_1024.jpg")
    tex = np.array(Image.open(tex_path).convert("RGB"))
    H, W = tex.shape[:2]
    gi = {g.index: g.name for g in mesh.vertex_groups}
    gidx = {g.name: g.index for g in mesh.vertex_groups}
    tris_before = sum(len(p.vertices) - 2 for p in me.polygons)

    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    dl = bm.verts.layers.deform.verify()

    def dominant(v):
        w = v[dl]
        return gi[max(w.items(), key=lambda kv: kv[1])[0]] if len(w) else ""

    cols = []
    old = []
    for side in ("L", "R"):
        hv = [v for v in bm.verts if dominant(v) == f"hand.{side}"]
        old += hv
        for f in {f for v in hv for f in v.link_faces}:
            for lp in f.loops:
                u, vv = lp[uvl].uv
                cols.append(tex[min(H - 1, max(0, int((1 - vv) * H))), min(W - 1, max(0, int(u * W)))])
    if st.get("rebuild_forearm"):
        for side in ("L", "R"):
            fa = rig.data.bones[f"forearm.{side}"]
            ax = (fa.tail_local - fa.head_local)
            ln = ax.length
            ax = ax / ln
            for v in bm.verts:
                if v in old or not dominant(v).endswith(side) or not dominant(v).startswith(("upper_arm", "forearm")):
                    continue
                d = v.co - fa.head_local
                along = d.dot(ax)
                if along > 0.18 * ln and (d - ax * along).length < 0.085:
                    old.append(v)
        old = list(set(old))
        for v in old:
            for f in v.link_faces:
                for lp in f.loops:
                    u, vv = lp[uvl].uv
                    cols.append(tex[min(H - 1, max(0, int((1 - vv) * H))), min(W - 1, max(0, int(u * W)))])
    glove, light = kmeans2(cols)
    skin = light if (st["skin_fingers"] or st.get("rebuild_forearm")) else glove
    shade = np.clip(glove * 0.7, 0, 255)
    report = {"old_hand_vertices": len(old), "colours": {"glove": [int(c) for c in glove], "skin": [int(c) for c in skin]}}
    near = {e for v in old for e in v.link_edges}
    ring_verts = {e.other_vert(v) for v in old for e in v.link_edges if e.other_vert(v) not in old}
    bmesh.ops.delete(bm, geom=old, context="VERTS")

    uv_tris = []
    for f in bm.faces:
        ls = [lp[uvl].uv.copy() for lp in f.loops]
        uv_tris += [(ls[0], ls[i], ls[i + 1]) for i in range(1, len(ls) - 1)]
    for size, k in ((24, 6), (14, 3)):
        spots = free_spots(tex, uv_tris, 3, size, k)
        if spots:
            break
    if not spots:
        raise RuntimeError("no free atlas space for the hand colours")
    for (x, y), c in zip(spots, (glove, skin, shade)):
        tex[y:y + size, x:x + size] = c.astype(np.uint8)
    UV = [Vector(((x + size / 2) / W, 1 - (y + size / 2) / H)) for x, y in spots]
    UV_GLOVE, UV_SKIN, UV_SHADE = UV
    report["atlas_patches_px"] = {"at": [list(s) for s in spots], "size": size}

    def weigh(v, wts):
        for g, w in wts.items():
            v[dl][gidx[g]] = w

    def face(vs, uv, outward_hint, smooth=True):
        f = bm.faces.new(vs)
        f.normal_update()
        cen = f.calc_center_median()
        if f.normal.dot(outward_hint(cen)) < 0:
            f.normal_flip()
        f.smooth = smooth
        for lp in f.loops:
            lp[uvl].uv = uv
        return f

    for side in ("L", "R"):
        hand = rig.data.bones[f"hand.{side}"]
        y, n, t = hand_frame(hand, side)
        bverts = {v for v in ring_verts if v.is_valid and any(e.is_boundary for e in v.link_edges)}
        bverts = [v for v in bverts if (v.co - hand.head_local).length < 0.3]
        loops, left = [], set(bverts)
        while left:
            s0 = left.pop()
            comp, stack = {s0}, [s0]
            while stack:
                a = stack.pop()
                for e in a.link_edges:
                    if e.is_boundary:
                        b = e.other_vert(a)
                        if b in left:
                            left.remove(b)
                            comp.add(b)
                            stack.append(b)
            loops.append(comp)
        loopv = min(loops, key=lambda c: (sum((v.co for v in c), Vector()) / len(c) - hand.head_local).length)
        c0 = sum((v.co for v in loopv), Vector()) / len(loopv)
        fore = rig.data.bones[f"forearm.{side}"]
        yf = (hand.head_local - fore.head_local).normalized()
        if st.get("rebuild_forearm"):
            yf = (hand.head_local - c0).normalized()
        sg = 1 if side == "L" else -1

        def frame(ax):
            nn = Vector((-sg, 0, 0))
            nn = (nn - ax * nn.dot(ax)).normalized()
            tt = Vector((0, -1, 0))
            tt = (tt - ax * tt.dot(ax) - nn * tt.dot(nn)).normalized()
            return nn, tt

        nf, tf = frame(yf)
        proj = [((v.co - c0).dot(tf), (v.co - c0).dot(nf)) for v in loopv]
        lw = max(p[0] for p in proj) - min(p[0] for p in proj)
        ld = max(p[1] for p in proj) - min(p[1] for p in proj)
        yw = (hand.head_local - c0).dot(yf)
        cuff = yw > 0.04
        taper = st.get("wrist_taper", 0.8 if cuff else 1.0)
        wrist_w, wrist_d = taper * lw, taper * ld
        base = max(wrist_w, wrist_d)
        Wf, Df, Lf = (base * k for k in st["fist"])
        wrist_c = c0 + yf * max(yw, 0.012)
        mid = (yf + y).normalized()
        sections = []
        if st.get("rebuild_forearm"):
            for k, f in ((0.35, 0.8), (0.7, 0.66)):
                sections.append((c0 + yf * (yw * k), yf, lw * f, ld * f, {f"forearm.{side}": 1.0}, UV_SKIN))
            wrist_w, wrist_d = lw * 0.52, ld * 0.52
            base = max(wrist_w, wrist_d)
            Wf, Df, Lf = (base * k for k in st["fist"])
        elif cuff or taper < 0.95:
            sections.append((c0 + yf * max(yw * 0.5, 0.006), yf, (lw + wrist_w) / 2, (ld + wrist_d) / 2,
                             {f"forearm.{side}": 1.0}, UV_GLOVE))
        sections += [
            (wrist_c, mid, wrist_w, wrist_d, {f"forearm.{side}": 0.5, f"hand.{side}": 0.5}, UV_GLOVE),
            (wrist_c + y * (0.28 * Lf), y, Wf * 0.92, Df * 0.78, {f"hand.{side}": 1.0}, UV_GLOVE),
            (wrist_c + y * (0.55 * Lf) + n * (0.04 * Df), y, Wf, Df * 0.92, {f"hand.{side}": 1.0}, UV_GLOVE),
            (wrist_c + y * (0.80 * Lf) + n * (0.10 * Df), y, Wf * 0.97, Df * 0.9, {f"hand.{side}": 1.0}, UV_GLOVE),
            (wrist_c + y * (0.95 * Lf) + n * (0.16 * Df), y, Wf * 0.82, Df * 0.66, {f"hand.{side}": 1.0}, UV_GLOVE),
        ]
        new_faces = []
        rings = []
        for cen, ax, w, d, wts, _uv in sections:
            nn, tt = frame(ax)
            vs = []
            for ang, p in ring_points(cen, nn, tt, w, d):
                v = bm.verts.new(p)
                weigh(v, wts)
                vs.append((ang, v))
            rings.append((cen, vs, _uv))
        r0c, r0, uv0 = rings[0]
        A = sorted(((math.atan2((v.co - c0).dot(nf), (v.co - c0).dot(tf)) % (2 * math.pi), v) for v in loopv), key=lambda x: x[0])
        B = sorted(((ang % (2 * math.pi), v) for ang, v in r0), key=lambda x: x[0])
        zc = (c0 + r0c) / 2
        out_z = lambda p: p - zc
        i = j = 0
        na, nb = len(A), len(B)
        while i < na or j < nb:
            a0, a1 = A[i % na], A[(i + 1) % na]
            b0, b1 = B[j % nb], B[(j + 1) % nb]
            ta = a1[0] + (2 * math.pi if (i + 1) >= na else 0)
            tb = b1[0] + (2 * math.pi if (j + 1) >= nb else 0)
            if (ta <= tb and i < na) or j >= nb:
                new_faces.append(face([a0[1], a1[1], b0[1]], uv0, out_z))
                i += 1
            else:
                new_faces.append(face([a0[1], b1[1], b0[1]], uv0, out_z))
                j += 1
        for (ca, ra, uva), (cb, rb, uvb) in zip(rings, rings[1:]):
            mc = (ca + cb) / 2
            for k in range(RING):
                new_faces.append(face([ra[k][1], ra[(k + 1) % RING][1], rb[(k + 1) % RING][1], rb[k][1]], uvb,
                                      lambda p, mc=mc: p - mc))
        tip = bm.verts.new(wrist_c + y * Lf + n * (0.2 * Df))
        weigh(tip, {f"hand.{side}": 1.0})
        last = rings[-1][1]
        for k in range(RING):
            new_faces.append(face([last[k][1], last[(k + 1) % RING][1], tip], UV_SKIN if st["skin_fingers"] else UV_GLOVE,
                                  lambda p: y))
        c0 = wrist_c
        w0 = 0.0
        fw = Wf / 4

        def block(lo, hi, uv, chamfer=0.0):
            vs = []
            for q in range(8):
                a = (hi[0] if q & 1 else lo[0], hi[1] if q & 2 else lo[1], hi[2] if q & 4 else lo[2])
                p = c0 + n * a[0] + y * a[1] + t * a[2]
                v = bm.verts.new(p)
                weigh(v, {f"hand.{side}": 1.0})
                vs.append(v)
            cen = c0 + n * ((lo[0] + hi[0]) / 2) + y * ((lo[1] + hi[1]) / 2) + t * ((lo[2] + hi[2]) / 2)
            fs = [face([vs[a] for a in idx], uv, lambda p, cen=cen: p - cen, smooth=False)
                  for idx in ((0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5))]
            if chamfer:
                res = bmesh.ops.bevel(bm, geom=list({e for f in fs for e in f.edges}) + vs, offset=chamfer, segments=1,
                                      affect="EDGES", clamp_overlap=True)
                for v in res.get("verts", []):
                    weigh(v, {f"hand.{side}": 1.0})
                fs = [f for f in set(fs) | set(res.get("faces", [])) if f.is_valid]
                for f in fs:
                    f.smooth = False
                    for lp in f.loops:
                        lp[uvl].uv = uv
            return fs

        fuv = UV_SKIN if st["skin_fingers"] else UV_GLOVE
        tips = (0.90, 0.98, 1.02, 0.98)
        for q in range(4):
            t0 = -Wf / 2 + q * fw + 0.07 * fw
            t1 = t0 + fw * 0.86
            new_faces += block((-Df * 0.40, w0 + 0.62 * Lf, t0), (Df * 0.42, w0 + tips[q] * Lf, t1), fuv,
                               chamfer=FINGER_CHAMFER * fw)
        new_faces += block((Df * 0.02, w0 + 0.30 * Lf, Wf * 0.30), (Df * 0.52, w0 + 0.74 * Lf, Wf * 0.56), fuv,
                           chamfer=0.16 * fw)
        report[side] = {"wrist_ring_vertices": len(loopv), "cuff": cuff, "wrist_m": [round(wrist_w, 3), round(wrist_d, 3)],
                        "fist_m": {"width": round(Wf, 3), "thickness": round(Df, 3), "length": round(Lf, 3)},
                        "new_faces": len(new_faces)}

    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    me.update()
    mesh["hands_rebuilt"] = True

    Image.fromarray(tex).save(tex_path, quality=92)
    img = img_node.image
    if img.packed_file:
        img.unpack(method="REMOVE")
    img.filepath = "//../textures/" + os.path.basename(tex_path)
    img.reload()
    img.pack()

    rep_path = os.path.join(ROOT, "export", "raw", f"USER_{name}.build.json")
    rep = json.load(open(rep_path))
    report["triangles"] = {"before": tris_before, "after": sum(len(p.vertices) - 2 for p in me.polygons)}
    rep["hands"] = report
    rep["lod0"] = L.mesh_report(mesh)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    raw = os.path.join(ROOT, "export", "raw", f"USER_{name}.glb")
    L.export_glb(raw, [rig, mesh])
    rep["files"]["blend_bytes"] = os.path.getsize(blend)
    rep["files"]["raw_glb_bytes"] = os.path.getsize(raw)
    rep["texture"]["bytes"] = os.path.getsize(tex_path)
    L.write_json(rep_path, rep)
    print("HANDS", json.dumps(report))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True, choices=list(NAMES))
    build(ap.parse_args().char)
