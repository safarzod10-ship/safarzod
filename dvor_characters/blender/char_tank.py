"""CH_Tank — heavy bruiser: brown beanie, black beard, olive puffer vest over a black tee,
cream short sleeves, big forearms, huge dark gloves, dark pants, heavy boots with tan soles.
Reference: ref/tank.png. Height ~1.55 m (beanie included), shoulder span ~0.78 m.
Same 18-bone skeleton family as CH_Technik (different proportions, identical names)."""
import math

from mathutils import Euler, Matrix, Vector

from dvor_lib import V

NAME = "CH_Tank"
ROLE = "tank"

PALETTE = {
    "skin": (226, 172, 132),
    "beard": (34, 28, 26),
    "olive": (108, 112, 50),
    "olive_dark": (84, 88, 38),
    "tee": (42, 40, 42),
    "cream": (238, 228, 208),
    "dark": (66, 60, 60),
    "glove": (46, 42, 44),
    "beanie": (124, 80, 54),
    "beanie_dark": (98, 62, 42),
    "boot": (58, 52, 50),
    "sole": (196, 154, 108),
    "skin_shadow": (200, 146, 108),
}

SH = V(0.262, 0.0, 1.060)
ARM_OUT = math.radians(21)
ARM_DIR = V(math.sin(ARM_OUT), 0, -math.cos(ARM_OUT))
ELBOW = SH + ARM_DIR * 0.235
WRIST = ELBOW + ARM_DIR * 0.215
HAND_END = WRIST + ARM_DIR * 0.140
HIP = V(0.128, 0.0, 0.620)
KNEE = V(0.140, -0.012, 0.360)
ANKLE = V(0.146, 0.0, 0.130)
TOE = V(0.146, -0.180, 0.045)


def joints():
    j = {
        "root": (V(0, 0, 0), V(0, 0, 0.12)),
        "pelvis": (V(0, 0, 0.640), V(0, 0, 0.760)),
        "spine": (V(0, 0, 0.760), V(0, 0, 0.900)),
        "chest": (V(0, 0, 0.900), V(0, 0, 1.110)),
        "neck": (V(0, 0.000, 1.110), V(0, 0.000, 1.165)),
        "head": (V(0, 0.000, 1.165), V(0, 0.000, 1.500)),
    }
    for side, m in (("L", 1), ("R", -1)):
        f = (lambda v: V(v.x * m, v.y, v.z))
        j[f"upper_arm.{side}"] = (f(SH), f(ELBOW))
        j[f"forearm.{side}"] = (f(ELBOW), f(WRIST))
        j[f"hand.{side}"] = (f(WRIST), f(HAND_END))
        j[f"thigh.{side}"] = (f(HIP), f(KNEE))
        j[f"shin.{side}"] = (f(KNEE), f(ANKLE))
        j[f"foot.{side}"] = (f(ANKLE), f(TOE))
    return j


def paint_face(d, P, SS):
    def poly(pts, fill):
        d.polygon([P(*p) for p in pts], fill=fill)

    def ell(lon, lat, rw, rh, fill):
        x0, y0 = P(lon - rw, lat + rh)
        x1, y1 = P(lon + rw, lat - rh)
        d.ellipse([x0, y0, x1, y1], fill=fill)

    def line(pts, fill, w):
        d.line([P(*p) for p in pts], fill=fill, width=int(w * SS), joint="curve")

    # stubble shadow where the beard meets the cheeks
    ell(0, -26, 52, 22, (206, 156, 120))
    # big nose
    poly([(-5, -2), (5, -2), (10, -16), (4, -21), (-4, -21), (-10, -16)], (210, 154, 116))
    ell(0, -16, 8, 5, (232, 178, 138))
    for s in (-1, 1):
        cx, cy = 25 * s, 3.0
        E = lambda ox, oy: (cx + ox * s, cy + oy)
        # small, narrowed stern eyes
        poly([E(-11, 0), E(-6, 3.5), E(2, 4.5), E(9, 3.5), E(13, 0.5), E(9, -3.5), E(0, -5),
              E(-8, -3.5)], (248, 244, 238))
        ell(cx - 0.5 * s, cy - 0.3, 5.2, 5.0, (78, 50, 34))
        ell(cx - 0.5 * s, cy - 0.2, 2.8, 2.8, (22, 16, 12))
        ell(cx + 1.6 * s - 1.0, cy + 1.8, 1.3, 1.3, (255, 255, 255))
        line([E(-12, 0.5), E(-6, 4.5), E(2, 5.5), E(9, 4.5), E(14, 1)], (34, 24, 20), 3.2)
        # very thick low brows (heavy frown)
        poly([E(-15, 6.0), E(-13, 13.5), E(4, 15.5), E(19, 13), E(19, 8.5), E(3, 9.0)], (34, 28, 26))
    # forehead crease
    line([(-12, 24), (0, 25.5), (12, 24)], (206, 152, 114), 1.4)


