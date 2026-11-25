"""Run clip from real motion capture (CMU mocap database, BVH) for the USER_CH_* characters.

    /opt/dvor-venv/bin/python blender/user/mocap_run.py --analyze            # cycles in mocap/cmu/*.bvh
    /opt/dvor-venv/bin/python blender/user/mocap_run.py --char technik|sprinter|tank

Steps (after build_user_character.py has produced source/USER_<NAME>.blend):
  1. import the BVH (CMU unit = 1/0.45 inch -> metres), at its native 120 fps
  2. find the cleanest 2-step cycle: the period T and start f0 where the pose at f0+T best matches f0
     (bone directions in the runner's heading frame + hips height)
  3. turn the take so that cycle runs along -Y (the characters face -Y)
  4. retarget with the blender-animation skill (scripts/retarget.py, --match-rest: CMU is a T-pose,
     our rigs are modelled A-poses; arms tilted outward per character so they clear the torso)
  5. resample to 30 fps with N frames per cycle; the seam is a cross-fade from the motion after the
     cycle, so first == last frame with matching velocity; forward travel removed (in place, bob and
     sway kept); torso rotations lightly smoothed (mocap jitter)
  6. feet: the deformed mesh's lowest point is put on the floor; during the mocap's stance frames the
     ball of each foot is pinned (2-bone IK, baked into the keys) and moves back at exactly the ground
     speed; no foot vertex goes below the floor
  7. replace the procedural Run action + NLA track, check the loop with scripts/loop_check.py,
     save the .blend, export export/raw/USER_<NAME>.glb, update the build report

The game speed that keeps the feet from sliding is measured (how fast the planted foot moves back in
the in-place clip) and written into the build report as Run.speed_mps; the residual slide is reported.
Data: "The data used in this project was obtained from mocap.cs.cmu.edu. The database was created
with funding from NSF EIA-0196217." (free for research and commercial use, see mocap/cmu/READMEFIRST.txt)
"""
import argparse
import glob
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
ROOT = os.path.dirname(BL)
SKILL = os.path.join(ROOT, ".claude", "skills", "blender-animation", "scripts")
sys.path[:0] = [HERE, BL, SKILL]

import bpy  # noqa: E402
from bpy_extras import anim_utils  # noqa: E402
from mathutils import Matrix, Quaternion, Vector  # noqa: E402

import dvor_lib as L  # noqa: E402
import retarget  # noqa: E402  (blender-animation skill)
import loop_check  # noqa: E402  (blender-animation skill)

CMU_UNIT = 0.0254 / 0.45
MOCAP = os.path.join(ROOT, "mocap", "cmu")
NAMES = {"technik": "CH_Technik", "sprinter": "CH_Sprinter", "tank": "CH_Tank"}
# take, cadence factor (>1 = quicker steps than the actor), arm tilt away from the body (deg),
# crouch = hips lowered by this share of the hip height while the feet are pinned
PLAN = {
    # cycle times match the earlier procedural Run (0.67 / 0.53 / 0.80 s) so the game feel stays
    "technik": dict(take="09_01", tempo=1.1, arm_out=14, crouch=0.05, hand_r=0.07),     # run
    "sprinter": dict(take="09_05", tempo=1.4, arm_out=10, crouch=0.05, hand_r=0.07),    # run, quicker steps
    "tank": dict(take="35_17", tempo=0.93, arm_out=24, crouch=0.06, hand_r=0.12),       # jog, heavier
}
FEATURE_BONES = ["LeftUpLeg", "LeftLeg", "LeftFoot", "RightUpLeg", "RightLeg", "RightFoot",
                 "LeftArm", "LeftForeArm", "RightArm", "RightForeArm", "Spine1", "Head"]


def import_bvh(take):
    before = set(bpy.data.objects)
    bpy.ops.import_anim.bvh(filepath=os.path.join(MOCAP, f"{take}.bvh"), global_scale=CMU_UNIT,
                            rotate_mode="NATIVE", update_scene_fps=False, use_fps_scale=False,
                            update_scene_duration=True)
    ob = (set(bpy.data.objects) - before).pop()
    ob.name = f"MOCAP_{take}"
    return ob


