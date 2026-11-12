"""Procedural small structures emitted directly into chunk meshes (categories not covered by
the prop library): grape trellis (токзор), Soviet metal garages, football goals, tree-pit
grates, a street kiosk, school name board on posts."""
import math
from atlases import sign_uv

H = 0.15


def grape_trellis(b, d, colliders, x, z, yaw, rng):
    """Wooden/steel posts 2.4 m, lattice of rails, vine foliage on top (cards)."""
    b.set_transform(x, H, z, yaw); d.set_transform(x, H, z, yaw)
    w, l, h = rng.uniform(3.5, 5.0), rng.uniform(4.0, 6.0), 2.5
    t = (0.32, 0.30, 0.28)
    for sx in (-1, 1):
        for sz in (-1, 0, 1):
            px, pz = sx * w / 2, sz * l / 2
            d.htube("metal_paint", (px, 0, pz), (px, h, pz), 0.04, 6, tint=t)
    for k in range(6):
        xx = -w / 2 + w * k / 5
        d.htube("metal_paint", (xx, h, -l / 2), (xx, h, l / 2), 0.015, 4, tint=t)
    for k in range(5):
        zz = -l / 2 + l * k / 4
        d.htube("metal_paint", (-w / 2, h, zz), (w / 2, h, zz), 0.015, 4, tint=t)
    # vine canopy: overlapping leaf cards slightly above the lattice (two layers, some hanging)
    for i in range(int(w * l * 1.4)):
        cx, cz = rng.uniform(-w / 2, w / 2), rng.uniform(-l / 2, l / 2)
        s = rng.uniform(0.6, 1.1)
        y = h + rng.uniform(0.02, 0.25)
        a = rng.uniform(0, math.pi)
        dx, dz = math.cos(a) * s / 2, math.sin(a) * s / 2
        g = rng.uniform(0.8, 1.1)
        b.quad("vine", (cx - dx, y, cz - dz - 0.2), (cx + dx, y, cz + dz - 0.2), (cx + dx, y + 0.1, cz + dz + 0.3), (cx - dx, y + 0.1, cz - dz + 0.3),
               uv=[(0, 1), (1, 1), (1, 0), (0, 0)], tint=(g, g, g))
    for i in range(int(w * 2)):
        cx = rng.choice([-w / 2, w / 2]) + rng.uniform(-0.1, 0.1)
        cz = rng.uniform(-l / 2, l / 2)
        hh = rng.uniform(0.6, 1.2)
        b.quad("vine", (cx, h - hh, cz - 0.4), (cx, h - hh, cz + 0.4), (cx, h + 0.1, cz + 0.4), (cx, h + 0.1, cz - 0.4),
               uv=[(0, 1), (1, 1), (1, 0), (0, 0)])
    # tapchan-like low platform under it sometimes
    if rng.random() < 0.5:
        b.box("wood", -1.0, 0, -1.0, 1.0, 0.45, 1.0, tint=(0.55, 0.38, 0.24))
        b.quad("fabric", (-0.95, 0.46, 0.95), (0.95, 0.46, 0.95), (0.95, 0.46, -0.95), (-0.95, 0.46, -0.95), tint=(0.6, 0.12, 0.12))
        colliders.append([round(x, 2), H + 0.22, round(z, 2), 2.0, 0.45, 2.0, yaw])


def metal_garage(b, d, colliders, x, z, yaw, rng):
    """Soviet steel garage 3.2 x 6 x 2.4 m with double doors, each painted differently."""
    b.set_transform(x, H, z, yaw); d.set_transform(x, H, z, yaw)
    t = rng.choice([(0.35, 0.45, 0.35), (0.55, 0.55, 0.55), (0.40, 0.42, 0.55), (0.55, 0.40, 0.30), (0.65, 0.62, 0.5)])
    w, l, h = 3.2, 6.0, 2.4
    b.box("roof_metal", -w / 2, 0, -l / 2, w / 2, h, l / 2, tint=t, faces="xXzZ")
    b.quad("roof_metal", (-w / 2 - 0.1, h + 0.15, l / 2 + 0.2), (w / 2 + 0.1, h + 0.15, l / 2 + 0.2), (w / 2 + 0.1, h - 0.05, -l / 2 - 0.1), (-w / 2 - 0.1, h - 0.05, -l / 2 - 0.1), tint=[c * 0.8 for c in t])
    dt = [min(1, c * rng.uniform(0.8, 1.2)) for c in t]
    for s in (-1, 1):
        d.box("metal_paint", s * 0.02 if s > 0 else -1.4, 0.05, l / 2, 1.4 if s > 0 else -0.02, 2.15, l / 2 + 0.04, tint=dt)
    d.box("metal_galv", -0.05, 1.0, l / 2 + 0.04, 0.05, 1.2, l / 2 + 0.1)
    colliders.append([round(x, 2), H + h / 2, round(z, 2), w, h, l, yaw])


