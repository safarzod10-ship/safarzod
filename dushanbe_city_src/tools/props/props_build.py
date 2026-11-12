"""Build all procedural DUSHANBE props and export GLBs.

  blender -b --python props_build.py -- [only=id1,id2] [noblend=1]

Output: dushanbe_city/assets/models/props/<id>.glb (+ <id>_lod1.glb for far LOD),
        dushanbe_city_src/tools/props/build_report.json (tris, bbox, materials, markers),
        dushanbe_city_src/blend/props_library.blend
Game coordinates: metres, +Y up, front = +Z, origin at ground centre (wall props: origin on the
wall plane z = 0, prop sticks out towards +Z).
"""
import json, math, os, sys
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import importlib
import props_lib
importlib.reload(props_lib)
from props_lib import Prop, tr, round_path, arc_pts, export_glb, PREVIEW  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
OUT = os.path.join(ROOT, "dushanbe_city", "assets", "models", "props")

PREVIEW.update({
    "paint_green_dark": (0.08, 0.22, 0.12), "paint_green": (0.15, 0.4, 0.18), "paint_blue": (0.1, 0.3, 0.6),
    "paint_white": (0.85, 0.85, 0.82), "paint_black": (0.05, 0.05, 0.05), "paint_grey": (0.55, 0.56, 0.55),
    "paint_grey_dark": (0.2, 0.21, 0.22), "paint_yellow": (0.9, 0.7, 0.1), "paint_red": (0.7, 0.1, 0.08),
    "galv": (0.6, 0.62, 0.63), "steel": (0.7, 0.7, 0.72), "wood": (0.45, 0.32, 0.2),
    "concrete": (0.55, 0.55, 0.52), "lamp_emissive": (1, 1, 0.9), "glass": (0.6, 0.7, 0.75),
})

# ------------------------------------------------------------------ atlas helpers
SIGN_CELLS = ["5.19.1", "5.16", "2.1", "2.4", "3.24", "3.27", "6.4", "3.1", "5.5", "1.23"]
PLATE_RECTS = {
    "street_0": (0, 0, 512, 128), "street_1": (512, 0, 512, 128),
    "street_2": (0, 128, 512, 128), "street_3": (512, 128, 512, 128),
    "house_0": (0, 256, 128, 128), "house_1": (128, 256, 128, 128),
    "house_2": (256, 256, 128, 128), "house_3": (384, 256, 128, 128),
    "stop_name": (512, 256, 512, 128), "route": (0, 384, 512, 128),
    "countdown": (512, 384, 128, 128), "ped_red": (640, 384, 128, 128), "ped_green": (768, 384, 128, 128),
    "electro": (896, 384, 128, 128), "ad": (0, 512, 384, 512), "gas": (384, 512, 256, 64),
    "container_label": (384, 576, 256, 64),
}


def sign_uv(kind, size, mirror=False):
    i = SIGN_CELLS.index(kind)
    col, row = i % 4, i // 4
    ins = 0.996

    def f(x, y):
        nx, ny = x / size * ins, y / size * ins
        if mirror:
            nx = -nx
        return ((col + nx + 0.5) / 4.0, 1.0 - (row + 0.5 - ny) / 4.0)
    return f


def plate_uv(key, w, h):
    x0, y0, pw, ph = PLATE_RECTS[key]

    def f(x, y):
        nx, ny = x / w * 0.995, y / h * 0.995
        return ((x0 + (nx + 0.5) * pw) / 1024.0, 1.0 - (y0 + (0.5 - ny) * ph) / 1024.0)
    return f


def textured_rect(P, c, w, h, mat, uvf, T=None, normal="z"):
    """Quad centred at c (local), size w x h, facing +Z (or +X / -Z), uv from uvf(local x, local y)."""
    pts, uvs = [], []
    for lx, ly in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        if normal == "z":
            p = Vector((c[0] + lx, c[1] + ly, c[2]))
        elif normal == "-z":
            p = Vector((c[0] - lx, c[1] + ly, c[2]))
        elif normal == "x":
            p = Vector((c[0], c[1] + ly, c[2] - lx))
        else:  # -x
            p = Vector((c[0], c[1] + ly, c[2] + lx))
        if T is not None:
            p = T @ p
        pts.append(p)
        uvs.append(uvf(lx, ly))
    return P.quad(pts, mat, uvs)


def frustum(P, y0, y1, b, t, mat, T=None, cx=0.0, cz=0.0, top=True, bottom=False):
    """Tapered rectangular column; b,t = (sx, sz) bottom/top size."""
    B = [P.v((cx + sx * b[0] / 2, y0, cz + sz * b[1] / 2), T) for sx, sz in ((-1, 1), (1, 1), (1, -1), (-1, -1))]
    U = [P.v((cx + sx * t[0] / 2, y1, cz + sz * t[1] / 2), T) for sx, sz in ((-1, 1), (1, 1), (1, -1), (-1, -1))]
    for i in range(4):
        j = (i + 1) % 4
        P.face([B[i], B[j], U[j], U[i]], mat)
    if top:
        P.face(U, mat)
    if bottom:
        P.face(list(reversed(B)), mat)


def visor(P, c, r, length, mat, seg=6, T=None, arc=200):
    """Half-tube sun visor over a traffic-light lens, opening to +Z (double sided)."""
    a0 = (180 - arc) / 2
    rows = []
    for k in range(seg + 1):
        a = math.radians(a0 + arc * k / seg)
        rows.append((math.cos(a) * r, math.sin(a) * r))
    for z0, z1, flip in ((0, length, False), (0, length, True)):
        grid = []
        for zz in (z0, z1):
            row = []
            for x, y in rows:
                p = Vector((c[0] + x, c[1] + y, c[2] + zz))
                row.append(T @ p if T is not None else p)
            grid.append(row)
        if flip:
            grid = [list(reversed(r_)) for r_ in grid]
        P.tri_strip_surface(grid, mat, smooth=True)


REG = []


def prop(pid, lod=False, group="misc"):
    def deco(fn):
        REG.append((pid, fn, lod, group))
        return fn
    return deco


# ================================================================== BENCHES
@prop("bench_park_soviet", group="benches")
def bench_park_soviet(P, L):
    frame, slat = "paint_black", "wood_painted_green"
    side = (1, 0, 0)
    for sx in (-0.80, 0.80):
        P.beam((sx, 0, 0.22), (sx, 0.43, 0.19), 0.055, 0.05, frame, up=side)       # front leg
        P.beam((sx, 0, -0.21), (sx, 0.40, -0.19), 0.055, 0.05, frame, up=side)     # rear leg
        P.beam((sx, 0.41, 0.25), (sx, 0.385, -0.24), 0.05, 0.05, frame, up=side)   # seat rail
        P.beam((sx, 0.37, -0.20), (sx, 0.86, -0.32), 0.05, 0.05, frame, up=side)   # back support
        P.beam((sx, 0.62, 0.20), (sx, 0.64, -0.26), 0.045, 0.045, frame, up=side)  # armrest
        P.beam((sx, 0.43, 0.20), (sx, 0.62, 0.20), 0.04, 0.04, frame, up=side)
        P.box((sx, 0.015, 0.22), (0.09, 0.03, 0.09), frame)                         # feet
        P.box((sx, 0.015, -0.21), (0.09, 0.03, 0.09), frame)
    for i in range(5):
        z = 0.21 - i * 0.092
        y = 0.437 - (0.21 - z) * 0.055
        P.box((0, y, z), (2.0, 0.035, 0.075), slat, bevel=0.006, uoff=i * 0.37)
    d = Vector((0, 0.86 - 0.37, -0.32 + 0.20)).normalized()
    n = Vector((0, 0.12, 0.49)).normalized()
    for i in range(3):
        base = Vector((0, 0.37, -0.20)) + d * (0.16 + i * 0.13) + n * 0.045
        P.beam((-1.0, base.y, base.z), (1.0, base.y, base.z), 0.095, 0.03, slat, up=n, bevel=0.006, uoff=i * 0.53)


@prop("bench_courtyard", group="benches")
def bench_courtyard(P, L):
    frame, slat = "paint_grey_dark", "wood_painted_brown"
    for sx in (-0.75, 0.75):
        P.tube(round_path([(sx, 0, 0.18), (sx, 0.42, 0.18), (sx, 0.42, -0.18), (sx, 0.0, -0.18)], 0.04, 3), 0.02, frame, seg=8)
        P.tube([(sx, 0.40, -0.18), (sx, 0.82, -0.27)], 0.02, frame, seg=8)
        P.box((sx, 0.005, 0.18), (0.08, 0.01, 0.08), frame)
        P.box((sx, 0.005, -0.18), (0.08, 0.01, 0.08), frame)
    for i in range(3):
        P.box((0, 0.455, 0.15 - i * 0.135), (1.8, 0.035, 0.11), slat, bevel=0.005, uoff=i * 0.41)
    d = Vector((0, 0.42, -0.09)).normalized()
    n = Vector((0, 0.09, 0.42)).normalized()
    for i in range(2):
        b = Vector((0, 0.40, -0.18)) + d * (0.18 + i * 0.17) + n * 0.035
        P.beam((-0.9, b.y, b.z), (0.9, b.y, b.z), 0.12, 0.03, slat, up=n, bevel=0.005, uoff=i * 0.6)


@prop("bench_concrete_slats", group="benches")
def bench_concrete_slats(P, L):
    for sx in (-0.7, 0.7):
        P.box((sx, 0.2, 0), (0.18, 0.4, 0.42), "concrete", bevel=0.015)
    for i in range(5):
        P.box((0, 0.42, 0.17 - i * 0.085), (2.0, 0.04, 0.07), "wood", bevel=0.006, uoff=i * 0.29)


