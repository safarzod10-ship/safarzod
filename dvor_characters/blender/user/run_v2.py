"""Mocap Run clip (mocap_run.py) for the second Tripo set.

    /opt/dvor-venv/bin/python blender/user/run_v2.py --char technik|sprinter|tank|sniper|medic
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]

import mocap_run as M  # noqa: E402

M.NAMES = {c: "HERO_" + c.capitalize() for c in ("technik", "sprinter", "tank", "sniper", "medic")}
# Sniper runs holding the rifle in front of the chest: arms forward and in, almost no pump
M.PLAN["sniper"] = dict(take="09_01", tempo=1.0, crouch=0.05, hand_r=0.09, lane=0.95, toe_out=8, knee_out=14,
                        arms=dict(abd=8, off=40, amp=6, bend=88, bend_var=4, inward=28, wrist=8))
M.PLAN["medic"] = dict(take="09_05", tempo=1.25, crouch=0.05, hand_r=0.06, lane=0.85, toe_out=5, knee_out=9,
                       arms=dict(abd=16, off=9, amp=54, bend=90, bend_var=18, inward=4, wrist=30))

if __name__ == "__main__":
    M.main()
