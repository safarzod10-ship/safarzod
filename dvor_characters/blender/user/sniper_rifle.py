import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
ROOT = os.path.dirname(BL)
sys.path[:0] = [HERE, BL]

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

import dvor_lib as L

NAME = "USER_HERO_Sniper"
STOCK = Vector((-0.11, -0.16, 1.03))
AIM = Vector((0.0, -1.0, -0.22)).normalized()


def main():
    blend = os.path.join(ROOT, "source", f"{NAME}.blend")
    bpy.ops.wm.open_mainfile(filepath=blend)
    rig = bpy.data.objects[f"{NAME}_Rig"]
    obj = bpy.data.objects[f"{NAME}_LOD0"]
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen, comps = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        st, c = [v], []
        seen.add(v.index)
        while st:
            x = st.pop()
            c.append(x.index)
            for e in x.link_edges:
                u = e.other_vert(x)
                if u.index not in seen:
                    seen.add(u.index)
                    st.append(u)
        comps.append(c)
    comps.sort(key=len, reverse=True)
    def centre(c):
        return sum((bm.verts[i].co for i in c), Vector()) / len(c)
    cand = [c for c in comps[1:] if len(c) > 100 and centre(c).y > 0.05 and centre(c).z > 0.8]
    assert cand, "rifle piece not found"
    rifle = cand[0]
    P = np.array([bm.verts[i].co[:] for i in rifle])
    cen = P.mean(0)
    _, _, vt = np.linalg.svd(P - cen)
    axis = Vector(vt[0]).normalized()
    proj = (P - cen) @ np.array(axis[:])
    if axis.z < 0:
        axis = -axis
        proj = -proj
    length = float(proj.max() - proj.min())
    stock_old = Vector(cen) + axis * float(proj.min())
    rot = axis.rotation_difference(AIM).to_matrix().to_4x4()
    M = Matrix.Translation(STOCK) @ rot @ Matrix.Translation(-stock_old)
    for i in rifle:
        bm.verts[i].co = M @ bm.verts[i].co
    bm.to_mesh(me)
    bm.free()
    me.update()
    for i in rifle:
        for g in list(me.vertices[i].groups):
            obj.vertex_groups[g.group].remove([i])
        obj.vertex_groups["chest"].add([i], 1.0, "REPLACE")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    raw = os.path.join(ROOT, "export", "raw", f"{NAME}.glb")
    L.export_glb(raw, [rig, obj])
    rep_path = os.path.join(ROOT, "export", "raw", f"{NAME}.build.json")
    rep = json.load(open(rep_path))
    rep["rifle"] = {"vertices": len(rifle), "length_m": round(length, 3), "stock_m": [round(v, 3) for v in STOCK],
                    "aim": [round(v, 3) for v in AIM], "bone": "chest"}
    L.write_json(rep_path, rep)
    print("RIFLE", rep["rifle"])


if __name__ == "__main__":
    main()