def sample(src, f0, f1):
    """Per frame: hips world position and bone directions."""
    out = []
    sc = bpy.context.scene
    mw = src.matrix_world
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        pb = src.pose.bones
        dirs = {b: (mw.to_3x3() @ (pb[b].tail - pb[b].head)).normalized() for b in FEATURE_BONES}
        feet = [min((mw @ pb[b].head).z, (mw @ pb[b].tail).z) for b in ("LeftToeBase", "RightToeBase")]
        out.append({"f": f, "hips": mw @ pb["Hips"].head, "dirs": dirs, "feet": feet})
    return out


def find_cycle(src):
    f_start, f_end = (int(v) for v in src.animation_data.action.frame_range)
    S = sample(src, f_start, f_end)
    best = None
    for T in range(55, 121):
        for i in range(2, len(S) - T - 2):
            a, b = S[i], S[i + T]
            travel = b["hips"] - a["hips"]
            travel.z = 0
            if travel.length < 0.5:
                continue
            ang = sum(a["dirs"][k].angle(b["dirs"][k]) for k in FEATURE_BONES) / len(FEATURE_BONES)
            # also match velocity across the seam (next frame)
            a2, b2 = S[i + 1], S[i + T + 1]
            ang2 = sum(a2["dirs"][k].angle(b2["dirs"][k]) for k in FEATURE_BONES) / len(FEATURE_BONES)
            dz = abs(a["hips"].z - b["hips"].z)
            score = math.degrees(ang + ang2) / 2 + dz * 100
            if best is None or score < best[0]:
                best = (score, S[i]["f"], T, travel.length, math.degrees((ang + ang2) / 2), dz)
    score, f0, T, dist, deg, dz = best
    seg = S[f0 - f_start:f0 - f_start + T + 1]
    heading = seg[-1]["hips"] - seg[0]["hips"]
    heading.z = 0
    return {"f0": f0, "T": T, "seconds": T / 120, "stride_m": dist, "speed_mps": dist / (T / 120),
            "seam_deg": deg, "seam_hips_dz_m": dz, "heading": heading.normalized(),
            "hips_z": sum(s["hips"].z for s in seg) / len(seg), "score": score}


def analyze():
    rows = []
    for path in sorted(glob.glob(os.path.join(MOCAP, "*.bvh"))):
        take = os.path.basename(path)[:-4]
        L.reset_scene()
        bpy.context.scene.render.fps = 120
        src = import_bvh(take)
        c = find_cycle(src)
        rows.append({"take": take, **{k: (round(v, 3) if isinstance(v, float) else v) for k, v in c.items() if k != "heading"}})
        print("CYCLE", json.dumps(rows[-1]))
    return rows


def lowest_foot(rig, frames):
    """Lowest point of the foot bones (head = ankle, tail = toe) per frame, armature space."""
    sc = bpy.context.scene
    out = []
    for f in frames:
        sc.frame_set(f)
        out.append(min(min(rig.pose.bones[b].head.z, rig.pose.bones[b].tail.z) for b in ("foot.L", "foot.R")))
    return out


def fcurves_of(rig, act):
    return anim_utils.action_get_channelbag_for_slot(act, act.slots[0]).fcurves


