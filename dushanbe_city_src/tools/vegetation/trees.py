#!/usr/bin/env python3
"""DUSHANBE procedural trees: space-colonisation skeleton + pipe-model radii + tapered bark tubes
+ leaf-cluster cards.  Writes <id>.glb (LOD0), <id>_lod1.glb, <id>_far.glb (impostor cross cards)
into dushanbe_city/assets/models/vegetation/ and a build report JSON.

Usage: python3 -I trees.py [tree_id ...]
"""
import json, math, os, sys, zlib
import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from vegmesh import MeshBuilder, normalize, any_perp, load_atlas  # noqa: E402

ROOT = "/home/user/safarzod"
PROJ = f"{ROOT}/dushanbe_city"
TEX = f"{PROJ}/assets/textures"
OUT = f"{PROJ}/assets/models/vegetation"
REPORT = f"{ROOT}/dushanbe_city_src/tools/vegetation/build_report_trees.json"
UP = np.array([0.0, 1.0, 0.0])


def seed_of(s):
    return zlib.crc32(s.encode()) & 0xFFFFFFFF


# ============================================================================ crown envelopes
def profile_dome(t, widest=0.42):
    return np.sqrt(np.clip(1 - ((t - widest) / (1 - widest if t > widest else max(widest, 1e-3))) ** 2 * (1 if t > widest else 0.55), 0, 1))


def make_profile(kind):
    if kind == "dome":      # chinar: broad, widest low, flattish bottom
        return lambda t: np.sqrt(np.clip(1 - np.where(t > 0.4, (t - 0.4) / 0.6, (0.4 - t) / 0.4 * 0.75) ** 2, 0, 1))
    if kind == "oval":      # elm, mulberry
        return lambda t: np.clip(1 - ((t - 0.5) / 0.5) ** 2, 0, 1) ** 0.6
    if kind == "round":
        return lambda t: np.clip(1 - np.where(t > 0.45, (t - 0.45) / 0.55, (0.45 - t) / 0.45 * 0.85) ** 2, 0, 1) ** 0.55
    if kind == "spindle":   # pyramidal poplar
        return lambda t: np.where(t < 0.25, 0.55 + 0.45 * np.sqrt(np.clip(t / 0.25, 0, 1)),
                                  np.clip(1 - (t - 0.25) / 0.75, 0, 1) ** 0.75)
    if kind == "irregular":  # acacia
        return lambda t: np.clip(1 - ((t - 0.55) / 0.55) ** 2, 0, 1) ** 0.5
    raise ValueError(kind)


class Envelope:
    def __init__(self, y0, y1, R, kind, rng, lobes=0.18, ecc=(1.0, 1.0)):
        self.y0, self.y1, self.R = y0, y1, R
        self.prof = make_profile(kind)
        self.ecc = ecc
        # lobe noise: random low-frequency harmonics in azimuth & height
        self.h = [(rng.integers(1, 4), rng.uniform(0, 6.28), rng.uniform(0.5, 2.5), rng.uniform(0, 6.28),
                   rng.uniform(0.3, 1.0)) for _ in range(5)]
        self.lobes = lobes
        self.wsum = sum(h[4] for h in self.h)

    def radius(self, y, theta):
        t = (y - self.y0) / (self.y1 - self.y0)
        r = self.prof(np.clip(t, 0, 1)) * self.R
        m = 0
        for k, ph, fy, phy, w in self.h:
            m = m + w * np.sin(k * theta + ph) * np.cos(fy * t * 3.14 + phy)
        r = r * (1 + self.lobes * m / self.wsum)
        ex, ez = self.ecc
        r = r * np.sqrt((np.cos(theta) * ex) ** 2 + (np.sin(theta) * ez) ** 2)
        return np.where((t < 0) | (t > 1), 0, r)

    def inside(self, p):
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        th = np.arctan2(z, x)
        return np.hypot(x, z) <= self.radius(y, th)

    def rho(self, p):
        """normalized radial position (0 axis .. 1 surface) — used for AO / leaf preference."""
        x, y, z = p[:, 0], p[:, 1], p[:, 2]
        th = np.arctan2(z, x)
        r = self.radius(np.clip(y, self.y0 + 1e-3, self.y1 - 1e-3), th)
        t = np.clip((y - self.y0) / (self.y1 - self.y0), 0, 1)
        rr = np.hypot(x, z) / np.maximum(r, 0.3)
        # vertical closeness to top/bottom surfaces too
        return np.clip(np.maximum(rr, np.abs(t - 0.5) * 2) , 0, 1.3)

    def outward(self, p):
        c = np.array([0.0, (self.y0 + self.y1) * 0.5, 0.0])
        d = p - c
        d[:, 1] *= (self.R / max(0.5 * (self.y1 - self.y0), 0.1)) ** 2 * 0.6
        return normalize(d)

    def sample(self, n, rng, blobs=0, blob_r=(1.5, 2.5)):
        pts = []
        H = self.y1 - self.y0
        Rm = self.R * (1 + self.lobes) * max(self.ecc)
        if blobs:
            # clumped attractors (irregular cloud-like crowns)
            centers = []
            while len(centers) < blobs:
                c = np.array([rng.uniform(-Rm, Rm), rng.uniform(self.y0 + 0.15 * H, self.y1 - 0.1 * H), rng.uniform(-Rm, Rm)])
                if self.inside(c[None])[0] and math.hypot(c[0], c[2]) > 0.25 * self.R:
                    centers.append(c)
            per = int(n * 0.75) // blobs
            bg = n - per * blobs
            q = np.column_stack([rng.uniform(-Rm, Rm, 6 * bg), rng.uniform(self.y0, self.y1, 6 * bg), rng.uniform(-Rm, Rm, 6 * bg)])
            pts.append(q[self.inside(q)][:bg])
            for c in centers:
                br = rng.uniform(*blob_r)
                q = rng.normal(size=(per * 3, 3))
                q = normalize(q) * (rng.random((per * 3, 1)) ** (1 / 3)) * br + c
                q = q[self.inside(q)][:per]
                pts.append(q)
            return np.concatenate(pts)
        while sum(len(p) for p in pts) < n:
            q = np.column_stack([rng.uniform(-Rm, Rm, 4 * n), rng.uniform(self.y0, self.y1, 4 * n), rng.uniform(-Rm, Rm, 4 * n)])
            pts.append(q[self.inside(q)])
        return np.concatenate(pts)[:n]


