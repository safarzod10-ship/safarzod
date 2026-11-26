import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path[:0] = [HERE, os.path.dirname(HERE)]

import build_user_character as B
import joints_v2 as J2

CHARS = list(J2.MESHES)
B.NAMES = {c: "HERO_" + c.capitalize() for c in CHARS}
B.SHOULDER_BALL = {"technik": 0.16, "sprinter": 0.15, "tank": 0.24, "sniper": 0.21, "medic": 0.15}
B.FIST_R = {"technik": 0.08, "sprinter": 0.07, "tank": 0.11, "sniper": 0.1, "medic": 0.07}
B.KEEP_REST_POSE = {}
B.JU_ROLE = {c: c for c in CHARS}
B.JU.MESHES = {c: (f"v2/{c}", J2.MESHES[c]) for c in CHARS}
B.U.cut_min_bridge = lambda *a, **k: None

if __name__ == "__main__":
    B.main()
