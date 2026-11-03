"""DUSHANBE district plan, 600 x 600 m (x: -300..300 east, z: -300..300 south; -Z = north).

The plan follows the structure of central Dushanbe residential districts: an orthogonal grid,
one wide avenue (3+3 lanes, green median, aryk tree strips, 5 m sidewalks), secondary streets
with tree strips, a commercial street with parking bays and shops in converted ground floors,
Soviet microdistrict courtyards (5- and 9-storey blocks around green yards with playgrounds,
garbage-container sites, carpet bars, benches at entrances), new 12-16-storey complexes with
commercial ground floors, a school, a city hospital, a park with alleys and a chaikhana, and
a mahalla of private houses (havli) behind plastered walls along narrow lanes.

No monuments, landmarks or vehicles. Reserved lots are left empty for the author's own models.
"""
import math, random
import buildings as bl
from streets import Road, H

RNG = random.Random(20261101)

# ------------------------------------------------------------------------------------------------
ROADS = [
    Road("av", "хиёбони Ҷавонон", "z", -40.0, -300, 300, median=3.0, carriage=10.5, lanes=3, strip=3.2,
         strip_kind="aryk", sidewalk=5.0, corner_r=8.0),
    Road("com", "кӯчаи Гулистон", "x", 20.0, -300, 300, carriage=3.5, lanes=1, parking=2.5, strip=0.0,
         sidewalk=6.0, corner_r=6.0),
    Road("a", "кӯчаи Бахор", "x", -150.0, -300, 300, carriage=3.75, lanes=1, strip=2.5, strip_kind="lawn",
         sidewalk=3.5, corner_r=6.0),
    Road("c", "кӯчаи Навбаҳор", "x", 175.0, -300, 300, carriage=3.5, lanes=1, strip=2.0, strip_kind="lawn",
         sidewalk=3.0, corner_r=6.0),
    Road("d", "кӯчаи Меҳргон", "z", 150.0, -300, 300, carriage=3.75, lanes=1, strip=2.0, strip_kind="lawn",
         sidewalk=3.5, corner_r=6.0),
    Road("e", "кӯчаи Деҳқонон", "z", -200.0, -300, 300, carriage=3.5, lanes=1, strip=1.5, strip_kind="lawn",
         sidewalk=3.0, corner_r=5.0),
    # mahalla lanes (no markings, narrow sidewalks)
    Road("l1", "тор кӯчаи Боғ", "x", 240.0, -300, -43.0, carriage=3.0, lanes=0, strip=0.0, sidewalk=1.5,
         corner_r=3.0),
    Road("l2", "тор кӯчаи Чашма", "z", -130.0, 175.0, 300, carriage=3.0, lanes=0, strip=0.0, sidewalk=1.5,
         corner_r=3.0),
]
MIDBLOCK = [("av", -75.0), ("com", 60.0), ("av", 105.0)]

# Block rectangles between road rights-of-way
COLS = {0: (-300.0, -208.0), 1: (-192.0, -61.5), 2: (-18.5, 140.75), 3: (159.25, 300.0)}
ROWS = {0: (-300.0, -159.75), 1: (-140.25, 8.0), 2: (32.0, 166.5), 3: (183.5, 300.0)}


