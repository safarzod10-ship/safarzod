"""Parametric building generator for Dushanbe-style city blocks.

Each building is real geometry: walls with window openings (reveals), frames + mullions,
sills, glass with interior atlas, balconies (open/sheet/glazed — glazing balconies by the
residents is ubiquitous in Dushanbe), entrances (porch, steps, canopy, metal door, lamp,
number plate), converted ground-floor shops with external porches and Tajik signboards,
plinths with basement vents, panel seams, cornices, flat roofs with parapets / machine
rooms / vents, or added gable metal roofs (typical retrofit on Soviet 5-storey blocks),
drainpipes, yellow gas pipes along facades, window grilles on ground floors.

Two builders are filled: `base` (always visible) and `detail` (frames, sills, pipes,
railings — hidden beyond a distance on Android). Attachments (AC units, satellite dishes)
are emitted as instances for MultiMesh placement in Godot.
"""
import math
from meshkit import wall_with_holes
from atlases import window_uv, sign_uv

SIDES = {  # name: (offset_x_factor_L, offset_z_factor_D, yaw, width_is_L)
    "front": (0.0, 0.5, 0.0, True),
    "right": (0.5, 0.0, math.pi / 2, False),
    "back": (0.0, -0.5, math.pi, True),
    "left": (-0.5, 0.0, -math.pi / 2, False),
}

PASTEL = [(0.96, 0.90, 0.78), (0.97, 0.91, 0.70), (0.96, 0.84, 0.72), (0.94, 0.82, 0.78),
          (0.84, 0.90, 0.80), (0.80, 0.88, 0.93), (0.95, 0.95, 0.92), (0.90, 0.83, 0.70),
          (0.93, 0.88, 0.82), (0.88, 0.86, 0.80)]
ROOF_TINTS = [(0.30, 0.48, 0.32), (0.58, 0.20, 0.17), (0.25, 0.38, 0.55), (0.85, 0.85, 0.85), (0.85, 0.85, 0.85)]
DOOR_TINTS = [(0.30, 0.20, 0.14), (0.20, 0.30, 0.22), (0.35, 0.35, 0.36), (0.45, 0.25, 0.15), (0.18, 0.22, 0.32)]
FRAME_PVC = (0.96, 0.96, 0.95)
GAS_YELLOW = (0.93, 0.74, 0.10)


class Ctx:
    def __init__(self, base, detail, rng):
        self.base, self.detail, self.rng = base, detail, rng
        self.attach = []      # (kind, (x,y,z), yaw)
        self.colliders = []   # ("box", center(x,y,z), size(x,y,z), yaw)
        self.lights = []      # (kind, (x,y,z))
        self.doors = []       # (building_id, (x,y,z), yaw)
        self.stats = {}

    def tf(self, ox, oy, oz, yaw):
        self.base.set_transform(ox, oy, oz, yaw)
        self.detail.set_transform(ox, oy, oz, yaw)
        self._tf = (ox, oy, oz, yaw)

    def world(self, p):
        return self.base._xf(p)

    def yaw(self):
        return self._tf[3]


def _rot(x, z, yaw):
    c, s = math.cos(yaw), math.sin(yaw)
    return x * c + z * s, -x * s + z * c


def side_tf(ctx, B, side):
    fx, fz, syaw, isL = SIDES[side]
    lx, lz = fx * B["L"], fz * B["D"]
    dx, dz = _rot(lx, lz, B["yaw"])
    ctx.tf(B["x"] + dx, B["y"], B["z"] + dz, B["yaw"] + syaw)
    return B["L"] if isL else B["D"]


# ------------------------------------------------------------------------------------------------
# window / door / balcony units (side-local coords: wall plane z=0, outward +z, u along wall)
# ------------------------------------------------------------------------------------------------
def reveal(ctx, mat, u0, u1, y0, y1, d, tint, ao=0.72, bottom=True):
    b = ctx.base
    b.quad(mat, (u0, y0, 0), (u0, y0, -d), (u0, y1, -d), (u0, y1, 0), ao=ao, tint=tint)
    b.quad(mat, (u1, y0, -d), (u1, y0, 0), (u1, y1, 0), (u1, y1, -d), ao=ao, tint=tint)
    b.quad(mat, (u0, y1, -d), (u1, y1, -d), (u1, y1, 0), (u0, y1, 0), ao=ao * 0.8, tint=tint)
    if bottom:
        b.quad(mat, (u0, y0, 0), (u1, y0, 0), (u1, y0, -d), (u0, y0, -d), ao=ao, tint=tint)


def glass(ctx, u0, u1, y0, y1, z, cell, mat="glass", tint=None):
    a0, b0, a1, b1 = window_uv(cell)
    t = tint or (1, 1, 1)
    ctx.base.quad(mat, (u0, y0, z), (u1, y0, z), (u1, y1, z), (u0, y1, z),
                  uv=[(a0, b1), (a1, b1), (a1, b0), (a0, b0)], tint=t)


def frame_bars(ctx, mat, u0, u1, y0, y1, z, tint, mullions=(), transoms=(), ft=0.065, fd=0.07):
    d = ctx.detail
    fz = "zXxYyZ"
    d.box(mat, u0, y0, z, u0 + ft, y1, z + fd, tint=tint, faces="ZX")
    d.box(mat, u1 - ft, y0, z, u1, y1, z + fd, tint=tint, faces="Zx")
    d.box(mat, u0 + ft, y1 - ft, z, u1 - ft, y1, z + fd, tint=tint, faces="Zy")
    d.box(mat, u0 + ft, y0, z, u1 - ft, y0 + ft, z + fd, tint=tint, faces="ZY")
    for m in mullions:
        d.box(mat, m - 0.03, y0 + ft, z, m + 0.03, y1 - ft, z + fd, tint=tint, faces="ZxX")
    for t in transoms:
        d.box(mat, u0 + ft, t - 0.03, z, u1 - ft, t + 0.03, z + fd, tint=tint, faces="ZyY")


