"""Rig, skin and animate the customer's second Tripo set (5 heroes) with the same pipeline as
build_user_character.py (18-bone DVOR skeleton, heat weights constrained by connectivity, 7 clips
retargeted from the A-pose library). The new meshes have free arms and modelled hands, so the
Technik arm cut and hands.py are not needed.

    /opt/dvor-venv/bin/python blender/user/build_v2.py --char technik|sprinter|tank|sniper|medic
    -> source/USER_HERO_<Name>.blend, export/raw/USER_HERO_<Name>.glb (+ .build.json)
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]

import build_user_character as B  # noqa: E402
import joints_v2 as J2  # noqa: E402

CHARS = list(J2.MESHES)
B.NAMES = {c: "HERO_" + c.capitalize() for c in CHARS}
B.SHOULDER_BALL = {"technik": 0.16, "sprinter": 0.15, "tank": 0.24, "sniper": 0.21, "medic": 0.15}
B.FIST_R = {"technik": 0.08, "sprinter": 0.07, "tank": 0.11, "sniper": 0.1, "medic": 0.07}
B.KEEP_REST_POSE = {}
B.JU_ROLE = {c: c for c in CHARS}
B.JU.MESHES = {c: (f"v2/{c}", J2.MESHES[c]) for c in CHARS}
B.U.cut_min_bridge = lambda *a, **k: None   # arms are already free of the body

if __name__ == "__main__":
    B.main()
