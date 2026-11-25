"""CH_Sprinter — light, fast girl: big magenta-pink ponytail with large strands, headphones,
cropped purple sports jacket with cream cuffs and collar, black crop top, dark joggers with a
purple side stripe, purple chunky sneakers with white soles, fingerless gloves.
Reference: ref/sprinter.png. Height ~1.55 m including the ponytail, the slimmest silhouette."""
import math

from mathutils import Euler, Matrix, Vector

from dvor_lib import V

NAME = "CH_Sprinter"
ROLE = "sprinter"

PALETTE = {
    "skin": (240, 196, 160),
    "hair": (222, 62, 122),
    "hair_dark": (176, 38, 92),
    "purple": (124, 62, 162),
    "purple_dark": (96, 44, 128),
    "lilac": (200, 158, 222),
    "tee": (40, 38, 44),
    "cream": (244, 238, 234),
    "dark": (50, 46, 54),
    "glove": (44, 40, 46),
    "phones": (70, 66, 74),
    "sole": (238, 232, 236),
    "skin_shadow": (220, 168, 132),
}

SH = V(0.158, 0.0, 0.980)
ARM_OUT = math.radians(16)
ARM_DIR = V(math.sin(ARM_OUT), 0, -math.cos(ARM_OUT))
ELBOW = SH + ARM_DIR * 0.215
WRIST = ELBOW + ARM_DIR * 0.200
HAND_END = WRIST + ARM_DIR * 0.090
HIP = V(0.080, 0.0, 0.660)
KNEE = V(0.088, -0.012, 0.385)
ANKLE = V(0.092, 0.0, 0.115)
TOE = V(0.092, -0.155, 0.040)


