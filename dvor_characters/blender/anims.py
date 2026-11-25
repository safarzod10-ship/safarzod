"""Procedural clip library shared by the DVOR skeleton family.

Rotations: XYZ euler degrees in the parent's (posed) frame aligned with the armature axes,
L-side convention (dvor_lib.pose_to_local mirrors *.R).
  rx < 0 swings a limb forward, rx > 0 bends a knee / leans the spine forward
  ry < 0 raises an arm outward (abduction); rz turns the torso/head to the character's left
Pelvis 'loc' is an offset in metres in armature space (Z up, -Y forward).
Roles only change timing and pose emphasis; bone names, hierarchy and clip names are identical.
"""
import math

ROLE = {
    "technik": dict(run_frames=20, run_amp=40, lean=11, bob=0.022, heavy=0.0, arm_in=6),
    "tank": dict(run_frames=24, run_amp=30, lean=8, bob=0.03, heavy=1.0, arm_in=-6),
    "sprinter": dict(run_frames=16, run_amp=50, lean=16, bob=0.02, heavy=-0.5, arm_in=8),
}


def sym(pose, base, rot, rot_r=None):
    pose[base + ".L"] = rot
    pose[base + ".R"] = rot if rot_r is None else rot_r
    return pose


def ready(role):
    """Neutral combat-ready stance used as start/end of one-shot clips."""
    r = ROLE[role]
    p = {"spine": (3, 0, 0), "chest": (-2, 0, 0), "head": (-2, 0, 0)}
    sym(p, "upper_arm", (4, r["arm_in"], 0))
    sym(p, "forearm", (-18, 0, 0))
    sym(p, "thigh", (-4, -3 - 3 * r["heavy"], 0))
    sym(p, "shin", (8, 0, 0))
    sym(p, "foot", (-4, 3 + 3 * r["heavy"], 0))
    p["loc"] = (0, 0, -0.012)
    return p


def blend(a, b, t):
    out = {}
    for k in set(a) | set(b):
        va, vb = a.get(k, (0, 0, 0)), b.get(k, (0, 0, 0))
        out[k] = tuple(x + (y - x) * t for x, y in zip(va, vb))
    return out


def over(base, **bones):
    p = dict(base)
    for k, v in bones.items():
        p[k.replace("_L", ".L").replace("_R", ".R")] = v
    return p


# ------------------------------------------------------------------ clips
def idle(role):
    r = ROLE[role]
    a = ready(role)
    amp = 1.0 + 0.6 * max(0, r["heavy"])
    keys = []
    n = 60
    for f in range(0, n + 1, 6):
        ph = 2 * math.pi * f / n
        s = math.sin(ph)
        p = dict(a)
        p["chest"] = (-2 - 2.5 * amp * s, 0, 0)
        p["spine"] = (3 + 0.8 * s, 1.5 * math.sin(ph / 1), 0)
        p["head"] = (-2 + 1.5 * s, 0, 3 * math.sin(ph + 1.0))
        sym(p, "upper_arm", (4 - 2 * s, r["arm_in"] - 2.5 * amp * s, 0))
        sym(p, "forearm", (-18 - 4 * s, 0, 0))
        p["loc"] = (0.006 * math.sin(ph), 0, -0.012 + 0.006 * amp * s)
        if role == "sprinter":   # light bounce on the toes
            p["loc"] = (0.01 * math.sin(ph), 0, -0.01 + 0.012 * abs(math.sin(ph)))
        keys.append((f + 1, p))
    return keys, True, {}


