"""Aivan column: stone plinth, carved 'kuza' (pot) base, tapered shaft, muqarnas capital,
abacus and 'bolish' bracket. Shared by texture and build scripts (pure python)."""
import math
S = 1024
NSEG = 16
BASE_H = 0.18
BASE_HALF = 0.21

def profile(H=3.10):
    """Lathe profile (r, z) from top of stone plinth to capital start, for total height H
    (top of bracket). Returns pts, cap_z0."""
    bol_h, aba_h, cap_h = 0.12, 0.12, 0.36
    cap_z0 = H - bol_h - aba_h - cap_h
    Hs = cap_z0 - 0.05
    b = BASE_H
    k = [(0.150, b), (0.157, b + 0.012), (0.150, b + 0.03), (0.133, b + 0.036), (0.148, b + 0.07),
         (0.165, b + 0.12), (0.171, b + 0.17), (0.166, b + 0.22), (0.152, b + 0.27), (0.134, b + 0.32),
         (0.118, b + 0.37), (0.112, b + 0.40), (0.124, b + 0.41), (0.124, b + 0.435), (0.112, b + 0.445)]
    sh = [(0.112 - 0.008 * t, b + 0.445 + (Hs - b - 0.445) * t) for t in (0.08, 0.35, 0.65, 1.0)]
    ast = [(0.117, Hs + 0.008), (0.117, Hs + 0.03), (0.104, Hs + 0.04), (0.104, cap_z0)]
    return k + sh + ast, cap_z0

def developed(pts):
    s = [0.0]
    for i in range(1, len(pts)):
        s.append(s[-1] + math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]))
    return s

def cap_rings(cap_z0):
    """(r_point, r_valley, z, phase, kind) rings of the muqarnas capital (16 verts each)."""
    z = cap_z0
    return [(0.104, 0.104, z, 0, 'c'), (0.148, 0.112, z + 0.06, 0, 'z'), (0.148, 0.112, z + 0.11, 0, 'z'),
            (0.19, 0.145, z + 0.17, 1, 'z'), (0.19, 0.145, z + 0.22, 1, 'z'),
            (0.215, 0.18, z + 0.28, 0, 'z'), (0.215, 0.18, z + 0.32, 0, 'z'), (0.20, 0.20, z + 0.36, 0, 's')]

def ring_pts(rp, rv, z, phase, kind, n=NSEG):
    out = []
    for k in range(n):
        a = 2 * math.pi * k / n
        if kind == 'c':
            r = rp
        elif kind == 's':
            r = rp / max(abs(math.cos(a)), abs(math.sin(a)))
        else:
            r = rp if (k + phase) % 2 == 0 else rv
        out.append((r * math.cos(a), r * math.sin(a), z))
    return out

LATHE_LEN = 3.0   # max developed length mapped onto 1024 px (H up to 3.1)
PX_LATHE = LATHE_LEN / 1024
ISL = {
    'lathe': (0, 0, 256, 1024, PX_LATHE),
    'capital': (260, 0, 384, 220, 1 / 520.0),
    'abacus': (260, 224, 168, 52, 1 / 420.0),
    'bolish': (260, 280, 340, 52, 1 / 420.0),
    'stone': (648, 0, 376, 376, 1 / 600.0),
    'plain': (260, 336, 384, 688, 1 / 300.0),
    'plain2': (648, 380, 376, 644, 1 / 300.0),
}
ABA_HALF = 0.20
BOL_L, BOL_W, BOL_H = 0.80, 0.16, 0.12
