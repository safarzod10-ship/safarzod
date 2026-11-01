"""Street network geometry: carriageways, medians, tree strips / aryks, sidewalks, curbs with
rounded corners, crosswalks with curb ramps, road markings (GOST-style, right-hand traffic),
storm grates and manholes. Everything axis-aligned (Dushanbe centre is an orthogonal grid).

Heights: carriageway y=0, everything pedestrian (sidewalks, blocks, medians) y=H=0.15.
"""
import math

H = 0.15
CURB_W = 0.18


# ---------------------------------------------------------------- rectangle algebra --------------
def rect_sub(r, c):
    """r - c -> list of rects. Rects are (x0, z0, x1, z1)."""
    x0, z0, x1, z1 = r
    cx0, cz0, cx1, cz1 = c
    if cx0 >= x1 or cx1 <= x0 or cz0 >= z1 or cz1 <= z0:
        return [r]
    out = []
    if cz0 > z0:
        out.append((x0, z0, x1, cz0))
    if cz1 < z1:
        out.append((x0, cz1, x1, z1))
    mz0, mz1 = max(z0, cz0), min(z1, cz1)
    if cx0 > x0:
        out.append((x0, mz0, cx0, mz1))
    if cx1 < x1:
        out.append((cx1, mz0, x1, mz1))
    return [o for o in out if o[2] - o[0] > 1e-4 and o[3] - o[1] > 1e-4]


def rects_sub(rs, cs):
    for c in cs:
        nxt = []
        for r in rs:
            nxt += rect_sub(r, c)
        rs = nxt
    return rs


def rect_and(a, b):
    r = (max(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), min(a[3], b[3]))
    return r if r[2] > r[0] and r[3] > r[1] else None


def split_grid(r, step=100.0, origin=-300.0):
    """Split rect by chunk grid lines."""
    out = [r]
    for axis in (0, 1):
        nxt = []
        for q in out:
            lo, hi = q[axis], q[axis + 2]
            k = math.floor((lo - origin) / step) + 1
            cuts = []
            while origin + k * step < hi - 1e-6:
                cuts.append(origin + k * step)
                k += 1
            edges = [lo] + cuts + [hi]
            for a, b in zip(edges[:-1], edges[1:]):
                if axis == 0:
                    nxt.append((a, q[1], b, q[3]))
                else:
                    nxt.append((q[0], a, q[2], b))
        out = nxt
    return out


# ---------------------------------------------------------------- road model ---------------------
class Road:
    def __init__(self, id, name, axis, c, a0, a1, median=0.0, carriage=3.5, lanes=1, parking=0.0,
                 strip=2.0, strip_kind="lawn", sidewalk=3.5, corner_r=6.0, centerline="dashed", bus=()):
        self.__dict__.update(locals())
        del self.__dict__["self"]
        self.cw = median + carriage + parking          # half width of asphalt (incl. median)
        self.half = self.cw + strip + sidewalk

    def rect(self, o0, o1, a0=None, a1=None):
        a0 = self.a0 if a0 is None else a0
        a1 = self.a1 if a1 is None else a1
        if self.axis == "z":
            return (self.c + o0, a0, self.c + o1, a1)
        return (a0, self.c + o0, a1, self.c + o1)

    def bands(self):
        m, cw = self.median, self.cw
        b = {"carriage": [self.rect(-cw, cw)]}
        if m > 0:
            b["median"] = [self.rect(-m, m)]
        if self.strip > 0:
            b["strip"] = [self.rect(-cw - self.strip, -cw), self.rect(cw, cw + self.strip)]
        b["sidewalk"] = [self.rect(-self.half, -cw - self.strip), self.rect(cw + self.strip, self.half)]
        return b

    def p(self, along, off):
        """World (x, z) of a point given distance along axis and lateral offset."""
        return (self.c + off, along) if self.axis == "z" else (along, self.c + off)