class Plan:
    def __init__(self):
        self.buildings = []     # spec dicts (buildings.make)
        self.ground = []        # (rect, mat, border)   later entries have priority
        self.trees = []         # (category, x, z)
        self.props = []         # (category, x, z, yaw)
        self.lines = []         # (category, x0, z0, x1, z1)  fences / hedges / walls
        self.reserved = []      # (name, rect, note)
        self.zones = []         # (name, rect)
        self.parking = []       # (rect, stall_axis) stalls painted
        self.colliders = []     # extra ("box", (x,y,z), (sx,sy,sz), yaw)

    # ---------- helpers -----------------------------------------------------------------------
    def bld(self, kind, x0, z0, x1, z1, facing, **kw):
        """Axis-aligned building occupying rect, front facing N/S/E/W."""
        cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
        wx, wz = x1 - x0, z1 - z0
        yaw = {"S": 0.0, "N": math.pi, "E": math.pi / 2, "W": -math.pi / 2}[facing]
        L, D = (wx, wz) if facing in "NS" else (wz, wx)
        B = bl.make(kind, RNG, x=cx, z=cz, y=H, yaw=yaw, L=L, D=D, id="%s_%d" % (kind, len(self.buildings)), **kw)
        B["rect"] = (x0, z0, x1, z1)
        self.buildings.append(B)
        # blind area (отмостка) around the building
        self.ground.append(((x0 - 0.8, z0 - 0.8, x1 + 0.8, z1 + 0.8), "concrete", False))
        return B

    def pave(self, rect, mat="asphalt_yard", border=False):
        self.ground.append((rect, mat, border))

    def tree(self, cat, x, z, jitter=0.0):
        if jitter:
            x += RNG.uniform(-jitter, jitter)
            z += RNG.uniform(-jitter, jitter)
        self.trees.append((cat, x, z))

    def tree_row(self, cat, x0, z0, x1, z1, step, jitter=0.6, skip=0.08):
        L = math.hypot(x1 - x0, z1 - z0)
        n = max(1, int(L / step))
        for i in range(n + 1):
            if RNG.random() < skip:
                continue      # gaps (dead / removed trees) — rows are never perfect
            t = i / n
            s = step * RNG.uniform(-0.18, 0.18) / max(L, 1)
            self.tree(cat, x0 + (x1 - x0) * (t + s), z0 + (z1 - z0) * (t + s), jitter)

    def scatter(self, cat, rect, n, margin=2.0, avoid=()):
        x0, z0, x1, z1 = rect
        k = 0
        tries = 0
        while k < n and tries < n * 30:
            tries += 1
            x = RNG.uniform(x0 + margin, x1 - margin)
            z = RNG.uniform(z0 + margin, z1 - margin)
            if any(a[0] - 1 <= x <= a[2] + 1 and a[1] - 1 <= z <= a[3] + 1 for a in avoid):
                continue
            if any(math.hypot(x - t[1], z - t[2]) < 5.5 for t in self.trees[-80:] if t[0] not in ("shrub", "rose", "flowers")):
                continue
            self.tree(cat, x, z)
            k += 1

    def prop(self, cat, x, z, yaw=0.0):
        self.props.append((cat, x, z, yaw))

    def line(self, cat, x0, z0, x1, z1):
        self.lines.append((cat, x0, z0, x1, z1))

    def rect_line(self, cat, r, gaps=()):
        """Fence/hedge along rect perimeter; gaps = list of (side, centre, width)."""
        x0, z0, x1, z1 = r
        sides = {"N": (x0, z0, x1, z0), "S": (x0, z1, x1, z1), "W": (x0, z0, x0, z1), "E": (x1, z0, x1, z1)}
        for s, (a, b, c, d) in sides.items():
            segs = [(a, b, c, d)]
            for (gs, gc, gw) in gaps:
                if gs != s:
                    continue
                nxt = []
                for (p, q, r_, t) in segs:
                    if s in "NS":
                        lo, hi = min(p, r_), max(p, r_)
                        if lo < gc - gw / 2 and gc + gw / 2 < hi:
                            nxt += [(lo, q, gc - gw / 2, t), (gc + gw / 2, q, hi, t)]
                        else:
                            nxt.append((p, q, r_, t))
                    else:
                        lo, hi = min(q, t), max(q, t)
                        if lo < gc - gw / 2 and gc + gw / 2 < hi:
                            nxt += [(p, lo, r_, gc - gw / 2), (p, gc + gw / 2, r_, hi)]
                        else:
                            nxt.append((p, q, r_, t))
                segs = nxt
            for sg in segs:
                self.line(cat, *sg)

    def front_garden(self, B, side_len_frac=0.9, depth=3.0):
        """Residents' front garden (палисадник) along the entrance side: low fence, roses,
        shrubs, small trees — extremely typical for Dushanbe courtyards."""
        x0, z0, x1, z1 = B["rect"]
        face = {0.0: "S", math.pi: "N", math.pi / 2: "E", -math.pi / 2: "W"}[B["yaw"]]
        es = B["entr_side"]
        side = face if es == "front" else {"S": "N", "N": "S", "E": "W", "W": "E"}[face]
        pieces = []
        if side in "NS":
            zz0, zz1 = (z1 + 1.0, z1 + 1.0 + depth) if side == "S" else (z0 - 1.0 - depth, z0 - 1.0)
            n = B["n_entr"] or 1
            sec = (x1 - x0) / n
            for i in range(n):
                a, b = x0 + i * sec + 3.0, x0 + (i + 1) * sec - 3.0
                pieces += [(a, zz0, (a + b) / 2 - 2.2, zz1), ((a + b) / 2 + 2.2, zz0, b, zz1)]
        else:
            xx0, xx1 = (x1 + 1.0, x1 + 1.0 + depth) if side == "E" else (x0 - 1.0 - depth, x0 - 1.0)
            n = B["n_entr"] or 1
            sec = (z1 - z0) / n
            for i in range(n):
                a, b = z0 + i * sec + 3.0, z0 + (i + 1) * sec - 3.0
                pieces += [(xx0, a, xx1, (a + b) / 2 - 2.2), (xx0, (a + b) / 2 + 2.2, xx1, b)]
        for r in pieces:
            if r[2] - r[0] < 2 or r[3] - r[1] < 2:
                continue
            self.ground.append((r, "soil_garden", False))
            self.rect_line("fence_low", r)
            cx, cz = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
            for k in range(RNG.randint(2, 5)):
                self.tree(RNG.choice(["rose", "rose", "shrub", "flowers"]), RNG.uniform(r[0] + 0.6, r[2] - 0.6), RNG.uniform(r[1] + 0.6, r[3] - 0.6))
            if RNG.random() < 0.5:
                self.tree(RNG.choice(["mulberry", "fruit", "thuja"]), cx, cz, 0.5)