@prop("bench_modern_metal", group="benches")
def bench_modern_metal(P, L):
    frame, seat = "paint_grey_dark", "steel"
    for sx in (-0.85, 0.0, 0.85):
        P.beam((sx, 0, 0.22), (sx, 0.43, 0.22), 0.06, 0.012, frame, up=(1, 0, 0))
        P.beam((sx, 0, -0.22), (sx, 0.43, -0.22), 0.06, 0.012, frame, up=(1, 0, 0))
        P.beam((sx, 0.415, 0.26), (sx, 0.415, -0.26), 0.03, 0.012, frame, up=(1, 0, 0))
        P.beam((sx, 0.43, -0.24), (sx, 0.85, -0.31), 0.06, 0.012, frame, up=(1, 0, 0))
        P.box((sx, 0.004, 0.22), (0.1, 0.008, 0.1), frame)
        P.box((sx, 0.004, -0.22), (0.1, 0.008, 0.1), frame)
    for i in range(8):
        P.box((0, 0.44, 0.24 - i * 0.068), (1.9, 0.012, 0.05), seat, bevel=0.003)
    d = Vector((0, 0.42, -0.07)).normalized()
    n = Vector((0, 0.07, 0.42)).normalized()
    for i in range(5):
        b = Vector((0, 0.43, -0.24)) + d * (0.08 + i * 0.07) + n * 0.012
        P.beam((-0.95, b.y, b.z), (0.95, b.y, b.z), 0.05, 0.012, seat, up=n, bevel=0.003)
    for sx in (-0.95, 0.95):  # armrests
        P.tube(round_path([(sx, 0.43, 0.2), (sx, 0.66, 0.2), (sx, 0.66, -0.2)], 0.05, 3), 0.016, frame, seg=8)


# ================================================================== URNS / BINS
@prop("urn_concrete_round", group="urns")
def urn_concrete_round(P, L):
    prof = [(0.20, 0.0), (0.21, 0.06), (0.24, 0.10), (0.28, 0.58), (0.31, 0.62), (0.31, 0.66),
            (0.26, 0.66), (0.23, 0.62), (0.19, 0.2), (0.0, 0.2)]
    P.lathe(prof, "concrete_light", seg=16, smooth=[False, True, True, False, False, False, False, True, False])
    P.lathe([(0.0, 0.0), (0.2, 0.0)], "concrete_light", seg=16)  # bottom (reversed winding = facing down)
    P.lathe([(0.21, 0.36), (0.17, 0.37), (0.10, 0.40), (0.0, 0.38)], "trash", seg=12, smooth=True)


@prop("urn_tilting", group="urns")
def urn_tilting(P, L):
    post, bucket = "paint_grey_dark", "paint_green"
    for sx in (-0.27, 0.27):
        P.cyl((sx, 0, 0), (sx, 0.82, 0), 0.025, post, seg=10)
        P.lathe([(0.026, 0.82), (0.03, 0.83), (0.0, 0.85)], post, seg=10)
        P.cyl((sx * 0.92, 0.62, 0), (sx * 0.78, 0.62, 0), 0.012, post, seg=6)
        P.box((sx, 0.005, 0), (0.12, 0.01, 0.12), post)
    T = tr((0, 0.30, 0))
    prof = [(0.17, 0.0), (0.2, 0.02), (0.205, 0.38), (0.215, 0.40), (0.215, 0.415), (0.198, 0.415), (0.19, 0.02), (0.0, 0.025)]
    P.lathe(prof, bucket, seg=14, T=T)
    P.lathe([(0.0, 0.0), (0.17, 0.0)], bucket, seg=14, T=T)
    P.lathe([(0.19, 0.25), (0.12, 0.27), (0.0, 0.25)], "trash", seg=10, T=T)


@prop("bin_modern_steel", group="urns")
def bin_modern_steel(P, L):
    P.lathe([(0.17, 0.0), (0.2, 0.0), (0.2, 0.05), (0.0, 0.05)], "paint_grey_dark", seg=16, smooth=False)
    P.cyl((0, 0.05, 0), (0, 0.78, 0), 0.19, "steel", seg=20, caps=(False, False))
    P.lathe([(0.19, 0.78), (0.2, 0.79), (0.2, 0.83), (0.15, 0.88), (0.0, 0.9)], "paint_grey_dark", seg=20,
            smooth=[False, False, True, True])
    # throw-in opening on the front (dark recess quad)
    P.box((0, 0.66, 0.188), (0.22, 0.13, 0.008), "plastic_black", skip=("back",))
    P.box((0, 0.73, 0.19), (0.26, 0.012, 0.012), "paint_grey_dark")
    P.box((0, 0.59, 0.19), (0.26, 0.012, 0.012), "paint_grey_dark")


# ================================================================== CONTAINERS
def trapezoid_container(P, paint):
    bw, bd, tw, td, y0, h = 1.10, 0.70, 1.40, 0.92, 0.10, 0.88
    t = 0.025

    def ring(w, d, y):
        return [(-w / 2, y, d / 2), (w / 2, y, d / 2), (w / 2, y, -d / 2), (-w / 2, y, -d / 2)]
    ob, ot = ring(bw, bd, y0), ring(tw, td, y0 + h)
    ib, it = ring(bw - 2 * t, bd - 2 * t, y0 + t), ring(tw - 2 * t, td - 2 * t, y0 + h)
    vb = [P.v(p) for p in ob]
    vt = [P.v(p) for p in ot]
    wb = [P.v(p) for p in ib]
    wt = [P.v(p) for p in it]
    for i in range(4):
        j = (i + 1) % 4
        P.face([vb[i], vb[j], vt[j], vt[i]], paint)
        P.face([wb[j], wb[i], wt[i], wt[j]], paint)          # inner walls face inward
        P.face([vt[i], vt[j], wt[j], wt[i]], paint)          # rim
    P.face(list(reversed(vb)), paint)
    P.face(wb, paint)
    P.box((0, y0 + h + 0.015, td / 2 + 0.005), (tw + 0.04, 0.04, 0.04), paint)
    P.box((0, y0 + h + 0.015, -td / 2 - 0.005), (tw + 0.04, 0.04, 0.04), paint)
    for sx in (-1, 1):
        P.box((sx * (tw / 2 + 0.005), y0 + h + 0.015, 0), (0.04, 0.04, td + 0.04), paint)
    # skids
    for sx in (-0.4, 0.4):
        P.box((sx, 0.05, 0), (0.08, 0.10, bd + 0.1), "paint_grey_dark")
    # side ribs and trunnion pins
    for sx in (-1, 1):
        for zz in (-0.2, 0.2):
            pts = [(sx * (bw / 2 + 0.01), y0 + 0.05, zz), (sx * (tw / 2 + 0.01), y0 + h - 0.02, zz)]
            P.beam(pts[0], pts[1], 0.05, 0.03, paint, up=(sx, 0, 0))
        P.cyl((sx * (bw / 2 + 0.09), y0 + 0.55, 0), (sx * (bw / 2 + 0.2), y0 + 0.55, 0), 0.04, "paint_grey_dark", seg=10)
    # front label plate
    lab_y = y0 + h * 0.62
    zf = (bd / 2) + (td - bd) / 2 * 0.62 + 0.004
    T = tr((0, lab_y, zf), rot=(-math.degrees(math.atan2((td - bd) / 2, h)), 0, 0))
    textured_rect(P, (0, 0, 0), 0.6, 0.15, "plates", plate_uv("container_label", 0.6, 0.15), T=T)
    # some rubbish inside
    P.lathe([(0.48, 0.52), (0.3, 0.6), (0.0, 0.62)], "trash", seg=10, T=tr((0, 0, 0), scale=(1.25, 1, 0.8)))


@prop("container_trash_green", group="containers")
def container_trash_green(P, L):
    trapezoid_container(P, "paint_green_dark")


@prop("container_trash_grey", group="containers")
def container_trash_grey(P, L):
    trapezoid_container(P, "paint_grey")


@prop("container_euro_wheeled", group="containers")
def container_euro_wheeled(P, L):
    """1.1 m3 galvanised euro container with lid and 4 castors (new residential complexes)."""
    m = "galv"
    frustum(P, 0.16, 1.15, (1.18, 0.95), (1.30, 1.05), m, bottom=True, top=False)
    P.box((0, 1.17, -0.02), (1.38, 0.05, 1.12), "plastic_dark_green", bevel=0.01)   # lid
    P.box((0, 1.12, 0.53), (1.34, 0.06, 0.03), m)
    for sx in (-1, 1):
        P.cyl((sx * 0.62, 0.95, 0.2), (sx * 0.72, 0.95, 0.2), 0.02, m, seg=8)
        P.cyl((sx * 0.62, 0.95, -0.2), (sx * 0.72, 0.95, -0.2), 0.02, m, seg=8)
        P.box((sx * 0.70, 0.95, 0), (0.03, 0.03, 0.44), m)
        for sz in (-1, 1):
            x, z = sx * 0.48, sz * 0.36
            P.box((x, 0.145, z), (0.1, 0.03, 0.1), "paint_grey_dark")
            P.box((x, 0.10, z), (0.04, 0.07, 0.06), "paint_grey_dark")
            P.cyl((x - 0.025, 0.065, z), (x + 0.025, 0.065, z), 0.065, "rubber", seg=12)
    P.beam((-0.4, 0.2, 0.49), (0.4, 0.2, 0.49), 0.04, 0.04, m)
    T = tr((0, 0.8, 0.505), rot=(-3, 0, 0))
    textured_rect(P, (0, 0, 0), 0.6, 0.15, "plates", plate_uv("container_label", 0.6, 0.15), T=T)