def run(role):
    r = ROLE[role]
    n, A = r["run_frames"], r["run_amp"]
    keys = []
    for f in range(0, n + 1, 2):
        ph = 2 * math.pi * f / n
        s, c = math.sin(ph), math.cos(ph)
        p = {}
        for side, sg in (("L", 1), ("R", -1)):
            ss, cc = sg * s, sg * c
            p[f"thigh.{side}"] = (-A * ss - 8, 0, 0)
            knee = 18 + (A * 1.6) * (0.5 + 0.5 * cc) ** 1.5
            p[f"shin.{side}"] = (knee, 0, 0)
            p[f"foot.{side}"] = (-10 * cc - 4, 0, 0)
            p[f"upper_arm.{side}"] = (A * 0.9 * ss + 5, r["arm_in"] + 4, 0)
            p[f"forearm.{side}"] = (-78 - 12 * ss, 0, 0)
        p["spine"] = (r["lean"], 0, 0)
        p["chest"] = (2, 0, 9 * s)
        p["pelvis"] = (0, 0, -6 * s)
        p["head"] = (-r["lean"] * 0.7, 0, -3 * s)
        p["loc"] = (0, 0, r["bob"] * math.cos(2 * ph) - r["bob"] - 0.02)
        keys.append((f + 1, p))
    return keys, True, {"speed_mps": {"technik": 4.5, "tank": 3.8, "sprinter": 5.6}[role]}


def attack(role):
    a = ready(role)
    if role == "technik":   # sharp side-arm throw of a gadget with the right hand
        wind = over(a, chest=(-4, 0, -28), spine=(-4, 0, 0), upper_arm_R=(38, -38, 0),
                    forearm_R=(-105, 0, 0), upper_arm_L=(-30, -15, 0), forearm_L=(-40, 0, 0),
                    head=(0, 0, 18))
        rel = over(a, chest=(4, 0, 26), spine=(14, 0, 0), upper_arm_R=(-95, 4, 0),
                   forearm_R=(-6, 0, 0), upper_arm_L=(25, -12, 0), forearm_L=(-60, 0, 0),
                   thigh_L=(-28, -4, 0), shin_L=(24, 0, 0), foot_L=(4, 0, 0), head=(-8, 0, -18),
                   loc=(0, -0.04, -0.04))
        fol = blend(rel, a, 0.35)
        keys = [(1, a), (7, wind), (11, rel), (15, fol), (22, a)]
        return keys, False, {"event_hit_s": 10 / 30}
    if role == "tank":      # two-handed overhead hammer slam
        wind = over(a, spine=(-12, 0, 0), chest=(-8, 0, 0), head=(-10, 0, 0),
                    upper_arm_L=(-165, 12, 0), upper_arm_R=(-165, 12, 0),
                    forearm_L=(-50, 0, 0), forearm_R=(-50, 0, 0), loc=(0, 0.02, 0.02))
        slam = over(a, spine=(32, 0, 0), chest=(10, 0, 0), head=(-20, 0, 0),
                    upper_arm_L=(-55, 14, 0), upper_arm_R=(-55, 14, 0),
                    forearm_L=(-12, 0, 0), forearm_R=(-12, 0, 0),
                    thigh_L=(-38, -10, 0), thigh_R=(-38, -10, 0), shin_L=(62, 0, 0),
                    shin_R=(62, 0, 0), foot_L=(-24, 10, 0), foot_R=(-24, 10, 0),
                    loc=(0, -0.03, -0.13))
        keys = [(1, a), (11, wind), (16, slam), (21, slam), (30, a)]
        return keys, False, {"event_hit_s": 16 / 30}
    # sprinter: fast front kick with the right leg
    chamber = over(a, thigh_R=(-85, 0, 0), shin_R=(95, 0, 0), foot_R=(-10, 0, 0),
                   spine=(-6, 0, 0), upper_arm_L=(-35, -25, 0), upper_arm_R=(25, -25, 0),
                   forearm_L=(-70, 0, 0), forearm_R=(-70, 0, 0), loc=(0, 0.02, 0.0))
    kick = over(chamber, thigh_R=(-95, 0, 0), shin_R=(8, 0, 0), foot_R=(30, 0, 0),
                spine=(-14, 0, 0), chest=(-6, 0, 10), thigh_L=(6, 0, 0), shin_L=(10, 0, 0))
    keys = [(1, a), (5, chamber), (8, kick), (11, chamber), (17, a)]
    return keys, False, {"event_hit_s": 8 / 30}