def build(ch):
    name = NAMES[ch]
    plan = PLAN[ch]
    blend = os.path.join(ROOT, "source", f"USER_{name}.blend")
    bpy.ops.wm.open_mainfile(filepath=blend)
    sc = bpy.context.scene
    rig = bpy.data.objects[f"USER_{name}_Rig"]
    mesh = bpy.data.objects[f"USER_{name}_LOD0"]
    rig.animation_data.action = None
    for tr in rig.animation_data.nla_tracks:
        tr.mute = True
    L.set_rest(rig)
    sc.frame_set(1)
    rest_floor = mesh_low(mesh, [1])[0]

    sc.render.fps = 120
    src = import_bvh(plan["take"])
    cyc = find_cycle(src)
    # turn the take so the chosen cycle runs along -Y
    h = cyc["heading"]
    yaw = math.atan2(h.x, -h.y)
    src.matrix_world = Matrix.Rotation(-yaw, 4, "Z") @ src.matrix_world
    bpy.context.view_layer.update()

    f0, T = cyc["f0"], cyc["T"]
    arm_out = plan["arm_out"]
    # L arm hangs at +X: tilting it outward is a rotation about -Y (character forward); mirrored for R
    bias = {}
    for b in ("upper_arm", "forearm", "hand"):
        bias[f"{b}.L"] = [0, 1, 0, arm_out]
        bias[f"{b}.R"] = [0, 1, 0, -arm_out]
    stance_src = source_stance(src, f0, T)
    f_last = int(src.animation_data.action.frame_range[1])
    W_src = min(int(T * 0.35), f_last - (f0 + T))   # cross-fade window, source frames after the cycle
    res = retarget.run(source=src.name, target=rig.name, frames=[f0, f0 + T + W_src], name="RunMocap",
                       match_rest=True, rest_bias=bias)
    print("RETARGET", res)
    raw = bpy.data.actions[res["action"]]

    # --- resample to 30 fps with N frames per cycle. Seam: the first W frames cross-fade from the
    # motion that follows the cycle end (S(t+T)) into the cycle itself (S(t)), so frame 0 == frame N
    # with the same velocity on both sides. In place: the hips' forward travel is removed.
    N = max(8, round(T / 120 * L.FPS / plan["tempo"]))
    W = max(1, round(N * W_src / T))
    fcs = fcurves_of(rig, raw)
    paths = sorted({(fc.data_path, fc.array_index) for fc in fcs})
    get = {(fc.data_path, fc.array_index): fc for fc in fcs}
    lp = 'pose.bones["pelvis"].location'
    R3 = rig.data.bones["pelvis"].matrix_local.to_3x3()

    def pose_at(t):
        out = {}
        for dp in sorted({p[0] for p in paths}):
            n = 4 if dp.endswith("rotation_quaternion") else 3
            v = [get[(dp, i)].evaluate(t) if (dp, i) in get else 0.0 for i in range(n)]
            out[dp] = Quaternion(v) if n == 4 else R3 @ Vector(v)   # pelvis loc -> armature space
        return out

    P0, PT = pose_at(f0), pose_at(f0 + T)
    drift = PT[lp] - P0[lp]
    drift.z = 0
    stride_target = drift.length
    frames = []
    for k in range(N + 1):
        t = f0 + T * k / N
        A = pose_at(t)
        A[lp] = A[lp] - drift * (k / N)
        if k < W:
            B = pose_at(t + T)
            B[lp] = B[lp] - drift - drift * (k / N)
            w = 0.5 * (1 + math.cos(math.pi * k / W))   # 1 at k=0 -> 0 at k=W
            for dp in A:
                if dp == lp:
                    A[dp] = A[dp].lerp(B[dp], w)
                else:
                    A[dp] = A[dp].slerp(B[dp], w)
        frames.append(A)
    # clean mocap jitter on the torso (pelvis..head): one cyclic [1 2 1]/4 pass on the rotations
    for b in ("pelvis", "spine", "chest", "neck", "head"):
        dp = f'pose.bones["{b}"].rotation_quaternion'
        if dp not in frames[0]:
            continue
        q = [frames[k][dp] for k in range(N)]
        sm = []
        for k in range(N):
            a, c = q[k - 1].copy(), q[(k + 1) % N].copy()
            if a.dot(q[k]) < 0:
                a.negate()
            if c.dot(q[k]) < 0:
                c.negate()
            sm.append(a.slerp(c, 0.5).slerp(q[k], 0.5))
        for k in range(N):
            frames[k][dp] = sm[k]
    frames[N] = {dp: v.copy() for dp, v in frames[0].items()}
    mx = sum(f[lp].x for f in frames[:N]) / N
    my = sum(f[lp].y for f in frames[:N]) / N
    vals = {p: [] for p in paths}
    prev = {}
    for f in frames:
        for dp, v in f.items():
            if dp == lp:
                v = R3.inverted() @ (v - Vector((mx, my, 0)))
                for i in range(3):
                    vals[(dp, i)].append(v[i])
            else:
                q = v.normalized()
                if dp in prev and prev[dp].dot(q) < 0:
                    q.negate()
                prev[dp] = q
                for i in range(4):
                    vals[(dp, i)].append(q[i])
    for dp in prev:  # the copied last frame must keep the sign of the curve's end
        q = Quaternion([vals[(dp, i)][N] for i in range(4)])
        q_before = Quaternion([vals[(dp, i)][N - 1] for i in range(4)])
        if q.dot(q_before) < 0:
            for i in range(4):
                vals[(dp, i)][N] = -vals[(dp, i)][N]

    # write the final action at frames 1..N+1 (loop: last == first)
    old = bpy.data.actions.get("Run")
    for tr in list(rig.animation_data.nla_tracks):
        if tr.name == "Run":
            rig.animation_data.nla_tracks.remove(tr)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new("Run")
    act.use_fake_user = True
    rig.animation_data.action = act
    slot = act.slots.new(id_type="OBJECT", name=rig.name)
    rig.animation_data.action_slot = slot
    cb = retarget.bx.ensure_channelbag(act, slot)
    for (dp, i), vs in vals.items():
        fc = retarget.bx.fcurve_ensure(cb, dp, index=i, group_name=dp.split('"')[1])
        fc.keyframe_points.add(len(vs))
        fc.keyframe_points.foreach_set("co", [c for k, v in enumerate(vs) for c in (k + 1, v)])
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"
        fc.update()
    bpy.data.actions.remove(raw)
    stance = {side: [stance_src[side][int(T * k / N)] for k in range(N)] for side in ("L", "R")}
    print("STANCE", {s: "".join("#" if x else "." for x in v) for s, v in stance.items()}, {s: "".join("#" if x else "." for x in v) for s, v in stance_src.items()})

    # feet on the ground: shift the hips so the lowest point of the deformed mesh over the cycle
    # equals the mesh's lowest point in its rest pose
    def shift_hips(dz):
        off_l = R3.inverted() @ Vector((0, 0, dz))
        for i in range(3):
            fc = cb.fcurves.find(lp, index=i)
            for kp in fc.keyframe_points:
                kp.co.y += off_l[i]
            fc.update()
    shift_hips(rest_floor - min(mesh_low(mesh, range(1, N + 2))))
    hip_h = rig.data.bones["thigh.L"].head_local.z - rest_floor
    # ground speed = how fast the planted ball of the foot moves back in the in-place clip (median, stance frames)
    seconds = N / L.FPS
    speed = ankle_speed(rig, N, stance)
    hips_speed = stride_target / seconds
    before = measure_contact(rig, N, speed, stance)
    # foot lock (IK pins, then baked into the keys): during stance the ankle follows the ground
    lock_feet(rig, cb, N, speed, stance, drop=lambda: shift_hips(-plan["crouch"] * hip_h),
              sole=foot_soles(rig, mesh), floor=rest_floor)
    arms = clear_arms(rig, cb, N, torso_points(rig, mesh), plan["hand_r"])
    slide = measure_contact(rig, N, speed, stance)
    slide["before_lock"] = before
    slide["mesh_floor"] = mesh_floor_report(mesh, N, stance, rest_floor)
    act["loop"] = True
    act["speed_mps"] = round(speed, 3)
    act["source"] = f"CMU mocap {plan['take']}, frames {f0}-{f0 + T} @120 fps"
    act.frame_range = (1, N + 1)
    lc = loop_check.run(object=rig.name, action="Run", frames=[1, N + 1])
    print("LOOP", lc)
    rig.animation_data.action = None
    tr = rig.animation_data.nla_tracks.new()
    tr.name = "Run"
    tr.strips.new("Run", 1, act)
    tr.mute = True
    # restore track order = clip order (cosmetic; glTF export takes all actions)
    L.set_rest(rig)
    sc.render.fps = L.FPS
    bpy.data.objects.remove(src)
    for a in list(bpy.data.actions):
        if a.users == 0 and not a.use_fake_user:
            bpy.data.actions.remove(a)
    for arm in list(bpy.data.armatures):
        if arm.users == 0:
            bpy.data.armatures.remove(arm)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    raw_glb = os.path.join(ROOT, "export", "raw", f"USER_{name}.glb")
    L.export_glb(raw_glb, [rig, mesh])

    rep_path = os.path.join(ROOT, "export", "raw", f"USER_{name}.build.json")
    rep = json.load(open(rep_path))
    rep["clips"]["Run"] = {
        "duration_s": round(seconds, 3), "loop": True, "speed_mps": round(speed, 3),
        "source": "CMU mocap " + plan["take"], "source_frames_120fps": [f0, f0 + T],
        "source_speed_mps": round(cyc["speed_mps"], 3), "hips_stride_speed_mps": round(hips_speed, 3), "seam_mismatch_deg_before_fix": round(cyc["seam_deg"], 2),
        "tempo": plan["tempo"], "arm_out_deg": arm_out, "retarget_max_error_deg": res["max_error_deg"],
        "hips_scale": res["hips_scale"], "loop_check": lc, "foot_contact": slide, "arms_vs_torso": arms,
    }
    rep["files"]["blend_bytes"] = os.path.getsize(blend)
    rep["files"]["raw_glb_bytes"] = os.path.getsize(raw_glb)
    L.write_json(rep_path, rep)
    print("RUN", json.dumps(rep["clips"]["Run"]))


