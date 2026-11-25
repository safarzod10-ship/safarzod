"""Rig, skin and animate a user-supplied Tripo mesh (Blender 4.5 LTS bpy module).

    /opt/dvor-venv/bin/python blender/user/build_user_character.py --char technik|sprinter|tank

Pipeline
  1. import user_meshes/pN.glb, weld UV-split vertices, scale x1.5 (model height 1.0 -> 1.5 m)
  2. Technik only: cut the single fused vertex under the left fist (min edge cut)
  3. 18-bone skeleton (same names/hierarchy as the DVOR family) from measured joints
  4. heat (automatic) weights, then constrained by mesh connectivity: the arm piece below the
     shoulder may only use its own arm bones, the body may not use forearm/hand bones
  5. texture 4096 -> 1024 (Lanczos), one material, backface culling
  6. the 7 clips of the role are retargeted from the A-pose library: each bone is first swung
     (minimal arc) from its modelled rest direction to the A-pose direction, then the clip delta
     is applied, so all three meshes share the same motion design
  7. save source/USER_<NAME>.blend, export export/raw/USER_<NAME>.glb + build report
"""
import argparse
import io
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
ROOT = os.path.dirname(BL)
sys.path[:0] = [HERE, BL]

import bpy  # noqa: E402  (must precede bmesh)
import bmesh  # noqa: E402
from mathutils import Euler, Quaternion, Vector  # noqa: E402

import anims  # noqa: E402
import dvor_lib as L  # noqa: E402
import joints_user as JU  # noqa: E402
import user_mesh_lib as U  # noqa: E402

SCALE = 1.5
NAMES = {"technik": "CH_Technik", "sprinter": "CH_Sprinter", "tank": "CH_Tank"}
SHOULDER_BALL = {"technik": 0.16, "sprinter": 0.16, "tank": 0.24}
FIST_R = {"technik": 0.07, "sprinter": 0.07, "tank": 0.12}
# A-pose reference directions (armature space) the clip library was authored for
A_ARM = math.radians(18)
REF_DIR = {
    "upper_arm": Vector((math.sin(A_ARM), 0, -math.cos(A_ARM))),
    "forearm": Vector((math.sin(A_ARM), 0, -math.cos(A_ARM))),
    "hand": Vector((math.sin(A_ARM), 0, -math.cos(A_ARM))),
    "thigh": Vector((0, -0.04, -1)).normalized(),
    "shin": Vector((0, 0.04, -1)).normalized(),
    "foot": Vector((0, -0.94, -0.33)).normalized(),
    "pelvis": Vector((0, 0, 1)), "spine": Vector((0, 0, 1)), "chest": Vector((0, 0, 1)),
    "neck": Vector((0, 0, 1)), "head": Vector((0, 0, 1)),
}
REF_HIP_Z = 0.66
# clips that keep the modelled pose instead of the A-pose (the concept pose IS the idle)
KEEP_REST_POSE = {"sprinter": {"Idle"}}   # hip height of the A-pose reference (CH_Technik procedural) for pelvis offsets


def texture_1024(obj, name):
    """Read the embedded 4096 texture, write a 1024 JPEG next to the other textures."""
    from PIL import Image
    mat = obj.data.materials[0]
    img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE" and n.image)
    src = img.filepath_raw or img.name
    if img.packed_file:
        data = img.packed_file.data
        im = Image.open(io.BytesIO(data)).convert("RGB")
    else:
        im = Image.open(bpy.path.abspath(src)).convert("RGB")
    full = im.size
    small = im.resize((1024, 1024), Image.LANCZOS)
    path = os.path.join(ROOT, "textures", f"USER_{name}_basecolor_1024.jpg")
    small.save(path, quality=90, optimize=True)
    return path, full


def make_material(name, tex_path):
    m = L.make_material(f"M_USER_{name}", tex_path)
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.85
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.25
    return m