class Network:
    def __init__(self, roads, bounds=(-300, -300, 300, 300)):
        self.roads = roads
        self.bounds = bounds
        self.surfaces = []   # (mat, rect, y)
        self.curbs = []      # (x0,z0,x1,z1, side) curb boxes (axis aligned)
        self.fillets = []    # (Kx, Kz, sx, sz, r)
        self.ramps = []      # (rect, dir) dir = 'x+','x-','z+','z-' slope rises towards
        self.paint = []      # (rect, colour) markings
        self.grates = []     # (x, z, yaw)
        self.manholes = []   # (x, z)
        self.aryk = []       # rects of aryk channels
        self.crosswalks = [] # (rect, axis)
        self.intersections = []
        self.signal_points = []  # (road, along, sgn)
        self._cw_strip_cuts = []

    # ------------------------------------------------------------------------------------------
    def build(self, midblock=()):
        R = self.roads
        bands = [r.bands() for r in R]
        inter = []
        for i, a in enumerate(R):
            for j, b in enumerate(R):
                if j <= i or a.axis == b.axis:
                    continue
                za, xb = (a, b) if a.axis == "z" else (b, a)
                # za runs along z at x=za.c ; xb runs along x at z=xb.c
                if za.a0 - 1e-6 <= xb.c <= za.a1 + 1e-6 and xb.a0 - 1e-6 <= za.c <= xb.a1 + 1e-6:
                    inter.append((za, xb))
        self.intersections = inter
        # corner fillets
        corner_sq = []
        for (za, xb) in inter:
            for sx in (-1, 1):
                for sz in (-1, 1):
                    Kx = za.c + sx * za.cw
                    Kz = xb.c + sz * xb.cw
                    za_cont = (za.a1 > Kz + 1) if sz > 0 else (za.a0 < Kz - 1)
                    xb_cont = (xb.a1 > Kx + 1) if sx > 0 else (xb.a0 < Kx - 1)
                    if not (za_cont and xb_cont):
                        continue
                    r = min(za.corner_r, xb.corner_r, za.strip + za.sidewalk, xb.strip + xb.sidewalk)
                    self.fillets.append((Kx, Kz, sx, sz, r))
                    corner_sq.append((min(Kx, Kx + sx * r), min(Kz, Kz + sz * r), max(Kx, Kx + sx * r), max(Kz, Kz + sz * r)))
        # crosswalks: at each intersection approach + mid-block
        cw_rects = []
        for (za, xb) in inter:
            for road, other in ((za, xb), (xb, za)):
                for sgn in (-1, 1):
                    edge = other.c + sgn * other.cw
                    if not (road.a0 < edge + sgn * 6 < road.a1):
                        continue
                    if road.lanes == 0:
                        continue
                    r = min(road.corner_r, other.corner_r, road.strip + road.sidewalk, other.strip + other.sidewalk)
                    a0 = edge + sgn * (r + 0.6)
                    a1 = a0 + sgn * 4.0
                    self._crosswalk(road, min(a0, a1), max(a0, a1), sgn, cw_rects)
        for (road, along) in midblock:
            self._crosswalk(road, along - 2.0, along + 2.0, 0, cw_rects)
        # surfaces with priority cutting
        carr_all = [(i, rc) for i, b in enumerate(bands) for rc in b["carriage"]]
        side_all = [(i, rc) for i, b in enumerate(bands) for rc in b["sidewalk"]]
        strip_all = [(i, rc) for i, b in enumerate(bands) for rc in b.get("strip", [])]
        ramp_cuts = [r for (r, _) in self.ramps]
        cw_strip_cuts = self._cw_strip_cuts
        for i, (road, b) in enumerate(zip(R, bands)):
            carr = rects_sub(list(b["carriage"]), [rc for (j, rc) in carr_all if j < i])
            for rc in carr:
                self.surfaces.append(("asphalt", rc, 0.0))
            other_carr = [rc for (j, rc) in carr_all if j != i]
            if "median" in b:
                med = rects_sub(list(b["median"]), other_carr + [c for (c, ax) in self.crosswalks if ax == road.axis])
                for rc in med:
                    self.surfaces.append(("median", rc, H))
            if "strip" in b:
                st = rects_sub(list(b["strip"]), other_carr + [rc for (j, rc) in side_all if j != i]
                               + [rc for (j, rc) in strip_all if j != i] + corner_sq + ramp_cuts + cw_strip_cuts)
                for rc in st:
                    self.surfaces.append(("strip:" + road.strip_kind, rc, H))
            sw = rects_sub(list(b["sidewalk"]), other_carr + [rc for (j, rc) in side_all if j < i] + corner_sq + ramp_cuts)
            for rc in sw:
                self.surfaces.append(("sidewalk", rc, H))
        for rc in cw_strip_cuts:
            for piece in rects_sub([rc], ramp_cuts):
                self.surfaces.append(("sidewalk", piece, H))
        # curbs along carriage edges and medians
        for i, road in enumerate(R):
            offs = [road.cw, -road.cw]
            if road.median > 0:
                offs += [road.median, -road.median]
            for o in offs:
                outward = (1 if o > 0 else -1) * (1 if abs(o) == road.cw else -1)
                # curb occupies raised side
                o_in = o if outward > 0 else o - CURB_W
                o_out = o + CURB_W if outward > 0 else o
                if abs(o) == road.cw:
                    o_in, o_out = (o, o + CURB_W) if o > 0 else (o - CURB_W, o)
                else:
                    o_in, o_out = (o - CURB_W, o) if o > 0 else (o, o + CURB_W)
                base = [road.rect(o_in, o_out)]
                cuts = [rc for (j, rc) in carr_all if j != i] + corner_sq + [r for (r, _) in self.ramps]
                if abs(o) != road.cw:
                    cuts += [c for (c, ax) in self.crosswalks if ax == road.axis]
                for rc in rects_sub(base, cuts):
                    self.curbs.append(rc)
        self._markings()

    def _crosswalk(self, road, a0, a1, sgn, cw_rects):
        """Zebra across `road` between along-positions a0..a1; curb ramps on both sides."""
        if not hasattr(self, "_cws"):
            self._cws = []
        rect = road.rect(-road.cw, road.cw, a0, a1)
        self.crosswalks.append((rect, road.axis))
        # ramps (1.2 m) on both sides at the curb, and paved path through the tree strip
        for side in (-1, 1):
            o0 = side * road.cw
            o1 = side * (road.cw + 1.2)
            rr = road.rect(min(o0, o1), max(o0, o1), a0, a1)
            if road.axis == "z":
                d = "x+" if side > 0 else "x-"
            else:
                d = "z+" if side > 0 else "z-"
            self.ramps.append((rr, d))
            if road.strip > 1.2:
                so0 = side * (road.cw + 1.2)
                so1 = side * (road.cw + road.strip)
                self._cw_strip_cuts.append(road.rect(min(so0, so1), max(so0, so1), a0, a1))
        # stripes (parallel to traffic), 0.5 m wide, 0.5 m gaps
        n = int((2 * road.cw - 0.6) / 1.0)
        start = -n / 2.0
        for k in range(n):
            o = (start + k) * 1.0 + 0.25
            self.paint.append((road.rect(o, o + 0.5, a0, a1), "white"))
        # stop lines for traffic approaching this crosswalk (right-hand traffic)
        if sgn != 0 and road.lanes > 0:
            # vehicles approaching the intersection travel towards -sgn... lanes on the right side
            far = a1 + 1.5 if sgn > 0 else a0 - 1.5
            # traveling direction t = -sgn along axis; right side offset sign:
            # axis z: t=(0,-sgn) -> right = (sgn... ) computed: right of (0,-1) is +x
            if road.axis == "z":
                rs = 1 if sgn > 0 else -1
            else:
                rs = -1 if sgn > 0 else 1
            o0, o1 = (road.median, road.cw) if rs > 0 else (-road.cw, -road.median)
            s0, s1 = (far, far + 0.4) if sgn > 0 else (far - 0.4, far)
            self.paint.append((road.rect(o0 + 0.1 * rs if rs < 0 else o0, o1, s0, s1), "white"))
            self.signal_points.append((road, (a0 + a1) / 2, sgn))

    def _markings(self):
        cw_cuts = [c for (c, ax) in self.crosswalks]
        for road in self.roads:
            inter_cuts = []
            for (za, xb) in self.intersections:
                other = xb if road is za else (za if road is xb else None)
                if other is None:
                    continue
                pad = other.cw + 12.0
                inter_cuts.append(road.rect(-road.cw - 1, road.cw + 1, other.c - pad, other.c + pad))
            def seg(o0, o1, dash=None, colour="white", cuts=None):
                base = [road.rect(o0, o1)]
                rs = rects_sub(base, (cuts if cuts is not None else inter_cuts) + cw_cuts)
                for rc in rs:
                    if dash is None:
                        self.paint.append((rc, colour))
                    else:
                        L, G = dash
                        lo, hi = (rc[1], rc[3]) if road.axis == "z" else (rc[0], rc[2])
                        a = lo + 1.0
                        while a + L < hi:
                            if road.axis == "z":
                                self.paint.append(((rc[0], a, rc[2], a + L), colour))
                            else:
                                self.paint.append(((a, rc[1], a + L, rc[3]), colour))
                            a += L + G
            m = road.median
            if road.lanes == 0:
                continue
            if m > 0:
                for s in (1, -1):
                    seg(s * (m + 0.25), s * (m + 0.40))           # edge line by median
                    for k in range(1, road.lanes):
                        o = m + 3.5 * k
                        seg(s * o - 0.075, s * o + 0.075, dash=(3.0, 9.0))
            else:
                if road.centerline == "solid":
                    seg(-0.06, 0.06)
                else:
                    seg(-0.06, 0.06, dash=(3.0, 6.0))
                    # solid near intersections (1.1 replaced by 1.1 before stop lines)
                    near = []
                    for (za, xb) in self.intersections:
                        other = xb if road is za else (za if road is xb else None)
                        if other is None:
                            continue
                        for sgn in (-1, 1):
                            e = other.c + sgn * (other.cw + 4.5)
                            a0, a1 = sorted((e, e + sgn * 20.0))
                            near.append(road.rect(-0.06, 0.06, a0, a1))
                    for rc in rects_sub(near, cw_cuts + [road.rect(-1, 1, oc - oc_pad, oc + oc_pad) for (oc, oc_pad) in self._inter_spans(road)]):
                        self.paint.append((rc, "white"))
            if road.parking > 0:
                for s in (1, -1):
                    o0 = s * (road.carriage + m)
                    seg(min(o0, o0 + s * 0.1), max(o0, o0 + s * 0.1), dash=(1.0, 1.0))
            # storm grates along the curb every ~32 m, manholes in lanes
            lo, hi = road.a0, road.a1
            a = lo + 14.0
            k = 0
            while a < hi - 10:
                for s in (1, -1):
                    x, z = road.p(a + s * 3.0, s * (road.cw - 0.3))
                    if not self._in_any(x, z, inter_cuts + cw_cuts):
                        self.grates.append((x, z, 0.0 if road.axis == "z" else math.pi / 2))
                if k % 2 == 0:
                    off = (m + 1.7) if m > 0 else 1.7
                    x, z = road.p(a + 9.0, off * (1 if k % 4 == 0 else -1))
                    if not self._in_any(x, z, inter_cuts + cw_cuts):
                        self.manholes.append((x, z))
                a += 32.0
                k += 1

    def _inter_spans(self, road):
        out = []
        for (za, xb) in self.intersections:
            other = xb if road is za else (za if road is xb else None)
            if other is not None:
                out.append((other.c, other.cw))
        return out

    @staticmethod
    def _in_any(x, z, rects):
        return any(r[0] <= x <= r[2] and r[1] <= z <= r[3] for r in rects)