def ability(role):
    a = ready(role)
    if role == "technik":   # crouch, plant a device with the right hand, tap and rise
        crouch = over(a, loc=(0, 0.02, -0.25), spine=(34, 0, 0), chest=(10, 0, 0), head=(-26, 0, 0),
                      thigh_L=(-78, -6, 0), shin_L=(118, 0, 0), foot_L=(-40, 6, 0),
                      thigh_R=(-28, -4, 0), shin_R=(112, 0, 0), foot_R=(-70, 0, 0),
                      upper_arm_R=(-62, 2, 0), forearm_R=(-22, 0, 0),
                      upper_arm_L=(-38, 6, 0), forearm_L=(-60, 0, 0))
        tap = over(crouch, upper_arm_R=(-72, 6, 0), forearm_R=(-55, 0, 0), head=(-16, 0, 0))
        keys = [(1, a), (8, crouch), (13, crouch), (17, tap), (21, crouch), (32, a)]
        return keys, False, {"event_cast_s": 13 / 30}
    if role == "tank":      # brace guard: forearms crossed in front, wide low stance
        guard = over(a, loc=(0, 0.0, -0.1), spine=(12, 0, 0), chest=(4, 0, 0), head=(4, 0, 0),
                     upper_arm_L=(-78, 34, 0), upper_arm_R=(-78, 34, 0),
                     forearm_L=(-38, 0, 58), forearm_R=(-38, 0, 58),
                     thigh_L=(-26, -14, 0), thigh_R=(-26, -14, 0), shin_L=(42, 0, 0),
                     shin_R=(42, 0, 0), foot_L=(-16, 14, 0), foot_R=(-16, 14, 0))
        push = over(guard, loc=(0, -0.05, -0.08), spine=(18, 0, 0))
        keys = [(1, a), (7, guard), (16, push), (26, guard), (34, a)]
        return keys, False, {"event_cast_s": 7 / 30}
    # sprinter: low explosive dash pose, arms swept back
    load = over(a, loc=(0, 0.03, -0.12), spine=(18, 0, 0), thigh_L=(-40, 0, 0), shin_L=(70, 0, 0),
                foot_L=(-28, 0, 0), thigh_R=(-10, 0, 0), shin_R=(60, 0, 0), foot_R=(-40, 0, 0),
                upper_arm_L=(20, -10, 0), upper_arm_R=(20, -10, 0))
    dash = over(a, loc=(0, -0.06, -0.1), spine=(38, 0, 0), chest=(6, 0, 0), head=(-30, 0, 0),
                thigh_L=(-60, 0, 0), shin_L=(50, 0, 0), foot_L=(-5, 0, 0),
                thigh_R=(35, 0, 0), shin_R=(55, 0, 0), foot_R=(20, 0, 0),
                upper_arm_L=(70, -22, 0), upper_arm_R=(70, -22, 0),
                forearm_L=(-15, 0, 0), forearm_R=(-15, 0, 0))
    keys = [(1, a), (6, load), (10, dash), (17, dash), (25, a)]
    return keys, False, {"event_cast_s": 10 / 30}


def hit(role):
    a = ready(role)
    k = 0.6 if role == "tank" else (1.2 if role == "sprinter" else 1.0)
    rec = over(a, spine=(-18 * k, 0, 0), chest=(-8 * k, 0, 8 * k), head=(-22 * k, 0, -6),
               upper_arm_L=(14, -26 * k, 0), upper_arm_R=(14, -26 * k, 0),
               forearm_L=(-34, 0, 0), forearm_R=(-34, 0, 0), loc=(0, 0.05 * k, -0.025))
    keys = [(1, a), (4, rec), (8, blend(rec, a, 0.6)), (13, a)]
    return keys, False, {}


