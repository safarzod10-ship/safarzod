#!/usr/bin/env python3
"""Backdrop beyond the playable 600x600 m: a ring of low-cost distant city blocks (boxes with an
impostor facade texture + roofs), distant tree canopies and a mountain horizon (Hissar range to
the north, lower foothills to the south/east) compressed in distance, keeping angular size.
Outputs dushanbe_city/assets/city/backdrop.glb and assets/textures/facade_far/albedo.png."""
import math, os, random, sys
sys.path.insert(0, os.path.dirname(__file__))
import meshkit as mk
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
GAME = os.path.join(ROOT, "dushanbe_city")
rng = random.Random(5)
FAR_TREES = []


def facade_texture():
    """512x512 = 4 bays x 4 floors (bay 3.2 m, floor 2.8 m) light facade with windows."""
    S = 512
    im = Image.new("RGB", (S, S), (236, 232, 222))
    d = ImageDraw.Draw(im)
    bw, fh = S // 4, S // 4
    for fy in range(4):
        for bx in range(4):
            x0, y0 = bx * bw, fy * fh
            if bx == 1:   # balcony column
                d.rectangle([x0 + 18, y0 + 30, x0 + bw - 18, y0 + fh - 6], fill=(200, 205, 205))
                d.rectangle([x0 + 22, y0 + 34, x0 + bw - 22, y0 + 74], fill=(70, 82, 95))
            else:
                g = rng.randint(55, 85)
                d.rectangle([x0 + 34, y0 + 36, x0 + bw - 34, y0 + 92], fill=(g, g + 8, g + 18))
                d.line([x0 + bw // 2, y0 + 36, x0 + bw // 2, y0 + 92], fill=(225, 225, 225), width=3)
                d.rectangle([x0 + 30, y0 + 92, x0 + bw - 30, y0 + 96], fill=(180, 180, 180))
        d.line([0, y0 + fh - 1, S, y0 + fh - 1], fill=(205, 200, 190), width=2)
    im = im.filter(ImageFilter.GaussianBlur(0.8))
    os.makedirs(os.path.join(GAME, "assets/textures/facade_far"), exist_ok=True)
    im.save(os.path.join(GAME, "assets/textures/facade_far/albedo.png"))


def far_city(b):
    """Blocks of buildings from 330 to 1100 m, sparser further out."""
    PAL = [(0.96, 0.92, 0.82), (0.95, 0.86, 0.74), (0.88, 0.90, 0.86), (0.92, 0.88, 0.84), (0.98, 0.97, 0.94), (0.85, 0.80, 0.72)]
    for gx in range(-11, 12):
        for gz in range(-11, 12):
            cx, cz = gx * 100.0, gz * 100.0
            if max(abs(cx), abs(cz)) < 360:
                continue
            dist = math.hypot(cx, cz)
            if dist > 1150 or rng.random() < 0.15 + dist / 3000:
                continue
            for k in range(rng.randint(2, 4)):
                L = rng.uniform(30, 80); D = rng.uniform(11, 15)
                floors = rng.choice([4, 5, 5, 5, 9, 9, 12, 16]) if dist < 800 else rng.choice([5, 9, 9, 12])
                Hh = floors * 2.8 + 1.0
                along_x = rng.random() < 0.5
                x = cx + rng.uniform(-30, 30); z = cz + rng.uniform(-30, 30)
                hx, hz = (L / 2, D / 2) if along_x else (D / 2, L / 2)
                t = rng.choice(PAL)
                far_box(b, x - hx, z - hz, x + hx, z + hz, Hh, t)
            # tree canopies between blocks (dark-green lumps) — Dushanbe is very green from afar
            for k in range(rng.randint(6, 14)):
                x = cx + rng.uniform(-50, 50); z = cz + rng.uniform(-50, 50)
                FAR_TREES.append([round(x, 1), round(z, 1), round(rng.uniform(0, 6.28), 2), round(rng.uniform(0.8, 1.3), 2)])


def far_box(b, x0, z0, x1, z1, h, t):
    b.ao_ground = False
    v = h / 11.2   # 4 floors per texture repeat
    for (p0, p1, L) in (((x0, z1), (x1, z1), x1 - x0), ((x1, z0), (x0, z0), x1 - x0), ((x1, z1), (x1, z0), z1 - z0), ((x0, z0), (x0, z1), z1 - z0)):
        u = L / 12.8
        b.quad("facade_far", (p0[0], 0, p0[1]), (p1[0], 0, p1[1]), (p1[0], h, p1[1]), (p0[0], h, p0[1]),
               uv=[(0, v), (u, v), (u, 0), (0, 0)], tint=t)
    b.quad("roof_flat", (x0, h, z1), (x1, h, z1), (x1, h, z0), (x0, h, z0), tint=(0.45, 0.44, 0.42))


def lump(b, x, z, r, h):
    seg = 6
    top = (x, h, z)
    mid = []
    for i in range(seg):
        a = 2 * math.pi * i / seg + rng.uniform(-0.2, 0.2)
        rr = r * rng.uniform(0.8, 1.1)
        mid.append((x + math.cos(a) * rr, h * 0.55, z + math.sin(a) * rr))
    g = rng.uniform(0.75, 1.1)
    t = (0.17 * g, 0.27 * g, 0.10 * g)
    for i in range(seg):
        a, c = mid[i], mid[(i + 1) % seg]
        b.tri("canopy_far", top, c, a, tint=t)
        b.tri("canopy_far", a, c, (c[0], h * 0.2, c[2]), tint=[v * 0.7 for v in t])
        b.tri("canopy_far", a, (c[0], h * 0.2, c[2]), (a[0], h * 0.2, a[2]), tint=[v * 0.7 for v in t])


def mountains(b):
    """Ridge ring: north (Hissar range, snow-capped) high, south/east lower foothills.
    Real range: 15-25 km away, 3-4.5 km high (~7-9 deg). Placed at R=2.6-3.4 km with heights
    giving similar angular size."""
    def ridge(R, a0, a1, hmin, hmax, seed, n=520, snow=True):
        r = random.Random(seed)
        # fractal profile
        pts = [r.random() for _ in range(23)]
        prof = []
        for i in range(n + 1):
            t = i / n
            v = 0.0
            amp = 1.0
            for o in range(7):
                f = 2 ** o
                k = t * (len(pts) - 1) * f
                i0 = int(k) % (len(pts) - 1)
                fr = k - int(k)
                fr = fr * fr * (3 - 2 * fr)
                v += amp * (pts[i0] * (1 - fr) + pts[i0 + 1] * fr)
                amp *= 0.5
            prof.append(v)
        lo, hi = min(prof), max(prof)
        for i in range(n):
            ta, tb = i / n, (i + 1) / n
            aa, ab = a0 + (a1 - a0) * ta, a0 + (a1 - a0) * tb
            edge = lambda t: math.sin(math.pi * t) ** 0.35
            ha = hmin + (hmax - hmin) * (prof[i] - lo) / (hi - lo + 1e-9) * edge(ta)
            hb = hmin + (hmax - hmin) * (prof[i + 1] - lo) / (hi - lo + 1e-9) * edge(tb)
            # direction: azimuth from north (-Z), clockwise to east (+X)
            pa = (math.sin(aa) * R, -math.cos(aa) * R)
            pb = (math.sin(ab) * R, -math.cos(ab) * R)
            qa = (math.sin(aa) * (R + 900), -math.cos(aa) * (R + 900))
            qb = (math.sin(ab) * (R + 900), -math.cos(ab) * (R + 900))
            # front slope (two bands so snow line follows height)
            b.ao_ground = False
            mid = 0.55
            ca, cb = (pa[0] + (qa[0] - pa[0]) * mid, pa[1] + (qa[1] - pa[1]) * mid), (pb[0] + (qb[0] - pb[0]) * mid, pb[1] + (qb[1] - pb[1]) * mid)
            b.quad("mountain", (pa[0], -5, pa[1]), (pb[0], -5, pb[1]), (cb[0], hb * 0.72, cb[1]), (ca[0], ha * 0.72, ca[1]))
            b.quad("mountain", (ca[0], ha * 0.72, ca[1]), (cb[0], hb * 0.72, cb[1]), (qb[0], hb, qb[1]), (qa[0], ha, qa[1]))
    ridge(3200, math.radians(-75), math.radians(70), 180, 680, 3)    # Hissar range (north)
    ridge(3600, math.radians(-110), math.radians(-60), 90, 420, 4)   # north-west
    ridge(2900, math.radians(100), math.radians(250), 40, 220, 8)    # southern foothills
    ridge(3000, math.radians(60), math.radians(105), 40, 200, 9)     # east


def main():
    facade_texture()
    b = mk.Builder()
    far_city(b)
    m = mk.Builder()
    mountains(m)
    import json
    json.dump(FAR_TREES, open(os.path.join(GAME, "data/city/backdrop_trees.json"), "w"))
    mk.write_glb(os.path.join(GAME, "assets/city/backdrop.glb"), [("far_city", b.meshes), ("mountains", m.meshes)])
    print("backdrop tris", sum(b.stats().values()), "mountains", sum(m.stats().values()))


if __name__ == "__main__":
    main()