def source_stance(src, f0, T):
    """Planted-foot frames of the mocap cycle: toe joint within 6 cm of the take's floor and moving
    slower than 1 m/s over the ground. Index = source frame - f0, 0..T-1."""
    sc = bpy.context.scene
    mw = src.matrix_world
    pos = {"L": [], "R": []}
    for f in range(f0 - 1, f0 + T + 1):
        sc.frame_set(f)
        for side, b in (("L", "LeftToeBase"), ("R", "RightToeBase")):
            pos[side].append(mw @ src.pose.bones[b].head)
    floor = min(p.z for side in pos for p in pos[side])
    out = {}
    for side in pos:
        P = pos[side]
        st = []
        for i in range(1, T + 1):
            v = (P[i + 1] - P[i - 1]) * 60.0   # 120 fps, central difference
            st.append(P[i].z < floor + 0.06 and math.hypot(v.x, v.y) < 1.0)
        # close short gaps (threshold flicker, up to 6 source frames = 50 ms), cyclic
        n = len(st)
        for i in range(n):
            if st[i] and not st[(i + 1) % n]:
                for g in range(2, 8):
                    if st[(i + g) % n]:
                        for j in range(1, g):
                            st[(i + j) % n] = True
                        break
        out[side] = st
    return out


def mesh_low(mesh, frames):
    """Lowest world z of the deformed mesh per frame."""
    sc = bpy.context.scene
    out = []
    for f in frames:
        sc.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        ob = mesh.evaluated_get(dg)
        me = ob.to_mesh()
        mw = ob.matrix_world
        out.append(min((mw @ v.co).z for v in me.vertices))
        ob.to_mesh_clear()
    return out