@prop("container_site", group="containers")
def container_site(P, L):
    """Concrete pad 4.2 x 2.2 with a 3-sided corrugated-sheet screen (open to +Z)."""
    P.box((0, 0.06, 0), (4.2, 0.12, 2.2), "concrete_worn", bevel=0.02)
    H = 1.6
    posts = [(-2.0, -1.0), (-0.67, -1.0), (0.67, -1.0), (2.0, -1.0), (-2.0, 0.0), (-2.0, 1.0), (2.0, 0.0), (2.0, 1.0)]
    for x, z in posts:
        P.box((x, 0.12 + H / 2 + 0.05, z), (0.06, H + 0.1, 0.06), "paint_grey_dark")
    sheet = "roof_painted_green"
    # back wall (two faces so it reads from both sides)
    P.box((0, 0.12 + 0.1 + H / 2, -1.0 - 0.035), (4.0, H, 0.012), sheet, swap=True)
    for sx in (-1, 1):
        P.box((sx * (2.0 + 0.035), 0.12 + 0.1 + H / 2, 0), (0.012, H, 2.0), sheet, swap=True)
    for y in (0.35, 1.65):
        P.box((0, 0.12 + y, -1.0), (4.0, 0.04, 0.04), "paint_grey_dark")
        for sx in (-1, 1):
            P.box((sx * 2.0, 0.12 + y, 0), (0.04, 0.04, 2.0), "paint_grey_dark")


# ================================================================== STREET LIGHTS
def led_head(P, base, direction, L, length=0.7):
    """LED luminaire continuing from an arm end. direction: unit vector in XZ."""
    dx, dz = direction
    c = Vector(base) + Vector((dx, 0, dz)) * (length / 2)
    yaw = math.degrees(math.atan2(dx, dz))
    T = tr(c, rot=(0, yaw, 0))
    # local: length along +Z
    P.box((0, 0.0, 0), (0.30, 0.09, length), "paint_grey", T=T, bevel=0.02 if L == 0 else 0)
    if L == 0:
        P.box((0, 0.05, -0.05), (0.22, 0.03, length * 0.75), "paint_grey", T=T, bevel=0.01)
    p0 = [T @ Vector(p) for p in ((-0.11, -0.047, -0.22), (0.11, -0.047, -0.22), (0.11, -0.047, 0.30), (-0.11, -0.047, 0.30))]
    P.quad(p0, "lamp_emissive")
    return T @ Vector((0, -0.10, 0.04))


def pole_base(P, L, r=0.12):
    P.box((0, 0.08, 0), (0.5, 0.16, 0.5), "concrete", bevel=0.02 if L == 0 else 0)
    P.box((0, 0.17, 0), (0.36, 0.02, 0.36), "galv")
    if L == 0:
        for sx in (-0.13, 0.13):
            for sz in (-0.13, 0.13):
                P.cyl((sx, 0.18, sz), (sx, 0.22, sz), 0.015, "galv", seg=6)


@prop("light_avenue_double", lod=True, group="lights")
def light_avenue_double(P, L):
    """10 m median pole, two arms along +X/-X, LED heads (light_point_0/1)."""
    seg = 10 if L == 0 else 6
    pole_base(P, L)
    P.lathe([(0.12, 0.18), (0.12, 0.85), (0.105, 0.9), (0.06, 9.7), (0.05, 9.95), (0.0, 9.98)], "galv", seg=seg,
            smooth=[True, True, True, True, True])
    if L == 0:
        P.box((0, 0.75, 0.112), (0.1, 0.3, 0.02), "galv")  # service hatch
    for s in (-1, 1):
        path = round_path([(0, 9.35, 0), (s * 0.06, 9.55, 0), (s * 0.7, 9.85, 0), (s * 1.75, 10.0, 0)], 0.35, 4 if L == 0 else 2)
        P.tube(path, 0.035, "galv", seg=8 if L == 0 else 5)
        lp = led_head(P, (s * 1.7, 10.0, 0), (s, 0), L)
        P.marker(f"light_point_{0 if s < 0 else 1}", lp)


@prop("light_street_single", lod=True, group="lights")
def light_street_single(P, L):
    """9 m sidewalk pole with one arm reaching 1.8 m over the road (+Z)."""
    seg = 10 if L == 0 else 6
    pole_base(P, L)
    P.lathe([(0.11, 0.18), (0.11, 0.8), (0.095, 0.85), (0.055, 8.7), (0.045, 8.95), (0.0, 8.98)], "galv", seg=seg)
    if L == 0:
        P.box((0, 0.72, 0.10), (0.09, 0.28, 0.02), "galv")
    path = round_path([(0, 8.4, 0), (0, 8.65, 0.07), (0, 8.95, 0.8), (0, 9.05, 1.7)], 0.3, 4 if L == 0 else 2)
    P.tube(path, 0.032, "galv", seg=8 if L == 0 else 5)
    lp = led_head(P, (0, 9.05, 1.65), (0, 1), L, length=0.62)
    P.marker("light_point_0", lp)


@prop("light_park_4m", lod=True, group="lights")
def light_park_4m(P, L):
    """Decorative 4 m park lamp: fluted black pole, opal globe lantern (light_point_0)."""
    seg = 12 if L == 0 else 6
    P.lathe([(0.17, 0.0), (0.17, 0.08), (0.14, 0.12), (0.12, 0.35), (0.09, 0.42), (0.07, 0.5), (0.065, 0.55)],
            "paint_black", seg=seg, smooth=[False, False, True, True, True, False])
    P.lathe([(0.0, 0.0), (0.17, 0.0)], "paint_black", seg=seg)
    P.cyl((0, 0.55, 0), (0, 3.35, 0), 0.05, "paint_black", r1=0.04, seg=seg, caps=(False, False))
    P.lathe([(0.04, 3.35), (0.07, 3.4), (0.08, 3.45), (0.06, 3.5), (0.11, 3.52), (0.11, 3.56)], "paint_black", seg=seg)
    gs = 12 if L == 0 else 6
    prof = [(0.11, 3.56)] + [(0.24 * math.sin(math.radians(a)), 3.80 - 0.24 * math.cos(math.radians(a))) for a in range(40, 171, 20 if L == 0 else 45)]
    P.lathe(prof, "lamp_emissive", seg=gs)
    P.lathe([(0.08, 4.03), (0.13, 4.05), (0.0, 4.12)], "paint_black", seg=seg, smooth=False)
    P.marker("light_point_0", (0, 3.80, 0))


# ================================================================== TRAFFIC LIGHTS
def vehicle_head(P, T, L, countdown=True):
    """3-section head, local origin = head centre, lenses face +Z. Height 1.0, width 0.36."""
    P.box((0, 0, 0), (0.36, 1.02, 0.22), "plastic_black", T=T, bevel=0.02 if L == 0 else 0)
    if L == 0:
        P.box((0, 0, -0.115), (0.56, 1.26, 0.01), "plastic_black", T=T)  # contrast backboard
    for i, mat in enumerate(("tl_red", "tl_yellow", "tl_green")):
        y = 0.33 - i * 0.33
        P.disc((0, y, 0.113), 0.105, mat, seg=16 if L == 0 else 8, T=T, axis="z")
        if L == 0:
            visor(P, (0, y, 0.11), 0.125, 0.22, "plastic_black", T=T)
    if countdown:
        cT = T @ tr((0, -0.77, 0.0))
        P.box((0, 0, 0), (0.42, 0.36, 0.14), "plastic_black", T=cT, bevel=0.01 if L == 0 else 0)
        textured_rect(P, (0, 0, 0.0705), 0.34, 0.28, "tl_countdown", plate_uv("countdown", 0.34, 0.28), T=cT)


def ped_head(P, T, L):
    P.box((0, 0, 0), (0.32, 0.64, 0.2), "plastic_black", T=T, bevel=0.015 if L == 0 else 0)
    for key, mat, y in (("ped_red", "tl_ped_red", 0.155), ("ped_green", "tl_ped_green", -0.155)):
        textured_rect(P, (0, y, 0.1005), 0.24, 0.24, mat, plate_uv(key, 0.24, 0.24), T=T)
        if L == 0:
            P.box((0, y + 0.135, 0.17), (0.28, 0.01, 0.14), "plastic_black", T=T)
            for sx in (-0.135, 0.135):
                P.box((sx, y + 0.07, 0.17), (0.01, 0.13, 0.14), "plastic_black", T=T)


@prop("traffic_light_pole", lod=True, group="traffic")
def traffic_light_pole(P, L):
    """Vehicle signal on a 3.6 m pole at the kerb, faces +Z (towards approaching traffic), countdown below."""
    seg = 10 if L == 0 else 6
    P.lathe([(0.12, 0.0), (0.12, 0.05), (0.07, 0.08), (0.0, 0.08)], "paint_grey_dark", seg=seg)
    P.cyl((0, 0.05, 0), (0, 3.6, 0), 0.055, "paint_grey_dark", seg=seg)
    T = tr((0, 3.0, 0.17))
    vehicle_head(P, T, L)
    for y in (2.75, 3.3):
        P.box((0, y, 0.08), (0.08, 0.06, 0.1), "paint_grey_dark")
    P.box((0, 2.23, 0.08), (0.08, 0.06, 0.1), "paint_grey_dark")