# ============================================================================ skeleton
class Skeleton:
    def __init__(self):
        self.P = []       # positions
        self.parent = []  # parent index (-1 root)
        self.grow = []    # may sprout
        self.fixed_r = {}

    def add(self, p, parent, grow=True):
        self.P.append(np.asarray(p, np.float64))
        self.parent.append(parent)
        self.grow.append(grow)
        return len(self.P) - 1

    def polyline(self, pts, parent, grow=True):
        idx = parent
        out = []
        for p in pts:
            idx = self.add(p, idx, grow)
            out.append(idx)
        return out


def bent_line(p0, d, length, step, rng, wobble=0.08, tropism=(0, 0, 0), bend=0.0):
    pts = []
    p = np.array(p0, np.float64)
    d = normalize(np.array(d, np.float64))
    n = max(2, int(length / step))
    side = any_perp(d)
    for i in range(n):
        d = normalize(d + rng.normal(size=3) * wobble + np.array(tropism) + side * bend)
        p = p + d * step
        pts.append(p.copy())
    return pts


def colonize(sk, attractors, D, di, dk, tropism, rng, iters=400, min_grow_y=-1e9):
    P = np.array(sk.P)
    parent = list(sk.parent)
    growable = np.array(sk.grow, bool) & (P[:, 1] >= min_grow_y)
    A = attractors.copy()
    trop = np.asarray(tropism, np.float64)
    for it in range(iters):
        if len(A) == 0:
            break
        gidx = np.nonzero(growable)[0]
        tree = cKDTree(P[gidx])
        dist, ii = tree.query(A, distance_upper_bound=di)
        ok = np.isfinite(dist)
        if not ok.any():
            break
        nid = gidx[ii[ok]]
        vec = normalize(A[ok] - P[nid])
        acc = np.zeros((len(P), 3))
        cnt = np.zeros(len(P))
        np.add.at(acc, nid, vec)
        np.add.at(cnt, nid, 1)
        act = np.nonzero(cnt > 0)[0]
        dirs = normalize(acc[act] / cnt[act, None] + trop + rng.normal(size=(len(act), 3)) * 0.06)
        newp = P[act] + dirs * D
        # dedupe against existing nodes
        dd, _ = cKDTree(P).query(newp)
        keep = dd > D * 0.35
        if not keep.any():
            break
        act, newp = act[keep], newp[keep]
        P = np.vstack([P, newp])
        parent += list(act)
        growable = np.concatenate([growable, np.ones(len(act), bool)])
        dk_, _ = cKDTree(newp).query(A, distance_upper_bound=dk)
        A = A[~np.isfinite(dk_) | (dk_ > dk)]
    sk.P = list(P)
    sk.parent = parent
    sk.grow = list(growable)
    return len(A)


