#!/usr/bin/env python3
"""DUSHANBE vegetation texture builder.

Builds (all CC0-derived):
  * bark sets   -> dushanbe_city/assets/textures/bark_<name>/{albedo.jpg,normal.png,orm.png}
  * foliage atlases (leaf-cluster cards composited from single leaves of ambientCG
    LeafSets, plus painted flowers) -> assets/textures/foliage_<species>/{albedo.png,normal.png,atlas.json}

Atlas layout: 1024x1024, sprites described in atlas.json as UV rects [u0,v0,u1,v1]
(v down, like glTF/Godot) + 'anchor' (twig base in sprite-local 0..1 coords).

Run:  python3 -I make_textures.py   (paths are absolute, see ROOT)
"""
import json, math, os, random, sys, zlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

ROOT = "/home/user/safarzod"
PROJ = f"{ROOT}/dushanbe_city"
RAW = f"{ROOT}/dushanbe_city_src/raw"
EXT = f"{RAW}/ext"
TEX = f"{PROJ}/assets/textures"
CACHE = f"{ROOT}/dushanbe_city_src/raw/leafcache"

ATLAS = 1024
TILE = 512


# ----------------------------------------------------------------------------- utils
def to8(a):
    return np.clip(a, 0, 255).astype(np.uint8)


def load_rgb(path, size=None):
    im = Image.open(path)
    arr = np.array(im)
    if arr.dtype == np.uint16:
        arr = (arr / 257.0).astype(np.uint8)
    if arr.ndim == 3 and arr.shape[2] == 4:
        arr = arr[..., :3]
    im = Image.fromarray(arr)
    if size:
        im = im.resize(size, Image.LANCZOS)
    return im


def dilate_rgb(rgba):
    """Push colour into transparent texels (prevents dark mip halos)."""
    a = rgba[..., 3:4].astype(np.float32) / 255.0
    rgb = rgba[..., :3].astype(np.float32)
    out = rgb.copy()
    filled = a[..., 0] > 0.02
    acc_rgb = np.zeros_like(rgb)
    acc_w = np.zeros(a.shape[:2], np.float32)
    for sigma in (2, 6, 16, 48):
        w = ndimage.gaussian_filter(a[..., 0], sigma)
        c = np.stack([ndimage.gaussian_filter(rgb[..., i] * a[..., 0], sigma) for i in range(3)], -1)
        m = (acc_w < 1e-3) & (w > 1e-4)
        acc_rgb[m] = c[m] / w[m][:, None]
        acc_w[m] = 1.0
    out[~filled] = acc_rgb[~filled]
    # pixels never reached -> global mean
    if (~filled & (acc_w < 1e-3)).any():
        out[~filled & (acc_w < 1e-3)] = rgb[filled].mean(0)
    res = rgba.copy()
    res[..., :3] = to8(out)
    return res


def rgb_to_hsv(rgb):
    return np.array(Image.fromarray(to8(rgb)).convert("HSV")).astype(np.float32)


# ----------------------------------------------------------------------------- leaves
def extract_leaves(set_id, min_area=1500, max_dim=320):
    """Cut individual leaves out of an ambientCG LeafSet atlas, rotate base->tip upward."""
    os.makedirs(CACHE, exist_ok=True)
    cache = f"{CACHE}/{set_id}.npz"
    if os.path.exists(cache):
        d = np.load(cache, allow_pickle=True)
        return list(d["leaves"])
    col = np.array(Image.open(f"{EXT}/{set_id}/{set_id}_2K-PNG_Color.png").convert("RGB"))
    op = np.array(Image.open(f"{EXT}/{set_id}/{set_id}_2K-PNG_Opacity.png").convert("L"))
    lab, n = ndimage.label(op > 100)
    objs = ndimage.find_objects(lab)
    leaves = []
    for i, sl in enumerate(objs):
        m = lab[sl] == (i + 1)
        if m.sum() < min_area:
            continue
        ys, xs = np.nonzero(m)
        pts = np.stack([xs, ys], 1).astype(np.float64)
        c = pts.mean(0)
        u, s, vt = np.linalg.svd(pts - c, full_matrices=False)
        ax = vt[0]
        t = (pts - c) @ ax
        L = t.max() - t.min()
        lo = (t < t.min() + 0.12 * L).sum()
        hi = (t > t.max() - 0.12 * L).sum()
        if lo > hi:  # base = narrower end
            ax = -ax
        # ax points base -> tip (image coords, y down)
        vx, vy = ax[0], -ax[1]
        ang = math.degrees(math.atan2(vy, vx))
        rot = 90.0 - ang
        rgba = np.zeros(m.shape + (4,), np.uint8)
        rgba[..., :3] = col[sl]
        rgba[..., 3] = np.where(m, op[sl], 0)
        im = Image.fromarray(rgba).rotate(rot, resample=Image.BICUBIC, expand=True)
        bb = im.getbbox()
        im = im.crop(bb)
        s = max_dim / max(im.size)
        if s < 1:
            im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
        arr = np.array(im)
        # base point: bottom-most opaque row centroid
        al = arr[..., 3] > 128
        rows = np.nonzero(al.any(1))[0]
        by = rows.max()
        bx = np.nonzero(al[by])[0].mean()
        leaves.append(np.array([arr, (bx / arr.shape[1], by / arr.shape[0])], dtype=object))
    np.savez_compressed(cache, leaves=np.array(leaves, dtype=object))
    print(f"  {set_id}: {len(leaves)} leaves")
    return leaves