def build(kit):
    torso_w = ("chain", ["pelvis", "spine", "chest"], 0.09)

    # ---- head: smaller than the body, square jaw hidden in the beard
    HC = V(0, -0.012, 1.300)
    kit.blob("head", HC, (0.150, 0.148, 0.158), "skin", ("rigid", "head"), seg=16, rings=12,
             head_uv=True, back_color="beard")   # short dark hair at the back
    for s in (1, -1):
        kit.blob(f"ear_{s}", V(0.148 * s, 0.004, 1.290), (0.024, 0.034, 0.044), "skin",
                 ("rigid", "head"), seg=6, rings=4)
    # beard: full, boxy, under the chin and up the cheeks
    kit.blob("beard", V(0, -0.040, 1.196), (0.152, 0.112, 0.105), "beard", ("rigid", "head"),
             seg=14, rings=7, power=0.85, squash_bottom=1.25)
    kit.blob("beard_tip", V(0, -0.098, 1.112), (0.090, 0.060, 0.060), "beard", ("rigid", "head"),
             seg=8, rings=5, power=0.9)
    kit.blob("moustache", V(0, -0.150, 1.236), (0.074, 0.028, 0.020), "beard", ("rigid", "head"),
             seg=8, rings=4, power=0.8)
    for s_ in (1, -1):   # sideburns joining beard and beanie
        kit.blob(f"sideburn_{s_}", V(0.140 * s_, -0.020, 1.300), (0.020, 0.040, 0.060), "beard",
                 ("rigid", "head"), seg=6, rings=4)
    # simple beanie with a folded cuff
    kit.blob("beanie", V(0, 0.004, 1.392), (0.160, 0.158, 0.120), "beanie", ("rigid", "head"),
             seg=14, rings=7, power=0.9, squash_bottom=0.35)
    cuff = []
    for k in range(16):
        a = 2 * math.pi * k / 16
        cuff.append((V(math.sin(a) * 0.160, -math.cos(a) * 0.158 + 0.004, 1.368), 0.020, 0.038))
    kit.loft("beanie_cuff", cuff, "beanie_dark", ("rigid", "head"), sides=4, phase=0.5, closed=True,
             front=V(0, 0, 1))

    # ---- thick neck
    kit.loft("neck", [(V(0, 0.010, 1.080), 0.090, 0.085), (V(0, 0.010, 1.180), 0.085, 0.080)],
             "skin", ("chain", ["neck", "head"], 0.04), sides=8)

    # ---- torso: black tee + olive puffer vest open at the front
    def vest_colour(cen, f):
        if cen.y < -0.05 and abs(cen.x) < 0.060:
            return "tee"
        if cen.z < 0.66:
            return "olive_dark"
        return None
    kit.loft("vest", [
        (V(0, -0.006, 0.625), 0.252, 0.192),
        (V(0, -0.012, 0.700), 0.266, 0.208),
        (V(0, -0.016, 0.820), 0.276, 0.214),
        (V(0, -0.012, 0.940), 0.296, 0.208),
        (V(0, -0.004, 1.040), 0.306, 0.192),
        (V(0, 0.004, 1.108), 0.252, 0.160),
        (V(0, 0.010, 1.148), 0.142, 0.116),
    ], "olive", torso_w, sides=14, power=0.78, face_color_fn=vest_colour)
    # puffer seams: two slightly proud olive_dark rings read as quilting
    for z, rx, ry in ((0.780, 0.274, 0.214), (0.920, 0.292, 0.212)):
        kit.loft(f"quilt_{z}", [(V(0, -0.016, z - 0.010), rx + 0.004, ry + 0.004),
                                (V(0, -0.016, z + 0.010), rx + 0.004, ry + 0.004)],
                 "olive_dark", torso_w, sides=14, power=0.78, cap0=False, cap1=False,
                 face_color_fn=lambda c, f: "tee" if (c.y < -0.05 and abs(c.x) < 0.07) else None)
    # vest hood behind the neck
    kit.blob("hood", V(0, 0.092, 1.150), (0.190, 0.105, 0.080), "olive", ("rigid", "chest"),
             seg=12, rings=6)
    # crowns: small on the left chest, large on the back
    crown = [(-1.0, 0.0), (1.0, 0.0), (1.0, 0.75), (0.5, 0.32), (0.0, 0.92), (-0.5, 0.32), (-1.0, 0.75)]
    Mf = Matrix.Translation(V(0.130, -0.212, 0.975)) @ Euler((math.radians(90), 0, 0)).to_matrix().to_4x4() @ Matrix.Scale(0.042, 4)
    kit.shape("crown_front", crown, Mf, 0.30, "cream", ("rigid", "chest"))
    Mb = Matrix.Translation(V(0, 0.214, 0.900)) @ Euler((math.radians(90), 0, math.radians(180))).to_matrix().to_4x4() @ Matrix.Scale(0.085, 4)
    kit.shape("crown_back", crown, Mb, 0.20, "cream", ("rigid", "chest"))

    # ---- arms: cream short sleeves, bare forearms, huge gloves
    def arm(side):
        m = 1 if side == "L" else -1
        f = (lambda v: V(v.x * m, v.y, v.z))
        sh, el, wr = f(SH), f(ELBOW), f(WRIST)
        d = (el - sh).normalized()
        d2 = (wr - el).normalized()
        wa = ("chain", [f"upper_arm.{side}", f"forearm.{side}"], 0.06)
        kit.blob(f"shoulder.{side}", sh + V(0, 0, 0.006), (0.106, 0.102, 0.098), "cream",
                 ("rigid", f"upper_arm.{side}"), seg=10, rings=6)
        kit.loft(f"sleeve.{side}", [(sh + d * 0.02, 0.098, 0.098), (sh + d * 0.125, 0.094, 0.094),
                                    (sh + d * 0.135, 0.084, 0.084)],
                 "cream", ("rigid", f"upper_arm.{side}"), sides=10, cap0=False)
        kit.loft(f"arm.{side}", [(sh + d * 0.10, 0.080, 0.080), (el, 0.076, 0.076),
                                 (el + d2 * 0.08, 0.078, 0.076), (wr - d2 * 0.04, 0.066, 0.064)],
                 "skin", wa, sides=10, cap0=False)
        kit.loft(f"glove_cuff.{side}", [(wr - d2 * 0.075, 0.072, 0.070), (wr + d2 * 0.015, 0.080, 0.078)],
                 "glove", ("chain", [f"forearm.{side}", f"hand.{side}"], 0.03), sides=10)
        fist = wr + d2 * 0.080
        kit.blob(f"fist.{side}", fist, (0.086, 0.090, 0.094), "glove", ("rigid", f"hand.{side}"),
                 seg=10, rings=6, power=0.68)

    arm("L")
    arm("R")

    # ---- pants and heavy boots
    kit.blob("pelvis", V(0, 0.0, 0.640), (0.250, 0.180, 0.096), "dark", ("rigid", "pelvis"),
             seg=12, rings=6, power=0.85)

    def leg(side):
        m = 1 if side == "L" else -1
        f = (lambda v: V(v.x * m, v.y, v.z))
        w = ("chain", [f"thigh.{side}", f"shin.{side}"], 0.07)
        kit.loft(f"pants.{side}", [
            (f(V(0.128, 0.000, 0.680)), 0.150, 0.156),
            (f(V(0.134, -0.004, 0.560)), 0.150, 0.156),
            (f(KNEE), 0.138, 0.142),
            (f(V(0.144, -0.004, 0.250)), 0.132, 0.136),
            (f(V(0.146, 0.000, 0.190)), 0.120, 0.124),
        ], "dark", w, sides=10, cap0=False)
        fr = ("rigid", f"foot.{side}")
        kit.blob(f"sole.{side}", f(V(0.146, -0.055, 0.040)), (0.098, 0.190, 0.042), "sole", fr,
                 seg=12, rings=4, power=0.5)
        kit.blob(f"boot.{side}", f(V(0.146, -0.040, 0.125)), (0.094, 0.168, 0.088), "boot", fr,
                 seg=12, rings=6, power=0.6)
        kit.blob(f"toe.{side}", f(V(0.146, -0.150, 0.090)), (0.080, 0.070, 0.050), "boot", fr,
                 seg=8, rings=4, power=0.7)

    leg("L")
    leg("R")