def ankles(rig, N):
    """Contact point of each foot per frame (the foot bone's tail = ball/toe; runners land on it)."""
    sc = bpy.context.scene
    out = []
    for f in range(1, N + 2):
        sc.frame_set(f)
        out.append({side: rig.pose.bones[f"foot.{side}"].tail.copy() for side in ("L", "R")})
    return out


def ankle_speed(rig, N, stance):
    tr = ankles(rig, N)
    v = sorted((tr[k + 1][s].y - tr[k][s].y) * L.FPS for k in range(N) for s in ("L", "R")
               if stance[s][k] and stance[s][(k + 1) % N])
    return v[len(v) // 2] if v else 0.0


def measure_contact(rig, N, speed, stance):
    """With the character moving at `speed` along -Y: horizontal world speed of each planted ankle."""
    tr = ankles(rig, N)
    sl = []
    for k in range(N):
        for s in ("L", "R"):
            if stance[s][k] and stance[s][(k + 1) % N]:
                d = tr[k + 1][s] - tr[k][s]
                sl.append(math.hypot(d.x * L.FPS, d.y * L.FPS - speed))
    if not sl:
        return {"stance_frames": 0}
    return {"stance_frames": len(sl), "slide_max_mps": round(max(sl), 3),
            "slide_mean_mps": round(sum(sl) / len(sl), 3),
            "slide_mean_pct_of_speed": round(100 * sum(sl) / len(sl) / speed, 1)}


def mesh_floor_report(mesh, N, stance, rest_floor):
    lows = mesh_low(mesh, range(1, N + 1))
    st = [lows[k] - rest_floor for k in range(N) if stance["L"][k] or stance["R"][k]]
    return {"lowest_over_cycle_m": round(min(lows) - rest_floor, 4),
            "stance_sole_height_m": [round(min(st), 4), round(max(st), 4)] if st else None,
            "highest_flight_m": round(max(lows) - rest_floor, 4)}


def _runs(flags):
    """Cyclic runs of True: list of index lists."""
    n = len(flags)
    if all(flags):
        return [list(range(n))]
    start = next(i for i in range(n) if not flags[i])
    runs, cur = [], []
    for j in range(1, n + 1):
        i = (start + j) % n
        if flags[i]:
            cur.append(i)
        elif cur:
            runs.append(cur)
            cur = []
    if cur:
        runs.append(cur)
    # unwrap runs that cross the loop seam so indices increase (use i % n to index frames)
    return [[i + n if j and i < r[0] else i for j, i in enumerate(r)] for r in runs]


def foot_soles(rig, mesh):
    """Vertices of each foot (foot-dominant, plus shin-dominant ones below the ankle), foot rest space."""
    to_arm = rig.matrix_world.inverted() @ mesh.matrix_world
    out = {"L": [], "R": []}
    gi = {g.index: g.name for g in mesh.vertex_groups}
    for v in mesh.data.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda e: e.weight)
        name = gi.get(g.group, "")
        if not name.startswith(("foot.", "shin.")):
            continue
        side = name[-1]
        foot = rig.data.bones[f"foot.{side}"]
        p = to_arm @ v.co
        # foot-dominant vertices, and the shin's boot/heel below the ankle (rigid with the foot approx.)
        if name.startswith("foot.") or p.z < foot.head_local.z:
            out[side].append(foot.matrix_local.inverted() @ p)
    return {k: v for k, v in out.items() if v}