def courtyard_kit(P, rect, entr=True, play=True, containers=True, sport=False):
    """Typical Soviet courtyard: playground, benches, table, carpet bar, drying poles,
    container site, worn lawns, big old trees, parking along the driveway."""
    x0, z0, x1, z1 = rect
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    if play:
        pr = (cx - 11, cz - 8, cx + 11, cz + 8)
        P.pave(pr, "gravel", True)
        P.prop("swing", cx - 7, cz - 3, 0)
        P.prop("slide", cx + 6, cz - 3, math.pi / 2)
        P.prop("sandbox", cx - 6, cz + 4, 0)
        P.prop("horizontal_bar", cx + 7, cz + 4, 0)
        for k in range(4):
            P.prop("bench_courtyard", cx - 9 + k * 6, cz + 7.2, math.pi)
        P.prop("urn", cx - 10.3, cz + 6.8, 0)
        P.prop("urn", cx + 10.3, cz + 6.8, 0)
    tr = (cx + 13, cz - 3, cx + 17, cz + 3)
    P.prop("table_benches", cx + 15, cz, 0)
    P.prop("carpet_bar", cx - 16, cz + 1, math.pi / 2)
    P.prop("drying_poles", cx - 16, cz - 6, math.pi / 2)
    if containers:
        P.prop("container_site", x1 - 6, z0 + 5, math.pi)
    avoid = [(cx - 12, cz - 9, cx + 12, cz + 9), tr]
    P.scatter("courtyard_tree", rect, max(4, int((x1 - x0) * (z1 - z0) / 260)), margin=4, avoid=avoid)
    P.scatter("shrub", rect, 6, margin=3, avoid=avoid)
    if sport:
        P.pave((cx - 15, z1 - 26, cx + 15, z1 - 6), "sport", True)


