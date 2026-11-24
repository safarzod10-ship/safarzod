"""Aivan (veranda) section 6.0 x 2.5 x 3.2 m: two columns (3 m spacing, tiles seamlessly),
front girder, back ledger, 24 painted joists (vassa), painted ceiling bays, earth roof slab."""
S = 2048
WIDTH, DEPTH, HEIGHT = 6.0, 2.5, 3.2
COL_X = (-1.5, 1.5)
FRONT_Y = -1.0           # column / girder line
Y0, Y1 = -1.28, 1.25     # joist / ceiling extent (front overhang to back)
COL_H = 2.72
BEAM = (0.20, 0.22)      # width (y), height (z)
JOIST_R = 0.05
JOIST_N = 24
JOIST_STEP = WIDTH / JOIST_N
Z_BEAM0 = COL_H
Z_BEAM1 = COL_H + BEAM[1]
Z_JOIST = Z_BEAM1 + JOIST_R
Z_CEIL = Z_BEAM1 + 2 * JOIST_R
Z_TOP = HEIGHT
PXP = 1 / 400.0
PXB = 1 / 300.0
BAY_LEN = Y1 - Y0
ISL = {
    # column atlas occupies the top-left quadrant (scaled 0.5)
    'bay0': (1024, 0, 100, int(BAY_LEN / PXP), PXP),
    'bay1': (1124, 0, 100, int(BAY_LEN / PXP), PXP),
    'bay2': (1224, 0, 100, int(BAY_LEN / PXP), PXP),
    'bay3': (1324, 0, 100, int(BAY_LEN / PXP), PXP),
    'joist0': (1428, 0, 124, 1016, PXP),
    'joist1': (1554, 0, 124, 1016, PXP),
    'endgrain': (1682, 0, 128, 128, 1 / 1000.0),
    'roof': (1682, 132, 366, 366, 1 / 80.0),
    'beam_front': (0, 1024, 900, 68, PXB),
    'beam_bottom': (0, 1096, 900, 62, PXB),
    'fascia': (0, 1162, 900, 50, PXB),
    'plain': (0, 1216, 900, 832, PXB),
}