@prop("traffic_light_mast", lod=True, group="traffic")
def traffic_light_mast(P, L):
    """L-shaped mast: 6.8 m pole, horizontal arm 6 m along +X over the road, head + countdown hanging at the end (+Z face)."""
    seg = 12 if L == 0 else 6
    pole_base(P, L)
    P.lathe([(0.15, 0.18), (0.15, 0.5), (0.13, 0.55), (0.10, 6.8), (0.0, 6.82)], "paint_grey_dark", seg=seg)
    P.cyl((0.0, 6.3, 0), (6.1, 6.45, 0), 0.075, "paint_grey_dark", r1=0.05, seg=seg - 2)
    P.cyl((0.0, 5.5, 0), (2.2, 6.3, 0), 0.03, "paint_grey_dark", seg=6)  # brace
    for x in (4.2, 5.7):
        T = tr((x, 5.75, 0.08))
        vehicle_head(P, T, L, countdown=(x > 5))
        P.box((x, 6.3, 0.0), (0.06, 0.1, 0.06), "paint_grey_dark")
    # repeat head on the pole for the near lane / pedestrians, at 3 m
    T = tr((0, 3.0, 0.2))
    vehicle_head(P, T, L, countdown=False)
    P.box((0, 3.0, 0.1), (0.08, 0.1, 0.1), "paint_grey_dark")


@prop("traffic_light_ped", lod=True, group="traffic")
def traffic_light_ped(P, L):
    seg = 10 if L == 0 else 6
    P.lathe([(0.11, 0.0), (0.11, 0.05), (0.06, 0.08), (0.0, 0.08)], "paint_grey_dark", seg=seg)
    P.cyl((0, 0.05, 0), (0, 2.9, 0), 0.05, "paint_grey_dark", seg=seg)
    T = tr((0, 2.45, 0.15))
    ped_head(P, T, L)
    P.box((0, 2.6, 0.07), (0.07, 0.05, 0.08), "paint_grey_dark")
    P.box((0, 2.25, 0.07), (0.07, 0.05, 0.08), "paint_grey_dark")
    # push button box
    P.box((0, 1.1, 0.07), (0.1, 0.16, 0.08), "paint_yellow", bevel=0.01 if L == 0 else 0)


# ================================================================== ROAD SIGNS
def sign_post(P, top, plate_center_y, plate_half_h):
    P.cyl((0, 0, 0), (0, top, 0), 0.038, "galv", seg=10)
    P.lathe([(0.038, top), (0.042, top + 0.005), (0.0, top + 0.03)], "plastic_black", seg=10)
    for y in (plate_center_y - plate_half_h * 0.6, plate_center_y + plate_half_h * 0.6):
        P.cyl((0, y - 0.02, 0), (0, y + 0.02, 0), 0.045, "galv", seg=10)
        P.box((0, y, 0.05), (0.05, 0.04, 0.03), "galv")
        P.box((0, y, 0.0675), (0.2, 0.04, 0.005), "galv")


def sign_plate(P, kind, shape, size, cy, mirror=False, z=0.07):
    th = 0.012
    T = tr((0, cy, z + th / 2))
    if shape == "square":
        h = size / 2
        poly = [(-h, -h), (h, -h), (h, h), (-h, h)]
        uvf = sign_uv(kind, size, mirror)
    elif shape == "diamond":
        h = size / 2
        poly = [(-h, -h), (h, -h), (h, h), (-h, h)]
        T = T @ tr(rot=(0, 0, 45))
        uvf = sign_uv(kind, size, mirror)
    elif shape in ("tri", "tri_inv"):
        k = math.sqrt(3) / 2
        poly = [(-size / 2, -size * k / 2), (size / 2, -size * k / 2), (0, size * k / 2)]
        if shape == "tri_inv":
            poly = [(x, -y) for x, y in reversed(poly)]
        uvf = sign_uv(kind, size, mirror)
    else:  # circle
        r = size / 2
        poly = [(math.cos(2 * math.pi * i / 28) * r, math.sin(2 * math.pi * i / 28) * r) for i in range(28)]
        uvf = sign_uv(kind, size, mirror)
    P.poly_extrude(poly, th, "galv", T=T, front_mat="signs", front_uv=uvf)


SIGNS = {
    # id: (atlas kind, shape, size m, mirror)
    "sign_5_19_1": ("5.19.1", "square", 0.70, False),
    "sign_5_19_2": ("5.19.1", "square", 0.70, True),
    "sign_5_16": ("5.16", "square", 0.70, False),
    "sign_2_1": ("2.1", "diamond", 0.70, False),
    "sign_2_4": ("2.4", "tri_inv", 0.90, False),
    "sign_3_24_60": ("3.24", "circle", 0.70, False),
    "sign_3_27": ("3.27", "circle", 0.70, False),
    "sign_6_4": ("6.4", "square", 0.70, False),
    "sign_3_1": ("3.1", "circle", 0.70, False),
    "sign_5_5": ("5.5", "square", 0.70, False),
    "sign_1_23": ("1.23", "tri", 0.90, False),
}


def make_sign_fn(kind, shape, size, mirror):
    def fn(P, L):
        half = size / 2 * (math.sqrt(2) if shape == "diamond" else (math.sqrt(3) / 2 if shape.startswith("tri") else 1))
        cy = 2.05 + half
        sign_post(P, cy + half + 0.06, cy, half)
        sign_plate(P, kind, shape, size, cy, mirror)
    return fn


for sid, (k, sh, sz, mi) in SIGNS.items():
    prop(sid, group="signs")(make_sign_fn(k, sh, sz, mi))


# ================================================================== BUS STOP
@prop("bus_stop_shelter", lod=True, group="busstop")
def bus_stop_shelter(P, L):
    """4.6 x 1.6 x 2.65 m shelter. Back wall glass at z=-0.7, open front (+Z faces the road).
    Ad light-box on the +X end, name plate on the roof fascia, route plate on the -X front post."""
    fr = "paint_grey_dark"
    H = 2.5
    xs = (-2.25, -0.75, 0.75, 2.25)
    for x in xs:
        P.box((x, H / 2, -0.7), (0.08, H, 0.08), fr)
        P.box((x, 0.005, -0.7), (0.16, 0.01, 0.16), fr)
    for x in (-2.25, 2.25):
        P.box((x, H / 2, 0.55), (0.08, H, 0.08), fr)
        P.box((x, H / 2 + 0.5, -0.07), (0.06, 0.06, 1.25), fr)
    # roof: slightly sloped panel + fascia
    P.box((0, H + 0.06, -0.05), (4.75, 0.06, 1.75), "paint_grey", bevel=0.01 if L == 0 else 0)
    P.box((0, H + 0.02, 0.76), (4.75, 0.26, 0.06), fr)
    P.box((0, H + 0.02, -0.86), (4.75, 0.14, 0.04), fr)
    textured_rect(P, (0, H + 0.02, 0.791), 1.04, 0.26, "plates", plate_uv("stop_name", 1.04, 0.26))
    P.box((0, H - 0.07, -0.7), (4.5, 0.06, 0.06), fr)
    P.box((0, 0.12, -0.7), (4.5, 0.05, 0.05), fr)
    # glass back + -X side
    gl = "glass"
    for i in range(3):
        x0, x1 = xs[i] + 0.04, xs[i + 1] - 0.04
        P.box(((x0 + x1) / 2, (0.15 + H - 0.1) / 2, -0.7), (x1 - x0, H - 0.25, 0.012), gl)
    P.box((-2.25, (0.15 + H - 0.1) / 2, -0.07), (0.012, H - 0.25, 1.17), gl)
    # ad light-box on +X end
    P.box((2.25, 1.15, -0.07), (0.18, 1.9, 1.25), fr, bevel=0.015 if L == 0 else 0)
    for nrm, xx in (("x", 2.341), ("-x", 2.159)):
        textured_rect(P, (xx, 1.15, -0.07), 1.12, 1.72, "ad_lightbox", plate_uv("ad", 1.12, 1.72), normal=nrm)
    # bench
    for x in (-1.5, 0.0, 1.5):
        P.box((x, 0.22, -0.5), (0.06, 0.44, 0.06), fr)
        P.box((x, 0.44, -0.55), (0.06, 0.04, 0.35), fr)
    for i in range(4 if L == 0 else 1):
        if L == 0:
            P.box((0, 0.47, -0.66 + i * 0.09), (3.4, 0.03, 0.07), "wood", bevel=0.005, uoff=i * 0.3)
        else:
            P.box((0, 0.47, -0.53), (3.4, 0.03, 0.34), "wood")
    # route plate
    P.box((-2.25, 1.75, 0.6), (0.04, 0.2, 0.02), fr)
    textured_rect(P, (-2.25, 1.65, 0.612), 0.56, 0.14, "plates", plate_uv("route", 0.56, 0.14))
    P.box((-2.25, 1.65, 0.6), (0.58, 0.16, 0.02), fr)
    if L == 0:
        P.marker("light_point_0", (0, H - 0.05, -0.1))


# ================================================================== UTILITY POLES
def insulator(P, x, y, z, L):
    P.cyl((x, y, z), (x, y + 0.12, z), 0.012, "galv", seg=6)
    if L == 0:
        P.lathe([(0.0, y + 0.08), (0.05, y + 0.09), (0.06, y + 0.12), (0.04, y + 0.15), (0.045, y + 0.18), (0.03, y + 0.21), (0.0, y + 0.215)],
                "insulator", seg=10, T=tr((x, 0, z)))
    else:
        P.cyl((x, y + 0.08, z), (x, y + 0.21, z), 0.05, "insulator", seg=5)
    return (x, y + 0.2, z)