# ---------------------------------------------------------------- geometry emission --------------
def emit(net, B, chunk_of):
    """Emit road geometry into per-chunk builders. B(chunk_key) -> Builder (base)."""
    def surf(mat, r, y):
        for q in split_grid(r):
            b = B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
            b.quad(mat, (q[0], y, q[3]), (q[2], y, q[3]), (q[2], y, q[1]), (q[0], y, q[1]))

    for (kind, r, y) in net.surfaces:
        if kind == "asphalt":
            surf("asphalt", r, 0.0)
        elif kind == "sidewalk":
            surf("sidewalk", r, H)
        elif kind == "median":
            surf("lawn", r, H)
        elif kind == "strip:lawn" or kind == "strip:pits":
            surf("lawn" if kind == "strip:lawn" else "sidewalk", r, H)
        elif kind == "strip:aryk":
            aryk_strip(net, r, B, chunk_of)
    for r in net.curbs:
        for q in split_grid(r):
            b = B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
            b.ao_ground = False
            b.box("curb", q[0], -0.05, q[1], q[2], H + 0.02, q[3], faces="YxXzZ")
            b.ao_ground = True
    for (Kx, Kz, sx, sz, r) in net.fillets:
        fillet(B(chunk_of(Kx + sx * r / 2, Kz + sz * r / 2)), Kx, Kz, sx, sz, r)
    for (r, d) in net.ramps:
        ramp(B(chunk_of((r[0] + r[2]) / 2, (r[1] + r[3]) / 2)), r, d)
    for (r, col) in net.paint:
        for q in split_grid(r):
            b = B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
            t = (1, 1, 1) if col == "white" else (0.95, 0.78, 0.15)
            b.ao_ground = False
            b.quad("road_paint", (q[0], 0.012, q[3]), (q[2], 0.012, q[3]), (q[2], 0.012, q[1]), (q[0], 0.012, q[1]), tint=t)
            b.ao_ground = True
    for (x, z, yaw) in net.grates:
        b = B(chunk_of(x, z))
        b.set_transform(x, 0.0, z, yaw)
        b.ao_ground = False
        b.quad("grate", (-0.25, 0.01, 0.4), (0.25, 0.01, 0.4), (0.25, 0.01, -0.4), (-0.25, 0.01, -0.4),
               uv=[(0, 1), (1, 1), (1, 0), (0, 0)])
        b.ao_ground = True
        b.set_transform(0, 0, 0, 0)
    for (x, z) in net.manholes:
        b = B(chunk_of(x, z))
        disk(b, "manhole", x, 0.011, z, 0.36, 14)


