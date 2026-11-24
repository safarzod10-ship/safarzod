"""Texture/ornament library for the Tajik kit (system python3 -I, numpy+scipy+PIL).

Conventions
- An *island* is a rectangle of the atlas: (x0, y0) pixel origin (top-left), (w, h) pixels,
  px_m metres per pixel. Inside an island we work in physical metres: x to the right,
  y upward from the island's bottom edge.
- Height maps are in metres (positive = raised).
- Normal maps are OpenGL convention (+G = +V = up in the image).
All ornament is generated here from geometry (Hankin girih construction, parametric scrolls).
"""
import os, math
import numpy as np
import scipy.ndimage as ndi
from scipy.spatial import cKDTree
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(os.path.dirname(HERE), 'tex')
RNG = np.random.default_rng(7)

# --------------------------------------------------------------------------- io

_cache = {}
def ph(name, kind, px_m, src_m):
    """Load Poly Haven map (kind col/nrm/arm), resampled to px_m metres/pixel.
    src_m = physical width of the source texture in metres."""
    key = (name, kind, round(px_m, 6))
    if key in _cache:
        return _cache[key]
    im = Image.open(os.path.join(TEX, f'{name}_{kind}.jpg')).convert('RGB')
    n = max(16, int(round(src_m / px_m)))
    im = im.resize((n, n), Image.LANCZOS)
    a = np.asarray(im).astype(np.float32) / 255.0
    if kind == 'col':
        a = srgb_to_lin(a)
    _cache[key] = a
    return a

def srgb_to_lin(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def lin_to_srgb(c):
    c = np.clip(c, 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)

def hexc(h):
    h = h.lstrip('#')
    return srgb_to_lin(np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], np.float32))

def save_rgb(arr, path, srgb=True, q=90):
    a = lin_to_srgb(arr) if srgb else np.clip(arr, 0, 1)
    Image.fromarray((a * 255 + 0.5).astype(np.uint8)).save(path, quality=q, subsampling=0 if q >= 90 else 2)

# ----------------------------------------------------------------------- sampling

def tile(src, h, w, angle=0.0, off=(0.0, 0.0), normal=False):
    """Sample a (wrapping) source texture into an h x w block, rotated by angle (radians).
    If normal=True the tangent-space XY is rotated accordingly."""
    sh, sw = src.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    ca, sa = math.cos(angle), math.sin(angle)
    u = ca * xx - sa * yy + off[0] * sw
    v = sa * xx + ca * yy + off[1] * sh
    out = np.empty((h, w, src.shape[2]), np.float32)
    for c in range(src.shape[2]):
        out[..., c] = ndi.map_coordinates(src[..., c], [v, u], order=1, mode='grid-wrap')
    if normal:
        n = out * 2 - 1
        x, y = n[..., 0], -n[..., 1]          # to image-down y
        xr = ca * x - sa * y
        yr = sa * x + ca * y
        n = np.dstack([xr, -yr, n[..., 2]])
        out = n * 0.5 + 0.5
    return out