def leaf_quality(leaves):
    """Return weights penalising yellow/brown/damaged leaves."""
    w = []
    hs = []
    for arr, _ in leaves:
        a = arr[..., 3] > 128
        hsv = rgb_to_hsv(arr[..., :3])
        hs.append(np.median(hsv[..., 0][a]))
    med = np.median(hs)
    for h in hs:
        w.append(1.0 if abs(h - med) < 9 else 0.06)
    return np.array(w)


def colour_match(arr, gain):
    out = arr.copy().astype(np.float32)
    out[..., :3] *= gain
    return to8(out)


class Canvas:
    """RGBA + tangent-space normal accumulation canvas (straight alpha, painter's order)."""

    def __init__(self, w, h):
        self.w, self.h = w, h
        self.rgba = np.zeros((h, w, 4), np.float32)
        self.nrm = np.zeros((h, w, 3), np.float32)
        self.nrm[..., 2] = 1.0

    def paste(self, src_rgba, src_nrm, x0, y0):
        """src arrays float32, alpha 0..1."""
        h, w = src_rgba.shape[:2]
        X0, Y0 = int(round(x0)), int(round(y0))
        xa, ya = max(0, X0), max(0, Y0)
        xb, yb = min(self.w, X0 + w), min(self.h, Y0 + h)
        if xa >= xb or ya >= yb:
            return
        s = src_rgba[ya - Y0:yb - Y0, xa - X0:xb - X0]
        sn = src_nrm[ya - Y0:yb - Y0, xa - X0:xb - X0]
        d = self.rgba[ya:yb, xa:xb]
        dn = self.nrm[ya:yb, xa:xb]
        a = s[..., 3:4]
        d[..., :3] = s[..., :3] * a + d[..., :3] * (1 - a)
        d[..., 3:4] = a + d[..., 3:4] * (1 - a)
        dn[...] = sn * a + dn * (1 - a)


def leaf_normals(alpha, fold=0.55, curl=0.25):
    """Fake tangent-space normals for a leaf standing base-down / tip-up: V fold along midrib."""
    h, w = alpha.shape
    a = alpha > 0.3
    n = np.zeros((h, w, 3), np.float32)
    n[..., 2] = 1
    xs = np.arange(w, dtype=np.float32)
    for y in range(h):
        row = np.nonzero(a[y])[0]
        if len(row) < 2:
            continue
        mid = 0.5 * (row.min() + row.max())
        half = max(1.0, 0.5 * (row.max() - row.min()))
        n[y, :, 0] = np.clip((xs - mid) / half, -1, 1) * fold
    yy = np.linspace(-1, 1, h, dtype=np.float32)[:, None]
    n[..., 1] = -yy * curl  # tip curls back
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def transform_leaf(arr, base, length_px, angle_deg, squash, bright, hue_shift, fold=0.55):
    """Scale leaf so its height=length_px, squash width, rotate CCW by angle (0=tip up).
    Returns rgba(float, a 0..1), normal(float), pivot offset (base position inside result)."""
    im = Image.fromarray(arr)
    s = length_px / im.height
    nw = max(2, int(im.width * s * squash))
    nh = max(2, int(im.height * s))
    im = im.resize((nw, nh), Image.LANCZOS)
    a = np.array(im).astype(np.float32) / 255.0
    nrm = leaf_normals(a[..., 3], fold=fold)
    # colour jitter
    rgb = a[..., :3]
    if hue_shift:
        # shift towards yellow (+) or blue-green (-) cheaply
        rgb = rgb * np.array([1 + hue_shift, 1.0, 1 - hue_shift * 0.8], np.float32)
    rgb = np.clip(rgb * bright, 0, 1)
    a[..., :3] = rgb
    # rotate both around the base point: pad so base is centre, then rotate expand
    bx, by = base[0] * nw, base[1] * nh
    pad = int(max(nw, nh) * 1.2) + 4
    big = np.zeros((2 * pad, 2 * pad, 4), np.float32)
    bign = np.zeros((2 * pad, 2 * pad, 3), np.float32)
    bign[..., 2] = 1
    ox, oy = int(pad - bx), int(pad - by)
    big[oy:oy + nh, ox:ox + nw] = a
    bign[oy:oy + nh, ox:ox + nw] = nrm
    r = math.radians(angle_deg)
    # rotate images (PIL per channel on float via mode F)
    def rot(ch):
        return np.array(Image.fromarray(ch).rotate(angle_deg, resample=Image.BILINEAR))
    out = np.stack([rot(big[..., i]) for i in range(4)], -1)
    outn = np.stack([rot(bign[..., i]) for i in range(3)], -1)
    # rotate the normal vectors (x right, y up) CCW
    cx, sx = math.cos(r), math.sin(r)
    nx = outn[..., 0] * cx - outn[..., 1] * sx
    ny = outn[..., 0] * sx + outn[..., 1] * cx
    outn[..., 0], outn[..., 1] = nx, ny
    # crop to content
    m = out[..., 3] > 0.01
    if not m.any():
        return None
    ys, xs = np.nonzero(m)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return out[y0:y1, x0:x1], outn[y0:y1, x0:x1], (pad - x0, pad - y0)


