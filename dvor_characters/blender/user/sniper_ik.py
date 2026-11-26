import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BL = os.path.dirname(HERE)
ROOT = os.path.dirname(BL)
sys.path[:0] = [HERE, BL]

import bpy
from mathutils import Vector

import dvor_lib as L

NAME = "USER_HERO_Sniper"
SKIP = {"Victory"}
ARM = ["upper_arm.L", "forearm.L", "hand.L", "upper_arm.R", "forearm.R", "hand.R"]


def main():
    blend = os.path.join(ROOT, "source", f"{NAME}.blend")
    bpy.ops.wm.open_mainfile(filepath=blend)
    rig = bpy.data.objects[f"{NAME}_Rig"]
    obj = bpy.data.objects[f"{NAME}_LOD0"]
    rep_path = os.path.join(ROOT, "export", "raw", f"{NAME}.build.json")
    rep = json.load(open(rep_path))
    stock = Vector(rep["rifle"]["stock_m"])
    aim = Vector(rep["rifle"]["aim"]).normalized()
    side = Vector((-1, 0, 0))
    grips = {
        "R": stock + aim * 0.20 + Vector((0, 0, -0.05)) + side * 0.03,
        "L": stock + aim * 0.46 + Vector((0, 0, -0.06)) - side * 0.02,
    }
    poles = {"R": Vector((-0.55, 0.15, 0.75)), "L": Vector((0.55, 0.15, 0.75))}

    chest = rig.data.bones["chest"]
    empties = {}
    for s, p in list(grips.items()) + [(f"pole{s}", poles[s]) for s in "LR"]:
        e = bpy.data.objects.new(f"IK_{s}", None)
        bpy.context.scene.collection.objects.link(e)
        e.parent = rig
        e.parent_type = "BONE"
        e.parent_bone = "chest"
        e.matrix_world = rig.matrix_world @ __import__("mathutils").Matrix.Translation(p)
        empties[s] = e
    bpy.context.view_layer.update()

    for s in "LR":
        pb = rig.pose.bones[f"forearm.{s}"]
        c = pb.constraints.new("IK")
        c.target = empties[s]
        c.pole_target = empties[f"pole{s}"]
        c.pole_angle = 0.0
        c.chain_count = 2
        c.use_tail = True
        c.name = "RIFLE_IK"

    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="POSE")
    baked = []
    for tr in rig.animation_data.nla_tracks:
        for st in tr.strips:
            act = st.action
            if not act or act.name in SKIP:
                continue
            f0, f1 = (int(round(v)) for v in act.frame_range)
            rig.animation_data.action = act
            for b in rig.data.bones:
                b.select = b.name in ARM
            bpy.ops.nla.bake(frame_start=f0, frame_end=f1, step=1, only_selected=True, visual_keying=True,
                             clear_constraints=False, use_current_action=True, bake_types={"POSE"})
            baked.append(act.name)
    rig.animation_data.action = None
    for s in "LR":
        pb = rig.pose.bones[f"forearm.{s}"]
        pb.constraints.remove(pb.constraints["RIFLE_IK"])
    bpy.ops.object.mode_set(mode="OBJECT")
    for e in empties.values():
        bpy.data.objects.remove(e, do_unlink=True)
    L.set_rest(rig)
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    raw = os.path.join(ROOT, "export", "raw", f"{NAME}.glb")
    L.export_glb(raw, [rig, obj])
    rep["rifle"]["hands_ik"] = {"clips": baked, "grips_m": {k: [round(x, 3) for x in v] for k, v in grips.items()}}
    L.write_json(rep_path, rep)
    print("IK", rep["rifle"]["hands_ik"])


if __name__ == "__main__":
    main()