def disk(b, mat, x, y, z, r, seg):
    for i in range(seg):
        a0, a1 = 2 * math.pi * i / seg, 2 * math.pi * (i + 1) / seg
        p0 = (x + r * math.cos(a0), y, z + r * math.sin(a0))
        p1 = (x + r * math.cos(a1), y, z + r * math.sin(a1))
        b.tri(mat, (x, y, z), p1, p0, uv=[(0.5, 0.5), (0.5 + 0.5 * math.cos(a1), 0.5 + 0.5 * math.sin(a1)), (0.5 + 0.5 * math.cos(a0), 0.5 + 0.5 * math.sin(a0))])


def fillet(b, Kx, Kz, sx, sz, r, seg=10):
    """Rounded curb corner. Arc centred at O=K+(sx r, sz r): asphalt between K and arc,
    raised paving inside the arc, curb (top + face) along the arc."""
    import numpy as np
    Ox, Oz = Kx + sx * r, Kz + sz * r
    dirs = [(-sx * math.cos(i / seg * math.pi / 2), -sz * math.sin(i / seg * math.pi / 2)) for i in range(seg + 1)]

    def P(rad, d, y):
        return (Ox + d[0] * rad, y, Oz + d[1] * rad)

    def face(mat, pts, want):
        p = np.array(pts, float)
        n = np.cross(p[1] - p[0], p[2] - p[0])
        if np.dot(n, want) < 0:
            pts = pts[::-1]
        if len(pts) == 3:
            b.tri(mat, *pts)
        else:
            b.quad(mat, *pts)

    b.ao_ground = False
    rc = r - CURB_W
    up = (0, 1, 0)
    for i in range(seg):
        d0, d1 = dirs[i], dirs[i + 1]
        face("asphalt", [(Kx, 0.0, Kz), P(r, d0, 0.0), P(r, d1, 0.0)], up)
        face("sidewalk", [(Ox, H, Oz), P(rc, d0, H), P(rc, d1, H)], up)
        face("curb", [P(rc, d0, H + 0.02), P(r, d0, H + 0.02), P(r, d1, H + 0.02), P(rc, d1, H + 0.02)], up)
        dm = ((d0[0] + d1[0]) / 2, 0, (d0[1] + d1[1]) / 2)
        face("curb", [P(r, d0, -0.05), P(r, d1, -0.05), P(r, d1, H + 0.02), P(r, d0, H + 0.02)], dm)
    b.ao_ground = True


