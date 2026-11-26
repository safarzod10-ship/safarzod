import math

ROLE = {
    "technik": dict(run_frames=20, run_amp=40, lean=11, bob=0.022, heavy=0.0, arm_in=6),
    "tank": dict(run_frames=24, run_amp=30, lean=8, bob=0.03, heavy=1.0, arm_in=-6),
    "sprinter": dict(run_frames=16, run_amp=50, lean=16, bob=0.02, heavy=-0.5, arm_in=8),
    "sniper": dict(run_frames=20, run_amp=38, lean=10, bob=0.024, heavy=0.4, arm_in=-2),
    "medic": dict(run_frames=18, run_amp=44, lean=13, bob=0.021, heavy=-0.3, arm_in=8),
}


def sym(pose, base, rot, rot_r=None):
    pose[base + ".L"] = rot
    pose[base + ".R"] = rot if rot_r is None else rot_r
    return pose


def ready(role):
    r = ROLE[role]
    p = {"spine": (3, 0, 0), "chest": (-2, 0, 0), "head": (-2, 0, 0)}
    sym(p, "upper_arm", (4, r["arm_in"], 0))
    sym(p, "forearm", (-18, 0, 0))
    sym(p, "thigh", (-4, -3 - 3 * r["heavy"], 0))
    sym(p, "shin", (8, 0, 0))
    sym(p, "foot", (-4, 3 + 3 * r["heavy"], 0))
    p["loc"] = (0, 0, -0.012)
    if role == "sniper":
        p["upper_arm.R"] = (-35, 10, 0)
        p["forearm.R"] = (-90, 0, -25)
        p["upper_arm.L"] = (-50, 14, 0)
        p["forearm.L"] = (-80, 0, -35)
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
        if role != "sniper":
            sym(p, "upper_arm", (4 - 2 * s, r["arm_in"] - 2.5 * amp * s, 0))
            sym(p, "forearm", (-18 - 4 * s, 0, 0))
        p["loc"] = (0.006 * math.sin(ph), 0, -0.012 + 0.006 * amp * s)
        if role == "sprinter":
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
    return keys, True, {"speed_mps": {"technik": 4.5, "tank": 3.8, "sprinter": 5.6, "sniper": 4.3, "medic": 5.0}[role]}


def attack(role):
    a = ready(role)
    if role == "sniper":
        aim = over(a, chest=(-2, 0, -10), spine=(8, 0, 0), head=(2, 0, 10), loc=(0, 0, -0.03))
        kick = over(aim, chest=(-14, 0, -10), spine=(-4, 0, 0), head=(-8, 0, 10), loc=(0, 0.035, -0.01))
        keys = [(1, a), (6, aim), (9, aim), (11, kick), (16, aim), (24, a)]
        return keys, False, {"event_hit_s": (10 - 1) / 30}
    if role == "medic":
        wind = over(a, spine=(-4, 0, 0), chest=(0, 0, -16), upper_arm_R=(40, -10, 0),
                    forearm_R=(-30, 0, 0), upper_arm_L=(-24, -12, 0), forearm_L=(-50, 0, 0))
        toss = over(a, spine=(12, 0, 0), chest=(2, 0, 14), upper_arm_R=(-78, -6, 0),
                    forearm_R=(-14, 0, 0), upper_arm_L=(20, -14, 0), forearm_L=(-40, 0, 0),
                    thigh_L=(-22, -4, 0), shin_L=(18, 0, 0), loc=(0, -0.03, -0.03))
        keys = [(1, a), (7, wind), (11, toss), (15, blend(toss, a, 0.4)), (21, a)]
        return keys, False, {"event_hit_s": (10 - 1) / 30}
    if role == "technik":
        wind = over(a, chest=(-4, 0, -28), spine=(-4, 0, 0), upper_arm_R=(38, -38, 0),
                    forearm_R=(-105, 0, 0), upper_arm_L=(-30, -15, 0), forearm_L=(-40, 0, 0),
                    head=(0, 0, 18))
        rel = over(a, chest=(4, 0, 26), spine=(14, 0, 0), upper_arm_R=(-95, 4, 0),
                   forearm_R=(-6, 0, 0), upper_arm_L=(25, -12, 0), forearm_L=(-60, 0, 0),
                   thigh_L=(-28, -4, 0), shin_L=(24, 0, 0), foot_L=(4, 0, 0), head=(-8, 0, -18),
                   loc=(0, -0.04, -0.04))
        fol = blend(rel, a, 0.35)
        keys = [(1, a), (7, wind), (11, rel), (15, fol), (22, a)]
        return keys, False, {"event_hit_s": (10 - 1) / 30}
    if role == "tank":
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
        return keys, False, {"event_hit_s": (16 - 1) / 30}
    chamber = over(a, thigh_R=(-85, 0, 0), shin_R=(95, 0, 0), foot_R=(-10, 0, 0),
                   spine=(-6, 0, 0), upper_arm_L=(-35, -25, 0), upper_arm_R=(25, -25, 0),
                   forearm_L=(-70, 0, 0), forearm_R=(-70, 0, 0), loc=(0, 0.02, 0.0))
    kick = over(chamber, thigh_R=(-95, 0, 0), shin_R=(8, 0, 0), foot_R=(30, 0, 0),
                spine=(-14, 0, 0), chest=(-6, 0, 10), thigh_L=(6, 0, 0), shin_L=(10, 0, 0))
    keys = [(1, a), (5, chamber), (8, kick), (11, chamber), (17, a)]
    return keys, False, {"event_hit_s": (8 - 1) / 30}