def window(ctx, B, u0, u1, y0, y1, style=None, depth=0.2, wall_mat=None, wall_tint=None, sill=True,
           grille=False, ac=False):
    rng = ctx.rng
    style = style or B.get("win", "pvc")
    if style == "mix":
        style = rng.choice(["pvc", "pvc", "pvc", "wood", "alu"])
    wall_mat = wall_mat or B["wall"]
    wall_tint = wall_tint or B["tint"]
    reveal(ctx, wall_mat, u0, u1, y0, y1, depth, wall_tint)
    gz = -depth + 0.02
    glass(ctx, u0, u1, y0, y1, gz, rng.randrange(16), tint=(rng.uniform(0.85, 1.05),) * 3)
    w = u1 - u0
    if style == "pvc":
        mat, tint = "frame_pvc", FRAME_PVC
    elif style == "wood":
        mat, tint = "frame_paint", rng.choice([(0.92, 0.92, 0.9), (0.55, 0.36, 0.22), (0.80, 0.80, 0.78)])
    else:
        mat, tint = "frame_alu", rng.choice([(0.25, 0.25, 0.27), (0.55, 0.55, 0.57), (0.40, 0.30, 0.22)])
    mull = []
    if w > 1.0:
        mull = [u0 + w * (0.5 if w < 1.7 else 0.36)]
        if w > 2.2:
            mull.append(u0 + w * 0.68)
    trans = [y1 - 0.45] if (style == "wood" and y1 - y0 > 1.3) else []
    frame_bars(ctx, mat, u0, u1, y0, y1, gz, tint, mull, trans)
    if sill:
        ctx.detail.box("metal_galv", u0 - 0.05, y0 - 0.035, 0.0, u1 + 0.05, y0 + 0.005, 0.07,
                       tint=(0.75, 0.76, 0.78), faces="YZxX")
    if grille:
        g = (0.22, 0.22, 0.22)
        n = max(2, int(w / 0.18))
        for i in range(1, n):
            u = u0 + w * i / n
            ctx.detail.box("metal_paint", u - 0.008, y0, 0.06, u + 0.008, y1, 0.076, tint=g, faces="ZxX")
        for yy in (y0 + 0.1, (y0 + y1) / 2, y1 - 0.1):
            ctx.detail.box("metal_paint", u0, yy - 0.01, 0.06, u1, yy + 0.01, 0.08, tint=g, faces="ZyY")
        for uu in (u0 - 0.02, u1 - 0.0):
            ctx.detail.box("metal_paint", uu, y0, 0.0, uu + 0.02, y1, 0.08, tint=g, faces="ZxX")
    if ac:
        p = ctx.world(((u0 + u1) / 2 + rng.uniform(-0.3, 0.3), y0 - 0.55, 0.22))
        ctx.attach.append(("aircon", p, ctx.yaw()))


def door(ctx, B, u0, u1, y0, y1, tint=None, glazed=False, depth=0.22):
    rng = ctx.rng
    reveal(ctx, B["wall"], u0, u1, y0, y1, depth, B["tint"], bottom=False)
    z = -depth + 0.03
    t = tint or rng.choice(DOOR_TINTS)
    if glazed:
        glass(ctx, u0, u1, y0, y1, z - 0.01, 5 + 8 * rng.randrange(2), tint=(0.9, 0.9, 0.9))
        frame_bars(ctx, "frame_alu", u0, u1, y0, y1, z, (0.3, 0.3, 0.32), [(u0 + u1) / 2], [y1 - 0.5], ft=0.08)
    else:
        ctx.base.quad("metal_paint", (u0, y0, z), (u1, y0, z), (u1, y1, z), (u0, y1, z), tint=t)
        # panel relief + handle
        ctx.detail.box("metal_paint", u0 + 0.12, y0 + 0.2, z, u1 - 0.12, y0 + 0.95, z + 0.015, tint=[c * 0.9 for c in t], faces="ZxXyY")
        ctx.detail.box("metal_paint", u0 + 0.12, y0 + 1.1, z, u1 - 0.12, y1 - 0.15, z + 0.015, tint=[c * 0.9 for c in t], faces="ZxXyY")
        hx = u1 - 0.12
        ctx.detail.box("metal_galv", hx - 0.02, y0 + 0.95, z, hx, y0 + 1.1, z + 0.06, tint=(0.8, 0.8, 0.8))
        ctx.detail.box("metal_galv", hx - 0.15, y0 + 1.0, z + 0.05, hx, y0 + 1.03, z + 0.07, tint=(0.8, 0.8, 0.8))
    frame_bars(ctx, "frame_alu", u0, u1, y0, y1 + 0.0, z - 0.005, (0.28, 0.28, 0.3), ft=0.05, fd=0.05)


def sign_board(ctx, key, u0, u1, y0, y1, z=0.0, depth=0.12, mat="sign"):
    a0, b0, a1, b1 = sign_uv(key)
    b = ctx.base
    b.quad(mat, (u0, y0, z + depth), (u1, y0, z + depth), (u1, y1, z + depth), (u0, y1, z + depth),
           uv=[(a0, b1), (a1, b1), (a1, b0), (a0, b0)])
    ctx.detail.box("metal_paint", u0, y0, z, u1, y1, z + depth, tint=(0.2, 0.2, 0.22), faces="YyxX")


def balcony(ctx, B, u0, u1, yf, depth, style, top, fh):
    """Projecting balcony on floor level yf (slab top), outward +z."""
    rng = ctx.rng
    b, d = ctx.base, ctx.detail
    t_conc = (0.82, 0.81, 0.78)
    b.box("concrete", u0 - 0.08, yf - 0.16, 0.0, u1 + 0.08, yf, depth, tint=t_conc, faces="YyZxX")
    if style == "rail":
        rt = rng.choice([(0.25, 0.25, 0.25), (0.35, 0.22, 0.15), (0.2, 0.35, 0.3)])
        hh = yf + 1.0
        d.box("metal_paint", u0 - 0.05, hh - 0.03, depth - 0.05, u1 + 0.05, hh + 0.02, depth, tint=rt)
        d.box("metal_paint", u0 - 0.05, hh - 0.03, 0, u0, hh + 0.02, depth, tint=rt, faces="xXY")
        d.box("metal_paint", u1, hh - 0.03, 0, u1 + 0.05, hh + 0.02, depth, tint=rt, faces="xXY")
        n = int((u1 - u0) / 0.22)
        for i in range(n + 1):
            u = u0 + (u1 - u0) * i / n
            d.box("metal_paint", u - 0.01, yf, depth - 0.04, u + 0.01, hh, depth - 0.02, tint=rt, faces="ZzxX")
        for k in range(1, 4):
            z = depth * k / 4
            d.box("metal_paint", u0 - 0.04, yf, z - 0.01, u0 - 0.02, hh, z + 0.01, tint=rt, faces="xXZz")
            d.box("metal_paint", u1 + 0.02, yf, z - 0.01, u1 + 0.04, hh, z + 0.01, tint=rt, faces="xXZz")
        if rng.random() < 0.12:   # carpet / blanket airing over the rail (very common sight)
            ct = rng.choice([(0.55, 0.12, 0.12), (0.45, 0.15, 0.25), (0.25, 0.20, 0.45)])
            cu = u0 + rng.uniform(0.1, 0.4)
            b.quad("fabric", (cu, hh - 1.0, depth + 0.02), (cu + 1.1, hh - 1.0, depth + 0.02),
                   (cu + 1.1, hh + 0.03, depth + 0.02), (cu, hh + 0.03, depth + 0.02), tint=ct)
        if rng.random() < 0.15:
            ctx.attach.append(("sat_dish", ctx.world(((u0 + u1) / 2 + 0.6, hh + 0.05, depth)), ctx.yaw()))
        return
    # sheet parapet (profiled sheet / asbestos panel) — with or without glazing
    pt = rng.choice([(0.85, 0.85, 0.82), (0.72, 0.74, 0.76), (0.62, 0.70, 0.75), (0.80, 0.70, 0.55), B["tint"]])
    pm = "metal_paint" if rng.random() < 0.6 else "concrete"
    ph = yf + 1.0
    b.box(pm, u0 - 0.08, yf, depth - 0.04, u1 + 0.08, ph, depth, tint=pt, faces="ZzYxX")
    b.box(pm, u0 - 0.08, yf, 0, u0 - 0.04, ph, depth - 0.04, tint=pt, faces="xXY")
    b.box(pm, u1 + 0.04, yf, 0, u1 + 0.08, ph, depth - 0.04, tint=pt, faces="xXY")
    if style == "sheet":
        if rng.random() < 0.15:
            ctx.attach.append(("sat_dish", ctx.world((u1 - 0.3, ph + 0.05, depth - 0.1)), ctx.yaw()))
        return
    # glazing above parapet
    gy1 = yf + fh - 0.18 if not top else yf + 2.4
    fm, ftint = ("frame_pvc", FRAME_PVC) if rng.random() < 0.7 else ("frame_alu", (0.6, 0.6, 0.62))
    cell = rng.randrange(16)
    zf = depth - 0.03
    glass(ctx, u0 - 0.06, u1 + 0.06, ph, gy1, zf, cell)
    n = max(2, int((u1 - u0) / 0.75))
    frame_bars(ctx, fm, u0 - 0.06, u1 + 0.06, ph, gy1, zf - 0.02, ftint,
               [u0 + (u1 - u0) * i / n for i in range(1, n)])
    # side glazing
    for (ua, sgn) in ((u0 - 0.06, -1), (u1 + 0.06, 1)):
        a0, b0_, a1, b1 = window_uv(cell)
        if sgn < 0:
            b.quad("glass", (ua, ph, 0), (ua, ph, zf), (ua, gy1, zf), (ua, gy1, 0), uv=[(a0, b1), (a1, b1), (a1, b0_), (a0, b0_)])
        else:
            b.quad("glass", (ua, ph, zf), (ua, ph, 0), (ua, gy1, 0), (ua, gy1, zf), uv=[(a0, b1), (a1, b1), (a1, b0_), (a0, b0_)])
        d.box(fm, ua - 0.03, ph, 0, ua + 0.03, gy1, 0.06, tint=ftint, faces="xXZ")
    if top:   # sheet-metal canopy over the top-floor glazed balcony
        b.quad("metal_galv", (u0 - 0.15, gy1, 0), (u1 + 0.15, gy1, 0), (u1 + 0.15, gy1 - 0.12, depth + 0.12),
               (u0 - 0.15, gy1 - 0.12, depth + 0.12), tint=(0.78, 0.78, 0.78))
        b.quad("metal_galv", (u0 - 0.15, gy1 - 0.12, depth + 0.12), (u1 + 0.15, gy1 - 0.12, depth + 0.12),
               (u1 + 0.15, gy1, 0), (u0 - 0.15, gy1, 0), tint=(0.5, 0.5, 0.5))


