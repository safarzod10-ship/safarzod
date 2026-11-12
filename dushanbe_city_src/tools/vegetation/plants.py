#!/usr/bin/env python3
"""DUSHANBE procedural thuja, hedge, rose bush, flower-bed clumps and grass clumps -> GLB.

Usage: python3 -I plants.py [asset_id ...]
"""
import json, math, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vegmesh import MeshBuilder, normalize, any_perp, load_atlas  # noqa: E402
from trees import TEX, OUT, UP, seed_of, far_mesh  # noqa: E402

REPORT = "/home/user/safarzod/dushanbe_city_src/tools/vegetation/build_report_plants.json"


def rect_sub(rect, a, b, c, d):
    u0, v0, u1, v1 = rect
    return [u0 + (u1 - u0) * a, v0 + (v1 - v0) * b, u0 + (u1 - u0) * c, v0 + (v1 - v0) * d]


def shell_lathe(mb, mat, rect, profile, y0, y1, around, rings, rng, ao_fn, sway_fn, patches=(6, 4), noise=0.08):
    """Leaf-mass shell: surface of revolution split into UV patches each mapping the whole mass sprite."""
    pa, pr = patches
    for ia in range(pa):
        for ir in range(pr):
            P, N, T, UV, C = [], [], [], [], []
            na = max(2, around // pa)
            nr = max(2, rings // pr)
            for jr in range(nr + 1):
                t = (ir + jr / nr) / pr
                y = y0 + (y1 - y0) * t
                for ja in range(na + 1):
                    a = 2 * math.pi * (ia + ja / na) / pa
                    rr = profile(t) * (1 + noise * math.sin(3 * a + 5 * t) * math.cos(2 * a - 3 * t))
                    p = np.array([math.cos(a) * rr, y, math.sin(a) * rr])
                    P.append(p)
                    dr = (profile(min(1, t + 0.02)) - profile(max(0, t - 0.02))) / (0.04 * (y1 - y0))
                    n = normalize(np.array([math.cos(a), -dr, math.sin(a)]))
                    N.append(n)
                    T.append([-math.sin(a), 0, math.cos(a), 1])
                    UV.append((rect[0] + (rect[2] - rect[0]) * ja / na, rect[1] + (rect[3] - rect[1]) * (1 - jr / nr)))
                    C.append((ao_fn(p), 0.0, rng.random(), sway_fn(p)))
            I = []
            w = na + 1
            for jr in range(nr):
                for ja in range(na):
                    a0 = jr * w + ja; a1 = a0 + 1; b0 = a0 + w; b1 = b0 + 1
                    I += [a0, a1, b0, a1, b1, b0]
            mb.surf(mat).add(P, N, T, UV, C, I)


# ============================================================================ thuja
THUJA = {
    "thuja_cone": dict(H=5.6, R=1.25, stems=3, cards0=950, cards1=210, card=0.85, seed="thuja_cone",
                       profile=lambda t: 1.25 * (0.55 + 0.45 * math.sin(min(1, t / 0.3) * math.pi / 2)) * (1 - t) ** 0.85 + 0.05),
    "thuja_oval": dict(H=3.4, R=1.15, stems=4, cards0=760, cards1=180, card=0.75, seed="thuja_oval",
                       profile=lambda t: 1.15 * math.sqrt(max(0.0, 1 - ((t - 0.45) / 0.55) ** 2)) * (0.75 + 0.25 * min(1, t / 0.2)) + 0.05),
}


def build_thuja(tid):
    cfg = THUJA[tid]
    rng = np.random.default_rng(seed_of(cfg["seed"]))
    H = cfg["H"]
    sprites = load_atlas(TEX, "thuja")
    mass = sprites["mass"]["rect"]
    names = [k for k in sprites if k.startswith("cluster")]
    y0 = 0.25
    prof = lambda t: cfg["profile"](t) * 0.82
    mat = "foliage_thuja"

    def ao_fn(p):
        t = (p[1] - y0) / (H - y0)
        return 0.55 + 0.25 * t

    def sway_fn(p):
        return min(1.0, max(0.0, p[1]) / H) ** 1.5 * 0.6

    def stems(mb, sides):
        for k in range(cfg["stems"]):
            az = 2 * math.pi * k / cfg["stems"] + rng.uniform(-0.4, 0.4)
            pts = [np.array([0.0, 0.0, 0.0])]
            for y in np.linspace(0.3, H * 0.55, 4):
                off = 0.06 + 0.12 * y / H
                pts.append(np.array([math.cos(az) * off, y, math.sin(az) * off]))
            pts = np.array(pts)
            rad = np.linspace(0.07, 0.025, len(pts)) * (1.4 if k == 0 else 1.0)
            cols = np.array([[0.6, 0, rng.random(), 0]] * len(pts))
            mb.tube("bark_thuja", pts, rad, sides, uv_scale=(0.3, 0.8), colors=cols)

    def cards(mb, n, size, jit):
        for i in range(n):
            t = rng.random() ** 0.85
            y = y0 + (H - y0) * t
            a = rng.uniform(0, 2 * math.pi)
            rr = cfg["profile"](t) * rng.uniform(0.72, 1.0)
            p = np.array([math.cos(a) * rr, y, math.sin(a) * rr])
            out = normalize(np.array([math.cos(a), 0.35 + 0.8 * t ** 3, math.sin(a)]))
            u = normalize(UP * 1.0 + out * 0.45 + rng.normal(size=3) * 0.25)
            nb = normalize(out - u * np.dot(out, u))
            ang = rng.uniform(-1.2, 1.2)  # platycladus: sprays in near-vertical planes, any azimuth
            side = np.cross(u, nb)
            nn = normalize(nb * math.cos(ang) + side * math.sin(ang))
            right = np.cross(u, nn)
            s = size * rng.uniform(1 - jit, 1 + jit) * (0.75 + 0.35 * (1 - t))
            sp = sprites[names[rng.integers(len(names))]]
            center = p - u * s * 0.35
            surf = mb.surf(mat)
            mb.card(mat, center, right * s, u * s, sp["rect"], anchor=sp["anchor"],
                    normals=lambda q: normalize(np.array([q[0], (q[1] - H * 0.45) * 0.35, q[2]]) + nn * 0.2))
            Pc = surf.P[-1]
            rn = np.hypot(Pc[:, 0], Pc[:, 2]) / np.maximum(0.1, np.array([cfg["profile"](min(1, max(0, (q[1] - y0) / (H - y0)))) for q in Pc]))
            ao = np.clip(0.45 + 0.55 * np.clip(rn - 0.55, 0, 0.5) / 0.5, 0, 1) * (0.85 + 0.15 * t)
            fl = np.clip(np.linalg.norm(Pc - p, axis=1) / s, 0, 1)
            surf.C[-1] = np.column_stack([ao, 0.15 + 0.5 * fl, np.full(len(Pc), rng.random()),
                                          [sway_fn(q) for q in Pc]]).astype(np.float32)

    lod0 = MeshBuilder()
    stems(lod0, 6)
    shell_lathe(lod0, mat, mass, lambda t: prof(t), y0, H * 0.97, 24, 12, rng, ao_fn, sway_fn, patches=(6, 4))
    cards(lod0, cfg["cards0"], cfg["card"], 0.25)
    lod1 = MeshBuilder()
    stems(lod1, 4)
    shell_lathe(lod1, mat, mass, lambda t: prof(t) * 1.02, y0, H * 0.97, 12, 6, rng, ao_fn, sway_fn, patches=(3, 2))
    cards(lod1, cfg["cards1"], cfg["card"] * 1.6, 0.2)
    return finish(tid, lod0, lod1, far=True, extra=dict(trunk_radius=0.08, species="thuja"))


# ============================================================================ hedge
def build_hedge(tid="hedge_privet", L=2.0, Wd=0.6, Hh=0.9):
    rng = np.random.default_rng(seed_of(tid))
    sprites = load_atlas(TEX, "privet")
    mass = sprites["mass"]["rect"]
    names = [k for k in sprites if k.startswith("cluster")]
    mat = "foliage_privet"
    mb = MeshBuilder()
    hx, hz = L / 2, Wd / 2
    bev = 0.08

    def face(P4, n, nu, nv, ao):
        # grid patch over quad corners P4 (p00,p10,p01,p11) with each patch ~0.5 m mapping whole mass sprite
        p00, p10, p01, p11 = [np.array(p, float) for p in P4]
        for iu in range(nu):
            for iv in range(nv):
                Pq, UV, I = [], [], []
                for a, b in ((0, 0), (1, 0), (0, 1), (1, 1)):
                    s, t = (iu + a) / nu, (iv + b) / nv
                    p = (p00 * (1 - s) + p10 * s) * (1 - t) + (p01 * (1 - s) + p11 * s) * t
                    Pq.append(p)
                    UV.append((mass[0] + (mass[2] - mass[0]) * a, mass[1] + (mass[3] - mass[1]) * (1 - b)))
                C = [(ao(p), 0.0, rng.random(), 0.15 * p[1] / Hh) for p in Pq]
                T = [list(normalize(p10 - p00)) + [1]] * 4
                N = [normalize(np.asarray(n) + np.array([0, 0.25, 0]) * (p[1] / Hh)) for p in Pq]
                mb.surf(mat).add(Pq, N, T, UV, C, [0, 2, 1, 1, 2, 3])

    ao_side = lambda p: 0.45 + 0.5 * min(1, p[1] / Hh)
    # long sides (z = +/-), top, bevel strips, end caps
    face([(-hx, 0.02, hz), (hx, 0.02, hz), (-hx, Hh - bev, hz), (hx, Hh - bev, hz)], (0, 0, 1), 4, 2, ao_side)
    face([(hx, 0.02, -hz), (-hx, 0.02, -hz), (hx, Hh - bev, -hz), (-hx, Hh - bev, -hz)], (0, 0, -1), 4, 2, ao_side)
    face([(-hx, Hh - bev, hz), (hx, Hh - bev, hz), (-hx, Hh, hz - bev), (hx, Hh, hz - bev)], (0, 0.7, 0.7), 4, 1, lambda p: 0.95)
    face([(hx, Hh - bev, -hz), (-hx, Hh - bev, -hz), (hx, Hh, -hz + bev), (-hx, Hh, -hz + bev)], (0, 0.7, -0.7), 4, 1, lambda p: 0.95)
    face([(-hx, Hh, hz - bev), (hx, Hh, hz - bev), (-hx, Hh, -hz + bev), (hx, Hh, -hz + bev)], (0, 1, 0), 4, 1, lambda p: 1.0)
    face([(hx, 0.02, hz), (hx, 0.02, -hz), (hx, Hh, hz), (hx, Hh, -hz)], (1, 0, 0), 1, 2, ao_side)
    face([(-hx, 0.02, -hz), (-hx, 0.02, hz), (-hx, Hh, -hz), (-hx, Hh, hz)], (-1, 0, 0), 1, 2, ao_side)
    # leafy cards scattered over the surfaces, slightly proud -> soft clipped edge
    surf_pts = []
    n_cards = 300
    for i in range(n_cards):
        r = rng.random()
        if r < 0.36:  # top
            p = np.array([rng.uniform(-hx, hx), Hh + rng.uniform(-0.02, 0.04), rng.uniform(-hz, hz)])
            n = np.array([0, 1, 0])
        elif r < 0.92:  # long sides
            sz = 1 if rng.random() < 0.5 else -1
            y = Hh * rng.random() ** 0.8
            p = np.array([rng.uniform(-hx, hx), y, sz * (hz + rng.uniform(-0.02, 0.04))])
            n = np.array([0, 0, sz])
        else:  # end caps
            sx = 1 if rng.random() < 0.5 else -1
            p = np.array([sx * (hx - 0.02), rng.uniform(0.05, Hh), rng.uniform(-hz, hz)])
            n = np.array([sx, 0, 0])
        p[0] = np.clip(p[0], -hx + 0.05, hx - 0.05)
        nn = normalize(n + rng.normal(size=3) * 0.45)
        u = normalize(any_perp(nn) * 0.3 + UP * 0.8 + rng.normal(size=3) * 0.4)
        u = normalize(u - nn * np.dot(u, nn))
        right = np.cross(u, nn)
        s = rng.uniform(0.22, 0.34)
        sp = sprites[names[rng.integers(len(names))]]
        surf = mb.surf(mat)
        mb.card(mat, p, right * s, u * s, sp["rect"], anchor=(0.5, 0.55),
                normals=lambda q, n=n: normalize(np.asarray(n, float) + np.array([0, 0.3, 0])))
        Pc = surf.P[-1]
        surf.C[-1] = np.column_stack([[0.55 + 0.45 * min(1, q[1] / Hh) for q in Pc], np.full(len(Pc), 0.6),
                                      np.full(len(Pc), rng.random()), [0.15 * q[1] / Hh for q in Pc]]).astype(np.float32)
    # far: plain box with mass texture (10 tris)
    far = MeshBuilder()
    sav = mb
    mb = far
    face([(-hx, 0.02, hz), (hx, 0.02, hz), (-hx, Hh, hz), (hx, Hh, hz)], (0, 0, 1), 1, 1, ao_side)
    face([(hx, 0.02, -hz), (-hx, 0.02, -hz), (hx, Hh, -hz), (-hx, Hh, -hz)], (0, 0, -1), 1, 1, ao_side)
    face([(-hx, Hh, hz), (hx, Hh, hz), (-hx, Hh, -hz), (hx, Hh, -hz)], (0, 1, 0), 1, 1, lambda p: 1.0)
    face([(hx, 0.02, hz), (hx, 0.02, -hz), (hx, Hh, hz), (hx, Hh, -hz)], (1, 0, 0), 1, 1, ao_side)
    face([(-hx, 0.02, -hz), (-hx, 0.02, hz), (-hx, Hh, -hz), (-hx, Hh, hz)], (-1, 0, 0), 1, 1, ao_side)
    mb = sav
    return finish(tid, mb, None, far=False, far_mesh_override=far,
                  extra=dict(segment_length=L, width=Wd, species="privet", trunk_radius=None))


# ============================================================================ rose bush
def build_rose(tid="rose_bush"):
    rng = np.random.default_rng(seed_of(tid))
    sprites = load_atlas(TEX, "rose")
    names = [k for k in sprites if k.startswith("cluster")]
    blooms = [k for k in sprites if k.startswith("bloom")]
    buds = [k for k in sprites if k.startswith("bud")]
    mat = "foliage_rose"
    mb = MeshBuilder()
    H = 1.0
    tips = []
    for k in range(9):
        az = rng.uniform(0, 2 * math.pi)
        el = math.radians(rng.uniform(8, 38))
        d = np.array([math.cos(az) * math.sin(el), math.cos(el), math.sin(az) * math.sin(el)])
        p = np.array([rng.uniform(-0.05, 0.05), 0.0, rng.uniform(-0.05, 0.05)])
        pts = [p.copy()]
        L = H * rng.uniform(0.6, 1.0)
        for i in range(6):
            d = normalize(d + rng.normal(size=3) * 0.12 + np.array([0, -0.04 * i, 0]) * (el > 0.4))
            p = p + d * L / 6
            pts.append(p.copy())
        pts = np.array(pts)
        cols = np.column_stack([np.linspace(0.6, 0.9, 7), np.zeros(7), np.full(7, rng.random()),
                                np.linspace(0, 0.6, 7)])
        mb.tube("stem_green", pts, np.linspace(0.012, 0.005, 7), 4, uv_scale=(0.1, 0.4), colors=cols)
        tips.append((pts, cols[0, 2]))
    # leaves along upper 2/3 of canes
    for pts, ph in tips:
        for j in range(13):
            i = rng.integers(2, len(pts))
            t = rng.random()
            p = pts[i - 1] * (1 - t) + pts[i] * t
            out = normalize(np.array([p[0], 0.25, p[2]]) + rng.normal(size=3) * 0.4)
            u = normalize(out + UP * 0.5 + rng.normal(size=3) * 0.3)
            nn = normalize(any_perp(u) + out * 0.5)
            nn = normalize(nn - u * np.dot(nn, u))
            right = np.cross(u, nn)
            s = rng.uniform(0.22, 0.32)
            sp = sprites[names[rng.integers(len(names))]]
            surf = mb.surf(mat)
            mb.card(mat, p - u * 0.02, right * s, u * s, sp["rect"], anchor=sp["anchor"],
                    normals=lambda q: normalize(np.array([q[0], q[1] - 0.45, q[2]]) * 1.5 + UP * 0.3))
            Pc = surf.P[-1]
            surf.C[-1] = np.column_stack([[0.55 + 0.45 * min(1, q[1] / H) for q in Pc], np.full(len(Pc), 0.7),
                                          np.full(len(Pc), ph), [min(1, q[1] / H) * 0.6 for q in Pc]]).astype(np.float32)
    # blooms at cane tips and a few side shoots
    nb = 0
    for pts, ph in tips:
        for j in range(rng.integers(1, 4)):
            p = pts[-1] + rng.normal(size=3) * np.array([0.08, 0.04, 0.08]) + np.array([0, 0.02, 0])
            out = normalize(np.array([p[0], 0.0, p[2]]) * 2 + UP * 1.2 + rng.normal(size=3) * 0.3)
            is_bud = rng.random() < 0.22
            sp = sprites[(buds if is_bud else blooms)[rng.integers(len(buds if is_bud else blooms))]]
            s = rng.uniform(0.08, 0.12) if not is_bud else rng.uniform(0.05, 0.07)
            r1 = any_perp(out)
            r2 = np.cross(out, r1)
            col = (0.95, 0.4, ph, min(1, p[1] / H) * 0.6)
            if is_bud:
                mb.card(mat, p, r1 * s, UP * s, sp["rect"], anchor=sp["anchor"], colors=lambda l: col)
                mb.card(mat, p, r2 * s, UP * s, sp["rect"], anchor=sp["anchor"], colors=lambda l: col)
            else:
                # face card (looks up/out) + 2 small crossed side cards for volume
                mb.card(mat, p, r1 * s, r2 * s, sp["rect"], anchor=(0.5, 0.5), colors=lambda l: col,
                        normals=lambda q, o=out: o)
                for rr in (r1, r2):
                    mb.card(mat, p - out * s * 0.15, rr * s * 0.9, out * s * 0.55, sp["rect"], anchor=(0.5, 0.5),
                            colors=lambda l: col, normals=lambda q, o=out: o)
            nb += 1
    return finish(tid, mb, None, far=True, extra=dict(species="rose", trunk_radius=None, blooms=nb))


# ============================================================================ flower clumps
def leaf_rosette(mb, mat, sprite, n, rng, R, Hc, size, phase):
    for i in range(n):
        a = rng.uniform(0, 2 * math.pi)
        r = R * math.sqrt(rng.random())
        p = np.array([math.cos(a) * r, 0.0, math.sin(a) * r])
        out = normalize(np.array([math.cos(a), 0, math.sin(a)]))
        u = normalize(UP * 1.0 + out * rng.uniform(0.2, 0.8) + rng.normal(size=3) * 0.2)
        nn = normalize(np.cross(u, any_perp(u)) + out * 0.6)
        nn = normalize(nn - u * np.dot(nn, u))
        right = np.cross(u, nn)
        s = size * rng.uniform(0.75, 1.2)
        surf = mb.surf(mat)
        mb.card(mat, p, right * s * 0.8, u * s, sprite["rect"], anchor=sprite["anchor"],
                normals=lambda q: normalize(np.array([q[0], 0.0, q[2]]) * 2 + UP))
        Pc = surf.P[-1]
        surf.C[-1] = np.column_stack([[0.5 + 0.5 * min(1, q[1] / Hc) for q in Pc], np.full(len(Pc), 0.5),
                                      np.full(len(Pc), phase), [0.3 * min(1, q[1] / Hc) for q in Pc]]).astype(np.float32)


def build_flower(tid):
    rng = np.random.default_rng(seed_of(tid))
    sp = load_atlas(TEX, "flowers")
    mat = "foliage_flowers"
    mb = MeshBuilder()
    leaves = [sp["cluster0"], sp["cluster1"], sp["cluster2"]]
    if tid == "flowers_marigold":
        Hc = 0.3
        for i in range(26):
            leaf_rosette(mb, mat, leaves[rng.integers(3)], 1, rng, 0.12, Hc, 0.2, rng.random())
        heads = ["marigold0", "marigold1"]
        hs = heads[rng.integers(2)]
        for i in range(10):
            a = rng.uniform(0, 2 * math.pi); r = 0.13 * math.sqrt(rng.random())
            top = np.array([math.cos(a) * r, rng.uniform(0.2, 0.3), math.sin(a) * r])
            base = np.array([top[0] * 0.4, 0.0, top[2] * 0.4])
            mb.tube("stem_green", np.array([base, (base + top) / 2, top]), np.array([0.004, 0.0035, 0.003]), 3,
                    uv_scale=(0.05, 0.2), colors=np.array([[0.6, 0, 0, 0], [0.8, 0.3, 0, 0.2], [1, 0.5, 0, 0.4]]))
            s = rng.uniform(0.05, 0.065)
            o = normalize(UP + np.array([top[0], 0, top[2]]) * 2)
            r1 = any_perp(o); r2 = np.cross(o, r1)
            col = (1.0, 0.5, rng.random(), 0.4)
            rect = sp[heads[rng.integers(2)]]["rect"]
            mb.card(mat, top, r1 * s, r2 * s, rect, colors=lambda l: col, normals=lambda q: o)
            for rr in (r1, r2):  # side cards squashed -> pompon volume
                mb.card(mat, top - o * s * 0.2, rr * s, o * s * 0.6, rect, colors=lambda l: col, normals=lambda q: o)
    elif tid == "flowers_petunia":
        Hc = 0.22
        for i in range(30):
            leaf_rosette(mb, mat, leaves[rng.integers(3)], 1, rng, 0.2, Hc, 0.15, rng.random())
        for i in range(18):
            a = rng.uniform(0, 2 * math.pi); r = 0.22 * math.sqrt(rng.random())
            p = np.array([math.cos(a) * r, rng.uniform(0.1, 0.2) * (1.1 - r / 0.25), math.sin(a) * r])
            o = normalize(UP * 1.0 + np.array([math.cos(a), 0, math.sin(a)]) * (0.3 + r * 3) + rng.normal(size=3) * 0.2)
            r1 = any_perp(o); r2 = np.cross(o, r1)
            s = rng.uniform(0.06, 0.075)
            col = (1.0, 0.6, rng.random(), 0.3)
            rect = sp[["petunia0", "petunia1"][int(i % 5 == 0)]]["rect"]
            mb.card(mat, p, r1 * s, r2 * s, rect, colors=lambda l: col, normals=lambda q, o=o: o)
    elif tid == "flowers_salvia":
        Hc = 0.35
        for i in range(22):
            leaf_rosette(mb, mat, leaves[rng.integers(3)], 1, rng, 0.11, Hc, 0.17, rng.random())
        for i in range(8):
            a = rng.uniform(0, 2 * math.pi); r = 0.1 * math.sqrt(rng.random())
            base = np.array([math.cos(a) * r, rng.uniform(0.1, 0.16), math.sin(a) * r])
            h = rng.uniform(0.16, 0.22)
            lean = normalize(UP + np.array([base[0], 0, base[2]]) * 1.5 + rng.normal(size=3) * 0.08)
            rot = rng.uniform(0, math.pi)
            for k in range(2):
                rr = np.array([math.cos(rot + k * math.pi / 2), 0, math.sin(rot + k * math.pi / 2)])
                rr = normalize(rr - lean * np.dot(rr, lean))
                spk = sp["spike0"]
                mb.card(mat, base, rr * h * 0.25, lean * h, spk["rect"], anchor=(0.5, 1.0),
                        colors=lambda l: (1.0, 0.4 * (1 - l[1]), 0.3, 0.35),
                        normals=lambda q, rr=rr: normalize(UP * 0.6 + np.array([q[0], 0, q[2]]) * 4))
    return finish(tid, mb, None, far=False, extra=dict(species="flowers", trunk_radius=None))


# ============================================================================ grass
GRASS = {
    "grass_clump_a": dict(blades=28, h=(0.18, 0.32), w=(0.008, 0.013), R=0.09, lean=(0.15, 0.55), segs=4),
    "grass_clump_b": dict(blades=34, h=(0.09, 0.17), w=(0.006, 0.010), R=0.10, lean=(0.1, 0.45), segs=3),
    "grass_clump_c": dict(blades=20, h=(0.20, 0.35), w=(0.007, 0.012), R=0.08, lean=(0.2, 0.7), segs=4, seeds=3),
    "grass_clump_d": dict(blades=16, h=(0.12, 0.22), w=(0.010, 0.016), R=0.11, lean=(0.35, 0.9), segs=3),
    "grass_clump_lite": dict(blades=9, h=(0.14, 0.26), w=(0.012, 0.018), R=0.10, lean=(0.15, 0.5), segs=2),
}


def blade(mb, base, d_out, h, w, lean, segs, seed_b, rng, curl=0.0):
    """One tapered, curved blade: strip of segs quads ending in a tip triangle."""
    P, N, T, UV, C = [], [], [], [], []
    side = normalize(np.cross(UP, d_out)) if np.linalg.norm(np.cross(UP, d_out)) > 1e-3 else np.array([1.0, 0, 0])
    twist = rng.uniform(-0.6, 0.6)
    side = normalize(side * math.cos(twist) + d_out * math.sin(twist))
    pts = []
    for i in range(segs + 1):
        t = i / segs
        bend = lean * t ** 1.6
        p = base + UP * h * t * (1 - 0.35 * lean * t) + d_out * h * bend * 0.7
        pts.append(p)
    pts = np.array(pts)
    I = []
    for i in range(segs + 1):
        t = i / segs
        wi = w * (1 - t ** 1.4) if i < segs else 0.0
        tg = normalize(pts[min(i + 1, segs)] - pts[max(i - 1, 0)])
        nrm = normalize(np.cross(side, tg))
        if np.dot(nrm, d_out) < 0:
            nrm = -nrm
        nrm = normalize(nrm + UP * 0.3)
        ao = 0.45 + 0.55 * t ** 0.7
        if i < segs:
            for sgn in (-1, 1):
                P.append(pts[i] + side * wi * 0.5 * sgn)
                N.append(nrm); T.append(list(side) + [1]); UV.append((0.5 + 0.5 * sgn, 1 - t))
                C.append((ao, t, seed_b, 0))
        else:
            P.append(pts[i]); N.append(nrm); T.append(list(side) + [1]); UV.append((0.5, 0)); C.append((ao, t, seed_b, 0))
    for i in range(segs - 1):
        a0 = 2 * i
        I += [a0, a0 + 1, a0 + 2, a0 + 1, a0 + 3, a0 + 2]
    a0 = 2 * (segs - 1)
    I += [a0, a0 + 1, a0 + 2]
    mb.surf("grass").add(P, N, T, UV, C, I)


def build_grass(tid):
    cfg = GRASS[tid]
    rng = np.random.default_rng(seed_of(tid))
    mb = MeshBuilder()
    for i in range(cfg["blades"]):
        a = rng.uniform(0, 2 * math.pi)
        r = cfg["R"] * math.sqrt(rng.random())
        base = np.array([math.cos(a) * r, -0.01, math.sin(a) * r])
        d = normalize(np.array([math.cos(a), 0, math.sin(a)]) + rng.normal(size=3) * np.array([0.5, 0, 0.5]))
        h = rng.uniform(*cfg["h"]) * (1.15 - 0.4 * r / cfg["R"])
        blade(mb, base, d, h, rng.uniform(*cfg["w"]), rng.uniform(*cfg["lean"]), cfg["segs"], rng.random(), rng)
    for i in range(cfg.get("seeds", 0)):  # seed stalks (thin, tall, with narrow spikelet)
        a = rng.uniform(0, 2 * math.pi)
        base = np.array([math.cos(a) * 0.03, 0, math.sin(a) * 0.03])
        d = normalize(np.array([math.cos(a), 0, math.sin(a)]))
        blade(mb, base, d, rng.uniform(0.35, 0.45), 0.004, rng.uniform(0.05, 0.2), 4, rng.random(), rng)
        top = base + UP * 0.38 + d * 0.03
        blade(mb, top - UP * 0.06, d, 0.08, 0.012, 0.05, 2, rng.random(), rng)
    return finish(tid, mb, None, far=False, extra=dict(species="grass", trunk_radius=None))


# ============================================================================ common
def finish(tid, lod0, lod1, far=False, far_mesh_override=None, extra=None):
    os.makedirs(OUT, exist_ok=True)
    lod0.write_glb(f"{OUT}/{tid}.glb", tid)
    tris = dict(lod0=lod0.tris)
    framing = None
    if lod1 is not None:
        lod1.write_glb(f"{OUT}/{tid}_lod1.glb", tid + "_lod1")
        tris["lod1"] = lod1.tris
    mn, mx = lod0.aabb()
    if far:
        fm, framing = far_mesh(tid, mn, mx, mx[1])
        fm.write_glb(f"{OUT}/{tid}_far.glb", tid + "_far")
        tris["far"] = fm.tris
    elif far_mesh_override is not None:
        far_mesh_override.write_glb(f"{OUT}/{tid}_far.glb", tid + "_far")
        tris["far"] = far_mesh_override.tris
    allp = np.concatenate([np.concatenate(s.P) for s in lod0.surfaces.values() if s.nv])
    rep = dict(id=tid, tris=tris, detail=dict(lod0=lod0.tri_report()), height=float(mx[1]),
               aabb=[mn.tolist(), mx.tolist()], crown_radius=float(np.hypot(allp[:, 0], allp[:, 2]).max()),
               framing=framing, **(extra or {}))
    print(f"{tid}: {tris} H {mx[1]:.2f} R {rep['crown_radius']:.2f}")
    return rep


ALL = {**{k: build_thuja for k in THUJA}, "hedge_privet": build_hedge, "rose_bush": build_rose,
       **{k: build_flower for k in ("flowers_marigold", "flowers_petunia", "flowers_salvia")},
       **{k: build_grass for k in GRASS}}

if __name__ == "__main__":
    ids = sys.argv[1:] or list(ALL)
    rep = json.load(open(REPORT)) if os.path.exists(REPORT) else {}
    for tid in ids:
        rep[tid] = ALL[tid](tid)
    json.dump(rep, open(REPORT, "w"), indent=1, default=float)