def ability(role):
    a = ready(role)
    if role == "sniper":
        kneel = over(a, loc=(0, 0.02, -0.24), spine=(12, 0, 0), chest=(-4, 0, -16), head=(-2, 0, 14),
                     thigh_L=(-80, -6, 0), shin_L=(86, 0, 0), foot_L=(-6, 6, 0),
                     thigh_R=(12, -4, 0), shin_R=(118, 0, 0), foot_R=(-60, 0, 0))
        keys = [(1, a), (7, kneel), (18, kneel), (28, a)]
        return keys, False, {"event_cast_s": (7 - 1) / 30}
    if role == "medic":
        up = over(a, chest=(-8, 0, 0), head=(-12, 0, 0), upper_arm_L=(-150, -20, 0),
                  upper_arm_R=(-150, -20, 0), forearm_L=(-30, 0, 0), forearm_R=(-30, 0, 0),
                  loc=(0, 0, 0.02))
        spread = over(a, chest=(-4, 0, 0), head=(-4, 0, 0), upper_arm_L=(-40, -70, 0),
                      upper_arm_R=(-40, -70, 0), forearm_L=(-10, 0, 0), forearm_R=(-10, 0, 0),
                      loc=(0, 0, -0.03))
        keys = [(1, a), (8, up), (13, spread), (20, spread), (28, a)]
        return keys, False, {"event_cast_s": (13 - 1) / 30}
    if role == "technik":
        crouch = over(a, loc=(0, 0.02, -0.25), spine=(34, 0, 0), chest=(10, 0, 0), head=(-26, 0, 0),
                      thigh_L=(-78, -6, 0), shin_L=(118, 0, 0), foot_L=(-40, 6, 0),
                      thigh_R=(-28, -4, 0), shin_R=(112, 0, 0), foot_R=(-70, 0, 0),
                      upper_arm_R=(-62, 2, 0), forearm_R=(-22, 0, 0),
                      upper_arm_L=(-38, 6, 0), forearm_L=(-60, 0, 0))
        tap = over(crouch, upper_arm_R=(-72, 6, 0), forearm_R=(-55, 0, 0), head=(-16, 0, 0))
        keys = [(1, a), (8, crouch), (13, crouch), (17, tap), (21, crouch), (32, a)]
        return keys, False, {"event_cast_s": (13 - 1) / 30}
    if role == "tank":
        guard = over(a, loc=(0, 0.0, -0.1), spine=(6, 0, 0), chest=(0, 0, 0), head=(8, 0, 0),
                     upper_arm_L=(-74, 36, 0), upper_arm_R=(-74, 36, 0),
                     forearm_L=(-105, 0, -34), forearm_R=(-105, 0, -34),
                     thigh_L=(-26, -14, 0), thigh_R=(-26, -14, 0), shin_L=(42, 0, 0),
                     shin_R=(42, 0, 0), foot_L=(-16, 14, 0), foot_R=(-16, 14, 0))
        push = over(guard, loc=(0, -0.06, -0.08), spine=(14, 0, 0), head=(2, 0, 0))
        keys = [(1, a), (7, guard), (16, push), (26, guard), (34, a)]
        return keys, False, {"event_cast_s": (7 - 1) / 30}
    load = over(a, loc=(0, 0.03, -0.12), spine=(18, 0, 0), thigh_L=(-40, 0, 0), shin_L=(70, 0, 0),
                foot_L=(-28, 0, 0), thigh_R=(-10, 0, 0), shin_R=(60, 0, 0), foot_R=(-40, 0, 0),
                upper_arm_L=(20, -10, 0), upper_arm_R=(20, -10, 0))
    dash = over(a, loc=(0, -0.06, -0.1), spine=(38, 0, 0), chest=(6, 0, 0), head=(-30, 0, 0),
                thigh_L=(-60, 0, 0), shin_L=(50, 0, 0), foot_L=(-5, 0, 0),
                thigh_R=(35, 0, 0), shin_R=(55, 0, 0), foot_R=(20, 0, 0),
                upper_arm_L=(70, -22, 0), upper_arm_R=(70, -22, 0),
                forearm_L=(-15, 0, 0), forearm_R=(-15, 0, 0))
    keys = [(1, a), (6, load), (10, dash), (17, dash), (25, a)]
    return keys, False, {"event_cast_s": (10 - 1) / 30}