def compute_radii(sk, r_tip, exp_n):
    n = len(sk.P)
    parent = np.array(sk.parent)
    children = [[] for _ in range(n)]
    for i, p in enumerate(parent):
        if p >= 0:
            children[p].append(i)
    order = []
    stack = [0]
    while stack:
        i = stack.pop()
        order.append(i)
        stack.extend(children[i])
    r = np.full(n, r_tip)
    for i in reversed(order):
        if children[i]:
            r[i] = (sum(r[c] ** exp_n for c in children[i])) ** (1 / exp_n)
    return r, children, order


def build_chains(children, r, root=0):
    """Chains: follow thickest child; returns list of (node list incl. attach parent, level)."""
    chains = []
    stack = [(root, -1, 0)]
    while stack:
        start, par, lvl = stack.pop()
        chain = ([par] if par >= 0 else []) + [start]
        i = start
        while children[i]:
            cs = sorted(children[i], key=lambda c: -r[c])
            for c in cs[1:]:
                stack.append((c, i, lvl + 1))
            i = cs[0]
            chain.append(i)
        chains.append((chain, lvl))
    return chains


def smooth_positions(P, chains, iters=3, fixed=()):
    P = P.copy()
    fixed = set(fixed)
    for _ in range(iters):
        Q = P.copy()
        for ch, lvl in chains:
            for k in range(1, len(ch) - 1):
                i = ch[k]
                if i in fixed:
                    continue
                Q[i] = 0.25 * P[ch[k - 1]] + 0.5 * P[i] + 0.25 * P[ch[k + 1]]
        P = Q
    return P