def fbm(h, w, scale_px, octaves=4, seed=0, aniso=(1.0, 1.0)):
    """Smooth value noise in [0,1]. scale_px = feature size of first octave in pixels.
    aniso stretches features (sx, sy)."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((h, w), np.float32); amp = 1.0; tot = 0
    s = scale_px
    for o in range(octaves):
        gh = max(2, int(h / (s * aniso[1])) + 2); gw = max(2, int(w / (s * aniso[0])) + 2)
        g = rng.random((gh, gw)).astype(np.float32)
        z = ndi.zoom(g, (h / (gh - 1) * 1.0001, w / (gw - 1) * 1.0001), order=3, mode='grid-wrap')[:h, :w]
        acc += amp * z; tot += amp; amp *= 0.5; s /= 2
    acc /= tot
    acc = (acc - acc.min()) / (acc.max() - acc.min() + 1e-6)
    return acc

def voronoi_edges(h, w, cell_px, seed=0, jitter=1.0):
    """Distance (px) to the nearest Voronoi edge (approx d2-d1)/2."""
    rng = np.random.default_rng(seed)
    n = int(h * w / (cell_px * cell_px)) + 4
    pts = rng.random((n, 2)) * [h, w]
    # wrap copies for seamless-ish edges
    tree = cKDTree(pts)
    yy, xx = np.mgrid[0:h, 0:w]
    q = np.stack([yy.ravel(), xx.ravel()], 1)
    d, _ = tree.query(q, k=2)
    e = (d[:, 1] - d[:, 0]) * 0.5
    return e.reshape(h, w).astype(np.float32)

# ------------------------------------------------------------------ relief maps

def normal_from_height(hm, px_m, strength=1.0):
    gy, gx = np.gradient(hm.astype(np.float32))
    dhdu = gx / px_m * strength
    dhdv = -gy / px_m * strength
    n = np.dstack([-dhdu, -dhdv, np.ones_like(hm)])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n

def blend_normals(base, detail, k=1.0):
    """UDN-style blend of two unit-normal arrays (xyz in -1..1)."""
    n = np.dstack([base[..., 0] + detail[..., 0] * k, base[..., 1] + detail[..., 1] * k, base[..., 2]])
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n

def n_to_rgb(n):
    return np.clip(n * 0.5 + 0.5, 0, 1)

def rgb_to_n(rgb):
    n = rgb * 2 - 1
    n /= np.linalg.norm(n, axis=2, keepdims=True) + 1e-6
    return n

def ao_from_height(hm, px_m, radii_m=(0.004, 0.012, 0.035), k=0.9):
    ao = np.ones_like(hm)
    for i, r in enumerate(radii_m):
        b = ndi.gaussian_filter(hm, max(0.5, r / px_m), mode='nearest')
        occ = np.clip((b - hm) / r * k, 0, 1)
        ao -= occ * (0.55 / len(radii_m)) * 2
    return np.clip(ao, 0.15, 1)

def cavity(hm, px_m, r_m=0.004):
    """>0 on convex edges/ridges, <0 in creases."""
    b = ndi.gaussian_filter(hm, max(0.5, r_m / px_m), mode='nearest')
    return (hm - b) / r_m

# ------------------------------------------------------------------- rasterizer

class Canvas:
    """Island canvas in metres. y up."""
    def __init__(self, w_m, h_m, px_m):
        self.px = px_m
        self.W = int(round(w_m / px_m)); self.H = int(round(h_m / px_m))
        self.w_m, self.h_m = self.W * px_m, self.H * px_m
        self.h = np.zeros((self.H, self.W), np.float32)

    def grid(self, x0, y0, x1, y1):
        px = self.px
        c0 = max(0, int(math.floor(x0 / px))); c1 = min(self.W, int(math.ceil(x1 / px)) + 1)
        r0 = max(0, int(math.floor((self.h_m - y1) / px))); r1 = min(self.H, int(math.ceil((self.h_m - y0) / px)) + 1)
        if c0 >= c1 or r0 >= r1:
            return None
        xs = (np.arange(c0, c1) + 0.5) * px
        ys = self.h_m - (np.arange(r0, r1) + 0.5) * px
        X, Y = np.meshgrid(xs, ys)
        return (slice(r0, r1), slice(c0, c1)), X, Y

    def full_xy(self):
        xs = (np.arange(self.W) + 0.5) * self.px
        ys = self.h_m - (np.arange(self.H) + 0.5) * self.px
        return np.meshgrid(xs, ys)

def stroke(target, cv, pts, hw, amp, prof='round', op='max', edge=0.25):
    """Variable-width polyline. pts (N,2) metres, hw half-widths (N,) or scalar,
    amp scalar or (N,). prof 'round' | 'flat' | 'mask' | 'vee'. target array (H,W)."""
    pts = np.asarray(pts, np.float32)
    n = len(pts)
    hw = np.broadcast_to(np.asarray(hw, np.float32), (n,))
    amp = np.broadcast_to(np.asarray(amp, np.float32), (n,))
    for i in range(n - 1):
        a, b = pts[i], pts[i + 1]
        wm = max(hw[i], hw[i + 1])
        g = cv.grid(min(a[0], b[0]) - wm, min(a[1], b[1]) - wm, max(a[0], b[0]) + wm, max(a[1], b[1]) + wm)
        if g is None:
            continue
        sl, X, Y = g
        ab = b - a; L2 = float(ab @ ab) + 1e-12
        t = np.clip(((X - a[0]) * ab[0] + (Y - a[1]) * ab[1]) / L2, 0, 1)
        dx = X - (a[0] + t * ab[0]); dy = Y - (a[1] + t * ab[1])
        d = np.sqrt(dx * dx + dy * dy)
        ww = hw[i] + (hw[i + 1] - hw[i]) * t
        A = amp[i] + (amp[i + 1] - amp[i]) * t
        r = d / np.maximum(ww, 1e-6)
        if prof == 'round':
            v = np.sqrt(np.clip(1 - r * r, 0, 1)) * A
        elif prof == 'flat':
            v = np.clip((1 - r) / edge, 0, 1)
            v = (v * v * (3 - 2 * v)) * A
        elif prof == 'vee':
            v = np.clip(1 - r, 0, 1) * A
        else:  # mask with 1px AA
            v = np.clip((ww - d) / cv.px + 0.5, 0, 1) * A
        if op == 'max':
            target[sl] = np.where(r < 1, np.maximum(target[sl], v), target[sl])
        elif op == 'min':
            target[sl] = np.where(r < 1, np.minimum(target[sl], -v), target[sl])
        else:
            target[sl] += v

def dist_to_segments(cv, segs, maxd):
    """Unsigned distance (metres) from every pixel to a set of segments, clamped at maxd."""
    D = np.full((cv.H, cv.W), maxd, np.float32)
    for a, b in segs:
        a = np.asarray(a, np.float32); b = np.asarray(b, np.float32)
        g = cv.grid(min(a[0], b[0]) - maxd, min(a[1], b[1]) - maxd, max(a[0], b[0]) + maxd, max(a[1], b[1]) + maxd)
        if g is None:
            continue
        sl, X, Y = g
        ab = b - a; L2 = float(ab @ ab) + 1e-12
        t = np.clip(((X - a[0]) * ab[0] + (Y - a[1]) * ab[1]) / L2, 0, 1)
        d = np.hypot(X - (a[0] + t * ab[0]), Y - (a[1] + t * ab[1]))
        D[sl] = np.minimum(D[sl], d)
    return D

def poly_mask(cv, poly):
    X, Y = cv.full_xy()
    poly = np.asarray(poly)
    inside = np.zeros(X.shape, bool)
    j = len(poly) - 1
    for i in range(len(poly)):
        xi, yi = poly[i]; xj, yj = poly[j]
        c = ((yi > Y) != (yj > Y)) & (X < (xj - xi) * (Y - yi) / (yj - yi + 1e-12) + xi)
        inside ^= c
        j = i
    return inside

# -------------------------------------------------------------- girih (Hankin)

def _rot(v, a):
    c, s = math.cos(a), math.sin(a)
    return np.array([c * v[0] - s * v[1], s * v[0] + c * v[1]])

def _isect(p, d, q, e):
    m = np.array([[d[0], -e[0]], [d[1], -e[1]]])
    det = np.linalg.det(m)
    if abs(det) < 1e-9:
        return None
    t, _ = np.linalg.solve(m, q - p)
    return p + t * d

def regular_poly(c, n, R, rot=0.0):
    return [np.array([c[0] + R * math.cos(rot + 2 * math.pi * k / n), c[1] + R * math.sin(rot + 2 * math.pi * k / n)]) for k in range(n)]

def hankin(polys, theta_deg):
    """Polygons-in-contact construction. Returns list of segments and list of star centres."""
    th = math.radians(theta_deg)
    segs = []
    for P in polys:
        n = len(P)
        mids = [(P[i] + P[(i + 1) % n]) / 2 for i in range(n)]
        dirs = [(P[(i + 1) % n] - P[i]) / np.linalg.norm(P[(i + 1) % n] - P[i]) for i in range(n)]
        for i in range(n):
            j = (i + 1) % n
            d1 = _rot(dirs[i], th)
            d2 = _rot(-dirs[j], -th)
            X = _isect(mids[i], d1, mids[j], d2)
            if X is None:
                continue
            segs.append((mids[i], X)); segs.append((mids[j], X))
    return segs

def tiling_488(L, x0, y0, x1, y1, phase=(0.0, 0.0)):
    """4.8.8 tiling: octagons on a square lattice of spacing L, squares between.
    Returns (polys, octagon_centres)."""
    R8 = (L / 2) / math.cos(math.pi / 8)
    s = 2 * (L / 2) * math.tan(math.pi / 8)
    polys, cent = [], []
    i0 = int(math.floor((x0 - phase[0]) / L)) - 1; i1 = int(math.ceil((x1 - phase[0]) / L)) + 1
    j0 = int(math.floor((y0 - phase[1]) / L)) - 1; j1 = int(math.ceil((y1 - phase[1]) / L)) + 1
    for i in range(i0, i1 + 1):
        for j in range(j0, j1 + 1):
            c = (phase[0] + i * L, phase[1] + j * L)
            polys.append(regular_poly(c, 8, R8, math.pi / 8)); cent.append(c)
            cs = (c[0] + L / 2, c[1] + L / 2)
            polys.append(regular_poly(cs, 4, s / math.sqrt(2), 0.0))
    return polys, cent

def tiling_4612(s, x0, y0, x1, y1, phase=(0.0, 0.0)):
    """4.6.12 tiling with edge s. Returns (polys, dodecagon_centres)."""
    a12 = s / 2 / math.tan(math.pi / 12)
    D = 2 * a12 + s                      # centre distance between dodecagons
    R12 = s / 2 / math.sin(math.pi / 12)
    R6 = s
    polys, cent = [], []
    e1 = np.array([D, 0.0]); e2 = np.array([D / 2, D * math.sqrt(3) / 2])
    n = int(max(x1 - x0, y1 - y0) / D) + 4
    ph = np.array(phase)
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            c = ph + i * e1 + j * e2
            if not (x0 - D < c[0] < x1 + D and y0 - D < c[1] < y1 + D):
                continue
            polys.append(regular_poly(c, 12, R12, math.pi / 12)); cent.append(tuple(c))
            for e in (e1, e2, e2 - e1):          # squares between neighbours
                m = c + e / 2
                ang = math.atan2(e[1], e[0])
                polys.append(regular_poly(m, 4, s / math.sqrt(2), ang + math.pi / 4))
            for e in ((e1 + e2) / 3, (2 * e2 - e1) / 3):   # hexagons at triangle centroids
                m = c + e
                ang = math.atan2(e[1], e[0])
                polys.append(regular_poly(m, 6, R6, ang + math.pi / 6))
    return polys, cent

def clip_segs(segs, x0, y0, x1, y1, pad=0.0):
    out = []
    for a, b in segs:
        if (min(a[0], b[0]) > x1 + pad or max(a[0], b[0]) < x0 - pad or
                min(a[1], b[1]) > y1 + pad or max(a[1], b[1]) < y0 - pad):
            continue
        out.append((a, b))
    return out

def dedupe(segs, tol=1e-5):
    seen = set(); out = []
    for a, b in segs:
        k1 = (round(a[0] / tol), round(a[1] / tol), round(b[0] / tol), round(b[1] / tol))
        k2 = (k1[2], k1[3], k1[0], k1[1])
        if k1 in seen or k2 in seen:
            continue
        seen.add(k1); out.append((a, b))
    return out

def girih_relief(cv, segs, strap_hw, depth, centres=(), rosette_r=0.0, pillow=0.35, groove=True, petals=8):
    """Carved strapwork: raised flat-topped straps with a centre groove, recessed
    pillowed fields, optional small rosettes in star centres. Returns height (<=0 recess)."""
    D = dist_to_segments(cv, segs, strap_hw * 8)
    px = cv.px
    # strap shoulder: chamfered over ~35% of half width
    s = np.clip((strap_hw - D) / (strap_hw * 0.45), 0, 1)
    s = s * s * (3 - 2 * s)
    # field: pillowed floor rising with distance from strap
    f = np.clip((D - strap_hw) / (strap_hw * 3.5), 0, 1)
    floor = -depth + depth * pillow * np.sqrt(f)
    h = floor * (1 - s)
    if groove:
        g = np.clip(1 - D / (strap_hw * 0.16), 0, 1)
        h -= g * depth * 0.18
    if rosette_r > 0:
        X, Y = cv.full_xy()
        for c in centres:
            g = cv.grid(c[0] - rosette_r, c[1] - rosette_r, c[0] + rosette_r, c[1] + rosette_r)
            if g is None:
                continue
            sl, x, y = g
            dx, dy = x - c[0], y - c[1]
            r = np.hypot(dx, dy) / rosette_r
            a = np.arctan2(dy, dx)
            pet = 0.5 + 0.5 * np.cos(petals * a)
            prof = np.clip(1 - r / (0.55 + 0.45 * pet ** 0.6), 0, 1)
            boss = np.clip(1 - r / 0.28, 0, 1)
            rh = -depth + depth * (0.75 * np.sqrt(prof) + 0.25 * np.sqrt(boss))
            rh = np.where(r < 1, rh, -10)
            h[sl] = np.maximum(h[sl], rh)
    return h, D

# ------------------------------------------------------------- islimi scroll

def _leaf(h, cv, base, direction, L, Wmax, amp, curl=0.25, rib=True):
    d = np.asarray(direction, float); d /= np.linalg.norm(d)
    nrm = np.array([-d[1], d[0]])
    t = np.linspace(0, 1, 28)
    bend = np.sin(t * math.pi * 0.9) * L * curl
    pts = base[None, :] + t[:, None] * L * d[None, :] + (bend * t)[:, None] * nrm[None, :]
    w = Wmax * np.sin(np.clip(t, 0.02, 1) ** 0.65 * math.pi) * (1 - 0.15 * t) + 1e-4
    stroke(h, cv, pts, w, amp, 'round')
    if rib:
        g = np.zeros_like(h)
        stroke(g, cv, pts[3:-4], Wmax * 0.12, amp * 0.35, 'vee')
        h -= g
    return pts

def _palmette(h, cv, c, d, S, amp):
    d = np.asarray(d, float); d /= np.linalg.norm(d)
    _leaf(h, cv, c, d, S, S * 0.28, amp, curl=0.0)
    for s in (-1, 1):
        a = math.atan2(d[1], d[0]) + s * 0.9
        _leaf(h, cv, c, (math.cos(a), math.sin(a)), S * 0.7, S * 0.2, amp * 0.9, curl=-0.5 * s)
    stroke(h, cv, np.array([c, c + d * 1e-4]), S * 0.16, amp, 'round')

def islimi_band(cv, x0, x1, yc, H, wave_len, amp_h, stem_hw, seed=1, leaf_scale=1.0):
    """Floral scroll (islimi): sinusoidal stem, each half-wave sends a log-spiral tendril
    into its hollow ending in a palmette, with small leaves. Height 0..amp_h."""
    h = np.zeros((cv.H, cv.W), np.float32)
    A = H * 0.22
    def stem_y(x):
        return yc + A * np.sin(2 * math.pi * (x - x0) / wave_len)
    xs = np.linspace(x0 - wave_len, x1 + wave_len, int((x1 - x0 + 2 * wave_len) / (stem_hw * 0.7)) + 2)
    stroke(h, cv, np.stack([xs, stem_y(xs)], 1), stem_hw, amp_h, 'round')
    nhw = int((x1 - x0) / (wave_len / 2)) + 4
    for k in range(-2, nhw):
        sgn = 1 if k % 2 == 0 else -1          # +1: crest half-wave (hollow below)
        xa = x0 + k * wave_len / 2
        C = np.array([xa + wave_len * 0.27, yc - sgn * H * 0.11])
        R0 = H * 0.34 * leaf_scale
        phi0 = math.radians(125) * sgn
        turns = 1.15
        t = np.linspace(0, 1, 60)
        phi = phi0 - sgn * t * turns * 2 * math.pi
        r = R0 * np.exp(-1.25 * t * turns)
        pts = np.stack([C[0] + r * np.cos(phi), C[1] + r * np.sin(phi)], 1)
        sx = pts[0, 0] - wave_len * 0.05
        root = np.array([[sx, stem_y(sx)]])
        pts = np.concatenate([root, pts], 0)
        hw = stem_hw * np.concatenate([[0.95], 0.85 - 0.45 * t])
        stroke(h, cv, pts, hw, amp_h * 0.95, 'round')
        # palmette at spiral end, pointing along the last tangent
        e = pts[-1]; d = pts[-1] - pts[-4]
        _palmette(h, cv, e, -d if False else d, H * 0.2 * leaf_scale, amp_h * 0.9)
        # small leaf on the outside of the spiral
        i = 22; p = pts[i]; tg = pts[i + 1] - pts[i - 1]
        out = p - C; out /= np.linalg.norm(out)
        dl = out * 0.8 + tg / np.linalg.norm(tg) * 0.6
        _leaf(h, cv, p, dl, H * 0.2 * leaf_scale, H * 0.055 * leaf_scale, amp_h * 0.85, curl=0.3 * sgn)
        # bud leaf on the stem crest pointing outward (towards band edge)
        xc = xa + wave_len * 0.25
        bp = np.array([xc + wave_len * 0.06, stem_y(xc + wave_len * 0.06)])
        _leaf(h, cv, bp, (0.9, 0.65 * sgn), H * 0.2 * leaf_scale, H * 0.05 * leaf_scale, amp_h * 0.8, curl=-0.35 * sgn)
    return np.clip(h, 0, amp_h * 1.05)

def chip_band(cv, x0, x1, y0, y1, depth, n_per_m=None):
    """Chip-carved band of alternating triangles (pyramidal cuts)."""
    H = y1 - y0
    w = H
    X, Y = cv.full_xy()
    h = np.zeros((cv.H, cv.W), np.float32)
    inband = (X >= x0) & (X <= x1) & (Y >= y0) & (Y <= y1)
    u = (X - x0) / w; v = (Y - y0) / H
    fu = u - np.floor(u)
    # triangles: up-pointing in first half and down in second (sawtooth)
    tri = np.abs(fu - 0.5) * 2               # 0 at centre, 1 at edges
    edge_up = v - (1 - tri)                  # inside up-triangle when v < 1 - tri
    # pyramid depth: distance to triangle border
    d_up = np.minimum(np.minimum(v, 1 - tri - v), 1)
    d_dn = np.minimum(1 - v, v - (1 - tri))
    pyr = np.where(edge_up < 0, d_up, d_dn)
    pyr = np.clip(pyr, 0, 0.5) * 2
    h[inband] = -depth * pyr[inband]
    return h

# ------------------------------------------------------------- material finish

WOOD = dict(col=hexc('664a36'), worn=hexc('94775a'), grime=hexc('22180f'), dust=hexc('8a8070'))

def wood_finish(hc, px, hg=None, vertical=True, seed=0, tone=None, wear=1.0, grime=1.0, dust=0.6,
                src='fine_grained_wood', src_m=0.6, streaks=0.0, ao_k=1.0, rough_base=0.66,
                ph_nrm=0.6, bleach=None):
    """Turn a carving height map (metres) into wood base/orm/normal.
    hg: extra geometry height used only for AO. vertical: grain along image v.
    bleach: optional (H,W) 0..1 map of sun/rain bleaching (greyer, lighter)."""
    H, W = hc.shape
    tone = tone or WOOD
    ang = 0.0 if vertical else math.pi / 2
    rng = np.random.default_rng(seed)
    off = (rng.random(), rng.random())
    ph_col = tile(ph(src, 'col', px, src_m), H, W, ang, off)
    ph_arm = tile(ph(src, 'arm', px, src_m), H, W, ang, off)
    ph_n = tile(ph(src, 'nrm', px, src_m), H, W, ang, off, normal=True)
    lum = ph_col.mean(2, keepdims=True)
    detail = (lum / (lum.mean() + 1e-6)) ** 0.8
    an = (1, 18) if vertical else (18, 1)
    g1 = fbm(H, W, 0.05 / px, 4, seed + 1, an)
    g2 = fbm(H, W, 0.012 / px, 3, seed + 2, an)
    grain = 0.55 * g1 + 0.45 * g2
    col = tone['col'][None, None, :] * (0.72 + 0.5 * grain[..., None]) * detail
    # relief derived terms
    htot = hc + (hg if hg is not None else 0)
    ao = ao_from_height(htot, px) ** ao_k
    cav = cavity(hc, px, 0.003)
    edge = np.clip(cav * 1.2, 0, 1) * wear
    crease = np.clip(-cav * 1.0, 0, 1)
    # local depth below the surrounding top surface
    top = ndi.maximum_filter(hc, size=max(3, int(0.02 / px)))
    depth = np.clip((top - hc) / 0.012, 0, 1)
    col = col * (1 - 0.65 * edge[..., None]) + tone['worn'][None, None, :] * (0.65 * edge[..., None]) * (0.8 + 0.4 * grain[..., None])
    gr = np.clip(depth * 0.7 + crease * 0.5, 0, 1) * grime
    col = col * (1 - gr[..., None] * 0.7) + tone['grime'][None, None, :] * (gr[..., None] * 0.7)
    dpatch = fbm(H, W, 0.08 / px, 3, seed + 3)
    dm = np.clip(depth * 1.3 - 0.25, 0, 1) * np.clip(dpatch * 1.6 - 0.4, 0, 1) * dust
    col = col * (1 - dm[..., None] * 0.45) + tone['dust'][None, None, :] * dm[..., None] * 0.45
    if streaks > 0:
        st = fbm(H, W, 0.03 / px, 3, seed + 4, (1, 25))
        col *= (1 - streaks * np.clip(st - 0.45, 0, 1))[..., None]
    if bleach is not None:
        grey = col.mean(2, keepdims=True)
        b = bleach[..., None]
        col = col * (1 - b) + (grey * 1.35 * np.array([1.0, 0.97, 0.92])) * b
    base = col * (0.45 + 0.55 * ao[..., None])
    rough = rough_base + 0.18 * (ph_arm[..., 1] - 0.5) + 0.12 * (1 - grain) - 0.18 * edge + 0.12 * gr
    rough = np.clip(rough, 0.3, 0.95)
    orm = np.dstack([ao, rough, np.zeros_like(ao)])
    # normals: carving + fine grain relief + PH micro normal
    micro = (g2 - 0.5) * 0.0004
    n = normal_from_height(hc + micro, px)
    n = blend_normals(n, rgb_to_n(ph_n), ph_nrm)
    return np.clip(base, 0, 1), orm, n_to_rgb(n)

def paste(atlas, isl, arr):
    x0, y0, w, h, _ = isl
    atlas[y0:y0 + h, x0:x0 + w] = arr[:h, :w]

def new_atlas(S):
    return (np.zeros((S, S, 3), np.float32) + hexc('6e4e36'), np.dstack([np.ones((S, S)), np.full((S, S), 0.7), np.zeros((S, S))]).astype(np.float32),
            np.dstack([np.full((S, S), 0.5), np.full((S, S), 0.5), np.ones((S, S))]).astype(np.float32))

def dilate_atlas(arrs, used):
    """Bleed island colours into unused atlas pixels (mip/filter safety)."""
    out = []
    idx = ndi.distance_transform_edt(~used, return_distances=False, return_indices=True)
    for a in arrs:
        out.append(a[idx[0], idx[1]])
    return out

def save_set(prefix, base, orm, nrm, q=88):
    save_rgb(base, prefix + '_base.jpg', True, q)
    save_rgb(orm, prefix + '_orm.jpg', False, q)
    save_rgb(nrm, prefix + '_nrm.jpg', False, 92)

def fit(arr, shape):
    """Crop / edge-pad a 2D(+) array to shape[:2]."""
    h, w = shape[:2]
    a = arr[:h, :w]
    ph_, pw = h - a.shape[0], w - a.shape[1]
    if ph_ > 0 or pw > 0:
        pad = [(0, max(ph_, 0)), (0, max(pw, 0))] + [(0, 0)] * (a.ndim - 2)
        a = np.pad(a, pad, mode='edge')
    return a