def joints():
    j = {
        "root": (V(0, 0, 0), V(0, 0, 0.12)),
        "pelvis": (V(0, 0, 0.680), V(0, 0, 0.780)),
        "spine": (V(0, 0, 0.780), V(0, 0, 0.880)),
        "chest": (V(0, 0, 0.880), V(0, 0, 1.030)),
        "neck": (V(0, 0.004, 1.030), V(0, 0.004, 1.090)),
        "head": (V(0, 0.004, 1.090), V(0, 0.004, 1.400)),
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

    for s in (-1, 1):
        ell(35 * s, -19, 8, 4, (244, 176, 156))
    poly([(-2, -11), (2, -11), (4, -18), (0, -19.5), (-4, -18)], (226, 172, 136))
    # confident smile, pink lips
    poly([(-11, -31), (-4, -29.5), (0, -30), (4, -29.5), (12, -28), (6, -33.5), (-5, -34)], (206, 92, 112))
    line([(-11, -31), (0, -31.2), (12, -28)], (150, 52, 72), 1.4)
    for s in (-1, 1):
        cx, cy = 25 * s, -1.0
        E = lambda ox, oy: (cx + ox * s, cy + oy)
        poly([E(-13, 0), E(-8, 5.5), E(1, 8), E(10, 7), E(16, 3.5), E(12, -4.5), E(3, -8),
              E(-6, -7.5), E(-11, -3.5)], (250, 248, 246))
        ell(cx - 0.5 * s, cy - 0.5, 7.4, 7.6, (112, 66, 40))
        ell(cx - 0.5 * s, cy - 0.3, 4.0, 4.2, (26, 16, 14))
        ell(cx + 2.4 * s - 1.5, cy + 3.2, 2.0, 2.1, (255, 255, 255))
        # lash line with a flick at the outer corner
        line([E(-14, 0.5), E(-8, 6.5), E(1, 9), E(10, 8), E(16, 4), E(20, 6.5)], (34, 18, 22), 3.0)
        # slim arched magenta brows (one slightly raised: playful)
        lift = 2.0 if s > 0 else 0.0
        poly([E(-14, 13 + lift), E(-12, 15.5 + lift), E(3, 19.5 + lift), E(17, 16.5 + lift),
              E(17, 14.5 + lift), E(3, 17 + lift)], (176, 40, 96))


def build(kit):
    torso_w = ("chain", ["pelvis", "spine", "chest"], 0.07)

    # ---- head
    HC = V(0, -0.008, 1.222)
    kit.blob("head", HC, (0.152, 0.146, 0.158), "skin", ("rigid", "head"), seg=16, rings=12,
             head_uv=True, back_color="skin")
    # hair cap (back and top), side-swept fringe, big high ponytail of large strands
    kit.blob("hair_cap", V(0, 0.020, 1.262), (0.166, 0.160, 0.150), "hair", ("rigid", "head"),
             seg=12, rings=7, rot=(-18, 0, 0))
    # side-swept fringe: big soft strands over the forehead and down the left cheek
    fringe = [
        ((-0.060, -0.118, 1.352), (0.65, -0.45, -0.60), 0.15, 0.070),
        ((0.030, -0.130, 1.348), (0.80, -0.30, -0.52), 0.13, 0.064),
        ((0.118, -0.082, 1.318), (0.35, -0.40, -0.85), 0.16, 0.058),
        ((-0.128, -0.070, 1.300), (-0.25, -0.40, -0.88), 0.12, 0.052),
    ]
    for i, (b, dr, L, r) in enumerate(fringe):
        b, dr = V(b), V(dr).normalized()
        kit.loft(f"fringe_{i}", [(b, r, r * 0.62), (b + dr * L * 0.5 + V(0, -0.010, 0), r * 0.70, r * 0.45),
                                 (b + dr * L, r * 0.10, r * 0.06)], "hair", ("rigid", "head"),
                 sides=6, cap1=False)
    # ponytail: thick mass tied high at the back, sweeping back and falling to the shoulders,
    # plus two big side strands and a top swoop (large, readable strands from the game camera)
    tie = V(0, 0.118, 1.372)
    kit.blob("tie", tie, (0.042, 0.040, 0.038), "purple", ("rigid", "head"), seg=8, rings=4)
    strands = [
        ([(0, 0.00, 0.00), (0, 0.07, 0.05), (0, 0.16, 0.02), (0, 0.22, -0.10), (0, 0.21, -0.24),
          (0, 0.15, -0.34)], 0.085, "hair"),
        ([(0.03, 0.00, 0.00), (0.09, 0.07, 0.04), (0.14, 0.14, -0.04), (0.15, 0.16, -0.16),
          (0.11, 0.12, -0.26)], 0.060, "hair_dark"),
        ([(-0.03, 0.00, 0.00), (-0.09, 0.07, 0.04), (-0.14, 0.14, -0.04), (-0.15, 0.16, -0.16),
          (-0.11, 0.12, -0.26)], 0.060, "hair_dark"),
        ([(0, -0.01, 0.02), (0, 0.04, 0.11), (0, 0.13, 0.14), (0, 0.22, 0.08), (0, 0.27, -0.02)], 0.058, "hair"),
    ]
    for i, (pts, r, col) in enumerate(strands):
        n = len(pts)
        rings = []
        for k, p in enumerate(pts):
            t = k / (n - 1)
            rr = r * (1.0 + 0.25 * math.sin(math.pi * min(1.0, t * 1.6))) * (1.0 - 0.9 * t ** 1.6)
            rings.append((tie + V(p), rr, rr * 0.8))
        kit.loft(f"pony_{i}", rings, col, ("rigid", "head"), sides=7, cap1=False, front=V(1, 0, 0))

    # ---- headphones: cups over the ears, band over the head
    for s in (1, -1):
        c = V(0.160 * s, 0.000, 1.220)
        ax = V(s, 0, 0)
        kit.loft(f"cup_{s}", [(c - ax * 0.030, 0.056, 0.060), (c + ax * 0.010, 0.060, 0.064),
                              (c + ax * 0.034, 0.050, 0.054)], "phones", ("rigid", "head"),
                 sides=10, front=V(0, -1, 0))
        crown = [(-1.0, 0.0), (1.0, 0.0), (1.0, 0.75), (0.5, 0.32), (0.0, 0.92), (-0.5, 0.32), (-1.0, 0.75)]
        rot = Euler((math.radians(90), 0, math.radians(90 * s))).to_matrix().to_4x4()
        M = Matrix.Translation(c + ax * 0.0365 + V(0, 0, -0.018)) @ rot @ Matrix.Scale(0.030, 4)
        kit.shape(f"cup_crown_{s}", crown, M, 0.25, "lilac", ("rigid", "head"))
    band = []
    for k in range(9):
        a = math.pi * k / 8
        band.append((V(-math.cos(a) * 0.172, 0.004, 1.220 + math.sin(a) * 0.200), 0.010, 0.026))
    kit.loft("phones_band", band, "phones", ("rigid", "head"), sides=4, phase=0.5, front=V(0, 1, 0))

    kit.loft("neck", [(V(0, 0.006, 1.000), 0.044, 0.042), (V(0, 0.006, 1.100), 0.042, 0.040)],
             "skin", ("chain", ["neck", "head"], 0.04), sides=8)

    # ---- torso: joggers waistband / bare midriff / black crop top
    def body_colour(c, f):
        if c.z < 0.735:
            return "dark"
        if c.z < 0.835:
            return "skin"
        return None
    kit.loft("body", [
        (V(0, 0.000, 0.640), 0.150, 0.110),
        (V(0, -0.002, 0.730), 0.140, 0.100),
        (V(0, -0.004, 0.790), 0.122, 0.090),
        (V(0, -0.004, 0.840), 0.126, 0.094),
        (V(0, -0.004, 0.930), 0.140, 0.104),
        (V(0, 0.004, 1.020), 0.110, 0.084),
        (V(0, 0.006, 1.060), 0.060, 0.056),
    ], "tee", torso_w, sides=12, power=0.9, face_color_fn=body_colour)
    # cropped jacket, open at the front, cream hem band
    def jacket_colour(c, f):
        if c.y < -0.04 and abs(c.x) < 0.050:
            return "tee"
        if c.z < 0.880:
            return "cream"
        return None
    kit.loft("jacket", [
        (V(0, 0.000, 0.858), 0.142, 0.106),
        (V(0, 0.000, 0.905), 0.152, 0.112),
        (V(0, 0.002, 0.975), 0.166, 0.110),
        (V(0, 0.006, 1.028), 0.124, 0.090),
        (V(0, 0.008, 1.050), 0.074, 0.064),
    ], "purple", ("chain", ["spine", "chest"], 0.06), sides=12, power=0.85, face_color_fn=jacket_colour,
        cap0=False)
    kit.blob("collar", V(0, 0.020, 1.040), (0.105, 0.090, 0.034), "cream", ("rigid", "chest"),
             seg=12, rings=4)
    crown = [(-1.0, 0.0), (1.0, 0.0), (1.0, 0.75), (0.5, 0.32), (0.0, 0.92), (-0.5, 0.32), (-1.0, 0.75)]
    Mb = Matrix.Translation(V(0, 0.114, 0.935)) @ Euler((math.radians(90), 0, math.radians(180))).to_matrix().to_4x4() @ Matrix.Scale(0.050, 4)
    kit.shape("crown_back", crown, Mb, 0.25, "cream", ("rigid", "chest"))
    Mf = Matrix.Translation(V(0.072, -0.110, 0.955)) @ Euler((math.radians(90), 0, 0)).to_matrix().to_4x4() @ Matrix.Scale(0.026, 4)
    kit.shape("crown_front", crown, Mf, 0.30, "cream", ("rigid", "chest"))

    # ---- arms: puffy purple sleeves with cream cuffs, bare forearms, fingerless gloves
    def arm(side):
        m = 1 if side == "L" else -1
        f = (lambda v: V(v.x * m, v.y, v.z))
        sh, el, wr = f(SH), f(ELBOW), f(WRIST)
        d = (el - sh).normalized()
        d2 = (wr - el).normalized()
        wa = ("chain", [f"upper_arm.{side}", f"forearm.{side}"], 0.05)
        kit.blob(f"shoulder.{side}", sh + V(0, 0, 0.004), (0.068, 0.066, 0.064), "purple",
                 ("rigid", f"upper_arm.{side}"), seg=10, rings=6)
        kit.loft(f"sleeve.{side}", [(sh + d * 0.02, 0.064, 0.064), (sh + d * 0.10, 0.066, 0.066),
                                    (sh + d * 0.130, 0.060, 0.060)], "purple",
                 ("rigid", f"upper_arm.{side}"), sides=10, cap1=False)
        kit.loft(f"cuff.{side}", [(sh + d * 0.125, 0.064, 0.064), (sh + d * 0.168, 0.058, 0.058)],
                 "cream", ("rigid", f"upper_arm.{side}"), sides=10, cap0=False)
        kit.loft(f"arm.{side}", [(sh + d * 0.15, 0.036, 0.036), (el, 0.034, 0.034),
                                 (wr - d2 * 0.03, 0.029, 0.029)], "skin", wa, sides=8, cap0=False)
        kit.loft(f"glove_cuff.{side}", [(wr - d2 * 0.050, 0.036, 0.036), (wr + d2 * 0.010, 0.042, 0.042)],
                 "glove", ("chain", [f"forearm.{side}", f"hand.{side}"], 0.03), sides=8)
        fist = wr + d2 * 0.048
        kit.blob(f"fist.{side}", fist, (0.042, 0.046, 0.050), "glove", ("rigid", f"hand.{side}"),
                 seg=10, rings=6, power=0.72)
        kit.blob(f"fingers.{side}", fist + d2 * 0.018 + V(0, -0.030, 0), (0.032, 0.018, 0.026),
                 "skin", ("rigid", f"hand.{side}"), seg=8, rings=4, power=0.7)

    arm("L")
    arm("R")

    # ---- joggers with a purple side stripe, chunky purple sneakers
    kit.blob("pelvis", V(0, 0.004, 0.668), (0.146, 0.098, 0.074), "dark", ("rigid", "pelvis"),
             seg=12, rings=6, power=1.0)

    def leg(side):
        m = 1 if side == "L" else -1
        f = (lambda v: V(v.x * m, v.y, v.z))
        w = ("chain", [f"thigh.{side}", f"shin.{side}"], 0.07)

        def stripe(c, fc):
            return "purple" if (c.x * m) > 0.080 + 0.072 and abs(c.y) < 0.040 else None
        kit.loft(f"pants.{side}", [
            (f(V(0.078, 0.000, 0.700)), 0.090, 0.094),
            (f(V(0.084, -0.004, 0.580)), 0.094, 0.098),
            (f(KNEE), 0.086, 0.090),
            (f(V(0.090, -0.006, 0.250)), 0.082, 0.086),
            (f(V(0.092, -0.002, 0.180)), 0.078, 0.082),
            (f(V(0.092, 0.000, 0.148)), 0.064, 0.066),
        ], "dark", w, sides=12, cap0=False, face_color_fn=stripe)
        fr = ("rigid", f"foot.{side}")
        kit.blob(f"sole.{side}", f(V(0.094, -0.046, 0.034)), (0.068, 0.152, 0.036), "sole", fr,
                 seg=12, rings=4, power=0.5)
        kit.blob(f"shoe.{side}", f(V(0.094, -0.040, 0.098)), (0.062, 0.132, 0.060), "purple", fr,
                 seg=12, rings=6, power=0.62)
        kit.blob(f"tongue.{side}", f(V(0.094, -0.085, 0.138)), (0.036, 0.054, 0.028), "lilac", fr,
                 seg=8, rings=4, power=0.7, rot=(-25, 0, 0))
        kit.blob(f"heel.{side}", f(V(0.094, 0.060, 0.120)), (0.054, 0.034, 0.040), "purple_dark", fr,
                 seg=8, rings=4, power=0.7)

    leg("L")
    leg("R")