# ============================================================================ species
TREES = {
    "chinar_mature": dict(species="plane", bark="bark_plane", H=25.0, R=11.0, crown_y0=5.0, profile="dome",
                          trunk_r=0.62, trunk_h=4.6, limbs=5, limb_len=(4.0, 6.5), limb_ang=(28, 55),
                          attractors=2600, D=0.5, di=4.0, dk=1.1, trop=(0, 0.06, 0), r_tip=0.012, exp_n=2.45,
                          blobs=0, lobes=0.22, cards0=2550, card=(1.35, 0.3), cards1=480, wood0=2600, wood1=330,
                          flare=0.55, leaf_r_max=0.05, seed="chinar_mature"),
    "chinar_middle": dict(species="plane", bark="bark_plane", H=18.0, R=7.2, crown_y0=3.6, profile="dome",
                          trunk_r=0.36, trunk_h=3.6, limbs=3, limb_len=(3.0, 4.5), limb_ang=(22, 42),
                          attractors=1700, D=0.42, di=3.2, dk=0.95, trop=(0, 0.1, 0), r_tip=0.011, exp_n=2.45,
                          blobs=0, lobes=0.25, cards0=2100, card=(1.15, 0.3), cards1=420, wood0=2200, wood1=300,
                          flare=0.4, leaf_r_max=0.045, seed="chinar_middle", ecc=(1.0, 0.85)),
    "elm_a": dict(species="elm", bark="bark_furrowed", H=13.5, R=4.8, crown_y0=2.6, profile="oval",
                  trunk_r=0.3, trunk_h=2.4, limbs=4, limb_len=(1.8, 3.0), limb_ang=(25, 45),
                  attractors=1500, D=0.35, di=2.6, dk=0.75, trop=(0, 0.08, 0), r_tip=0.009, exp_n=2.4,
                  blobs=0, lobes=0.15, cards0=2200, card=(0.85, 0.25), cards1=440, wood0=1800, wood1=280,
                  flare=0.35, leaf_r_max=0.035, seed="elm_a"),
    "elm_b": dict(species="elm", bark="bark_furrowed", H=11.0, R=4.4, crown_y0=2.2, profile="round",
                  trunk_r=0.26, trunk_h=1.9, limbs=3, limb_len=(1.6, 2.6), limb_ang=(30, 55),
                  attractors=1300, D=0.33, di=2.4, dk=0.7, trop=(0, 0.04, 0), r_tip=0.009, exp_n=2.4,
                  blobs=7, blob_r=(1.4, 2.2), lobes=0.25, cards0=2000, card=(0.85, 0.25), cards1=420, wood0=1700,
                  wood1=280, flare=0.35, leaf_r_max=0.035, seed="elm_b", lean=(0.25, 0.0)),
    "poplar_a": dict(species="poplar", bark="bark_grey", H=24.0, R=2.6, crown_y0=2.0, profile="spindle",
                     trunk_r=0.34, trunk_h=21.5, limbs=0, leader=True, attractors=1500, D=0.4, di=2.2, dk=0.7,
                     trop=(0, 0.55, 0), r_tip=0.009, exp_n=2.5, blobs=0, lobes=0.12, cards0=2300,
                     card=(0.95, 0.25), cards1=420, wood0=1500, wood1=200, flare=0.35, leaf_r_max=0.04,
                     seed="poplar_a", grow_from=1.8, card_up=0.75),
    "poplar_b": dict(species="poplar", bark="bark_grey", H=19.0, R=2.1, crown_y0=1.6, profile="spindle",
                     trunk_r=0.26, trunk_h=17.0, limbs=0, leader=True, attractors=1200, D=0.38, di=2.0, dk=0.65,
                     trop=(0, 0.6, 0), r_tip=0.009, exp_n=2.5, blobs=0, lobes=0.16, cards0=1900,
                     card=(0.9, 0.25), cards1=380, wood0=1300, wood1=200, flare=0.3, leaf_r_max=0.04,
                     seed="poplar_b", grow_from=1.5, card_up=0.75),
    "acacia": dict(species="acacia", bark="bark_furrowed", H=12.5, R=5.2, crown_y0=3.4, profile="irregular",
                   trunk_r=0.28, trunk_h=3.0, limbs=3, limb_len=(2.5, 4.5), limb_ang=(25, 50),
                   attractors=1300, D=0.38, di=2.8, dk=0.8, trop=(0, 0.03, 0), r_tip=0.009, exp_n=2.3,
                   blobs=9, blob_r=(1.3, 2.3), lobes=0.3, cards0=1700, card=(1.0, 0.3), cards1=360, wood0=2200,
                   wood1=320, flare=0.3, leaf_r_max=0.035, seed="acacia", lean=(-0.35, 0.2), wobble=0.12),
    "mulberry": dict(species="mulberry", bark="bark_mulberry", H=7.5, R=4.0, crown_y0=1.9, profile="round",
                     trunk_r=0.27, trunk_h=1.8, limbs=4, limb_len=(1.2, 2.2), limb_ang=(35, 60),
                     attractors=1100, D=0.3, di=2.2, dk=0.65, trop=(0, 0.1, 0), r_tip=0.009, exp_n=2.3,
                     blobs=0, lobes=0.18, cards0=1500, card=(0.85, 0.25), cards1=330, wood0=1500, wood1=260,
                     flare=0.4, leaf_r_max=0.035, seed="mulberry", wobble=0.12),
    "shrub_lilac": dict(species="lilac", bark="bark_grey", H=2.4, R=1.25, crown_y0=0.35, profile="round",
                        trunk_r=0.035, trunk_h=1.3, limbs=0, stems=6, stem_ang=(8, 30), leader=True, attractors=600,
                        D=0.13, di=0.8, dk=0.25, trop=(0, 0.12, 0), r_tip=0.004, exp_n=2.2, blobs=0, lobes=0.3,
                        cards0=520, card=(0.5, 0.25), cards1=140, wood0=700, wood1=120, flare=0.0,
                        leaf_r_max=0.012, seed="shrub_lilac", grow_from=0.25, kind="shrub"),
    "sapling": dict(species="elm", bark="bark_grey", H=3.6, R=0.9, crown_y0=1.9, profile="oval",
                    trunk_r=0.035, trunk_h=2.3, limbs=0, leader=True, attractors=240, D=0.14, di=0.7, dk=0.22,
                    trop=(0, 0.25, 0), r_tip=0.004, exp_n=2.2, blobs=0, lobes=0.25, cards0=150, card=(0.5, 0.2),
                    cards1=50, wood0=600, wood1=120, flare=0.0, leaf_r_max=0.012, seed="sapling",
                    grow_from=1.8, stake=True),
}


