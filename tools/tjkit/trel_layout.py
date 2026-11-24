"""Grape trellis (tok): poplar poles 3.0 x 3.0, 2.6 m, with an old vine and low-poly leaves."""
import math
S = 1024
SX, SY = 3.0, 3.0
POST_H = 2.45
R_POST, R_BEAM, R_CROSS = 0.065, 0.06, 0.035
PXW = 1 / 350.0
ISL = {
    'pole': (0, 0, 512, 1024, PXW),
    'vine': (516, 0, 256, 1024, PXW),
    'leaf0': (776, 0, 124, 124, 0.2 / 124), 'leaf1': (900, 0, 124, 124, 0.2 / 124),
    'leaf2': (776, 128, 124, 124, 0.2 / 124), 'leaf3': (900, 128, 124, 124, 0.2 / 124),
    'grapes': (776, 256, 248, 248, 1 / 1000.0),
    'end': (776, 508, 248, 248, 1 / 1500.0),
}
def leaf_outline(n=8):
    """Palmate 5-lobed grape leaf outline in leaf space (metres, petiole at (0,0), tip +y)."""
    pts = []
    # angles measured from +y, lobes at 0, +-60, +-115 deg; sinuses between
    spec = [(0, 0.17), (30, 0.10), (62, 0.15), (92, 0.085), (122, 0.11), (160, 0.05)]
    full = [(-a, r) for a, r in spec[::-1][:-1]] + spec[:]
    full = [(a, r) for a, r in full]
    out = []
    for a, r in full:
        th = math.radians(a)
        out.append((r * math.sin(th), 0.045 + r * math.cos(th)))
    return out   # 11 points, ordered from left-bottom around the top to right-bottom