# ------------------------------------------------------------------------------------------------
def plan():
    P = Plan()
    # ==== block (0,0) NW: microdistrict of 5-storey panel blocks around a yard ==================
    x0, x1 = COLS[0]; z0, z1 = ROWS[0]
    P.zones.append(("mikrorayon_nw", (x0, z0, x1, z1)))
    b1 = P.bld("panel5", -296, -292, -284, -212, "E", n_entr=4, entr_side="front")
    b2 = P.bld("panel5", -236, -290, -224, -226, "W", n_entr=4, entr_side="front")
    b3 = P.bld("brick5", -278, -184, -230, -172, "N", n_entr=3, entr_side="front",
               shops=[("back", -22, -13, "nonvoikhona"), ("back", 13, 22, "magoza")])
    for B in (b1, b2, b3):
        P.front_garden(B)
    P.pave((-280, -300, -276, -164), "asphalt_yard")           # yard driveway
    P.pave((-276, -210, -244, -202), "asphalt_yard")
    P.parking.append(((-276, -300, -270, -240), "x"))
    courtyard_kit(P, (-270, -268, -244, -196))
    P.pave((-214, -300, -208, -160), "sidewalk")                # path along street
    # ==== block (1,0): 9-storey blocks on the avenue + brick 5-storey, yard ======================
    x0, x1 = COLS[1]; z0, z1 = ROWS[1]
    b = P.bld("panel9", -77, -292, -64, -236, "E", n_entr=4, entr_side="back",
              shops=[("front", -24, -15, "dorukhona"), ("front", 6, 15, "telefon"), ("front", 17, 26, "meva")])
    b = P.bld("panel9", -77, -228, -64, -172, "E", n_entr=4, entr_side="back",
              shops=[("front", -25, -16, "supermarket"), ("front", -12, -3, "libos"), ("front", 14, 24, "khojagi")])
    b = P.bld("brick5", -186, -292, -174, -232, "W", n_entr=3, entr_side="back")
    P.front_garden(b)
    b = P.bld("panel5", -168, -186, -104, -174, "S", n_entr=4, entr_side="back")
    P.front_garden(b)
    P.pave((-100, -300, -94, -164), "asphalt_yard")
    P.pave((-96, -300, -80, -164), "asphalt_yard")
    P.parking.append(((-96, -296, -82, -240), "x"))
    P.parking.append(((-96, -226, -82, -180), "x"))
    courtyard_kit(P, (-166, -286, -104, -196), sport=True)
    # ==== block (2,0): new residential complex + reserved lot 1 ==================================
    x0, x1 = COLS[2]; z0, z1 = ROWS[2]
    P.zones.append(("new_complex_n", (x0, z0, x1, z1)))
    P.bld("tower", 50, -296, 80, -278, "S", n_entr=2, entr_side="back", floors=16)
    P.bld("tower", 100, -296, 130, -278, "S", n_entr=2, entr_side="back", floors=14)
    P.bld("tower", 54, -230, 84, -212, "W", n_entr=2, entr_side="back", floors=12,
          shops=[("front", -14, -3, "qahvakhona"), ("front", 3, 14, "gul")])
    P.bld("tower", 104, -230, 134, -212, "E", n_entr=1, entr_side="back", floors=12)
    P.pave((40, -270, 140, -240), "plaza", True)
    P.pave((90, -240, 100, -165), "asphalt_yard")
    P.parking.append(((40, -205, 90, -170), "z"))
    P.pave((40, -205, 90, -170), "asphalt_yard", True)
    P.reserved.append(("reserved_lot_1", (-16.5, -296, 36, -166), "Участок у проспекта (≈52×130 м) — для собственной модели"))
    P.pave((-16.5, -296, 36, -166), "plaza_reserved")
    for k in range(5):
        P.tree("thuja", 42 + k * 4, -272)
    P.scatter("park_tree", (100, -270, 140, -240), 3)
    # ==== block (3,0): district administration + small hotel ====================================
    x0, x1 = COLS[3]; z0, z1 = ROWS[3]
    adm = P.bld("admin", 175, -280, 191, -226, "W", n_entr=1, entr_side="front", sign="idora_ru")
    P.pave((159.25, -268, 175, -238), "plaza", True)
    P.prop("flagpole", 167, -253, 0)
    P.bld("hotel", 230, -296, 290, -282, "S", n_entr=1, entr_side="front", sign="mehmonkhona",
          shops=[("front", 18, 27, "osh")])
    P.pave((200, -282, 296, -270), "plaza")
    P.pave((205, -262, 296, -205), "asphalt_yard", True)
    # sports complex (tall hall) and the district fire station on the north part of the lot
    P.bld("shop", 208, -262, 250, -232, "S", floors=1, fh=8.0, wall="wall_plaster", tint=(0.86, 0.90, 0.86),
          sign="varzish", shops=[("front", -7, 7, "varzish")])
    P.bld("garage", 258, -262, 292, -238, "S", fh=5.2, tint=(0.92, 0.88, 0.84), sign="otashnishon",
          shops=[("front", -15, -2, "otashnishon"), ("front", 2, 15, "otashnishon")])
    P.parking.append(((205, -226, 296, -205), "x"))
    P.bld("office", 205, -195, 255, -180, "N", n_entr=1, entr_side="front", sign="office",
          shops=[("front", -24, -15, "bank"), ("front", 12, 22, "pochta")])
    P.tree_row("thuja", 162, -278, 162, -228, 4.0, 0.1, 0.0)
    P.scatter("park_tree", (262, -200, 296, -164), 4)
    # ==== block (0,1): brick 5-storeys + shop pavilions on the commercial street =================
    x0, x1 = COLS[0]; z0, z1 = ROWS[1]
    b = P.bld("brick5", -296, -134, -284, -64, "E", n_entr=4, entr_side="front")
    P.front_garden(b)
    b = P.bld("panel5", -250, -134, -238, -70, "W", n_entr=4, entr_side="front")
    P.front_garden(b)
    P.bld("shop", -290, -12, -268, 2, "S", shops=[("front", -9, 9, "sartaroshkhona")])
    P.bld("shop", -262, -14, -238, 2, "S", shops=[("front", -10, 10, "kafe")])
    P.bld("shop", -232, -12, -214, 2, "S", shops=[("front", -7.5, 7.5, "kitob")])
    P.pave((-296, -50, -212, 8), "plaza")
    courtyard_kit(P, (-280, -130, -254, -66), play=True)
    P.pave((-230, -140, -224, -50), "asphalt_yard")
    # ==== block (1,1): PARK (alleys, flower beds, chaikhana, benches) ==========================
    x0, x1 = COLS[1]; z0, z1 = ROWS[1]
    P.zones.append(("park", (x0, z0, x1, z1)))
    park(P, x0, z0, x1, z1)
    # ==== block (2,1): school with sports ground + panel blocks ================================
    x0, x1 = COLS[2]; z0, z1 = ROWS[2]
    P.zones.append(("school", (-10, -136, 92, 0)))
    s1 = P.bld("school", 0, -128, 64, -112, "S", n_entr=1, entr_side="front")
    s2 = P.bld("school", 64, -128, 80, -84, "W", n_entr=1, entr_side="front", floors=3)
    P.pave((0, -110, 60, -94), "plaza", True)                    # school forecourt
    P.prop("school_sign", 30, -105, 0)
    P.pave((2, -78, 62, -38), "sport", True)                     # sports field
    P.prop("goal", 32, -76, 0)
    P.prop("goal", 32, -40, math.pi)
    P.rect_line("fence_school", (-8, -134, 90, -26), gaps=[("S", 30, 6.0), ("W", -110, 4.0)])
    P.tree_row("street_tree", -4, -130, -4, -30, 8.0)
    P.tree_row("poplar", 86, -78, 86, -30, 6.0, 0.3, 0.05)
    P.scatter("park_tree", (2, -92, 60, -82), 4)
    b = P.bld("panel5", 104, -136, 116, -66, "E", n_entr=4, entr_side="back")
    P.front_garden(b)
    P.bld("shop", 96, -14, 136, 2, "S", shops=[("front", -18, -6, "nonvoikhona"), ("front", 6, 18, "dorukhona2")])
    P.pave((92, -60, 140, -18), "asphalt_yard")
    courtyard_kit(P, (96, -60, 136, -20), play=True, containers=True)
    # ==== block (3,1): 9-storey blocks + square on corner ======================================
    x0, x1 = COLS[3]; z0, z1 = ROWS[3]
    b = P.bld("panel9", 166, -136, 230, -123, "S", n_entr=4, entr_side="back")
    b = P.bld("panel9", 240, -136, 296, -123, "S", n_entr=3, entr_side="back",
              shops=[("front", -24, -14, "dorukhona"), ("front", 4, 14, "salon")])
    b = P.bld("panel9", 280, -110, 293, -40, "W", n_entr=4, entr_side="front")
    P.front_garden(b)
    courtyard_kit(P, (176, -108, 270, -50), sport=False)
    P.pave((170, -118, 276, -112), "asphalt_yard")
    P.parking.append(((176, -118, 270, -112), "z"))
    sq = (162, -36, 230, 6)
    P.zones.append(("square_se", sq))
    small_square(P, sq)
    # ==== block (0,2): pavilions on commercial street + chaikhana + auto service on street E ====
    x0, x1 = COLS[0]; z0, z1 = ROWS[2]
    P.bld("shop", -290, 36, -270, 52, "N", shops=[("front", -9, 9, "qahvakhona")])
    P.bld("shop", -264, 36, -240, 50, "N", shops=[("front", -11, 11, "meva")])
    ch = P.bld("shop", -234, 36, -212, 52, "N", shops=[("front", -10, 10, "choikhona")])
    P.prop("tapchan", -230, 58, 0)
    P.prop("tapchan", -222, 58, 0)
    P.prop("tapchan", -216, 58, 0)
    P.bld("garage", -230, 120, -212, 162, "E", shops=[("front", -20, -2, "avtoservis"), ("front", 2, 18, "shinomontazh")])
    P.pave((-208, 110, -192, 166), "asphalt_yard")
    b = P.bld("panel5", -296, 70, -284, 150, "E", n_entr=4, entr_side="front")
    P.front_garden(b)
    courtyard_kit(P, (-276, 70, -238, 150))
    P.pave((-296, 32, -212, 34), "sidewalk")
    # ==== block (1,2): 5-storeys with shops + square + reserved lot 2 ===========================
    x0, x1 = COLS[1]; z0, z1 = ROWS[2]
    b = P.bld("panel5", -188, 36, -124, 48, "N", n_entr=4, entr_side="back",
              shops=[("front", -30, -20, "dorukhona"), ("front", -6, 6, "supermarket"), ("front", 20, 30, "sartaroshkhona")])
    b = P.bld("panel5", -188, 110, -124, 122, "S", n_entr=4, entr_side="back")
    P.front_garden(b)
    courtyard_kit(P, (-186, 58, -126, 104))
    P.reserved.append(("reserved_lot_2", (-112, 36, -66, 92), "Угол проспекта и кӯчаи Гулистон (≈46×56 м)"))
    P.pave((-112, 36, -66, 92), "plaza_reserved")
    sq = (-112, 100, -66, 162)
    P.zones.append(("square_av", sq))
    small_square(P, sq)
    P.pave((-122, 36, -116, 166), "asphalt_yard")
    # ==== block (2,2): shopping street side: store, cafes, office, parking, 5-storey ============
    x0, x1 = COLS[2]; z0, z1 = ROWS[2]
    P.bld("office", -14, 36, 22, 54, "N", n_entr=1, entr_side="front", floors=5,
          shops=[("front", -16, -6, "bank"), ("front", 6, 16, "qahvakhona")])
    P.bld("shop", 30, 36, 72, 58, "N", floors=2, fh=4.0, shops=[("front", -18, 18, "supermarket")])
    P.bld("shop", 78, 36, 100, 50, "N", shops=[("front", -10, 10, "osh")])
    P.bld("shop", 104, 36, 136, 50, "N", shops=[("front", -14, -1, "telefon"), ("front", 1, 14, "gul")])
    P.pave((30, 62, 136, 100), "asphalt_yard", True)
    P.parking.append(((32, 64, 134, 98), "z"))
    b = P.bld("panel5", 20, 112, 100, 124, "N", n_entr=5, entr_side="back")
    P.front_garden(b)
    courtyard_kit(P, (20, 128, 100, 162), play=True)
    P.tree_row("thuja", -10, 60, -10, 160, 5.0, 0.2, 0.05)
    P.scatter("courtyard_tree", (-14, 60, 26, 108), 6)
    # ==== block (3,2): CITY HOSPITAL ===========================================================
    x0, x1 = COLS[3]; z0, z1 = ROWS[3]
    P.zones.append(("hospital", (x0, z0, x1, z1)))
    hospital(P, x0, z0, x1, z1)
    # ==== row 3 west: mahalla (private houses with walls and gates) ============================
    mahalla(P, (-300, 183.5, -208, 235.5), "N")
    mahalla(P, (-300, 244.5, -208, 300), "N")
    mahalla(P, (-192, 183.5, -134.5, 235.5), "N")
    mahalla(P, (-192, 244.5, -134.5, 300), "N")
    mahalla(P, (-125.5, 183.5, -61.5, 235.5), "N")
    mahalla(P, (-125.5, 244.5, -61.5, 300), "N")
    # ==== block (2,3): new complex 12 floors + square with reserved lot 3 ======================
    x0, x1 = COLS[2]; z0, z1 = ROWS[3]
    P.bld("tower", -14, 190, 16, 208, "N", n_entr=2, entr_side="back", floors=12,
          shops=[("front", -14, -2, "dorukhona2"), ("front", 2, 14, "magoza")])
    P.bld("tower", -14, 262, 16, 280, "W", n_entr=2, entr_side="back", floors=12)
    P.reserved.append(("reserved_lot_3", (48, 214, 104, 262), "Центр сквера (≈56×48 м)"))
    sq = (30, 190, 136, 296)
    P.zones.append(("square_s", sq))
    small_square(P, sq, reserve=(48, 214, 104, 262))
    P.pave((20, 210, 26, 296), "asphalt_yard")
    # ==== block (3,3): 5-storeys + metal garages row ===========================================
    x0, x1 = COLS[3]; z0, z1 = ROWS[3]
    b = P.bld("panel5", 166, 190, 230, 202, "N", n_entr=4, entr_side="back")
    b = P.bld("brick5", 240, 190, 296, 202, "N", n_entr=3, entr_side="back")
    b = P.bld("panel5", 166, 266, 236, 278, "S", n_entr=4, entr_side="back")
    P.front_garden(b)
    courtyard_kit(P, (172, 208, 290, 258), sport=False)
    for k in range(9):
        P.prop("metal_garage", 248 + k * 4.2, 290, math.pi)
    P.pave((244, 276, 296, 286), "asphalt_yard")
    return P


