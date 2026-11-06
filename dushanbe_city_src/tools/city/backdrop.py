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


def _vn(x, z, freq, seed):
    """value noise (numpy, smooth, non-periodic over the mountain ring)"""
    import numpy as np
    x = np.asarray(x) * freq; z = np.asarray(z) * freq
    xi = np.floor(x); zi = np.floor(z)
    fx = x - xi; fz = z - zi
    fx = fx * fx * fx * (fx * (fx * 6 - 15) + 10); fz = fz * fz * fz * (fz * (fz * 6 - 15) + 10)
    def h(i, j):
        n = (i.astype(np.int64) * 374761393 + j.astype(np.int64) * 668265263 + seed * 2147483647) & 0xffffffff
        n = ((n ^ (n >> 13)) * 1274126177) & 0xffffffff
        return ((n ^ (n >> 16)) & 0xffff) / 65535.0
    a = h(xi, zi); b = h(xi + 1, zi); c = h(xi, zi + 1); d = h(xi + 1, zi + 1)
    return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz


def ridged(x, z, freq, seed, oct=6):
    """ridged multifractal: sharp crests, branching spurs and valleys; detail weighted by the
    previous octave so crests are rough and valley floors smooth"""
    import numpy as np
    v = np.zeros_like(np.asarray(x, float)); w = np.ones_like(v); amp = 1.0; tot = 0.0
    # domain warp: no straight ridge lines
    wx = x + (_vn(x, z, freq * 0.7, seed + 91) - 0.5) * 0.9 / freq
    wz = z + (_vn(x, z, freq * 0.7, seed + 92) - 0.5) * 0.9 / freq
    for o in range(oct):
        n = 1.0 - np.abs(_vn(wx, wz, freq, seed + o) * 2.0 - 1.0)
        n = n * n * w
        w = np.clip(n * 1.6, 0, 1)
        v += n * amp; tot += amp
        amp *= 0.5; freq *= 2.03
    return v / tot


def _ss(a, b, x):
    import numpy as np
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def mountain_height(x, z):
    """Height field of the mountain ring around the peninsula (world metres).
    North: foothills (2.6-3.6 km, 80-250 m) -> middle range (3.8-5 km, 300-650 m) -> snowy main
    range (5.5-8 km, 0.8-1.3 km, Hissar-like, compressed in distance keeping the angular size).
    South/east/west across the sea: low dry hills (4-6 km, 100-350 m). Inside the playable terrain
    square (+-2400 m) the field stays under the baked terrain and joins its edge height."""
    import numpy as np
    r = np.hypot(x, z)
    az = np.degrees(np.arctan2(x, -z))                    # 0 = north, +-180 = south
    north = _ss(115.0, 70.0, np.abs(az))                   # 1 in the northern half
    # irregular range fronts (not circles)
    jr = (_vn(az, 0 * az, 1 / 35.0, 7) - 0.5) * 900.0
    rr = r + jr
    M = ridged(x, z, 1 / 2600.0, 11)
    Mf = ridged(x, z, 1 / 1100.0, 21, 5)
    foot = 170.0 * _ss(2500.0, 3400.0, rr) * (0.45 + 0.9 * Mf)
    mid = 380.0 * _ss(3500.0, 4900.0, rr) * (0.3 + 1.0 * M)
    main = 820.0 * _ss(5000.0, 6800.0, rr) * (0.3 + 1.0 * M * M)
    hN = foot + mid + main
    hS = 300.0 * _ss(3600.0, 5600.0, rr) * (0.3 + 1.0 * Mf) + 120.0 * _ss(5200.0, 7000.0, rr) * M
    h = hN * north + hS * (1.0 - north) - 18.0 * (1.0 - north) * (1.0 - _ss(3400.0, 4400.0, rr))
    # join the baked terrain at the edge of its square, stay below it inside
    if _HM is None:
        terrain_h(0.0, 0.0)
    hm, meta = _HM
    E = 2400.0
    cx = np.clip(x, -E + 8, E - 8); cz = np.clip(z, -E + 8, E - 8)
    fx = (cx - meta["origin"][0]) / meta["step"]; fz = (cz - meta["origin"][1]) / meta["step"]
    i = np.clip(fx.astype(int), 0, hm.shape[1] - 2); j = np.clip(fz.astype(int), 0, hm.shape[0] - 2)
    u = fx - i; v = fz - j
    T = hm[j, i] * (1 - u) * (1 - v) + hm[j, i + 1] * u * (1 - v) + hm[j + 1, i] * (1 - u) * v + hm[j + 1, i + 1] * u * v
    dout = np.maximum(np.abs(x) - E, np.abs(z) - E)       # >0 outside the terrain square
    T = np.maximum(T, -16.0)
    h = np.where(dout <= 0, T - 2.5, T + (np.maximum(h, T) - T) * _ss(0.0, 700.0, dout))
    return h


