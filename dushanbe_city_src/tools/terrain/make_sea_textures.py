#!/usr/bin/env python3
"""Tileable wave normal map for the sea shader: a sum of ~48 sine waves whose wave vectors are
integer multiples of the tile size (so the texture tiles seamlessly), wind mostly from one
direction, choppy small waves. Output dushanbe_city/assets/textures/sea/wave_normal.png (512^2)."""
import os
import numpy as np
from PIL import Image

N = 512
rng = np.random.default_rng(12)
u = np.arange(N) / N
U, V = np.meshgrid(u, u)
dhx = np.zeros((N, N)); dhz = np.zeros((N, N))
for k in range(48):
    ang = rng.normal(0.35, 0.7)                     # mostly from one direction
    f = rng.uniform(2, 26)
    kx = int(round(np.cos(ang) * f)); kz = int(round(np.sin(ang) * f))
    if kx == 0 and kz == 0:
        continue
    amp = 1.0 / (np.hypot(kx, kz) ** 1.3)
    ph = rng.uniform(0, 2 * np.pi)
    arg = 2 * np.pi * (kx * U + kz * V) + ph
    # slightly sharpened crests (choppy)
    c = np.cos(arg)
    dhx += amp * 2 * np.pi * kx * c * (1 + 0.3 * np.sin(arg))
    dhz += amp * 2 * np.pi * kz * c * (1 + 0.3 * np.sin(arg))
s = 0.035
n = np.stack([-dhx * s, np.ones_like(dhx), -dhz * s], -1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
# tangent space: R = x, G = z (Godot uses OpenGL-style normal maps, Y+)
img = np.stack([n[..., 0], n[..., 2], n[..., 1]], -1) * 0.5 + 0.5
out = os.path.join(os.path.dirname(__file__), "..", "..", "..", "dushanbe_city", "assets", "textures", "sea", "wave_normal.png")
Image.fromarray((img * 255 + 0.5).astype(np.uint8), "RGB").save(out)
print("wave normal", out)