def hit(role):
    a = ready(role)
    k = {"tank": 0.6, "sprinter": 1.2, "sniper": 0.8, "medic": 1.1}.get(role, 1.0)
    rec = over(a, spine=(-18 * k, 0, 0), chest=(-8 * k, 0, 8 * k), head=(-22 * k, 0, -6),
               upper_arm_L=(14, -26 * k, 0), upper_arm_R=(14, -26 * k, 0),
               forearm_L=(-34, 0, 0), forearm_R=(-34, 0, 0), loc=(0, 0.05 * k, -0.025))
    keys = [(1, a), (4, rec), (8, blend(rec, a, 0.6)), (13, a)]
    return keys, False, {}


def defeat(role):
    a = ready(role)
    tall = {"technik": 0.66, "tank": 0.70, "sprinter": 0.68, "sniper": 0.70, "medic": 0.68}[role]
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
    if role == "sniper":
        role = "technik"
    if role == "medic":
        role = "sprinter"
    if role == "technik":
        up = over(a, chest=(-8, 0, 0), head=(-14, 0, 0), upper_arm_R=(-168, -12, 0),
                  forearm_R=(-28, 0, 0), upper_arm_L=(18, -42, 0), forearm_L=(-70, 0, -50),
                  loc=(0, 0, 0.0))
        hi = over(up, upper_arm_R=(-178, -8, 0), forearm_R=(-8, 0, 0), loc=(0, 0, 0.025),
                  head=(-18, 0, 0))
        keys = [(1, up), (10, hi), (20, up), (30, hi), (40, up)]
        return keys, True, {}
    if role == "tank":
        flex = over(a, chest=(-10, 0, 0), head=(-6, 0, 0), spine=(-2, 0, 0),
                    upper_arm_L=(-6, -70, 0), upper_arm_R=(-6, -70, 0),
                    forearm_L=(0, -105, 0), forearm_R=(0, -105, 0),
                    thigh_L=(-4, -12, 0), thigh_R=(-4, -12, 0), foot_L=(-4, 12, 0),
                    foot_R=(-4, 12, 0), loc=(0, 0, -0.03))
        tight = over(flex, forearm_L=(0, -122, 0), forearm_R=(0, -122, 0), chest=(-14, 0, 0),
                     loc=(0, 0, -0.045))
        keys = [(1, flex), (12, tight), (24, flex), (36, tight), (48, flex)]
        return keys, True, {}
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
