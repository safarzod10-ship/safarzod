"""Monument v4: re-pose the statue's LEFT arm to match the photos and replace the
modelled fist by a real hand with fingers.

  blender -b --factory-startup --python tools/blender/monument_v4_statue.py -- \
      <elements_in.blend> <character.glb> <elements_out.blend> <report.json>

Reference: docs/references/monument/front_lowangle_statue_arch_2015.jpg - the left
forearm is raised in front of the body, the hand at chin height, palm forward,
fingers up. The source mesh has the arm hanging with a fist at hip height.

Method (measured joints, no hand-placed vertices):
  * joints of the source arm from slice analysis of the Statue mesh (Blender Z-up, m):
    shoulder S, elbow E, wrist W, fist centre F (see JOINTS);
  * two-bone linear-blend skinning: arm membership weight from distance to the
    S-E-F chain and from x (torso excluded), forearm share from the projection past E;
  * upper arm rotated about S, forearm about the moved elbow, to the target pose;
  * the fist (beyond the wrist) is deleted and replaced by the left hand of the
    project's main character mesh (assets/characters/main_character), cut at its
    wrist, oriented palm-forward / fingers-up, uniformly scaled by the statue/
    character height ratio, and joined to the statue (bronze, same material).
The hand is a real anatomical hand with separate fingers, not a primitive. It is a
generic hand, NOT a portrait of the original's hand (no close-up photo of it exists).
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
IN, CHAR, OUT, REP = (Path(a) for a in argv[:4])

JOINTS = {  # source pose, measured from z-slices of the Statue mesh (x > 1.5)
    "S": Vector((1.85, -2.40, 18.40)),
    "E": Vector((2.60, -2.60, 16.40)),
    "W": Vector((2.95, -3.10, 15.05)),
    "F": Vector((3.10, -3.40, 14.60)),
}
TARGET = {  # photo pose: elbow slightly forward/up, forearm raised, hand at chin height
    "E": Vector((2.72, -3.30, 16.75)),
    "W": Vector((2.97, -4.15, 18.06)),   # forearm raised ~55 deg (photos: 45-60 deg), palm forward
}
HAND_LEN_M = 1.20  # visible hand (cuff to fingertip) ~0.10 x statue height 13.3 m; the character's
                   # hand piece below its sleeve is 0.094 m, so it is scaled to this length


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def seg_dist(p, a, b):
    ab = np.array(b - a)
    t = np.clip(((p - np.array(a)) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (np.array(a) + t[:, None] * ab), axis=1), t


def rot_between(u, v):
    return u.normalized().rotation_difference(v.normalized()).to_matrix()


def repose(ob, rep):
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    S, E, W, F = (JOINTS[k] for k in "SEWF")
    du, _ = seg_dist(co, S, E)
    df, tf = seg_dist(co, E, F)
    m = smoothstep(1.70, 2.05, co[:, 0]) * (1 - smoothstep(0.62, 0.90, np.minimum(du, df)))
    fdir = np.array((F - E).normalized())
    proj = (co - np.array(E)) @ fdir
    f = smoothstep(-0.30, 0.25, proj)
    Ru = rot_between(E - S, TARGET["E"] - S)
    Rf = rot_between(W - E, TARGET["W"] - TARGET["E"])
    Ru_n, Rf_n = np.array(Ru), np.array(Rf)
    vu = np.array(S) + (co - np.array(S)) @ Ru_n.T
    vf = np.array(TARGET["E"]) + (co - np.array(E)) @ Rf_n.T
    new = co + m[:, None] * ((1 - f)[:, None] * (vu - co) + f[:, None] * (vf - co))
    me.vertices.foreach_set("co", new.astype(np.float32).ravel())
    # delete the fist: forearm vertices beyond the wrist
    wrist_t = (W - E).length
    fist = (m > 0.5) & (proj > wrist_t - 0.05)
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.where(fist)[0]], context="VERTS")
    bm.to_mesh(me)
    bm.free()
    me.update()
    rep["arm_vertices_moved"] = int((m > 0.01).sum())
    rep["fist_vertices_removed"] = int(fist.sum())


def import_hand():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CHAR), merge_vertices=True)
    new = [o for o in bpy.data.objects if o not in before]
    src = next(o for o in new if o.type == "MESH")
    co = np.array([src.matrix_world @ v.co for v in src.data.vertices])
    # character left hand (glTF +X -> Blender +X), below the sleeve cuff (z < 0.805)
    box = (co[:, 0] > 0.33) & (co[:, 2] < 0.805) & (co[:, 2] > 0.6) & (co[:, 1] > -0.12) & (co[:, 1] < 0.09)
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.verts.ensure_lookup_table()
    keep_faces = [f for f in bm.faces if all(box[v.index] for v in f.verts)]
    # largest connected piece inside the box = the hand (drops coat fragments)
    face_set = set(keep_faces)
    comps, seen = [], set()
    for f0 in keep_faces:
        if f0 in seen:
            continue
        stack, comp = [f0], []
        while stack:
            f = stack.pop()
            if f in seen:
                continue
            seen.add(f)
            comp.append(f)
            for e in f.edges:
                for g in e.link_faces:
                    if g in face_set and g not in seen:
                        stack.append(g)
        comps.append(comp)
    # the hand = the piece containing the lowest vertex (fingertip); coat fragments are dropped
    lowest = min((v for f in keep_faces for v in f.verts), key=lambda v: v.co.z)
    hand = next(c for c in comps if any(lowest in f.verts for f in c))
    hand_set = set(hand)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f not in hand_set], context="FACES")
    me = bpy.data.meshes.new("StatueHand")
    bm.to_mesh(me)
    bm.free()
    for o in new:
        bpy.data.objects.remove(o)
    hand = bpy.data.objects.new("StatueHand", me)
    bpy.context.scene.collection.objects.link(hand)
    hco = np.array([v.co[:] for v in me.vertices])
    return hand, hco


def main():
    bpy.ops.wm.open_mainfile(filepath=str(IN))
    rep = {"joints_source": {k: list(v) for k, v in JOINTS.items()}, "joints_target": {k: list(v) for k, v in TARGET.items()}}
    st = bpy.data.objects["Statue"]
    repose(st, rep)
    hand, hco = import_hand()
    # hand frame from the geometry: finger axis a (wrist -> fingertips), palm normal n
    wrist = hco[hco[:, 2] > hco[:, 2].max() - 0.008].mean(0)
    tip = hco[hco[:, 2] < hco[:, 2].min() + 0.008].mean(0)
    length = float(np.linalg.norm(wrist - tip))
    a = (tip - wrist) / length
    t = (hco - wrist) @ a / length
    d = hco[t > 0.7].mean(0) - wrist
    n = d - (d @ a) * a
    n /= np.linalg.norm(n)                      # fingers curl towards the palm -> palm side = +n
    # uncurl the fingers (photo: open palm, fingers up): rotate the part beyond the knuckles
    t0 = 0.45
    theta = math.atan2(float(np.linalg.norm(d - (d @ a) * a)), float(d @ a) - t0 * length)
    b = np.cross(a, n)
    piv = wrist + a * t0 * length
    w = np.clip((t - t0) / (1 - t0), 0, 1)
    new = hco.copy()
    for i in np.where(w > 0)[0]:
        Rm = np.array(Matrix.Rotation(-theta * w[i], 3, Vector(b)))
        new[i] = piv + Rm @ (hco[i] - piv)
    hand.data.vertices.foreach_set("co", new.astype(np.float32).ravel())
    s = HAND_LEN_M / length
    # orientation: finger axis -> forearm direction (fingers up), palm normal -> forward (-Y)
    fore = (TARGET["W"] - TARGET["E"]).normalized()
    fwd = Vector((0, -1, 0))
    fwd = (fwd - fwd.dot(fore) * fore).normalized()
    src = Matrix((Vector(a), Vector(-n), Vector(b))).transposed()          # columns: a, -n(back of hand), b
    dst = Matrix((fore, -fwd, fore.cross(-fwd).normalized())).transposed()
    if Vector(b).dot(Vector(np.cross(a, -n))) < 0:
        dst = Matrix((fore, -fwd, -fore.cross(-fwd).normalized())).transposed()
    R = dst @ src.inverted()
    inset = 0.42 * fore                          # wrist sits inside the sleeve cuff
    M = Matrix.Translation(TARGET["W"] - inset) @ R.to_4x4() @ Matrix.Diagonal((s, s, s, 1.0)) @ Matrix.Translation(-Vector(wrist))
    hand.data.transform(M)
    for p in hand.data.polygons:
        p.use_smooth = True
    rep["uncurl_deg"] = round(math.degrees(theta), 1)
    rep["hand"] = {"source": "assets/characters/main_character (left hand, cut at z<0.805 m)",
                   "triangles_source": len(hand.data.polygons), "length_source_m": round(length, 3),
                   "scale": round(s, 3), "length_on_statue_m": round(length * s, 2)}
    # join into the statue (same bronze material / atlas)
    bpy.ops.object.select_all(action="DESELECT")
    hand.select_set(True)
    st.select_set(True)
    bpy.context.view_layer.objects.active = st
    bpy.ops.object.join()
    rep["statue_triangles_after"] = sum(len(p.vertices) - 2 for p in st.data.polygons)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT), compress=True)
    Path(REP).write_text(json.dumps(rep, indent=1, default=float))
    print("STATUE V4", json.dumps(rep["hand"]))


main()