def constrain_weights(obj, joints, ch):
    """Arm piece (not connected to the torso once the shoulder ball is removed) may use only
    its arm bones (+chest near the shoulder); everything else may not use forearm/hand bones."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    tc = (joints["spine"][0] + joints["spine"][1]) / 2
    body = None
    groups = {g.index: g.name for g in obj.vertex_groups}
    allowed = {}
    for side in ("L", "R"):
        sh = joints[f"upper_arm.{side}"][0]
        removed = {v.index for v in bm.verts if (v.co - sh).length < SHOULDER_BALL[ch]}
        torso = min((v for v in bm.verts if v.index not in removed), key=lambda v: (v.co - tc).length)
        seen, st = {torso.index}, [torso]
        while st:
            v = st.pop()
            for e in v.link_edges:
                u = e.other_vert(v)
                if u.index not in seen and u.index not in removed:
                    seen.add(u.index)
                    st.append(u)
        arm_bones = {f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"}
        for v in bm.verts:
            if v.index in removed:
                continue
            if v.index not in seen:
                allowed.setdefault(v.index, set()).update(arm_bones)
            else:
                allowed.setdefault(v.index, set()).update({"*no_low_arm_" + side})
    bm.free()
    changed = 0
    for v in obj.data.vertices:
        rule = allowed.get(v.index)
        if not rule:
            continue
        keep = {}
        for g in v.groups:
            n = groups[g.group]
            ok = True
            arm_sets = [r for r in rule if not r.startswith("*")]
            if arm_sets:
                ok = n in rule
            for r in rule:
                if r.startswith("*no_low_arm_"):
                    s = r[-1]
                    if n in (f"forearm.{s}", f"hand.{s}"):
                        ok = False
            if ok and g.weight > 1e-4:
                keep[n] = g.weight
        if len(keep) != sum(1 for g in v.groups if g.weight > 1e-4):
            changed += 1
        if not keep:
            # fall back to the nearest allowed bone
            cands = [r for r in rule if not r.startswith("*")] or [b for b in groups.values()
                                                                    if not b.startswith(("forearm", "hand"))]
            keep = {min(cands, key=lambda b: U._seg_dist(v.co, *joints[b])): 1.0}
        for g in list(v.groups):
            obj.vertex_groups[g.group].remove([v.index])
        tot = sum(keep.values())
        for n, w in keep.items():
            obj.vertex_groups[n].add([v.index], w / tot, "REPLACE")
    return changed


def skin(obj, rig, joints, ch):
    for o in bpy.context.view_layer.objects:
        o.select_set(o in (obj, rig))
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    # every deform bone must exist as a group even when heat gave it nothing
    for b in L.BONE_NAMES:
        if b != "root" and b not in obj.vertex_groups:
            obj.vertex_groups.new(name=b)
    if "root" in obj.vertex_groups:
        obj.vertex_groups.remove(obj.vertex_groups["root"])
    changed = constrain_weights(obj, joints, ch)
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.view_layer.objects:
        o.select_set(o is obj)
    bpy.ops.object.vertex_group_clean(group_select_mode="ALL", limit=0.02)
    bpy.ops.object.vertex_group_limit_total(group_select_mode="ALL", limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode="ALL", lock_active=False)
    # separate pieces (backpack, loose soles...) follow one bone rigidly
    rigid = rigid_components(obj, joints)
    # unweighted vertices -> nearest bone
    groups = {g.name: g for g in obj.vertex_groups}
    fixed = 0
    for v in obj.data.vertices:
        if not any(g.weight > 1e-4 for g in v.groups):
            b = min((n for n in groups), key=lambda n: U._seg_dist(v.co, *joints[n]))
            groups[b].add([v.index], 1.0, "REPLACE")
            fixed += 1
    return {"constrained_vertices": changed, "unweighted_fixed": fixed, "rigid_pieces": rigid}


def rigid_components(obj, joints):
    me = obj.data
    adj = {i: set() for i in range(len(me.vertices))}
    for e in me.edges:
        a, b = e.vertices
        adj[a].add(b)
        adj[b].add(a)
    seen, comps = set(), []
    for i in adj:
        if i in seen:
            continue
        st, c = [i], []
        seen.add(i)
        while st:
            x = st.pop()
            c.append(x)
            for y in adj[x]:
                if y not in seen:
                    seen.add(y)
                    st.append(y)
        comps.append(c)
    comps.sort(key=len, reverse=True)
    names = {g.index: g.name for g in obj.vertex_groups}
    out = []
    torso = [joints["pelvis"][0], joints["chest"][1]]
    for c in comps[1:]:
        cen = sum((me.vertices[i].co for i in c), Vector()) / len(c)
        tot = {}
        for i in c:
            for g in me.vertices[i].groups:
                tot[names[g.group]] = tot.get(names[g.group], 0) + g.weight
        d_torso = U._seg_dist(cen, *torso)
        d_arm = min(U._seg_dist(cen, *joints[f"{b}.{s}"]) for b in ("upper_arm", "forearm", "hand") for s in "LR")
        # nearest bone to the piece centre (heat weights are unreliable on loose pieces);
        # arm bones only if the piece sits closer to an arm than to the torso
        bones = [b for b in joints if b != "root" and (d_arm < d_torso or not b.startswith(("upper_arm", "forearm", "hand")))]
        bone = min(bones, key=lambda b: U._seg_dist(cen, *joints[b]))
        for i in c:
            for g in list(me.vertices[i].groups):
                obj.vertex_groups[g.group].remove([i])
            obj.vertex_groups[bone].add([i], 1.0, "REPLACE")
        out.append({"verts": len(c), "bone": bone, "centre_z_m": round(cen.z, 3)})
    return out


# ----------------------------------------------------------------------------- retarget
def straighten_rotations(rig, ch):
    """W_b: minimal-arc swing from the modelled rest direction to the A-pose direction,
    accumulated down the chain so children follow their straightened parent."""
    W = {}
    for b, parent in L.BONES:
        bone = rig.data.bones[b]
        Wp = W.get(parent, Quaternion()) if parent else Quaternion()
        if b == "root":
            W[b] = Quaternion()
            continue
        d = (bone.tail_local - bone.head_local).normalized()
        d_after_parent = Wp @ d
        key = b.split(".")[0]
        ref = REF_DIR[key].copy()
        if b.endswith(".R"):
            ref.x = -ref.x
        swing = d_after_parent.rotation_difference(ref)
        W[b] = swing @ Wp
    return W


def retarget_action(rig, clip, keys, loop, extra, W, hip_z):
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    act["loop"] = bool(loop)
    for k, v in (extra or {}).items():
        act[k] = v
    rig.animation_data_create()
    rig.animation_data.action = act
    R = {b: rig.data.bones[b].matrix_local.to_quaternion() for b in L.BONE_NAMES}
    k_loc = hip_z / REF_HIP_Z
    last = {}
    for frame, pose in keys:
        D, T = {}, {}
        for b, parent in L.BONES:
            rx, ry, rz = pose.get(b, (0, 0, 0))
            if b.endswith(".R"):
                ry, rz = -ry, -rz
            qw = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), "XYZ").to_quaternion()
            D[b] = (D[parent] if parent else Quaternion()) @ qw if b != "root" else Quaternion()
            T[b] = D[b] @ W[b] @ R[b]
        for b, parent in L.BONES:
            pb = rig.pose.bones[b]
            pb.rotation_mode = "QUATERNION"
            if parent:
                base = T[parent] @ R[parent].inverted() @ R[b]
            else:
                base = R[b]
            q = base.inverted() @ T[b]
            if b in last and last[b].dot(q) < 0:
                q.negate()
            last[b] = q.copy()
            pb.rotation_quaternion = q
            pb.keyframe_insert("rotation_quaternion", frame=frame, group=b)
            if b in ("pelvis", "root"):
                off = Vector(pose.get("loc", (0, 0, 0))) * k_loc if b == "pelvis" else Vector()
                pb.location = R[b].inverted() @ off
                pb.keyframe_insert("location", frame=frame, group=b)
    act.frame_range = (keys[0][0], keys[-1][0])
    tr = rig.animation_data.nla_tracks.new()
    tr.name = clip
    tr.strips.new(clip, int(keys[0][0]), act)
    tr.mute = True
    rig.animation_data.action = None
    return act


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", required=True, choices=list(NAMES))
    args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    ch = args.char
    name = NAMES[ch]
    p, J = JU.MESHES[ch]

    L.reset_scene()
    obj, imp = U.import_user_mesh(os.path.join(ROOT, "user_meshes", f"{p}.glb"), SCALE, f"USER_{name}")
    joints = U.build_joints(J, SCALE)
    cut = None
    if ch == "technik":
        cut = U.cut_min_bridge(obj, joints, "L", shoulder_r=SHOULDER_BALL[ch], core_r=FIST_R[ch])
    fist = U.fist_connectivity(obj, joints, SHOULDER_BALL[ch], FIST_R[ch])

    tex_path, tex_full = texture_1024(obj, name)
    mat = make_material(name, tex_path)
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    # drop the imported 4096 material/texture so the .blend only carries the 1024 atlas
    for m in list(bpy.data.materials):
        if m is not mat:
            bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        if im.users == 0:
            bpy.data.images.remove(im)
    bpy.data.orphans_purge(do_recursive=True)

    rig = L.build_armature(f"USER_{name}", joints)
    skin_info = skin(obj, rig, joints, ch)
    obj.name = f"USER_{name}_LOD0"
    obj.data.name = obj.name

    W = straighten_rotations(rig, ch)
    clips = {}
    for clip in L.CLIPS:
        keys, loop, extra = anims.LIBRARY[clip](JU_ROLE[ch])
        Wc = {b: Quaternion() for b in W} if clip in KEEP_REST_POSE.get(ch, ()) else W
        retarget_action(rig, clip, keys, loop, extra, Wc, joints["thigh.L"][0].z)
        clips[clip] = {"duration_s": round((keys[-1][0] - keys[0][0]) / L.FPS, 3), "loop": loop,
                       **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in (extra or {}).items()}}
    L.set_rest(rig)

    blend = os.path.join(ROOT, "source", f"USER_{name}.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    raw = os.path.join(ROOT, "export", "raw", f"USER_{name}.glb")
    L.export_glb(raw, [rig, obj])
    rep = {
        "character": f"USER_{name}", "source_mesh": f"user_meshes/{p}.glb", "scale": SCALE,
        "import": imp, "cut": cut, "fist_connected_to_torso_after": fist,
        "lod0": L.mesh_report(obj), "skin": skin_info, "bones": len(rig.data.bones),
        "texture": {"source": list(tex_full), "delivered": [1024, 1024],
                    "path": os.path.relpath(tex_path, ROOT), "bytes": os.path.getsize(tex_path)},
        "clips": clips,
        "files": {"blend_bytes": os.path.getsize(blend), "raw_glb_bytes": os.path.getsize(raw)},
    }
    L.write_json(os.path.join(ROOT, "export", "raw", f"USER_{name}.build.json"), rep)
    print("REPORT", rep["lod0"], rep["skin"], rep["cut"] and {k: rep["cut"][k] for k in ("min_cut_edges", "patch_faces")},
          rep["fist_connected_to_torso_after"])


JU_ROLE = {"technik": "technik", "sprinter": "sprinter", "tank": "tank"}

if __name__ == "__main__":
    main()