@prop("utility_pole_concrete", lod=True, group="poles")
def utility_pole_concrete(P, L):
    """9.5 m tapered rectangular reinforced-concrete pole (СВ-95 type), crossarm + 3 pin insulators.
    Markers wire_0..2 at insulator tops (for cables)."""
    frustum(P, -0.0, 9.5, (0.16, 0.26), (0.12, 0.16), "concrete_light")
    P.beam((-0.85, 8.9, 0.11), (0.85, 8.9, 0.11), 0.06, 0.06, "galv")
    P.beam((0, 8.6, 0.09), (-0.6, 8.88, 0.11), 0.04, 0.04, "galv")
    P.beam((0, 8.6, 0.09), (0.6, 8.88, 0.11), 0.04, 0.04, "galv")
    P.box((0, 8.9, 0.04), (0.2, 0.12, 0.14), "galv")
    for i, x in enumerate((-0.75, 0.75)):
        P.marker(f"wire_{i}", insulator(P, x, 8.93, 0.11, L))
    P.marker("wire_2", insulator(P, 0.0, 9.5, 0.0, L))
    if L == 0:
        P.box((0, 3.0, 0.14), (0.12, 0.18, 0.02), "paint_white")  # pole number plate


@prop("utility_pole_wood", lod=True, group="poles")
def utility_pole_wood(P, L):
    """Old wooden 0.4 kV pole on a concrete stub (приставка), crossarm with 4 insulators."""
    seg = 10 if L == 0 else 6
    frustum(P, 0.0, 2.6, (0.18, 0.22), (0.16, 0.18), "concrete_light", cx=0, cz=-0.21)
    P.cyl((0, 0.4, 0), (0, 8.5, 0), 0.115, "wood_pole", r1=0.085, seg=seg)
    P.lathe([(0.085, 8.5), (0.0, 8.55)], "wood_pole", seg=seg)
    if L == 0:
        for y in (1.0, 1.4, 2.0, 2.4):
            P.cyl((0, y, -0.08), (0, y + 0.03, -0.08), 0.17, "galv", seg=10, caps=(False, False))
    P.beam((-0.8, 8.1, 0.13), (0.8, 8.1, 0.13), 0.08, 0.09, "wood_pole")
    for i, x in enumerate((-0.7, -0.25, 0.25, 0.7)):
        P.marker(f"wire_{i}", insulator(P, x, 8.145, 0.13, L))


# ================================================================== FENCES / WALLS
@prop("fence_lawn_hoop_green", group="fences")
def fence_lawn_hoop_green(P, L, mat="paint_green"):
    """2 m tileable lawn fence of overlapping hoops, 0.45 m high (segment spans x = -1..1)."""
    for i in range(5):
        cx = -1.0 + 0.2 + i * 0.4
        pts = [(cx - 0.3, -0.12, 0)] + arc_pts((cx, 0.15, 0), 0.30, 180, 0, 8) + [(cx + 0.3, -0.12, 0)]
        P.tube(pts, 0.008, mat, seg=6)
    P.tube([(-1.0, 0.3, 0), (1.0, 0.3, 0)], 0.008, mat, seg=6, caps=False)


@prop("fence_lawn_hoop_white", group="fences")
def fence_lawn_hoop_white(P, L):
    fence_lawn_hoop_green(P, L, mat="paint_white")


@prop("fence_decorative_15", group="fences")
def fence_decorative_15(P, L):
    """1.5 m decorative steel fence, 2.5 m segment (post at x=-1.25, segment ends at x=+1.25)."""
    m = "paint_black"
    P.box((-1.25, 0.8, 0), (0.08, 1.6, 0.08), m)
    P.lathe([(0.05, 1.6), (0.06, 1.62), (0.04, 1.66), (0.0, 1.72)], m, seg=8, T=tr((-1.25, 0, 0)))
    for y in (0.12, 1.32):
        P.box((0.04, y, 0), (2.5 - 0.08, 0.04, 0.025), m)
    n = 19
    for i in range(n):
        x = -1.25 + 0.04 + (i + 0.5) * (2.42 / n)
        top = 1.48 if i % 2 == 0 else 1.42
        P.box((x, (0.05 + top) / 2, 0), (0.016, top - 0.05, 0.016), m)
        P.lathe([(0.016, top), (0.0, top + 0.07)], m, seg=4, T=tr((x, 0, 0), rot=(0, 45, 0)))
    for i in range(6):  # rings between rails
        x = -1.25 + 0.25 + i * 0.4
        P.tube(arc_pts((x, 1.21, 0), 0.07, 0, 360, 10), 0.006, m, seg=4, caps=False)


@prop("barrier_pedestrian", group="fences")
def barrier_pedestrian(P, L):
    """Avenue pedestrian barrier 1.0 m high, 2 m segment (post at x=-1)."""
    m = "paint_white"
    P.cyl((-1.0, 0, 0), (-1.0, 1.02, 0), 0.03, m, seg=8)
    P.lathe([(0.03, 1.02), (0.035, 1.03), (0.0, 1.06)], m, seg=8, T=tr((-1.0, 0, 0)))
    P.cyl((-1.0, 0.98, 0), (1.0, 0.98, 0), 0.024, m, seg=8, caps=(False, False))
    P.box((0, 0.12, 0), (1.94, 0.03, 0.02), m)
    P.box((0, 0.85, 0), (1.94, 0.03, 0.02), m)
    for i in range(13):
        x = -0.9 + i * 0.15
        P.box((x, 0.485, 0), (0.014, 0.7, 0.014), m)
    P.box((0, 0.485, 0), (0.5, 0.25, 0.006), "paint_red", bevel=0.0)


@prop("fence_school_brick", group="fences")
def fence_school_brick(P, L):
    """School / hospital perimeter fence 1.8 m: brick post (x=-1.5) + steel bar panel on a concrete plinth. 3 m segment."""
    P.box((-1.5, 0.95, 0), (0.38, 1.9, 0.38), "brick_red")
    P.box((-1.5, 1.94, 0), (0.46, 0.08, 0.46), "concrete_light", bevel=0.01)
    P.box((0.19, 0.15, 0), (2.62, 0.3, 0.22), "concrete_light", bevel=0.01)
    m = "paint_green_dark"
    for y in (0.42, 1.72):
        P.box((0.19, y, 0), (2.62, 0.04, 0.04), m)
    for i in range(20):
        x = -1.31 + 0.065 + i * 0.13
        P.box((x, 1.06, 0), (0.018, 1.48, 0.018), m)
        P.lathe([(0.018, 1.8), (0.0, 1.86)], m, seg=4, T=tr((x, 0, 0), rot=(0, 45, 0)))


@prop("wall_havli", group="fences")
def wall_havli(P, L):
    """Private-house (havli) wall 2.2 m, plastered, with concrete cap, 3 m tileable (x=-1.5..1.5)."""
    P.box((0, 1.1, 0), (3.0, 2.0, 0.28), "plaster_cream", skip=("left", "right"))
    P.box((0, 0.15, 0), (3.0, 0.3, 0.32), "concrete_worn", skip=("left", "right"))
    P.box((0, 2.14, 0), (3.0, 0.08, 0.40), "concrete_light", skip=("left", "right"))
    for z in (0.2, -0.2):
        P.box((0, 2.09, z * 0.95), (3.0, 0.02, 0.02), "concrete_light", skip=("left", "right"))


@prop("wall_havli_end", group="fences")
def wall_havli_end(P, L):
    """End cap / pillar for havli wall runs (0.45 x 0.45, 2.4 m)."""
    P.box((0, 1.15, 0), (0.45, 2.3, 0.45), "plaster_cream")
    P.box((0, 2.33, 0), (0.55, 0.08, 0.55), "concrete_light", bevel=0.01)
    P.lathe([(0.1, 2.37), (0.12, 2.42), (0.0, 2.5)], "concrete_light", seg=8)


@prop("gate_havli_blue", group="fences")
def gate_havli_blue(P, L, paint="paint_blue"):
    """Ornamental painted steel gate of a Tajik havli: 3.5 m opening, two leaves with wicket,
    between two plastered pillars. Total width 4.4 m, opens to +Z."""
    for sx in (-1, 1):
        P.box((sx * 1.975, 1.3, 0), (0.45, 2.6, 0.45), "plaster_cream")
        P.box((sx * 1.975, 2.64, 0), (0.55, 0.08, 0.55), "concrete_light", bevel=0.01)
        P.lathe([(0.1, 2.68), (0.13, 2.74), (0.0, 2.84)], "concrete_light", seg=8, T=tr((sx * 1.975, 0, 0)))
    m = paint
    # leaves: frame, lower sheet with embossed panels, upper ornamental bars with arch
    for sx in (-1, 1):
        x0, x1 = (-1.74, -0.01) if sx < 0 else (0.01, 1.74)
        cx, w = (x0 + x1) / 2, x1 - x0
        for y in (0.06, 1.3, 2.2):
            P.box((cx, y, 0), (w, 0.05, 0.05), m)
        for x in (x0 + 0.025, x1 - 0.025):
            P.box((x, 1.2, 0), (0.05, 2.3, 0.05), m)
        P.box((cx, 0.68, 0), (w - 0.05, 1.18, 0.012), m)
        for zz in (0.012, -0.012):
            for k in range(2):
                px = x0 + w * (0.27 + 0.46 * k)
                P.box((px, 0.68, zz), (w * 0.36, 0.9, 0.008), m, bevel=0.003)
        nb = 9
        for i in range(nb):
            x = x0 + 0.05 + (i + 0.5) * (w - 0.1) / nb
            P.box((x, 1.75, 0), (0.016, 0.88, 0.016), m)
        # arch on top (rising to the centre)
        pts = []
        for k in range(9):
            t = k / 8
            x = x0 + 0.03 + t * (w - 0.06)
            rise = math.sin(t * math.pi / 2) if sx < 0 else math.sin((1 - t) * math.pi / 2)
            pts.append((x, 2.22 + 0.35 * rise, 0))
        P.tube(pts, 0.02, m, seg=6)
        for k in range(1, 8):
            x, y, _ = pts[k]
            P.box((x, (2.22 + y) / 2, 0), (0.014, y - 2.22, 0.014), m)
        # sunburst ornament between rails
        c = (x1 - 0.12, 1.32, 0) if sx < 0 else (x0 + 0.12, 1.32, 0)
        for a in range(0, 181, 30):
            aa = math.radians(a if sx > 0 else 180 - a)
            P.tube([c, (c[0] + math.cos(aa) * 0.3 * (1 if sx > 0 else 1), c[1] + math.sin(aa) * 0.3, 0)], 0.008, m, seg=4)
        P.tube(arc_pts(c, 0.3, 0, 180, 8), 0.01, m, seg=4)
        P.tube(arc_pts(c, 0.12, 0, 180, 6), 0.01, m, seg=4)
        # handle and hinges
        hx = x1 - 0.08 if sx < 0 else x0 + 0.08
        P.box((hx, 1.05, 0.035), (0.03, 0.18, 0.02), "steel")
        for y in (0.3, 2.0):
            P.cyl((sx * 1.74, y - 0.06, 0.03), (sx * 1.74, y + 0.06, 0.03), 0.02, m, seg=6)