def drainpipe(ctx, u, y_top, out=0.12):
    d = ctx.detail
    t = (0.70, 0.71, 0.72)
    d.htube("metal_galv", (u, 0.35, out), (u, y_top - 0.25, out), 0.055, 6, tint=t)
    d.htube("metal_galv", (u, y_top - 0.25, out), (u, y_top - 0.05, 0.0), 0.055, 6, tint=t)
    d.htube("metal_galv", (u, 0.35, out), (u, 0.12, out + 0.25), 0.055, 6, tint=t)
    d.box("metal_galv", u - 0.15, y_top - 0.1, -0.02, u + 0.15, y_top + 0.12, 0.25, tint=t)  # funnel


def gas_pipe(ctx, u0, u1, y, risers=(), y_top=None):
    d = ctx.detail
    d.htube("metal_paint", (u0, y, 0.12), (u1, y, 0.12), 0.035, 6, tint=GAS_YELLOW)
    for u in (u0, u1):
        d.htube("metal_paint", (u, y, 0.12), (u, y, -0.02), 0.035, 6, tint=GAS_YELLOW)
    for i in range(int((u1 - u0) / 3.0) + 1):     # brackets
        uu = u0 + i * 3.0
        d.box("metal_paint", uu - 0.02, y - 0.12, 0.0, uu + 0.02, y - 0.04, 0.14, tint=(0.3, 0.3, 0.3))
    for u in risers:
        d.htube("metal_paint", (u, y, 0.12), (u, y_top, 0.12), 0.025, 6, tint=GAS_YELLOW)


# ------------------------------------------------------------------------------------------------
# building assembly
# ------------------------------------------------------------------------------------------------
def make(kind, rng, **kw):
    """Fill in defaults per building kind. Returns spec dict B."""
    B = dict(kind=kind, x=0.0, z=0.0, y=0.15, yaw=0.0, L=60.0, D=12.0, floors=5, fh=2.8,
             plinth=0.9, bay=3.2, wall="wall_panel", tint=rng.choice(PASTEL), win="mix",
             roof="flat", roof_tint=rng.choice(ROOF_TINTS), entr_side="back", n_entr=0,
             balc_sides=("back",), balc_every=3, balc_offset=1, balc_depth=1.1, shops=[],
             ground_grille=0.5, ac=0.3, seams=False, ww=1.45, wh=1.45, sill_h=0.85,
             end_windows=False, gas=True, sign=None, sign_side="front", ground_fh=None,
             stair_windows=True, cornice=0.12, parapet=0.45, lobby_glazed=False, id="b")
    if kind == "panel5":
        B.update(floors=5, fh=2.8, plinth=0.9, bay=3.2, wall="wall_panel", seams=True, ww=1.45,
                 roof=rng.choice(["flat", "gable", "gable"]), balc_sides=("back", "front"), balc_every=3)
    elif kind == "brick5":
        B.update(floors=5, fh=2.9, plinth=0.8, bay=3.0, wall=rng.choice(["wall_brick_buff", "wall_brick_buff", "wall_brick_red"]),
                 tint=(1, 1, 1), ww=1.35, wh=1.5, roof=rng.choice(["flat", "gable"]), balc_every=2, balc_offset=0)
    elif kind == "panel9":
        B.update(floors=9, fh=2.8, plinth=1.0, bay=3.3, wall="wall_plaster", ww=1.5, balc_sides=("back", "front"),
                 balc_every=2, balc_offset=1, gas=False, ground_grille=0.3,
                 accent=rng.choice([None, None, (0.86, 0.80, 0.70), (0.80, 0.84, 0.86)]))
    elif kind == "tower":
        B.update(floors=rng.choice([12, 14, 16]), fh=3.0, plinth=0.3, bay=3.6, wall="wall_plaster",
                 tint=rng.choice([(0.95, 0.90, 0.80), (0.93, 0.87, 0.76), (0.96, 0.94, 0.90)]), win="alu", ww=1.8,
                 wh=1.75, sill_h=0.7, balc_sides=("front", "back"), balc_every=2, balc_offset=0, gas=False, ac=0.25,
                 ground_fh=4.5, ground_grille=0.0, cornice=0.35, parapet=0.9, lobby_glazed=True,
                 base_floors=2, base_wall="wall_travertine", belt_every=4,
                 accent=rng.choice([(0.78, 0.58, 0.42), (0.70, 0.52, 0.40), (0.62, 0.60, 0.58), (0.84, 0.70, 0.52)]))
    elif kind == "office":
        B.update(floors=5, fh=3.4, plinth=0.45, bay=3.6, wall="wall_travertine", tint=(1, 1, 1), win="alu",
                 ww=2.6, wh=1.9, sill_h=0.8, balc_sides=(), gas=False, ac=0.15, ground_grille=0.0, cornice=0.3,
                 parapet=0.8, lobby_glazed=True)
    elif kind == "admin":
        B.update(floors=4, fh=3.6, plinth=1.1, bay=3.6, wall="wall_travertine", tint=(1, 1, 1), win="alu",
                 ww=1.8, wh=2.2, sill_h=0.85, balc_sides=(), gas=False, ac=0.12, ground_grille=0.0, cornice=0.45,
                 parapet=1.0, end_windows=True)
    elif kind == "hotel":
        B.update(floors=7, fh=3.1, plinth=0.5, bay=3.4, wall="wall_plaster", tint=(0.96, 0.91, 0.80), win="alu",
                 ww=1.6, wh=1.9, sill_h=0.7, balc_sides=("front",), balc_every=1, balc_depth=0.7, gas=False, ac=0.2,
                 ground_fh=4.2, ground_grille=0.0, cornice=0.4, parapet=0.8, end_windows=True, lobby_glazed=True,
                 base_floors=1, belt_every=3)
    elif kind == "school":
        B.update(floors=3, fh=3.6, plinth=0.7, bay=3.6, wall="wall_plaster", tint=rng.choice([(0.97, 0.90, 0.68), (0.96, 0.93, 0.85)]),
                 win="pvc", ww=2.6, wh=2.0, sill_h=0.85, balc_sides=(), gas=False, ac=0.05, ground_grille=0.2,
                 cornice=0.3, end_windows=True, stair_windows=False)
    elif kind == "hospital":
        B.update(floors=5, fh=3.3, plinth=0.8, bay=3.3, wall="wall_plaster", tint=(0.95, 0.96, 0.96), win="pvc",
                 ww=1.6, wh=1.6, sill_h=0.9, balc_sides=(), gas=False, ac=0.35, ground_grille=0.2, cornice=0.25,
                 end_windows=True)
    elif kind == "shop":
        B.update(floors=1, fh=4.0, plinth=0.3, bay=3.6, wall=rng.choice(["wall_plaster", "wall_travertine"]), win="alu",
                 balc_sides=(), gas=False, ac=0.0, ground_grille=0.0, cornice=0.25, parapet=0.6, stair_windows=False)
    elif kind == "house":
        B.update(floors=rng.choice([1, 1, 2]), fh=3.0, plinth=0.5, bay=3.4, wall="wall_plaster",
                 tint=rng.choice(PASTEL + [(0.97, 0.97, 0.95)] * 2), win=rng.choice(["pvc", "wood"]), ww=1.5,
                 wh=1.6, roof=rng.choice(["gable", "hip"]), balc_sides=(), gas=True, ac=0.35, ground_grille=0.7,
                 stair_windows=False, cornice=0.08, end_windows=True)
    elif kind == "garage":
        B.update(floors=1, fh=4.4, plinth=0.15, bay=4.5, wall="wall_plaster_rough", tint=(0.86, 0.84, 0.8),
                 balc_sides=(), gas=False, ac=0.0, ground_grille=0.0, stair_windows=False, roof="flat")
    B.update(kw)
    if B["ground_fh"] is None:
        B["ground_fh"] = B["fh"]
    B["H"] = B["plinth"] + B["ground_fh"] + (B["floors"] - 1) * B["fh"]
    return B