def mountains(nodes):
    """Mountain ring as a smooth-shaded height field on a polar grid (r 2.35-8.8 km), split into
    16 azimuth sectors (frustum culling; Godot generates mesh LODs per sector on import)."""
    import numpy as np
    NA = 896                                         # 0.31 deg
    R0, R1 = 2350.0, 8800.0
    rs = R0 * (R1 / R0) ** (np.linspace(0, 1, 80) ** 1.0)   # geometric: ~35 m near, ~330 m far
    SECT = 16
    per = NA // SECT
    tris = 0
    for s in range(SECT):
        a = np.radians(np.linspace(s * 360.0 / SECT, (s + 1) * 360.0 / SECT, per + 1)) - math.pi
        A, Rr = np.meshgrid(a, rs)                   # rows = radius
        X = np.sin(A) * Rr; Z = -np.cos(A) * Rr
        Hh = mountain_height(X, Z)
        # rows fully under the terrain square and its edge are skipped (hidden anyway)
        keep_row = [k for k in range(len(rs)) if (np.maximum(np.abs(X[k]), np.abs(Z[k])) > 2300).any()]
        k0 = max(0, keep_row[0] - 1)
        X, Z, Hh = X[k0:], Z[k0:], Hh[k0:]
        nr, nc = Hh.shape
        P = np.stack([X, Hh, Z], -1)
        # smooth normals from the grid
        dx = np.gradient(P, axis=1); dr = np.gradient(P, axis=0)
        N = np.cross(dr, dx)
        N = N / np.maximum(np.linalg.norm(N, axis=-1, keepdims=True), 1e-9)
        N[N[..., 1] < 0] *= -1
        m = mk.Mesh()
        m.pos = [tuple(p) for p in P.reshape(-1, 3)]
        m.nrm = [tuple(n) for n in N.reshape(-1, 3)]
        m.uv = [(float(p[0]) / 50.0, float(p[2]) / 50.0) for p in P.reshape(-1, 3)]
        # vertex colour: R = cavity/ridge (curvature) for darker gullies, G = far mask unused
        lap = np.zeros_like(Hh)
        lap[1:-1, 1:-1] = (Hh[:-2, 1:-1] + Hh[2:, 1:-1] + Hh[1:-1, :-2] + Hh[1:-1, 2:] - 4 * Hh[1:-1, 1:-1])
        cav = np.clip(0.5 + lap / 60.0, 0, 1)
        m.col = [(float(c), 1.0, 1.0) for c in cav.reshape(-1)]
        idx = []
        for k in range(nr - 1):
            for c in range(nc - 1):
                i0 = k * nc + c; i1 = i0 + 1; i2 = i0 + nc; i3 = i2 + 1
                if Hh[k, c] < -10 and Hh[k + 1, c + 1] < -10 and Hh[k, c + 1] < -10 and Hh[k + 1, c] < -10:
                    continue                          # deep under the sea
                idx += [i0, i1, i2, i1, i3, i2]
        m.idx = idx
        tris += len(idx) // 3
        nodes.append(("mountains_%02d" % s, {"mountain": m}))
    return tris


def main():
    facade_texture()
    b = mk.Builder()
    far_city(b)
    nodes = [("far_city", b.meshes)]
    mt = mountains(nodes)
    import json
    json.dump(FAR_TREES, open(os.path.join(GAME, "data/city/backdrop_trees.json"), "w"))
    mk.write_glb(os.path.join(GAME, "assets/city/backdrop.glb"), nodes)
    print("backdrop tris", sum(b.stats().values()), "mountains", mt)


if __name__ == "__main__":
    main()