def small_square(P, sq, reserve=None):
    """Сквер: paths, benches, flower beds, lamps, trees — the reserved rectangle stays empty."""
    n_props = len(P.props)
    _small_square(P, sq, reserve)
    if reserve:
        x0, z0, x1, z1 = reserve
        keep = P.props[:n_props] + [p for p in P.props[n_props:] if not (x0 - 1 < p[1] < x1 + 1 and z0 - 1 < p[2] < z1 + 1)]
        P.props[:] = keep


def _small_square(P, sq, reserve=None):
    x0, z0, x1, z1 = sq
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    P.pave((x0, cz - 2.5, x1, cz + 2.5), "plaza", True)
    P.pave((cx - 2.5, z0, cx + 2.5, z1), "plaza", True)
    if reserve:
        P.pave(reserve, "plaza_reserved")
    else:
        P.pave((cx - 7, cz - 7, cx + 7, cz + 7), "plaza", True)
        P.ground.append(((cx - 3, cz - 3, cx + 3, cz + 3), "flowerbed", True))
        for k in range(10):
            a = k / 10 * 2 * math.pi
            P.tree("rose", cx + 2 * math.cos(a), cz + 2 * math.sin(a))
    for (px, pz, yaw) in ((cx - 10, cz - 3.5, math.pi), (cx + 10, cz - 3.5, math.pi), (cx - 10, cz + 3.5, 0), (cx + 10, cz + 3.5, 0),
                          (cx - 3.5, cz - 12, math.pi / 2), (cx + 3.5, cz + 12, -math.pi / 2)):
        P.prop("bench_park", px, pz, yaw)
    for (px, pz) in ((cx - 13, cz - 3.4), (cx + 13, cz + 3.4)):
        P.prop("urn", px, pz, 0)
    for (px, pz) in ((cx - 16, cz - 3.2), (cx + 16, cz + 3.2), (cx - 3.2, cz - 16), (cx + 3.2, cz + 16)):
        P.prop("lamp_park", px, pz, 0)
    avoid = [(x0, cz - 3.5, x1, cz + 3.5), (cx - 3.5, z0, cx + 3.5, z1)]
    if reserve:
        avoid.append((reserve[0] - 2, reserve[1] - 2, reserve[2] + 2, reserve[3] + 2))
    P.scatter("park_tree", sq, max(6, int((x1 - x0) * (z1 - z0) / 220)), margin=3, avoid=avoid)
    P.scatter("shrub", sq, 8, margin=2, avoid=avoid)
    for (fx, fz) in ((x0 + 6, z0 + 6), (x1 - 6, z1 - 6)):
        P.ground.append(((fx - 3, fz - 2, fx + 3, fz + 2), "flowerbed", True))
        for k in range(6):
            P.tree("flowers", fx + RNG.uniform(-2.4, 2.4), fz + RNG.uniform(-1.5, 1.5))


