#!/usr/bin/env python3
"""Backdrop beyond the playable 600x600 m: a ring of low-cost distant city blocks (boxes with an
impostor facade texture + roofs), distant tree canopies and a mountain horizon (Hissar range to
the north, lower foothills to the south/east) compressed in distance, keeping angular size.
Outputs dushanbe_city/assets/city/backdrop.glb and assets/textures/facade_far/albedo.png."""
import json, math, os, random, sys
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


_HM = None


def terrain_h(x, z):
    """(min, max) height of the coast terrain around (x, z) from the full-extent bake
    (dushanbe_city_src/build/height_full.npy: 8 m grid, +-2400 m); None outside"""
    global _HM
    import numpy as np
    if _HM is None:
        hm = np.load(os.path.join(ROOT, "dushanbe_city_src/build/height_full.npy"))
        _HM = (hm, {"origin": [-2400.0, -2400.0], "step": 8.0})
    hm, meta = _HM
    fx = (x - meta["origin"][0]) / meta["step"]; fz = (z - meta["origin"][1]) / meta["step"]
    if not (0 <= fx < hm.shape[1] - 1 and 0 <= fz < hm.shape[0] - 1):
        return None
    i, j = int(fx), int(fz)
    return float(hm[j:j + 2, i:i + 2].min()), float(hm[j:j + 2, i:i + 2].max())


def far_city(b):
    """Suburbs on the MAINLAND only (north, beyond the playable boundary at ~1050 m): blocks of
    buildings sitting on the terrain, sparser further out. The peninsula itself stays green."""
    PAL = [(0.96, 0.92, 0.82), (0.95, 0.86, 0.74), (0.88, 0.90, 0.86), (0.92, 0.88, 0.84), (0.98, 0.97, 0.94), (0.85, 0.80, 0.72)]
    for gx in range(-16, 17):
        for gz in range(-23, -10):
            cx, cz = gx * 100.0, gz * 100.0
            dist = math.hypot(cx, cz)
            if cz > -1080 or dist > 2350 or rng.random() < 0.2 + (dist - 1100) / 2500:
                continue
            for k in range(rng.randint(2, 4)):
                L = rng.uniform(30, 70); D = rng.uniform(11, 15)
                floors = rng.choice([4, 5, 5, 9, 9, 12])
                Hh = floors * 2.8 + 1.0
                along_x = rng.random() < 0.5
                x = cx + rng.uniform(-30, 30); z = cz + rng.uniform(-30, 30)
                hx, hz = (L / 2, D / 2) if along_x else (D / 2, L / 2)
                hs = [terrain_h(x + sx * hx, z + sz * hz) for sx in (-1, 1) for sz in (-1, 1)]
                if any(h is None for h in hs):
                    continue
                lo = min(h[0] for h in hs); hi = max(h[1] for h in hs)
                if lo < 0.5 or hi - lo > 4.0:
                    continue                       # water / too steep
                t = rng.choice(PAL)
                far_box(b, x - hx, z - hz, x + hx, z + hz, Hh, t, base=lo - 1.0)
            for k in range(rng.randint(4, 10)):
                x = cx + rng.uniform(-50, 50); z = cz + rng.uniform(-50, 50)
                h = terrain_h(x, z)
                if h is None or h[0] < 0.5:
                    continue
                FAR_TREES.append([round(x, 1), round(z, 1), round(rng.uniform(0, 6.28), 2), round(rng.uniform(0.8, 1.3), 2), round(h[0], 2)])


def far_box(b, x0, z0, x1, z1, h, t, base=0.0):
    b.ao_ground = False
    v = h / 11.2   # 4 floors per texture repeat
    top = base + 1.0 + h
    for (p0, p1, L) in (((x0, z1), (x1, z1), x1 - x0), ((x1, z0), (x0, z0), x1 - x0), ((x1, z1), (x1, z0), z1 - z0), ((x0, z0), (x0, z1), z1 - z0)):
        u = L / 12.8
        b.quad("facade_far", (p0[0], base, p0[1]), (p1[0], base, p1[1]), (p1[0], top, p1[1]), (p0[0], top, p0[1]),
               uv=[(0, v), (u, v), (u, 0), (0, 0)], tint=t)
    b.quad("roof_flat", (x0, top, z1), (x1, top, z1), (x1, top, z0), (x0, top, z0), tint=(0.45, 0.44, 0.42))


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
            depth = max(900.0, hmax * 2.8)          # gentler slopes (~35 deg) instead of walls
            qa = (math.sin(aa) * (R + depth), -math.cos(aa) * (R + depth))
            qb = (math.sin(ab) * (R + depth), -math.cos(ab) * (R + depth))
            # front slope (two bands so snow line follows height)
            b.ao_ground = False
            mid = 0.55
            ca, cb = (pa[0] + (qa[0] - pa[0]) * mid, pa[1] + (qa[1] - pa[1]) * mid), (pb[0] + (qb[0] - pb[0]) * mid, pb[1] + (qb[1] - pb[1]) * mid)
            b.quad("mountain", (pa[0], -8, pa[1]), (pb[0], -8, pb[1]), (cb[0], hb * 0.72, cb[1]), (ca[0], ha * 0.72, ca[1]))
            b.quad("mountain", (ca[0], ha * 0.72, ca[1]), (cb[0], hb * 0.72, cb[1]), (qb[0], hb, qb[1]), (qa[0], ha, qa[1]))
    # layers, back to front; haze grows with distance in the shader (aerial perspective)
    ridge(5600, math.radians(-85), math.radians(80), 380, 920, 3, n=700)     # Hissar range, snow (north)
    ridge(6000, math.radians(-130), math.radians(-70), 250, 620, 5, n=300)   # north-west range
    ridge(3700, math.radians(-95), math.radians(95), 160, 560, 4, n=600)     # middle range
    ridge(2550, math.radians(-75), math.radians(75), 70, 240, 6, n=500)      # foothills behind the mainland
    ridge(4800, math.radians(95), math.radians(265), 30, 210, 8, n=600)      # low hills across the sea (south)
    ridge(4300, math.radians(70), math.radians(115), 40, 260, 9, n=200)      # east shore
    ridge(4300, math.radians(245), math.radians(290), 40, 240, 10, n=200)    # west shore


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