@prop("gate_havli_green", group="fences")
def gate_havli_green(P, L):
    gate_havli_blue(P, L, paint="paint_green")


@prop("bollard_concrete", group="fences")
def bollard_concrete(P, L):
    P.lathe([(0.0, 0.0), (0.2, 0.0), (0.2, 0.42), (0.17, 0.5), (0.1, 0.55), (0.0, 0.56)], "concrete_light", seg=16,
            smooth=[False, False, True, True, True])


@prop("curb_wheel_stop", group="fences")
def curb_wheel_stop(P, L):
    frustum(P, 0, 0.12, (1.8, 0.16), (1.75, 0.10), "concrete_light", bottom=False)
    for sx in (-0.6, 0.6):
        P.box((sx, 0.065, 0.081), (0.25, 0.04, 0.003), "paint_yellow", skip=("back",))


# ================================================================== SMALL STREET DETAILS
@prop("bike_rack_5", group="misc")
def bike_rack_5(P, L):
    m = "galv"
    for z in (-0.3, 0.3):
        P.box((0, 0.015, z), (2.0, 0.03, 0.05), m)
    for i in range(5):
        x = -0.8 + i * 0.4
        P.tube(round_path([(x, 0.03, -0.3), (x, 0.75, -0.3), (x, 0.75, 0.3), (x, 0.03, 0.3)], 0.15, 4), 0.022, m, seg=8)


@prop("manhole_cover", group="misc")
def manhole_cover(P, L):
    """Flush round cast-iron hatch (0.7 m lid in 0.84 m frame). Top at y=+0.005."""
    R = 0.42
    P.disc((0, 0.005, 0), R, "manhole", seg=24, axis="y", uvfn=lambda x, y: (x / (2 * R) + 0.5, y / (2 * R) + 0.5))
    P.cyl((0, -0.03, 0), (0, 0.005, 0), R, "manhole", seg=24, caps=(False, False))


@prop("storm_grate", group="misc")
def storm_grate(P, L):
    """Curb-side storm drain grate 0.8 (along curb, X) x 0.5 (Z). Top at y=+0.004."""
    u0, u1, v0, v1 = 148 / 512, 380 / 512, 1 - 366 / 512, 1 - 140 / 512
    w, d = 0.8, 0.5
    pts = [(-w / 2, 0.004, d / 2), (w / 2, 0.004, d / 2), (w / 2, 0.004, -d / 2), (-w / 2, 0.004, -d / 2)]
    P.quad(pts, "grate", uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])
    P.box((0, -0.015, 0), (w, 0.038, d), "grate_frame", skip=("top",))


@prop("planter_vase_soviet", group="misc")
def planter_vase_soviet(P, L):
    prof = [(0.25, 0.0), (0.25, 0.1), (0.15, 0.14), (0.12, 0.5), (0.16, 0.56), (0.22, 0.6), (0.40, 0.72),
            (0.52, 0.86), (0.55, 0.92), (0.55, 0.98), (0.49, 0.98), (0.46, 0.9)]
    P.lathe(prof, "concrete_light", seg=20, smooth=[False, False, True, True, True, True, True, True, False, False, True])
    P.lathe([(0.0, 0.0), (0.25, 0.0)], "concrete_light", seg=20)
    P.lathe([(0.46, 0.9), (0.0, 0.92)], "soil", seg=20, smooth=False)


@prop("planter_rect_concrete", group="misc")
def planter_rect_concrete(P, L):
    P.box((0, 0.25, 0), (1.5, 0.5, 0.6), "concrete_light", bevel=0.02, skip=("top",))
    P.box((0, 0.495, 0.275), (1.5, 0.01, 0.05), "concrete_light", skip=("bottom",))
    P.box((0, 0.495, -0.275), (1.5, 0.01, 0.05), "concrete_light", skip=("bottom",))
    P.box((0.725, 0.495, 0), (0.05, 0.01, 0.5), "concrete_light", skip=("bottom",))
    P.box((-0.725, 0.495, 0), (0.05, 0.01, 0.5), "concrete_light", skip=("bottom",))
    P.box((0, 0.44, 0), (1.4, 0.01, 0.5), "soil", skip=("bottom",))


def dish(P, R, depth):
    T = tr((0, 0.0, 0.0), rot=(65, 0, 0))   # axis +Y rotated toward +Z, tilted up 25 deg
    n = 6
    outer, inner = [], []
    for i in range(n + 1):
        r = R * i / n
        y = depth * (r / R) ** 2
        outer.append((r, y - 0.012))
        inner.append((r, y))
    prof = outer + [(R, depth + 0.004)] + list(reversed(inner))
    return T, prof


def sat_dish(P, L, R):
    m = "paint_white"
    depth = R * 0.18
    # wall bracket (wall plane z=0)
    P.box((0, 0, 0.005), (0.14, 0.2, 0.01), "galv")
    P.box((0, 0, 0.18), (0.04, 0.04, 0.34), "galv")
    P.beam((0, -0.09, 0.01), (0, 0, 0.3), 0.03, 0.03, "galv", up=(1, 0, 0))
    P.box((0, 0.02, 0.36), (0.07, 0.1, 0.05), "galv")
    T0 = tr((0, 0.05, 0.40), rot=(-25, 0, 0))   # dish centre, axis pointing +Z and 25 deg up
    T, prof = dish(P, R, depth)
    P.lathe(prof, m, seg=20, T=T0 @ tr(rot=(90, 0, 0)), smooth=True)
    # LNB arm and head
    f = Vector((0, 0, 0.62 * R * 2))
    a0 = T0 @ Vector((0, -R * 0.95, depth))
    a1 = T0 @ (f + Vector((0, -0.03, 0)))
    P.tube([a0, a1], 0.012, "galv", seg=6)
    P.cyl(T0 @ (f - Vector((0, 0, 0.02))), T0 @ (f + Vector((0, 0, 0.12))), 0.03, "plastic_grey", seg=8)


@prop("satellite_dish_060", group="misc")
def satellite_dish_060(P, L):
    sat_dish(P, L, 0.30)


@prop("satellite_dish_090", group="misc")
def satellite_dish_090(P, L):
    sat_dish(P, L, 0.45)


def wall_plate(P, key, w, h):
    P.box((0, 0, 0.006), (w, h, 0.012), "galv", skip=("back",))
    textured_rect(P, (0, 0, 0.0125), w, h, "plates", plate_uv(key, w, h))


for i in range(4):
    prop(f"street_plate_{i}", group="plates")((lambda k: (lambda P, L: wall_plate(P, k, 0.72, 0.18)))(f"street_{i}"))
    prop(f"house_number_{i}", group="plates")((lambda k: (lambda P, L: wall_plate(P, k, 0.25, 0.25)))(f"house_{i}"))


@prop("awning_shop_red", group="misc")
def awning_shop_red(P, L, fab="fabric_red"):
    """3 m fixed shop awning, top edge on the wall (z=0) at y=0, projects 1.2 m to +Z.
    Origin = top-centre on the wall: place at ~2.8 m above the sidewalk."""
    W = 3.0
    rows = []
    uvs = []
    prof = [(0.0, 0.0), (0.4, -0.12), (0.8, -0.28), (1.2, -0.5)]
    for z, y in prof:
        rows.append([(-W / 2 + W * k / 6, y, z) for k in range(7)])
    acc = [0.0]
    for i in range(1, len(prof)):
        acc.append(acc[-1] + math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1]))
    for i, row in enumerate(rows):
        uvs.append([(p[0] / 1.6, -acc[i] / 1.6) for p in row])
    P.tri_strip_surface(rows[::-1], fab, uvs=uvs[::-1], smooth=True)
    P.tri_strip_surface([list(reversed(r)) for r in rows[::-1]], fab, uvs=[list(reversed(u)) for u in uvs[::-1]], smooth=True)
    # valance (front flap)
    z, y = 1.2, -0.5
    val = [[(-W / 2 + W * k / 6, y, z) for k in range(7)], [(-W / 2 + W * k / 6, y - 0.22, z + 0.005) for k in range(7)]]
    vuv = [[(p[0] / 1.6, -acc[-1] / 1.6) for p in val[0]], [(p[0] / 1.6, -(acc[-1] + 0.22) / 1.6) for p in val[1]]]
    P.tri_strip_surface(val[::-1], fab, uvs=vuv[::-1], smooth=False)
    P.tri_strip_surface([list(reversed(r)) for r in val[::-1]], fab, uvs=[list(reversed(u)) for u in vuv[::-1]], smooth=False)
    m = "paint_grey_dark"
    P.box((0, 0.0, 0.02), (W + 0.06, 0.06, 0.04), m)
    P.cyl((-W / 2, y, z), (W / 2, y, z), 0.015, m, seg=6)
    for sx in (-1, 1):
        x = sx * (W / 2 - 0.02)
        P.tube([(x, -0.6, 0.0), (x, y, z)], 0.014, m, seg=6)
        P.box((x, -0.6, 0.01), (0.06, 0.1, 0.02), m)