def defeat(role):
    a = ready(role)
    tall = {"technik": 0.66, "tank": 0.70, "sprinter": 0.68}[role]
    stag = over(a, spine=(-14, 0, 0), head=(-26, 0, 0), upper_arm_L=(20, -30, 0),
                upper_arm_R=(20, -30, 0), forearm_L=(-30, 0, 0), forearm_R=(-30, 0, 0),
                loc=(0, 0.04, -0.02))
    buckle = over(a, loc=(0, 0.09, -0.26), spine=(22, 0, 0), chest=(8, 0, 0), head=(18, 0, 0),
                  thigh_L=(-50, -6, 0), thigh_R=(-44, -8, 0), shin_L=(100, 0, 0),
                  shin_R=(96, 0, 0), foot_L=(-48, 0, 0), foot_R=(-48, 0, 0),
                  upper_arm_L=(-12, -12, 0), upper_arm_R=(-12, -12, 0),
                  forearm_L=(-30, 0, 0), forearm_R=(-30, 0, 0))
    lie = {"pelvis": (-84, 0, 8), "spine": (-4, 0, 0), "chest": (-2, 0, 0), "head": (6, 0, -22),
           "loc": (0, 0.14, -(tall - 0.11))}
    sym(lie, "thigh", (-2, -10, 0))
    sym(lie, "shin", (10, 0, 0))
    sym(lie, "foot", (-30, 0, 0))
    sym(lie, "upper_arm", (-22, -58, 0))
    sym(lie, "forearm", (-20, 0, 0))
    bounce = dict(lie)
    bounce["loc"] = (0, 0.14, -(tall - 0.14))
    bounce["pelvis"] = (-80, 0, 8)
    keys = [(1, a), (7, stag), (17, buckle), (27, lie), (31, bounce), (36, lie), (48, lie)]
    return keys, False, {"hold_last_frame": True}


def victory(role):
    a = ready(role)
    if role == "technik":   # fist pump, left hand on hip
        up = over(a, chest=(-8, 0, 0), head=(-14, 0, 0), upper_arm_R=(-168, -12, 0),
                  forearm_R=(-28, 0, 0), upper_arm_L=(18, -42, 0), forearm_L=(-70, 0, -50),
                  loc=(0, 0, 0.0))
        hi = over(up, upper_arm_R=(-178, -8, 0), forearm_R=(-8, 0, 0), loc=(0, 0, 0.025),
                  head=(-18, 0, 0))
        keys = [(1, up), (10, hi), (20, up), (30, hi), (40, up)]
        return keys, True, {}
    if role == "tank":      # double-biceps flex with a heavy pulse
        flex = over(a, chest=(-10, 0, 0), head=(-6, 0, 0), spine=(-2, 0, 0),
                    upper_arm_L=(-6, -70, 0), upper_arm_R=(-6, -70, 0),
                    forearm_L=(0, -105, 0), forearm_R=(0, -105, 0),
                    thigh_L=(-4, -12, 0), thigh_R=(-4, -12, 0), foot_L=(-4, 12, 0),
                    foot_R=(-4, 12, 0), loc=(0, 0, -0.03))
        tight = over(flex, forearm_L=(0, -122, 0), forearm_R=(0, -122, 0), chest=(-14, 0, 0),
                     loc=(0, 0, -0.045))
        keys = [(1, flex), (12, tight), (24, flex), (36, tight), (48, flex)]
        return keys, True, {}
    # sprinter: hop with arm thrown up
    crouch = over(a, loc=(0, 0, -0.08), thigh_L=(-30, 0, 0), thigh_R=(-30, 0, 0), shin_L=(55, 0, 0),
                  shin_R=(55, 0, 0), foot_L=(-25, 0, 0), foot_R=(-25, 0, 0), spine=(10, 0, 0),
                  upper_arm_L=(-170, -10, 0), forearm_L=(-10, 0, 0))
    air = over(a, loc=(0, 0, 0.16), thigh_L=(-40, 0, 0), thigh_R=(-5, 0, 0), shin_L=(80, 0, 0),
               shin_R=(40, 0, 0), foot_L=(10, 0, 0), foot_R=(20, 0, 0), spine=(-6, 0, 0),
               chest=(-8, 0, 0), head=(-14, 0, 0), upper_arm_L=(-178, -6, 0),
               forearm_L=(-6, 0, 0), upper_arm_R=(10, -40, 0), forearm_R=(-60, 0, 0))
    keys = [(1, crouch), (10, air), (16, air), (24, crouch), (36, crouch)]
    return keys, True, {}


LIBRARY = {"Idle": idle, "Run": run, "Attack": attack, "Ability": ability, "Hit": hit,
           "Defeat": defeat, "Victory": victory}