# ============================================================================ build
def make_tree(tid, cfg):
    rng = np.random.default_rng(seed_of(cfg["seed"]))
    H, R = cfg["H"], cfg["R"]
    env = Envelope(cfg["crown_y0"], H, R, cfg["profile"], rng, lobes=cfg["lobes"], ecc=cfg.get("ecc", (1, 1)))
    sk = Skeleton()
    root = sk.add((0, 0, 0), -1, grow=False)
    lean = np.array([cfg.get("lean", (0, 0))[0], 0, cfg.get("lean", (0, 0))[1]])
    trunk = bent_line((0, 0, 0), UP + lean * 0.2, cfg["trunk_h"], cfg["D"], rng, wobble=0.03, tropism=(0, 0.04, 0))
    gf = cfg.get("grow_from", 1e9)
    tidx = []
    prev = root
    for p in trunk:
        prev = sk.add(p, prev, grow=bool(p[1] >= gf))
        tidx.append(prev)
    top = tidx[-1]
    sk.grow[top] = True
    for k in range(cfg.get("stems", 0)):  # extra stems from the base (shrubs, multi-stem trees)
        az = 2 * math.pi * k / cfg["stems"] + rng.uniform(-0.5, 0.5)
        el = math.radians(rng.uniform(*cfg.get("stem_ang", (10, 35))))
        d = np.array([math.cos(az) * math.sin(el), math.cos(el), math.sin(az) * math.sin(el)])
        pts = bent_line((0, 0.02, 0), d, cfg["trunk_h"] * rng.uniform(0.7, 1.0), cfg["D"], rng, wobble=0.06,
                        tropism=(0, 0.03, 0))
        sk.polyline(pts, root, grow=True)
    for k in range(cfg.get("limbs", 0)):
        az = 2 * math.pi * k / cfg["limbs"] + rng.uniform(-0.4, 0.4)
        el = math.radians(rng.uniform(*cfg["limb_ang"]))
        d = np.array([math.cos(az) * math.sin(el), math.cos(el), math.sin(az) * math.sin(el)]) + lean * 0.3
        L = rng.uniform(*cfg["limb_len"])
        start = tidx[-1 - min(len(tidx) - 1, int(rng.integers(0, 3)))]
        pts = bent_line(sk.P[start], d, L, cfg["D"], rng, wobble=cfg.get("wobble", 0.07), tropism=(0, 0.015, 0))
        sk.polyline(pts, start, grow=True)
    A = env.sample(cfg["attractors"], rng, blobs=cfg.get("blobs", 0), blob_r=cfg.get("blob_r", (1.5, 2.5)))
    left = colonize(sk, A, cfg["D"], cfg["di"], cfg["dk"], cfg["trop"], rng, min_grow_y=min(gf, cfg["crown_y0"] * 0.6))
    P = np.array(sk.P)
    r, children, order = compute_radii(sk, cfg["r_tip"], cfg["exp_n"])
    # scale radii so that the trunk at 1.3 m matches target (keep tips >= r_tip)
    i13 = min(range(len(tidx)), key=lambda k: abs(P[tidx[k]][1] - 1.3))
    # log-space remap: tips keep r_tip, trunk at 1.3 m gets the target radius
    rt = r.min()
    gamma = math.log(cfg["trunk_r"] / cfg["r_tip"]) / math.log(r[tidx[i13]] / rt)
    r = cfg["r_tip"] * (r / rt) ** gamma
    chains = build_chains(children, r)
    P = smooth_positions(P, chains, iters=3, fixed=[0])
    # limb id per node (for wind phase): first chain-level>=1 ancestor
    limb_phase = np.zeros(len(P))
    for ch, lvl in chains:
        if lvl == 1:
            ph = rng.random()
            stack = [c for c in ch[1:]]
            while stack:
                i = stack.pop()
                limb_phase[i] = ph
                stack.extend(children[i])
    info = dict(nodes=len(P), attractors_left=int(left))
    return dict(P=P, r=r, children=children, chains=chains, env=env, cfg=cfg, phase=limb_phase, tidx=tidx,
                rng=rng, info=info)


def sway_weight(p, cfg):
    """secondary branch sway weight from position (continuous so leaves follow their twigs)."""
    hd = np.hypot(p[..., 0], p[..., 2])
    y = p[..., 1]
    w = 0.65 * hd / cfg["R"] + 0.35 * np.clip((y - cfg["crown_y0"]) / (cfg["H"] - cfg["crown_y0"]), 0, 1)
    return np.clip(w, 0, 1) ** 1.3