def draw_twig(canvas, pts, w0, w1, color):
    """Draw a tapered twig polyline onto the canvas (opaque)."""
    im = Image.new("RGBA", (canvas.w * 2, canvas.h * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    n = len(pts)
    for i in range(n - 1):
        t = i / max(1, n - 2)
        w = (w0 * (1 - t) + w1 * t) * 2
        c = tuple(int(v) for v in color)
        d.line([(pts[i][0] * 2, pts[i][1] * 2), (pts[i + 1][0] * 2, pts[i + 1][1] * 2)], fill=c + (255,), width=max(1, int(w)))
        r = w / 2
        d.ellipse([pts[i + 1][0] * 2 - r, pts[i + 1][1] * 2 - r, pts[i + 1][0] * 2 + r, pts[i + 1][1] * 2 + r], fill=c + (255,))
    im = im.resize((canvas.w, canvas.h), Image.LANCZOS)
    a = np.array(im).astype(np.float32) / 255.0
    n = np.zeros(a.shape[:2] + (3,), np.float32)
    n[..., 2] = 1
    canvas.paste(a, n, 0, 0)


def curve(p0, ang, length, bend, steps=8, rng=None):
    pts = [p0]
    x, y = p0
    a = ang
    for i in range(steps):
        a += bend / steps + (rng.uniform(-4, 4) if rng else 0)
        x += math.cos(math.radians(a)) * length / steps
        y -= math.sin(math.radians(a)) * length / steps
        pts.append((x, y))
    return pts


def place_leaf(canvas, leaf, pos, length, ang_up, rng, back=False, cfg=None):
    arr, base = leaf
    squash = rng.uniform(*cfg.get("squash", (0.6, 1.0)))
    bright = rng.uniform(*cfg.get("bright", (0.85, 1.1)))
    if back:
        bright *= rng.uniform(0.62, 0.78)
    hue = rng.uniform(-cfg.get("hue", 0.06), cfg.get("hue", 0.06))
    r = transform_leaf(arr, base, length, ang_up, squash, bright, hue, fold=cfg.get("fold", 0.55))
    if r is None:
        return
    rgba, nrm, piv = r
    canvas.paste(rgba, nrm, pos[0] - piv[0], pos[1] - piv[1])


def make_cluster(leaves, weights, cfg, seed, size=TILE):
    """Leaf spray: main twig from bottom centre upward with side twigs; leaves on twig nodes."""
    rng = random.Random(seed)
    S = size
    C = int(size * 1.8)
    cv = Canvas(C, C)
    base = (C * 0.5 + rng.uniform(-0.03, 0.03) * S, C * 0.985)
    twig_col = np.array(cfg.get("twig", (92, 78, 60)))
    p = weights / weights.sum()
    nprng = np.random.default_rng(seed)

    def pick():
        return leaves[nprng.choice(len(leaves), p=p)]

    style = cfg.get("style", "spray")
    jobs = []  # (back, pos, length, angle, leaf)
    twigs = []
    if style == "spray":
        main_len = S * rng.uniform(0.62, 0.78)
        main = curve(base, 90 + rng.uniform(-14, 14), main_len, rng.uniform(-25, 25), 10, rng)
        twigs.append((main, cfg.get("twig_w", 5) * S / 512, 1.2))
        nodes = []
        nside = cfg.get("side_twigs", 4)
        for k in range(nside):
            t = 0.25 + 0.6 * k / max(1, nside - 1) + rng.uniform(-0.05, 0.05)
            i = min(len(main) - 2, int(t * (len(main) - 1)))
            side = 1 if k % 2 == 0 else -1
            p0 = main[i]
            d = math.degrees(math.atan2(-(main[i + 1][1] - p0[1]), main[i + 1][0] - p0[0]))
            ang = d + side * rng.uniform(*cfg.get('side_ang', (32, 62)))
            L = S * rng.uniform(*cfg.get('side_len', (0.18, 0.34))) * (1.1 - 0.4 * t)
            tw = curve(p0, ang, L, -side * rng.uniform(5, 25), 6, rng)
            twigs.append((tw, cfg.get("twig_w", 5) * 0.55 * S / 512, 0.8))
            nodes.append((tw, ang))
        nodes.append((main, 90))
        leaf_len = cfg["leaf_len"] * S
        per = cfg.get("leaves_per_twig", 4)
        for tw, ang in nodes:
            npts = len(tw)
            cnt = per + (2 if tw is main else 0)
            for j in range(cnt):
                t = 0.3 + 0.7 * (j + 0.5) / cnt
                i = min(npts - 1, int(t * (npts - 1)))
                q = tw[i]
                if i < npts - 1:
                    d = math.degrees(math.atan2(-(tw[i + 1][1] - q[1]), tw[i + 1][0] - q[0]))
                else:
                    d = math.degrees(math.atan2(-(q[1] - tw[i - 1][1]), q[0] - tw[i - 1][0]))
                side = 1 if j % 2 == 0 else -1
                a = d + side * rng.uniform(25, 70)
                if j == cnt - 1:
                    a = d + rng.uniform(-12, 12)
                back = rng.random() < cfg.get("back_frac", 0.35)
                jobs.append((back, q, leaf_len * rng.uniform(0.75, 1.15), a - 90, pick()))
    elif style == "fan":  # sprigs fanning from the base (thuja, privet sprigs)
        n = cfg.get("sprigs", 7)
        for k in range(n):
            a = 90 + rng.uniform(-55, 55)
            L = cfg["leaf_len"] * S * rng.uniform(0.75, 1.1)
            off = (base[0] + rng.uniform(-0.08, 0.08) * S, base[1] - rng.uniform(0.0, 0.25) * S)
            back = rng.random() < cfg.get("back_frac", 0.4)
            jobs.append((back, off, L, a - 90, pick()))
    elif style == "pinnate":  # compound leaves fanning (acacia)
        n = cfg.get("compound", 7)
        main = curve(base, 90 + rng.uniform(-8, 8), S * 0.35, rng.uniform(-15, 15), 6, rng)
        twigs.append((main, 4 * S / 512, 1.5))
        for k in range(n):
            q = main[min(len(main) - 1, 2 + k % (len(main) - 2))]
            a = 90 + (k - (n - 1) / 2) * (120 / max(1, n - 1)) + rng.uniform(-10, 10)
            L = cfg["leaf_len"] * S * rng.uniform(0.8, 1.1)
            back = rng.random() < 0.3
            jobs.append((back, q, L, a - 90, pick()))
    # draw: twigs, back leaves, front leaves
    for tw, w0, w1 in twigs:
        draw_twig(cv, tw, w0, w1, twig_col * rng.uniform(0.85, 1.1))
    jobs.sort(key=lambda j: (not j[0], rng.random()))
    for back, q, L, a, leaf in jobs:
        place_leaf(cv, leaf, q, L, a, rng, back=back, cfg=cfg)
    return fit_canvas(cv, base, size)


def _resize_f(ch, w, h):
    return np.array(Image.fromarray(ch.astype(np.float32), mode="F").resize((w, h), Image.BILINEAR))


def fit_canvas(cv, base, size, margin=6):
    """Crop composed cluster to its content and fit it into a size x size tile (no clipped leaves)."""
    m = cv.rgba[..., 3] > 0.02
    ys, xs = np.nonzero(m)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    y1 = max(y1, int(base[1]) + 1)
    bw, bh = x1 - x0, y1 - y0
    sc = min(1.0, (size - 2 * margin) / bw, (size - 2 * margin) / bh)
    w, h = max(1, int(bw * sc)), max(1, int(bh * sc))
    rg = np.stack([_resize_f(cv.rgba[y0:y1, x0:x1, i], w, h) for i in range(4)], -1)
    nr = np.stack([_resize_f(cv.nrm[y0:y1, x0:x1, i], w, h) for i in range(3)], -1)
    out = Canvas(size, size)
    ox = (size - w) // 2
    oy = size - margin - h
    out.rgba[oy:oy + h, ox:ox + w] = np.clip(rg, 0, 1)
    out.nrm[oy:oy + h, ox:ox + w] = nr
    bx = ox + (base[0] - x0) * sc
    by = oy + (base[1] - y0) * sc
    return out, (bx / size, by / size)


def make_mass(leaves, weights, cfg, seed, size=TILE):
    """Dense fully-opaque leaf mass (for inner shells of thuja / hedge)."""
    rng = random.Random(seed)
    cv = Canvas(size, size)
    dark = np.array(cfg.get("mass_bg", (34, 48, 22)), np.float32) / 255.0
    cv.rgba[..., :3] = dark
    cv.rgba[..., 3] = 1
    p = weights / weights.sum()
    nprng = np.random.default_rng(seed)
    n = cfg.get("mass_count", 160)
    for i in range(n):
        leaf = leaves[nprng.choice(len(leaves), p=p)]
        q = (rng.uniform(-0.05, 1.05) * size, rng.uniform(-0.05, 1.1) * size)
        L = cfg.get("mass_len", 0.2) * size * rng.uniform(0.7, 1.2)
        place_leaf(cv, leaf, q, L, rng.uniform(-180, 180), rng, back=rng.random() < 0.5, cfg=cfg)
    cv.rgba[..., 3] = 1
    return cv


# ----------------------------------------------------------------------------- painted flowers
def _noise(h, w, scale, seed):
    r = np.random.default_rng(seed).random((max(2, h // scale), max(2, w // scale))).astype(np.float32)
    return np.array(Image.fromarray(r).resize((w, h), Image.BICUBIC))


def paint_rose(size, seed, base_col):
    """Top/three-quarter view of a garden rose bloom."""
    rng = random.Random(seed)
    SS = 4
    W = size * SS
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = W / 2
    R = W * 0.47
    bc = np.array(base_col, np.float32)
    rings = 6
    for ring in range(rings):
        rr = R * (1 - ring / rings * 0.92)
        npet = 5 + ring
        off = rng.uniform(0, 360)
        shade = 0.72 + 0.35 * ring / rings
        for k in range(npet):
            a = math.radians(off + k * 360 / npet + rng.uniform(-10, 10))
            pr = rr * rng.uniform(0.55, 0.7)
            px, py = c + math.cos(a) * rr * 0.45, c + math.sin(a) * rr * 0.45
            col = np.clip(bc * shade * rng.uniform(0.85, 1.08), 0, 255)
            d.ellipse([px - pr, py - pr * 0.85, px + pr, py + pr * 0.85], fill=tuple(int(v) for v in col) + (255,))
            # petal rim highlight / inner shadow arc
            hl = np.clip(col * 1.25 + 20, 0, 255)
            d.arc([px - pr, py - pr * 0.85, px + pr, py + pr * 0.85], math.degrees(a) - 70, math.degrees(a) + 70,
                  fill=tuple(int(v) for v in hl) + (255,), width=max(1, int(W * 0.008)))
            sh = col * 0.55
            d.arc([px - pr * 0.8, py - pr * 0.7, px + pr * 0.8, py + pr * 0.7], math.degrees(a) + 150, math.degrees(a) + 230,
                  fill=tuple(int(v) for v in sh) + (255,), width=max(1, int(W * 0.012)))
    # spiral centre
    for k in range(40):
        t = k / 40
        a = t * 4 * math.pi
        r = R * 0.18 * (1 - t)
        x, y = c + math.cos(a) * r, c + math.sin(a) * r
        col = bc * (0.45 + 0.3 * t)
        d.ellipse([x - W * 0.02, y - W * 0.02, x + W * 0.02, y + W * 0.02], fill=tuple(int(v) for v in col) + (255,))
    im = im.filter(ImageFilter.GaussianBlur(W * 0.006)).resize((size, size), Image.LANCZOS)
    a = np.array(im).astype(np.float32) / 255.0
    a[..., :3] *= (0.9 + 0.2 * _noise(size, size, 8, seed))[..., None]
    return np.clip(a, 0, 1)


def paint_pompon(size, seed, c_out, c_in):
    """Marigold (Tagetes) double flower head: ruffled pompon, top view."""
    rng = random.Random(seed)
    SS = 4
    W = size * SS
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = W / 2
    R = W * 0.46
    co, ci = np.array(c_out, np.float32), np.array(c_in, np.float32)
    for ring in range(9):
        t = ring / 9
        rr = R * (1 - t * 0.95)
        npet = int(26 - ring * 2)
        for k in range(npet):
            a = math.radians(k * 360 / npet + rng.uniform(-8, 8) + ring * 13)
            pl = R * 0.22 * (1 - t * 0.5)
            px, py = c + math.cos(a) * (rr - pl * 0.6), c + math.sin(a) * (rr - pl * 0.6)
            col = np.clip((co * (1 - t) + ci * t) * rng.uniform(0.8, 1.1), 0, 255)
            pts = []
            for j in range(10):  # ruffled petal blob
                b = j / 10 * 2 * math.pi
                rad = pl * (0.55 + 0.12 * math.sin(b * 5 + rng.uniform(0, 6)))
                pts.append((px + math.cos(b) * rad, py + math.sin(b) * rad * 0.8))
            d.polygon(pts, fill=tuple(int(v) for v in col) + (255,))
            d.line(pts + [pts[0]], fill=tuple(int(v) for v in col * 0.7) + (255,), width=max(1, int(W * 0.004)))
    im = im.resize((size, size), Image.LANCZOS)
    a = np.array(im).astype(np.float32) / 255.0
    a[..., :3] *= (0.85 + 0.25 * _noise(size, size, 6, seed))[..., None]
    return np.clip(a, 0, 1)


def paint_petunia(size, seed, col_main, col_vein):
    """Petunia: 5-lobed funnel flower (face view) with darker veins and pale throat."""
    rng = random.Random(seed)
    SS = 4
    W = size * SS
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = W / 2
    R = W * 0.47
    cm, cv_ = np.array(col_main, np.float32), np.array(col_vein, np.float32)
    pts = []
    for j in range(200):
        b = j / 200 * 2 * math.pi
        rad = R * (0.86 + 0.14 * math.cos(5 * b)) * (1 + 0.03 * math.sin(b * 13))
        pts.append((c + math.cos(b) * rad, c + math.sin(b) * rad))
    d.polygon(pts, fill=tuple(int(v) for v in cm) + (255,))
    for k in range(10):
        b = k / 10 * 2 * math.pi + rng.uniform(-0.1, 0.1)
        d.line([(c, c), (c + math.cos(b) * R * 0.8, c + math.sin(b) * R * 0.8)],
               fill=tuple(int(v) for v in cv_) + (255,), width=int(W * 0.012))
    for k in range(6):
        r = R * (0.35 - k * 0.05)
        col = cv_ * (1 - k / 6) + np.array([235, 220, 120]) * (k / 6) * 0.6
        d.ellipse([c - r, c - r, c + r, c + r], fill=tuple(int(v) for v in col) + (255,))
    im = im.filter(ImageFilter.GaussianBlur(W * 0.004)).resize((size, size), Image.LANCZOS)
    a = np.array(im).astype(np.float32) / 255.0
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32)
    rr = np.hypot(xx - size / 2, yy - size / 2) / (size / 2)
    a[..., :3] *= np.clip(0.75 + 0.35 * rr, 0, 1.1)[..., None]  # throat darker -> funnel depth
    a[..., :3] *= (0.92 + 0.15 * _noise(size, size, 5, seed))[..., None]
    return np.clip(a, 0, 1)


def paint_spike(w, h, seed, col):
    """Salvia splendens raceme: vertical spike of tubular red flowers (side view)."""
    rng = random.Random(seed)
    SS = 4
    W, H = w * SS, h * SS
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    cx = W / 2
    co = np.array(col, np.float32)
    d.line([(cx, H), (cx, H * 0.04)], fill=(70, 90, 40, 255), width=int(W * 0.05))
    n = 22
    for k in range(n):
        t = k / n
        y = H * (0.95 - 0.88 * t)
        side = 1 if k % 2 else -1
        L = W * (0.42 - 0.25 * t) * rng.uniform(0.85, 1.1)
        ang = math.radians(side * rng.uniform(25, 55))
        x2, y2 = cx + math.sin(ang) * L, y - math.cos(ang) * L * 0.9
        c1 = np.clip(co * rng.uniform(0.8, 1.1), 0, 255)
        # calyx (bract) + tube
        d.ellipse([cx - W * 0.09, y - W * 0.11, cx + W * 0.09, y + W * 0.05], fill=tuple(int(v) for v in c1 * 0.75) + (255,))
        d.line([(cx, y), (x2, y2)], fill=tuple(int(v) for v in c1) + (255,), width=int(W * (0.12 - 0.05 * t)))
        d.ellipse([x2 - W * 0.07, y2 - W * 0.06, x2 + W * 0.07, y2 + W * 0.06], fill=tuple(int(v) for v in c1 * 1.05) + (255,))
    im = im.resize((w, h), Image.LANCZOS)
    a = np.array(im).astype(np.float32) / 255.0
    return np.clip(a, 0, 1)


def paint_bud(size, seed, col):
    """Small closed rose bud on short green sepals (side view)."""
    SS = 4
    W = size * SS
    im = Image.new("RGBA", (W, W), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = np.array(col, np.float32)
    d.ellipse([W * 0.32, W * 0.18, W * 0.68, W * 0.72], fill=tuple(int(v) for v in c) + (255,))
    d.ellipse([W * 0.40, W * 0.22, W * 0.62, W * 0.62], fill=tuple(int(v) for v in c * 1.15) + (255,))
    d.polygon([(W * 0.3, W * 0.62), (W * 0.5, W * 0.95), (W * 0.7, W * 0.62)], fill=(60, 88, 40, 255))
    d.line([(W * 0.5, W * 0.95), (W * 0.5, W)], fill=(60, 88, 40, 255), width=int(W * 0.05))
    im = im.resize((size, size), Image.LANCZOS)
    return np.array(im).astype(np.float32) / 255.0


# ----------------------------------------------------------------------------- species
SPECIES = {
    # name: leaf set, target mean colour, cluster config, slot D
    "plane": dict(set="LeafSet010", target=(76, 100, 42),
                  cfg=dict(style="spray", leaf_len=0.27, leaves_per_twig=4, side_twigs=5, side_len=(0.26, 0.4), side_ang=(40, 75), back_frac=0.35,
                           squash=(0.65, 1.0), twig=(105, 98, 84), fold=0.35), slot="cluster"),
    "elm": dict(set="LeafSet001", target=(68, 90, 40),
                cfg=dict(style="spray", leaf_len=0.13, leaves_per_twig=11, side_twigs=7, side_len=(0.28, 0.44), side_ang=(38, 80), back_frac=0.4,
                         squash=(0.55, 1.0), twig=(80, 68, 56), twig_w=4), slot="cluster"),
    "poplar": dict(set="LeafSet004", target=(72, 98, 42),
                   cfg=dict(style="spray", leaf_len=0.17, leaves_per_twig=7, side_twigs=6, side_len=(0.24, 0.4), side_ang=(30, 60), back_frac=0.35,
                            squash=(0.55, 1.0), twig=(100, 96, 82)), slot="cluster"),
    "acacia": dict(set="LeafSet022", target=(92, 112, 48),
                   cfg=dict(style="pinnate", leaf_len=0.55, compound=8, squash=(0.6, 1.0), twig=(90, 80, 66)),
                   slot="cluster", compound=True),
    "mulberry": dict(set="LeafSet024", target=(70, 100, 40),
                     cfg=dict(style="spray", leaf_len=0.25, leaves_per_twig=4, side_twigs=5, back_frac=0.35, side_len=(0.26, 0.4), side_ang=(40, 75),
                              squash=(0.6, 1.0), twig=(110, 98, 80)), slot="cluster"),
    "thuja": dict(set="LeafSet019", target=(52, 76, 34),
                  cfg=dict(style="fan", leaf_len=0.85, sprigs=9, back_frac=0.4, squash=(0.6, 1.0), fold=0.2,
                           mass_count=140, mass_len=0.45, mass_bg=(26, 40, 18)), slot="mass"),
    "privet": dict(set="LeafSet002", target=(58, 84, 36),
                   cfg=dict(style="fan", leaf_len=0.6, sprigs=12, back_frac=0.45, squash=(0.6, 1.0), fold=0.4,
                            mass_count=260, mass_len=0.28, mass_bg=(28, 42, 20)), slot="mass"),
    "lilac": dict(set="LeafSet023", target=(64, 94, 42),
                  cfg=dict(style="spray", leaf_len=0.24, leaves_per_twig=4, side_twigs=5, back_frac=0.35, side_len=(0.26, 0.4), side_ang=(40, 75),
                           squash=(0.6, 1.0), twig=(96, 88, 76)), slot="cluster"),
    "rose": dict(set="LeafSet024", target=(46, 72, 32),
                 cfg=dict(style="spray", leaf_len=0.16, leaves_per_twig=6, side_twigs=6, back_frac=0.35, side_len=(0.26, 0.42), side_ang=(40, 75),
                          squash=(0.6, 1.0), twig=(70, 80, 44), twig_w=4), slot="roses"),
    "flowers": dict(set="LeafSet002", target=(56, 86, 36),
                    cfg=dict(style="fan", leaf_len=0.7, sprigs=9, back_frac=0.4, squash=(0.6, 1.0), fold=0.4),
                    slot="flowers"),
}


def make_compound_leaves(leaflets, weights, n=6, seed=0):
    """Robinia pinnate leaves built from oval leaflets."""
    rng = random.Random(seed)
    p = weights / weights.sum()
    nprng = np.random.default_rng(seed)
    res = []
    for k in range(n):
        H, Wd = 360, 200
        cv = Canvas(Wd, H)
        rach = [(Wd / 2, H - 2), (Wd / 2 + rng.uniform(-8, 8), 6)]
        draw_twig(cv, rach, 2.2, 1.2, (96, 104, 60))
        pairs = rng.randint(5, 7)
        for j in range(pairs):
            t = 0.18 + 0.72 * j / (pairs - 1)
            y = H - 2 - t * (H - 10)
            for side in (-1, 1):
                lf = leaflets[nprng.choice(len(leaflets), p=p)]
                place_leaf(cv, lf, (Wd / 2, y), 62 * rng.uniform(0.85, 1.1), side * rng.uniform(65, 85), rng,
                           cfg=dict(squash=(0.75, 1.0), bright=(0.9, 1.08), hue=0.04, fold=0.3))
        lf = leaflets[nprng.choice(len(leaflets), p=p)]
        place_leaf(cv, lf, (Wd / 2, 14), 60, 0, rng, cfg=dict(squash=(0.8, 1.0), fold=0.3))
        a = np.concatenate([cv.rgba[..., :3], cv.rgba[..., 3:]], -1)
        res.append(np.array([to8(a * 255), (0.5, 1.0)], dtype=object))
    return res


def build_species(name, sp):
    print("species", name)
    leaves = extract_leaves(sp["set"])
    w = leaf_quality(leaves)
    # colour match whole set to target mean (weighted by good leaves)
    good = [l for l, ww in zip(leaves, w) if ww > 0.5]
    px = np.concatenate([l[0][..., :3][l[0][..., 3] > 128] for l in good]).astype(np.float32)
    gain = np.array(sp["target"], np.float32) / px.mean(0)
    leaves = [np.array([colour_match(l[0], gain), l[1]], dtype=object) for l in leaves]
    if sp.get("compound"):
        leaves = make_compound_leaves(leaves, w, n=8, seed=11)
        w = np.ones(len(leaves))
    atlas = Canvas(ATLAS, ATLAS)
    sprites = {}
    for k, (tx, ty) in enumerate([(0, 0), (1, 0), (0, 1)]):
        cv, anchor = make_cluster(leaves, w, sp["cfg"], seed=zlib.crc32(name.encode()) % 1000 + k * 17)
        atlas.paste(np.concatenate([cv.rgba], -1), cv.nrm, tx * TILE, ty * TILE)
        sprites[f"cluster{k}"] = dict(rect=[tx * 0.5, ty * 0.5, tx * 0.5 + 0.5, ty * 0.5 + 0.5], anchor=list(anchor))
    slot = sp["slot"]
    ox, oy = TILE, TILE
    if slot == "cluster":
        cv, anchor = make_cluster(leaves, w, sp["cfg"], seed=zlib.crc32(name.encode()) % 1000 + 99)
        atlas.paste(cv.rgba, cv.nrm, ox, oy)
        sprites["cluster3"] = dict(rect=[0.5, 0.5, 1, 1], anchor=list(anchor))
    elif slot == "mass":
        cv = make_mass(leaves, w, sp["cfg"], seed=5)
        atlas.paste(cv.rgba, cv.nrm, ox, oy)
        sprites["mass"] = dict(rect=[0.5, 0.5, 1, 1], anchor=[0.5, 0.5])
    elif slot == "roses":
        q = TILE // 2
        cols = [(178, 22, 38), (214, 70, 120), (196, 30, 52), (232, 120, 150)]
        for i in range(3):
            fl = paint_rose(q, 40 + i, cols[i])
            nrm = np.zeros(fl.shape[:2] + (3,), np.float32); nrm[..., 2] = 1
            x, y = ox + (i % 2) * q, oy + (i // 2) * q
            atlas.paste(fl, nrm, x, y)
            sprites[f"bloom{i}"] = dict(rect=[x / ATLAS, y / ATLAS, (x + q) / ATLAS, (y + q) / ATLAS], anchor=[0.5, 0.5])
        # bottom-right quarter: two buds
        for i in range(2):
            b = paint_bud(q // 2, 70 + i, cols[i * 2])
            nrm = np.zeros(b.shape[:2] + (3,), np.float32); nrm[..., 2] = 1
            x, y = ox + q + i * (q // 2), oy + q
            atlas.paste(b, nrm, x, y)
            sprites[f"bud{i}"] = dict(rect=[x / ATLAS, y / ATLAS, (x + q // 2) / ATLAS, (y + q // 2) / ATLAS], anchor=[0.5, 1.0])
        b = paint_rose(q // 2, 77, cols[3])
        nrm = np.zeros(b.shape[:2] + (3,), np.float32); nrm[..., 2] = 1
        x, y = ox + q, oy + q + q // 2
        atlas.paste(b, nrm, x, y)
        sprites["bloom3"] = dict(rect=[x / ATLAS, y / ATLAS, (x + q // 2) / ATLAS, (y + q // 2) / ATLAS], anchor=[0.5, 0.5])
    elif slot == "flowers":
        q = TILE // 2
        items = [
            ("marigold0", paint_pompon(q, 1, (232, 128, 18), (250, 186, 40))),
            ("marigold1", paint_pompon(q, 2, (246, 196, 30), (252, 220, 70))),
            ("petunia0", paint_petunia(q, 3, (150, 30, 120), (90, 10, 70))),
            ("petunia1", paint_petunia(q, 4, (196, 46, 92), (120, 16, 50))),
        ]
        for i, (nm, fl) in enumerate(items):
            nrm = np.zeros(fl.shape[:2] + (3,), np.float32); nrm[..., 2] = 1
            x, y = ox + (i % 2) * q, oy + (i // 2) * q
            atlas.paste(fl, nrm, x, y)
            sprites[nm] = dict(rect=[x / ATLAS, y / ATLAS, (x + q) / ATLAS, (y + q) / ATLAS], anchor=[0.5, 0.5])
        # salvia spikes go into the third cluster tile's free right half? -> use a dedicated column in tile (0,1)
        # overwrite tile (0,1) (cluster2) with: left half = cluster leaves (narrow), right half = 2 spikes
        x0, y0 = 0, TILE
        atlas.rgba[y0:y0 + TILE, x0 + TILE // 2:x0 + TILE] = 0
        atlas.nrm[y0:y0 + TILE, x0 + TILE // 2:x0 + TILE] = (0, 0, 1)
        for i in range(2):
            sp_img = paint_spike(TILE // 4, TILE, 90 + i, (206, 24, 22) if i == 0 else (120, 40, 150))
            nrm = np.zeros(sp_img.shape[:2] + (3,), np.float32); nrm[..., 2] = 1
            x = x0 + TILE // 2 + i * (TILE // 4)
            atlas.paste(sp_img, nrm, x, y0)
            sprites[f"spike{i}"] = dict(rect=[x / ATLAS, y0 / ATLAS, (x + TILE // 4) / ATLAS, (y0 + TILE) / ATLAS], anchor=[0.5, 1.0])
        sprites["cluster2"]["rect"] = [0, 0.5, 0.25, 1.0]
        atlas.rgba[y0:y0 + TILE, 0:TILE // 2] = 0
        atlas.nrm[y0:y0 + TILE, 0:TILE // 2] = (0, 0, 1)
        cv, anchor = make_cluster(leaves, w, dict(sp["cfg"], sprigs=5), seed=123, size=TILE)
        small = Image.fromarray(to8(cv.rgba * 255)).resize((TILE // 2, TILE), Image.LANCZOS)
        smalln = np.array(Image.fromarray(to8((cv.nrm * 0.5 + 0.5) * 255)).resize((TILE // 2, TILE), Image.LANCZOS)).astype(np.float32) / 255 * 2 - 1
        atlas.paste(np.array(small).astype(np.float32) / 255, smalln, 0, y0)
        sprites["cluster2"]["anchor"] = list(anchor)
    out = f"{TEX}/foliage_{name}"
    os.makedirs(out, exist_ok=True)
    rgba = to8(atlas.rgba * 255)
    rgba = dilate_rgb(rgba)
    Image.fromarray(rgba).save(f"{out}/albedo.png", optimize=True)
    n = atlas.nrm / np.maximum(1e-4, np.linalg.norm(atlas.nrm, axis=-1, keepdims=True))
    nimg = to8((n * 0.5 + 0.5) * 255)
    Image.fromarray(nimg).save(f"{out}/normal.png", optimize=True)
    cover = (rgba[..., 3] > 128).mean()
    json.dump(dict(size=ATLAS, source=sp["set"], sprites=sprites, coverage=round(float(cover), 3)),
              open(f"{out}/atlas.json", "w"), indent=1)
    print(f"  -> {out} coverage {cover:.2f}")


# ----------------------------------------------------------------------------- bark
BARKS = {
    # name: (src diff, nor, arm, out size, tint gain)
    "bark_plane": ("polyhaven/japanese_sycamore_diff_2k.png", "polyhaven/japanese_sycamore_nor_gl_2k.png",
                   "polyhaven/japanese_sycamore_arm_2k.png", (1024, 2048), (1.0, 1.0, 0.97)),
    "bark_furrowed": ("polyhaven/bark_brown_02_diff_2k.png", "polyhaven/bark_brown_02_nor_gl_2k.png",
                      "polyhaven/bark_brown_02_arm_2k.png", (1024, 1024), (1.0, 1.0, 1.0)),
    "bark_grey": ("polyhaven/tree_bark_03_diff_2k.png", "polyhaven/tree_bark_03_nor_gl_2k.png",
                  "polyhaven/tree_bark_03_arm_2k.png", (1024, 1024), (1.0, 1.0, 1.0)),
    "bark_mulberry": ("polyhaven/bark_platanus_diff_2k.png", "polyhaven/bark_platanus_nor_gl_2k.png",
                      "polyhaven/bark_platanus_arm_2k.png", (1024, 1024), (1.12, 1.08, 1.0)),
}


def build_bark(name, spec):
    d, n, a, size, gain = spec
    out = f"{TEX}/{name}"
    os.makedirs(out, exist_ok=True)
    alb = np.array(load_rgb(f"{RAW}/{d}", size)).astype(np.float32) * np.array(gain)
    Image.fromarray(to8(alb)).save(f"{out}/albedo.jpg", quality=90)
    load_rgb(f"{RAW}/{n}", size).save(f"{out}/normal.png", optimize=True)
    arm = np.array(load_rgb(f"{RAW}/{a}", size))
    arm[..., 2] = 0
    Image.fromarray(arm).save(f"{out}/orm.png", optimize=True)
    print("bark", name)


def build_thuja_bark():
    """Thuja: reuse existing Bark014 (reddish fibrous) with mipmapped import of our own copy."""
    out = f"{TEX}/bark_thuja"
    os.makedirs(out, exist_ok=True)
    src = f"{TEX}/bark"
    Image.open(f"{src}/albedo.jpg").save(f"{out}/albedo.jpg", quality=90)
    Image.open(f"{src}/normal.png").save(f"{out}/normal.png")
    Image.open(f"{src}/orm.png").save(f"{out}/orm.png")


if __name__ == "__main__":
    only = sys.argv[1:]
    for nm, spec in BARKS.items():
        if not only or nm in only or "bark" in only:
            build_bark(nm, spec)
    if not only or "bark" in only:
        build_thuja_bark()
    for nm, sp in SPECIES.items():
        if not only or nm in only:
            build_species(nm, sp)