def park(P, x0, z0, x1, z1):
    """Park (≈130×148 m): main alley parallel to the avenue, cross alleys, a round plaza
    with flower beds (no fountain/monument), chaikhana with aivan and tapchans, kiosk,
    chinar alleys, poplar rows, thuja borders, rose beds, many benches and lamps."""
    cx, cz = (x0 + x1) / 2, (z0 + z1) / 2
    P.pave((x0, z0, x1, z1), "lawn_park")
    P.pave((x1 - 22, z0, x1 - 14, z1), "plaza", True)                # main alley along the avenue
    P.pave((x0, cz - 3, x1, cz + 3), "plaza", True)                   # cross alley (to mid-block crossing)
    P.pave((x0 + 30, z0, x0 + 35, z1), "cobble", True)                # west alley
    P.pave((x0, z0 + 25, x1 - 22, z0 + 29), "cobble", True)
    P.pave((x0, z1 - 29, x1 - 22, z1 - 25), "cobble", True)
    P.pave((cx - 14, cz - 14, cx + 14, cz + 14), "plaza", True)       # central round-ish plaza
    for (fx, fz) in ((cx - 8, cz - 8), (cx + 8, cz - 8), (cx - 8, cz + 8), (cx + 8, cz + 8)):
        P.ground.append(((fx - 3.5, fz - 3.5, fx + 3.5, fz + 3.5), "flowerbed", True))
        for k in range(9):
            P.tree(RNG.choice(["rose", "rose", "flowers"]), fx + RNG.uniform(-2.8, 2.8), fz + RNG.uniform(-2.8, 2.8))
    # chaikhana pavilion (single storey, aivan with tapchans)
    P.bld("shop", x0 + 40, z0 + 36, x0 + 62, z0 + 50, "E", shops=[("front", -6, 6, "choikhona")])
    P.pave((x0 + 62, z0 + 34, x0 + 74, z0 + 52), "tiles_out", True)
    for k in range(3):
        P.prop("tapchan", x0 + 66, z0 + 37 + k * 5, -math.pi / 2)
        P.prop("tapchan", x0 + 71, z0 + 37 + k * 5, -math.pi / 2)
    P.prop("kiosk", x1 - 26, cz + 20, -math.pi / 2)
    # trees
    P.tree_row("chinar", x1 - 24, z0 + 4, x1 - 24, z1 - 4, 9.0, 0.5, 0.04)
    P.tree_row("chinar", x1 - 12, z0 + 4, x1 - 12, z1 - 4, 9.0, 0.5, 0.04)
    P.tree_row("poplar", x0 + 3, z0 + 3, x0 + 3, z1 - 3, 5.5, 0.3, 0.05)
    P.tree_row("elm", x0 + 28, z0 + 4, x0 + 28, z1 - 4, 8.0, 0.6, 0.08)
    P.tree_row("thuja", cx - 16, cz - 16, cx + 16, cz - 16, 4.0, 0.1, 0.0)
    P.tree_row("thuja", cx - 16, cz + 16, cx + 16, cz + 16, 4.0, 0.1, 0.0)
    avoid = [(x1 - 23, z0, x1 - 13, z1), (x0, cz - 4, x1, cz + 4), (x0 + 29, z0, x0 + 36, z1),
             (x0, z0 + 24, x1, z0 + 30), (x0, z1 - 30, x1, z1 - 24), (cx - 17, cz - 17, cx + 17, cz + 17),
             (x0 + 38, z0 + 32, x0 + 76, z0 + 54)]
    P.scatter("park_tree", (x0 + 4, z0 + 4, x1 - 26, z1 - 4), 70, margin=2, avoid=avoid)
    P.scatter("shrub", (x0 + 4, z0 + 4, x1 - 26, z1 - 4), 30, margin=2, avoid=avoid)
    # benches/lamps along alleys
    z = z0 + 8
    while z < z1 - 6:
        if abs(z - cz) > 6:
            P.prop("bench_park", x1 - 22.6, z, -math.pi / 2)
            P.prop("bench_park", x1 - 13.4, z + 4, math.pi / 2)
        if (int(z) // 6) % 3 == 0:
            P.prop("urn", x1 - 22.6, z + 2.0, 0)
        P.prop("lamp_park", x1 - 22.8, z + 6, 0)
        z += 14
    for x in range(int(x0 + 6), int(x1 - 24), 18):
        P.prop("bench_park", x, cz - 3.6, math.pi)
        P.prop("bench_park", x + 8, cz + 3.6, 0)
        P.prop("lamp_park", x + 4, cz - 3.8, 0)
    for (px, pz, yaw) in ((cx, cz - 13.2, math.pi), (cx, cz + 13.2, 0), (cx - 13.2, cz, -math.pi / 2), (cx + 13.2, cz, math.pi / 2)):
        P.prop("bench_park", px - 3, pz, yaw)
        P.prop("bench_park", px + 3, pz, yaw) if yaw in (0, math.pi) else P.prop("bench_park", px, pz + 3, yaw)
        P.prop("lamp_park", px + 6 if yaw in (0, math.pi) else px, pz if yaw in (0, math.pi) else pz + 6, 0)
    P.rect_line("fence_lawn_park", (x0 + 1, z0 + 1, x1 - 1, z1 - 1),
                gaps=[("E", cz, 8), ("W", cz, 8), ("N", x1 - 18, 10), ("S", x1 - 18, 10), ("N", x0 + 32.5, 6),
                      ("S", x0 + 32.5, 6)])


def hospital(P, x0, z0, x1, z1):
    main = P.bld("hospital", 186, 50, 266, 66, "N", n_entr=2, entr_side="front", sign="bemorkhona")
    P.bld("hospital", 250, 76, 266, 140, "W", n_entr=1, entr_side="front", floors=3, sign="darmongoh")   # polyclinic
    P.bld("hospital", 186, 104, 236, 118, "S", n_entr=1, entr_side="front", floors=3, sign="qabul")
    P.pave((166, 36, 296, 46), "asphalt_yard", True)                 # entrance drive
    P.pave((170, 124, 244, 160), "asphalt_yard", True)               # ambulance yard + parking
    P.parking.append(((176, 140, 244, 158), "z"))
    P.prop("ambulance_canopy", 211, 121, 0)
    P.pave((186, 72, 244, 98), "plaza", True)                        # hospital garden paths
    P.ground.append(((196, 78, 234, 92), "lawn", True))
    P.scatter("park_tree", (190, 74, 242, 96), 7, margin=2)
    for k in range(6):
        P.prop("bench_park", 196 + k * 7, 95.5, math.pi)
    P.rect_line("fence_hospital", (162, 34, 298, 164), gaps=[("N", 206, 8), ("N", 246, 8), ("W", 140, 8)])
    P.tree_row("street_tree", 166, 168 - 4, 296, 168 - 4, 9.0)
    P.scatter("courtyard_tree", (270, 70, 296, 160), 5)


def mahalla(P, rect, gate_side):
    """Private houses: lots ~ 18x24 m, plastered 2.2 m walls with painted metal gates facing
    the lane, 1-2 storey houses at the back of the lot, yard with fruit trees and a grape
    trellis (ток/токзор) — the traditional Dushanbe havli."""
    x0, z0, x1, z1 = rect
    depth = z1 - z0
    n = max(1, int((x1 - x0) / 18))
    w = (x1 - x0) / n
    # two rows of lots back to back if deep enough
    rows = [(z0, z0 + depth / 2, "N"), (z0 + depth / 2, z1, "S")] if depth > 40 else [(z0, z1, "N")]
    for (a, b, gs) in rows:
        for i in range(n):
            lx0, lx1 = x0 + i * w + 0.3, x0 + (i + 1) * w - 0.3
            lot = (lx0, a + 0.3, lx1, b - 0.3)
            gate_x = lx0 + RNG.uniform(3, w - 7)
            gz = lot[1] if gs == "N" else lot[3]
            P.rect_line("havli_wall", lot, gaps=[(gs, gate_x + 1.8, 3.6)])
            P.prop("havli_gate", gate_x + 1.8, gz, math.pi if gs == "N" else 0.0)
            hd = RNG.uniform(8, 10)
            hl = min(w - 4, RNG.uniform(10, 14))
            hx0 = lx0 + RNG.uniform(1.0, max(1.0, w - hl - 2.0))
            if gs == "N":
                hz0, hz1 = lot[3] - 1.0 - hd, lot[3] - 1.0
            else:
                hz0, hz1 = lot[1] + 1.0, lot[1] + 1.0 + hd
            P.bld("house", hx0, hz0, hx0 + hl, hz1, gs)
            yard = (lx0 + 0.4, min(gz, hz0) + 0.4 if gs == "N" else hz1 + 0.4, lx1 - 0.4, hz0 - 0.4 if gs == "N" else lot[3] - 0.4)
            if yard[3] - yard[1] > 3:
                P.pave(yard, RNG.choice(["concrete_yard", "concrete_yard", "lawn_worn"]))
                yc = ((yard[0] + yard[2]) / 2, (yard[1] + yard[3]) / 2)
                P.prop("grape_trellis", yc[0], yc[1], 0)
                P.tree(RNG.choice(["fruit", "mulberry", "fruit"]), yard[0] + 2.0, yc[1] + RNG.uniform(-1, 1))
                if RNG.random() < 0.6:
                    P.tree(RNG.choice(["fruit", "poplar", "thuja"]), yard[2] - 1.5, yc[1])
                P.tree("rose", yc[0] + 3, yard[1] + 1.0)
