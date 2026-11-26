"""Joint positions measured on the customer's second Tripo set (user_meshes/v2/*.glb, prepared by
viewer/scripts/prep-meshes.mjs: facing front, feet on the floor, height 1.0).

Blender coords in model units before scaling: x = character's left, y = back, z = up. Read off
orthographic front/side renders with a 0.05 grid and checked with marker overlays
(review/v2/joints_<name>.png). Arms are free of the body (A-pose), hands have modelled fingers.
"""


def sym(d):
    out = dict(d)
    for k, v in d.items():
        if k.endswith("_L") and k[:-2] + "_R" not in d:
            out[k[:-2] + "_R"] = (-v[0], v[1], v[2])
    return out


def body(y, yh, z):
    """Centre line: y of the torso and of the head; z of pelvis, spine, chest, neck, head, head_end."""
    names = ("pelvis", "spine", "chest", "neck", "head", "head_end")
    return {n: (0.0, yh if n in ("neck", "head", "head_end") else y, zz) for n, zz in zip(names, z)}


TECHNIK = sym({
    **body(-0.035, -0.05, (0.43, 0.50, 0.58, 0.71, 0.76, 1.0)),
    "shoulder_L": (0.13, -0.03, 0.625), "elbow_L": (0.20, -0.03, 0.53),
    "wrist_L": (0.245, -0.08, 0.45), "hand_end_L": (0.28, -0.12, 0.34),
    "hip_L": (0.075, -0.03, 0.41), "knee_L": (0.09, -0.025, 0.26), "ankle_L": (0.10, 0.0, 0.10),
    "toe_L": (0.10, -0.16, 0.03),
})

SPRINTER = sym({
    **body(-0.10, -0.12, (0.47, 0.54, 0.61, 0.72, 0.75, 0.97)),
    "shoulder_L": (0.12, -0.07, 0.625), "elbow_L": (0.16, -0.07, 0.54),
    "wrist_L": (0.225, -0.12, 0.465), "hand_end_L": (0.27, -0.15, 0.38),
    "hip_L": (0.07, -0.08, 0.45), "knee_L": (0.09, -0.06, 0.27), "ankle_L": (0.10, -0.08, 0.11),
    "toe_L": (0.10, -0.20, 0.03),
})

TANK = sym({
    **body(0.0, -0.04, (0.45, 0.53, 0.62, 0.75, 0.80, 1.0)),
    "shoulder_L": (0.16, 0.0, 0.68), "elbow_L": (0.245, -0.02, 0.565),
    "wrist_L": (0.29, -0.04, 0.48), "hand_end_L": (0.32, -0.08, 0.355),
    "hip_L": (0.08, 0.0, 0.45), "knee_L": (0.10, 0.0, 0.27), "ankle_L": (0.11, 0.03, 0.12),
    "toe_L": (0.11, -0.14, 0.03),
})

SNIPER = sym({
    **body(-0.055, -0.08, (0.45, 0.53, 0.62, 0.78, 0.81, 1.0)),
    "shoulder_L": (0.15, -0.04, 0.68), "elbow_L": (0.235, -0.06, 0.565),
    "wrist_L": (0.28, -0.08, 0.49), "hand_end_L": (0.32, -0.10, 0.35),
    "hip_L": (0.08, -0.05, 0.45), "knee_L": (0.10, -0.06, 0.27), "ankle_L": (0.11, -0.05, 0.11),
    "toe_L": (0.11, -0.15, 0.03),
})

MEDIC = sym({
    **body(-0.09, -0.12, (0.47, 0.53, 0.60, 0.75, 0.78, 0.99)),
    "shoulder_L": (0.12, -0.08, 0.63), "elbow_L": (0.17, -0.09, 0.555),
    "wrist_L": (0.22, -0.13, 0.48), "hand_end_L": (0.27, -0.14, 0.39),
    "hip_L": (0.07, -0.08, 0.46), "knee_L": (0.09, -0.07, 0.27), "ankle_L": (0.10, -0.08, 0.11),
    "toe_L": (0.10, -0.20, 0.03),
})

MESHES = {"technik": TECHNIK, "sprinter": SPRINTER, "tank": TANK, "sniper": SNIPER, "medic": MEDIC}