def floor_y(B, f):
    if f == 0:
        return B["plinth"]
    return B["plinth"] + B["ground_fh"] + (f - 1) * B["fh"]


def build(ctx, B):
    rng = ctx.rng
    kind = B["kind"]
    H = B["H"]
    for side in ("front", "right", "back", "left"):
        W = side_tf(ctx, B, side)
        facade(ctx, B, side, W)
    # roof + collider in building frame
    ctx.tf(B["x"], B["y"], B["z"], B["yaw"])
    roof(ctx, B)
    if kind == "house":
        aivan(ctx, B)
    ctx.colliders.append(("box", ctx.world((0, H / 2, 0)), (B["L"], H, B["D"]), B["yaw"]))


def facade(ctx, B, side, W):
    rng = ctx.rng
    b, d = ctx.base, ctx.detail
    kind = B["kind"]
    H, ph, fh = B["H"], B["plinth"], B["fh"]
    long_side = side in ("front", "back")
    holes = []
    units = []          # callables to build after the wall
    nb = max(1, int(W / B["bay"]))
    bw = W / nb
    u_start = -W / 2
    entr_cols = set()
    if long_side and side == B["entr_side"] and B["n_entr"] > 0:
        sec = nb / B["n_entr"]
        entr_cols = {int(sec * (i + 0.5)) for i in range(B["n_entr"])}
    shop_spans = [s for s in B["shops"] if s[0] == side]
    blank = (not long_side) and not B["end_windows"]
    balc_side = side in B["balc_sides"]
    ac_count = 0

    def in_shop(u):
        return any(s[1] <= u <= s[2] for s in shop_spans)

    for c in range(nb):
        u0, u1 = u_start + c * bw, u_start + (c + 1) * bw
        uc = (u0 + u1) / 2
        if blank:
            continue
        if c in entr_cols:
            # entrance door at ground + staggered stair windows
            dy0 = 0.45 if ph >= 0.6 else 0.0
            dh = 2.25 if kind not in ("tower", "hotel", "office") else 2.6
            dw = 0.7 if not B["lobby_glazed"] else 1.1
            holes.append((uc - dw, uc + dw, dy0, dy0 + dh))
            units.append(lambda uc=uc, dy0=dy0, dh=dh, dw=dw: entrance(ctx, B, uc, dy0, dh, dw))
            if B["stair_windows"]:
                for f in range(1, B["floors"]):
                    y0 = floor_y(B, f) - fh * 0.5 + 0.5
                    holes.append((uc - 0.6, uc + 0.6, y0, y0 + 1.15))
                    units.append(lambda uc=uc, y0=y0: window(ctx, B, uc - 0.6, uc + 0.6, y0, y0 + 1.15, depth=0.18))
            continue
        for f in range(B["floors"]):
            yf = floor_y(B, f)
            fhf = B["ground_fh"] if f == 0 else fh
            if f == 0 and in_shop(uc):
                continue
            ww = min(B["ww"], bw - 0.7)
            balc = (balc_side and f > 0 and (c % B["balc_every"]) == B["balc_offset"] % B["balc_every"]
                    and not (kind == "tower" and f < 2))
            if f == 0 and B["lobby_glazed"] and long_side and side == "front" and kind in ("tower", "hotel", "office"):
                # tall ground-floor glazing (commercial / lobby)
                y0, y1 = yf + 0.15, yf + fhf - 0.5
                holes.append((u0 + 0.25, u1 - 0.25, y0, y1))
                units.append(lambda u0=u0, u1=u1, y0=y0, y1=y1: window(ctx, B, u0 + 0.25, u1 - 0.25, y0, y1, style="alu", depth=0.25, sill=False))
                continue
            if balc:
                dwid = min(0.8, bw * 0.28)
                bwid = min(ww + dwid + 0.1, bw - 0.4)
                a0 = uc - bwid / 2
                y0, y1 = yf + 0.02, yf + min(2.25, fhf - 0.5)
                holes.append((a0, a0 + bwid, y0, y1))
                top = f == B["floors"] - 1
                style = rng.choices(["glazed", "sheet", "rail"], [0.55, 0.25, 0.2] if kind != "tower" else [0.3, 0.0, 0.7])[0]
                if kind == "tower":
                    style = "rail" if style == "rail" else "glazed"
                units.append(lambda a0=a0, bwid=bwid, y0=y0, y1=y1, dwid=dwid, yf=yf, top=top, style=style, fhf=fhf:
                             balcony_opening(ctx, B, a0, bwid, dwid, y0, y1, yf, top, style, fhf))
                continue
            y0 = yf + B["sill_h"]
            y1 = min(y0 + B["wh"], yf + fhf - 0.25)
            holes.append((uc - ww / 2, uc + ww / 2, y0, y1))
            grille = f == 0 and rng.random() < B["ground_grille"]
            ac = rng.random() < B["ac"] and f > 0 or (f == 0 and rng.random() < B["ac"] * 0.4)
            units.append(lambda uc=uc, ww=ww, y0=y0, y1=y1, grille=grille, ac=ac:
                         window(ctx, B, uc - ww / 2, uc + ww / 2, y0, y1, grille=grille, ac=ac))
    # shops (converted ground floor / commercial)
    for (_, a, bnd, key) in shop_spans:
        y0 = 0.45 if ph >= 0.6 else 0.05
        y1 = B["plinth"] + B["ground_fh"] - 0.45
        holes.append((a, bnd, y0, y1))
        units.append(lambda a=a, bnd=bnd, y0=y0, y1=y1, key=key: shopfront(ctx, B, a, bnd, y0, y1, key))
    if not long_side and B["end_windows"] is False and kind in ("panel5", "panel9", "brick5"):
        # small windows on end walls (kitchens/bathrooms) for some buildings
        if rng.random() < 0.4:
            for f in range(B["floors"]):
                yf = floor_y(B, f)
                for uc in (-W / 4, W / 4):
                    y0 = yf + 1.0
                    holes.append((uc - 0.45, uc + 0.45, y0, y0 + 1.2))
                    units.append(lambda uc=uc, y0=y0: window(ctx, B, uc - 0.45, uc + 0.45, y0, y0 + 1.2))
    # walls: plinth band + main band (incl. parapet for flat roofs)
    top = H + (B["parapet"] if B["roof"] == "flat" else 0.0)
    pm = "plinth" if kind not in ("house", "shop", "garage") else "plinth"
    wall_with_holes(b, pm, -W / 2 - 0.03, W / 2 + 0.03, 0.0, ph, 0.03, holes, tint=(0.80, 0.79, 0.76))
    b.quad(pm, (-W / 2 - 0.03, ph, 0.03), (W / 2 + 0.03, ph, 0.03), (W / 2 + 0.03, ph, 0.0), (-W / 2 - 0.03, ph, 0.0), tint=(0.8, 0.79, 0.76))
    y_base = floor_y(B, B.get("base_floors", 0)) if B.get("base_floors", 0) > 0 else ph
    if y_base > ph:
        wall_with_holes(b, B.get("base_wall", "wall_travertine"), -W / 2, W / 2, ph, y_base, 0.0, holes, tint=(1, 1, 1))
        b.box("concrete", -W / 2 - 0.12, y_base - 0.05, 0.0, W / 2 + 0.12, y_base + 0.25, 0.14, tint=(0.9, 0.88, 0.84), faces="ZYy")
    acc = B.get("accent")
    if acc and long_side and nb >= 6:
        cw_ = bw
        wall_with_holes(b, B["wall"], -W / 2, -W / 2 + cw_, y_base, top, 0.0, holes, tint=acc)
        wall_with_holes(b, B["wall"], W / 2 - cw_, W / 2, y_base, top, 0.0, holes, tint=acc)
        wall_with_holes(b, B["wall"], -W / 2 + cw_, W / 2 - cw_, y_base, top, 0.0, holes, tint=B["tint"])
    elif acc and not long_side:
        wall_with_holes(b, B["wall"], -W / 2, W / 2, y_base, top, 0.0, holes, tint=acc)
    else:
        wall_with_holes(b, B["wall"], -W / 2, W / 2, y_base, top, 0.0, holes, tint=B["tint"])
    if B.get("belt_every"):
        for f in range(B["belt_every"], B["floors"], B["belt_every"]):
            y = floor_y(B, f)
            b.box("concrete", -W / 2 - 0.08, y - 0.1, 0.0, W / 2 + 0.08, y + 0.12, 0.1, tint=(0.88, 0.86, 0.82), faces="ZYy")
    for fn in units:
        fn()
    # panel seams (large-panel buildings)
    if B["seams"]:
        st = [c * 0.82 for c in B["tint"]]
        for f in range(1, B["floors"]):
            y = floor_y(B, f)
            d.quad("seam", (-W / 2, y - 0.015, 0.004), (W / 2, y - 0.015, 0.004), (W / 2, y + 0.015, 0.004), (-W / 2, y + 0.015, 0.004), tint=st)
        if long_side:
            for c in range(1, nb):
                u = u_start + c * bw
                if any(h[0] < u < h[1] for h in holes):
                    continue
                d.quad("seam", (u - 0.012, ph, 0.004), (u + 0.012, ph, 0.004), (u + 0.012, H, 0.004), (u - 0.012, H, 0.004), tint=st)
    # cornice band
    if B["cornice"] > 0:
        cy = H - 0.05
        cd = B["cornice"]
        b.box("concrete", -W / 2 - cd, cy, 0.0, W / 2 + cd, cy + 0.22, cd, tint=[min(1, c * 1.02) for c in B["tint"]], faces="ZYy")
    # basement vents in plinth
    if ph >= 0.6 and long_side:
        for c in range(nb):
            u = u_start + (c + 0.5) * bw
            if any(h[0] - 0.3 < u < h[1] + 0.3 for h in holes if h[2] < ph):
                continue
            if c % 2 == 0:
                d.quad("metal_paint", (u - 0.25, 0.25, 0.035), (u + 0.25, 0.25, 0.035), (u + 0.25, 0.5, 0.035), (u - 0.25, 0.5, 0.035), tint=(0.12, 0.12, 0.12))
    # drainpipes (corners of long sides + every ~24 m), gas pipe on entrance side
    if long_side and kind not in ("garage",):
        pts = [-W / 2 + 0.3, W / 2 - 0.3]
        n = int(W / 24)
        pts += [-W / 2 + W * (i + 0.5) / (n + 1) for i in range(n)] if n else []
        for u in pts:
            if not any(h[0] - 0.2 < u < h[1] + 0.2 for h in holes):
                drainpipe(ctx, u, top)
        if B["gas"] and side == B["entr_side"] and kind in ("panel5", "brick5", "house"):
            risers = [u_start + (c + 0.5) * bw + bw * 0.5 for c in sorted(entr_cols)]
            gas_pipe(ctx, -W / 2 + 0.2, W / 2 - 0.2, ph + 2.15, risers, H - 0.4)


