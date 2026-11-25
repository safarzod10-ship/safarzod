"""CH_Technik — slim teen engineer: orange hoodie, goggles on the head, compact tech backpack,
dark cargo pants, chunky grey sneakers, fingerless gloves, plaster on the right cheek.
Reference: ref/technik.png (perspective concept, front three-quarter + back view).
Height ~1.50 m including hair; head ~ 1/4.1 of the body (stylised)."""
import math

from mathutils import Euler, Matrix, Vector

from dvor_lib import V

NAME = "CH_Technik"
ROLE = "technik"

PALETTE = {
    "skin": (238, 190, 150),
    "hair": (56, 38, 31),
    "orange": (242, 130, 32),
    "orange_dark": (206, 98, 24),
    "orange_mid": (228, 114, 28),
    "dark": (64, 60, 62),
    "glove": (48, 45, 48),
    "shoe": (92, 90, 92),
    "cream": (243, 236, 222),
    "pack": (58, 55, 58),
    "pack_dark": (42, 40, 43),
    "lens": (52, 62, 74),
    "gray": (142, 140, 138),
    "skin_shadow": (214, 160, 122),
}

# ---------------------------------------------------------------- skeleton (metres)
SH = V(0.196, 0.0, 0.985)            # left shoulder joint
ARM_OUT = math.radians(17)           # A-pose angle from vertical
ARM_DIR = V(math.sin(ARM_OUT), 0, -math.cos(ARM_OUT))
ELBOW = SH + ARM_DIR * 0.225
WRIST = ELBOW + ARM_DIR * 0.205
HAND_END = WRIST + ARM_DIR * 0.110
HIP = V(0.094, 0.0, 0.640)
KNEE = V(0.104, -0.012, 0.380)
ANKLE = V(0.108, 0.0, 0.125)
TOE = V(0.108, -0.170, 0.040)