def wood_mesh(T, mb, r_min, lod):
    P, r, cfg, env = T["P"], T["r"], T["cfg"], T["env"]
    mat = cfg["bark"]
    rng = np.random.default_rng(seed_of(cfg["seed"]) + 7)
    flare_amt = cfg.get("flare", 0.3)
    lobes_ph = rng.uniform(0, 6.28)
    for ch, lvl in T["chains"]:
        if r[ch[0] if lvl == 0 else ch[1]] < r_min:
            continue
        # cut chain where radius drops below r_min (but keep at least 2 nodes)
        cut = [i for i in ch if r[i] >= r_min * 0.75]
        if lvl > 0:
            cut = [ch[0]] + [i for i in ch[1:] if r[i] >= r_min * 0.75]
        if len(cut) < 2:
            continue
        # ring subsampling by arc length: spacing grows with radius (cheap thick limbs)
        k_sp = 1.0 if lod == 0 else 2.2
        sel = [cut[0]]
        acc = 0.0
        for a_, b_ in zip(cut[:-1], cut[1:]):
            acc += np.linalg.norm(P[b_] - P[a_])
            sp = np.clip(4.0 * r[b_], 0.5, 1.8) * k_sp
            if acc >= sp:
                sel.append(b_)
                acc = 0.0
        if sel[-1] != cut[-1]:
            if len(sel) > 1 and acc < 0.3 * k_sp:
                sel[-1] = cut[-1]
            else:
                sel.append(cut[-1])
        rr0 = r[cut[min(1, len(cut) - 1)]]
        pts = P[sel].copy()
        rad = r[sel].copy()
        if lvl == 0:
            # extra rings near the ground for root flare
            extra_y = [0.12, 0.35, 0.75] if lod == 0 else [0.3]
            ins_p, ins_r = [pts[0]], [rad[0]]
            for ey in extra_y:
                if ey < pts[1][1]:
                    t = ey / pts[1][1]
                    ins_p.append(pts[0] * (1 - t) + pts[1] * t)
                    ins_r.append(rad[0] * (1 - t) + rad[1] * t)
            pts = np.vstack([np.array(ins_p), pts[1:]])
            rad = np.concatenate([np.array(ins_r), rad[1:]])
            sel = [sel[0]] * (len(ins_p)) + list(sel[1:])
        if lvl > 0:
            # sink the start a little into the parent
            d = normalize(pts[1] - pts[0])
            pts[0] = pts[0] - d * rad[0] * 0.6
            rad[0] = rad[1]
        rad[-1] *= 0.6
        if lod == 0:
            sides = 11 if rr0 > 0.3 else 8 if rr0 > 0.15 else 6 if rr0 > 0.07 else 4 if rr0 > 0.025 else 3
        else:
            sides = 8 if rr0 > 0.3 else 6 if rr0 > 0.12 else 4 if rr0 > 0.05 else 3
        ys = pts[:, 1]
        cols = np.zeros((len(pts), 4))
        rho = env.rho(pts)
        cols[:, 0] = np.where(ys < cfg["crown_y0"] * 0.8, 1.0, 0.55 + 0.45 * np.clip(rho, 0, 1))
        cols[:, 0] = np.minimum(cols[:, 0], 0.55 + 0.45 * np.clip(ys / 1.0, 0, 1))  # ground contact darkening
        cols[:, 1] = 0.0
        cols[:, 2] = T["phase"][np.array(sel)]
        cols[:, 3] = sway_weight(pts, cfg)
        flare = None
        noise = None
        if lvl == 0:
            def flare(i, a, ys=ys):
                y = ys[i]
                f = 1 + flare_amt * math.exp(-y / 0.55) * (1 + 0.35 * math.cos(5 * a + lobes_ph))
                return f
            def noise(i, a, ys=ys):
                return 1 + 0.035 * math.sin(3 * a + ys[i] * 1.7) + 0.02 * math.sin(7 * a - ys[i] * 3.1)
        tile = 1.2 if cfg["bark"] == "bark_plane" else 0.9
        uv_scale = (tile * 0.5 if lvl == 0 else tile * 0.35, tile * (2.0 if cfg["bark"] == "bark_plane" else 1.0))
        mb.tube(mat, pts, rad, sides, uv_scale=uv_scale, colors=cols, flare=flare, noise=noise)


def leaf_candidates(T):
    P, r, cfg, env = T["P"], T["r"], T["cfg"], T["env"]
    parent_of = np.full(len(P), -1)
    for i, cs in enumerate(T["children"]):
        for c in cs:
            parent_of[c] = i
    cand = np.nonzero((r <= cfg["leaf_r_max"]) & (P[:, 1] > cfg["crown_y0"] * 0.85))[0]
    cand = cand[parent_of[cand] >= 0]
    d = normalize(P[cand] - P[parent_of[cand]])
    return cand, d