def balcony_opening(ctx, B, a0, bwid, dwid, y0, y1, yf, top, style, fhf):
    rng = ctx.rng
    reveal(ctx, B["wall"], a0, a0 + bwid, y0, y1, 0.2, B["tint"])
    gz = -0.18
    glass(ctx, a0, a0 + bwid, y0, y1, gz, rng.randrange(16))
    fm = "frame_pvc" if rng.random() < 0.75 else "frame_paint"
    ft = FRAME_PVC if fm == "frame_pvc" else (0.85, 0.85, 0.82)
    frame_bars(ctx, fm, a0, a0 + bwid, y0, y1, gz, ft, [a0 + dwid], [])
    # lower panel under the window part of a balcony door unit
    ctx.base.quad(fm, (a0 + dwid, y0, gz + 0.03), (a0 + bwid, y0, gz + 0.03), (a0 + bwid, yf + 0.85, gz + 0.03), (a0 + dwid, yf + 0.85, gz + 0.03), tint=ft)
    pad = 0.35 if style != "rail" else 0.3
    balcony(ctx, B, a0 - pad, a0 + bwid + pad, yf, B["balc_depth"], style, top, fhf)
    if rng.random() < B["ac"] * 0.6:
        ctx.attach.append(("aircon", ctx.world((a0 + bwid + 0.7, yf + 1.6, 0.22)), ctx.yaw()))