def football_goal(b, d, colliders, x, z, yaw, rng):
    d.set_transform(x, H, z, yaw)
    t = (0.92, 0.92, 0.92)
    w, h, dep = 5.0, 2.0, 1.2
    for s in (-1, 1):
        d.htube("metal_paint", (s * w / 2, 0, 0), (s * w / 2, h, 0), 0.05, 6, tint=t)
        d.htube("metal_paint", (s * w / 2, h, 0), (s * w / 2, 0, -dep), 0.03, 6, tint=t)
    d.htube("metal_paint", (-w / 2, h, 0), (w / 2, h, 0), 0.05, 6, tint=t)
    d.htube("metal_paint", (-w / 2, 0.03, -dep), (w / 2, 0.03, -dep), 0.03, 6, tint=t)


def tree_grate(b, d, colliders, x, z, yaw, rng):
    b.set_transform(x, H, z, 0.0)
    b.ao_ground = False
    b.quad("grate", (-0.7, 0.012, 0.7), (0.7, 0.012, 0.7), (0.7, 0.012, -0.7), (-0.7, 0.012, -0.7), uv=[(0, 2), (2, 2), (2, 0), (0, 0)])
    b.ao_ground = True


def kiosk(b, d, colliders, x, z, yaw, rng):
    b.set_transform(x, H, z, yaw); d.set_transform(x, H, z, yaw)
    w, l, h = 3.0, 2.2, 2.6
    b.box("wall_plaster", -w / 2, 0, -l / 2, w / 2, 1.0, l / 2, tint=(0.95, 0.93, 0.88), faces="xXzZ")
    a0, b0, a1, b1 = (0.25, 0.25, 0.5, 0.5)
    b.quad("glass", (-w / 2, 1.0, l / 2), (w / 2, 1.0, l / 2), (w / 2, h - 0.4, l / 2), (-w / 2, h - 0.4, l / 2), uv=[(0.25, 0.5), (0.5, 0.5), (0.5, 0.25), (0.25, 0.25)])
    b.box("wall_plaster", -w / 2, 1.0, -l / 2, w / 2, h, l / 2 - 0.05, tint=(0.95, 0.93, 0.88), faces="xXz")
    b.box("metal_galv", -w / 2 - 0.3, h, -l / 2 - 0.2, w / 2 + 0.3, h + 0.12, l / 2 + 0.6, tint=(0.7, 0.7, 0.7), faces="YyZzxX")
    u0, v0, u1, v1 = sign_uv("qahvakhona")
    b.quad("sign", (-w / 2, h - 0.4, l / 2 + 0.02), (w / 2, h - 0.4, l / 2 + 0.02), (w / 2, h, l / 2 + 0.02), (-w / 2, h, l / 2 + 0.02), uv=[(u0, v1), (u1, v1), (u1, v0), (u0, v0)])
    colliders.append([round(x, 2), H + h / 2, round(z, 2), w, h, l, yaw])


def school_sign(b, d, colliders, x, z, yaw, rng):
    b.set_transform(x, H, z, yaw); d.set_transform(x, H, z, yaw)
    for s in (-1, 1):
        d.htube("metal_paint", (s * 2.6, 0, 0), (s * 2.6, 2.6, 0), 0.05, 6, tint=(0.3, 0.3, 0.3))
    u0, v0, u1, v1 = sign_uv("maktab")
    b.box("metal_paint", -2.8, 1.9, -0.05, 2.8, 2.6, 0.0, tint=(0.2, 0.2, 0.25))
    b.quad("sign", (-2.8, 1.9, 0.01), (2.8, 1.9, 0.01), (2.8, 2.6, 0.01), (-2.8, 2.6, 0.01), uv=[(u0, v1), (u1, v1), (u1, v0), (u0, v0)])


BUILDERS = {"grape_trellis": grape_trellis, "metal_garage": metal_garage, "goal": football_goal,
            "tree_grate": tree_grate, "kiosk": kiosk, "school_sign": school_sign}