def joints():
    j = {
        "root": (V(0, 0, 0), V(0, 0, 0.12)),
        "pelvis": (V(0, 0, 0.660), V(0, 0, 0.760)),
        "spine": (V(0, 0, 0.760), V(0, 0, 0.880)),
        "chest": (V(0, 0, 0.880), V(0, 0, 1.030)),
        "neck": (V(0, 0.004, 1.030), V(0, 0.004, 1.095)),
        "head": (V(0, 0.004, 1.095), V(0, 0.004, 1.420)),
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


# ---------------------------------------------------------------- face texture
def paint_face(d, P, SS):
    def poly(pts, fill, outline=None, width=0):
        d.polygon([P(*p) for p in pts], fill=fill, outline=outline)

    def ell(lon, lat, rw, rh, fill):
        x0, y0 = P(lon - rw, lat + rh)
        x1, y1 = P(lon + rw, lat - rh)
        d.ellipse([x0, y0, x1, y1], fill=fill)

    def line(pts, fill, w):
        d.line([P(*p) for p in pts], fill=fill, width=int(w * SS), joint="curve")

    skin_sh = (222, 168, 128)
    # soft cheek blush
    for s in (-1, 1):
        ell(36 * s, -20, 8, 4, (240, 180, 146))
    # nose: small shading wedge
    poly([(-3, -10), (3, -10), (6, -19), (0, -21), (-6, -19)], skin_sh)
    ell(0, -19, 5, 2.4, (226, 160, 122))
    # mouth: confident smirk (higher on the character's left = image right)
    line([(-12, -32), (-3, -33.5), (6, -33), (12, -30.5)], (118, 60, 50), 2.8)
    # eyes (offsets in "outward" units: +x = towards the ear), large and determined
    for s in (-1, 1):
        cx, cy = 26 * s, -1.0
        E = lambda ox, oy: (cx + ox * s, cy + oy)
        white = [E(-14, 0), E(-9, 4.5), E(0, 6.5), E(9, 6.5), E(15, 3.0), E(12, -4), E(3, -8),
                 E(-6, -7.5), E(-12, -3.5)]
        poly(white, (250, 248, 244))
        ell(cx - 0.5 * s, cy - 0.5, 7.8, 8.0, (104, 62, 38))            # iris
        ell(cx - 0.5 * s, cy - 0.3, 4.2, 4.4, (24, 16, 12))             # pupil
        ell(cx + 2.6 * s - 1.5, cy + 3.4, 2.1, 2.2, (255, 255, 255))    # highlight
        # heavy straight upper lid, sloping down to the nose -> frown
        line([E(-15, 0.5), E(-9, 5.0), E(0, 7.0), E(9, 7.0), E(16, 3.0)], (36, 22, 18), 3.4)
        line([E(-6, -7.8), E(3, -8.4), E(11, -4.8)], (190, 130, 100), 1.2)
        # thick brows, inner end low and close to the eye
        poly([E(-16, 8.5), E(-14, 14.0), E(2, 19.5), E(17, 19.5), E(19, 15.0), E(3, 13.0)], (46, 30, 24))
    # plaster on the character's right cheek (image left)
    cx, cy = -38, -14
    ang = math.radians(28)
    pts = []
    for dx, dy in ((-9, -3.6), (9, -3.6), (9, 3.6), (-9, 3.6)):
        pts.append((cx + dx * math.cos(ang) - dy * math.sin(ang), cy + dx * math.sin(ang) + dy * math.cos(ang)))
    poly(pts, (244, 220, 186))
    line(pts + [pts[0]], (214, 182, 146), 1.0)
    for dx in (-2.5, 2.5):
        ell(cx + dx * math.cos(ang), cy + dx * math.sin(ang), 0.9, 0.9, (214, 182, 146))


# ---------------------------------------------------------------- geometry
def build(kit):
    J = joints()
    chain_torso = ("chain", ["pelvis", "spine", "chest"], 0.08)

    # ---- head (big stylised head: width / shoulder span ~ 0.7 as on the concept)
    HC = V(0, -0.008, 1.236)
    HS = 1.13                                    # head scale vs. the first blockout
    OLD_HC = V(0, -0.006, 1.228)
    kit.blob("head", HC, (0.170, 0.160, 0.170), "skin", ("rigid", "head"), seg=16, rings=12,
             head_uv=True, back_color="skin")
    for s in (1, -1):
        kit.blob(f"ear_{s}", V(0.166 * s, 0.006, 1.218), (0.026, 0.036, 0.046), "skin",
                 ("rigid", "head"), seg=6, rings=4)
    # hair: voluminous cap + chunky messy clumps
    kit.blob("hair_cap", V(0, 0.026, 1.292), (0.184, 0.178, 0.146), "hair", ("rigid", "head"),
             seg=12, rings=7, rot=(-14, 0, 0))
    spikes = [
        # base (x, y, z) in first-blockout space, direction, length, radius
        ((0.00, -0.105, 1.335), (0.0, -0.75, -0.55), 0.10, 0.050),
        ((-0.065, -0.105, 1.325), (-0.30, -0.75, -0.55), 0.10, 0.045),
        ((0.065, -0.105, 1.325), (0.35, -0.70, -0.60), 0.095, 0.045),
        ((-0.115, -0.07, 1.300), (-0.75, -0.45, -0.45), 0.085, 0.042),
        ((0.115, -0.07, 1.300), (0.75, -0.45, -0.50), 0.085, 0.042),
        ((-0.140, 0.02, 1.270), (-0.85, 0.20, -0.45), 0.080, 0.045),
        ((0.140, 0.02, 1.270), (0.85, 0.20, -0.45), 0.080, 0.045),
        ((-0.090, 0.10, 1.320), (-0.55, 0.65, -0.20), 0.085, 0.048),
        ((0.090, 0.10, 1.320), (0.55, 0.65, -0.20), 0.085, 0.048),
        ((0.000, 0.125, 1.300), (0.0, 0.85, -0.45), 0.085, 0.050),
        ((-0.050, 0.04, 1.385), (-0.35, 0.30, 0.85), 0.075, 0.048),
        ((0.060, 0.02, 1.390), (0.40, 0.10, 0.85), 0.070, 0.046),
        ((0.000, 0.10, 1.375), (0.0, 0.80, 0.55), 0.080, 0.050),
    ]
    for i, (b, d, L, r) in enumerate(spikes):
        b = HC + (V(b) - OLD_HC) * HS
        d = V(d).normalized()
        r *= 1.35
        bend = V(0, 0, -0.014)
        kit.loft(f"hair_spike_{i}", [(b, r, r * 0.8), (b + d * L * 0.5 + bend, r * 0.62, r * 0.5),
                                     (b + d * L + bend * 2.5, r * 0.10, r * 0.08)],
                 "hair", ("rigid", "head"), sides=5, cap0=True, cap1=False)

    # ---- goggles pushed up on the head
    band = []
    n = 14
    for k in range(n):
        a = 2 * math.pi * k / n
        p = V(math.sin(a) * 0.190, -math.cos(a) * 0.184, 0.0)
        p = Euler((math.radians(-24), 0, 0)).to_matrix() @ p
        band.append((V(0, 0.0, 1.336) + p, 0.014, 0.032))
    kit.loft("goggle_band", band, "pack_dark", ("rigid", "head"), sides=4, power=1.0, phase=0.5,
             closed=True, front=V(0, 0, 1))
    gdir = V(0, -0.70, 0.72).normalized()
    for s in (1, -1):
        c = V(0.076 * s, -0.138, 1.374)
        rings = [(c - gdir * 0.012, 0.057, 0.052), (c + gdir * 0.024, 0.059, 0.054),
                 (c + gdir * 0.033, 0.049, 0.044)]
        kit.loft(f"goggle_lens_{s}", rings, "orange", ("rigid", "head"), sides=10, front=V(0, 0, 1))
        kit.blob(f"goggle_glass_{s}", c + gdir * 0.031, (0.046, 0.044, 0.008), "lens",
                 ("rigid", "head"), seg=10, rings=3,
                 rot=(math.degrees(math.atan2(gdir.y, gdir.z)) * -1, 0, 0))
    kit.blob("goggle_bridge", V(0, -0.156, 1.382), (0.024, 0.012, 0.011), "pack_dark",
             ("rigid", "head"), seg=6, rings=3, rot=(45, 0, 0))

    # ---- neck (mostly hidden by the hood collar)
    kit.loft("neck", [(V(0, 0.006, 1.015), 0.054, 0.052), (V(0, 0.006, 1.110), 0.052, 0.050)],
             "skin", ("chain", ["neck", "head"], 0.04), sides=8)

    # ---- hoodie torso
    def hem(cen, f):
        return "orange_dark" if cen.z < 0.648 else None
    kit.loft("hoodie", [
        (V(0, -0.004, 0.622), 0.174, 0.128),
        (V(0, -0.006, 0.668), 0.182, 0.136),
        (V(0, -0.008, 0.780), 0.178, 0.132),
        (V(0, -0.006, 0.900), 0.198, 0.138),
        (V(0, 0.000, 0.978), 0.206, 0.132),
        (V(0, 0.006, 1.035), 0.160, 0.110),
        (V(0, 0.008, 1.078), 0.098, 0.088),
    ], "orange", chain_torso, sides=12, power=0.82, face_color_fn=hem)
    # hood bunched around the back of the neck (hides the neck from the side and back)
    kit.blob("hood", V(0, 0.058, 1.062), (0.158, 0.096, 0.072), "orange", ("rigid", "chest"),
             seg=12, rings=6)
    kit.blob("hood_drop", V(0, 0.118, 0.982), (0.118, 0.042, 0.080), "orange_dark", ("rigid", "chest"),
             seg=10, rings=5)
    # kangaroo pocket (flat)
    kit.blob("pocket", V(0, -0.134, 0.738), (0.112, 0.010, 0.056), "orange_mid",
             ("chain", ["pelvis", "spine"], 0.06), seg=8, rings=4, power=0.55)
    # drawstrings
    for s in (1, -1):
        kit.loft(f"string_{s}", [(V(0.036 * s, -0.128, 1.032), 0.008, 0.008),
                                 (V(0.042 * s, -0.150, 0.925), 0.008, 0.008)],
                 "cream", ("rigid", "chest"), sides=4)

    # ---- arms (left built, right mirrored)
    def arm(side):
        m = 1 if side == "L" else -1
        f = (lambda v: V(v.x * m, v.y, v.z))
        sh, el, wr = f(SH), f(ELBOW), f(WRIST)
        d = (el - sh).normalized()
        d2 = (wr - el).normalized()
        wa = ("chain", [f"upper_arm.{side}", f"forearm.{side}"], 0.05)
        kit.blob(f"shoulder.{side}", sh + V(0, 0, 0.004), (0.082, 0.080, 0.078), "orange",
                 ("rigid", f"upper_arm.{side}"), seg=10, rings=6)
        kit.loft(f"sleeve.{side}", [
            (sh + d * 0.02, 0.074, 0.074), (sh + d * 0.12, 0.071, 0.071),
            (el + d * 0.000, 0.068, 0.068), (el + d2 * 0.012, 0.066, 0.066)],
            "orange", wa, sides=10, cap1=False)
        kit.loft(f"cuff.{side}", [(el + d2 * 0.004, 0.069, 0.069), (el + d2 * 0.040, 0.064, 0.064)],
                 "orange_dark", wa, sides=10, cap0=False)
        kit.loft(f"forearm.{side}", [(el + d2 * 0.03, 0.044, 0.044), (wr - d2 * 0.03, 0.039, 0.039)],
                 "skin", wa, sides=8, cap0=False, cap1=False)
        # big fingerless gloves
        kit.loft(f"glove_cuff.{side}", [(wr - d2 * 0.065, 0.048, 0.048), (wr + d2 * 0.010, 0.056, 0.056)],
                 "glove", ("chain", [f"forearm.{side}", f"hand.{side}"], 0.03), sides=8)
        fist = wr + d2 * 0.062
        kit.blob(f"fist.{side}", fist, (0.060, 0.064, 0.068), "glove", ("rigid", f"hand.{side}"),
                 seg=10, rings=6, power=0.7)
        kit.blob(f"fingers.{side}", fist + d2 * 0.026 + V(0, -0.042, 0), (0.046, 0.024, 0.034),
                 "skin", ("rigid", f"hand.{side}"), seg=8, rings=4, power=0.7)

    arm("L")
    arm("R")

    # ---- baggy cargo pants
    kit.blob("pelvis", V(0, 0.0, 0.668), (0.186, 0.132, 0.090), "dark", ("rigid", "pelvis"),
             seg=12, rings=6, power=0.85)

    def leg(side):
        m = 1 if side == "L" else -1
        f = (lambda v: V(v.x * m, v.y, v.z))
        w = ("chain", [f"thigh.{side}", f"shin.{side}"], 0.07)
        kit.loft(f"pants.{side}", [
            (f(V(0.092, 0.000, 0.700)), 0.120, 0.124),
            (f(V(0.098, -0.004, 0.580)), 0.126, 0.132),
            (f(KNEE), 0.120, 0.124),
            (f(V(0.106, -0.006, 0.270)), 0.116, 0.120),
            (f(V(0.108, -0.002, 0.200)), 0.112, 0.116),
            (f(V(0.108, 0.000, 0.162)), 0.098, 0.100),
        ], "dark", w, sides=10, cap0=False)
        kit.blob(f"cargo.{side}", f(V(0.212, -0.010, 0.492)), (0.028, 0.064, 0.070), "dark",
                 ("rigid", f"thigh.{side}"), seg=8, rings=4, power=0.6)
        kit.blob(f"cargo_flap.{side}", f(V(0.218, -0.010, 0.553)), (0.026, 0.066, 0.017),
                 "glove", ("rigid", f"thigh.{side}"), seg=8, rings=3, power=0.6)
        # chunky sneaker
        fr = ("rigid", f"foot.{side}")
        kit.blob(f"sole.{side}", f(V(0.108, -0.050, 0.037)), (0.080, 0.172, 0.038), "cream", fr,
                 seg=12, rings=4, power=0.5)
        kit.blob(f"shoe.{side}", f(V(0.108, -0.042, 0.106)), (0.072, 0.150, 0.066), "shoe", fr,
                 seg=12, rings=6, power=0.62)
        kit.blob(f"tongue.{side}", f(V(0.108, -0.098, 0.150)), (0.042, 0.062, 0.032), "cream", fr,
                 seg=8, rings=4, power=0.7, rot=(-25, 0, 0))
        kit.blob(f"heel.{side}", f(V(0.108, 0.068, 0.130)), (0.064, 0.040, 0.046), "orange", fr,
                 seg=8, rings=4, power=0.7)

    leg("L")
    leg("R")

    # ---- compact tech backpack
    kit.blob("pack", V(0, 0.228, 0.875), (0.162, 0.086, 0.160), "pack", ("rigid", "chest"),
             seg=12, rings=6, power=0.45)
    kit.blob("pack_lid", V(0, 0.224, 1.022), (0.150, 0.080, 0.030), "pack_dark", ("rigid", "chest"),
             seg=12, rings=4, power=0.45)
    kit.blob("pack_pocket", V(0, 0.312, 0.830), (0.112, 0.020, 0.086), "pack_dark", ("rigid", "chest"),
             seg=8, rings=4, power=0.45)
    kit.loft("pack_handle", [(V(-0.050, 0.226, 1.045), 0.012, 0.012), (V(0.0, 0.226, 1.082), 0.012, 0.012),
                             (V(0.050, 0.226, 1.045), 0.012, 0.012)], "pack_dark", ("rigid", "chest"),
             sides=4, cap0=False, cap1=False)
    crown = [(-1.0, 0.0), (1.0, 0.0), (1.0, 0.75), (0.5, 0.32), (0.0, 0.92), (-0.5, 0.32), (-1.0, 0.75)]
    M = Matrix.Translation(V(0, 0.336, 0.800)) @ Euler((math.radians(90), 0, math.radians(180))).to_matrix().to_4x4() @ Matrix.Scale(0.068, 4)
    kit.shape("pack_crown", crown, M, 0.30, "orange", ("rigid", "chest"))
    # straps
    for side, m in (("L", 1), ("R", -1)):
        pts = [V(0.110, 0.170, 1.012), V(0.132, 0.050, 1.082), V(0.140, -0.100, 1.040),
               V(0.150, -0.142, 0.905), V(0.164, -0.118, 0.790)]
        kit.loft(f"strap.{side}", [(V(p.x * m, p.y, p.z), 0.011, 0.036) for p in pts], "pack_dark",
                 ("rigid", "chest"), sides=4, phase=0.5, front=V(1, 0, 0))