def entrance(ctx, B, uc, dy0, dh, dw):
    rng = ctx.rng
    b, d = ctx.base, ctx.detail
    glazed = B["lobby_glazed"]
    door(ctx, B, uc - dw, uc + dw, dy0, dy0 + dh, glazed=glazed)
    pw = dw + 0.9
    pd = 1.6
    t_c = (0.78, 0.77, 0.74)
    if dy0 > 0.1:
        b.box("tiles" if glazed else "concrete", uc - pw, 0, 0, uc + pw, dy0, pd, tint=t_c, faces="YZxX")
        n = max(2, int(round(dy0 / 0.15)))
        for i in range(n):
            h = dy0 * (n - 1 - i) / n
            if h <= 0.01:
                break
            b.box("concrete", uc - pw + 0.3, 0, pd + i * 0.3, uc + pw - 0.3, h, pd + (i + 1) * 0.3, tint=t_c, faces="YZxX")
        ctx.colliders.append(("box", ctx.world((uc, dy0 / 2, pd / 2)), (pw * 2, dy0, pd), ctx.yaw()))
        # handrails
        for s in (-1, 1):
            x = uc + s * (pw - 0.15)
            d.htube("metal_paint", (x, dy0 + 0.9, 0.2), (x, dy0 + 0.9, pd), 0.022, 5, tint=(0.25, 0.25, 0.25))
            d.htube("metal_paint", (x, dy0 + 0.9, pd), (x, 0.9, pd + n * 0.3), 0.022, 5, tint=(0.25, 0.25, 0.25))
            for z in (0.2, pd, pd + n * 0.3):
                yb = dy0 if z <= pd else 0.0
                d.htube("metal_paint", (x, yb, z), (x, (dy0 if z <= pd else 0) + 0.9 if z <= pd else 0.9, z), 0.018, 5, tint=(0.25, 0.25, 0.25))
    # canopy
    cy = dy0 + dh + 0.25
    b.box("concrete", uc - pw - 0.1, cy, 0, uc + pw + 0.1, cy + 0.14, pd + 0.2, tint=t_c, faces="YyZxX")
    if not glazed:
        b.box("metal_galv", uc - pw - 0.1, cy + 0.14, 0, uc + pw + 0.1, cy + 0.17, pd + 0.2, tint=(0.6, 0.6, 0.6), faces="Y")
    # lamp + intercom + number plate
    d.box("lamp_emissive", uc - 0.12, cy - 0.12, 0.02, uc + 0.12, cy - 0.02, 0.2)
    ctx.lights.append(("entrance", ctx.world((uc, cy - 0.15, 0.3))))
    d.box("metal_paint", uc + dw + 0.15, dy0 + 1.25, 0.0, uc + dw + 0.32, dy0 + 1.55, 0.05, tint=(0.2, 0.2, 0.2))
    if not glazed:
        key = "num%d" % (1 + (int(abs(uc) * 7) % 4))
        sign_board(ctx, key, uc - 0.3, uc + 0.3, dy0 + dh + 0.42 + 0.14, dy0 + dh + 0.42 + 0.14 + 0.075, depth=0.02) if False else None
    ctx.doors.append((B["id"], ctx.world((uc, dy0, 0.5)), ctx.yaw()))
    # entrance bench (attachment) on courtyard side
    if not glazed and rng.random() < 0.7:
        ctx.attach.append(("bench_entrance", ctx.world((uc + pw + 1.4, 0.0, 1.3)), ctx.yaw()))