TORSO = ("pelvis", "spine", "chest")


def torso_points(rig, mesh):
    """Torso vertices (dominant pelvis/spine/chest weight) in their bone's rest space."""
    to_arm = rig.matrix_world.inverted() @ mesh.matrix_world
    gi = {g.index: g.name for g in mesh.vertex_groups}
    out = []
    for v in mesh.data.vertices:
        if not v.groups:
            continue
        g = max(v.groups, key=lambda e: e.weight)
        b = gi.get(g.group, "")
        if b in TORSO:
            out.append((b, rig.data.bones[b].matrix_local.inverted() @ (to_arm @ v.co)))
    return out


def _torso_bins(P, pts, step=0.04):
    """Per 4 cm height slice of the posed torso: centre and half extents (x, y)."""
    bins = {}
    for b, v in pts:
        p = P[b] @ v
        k = int(math.floor(p.z / step))
        bins.setdefault(k, []).append(p)
    out = {}
    for k, ps in bins.items():
        xs, ys = [p.x for p in ps], [p.y for p in ps]
        out[k] = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2)
    return out, step


def _inside(bins, p, r):
    tb, step = bins
    e = tb.get(int(math.floor(p.z / step)))
    if not e:
        return False
    cx, cy, a, b = e
    return ((p.x - cx) / (a + r)) ** 2 + ((p.y - cy) / (b + r)) ** 2 < 1.0