@prop("awning_shop_green", group="misc")
def awning_shop_green(P, L):
    awning_shop_red(P, L, fab="fabric_green")


@prop("canopy_porch_metal", group="misc")
def canopy_porch_metal(P, L):
    """Metal entrance canopy 2.2 x 1.3 m, corrugated sheet roof. Origin on the wall at the
    canopy back edge (place at ~2.6 m above the step), projects to +Z."""
    m = "paint_grey_dark"
    T = tr((0, 0, 0), rot=(10, 0, 0))
    P.box((0, 0.0, 0.65), (2.2, 0.012, 1.3), "roof_painted_green", T=T, swap=False)
    for x in (-1.08, 0, 1.08):
        P.box((x, -0.03, 0.65), (0.04, 0.05, 1.3), m, T=T)
    P.box((0, -0.03, 1.29), (2.2, 0.06, 0.04), m, T=T)
    P.box((0, -0.03, 0.02), (2.2, 0.06, 0.04), m, T=T)
    for x in (-1.0, 1.0):
        P.beam((x, -0.75, 0.01), (x, -0.2, 1.05), 0.04, 0.04, m, up=(1, 0, 0))
        P.box((x, -0.75, 0.01), (0.1, 0.12, 0.02), m)


# ================================================================== PLAYGROUND (courtyard)
@prop("playground_swing", group="playground")
def playground_swing(P, L):
    fr, seat = "paint_blue", "paint_red"
    for sx in (-1.15, 1.15):
        for sz in (-0.75, 0.75):
            P.tube([(sx * 1.05, 0, sz), (sx, 2.3, 0)], 0.035, fr, seg=8)
        P.tube([(sx * 1.03, 0.9, -0.42), (sx * 1.03, 0.9, 0.42)], 0.025, fr, seg=6)
    P.cyl((-1.25, 2.3, 0), (1.25, 2.3, 0), 0.045, fr, seg=10)
    for x in (-0.5, 0.5):
        for dx in (-0.2, 0.2):
            P.cyl((x + dx, 2.26, 0), (x + dx, 0.45, 0), 0.006, "steel", seg=4, caps=(False, False))
        P.box((x, 0.44, 0), (0.48, 0.035, 0.2), seat, bevel=0.008)


@prop("playground_slide", group="playground")
def playground_slide(P, L):
    """Steel slide: platform 1.2 m, ladder at -Z, chute runs to +Z (total length ~3.3 m)."""
    fr = "paint_red"
    h = 1.2
    for x in (-0.3, 0.3):
        for z in (-0.3, 0.3):
            P.cyl((x, 0, z - 0.6), (x, h + 0.7 if z > 0 else h + 0.7, z - 0.6), 0.03, fr, seg=8)
    P.box((0, h, -0.6), (0.66, 0.04, 0.66), "wood_painted_brown", bevel=0.005)
    for x in (-0.3, 0.3):  # rails
        P.tube([(x, h + 0.7, -0.9), (x, h + 0.7, -0.3)], 0.025, fr, seg=6)
        P.tube([(x, h + 0.35, -0.9), (x, h + 0.35, -0.3)], 0.02, fr, seg=6)
    # ladder
    for x in (-0.25, 0.25):
        P.cyl((x, 0, -1.55), (x, h, -0.92), 0.025, fr, seg=6)
    for k in range(1, 6):
        t = k / 6
        P.box((0, h * t, -1.55 + 0.63 * t), (0.5, 0.025, 0.1), "paint_yellow")
    # chute
    p0, p1 = Vector((0, h, -0.27)), Vector((0, 0.32, 1.9))
    pr = [(0.0, 0.0), (0.3, 0.0), (0.36, 0.0)]
    rows, k = [], 8
    for i in range(k + 1):
        t = i / k
        c = p0.lerp(p1, t)
        c.y += 0.18 * math.sin(t * math.pi) * -0.5
        rows.append(c)
    rows.append(Vector((0, 0.3, 2.4)))
    def secs(off):
        out = []
        for c in rows:
            out.append([(c.x - 0.28, c.y + 0.16 + off, c.z), (c.x - 0.25, c.y + off, c.z), (c.x + 0.25, c.y + off, c.z), (c.x + 0.28, c.y + 0.16 + off, c.z)])
        return out
    top = secs(0.0)
    P.tri_strip_surface([list(reversed(r)) for r in top], "steel", smooth=True)
    P.tri_strip_surface(secs(-0.012), "paint_yellow", smooth=True)
    P.cyl((-0.2, 0, 1.95), (-0.2, 0.3, 1.95), 0.03, fr, seg=6)
    P.cyl((0.2, 0, 1.95), (0.2, 0.3, 1.95), 0.03, fr, seg=6)


@prop("playground_sandbox_mushroom", group="playground")
def playground_sandbox_mushroom(P, L):
    """Classic courtyard sandbox 2 x 2 m with a 'mushroom' sun roof (грибок)."""
    for sx in (-1, 1):
        P.box((sx * 0.98, 0.15, 0), (0.05, 0.3, 2.0), "wood_painted_green", uoff=sx)
        P.box((0, 0.15, sx * 0.98), (1.91, 0.3, 0.05), "wood_painted_green", uoff=sx * 2)
        P.box((sx * 0.98, 0.31, 0), (0.18, 0.03, 2.08), "wood_painted_brown", swap=True)
        P.box((0, 0.31, sx * 0.98), (1.78, 0.03, 0.18), "wood_painted_brown")
    P.box((0, 0.18, 0), (1.91, 0.01, 1.91), "sand", skip=("bottom",))
    P.lathe([(0.4, 0.19), (0.25, 0.2), (0.0, 0.19)], "sand", seg=10, T=tr((0.4, 0, 0.3)))
    P.cyl((-0.9, 0, -0.9), (-0.9, 2.1, -0.9), 0.05, "paint_red", seg=10)
    roof = [(0.0, 2.08), (1.0, 2.0), (1.0, 2.05), (0.8, 2.2), (0.35, 2.48), (0.0, 2.6)]
    T = tr((-0.9, 0, -0.9))
    P.lathe(roof, "paint_red", seg=16, T=T, smooth=[False, False, True, True, True])
    P.lathe([(0.0, 2.59), (0.04, 2.59), (0.0, 2.7)], "paint_white", seg=8, T=T)


@prop("playground_hbar", group="playground")
def playground_hbar(P, L):
    """Double horizontal bar (турник), bars at 1.6 m and 2.3 m."""
    m = "paint_grey_dark"
    for x in (-1.1, 0.0, 1.1):
        P.cyl((x, 0, 0), (x, 2.4 if x != 1.1 else 1.7, 0), 0.045, m, seg=10)
        P.lathe([(0.045, 2.4 if x != 1.1 else 1.7), (0.0, 2.45 if x != 1.1 else 1.75)], m, seg=10, T=tr((x, 0, 0)))
    P.cyl((-1.1, 2.3, 0), (0.0, 2.3, 0), 0.016, "steel", seg=8)
    P.cyl((0.0, 1.6, 0), (1.1, 1.6, 0), 0.016, "steel", seg=8)


@prop("carpet_beating_bar", group="courtyard")
def carpet_beating_bar(P, L):
    """Courtyard carpet bar (выбивалка): П-frame 2.6 x 1.9 m with a middle rail."""
    m = "paint_green"
    P.tube(round_path([(-1.3, 0, 0), (-1.3, 1.9, 0), (1.3, 1.9, 0), (1.3, 0, 0)], 0.06, 3), 0.03, m, seg=8)
    P.cyl((-1.3, 1.1, 0), (1.3, 1.1, 0), 0.022, m, seg=8, caps=(False, False))
    for x in (-1.3, 1.3):
        P.box((x, 0.03, 0), (0.25, 0.06, 0.25), "concrete")


@prop("clothes_drying_poles", group="courtyard")
def clothes_drying_poles(P, L):
    """Two T-poles 4 m apart with 4 clothes lines (x=-2..2)."""
    m = "paint_grey"
    for x in (-2.0, 2.0):
        P.cyl((x, 0, 0), (x, 2.2, 0), 0.03, m, seg=8)
        P.cyl((x, 2.15, -0.65), (x, 2.15, 0.65), 0.022, m, seg=6)
        P.box((x, 0.03, 0), (0.25, 0.06, 0.25), "concrete")
    for z in (-0.55, -0.18, 0.18, 0.55):
        pts = [(-2.0 + 4.0 * k / 6, 2.15 - 0.08 * math.sin(math.pi * k / 6), z) for k in range(7)]
        P.tube(pts, 0.004, "rope", seg=3, caps=False)