def ramp(b, r, d):
    """Sloped paving from y=0.02 (curb side) up to H, rising in direction d."""
    x0, z0, x1, z1 = r
    lo, hi = 0.02, H
    if d == "x+":
        ys = (lo, hi, hi, lo)   # (x0,z1),(x1,z1),(x1,z0),(x0,z0)
    elif d == "x-":
        ys = (hi, lo, lo, hi)
    elif d == "z+":
        ys = (hi, hi, lo, lo)
    else:
        ys = (lo, lo, hi, hi)
    b.ao_ground = False
    b.quad("sidewalk", (x0, ys[0], z1), (x1, ys[1], z1), (x1, ys[2], z0), (x0, ys[3], z0))
    # tactile warning strip (yellowish paving) at the curb edge is common on rebuilt crossings
    b.ao_ground = True


def aryk_strip(net, r, B, chunk_of):
    """Tree strip with an open concrete irrigation ditch (aryk) in the middle — classic
    Central Asian street section. Lawn either side, channel 0.6 m wide, 0.45 m deep."""
    x0, z0, x1, z1 = r
    alongz = (z1 - z0) > (x1 - x0)
    w = (x1 - x0) if alongz else (z1 - z0)
    cw_, dep = 0.6, 0.45
    a = (w - cw_) / 2
    for q in split_grid(r):
        b = B(chunk_of((q[0] + q[2]) / 2, (q[1] + q[3]) / 2))
        X0, Z0, X1, Z1 = q
        if alongz:
            c0, c1 = x0 + a, x0 + a + cw_
            for lr in ((X0, c0), (c1, X1)):
                b.quad("lawn", (lr[0], H, Z1), (lr[1], H, Z1), (lr[1], H, Z0), (lr[0], H, Z0))
            b.ao_ground = False
            b.quad("aryk", (c0, H - dep, Z1), (c1, H - dep, Z1), (c1, H - dep, Z0), (c0, H - dep, Z0), ao=0.6)
            b.quad("aryk", (c0, H - dep, Z0), (c0, H - dep, Z1), (c0, H, Z1), (c0, H, Z0), ao=0.7)
            b.quad("aryk", (c1, H - dep, Z1), (c1, H - dep, Z0), (c1, H, Z0), (c1, H, Z1), ao=0.7)
            b.quad("water", (c0, H - dep + 0.12, Z1), (c1, H - dep + 0.12, Z1), (c1, H - dep + 0.12, Z0), (c0, H - dep + 0.12, Z0))
            b.box("curb", c0 - 0.1, H - 0.02, Z0, c0, H + 0.06, Z1, faces="YxX")
            b.box("curb", c1, H - 0.02, Z0, c1 + 0.1, H + 0.06, Z1, faces="YxX")
        else:
            c0, c1 = z0 + a, z0 + a + cw_
            for lr in ((Z0, c0), (c1, Z1)):
                b.quad("lawn", (X0, H, lr[1]), (X1, H, lr[1]), (X1, H, lr[0]), (X0, H, lr[0]))
            b.ao_ground = False
            b.quad("aryk", (X0, H - dep, c1), (X1, H - dep, c1), (X1, H - dep, c0), (X0, H - dep, c0), ao=0.6)
            b.quad("aryk", (X1, H - dep, c0), (X0, H - dep, c0), (X0, H, c0), (X1, H, c0), ao=0.7)
            b.quad("aryk", (X0, H - dep, c1), (X1, H - dep, c1), (X1, H, c1), (X0, H, c1), ao=0.7)
            b.quad("water", (X0, H - dep + 0.12, c1), (X1, H - dep + 0.12, c1), (X1, H - dep + 0.12, c0), (X0, H - dep + 0.12, c0))
            b.box("curb", X0, H - 0.02, c0 - 0.1, X1, H + 0.06, c0, faces="YzZ")
            b.box("curb", X0, H - 0.02, c1, X1, H + 0.06, c1 + 0.1, faces="YzZ")
        b.ao_ground = True
        net.aryk.append(q)