def clear_arms(rig, cb, N, pts, hand_r, max_upper=30, max_fore=70):
    """Arms of a slim mocap actor go through a chibi's wide torso. Per frame: if the elbow, wrist or
    fist (radius hand_r) is inside the posed torso (elliptic slices), swing the upper arm out (up to
    max_upper deg), then the forearm (up to max_fore deg) by the smallest angle that clears it.
    Angles are smoothed over time so the push never pops. Returns frames inside before/after."""
    sc = bpy.context.scene
    bones = rig.data.bones
    rest_rel = {b.name: (b.parent.matrix_local.inverted() @ b.matrix_local) for b in bones if b.parent}

    def chain(P, s):
        ua, fa, hd = (f"upper_arm.{s}", f"forearm.{s}", f"hand.{s}")
        S, E, Wr = P[ua].translation, P[fa].translation, P[hd].translation
        tip = P[hd] @ Vector((0, bones[hd].length, 0))
        return S, E, Wr, tip

    def hits(bins, pts_r):
        return any(_inside(bins, p, r) for p, r in pts_r)

    def count_inside():
        n = 0
        for k in range(N):
            sc.frame_set(k + 1)
            P = {pb.name: pb.matrix.copy() for pb in rig.pose.bones}
            bins = _torso_bins(P, pts)
            for s in ("L", "R"):
                S, E, Wr, tip = chain(P, s)
                n += hits(bins, [(E, 0.03), (Wr, hand_r * 0.7), (tip, hand_r * 0.7)])
        return n

    before = count_inside()
    for stage, bone, limit in (("upper", "upper_arm", max_upper), ("fore", "forearm", max_fore)):
        ang = {s: [0.0] * N for s in ("L", "R")}
        axes = {s: [None] * N for s in ("L", "R")}
        for k in range(N):
            sc.frame_set(k + 1)
            P = {pb.name: pb.matrix.copy() for pb in rig.pose.bones}
            bins = _torso_bins(P, pts)
            for s in ("L", "R"):
                S, E, Wr, tip = chain(P, s)
                out_x = Vector((1 if s == "L" else -1, 0, 0))
                piv = S if stage == "upper" else E
                ends = [(E, 0.03), (Wr, hand_r * 0.7), (tip, hand_r * 0.7)] if stage == "upper" else [(Wr, hand_r * 0.7), (tip, hand_r * 0.7)]
                seg = (E - S) if stage == "upper" else (Wr - E)
                ax = seg.normalized().cross(out_x)
                if ax.length < 1e-4:
                    continue
                ax.normalize()
                axes[s][k] = ax
                for deg in range(0, limit + 1, 2):
                    R = Quaternion(ax, math.radians(deg)).to_matrix()
                    moved = [(piv + R @ (p - piv), r) for p, r in ends]
                    if not hits(bins, moved):
                        break
                ang[s][k] = deg
        for s in ("L", "R"):  # smooth: widen to neighbours, then [1 2 1]/4, never below the need
            a0 = ang[s]
            a1 = [max(a0[k], 0.7 * a0[k - 1], 0.7 * a0[(k + 1) % N]) for k in range(N)]
            a2 = [max(a0[k], (a1[k - 1] + 2 * a1[k] + a1[(k + 1) % N]) / 4) for k in range(N)]
            ang[s] = a2
        for k in range(N):
            sc.frame_set(k + 1)
            P = {pb.name: pb.matrix.copy() for pb in rig.pose.bones}
            for s in ("L", "R"):
                a = ang[s][k]
                if a <= 0 or axes[s][k] is None:
                    continue
                b = f"{bone}.{s}"
                piv = P[b].translation
                Rq = Quaternion(axes[s][k], math.radians(a))
                M = Matrix.LocRotScale(piv, Rq @ P[b].to_quaternion(), None)
                parent = bones[b].parent.name
                q = ((P[parent] @ rest_rel[b]).inverted() @ M).to_quaternion().normalized()
                dp = f'pose.bones["{b}"].rotation_quaternion'
                fcs = [cb.fcurves.find(dp, index=i) for i in range(4)]
                old = Quaternion([fc.keyframe_points[k].co.y for fc in fcs])
                if old.dot(q) < 0:
                    q.negate()
                for i, fc in enumerate(fcs):
                    fc.keyframe_points[k].co.y = q[i]
                    if k == 0:
                        fc.keyframe_points[N].co.y = q[i]
        for fc in cb.fcurves:
            fc.update()
    return {"arm_in_torso_frames_before": before, "after": count_inside(), "of": 2 * N}