@prop("courtyard_table_benches", group="courtyard")
def courtyard_table_benches(P, L):
    """Courtyard table (for nard/chess/tea) 1.4 x 0.8 with two attached benches."""
    m = "paint_green_dark"
    for sx in (-0.55, 0.55):
        P.tube([(sx, 0, 0), (sx, 0.72, 0)], 0.03, m, seg=8)
        P.tube([(sx, 0.3, -0.75), (sx, 0.3, 0.75)], 0.025, m, seg=8)
        for sz in (-0.65, 0.65):
            P.tube([(sx, 0, sz), (sx, 0.42, sz)], 0.025, m, seg=8)
        P.box((sx, 0.7, 0), (0.05, 0.04, 0.7), m)
    for i in range(5):
        P.box((0, 0.75, -0.32 + i * 0.16), (1.4, 0.035, 0.14), "wood_painted_brown", bevel=0.005, uoff=i * 0.3)
    for sz in (-0.65, 0.65):
        for k in (-0.08, 0.08):
            P.box((0, 0.445, sz + k), (1.4, 0.035, 0.13), "wood_painted_brown", bevel=0.005, uoff=k * 5)


@prop("tapchan", group="courtyard")
def tapchan(P, L):
    """Tapchan (топчан / сўри): raised wooden courtyard platform 2.0 x 1.8 m, h 0.5, railing on 3 sides, low table."""
    w = "wood_painted_brown"
    for sx in (-0.95, 0.95):
        for sz in (-0.85, 0.85):
            P.box((sx, 0.25, sz), (0.08, 0.5, 0.08), w)
    P.box((0, 0.52, 0), (2.0, 0.05, 1.8), "wood", bevel=0.01)
    P.box((0, 0.42, 0.88), (2.0, 0.12, 0.04), w)
    P.box((0, 0.42, -0.88), (2.0, 0.12, 0.04), w)
    rail = [(-0.97, 0.55, 0.87), (-0.97, 0.55, -0.87), (0.97, 0.55, -0.87), (0.97, 0.55, 0.87)]
    for a, b in zip(rail[:-1], rail[1:]):
        P.beam((a[0], 0.95, a[2]), (b[0], 0.95, b[2]), 0.05, 0.05, w)
        n = int((Vector(b) - Vector(a)).length / 0.18)
        for k in range(n + 1):
            p = Vector(a).lerp(Vector(b), k / n)
            P.box((p.x, 0.75, p.z), (0.025, 0.4, 0.025), w)
    # kurpacha mats (folded quilts) and low table (dastarkhan)
    P.box((0, 0.57, -0.6), (1.8, 0.05, 0.5), "fabric_red", bevel=0.015)
    P.box((0, 0.57, 0.1), (0.5, 0.05, 1.3), "fabric_red", bevel=0.015, swap=True)
    P.box((0.15, 0.72, 0.15), (0.9, 0.035, 0.6), "wood", bevel=0.008)
    for sx in (-0.35, 0.65):
        for sz in (-0.08, 0.38):
            P.box((sx, 0.635, sz), (0.04, 0.12, 0.04), "wood")


# ================================================================== GAS PIPES & UTILITIES
GAS_R = 0.0285
GAS_Z = 0.11


def gas_bracket(P, x=None, y=None):
    if x is not None:  # bracket for horizontal pipe at height 0
        P.box((x, -0.05, 0.03), (0.03, 0.03, 0.06), "paint_yellow")
        P.box((x, -0.035, GAS_Z / 2 + 0.01), (0.03, 0.01, GAS_Z), "paint_yellow")
        P.tube([(x, -math.cos(math.radians(a)) * 0.035, GAS_Z + math.sin(math.radians(a)) * 0.035) for a in range(-90, 91, 30)],
               0.004, "paint_yellow", seg=4)
    else:  # vertical pipe at x=0
        P.box((-0.05, y, 0.03), (0.03, 0.03, 0.06), "paint_yellow")
        P.box((-0.035, y, GAS_Z / 2 + 0.01), (0.01, 0.03, GAS_Z), "paint_yellow")


@prop("gas_pipe_straight_3m", group="gas")
def gas_pipe_straight_3m(P, L):
    """Yellow facade gas pipe, 3 m run along X (x=-1.5..1.5), axis at y=0, z=0.11 from wall plane z=0."""
    P.cyl((-1.5, 0, GAS_Z), (1.5, 0, GAS_Z), GAS_R, "paint_yellow", seg=8, caps=(False, False))
    for x in (-1.0, 1.0):
        gas_bracket(P, x=x)
    P.cyl((-0.02, 0, GAS_Z), (0.02, 0, GAS_Z), GAS_R + 0.006, "paint_yellow", seg=8)  # weld collar


@prop("gas_pipe_elbow", group="gas")
def gas_pipe_elbow(P, L):
    """Elbow: horizontal run from x=-0.5 turning down to y=-0.5 at x=0 (connects straight + riser)."""
    pts = round_path([(-0.5, 0, GAS_Z), (0, 0, GAS_Z), (0, -0.5, GAS_Z)], 0.12, 5)
    P.tube(pts, GAS_R, "paint_yellow", seg=8, caps=False)
    gas_bracket(P, x=-0.35)


@prop("gas_pipe_riser_3m", group="gas")
def gas_pipe_riser_3m(P, L):
    """Vertical facade gas riser, y=0..3 at x=0, z=0.11, with a shut-off valve at 1.6 m and a label band."""
    P.cyl((0, 0, GAS_Z), (0, 3.0, GAS_Z), GAS_R, "paint_yellow", seg=8, caps=(False, False))
    for y in (0.5, 2.5):
        gas_bracket(P, y=y)
    P.cyl((0, 1.55, GAS_Z), (0, 1.67, GAS_Z), 0.045, "paint_yellow", seg=8)
    P.cyl((0, 1.61, GAS_Z), (0, 1.61, GAS_Z + 0.09), 0.01, "steel", seg=6)
    P.box((0, 1.61, GAS_Z + 0.1), (0.14, 0.02, 0.025), "paint_red")
    textured_rect(P, (0, 2.0, GAS_Z + GAS_R + 0.002), 0.08, 0.04, "plates", plate_uv("gas", 0.08, 0.04))


@prop("gas_pipe_ground_entry", group="gas")
def gas_pipe_ground_entry(P, L):
    """Gas pipe coming out of the ground 0.4 m from the wall, rising to a wall run at 2.2 m (+X)."""
    pts = round_path([(0, -0.1, 0.4), (0, 0.6, 0.4), (0, 0.8, GAS_Z), (0, 2.2, GAS_Z), (0.6, 2.2, GAS_Z)], 0.12, 4)
    P.tube(pts, GAS_R, "paint_yellow", seg=8, caps=False)
    P.cyl((0, 0.25, 0.4), (0, 0.33, 0.4), 0.045, "paint_yellow", seg=8)
    P.box((0, 0.29, 0.48), (0.025, 0.02, 0.14), "paint_red")
    P.lathe([(0.0, 0.0), (0.07, 0.0), (0.07, 0.03), (0.0, 0.03)], "concrete", seg=10, T=tr((0, 0, 0.4)))
    gas_bracket(P, y=1.6)


@prop("electrical_cabinet", group="misc")
def electrical_cabinet(P, L):
    """Street electrical / telecom cabinet 0.8 x 1.3 x 0.35 on a concrete plinth. Doors face +Z."""
    P.box((0, 0.12, 0), (0.9, 0.24, 0.45), "concrete", bevel=0.01)
    P.box((0, 0.24 + 0.65, 0), (0.8, 1.3, 0.35), "paint_grey", bevel=0.008)
    P.box((0, 1.56, -0.01), (0.86, 0.04, 0.42), "paint_grey", bevel=0.005)
    P.box((0, 0.89, 0.176), (0.006, 1.22, 0.004), "plastic_black")
    for sx in (-0.07, 0.07):
        P.box((sx, 0.95, 0.19), (0.02, 0.12, 0.02), "steel")
    textured_rect(P, (0.2, 1.3, 0.1765), 0.15, 0.15, "plates", plate_uv("electro", 0.15, 0.15))
    for y in (0.4, 1.4):
        P.box((0, y, -0.176), (0.5, 0.06, 0.004), "plastic_black")


# ================================================================== BUILD
def main():
    args = dict(a.split("=", 1) for a in sys.argv[sys.argv.index("--") + 1:]) if "--" in sys.argv else {}
    only = set(args["only"].split(",")) if "only" in args else None
    os.makedirs(OUT, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    report_path = os.path.join(HERE, "build_report.json")
    report = json.load(open(report_path)) if (only and os.path.exists(report_path)) else {}
    col_x = 0.0
    for pid, fn, lod, group in REG:
        if only and pid not in only:
            continue
        for L in ((0, 1) if lod else (0,)):
            name = pid if L == 0 else f"{pid}_lod1"
            P = Prop(name)
            fn(P, L)
            tris, mn, mx = P.stats()
            ob, emp = P.to_object()
            # delete loose verts
            path = os.path.join(OUT, name + ".glb")
            export_glb(ob, emp, path)
            for e in emp:  # free the marker names for the next prop (avoid Blender .001 suffixes)
                e.name = f"{name}:{e.name}"
            report[name] = {"group": group, "tris": tris, "min": list(mn), "max": list(mx),
                            "materials": P.mats, "markers": {n: list(p) for n, p in P.markers}, "lod_of": pid if L else None}
            ob.location.x = col_x
            print(f"{name:34s} tris={tris:5d} size=({mx.x - mn.x:.2f},{mx.y - mn.y:.2f},{mx.z - mn.z:.2f}) mats={P.mats}")
        col_x += 6.0
    json.dump(report, open(report_path, "w"), indent=1)
    if args.get("noblend") != "1" and not only:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "dushanbe_city_src", "blend", "props_library.blend"))


main()