def shopfront(ctx, B, a, bnd, y0, y1, key):
    rng = ctx.rng
    b, d = ctx.base, ctx.detail
    reveal(ctx, B["wall"], a, bnd, y0, y1, 0.25, B["tint"], bottom=True)
    z = -0.22
    w = bnd - a
    if key == "otashnishon":
        # fire station: red sectional garage doors (horizontal panels with small windows), no glazing
        b.box("metal_paint", a, y0, z - 0.05, bnd, y1, z, tint=(0.70, 0.08, 0.07), faces="Z")
        ns = max(4, int((y1 - y0) / 0.55))
        for i in range(1, ns):
            yy = y0 + (y1 - y0) * i / ns
            d.box("metal_paint", a + 0.05, yy - 0.025, z, bnd - 0.05, yy + 0.025, z + 0.03, tint=(0.55, 0.06, 0.05), faces="YyZ")
        for k in range(int(w / 1.2)):
            u = a + 0.4 + k * 1.2
            if u + 0.6 < bnd - 0.2:
                glass(ctx, u, u + 0.6, y0 + (y1 - y0) * 0.62, y0 + (y1 - y0) * 0.72, z + 0.01, 5, tint=(0.9, 0.9, 0.9))
        sy0 = y1 + 0.15
        sign_board(ctx, key, a + 0.1, bnd - 0.1, sy0, sy0 + min(0.9, (bnd - a) / 7.5), depth=0.14)
        ctx.lights.append(("sign", ctx.world(((a + bnd) / 2, sy0 + 0.4, 0.8))))
        b.box("asphalt_yard", a - 0.3, 0.0, 0.0, bnd + 0.3, 0.02, 1.0, faces="Y")    # apron
        return
    glass(ctx, a, bnd, y0, y1, z, rng.choice([5, 13, 5, 13, 3]), tint=(1.0, 1.0, 1.0))
    n = max(2, int(w / 1.6))
    mull = [a + w * i / n for i in range(1, n)]
    doorc = mull[len(mull) // 2] if mull else (a + bnd) / 2
    frame_bars(ctx, "frame_alu", a, bnd, y0, y1, z, (0.25, 0.25, 0.27), mull, [y0 + 2.3] if y1 - y0 > 2.8 else [], ft=0.07)
    # door leaf inside (darker glass) + handle bar
    d.box("metal_galv", doorc + 0.08, y0 + 0.9, z, doorc + 0.11, y0 + 1.5, z + 0.12, tint=(0.8, 0.8, 0.8))
    # porch with steps out to the sidewalk (converted flats have raised floors)
    if y0 > 0.2:
        pd = 1.5
        b.box("tiles", a - 0.2, 0, 0, bnd + 0.2, y0, pd, tint=(0.75, 0.72, 0.68), faces="YZxX")
        n = max(2, int(round(y0 / 0.15)))
        for i in range(n - 1):
            h = y0 * (n - 1 - i) / n
            b.box("tiles", doorc - 1.0, 0, pd + i * 0.3, doorc + 1.0, h, pd + (i + 1) * 0.3, tint=(0.75, 0.72, 0.68), faces="YZxX")
        ctx.colliders.append(("box", ctx.world(((a + bnd) / 2, y0 / 2, pd / 2)), (w + 0.4, y0, pd), ctx.yaw()))
        for s in (a - 0.1, bnd + 0.1):
            d.htube("metal_galv", (s, y0 + 0.9, 0.1), (s, y0 + 0.9, pd), 0.025, 6, tint=(0.8, 0.8, 0.8))
            d.htube("metal_galv", (s, y0, pd - 0.05), (s, y0 + 0.9, pd - 0.05), 0.02, 6, tint=(0.8, 0.8, 0.8))
    # signboard over the opening (Tajik text), sometimes a second vertical sign / awning
    sy0 = y1 + 0.15
    sign_board(ctx, key, a + 0.1, bnd - 0.1, sy0, sy0 + min(0.9, (bnd - a) / 7.5), depth=0.14)
    ctx.lights.append(("sign", ctx.world(((a + bnd) / 2, sy0 + 0.4, 0.8))))
    if rng.random() < 0.35:
        at = rng.choice([(0.7, 0.12, 0.1), (0.1, 0.4, 0.2), (0.15, 0.25, 0.55), (0.8, 0.55, 0.1)])
        b.quad("fabric", (a, y1 + 0.05, 0.05), (bnd, y1 + 0.05, 0.05), (bnd, y1 - 0.35, 1.3), (a, y1 - 0.35, 1.3), tint=at)
        b.quad("fabric", (a, y1 - 0.35, 1.3), (bnd, y1 - 0.35, 1.3), (bnd, y1 + 0.05, 0.05), (a, y1 + 0.05, 0.05), tint=[c * 0.7 for c in at])
    ctx.doors.append((B["id"] + ":" + key, ctx.world((doorc, 0.0, 2.0)), ctx.yaw()))


def roof(ctx, B):
    rng = ctx.rng
    b, d = ctx.base, ctx.detail
    L, D, H = B["L"], B["D"], B["H"]
    if B["roof"] == "flat":
        p = B["parapet"]
        t = (0.42, 0.41, 0.40)
        b.quad("roof_flat", (-L / 2, H + 0.05, D / 2), (L / 2, H + 0.05, D / 2), (L / 2, H + 0.05, -D / 2), (-L / 2, H + 0.05, -D / 2), tint=t)
        # parapet inner faces + coping
        th = 0.25
        tc = [min(1, c * 0.95) for c in B["tint"]]
        b.box(B["wall"], -L / 2, H, D / 2 - th, L / 2, H + p, D / 2, tint=tc, faces="z")
        b.box(B["wall"], -L / 2, H, -D / 2, L / 2, H + p, -D / 2 + th, tint=tc, faces="Z")
        b.box(B["wall"], -L / 2, H, -D / 2, -L / 2 + th, H + p, D / 2, tint=tc, faces="X")
        b.box(B["wall"], L / 2 - th, H, -D / 2, L / 2, H + p, D / 2, tint=tc, faces="x")
        ct = (0.75, 0.75, 0.74)
        b.box("metal_galv", -L / 2 - 0.05, H + p, D / 2 - th, L / 2 + 0.05, H + p + 0.05, D / 2 + 0.05, tint=ct, faces="YZz")
        b.box("metal_galv", -L / 2 - 0.05, H + p, -D / 2 - 0.05, L / 2 + 0.05, H + p + 0.05, -D / 2 + th, tint=ct, faces="YZz")
        b.box("metal_galv", -L / 2 - 0.05, H + p, -D / 2, -L / 2 + th, H + p + 0.05, D / 2, tint=ct, faces="YxX")
        b.box("metal_galv", L / 2 - th, H + p, -D / 2, L / 2 + 0.05, H + p + 0.05, D / 2, tint=ct, faces="YxX")
        # machine rooms / roof exits, vents, antennas
        n = max(1, B["n_entr"] or int(L / 25))
        for i in range(n):
            x = -L / 2 + L * (i + 0.5) / n
            if B["floors"] >= 9:
                b.box(B["wall"], x - 2.2, H, -2.0, x + 2.2, H + 3.0, 2.0, tint=B["tint"], faces="YxXzZ")
                b.box("metal_galv", x - 2.3, H + 3.0, -2.1, x + 2.3, H + 3.1, 2.1, tint=(0.6, 0.6, 0.6), faces="YxXzZ")
            else:
                b.box(B["wall"], x - 1.0, H, -0.8, x + 1.0, H + 1.6, 0.8, tint=B["tint"], faces="YxXzZ")
            for k in range(2):
                vx = x + rng.uniform(-L / (2 * n) + 1, L / (2 * n) - 1)
                vz = rng.uniform(-D / 2 + 1, D / 2 - 1)
                d.cylinder("metal_galv", vx, vz, H, H + 0.9, 0.12, 6, tint=(0.6, 0.6, 0.6))
            if rng.random() < 0.6:
                ax, az = x + rng.uniform(-3, 3), rng.uniform(-D / 3, D / 3)
                d.htube("metal_galv", (ax, H, az), (ax, H + 2.2, az), 0.02, 4)
                d.htube("metal_galv", (ax - 0.6, H + 2.0, az), (ax + 0.6, H + 2.0, az), 0.012, 4)
        if B["kind"] in ("tower", "hotel", "office", "admin") or rng.random() < 0.3:
            for k in range(int(L / 8)):
                ctx.attach.append(("aircon_roof", ctx.world((rng.uniform(-L / 2 + 1.5, L / 2 - 1.5), H + 0.05, rng.uniform(-D / 2 + 1.5, D / 2 - 1.5))), B["yaw"] + rng.choice([0, math.pi])))
        if B["sign"]:
            key = B["sign"]
            sw = min(L * 0.8, 22.0)
            sh = sw / 8.0
            # roof-top sign on frame, facing front
            ctx.tf(*_front_point(B, 0.0), B["yaw"])
            sign_board(ctx, key, -sw / 2, sw / 2, H + p + 0.3, H + p + 0.3 + sh, z=-0.6, depth=0.2)
            ctx.tf(B["x"], B["y"], B["z"], B["yaw"])
    else:
        # pitched sheet-metal roof (gable along L, or hip)
        o = 0.45
        rh = min(D * 0.28, 3.2)
        t = B["roof_tint"]
        mat = "roof_metal"
        y0 = H + 0.1
        x0, x1, z0, z1 = -L / 2 - o, L / 2 + o, -D / 2 - o, D / 2 + o
        ys = y0 - o * rh / (D / 2)
        if B["roof"] == "gable":
            b.quad(mat, (x0, ys, z1), (x1, ys, z1), (x1, y0 + rh, 0), (x0, y0 + rh, 0), tint=t)
            b.quad(mat, (x1, ys, z0), (x0, ys, z0), (x0, y0 + rh, 0), (x1, y0 + rh, 0), tint=t)
            b.quad(mat, (x0, y0 + rh, 0), (x1, y0 + rh, 0), (x1, ys, z1), (x0, ys, z1), tint=[c * 0.4 for c in t])  # underside
            b.quad(mat, (x1, y0 + rh, 0), (x0, y0 + rh, 0), (x0, ys, z0), (x1, ys, z0), tint=[c * 0.4 for c in t])
            for xx, sgn in ((-L / 2, -1), (L / 2, 1)):   # gable walls
                if sgn > 0:
                    b.tri(B["wall"], (xx, H, D / 2), (xx, H, -D / 2), (xx, y0 + rh, 0), tint=B["tint"])
                else:
                    b.tri(B["wall"], (xx, H, -D / 2), (xx, H, D / 2), (xx, y0 + rh, 0), tint=B["tint"])
                # attic vent
                d.box("metal_paint", xx - 0.03 if sgn < 0 else xx, y0 + rh * 0.35, -0.4, xx if sgn < 0 else xx + 0.03, y0 + rh * 0.35 + 0.5, 0.4,
                      tint=(0.25, 0.25, 0.25), faces="x" if sgn < 0 else "X")
            ridge = (0.5, 0.5, 0.5)
            d.htube("metal_galv", (x0, y0 + rh + 0.03, 0), (x1, y0 + rh + 0.03, 0), 0.07, 4, tint=ridge)
            b.quad("metal_galv", (x0, ys, z1), (x1, ys, z1), (x1, ys - 0.15, z1), (x0, ys - 0.15, z1), tint=(0.55, 0.55, 0.55))
            b.quad("metal_galv", (x1, ys, z0), (x0, ys, z0), (x0, ys - 0.15, z0), (x1, ys - 0.15, z0), tint=(0.55, 0.55, 0.55))
        else:   # hip roof
            r = min(D / 2 + o, L / 2 + o - 0.5)
            rx0, rx1 = x0 + r, x1 - r
            top = y0 + rh
            b.quad(mat, (x0, ys, z1), (x1, ys, z1), (rx1, top, 0), (rx0, top, 0), tint=t)
            b.quad(mat, (x1, ys, z0), (x0, ys, z0), (rx0, top, 0), (rx1, top, 0), tint=t)
            b.tri(mat, (x1, ys, z1), (x1, ys, z0), (rx1, top, 0), tint=t)
            b.tri(mat, (x0, ys, z0), (x0, ys, z1), (rx0, top, 0), tint=t)
            b.quad("roof_flat", (x0, ys - 0.01, z0), (x1, ys - 0.01, z0), (x1, ys - 0.01, z1), (x0, ys - 0.01, z1), tint=(0.3, 0.3, 0.3))
        # chimney / vent stacks
        for k in range(max(1, int(L / 20))):
            cx = rng.uniform(-L / 2 + 2, L / 2 - 2)
            b.box("wall_brick_red", cx - 0.3, y0 + rh * 0.5, -0.9, cx + 0.3, y0 + rh + 0.9, -0.3, faces="xXzZY")
        ctx.colliders.append(("box", ctx.world((0, y0 + rh / 2, 0)), (L, rh, D), B["yaw"]))


def aivan(ctx, B):
    """Covered veranda (айвон) along the yard façade: raised tiled deck, carved-look wooden
    posts with brackets, beam and a lean-to metal roof — a defining feature of Tajik houses."""
    rng = ctx.rng
    b, d = ctx.base, ctx.detail
    L, D = B["L"], B["D"]
    dep = 2.6
    x0, x1 = -L / 2 + 0.4, L / 2 - 0.4
    z0, z1 = D / 2, D / 2 + dep
    hdeck = 0.45
    b.box("tiles", x0, 0.0, z0, x1, hdeck, z1, tint=(0.82, 0.76, 0.68), faces="YZxX")
    for i in range(2):
        b.box("concrete", (x0 + x1) / 2 - 0.9, 0, z1 + i * 0.3, (x0 + x1) / 2 + 0.9, hdeck * (2 - i) / 3, z1 + (i + 1) * 0.3, tint=(0.8, 0.79, 0.76), faces="YZxX")
    top = B["plinth"] + B["fh"] * min(B["floors"], 1) - 0.1
    wt = rng.choice([(0.55, 0.36, 0.22), (0.45, 0.28, 0.16), (0.85, 0.85, 0.82), (0.25, 0.42, 0.55)])
    n = max(3, int((x1 - x0) / 2.6) + 1)
    for i in range(n):
        x = x0 + 0.15 + (x1 - x0 - 0.3) * i / (n - 1)
        d.box("wood", x - 0.09, hdeck, z1 - 0.3, x + 0.09, top, z1 - 0.12, tint=wt)
        d.box("wood", x - 0.14, hdeck, z1 - 0.35, x + 0.14, hdeck + 0.25, z1 - 0.07, tint=wt)        # base
        d.box("wood", x - 0.18, top - 0.22, z1 - 0.36, x + 0.18, top - 0.05, z1 - 0.06, tint=wt)     # capital
        for s_ in (-1, 1):                                                                              # brackets
            d.quad("wood", (x, top - 0.6, z1 - 0.16), (x + s_ * 0.5, top - 0.05, z1 - 0.16), (x + s_ * 0.5, top - 0.05, z1 - 0.26), (x, top - 0.6, z1 - 0.26), tint=wt)
    d.box("wood", x0 - 0.1, top - 0.05, z1 - 0.38, x1 + 0.1, top + 0.18, z1 - 0.02, tint=wt)
    # railing between posts (low carved balustrade)
    for i in range(n - 1):
        xa = x0 + 0.15 + (x1 - x0 - 0.3) * i / (n - 1) + 0.12
        xb = x0 + 0.15 + (x1 - x0 - 0.3) * (i + 1) / (n - 1) - 0.12
        if abs((xa + xb) / 2 - (x0 + x1) / 2) < 1.2:
            continue
        d.box("wood", xa, hdeck + 0.8, z1 - 0.26, xb, hdeck + 0.86, z1 - 0.16, tint=wt)
        k = int((xb - xa) / 0.18)
        for j in range(k):
            xx = xa + (xb - xa) * (j + 0.5) / k
            d.box("wood", xx - 0.02, hdeck, z1 - 0.23, xx + 0.02, hdeck + 0.8, z1 - 0.19, tint=wt, faces="ZzxX")
    rt = B["roof_tint"]
    b.quad("roof_metal", (x0 - 0.3, top + 0.35, z0), (x1 + 0.3, top + 0.35, z0), (x1 + 0.3, top + 0.1, z1 + 0.4), (x0 - 0.3, top + 0.1, z1 + 0.4), tint=rt)
    b.quad("roof_metal", (x0 - 0.3, top + 0.1, z1 + 0.4), (x1 + 0.3, top + 0.1, z1 + 0.4), (x1 + 0.3, top + 0.35, z0), (x0 - 0.3, top + 0.35, z0), tint=[c * 0.45 for c in rt])
    ctx.colliders.append(("box", ctx.world((0, hdeck / 2, (z0 + z1) / 2)), (x1 - x0, hdeck, dep), B["yaw"]))
    ctx.lights.append(("entrance", ctx.world((0, top - 0.3, z0 + 1.0))))


def _front_point(B, u):
    dx, dz = _rot(u, B["D"] / 2, B["yaw"])
    return B["x"] + dx, B["y"], B["z"] + dz