def lock_feet(rig, cb, N, speed, stance, ease=2, drop=None, sole=None, floor=0.0):
    """Two-bone IK pin of the foot's contact point (ball/toe) during stance, baked into the thigh/shin/foot keys. The pinned
    ankle moves back at exactly `speed` (in place), anchored at the middle of each stance; `ease`
    frames on each side blend in/out. `drop` lowers the hips after the pins are placed (chibi legs are
    short for an adult's stride: without slack the leg straightens and the foot is dragged). The foot keeps its world orientation (heel-toe roll stays)."""
    sc = bpy.context.scene
    dt = 1.0 / L.FPS
    targets = {s: {} for s in ("L", "R")}
    tr = ankles(rig, N)
    for s in ("L", "R"):
        for run in _runs(stance[s]):
            mid = run[len(run) // 2]
            anchor = tr[mid % N][s]
            span = list(range(run[0] - ease, run[-1] + ease + 1))
            for j in span:
                k = j % N
                d = j - mid   # frames from the anchor (unwrapped)
                w = 1.0
                if j < run[0]:
                    w = (j - (run[0] - ease - 1)) / (ease + 1)
                elif j > run[-1]:
                    w = ((run[-1] + ease + 1) - j) / (ease + 1)
                w = 0.5 - 0.5 * math.cos(math.pi * w)
                targets[s][k] = (anchor + Vector((0, speed * d * dt, 0)), w)
    if drop:   # lower the hips a little after the pins are placed: the knees get slack to hold them
        drop()
    bones = rig.data.bones
    rest_rel = {b.name: (b.parent.matrix_local.inverted() @ b.matrix_local) for b in bones if b.parent}
    for k in range(N):
        sc.frame_set(k + 1)
        P = {pb.name: pb.matrix.copy() for pb in rig.pose.bones}
        new = {}
        for s in ("L", "R"):
            th, sh, ft = f"thigh.{s}", f"shin.{s}", f"foot.{s}"
            H, K, A = P[th].translation, P[sh].translation, P[ft].translation
            toe = P[ft] @ Vector((0, bones[ft].length, 0))
            if k not in targets[s]:
                # swing foot: only lift it out of the floor if it dips below
                low = min((P[ft] @ v).z for v in sole[s]) if sole and s in sole else floor
                if low >= floor:
                    continue
                goal, w = toe + Vector((0, 0, floor - low)), 1.0
            else:
                goal, w = targets[s][k]
            if sole and s in sole:   # pin height: the foot's lowest vertex touches the floor
                low = min((P[ft] @ v).z for v in sole[s])
                goal = Vector((goal.x, goal.y, floor + (toe.z - low)))
            A_t = A.lerp(goal - (toe - A), w)        # ankle goal that puts the toe on the pin
            if sole and s in sole:   # eased frames: never let the blend push the sole into the floor
                low_new = min((P[ft] @ v).z for v in sole[s]) + (A_t.z - A.z)
                if low_new < floor:
                    A_t.z += floor - low_new
            l1, l2 = (K - H).length, (A - K).length
            d = A_t - H
            dist = min(max(d.length, abs(l1 - l2) + 1e-4), l1 + l2 - 1e-4)
            u = d.normalized()
            pole = (K - H) - u * (K - H).dot(u)
            if pole.length < 1e-6:
                pole = Vector((0, -1, 0))
            pole.normalize()
            a = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist)
            h = math.sqrt(max(0.0, l1 * l1 - a * a))
            K2 = H + u * a + pole * h
            A2 = H + u * dist
            S1 = (K - H).normalized().rotation_difference((K2 - H).normalized())
            Rt = S1 @ P[th].to_quaternion()
            d1 = S1 @ (A - K)
            S2 = d1.normalized().rotation_difference((A2 - K2).normalized())
            Rs = S2 @ S1 @ P[sh].to_quaternion()
            new[th] = Matrix.LocRotScale(H, Rt, None)
            new[sh] = Matrix.LocRotScale(K2, Rs, None)
            new[ft] = Matrix.LocRotScale(A2, P[ft].to_quaternion(), None)
        if not new:
            continue
        P.update(new)
        for b in new:
            parent = bones[b].parent.name
            local = (P[parent] @ rest_rel[b]).inverted() @ P[b]
            q = local.to_quaternion().normalized()
            dp = f'pose.bones["{b}"].rotation_quaternion'
            fcs = [cb.fcurves.find(dp, index=i) for i in range(4)]
            old = Quaternion([fc.keyframe_points[k].co.y for fc in fcs])
            if old.dot(q) < 0:
                q.negate()
            for i, fc in enumerate(fcs):
                fc.keyframe_points[k].co.y = q[i]
                if k == 0:
                    fc.keyframe_points[N].co.y = q[i]
    for fc in cb.fcurves:
        fc.update()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--char", choices=list(NAMES))
    ap.add_argument("--analyze", action="store_true")
    a = ap.parse_args()
    if a.analyze:
        analyze()
    else:
        build(a.char)


if __name__ == "__main__":
    main()