def choose_cards(T, n, rng, min_dist):
    P, env, cfg = T["P"], T["env"], T["cfg"]
    cand, d = leaf_candidates(T)
    rho = np.nan_to_num(env.rho(P[cand]), nan=0.5)
    w = np.clip(rho, 0.05, 1.2) ** 2.2 + 0.02
    # terminal nodes preferred
    term = np.array([len(T["children"][i]) == 0 for i in cand])
    w = w * np.where(term, 1.6, 1.0)
    order = rng.choice(len(cand), size=len(cand), replace=False, p=w / w.sum())
    chosen = []
    pts = []
    tree_pts = []
    grid = {}
    cell = max(min_dist, 1e-3)
    for o in order:
        p = P[cand[o]]
        key = tuple((p // cell).astype(int))
        ok = True
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for q in grid.get((key[0] + dx, key[1] + dy, key[2] + dz), ()):
                        if np.sum((q - p) ** 2) < min_dist * min_dist:
                            ok = False
                            break
        if ok:
            grid.setdefault(key, []).append(p)
            chosen.append(o)
            if len(chosen) >= n:
                break
    if len(chosen) < n:  # relax: fill remaining randomly (may duplicate positions with jitter)
        extra = rng.choice(len(cand), size=n - len(chosen), p=w / w.sum())
        chosen += list(extra)
    return cand[chosen], d[chosen]


def leaf_cards(T, mb, nodes, dirs, size, size_jit, sprites, rng, lod):
    cfg, env = T["cfg"], T["env"]
    mat = "foliage_" + cfg["species"]
    names = [k for k in sprites if k.startswith("cluster")]
    up_bias = cfg.get("card_up", 0.25)
    P = T["P"]
    for ni, d in zip(nodes, dirs):
        p = P[ni].copy()
        out = env.outward(p[None])[0]
        s = size * rng.uniform(1 - size_jit, 1 + size_jit)
        u = normalize(d * 0.8 + out * 0.6 + UP * up_bias + rng.normal(size=3) * 0.35)
        nb = out - u * np.dot(out, u)
        if np.linalg.norm(nb) < 1e-3:
            nb = any_perp(u)
        nb = normalize(nb)
        ang = rng.uniform(-1.1, 1.1)
        side = np.cross(u, nb)
        n = normalize(nb * math.cos(ang) + side * math.sin(ang))
        right = np.cross(u, n)
        sp = sprites[names[rng.integers(len(names))]]
        if rng.random() < 0.5:  # mirror
            right = -right
        squash = rng.uniform(0.85, 1.0)
        center = p - u * s * 0.08
        ph = T["phase"][ni]

        def normals(q, center=center):
            vol = env.outward(q[None])[0]
            fn = n if np.dot(n, vol) >= 0 else -n
            return normalize(fn * 0.35 + vol * 0.8)

        def colors(l, center=center):
            return (0, 0, 0, 0)

        # vertex colours computed after: build card then patch colours
        surf = mb.surf(mat)
        before = surf.nv
        mb.card(mat, center, right * s * squash, u * s, sp["rect"], anchor=sp["anchor"], normals=normals,
                fold=0.0)
        Pc = surf.P[-1]
        rho = env.rho(Pc)
        ao = np.clip(0.38 + 0.62 * np.clip((rho - 0.25) / 0.8, 0, 1) ** 0.9, 0, 1)
        t = np.clip((Pc[:, 1] - cfg["crown_y0"]) / (cfg["H"] - cfg["crown_y0"]), 0, 1)
        ao *= 0.82 + 0.18 * t
        fl = np.clip(np.linalg.norm(Pc - p, axis=1) / s, 0, 1)
        C = np.column_stack([ao, 0.25 + 0.75 * fl, np.full(len(Pc), ph), sway_weight(Pc, cfg)])
        surf.C[-1] = C.astype(np.float32)


def stake_mesh(mb, cfg):
    """Two wooden stakes + crossbar + rubber ties (typical Dushanbe street planting)."""
    mat = "stake_wood"
    for sx in (-1, 1):
        x = sx * 0.32
        pts = np.array([[x, -0.05, 0.02 * sx], [x, 1.0, 0.02 * sx], [x, 1.9, 0.02 * sx]])
        mb.tube(mat, pts, np.array([0.035, 0.034, 0.032]), 6, uv_scale=(0.25, 1.0),
                colors=np.tile([1, 0, 0, 0], (3, 1)), close_tip=True)
    for y in (1.15, 1.7):
        pts = np.array([[-0.36, y, 0.0], [0.36, y, 0.0]])
        mb.tube(mat, pts, np.array([0.018, 0.018]), 5, uv_scale=(0.25, 1.0), colors=np.tile([1, 0, 0, 0], (2, 1)))
    # rubber tie loops around trunk
    for y in (1.15, 1.7):
        ring = [[math.cos(a) * 0.05, y, math.sin(a) * 0.05] for a in np.linspace(0, 2 * math.pi, 9)]
        mb.tube("stake_wood", np.array(ring), np.full(9, 0.008), 3, uv_scale=(0.1, 0.2), colors=np.tile([0.5, 0, 0, 0], (9, 1)))


def far_mesh(tid, aabb_min, aabb_max, H):
    """3 crossed vertical cards; UVs into a 3-view impostor atlas (one view per card)."""
    mb = MeshBuilder()
    W = 2 * max(abs(aabb_min[0]), abs(aabb_max[0]), abs(aabb_min[2]), abs(aabb_max[2])) * 1.02
    y0 = min(0.0, aabb_min[1])
    y1 = aabb_max[1] * 1.02
    views = []
    for i in range(3):
        th = math.radians(i * 60.0)
        n = np.array([math.cos(th), 0, math.sin(th)])
        rgt = np.cross(UP, n)
        u0, u1 = i / 3, (i + 1) / 3
        cols = [-0.5, 0.0, 0.5]
        Pq, Nq, UVq, Cq = [], [], [], []
        for yy in (y1, y0):
            for c in cols:
                p = rgt * c * W + UP * yy
                Pq.append(p)
                Nq.append(normalize(rgt * c * 1.6 + UP * 0.5 + n * 0.25))
                UVq.append((u0 + (c + 0.5) * (u1 - u0), (y1 - yy) / (y1 - y0)))
                Cq.append((0.9, 0.0, 0.0, 0.0))
        I = [0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5]
        T = np.tile(np.append(rgt, 1.0), (6, 1))
        mb.surf("impostor_" + tid).add(Pq, Nq, T, UVq, Cq, I)
        views.append(dict(angle_deg=i * 60.0, normal=n.tolist(), right=rgt.tolist()))
    return mb, dict(width=W, y0=y0, y1=y1, views=views)


def build(tid):
    cfg = TREES[tid]
    T = make_tree(tid, cfg)
    sprites = load_atlas(TEX, cfg["species"])
    rng = np.random.default_rng(seed_of(cfg["seed"]) + 99)
    # ---- LOD0
    r_min = 0.012
    while True:
        wood = MeshBuilder()
        wood_mesh(T, wood, r_min, 0)
        if wood.tris <= cfg["wood0"]:
            break
        r_min *= 1.15
    nodes, dirs = choose_cards(T, cfg["cards0"], rng, min_dist=cfg["card"][0] * 0.28)
    lod0 = MeshBuilder()
    lod0.merge(wood)
    leaf_cards(T, lod0, nodes, dirs, cfg["card"][0], cfg["card"][1], sprites, rng, 0)
    if cfg.get("stake"):
        stake_mesh(lod0, cfg)
    # ---- LOD1: thicker branches only, fewer + larger cards picked as a spatial subset of LOD0
    r_min1 = max(r_min * 2.5, cfg["trunk_r"] * 0.12)
    while True:
        wood1 = MeshBuilder()
        wood_mesh(T, wood1, r_min1, 1)
        if wood1.tris <= cfg["wood1"]:
            break
        r_min1 *= 1.15
    n1 = cfg["cards1"]
    sub = farthest_subset(T["P"][nodes], n1, rng)
    lod1 = MeshBuilder()
    lod1.merge(wood1)
    scale1 = cfg["card"][0] * math.sqrt(len(nodes) / n1) * 0.78
    leaf_cards(T, lod1, nodes[sub], dirs[sub], scale1, cfg["card"][1] * 0.6, sprites, rng, 1)
    if cfg.get("stake"):
        stake_mesh(lod1, cfg)
    # ---- far
    mn, mx = lod0.aabb()
    far, framing = far_mesh(tid, mn, mx, cfg["H"])
    os.makedirs(OUT, exist_ok=True)
    lod0.write_glb(f"{OUT}/{tid}.glb", tid)
    lod1.write_glb(f"{OUT}/{tid}_lod1.glb", tid + "_lod1")
    far.write_glb(f"{OUT}/{tid}_far.glb", tid + "_far")
    allp = np.concatenate([np.concatenate(sf.P) for sf in lod0.surfaces.values() if sf.nv])
    crown_r = float(np.hypot(allp[:, 0], allp[:, 2]).max())
    rep = dict(id=tid, tris=dict(lod0=lod0.tris, lod1=lod1.tris, far=far.tris),
               detail=dict(lod0=lod0.tri_report(), lod1=lod1.tri_report()), r_min=r_min, r_min1=r_min1,
               height=float(mx[1]), aabb=[mn.tolist(), mx.tolist()], crown_radius=crown_r,
               trunk_radius=cfg["trunk_r"], framing=framing, species=cfg["species"], bark=cfg["bark"], **T["info"])
    print(f"{tid}: lod0 {lod0.tris} ({lod0.tri_report()}), lod1 {lod1.tris}, far {far.tris}, H {mx[1]:.1f}, "
          f"crownR {crown_r:.1f}, nodes {T['info']['nodes']}, r_min {r_min:.3f}")
    return rep


def farthest_subset(pts, n, rng):
    n = min(n, len(pts))
    idx = [int(rng.integers(len(pts)))]
    d = np.linalg.norm(pts - pts[idx[0]], axis=1)
    for _ in range(n - 1):
        i = int(np.argmax(d))
        idx.append(i)
        d = np.minimum(d, np.linalg.norm(pts - pts[i], axis=1))
    return np.array(idx)


if __name__ == "__main__":
    ids = sys.argv[1:] or list(TREES)
    rep = json.load(open(REPORT)) if os.path.exists(REPORT) else {}
    for tid in ids:
        rep[tid] = build(tid)
    json.dump(rep, open(REPORT, "w"), indent=1, default=float)
