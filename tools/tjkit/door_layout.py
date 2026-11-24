"""Khujand-style carved double door: shared parameters + atlas layout (no numpy/bpy)."""
S = 1024
LEAF_W = 0.618          # each leaf (opening 1.24 m incl. gaps)
LEAF_H = 2.26
LEAF_T = 0.065
GAP = 0.004
OW = LEAF_W + GAP       # half opening width
SILL_H = 0.08
JAMB_W = 0.15
JAMB_D = 0.20
FRIEZE_H = 0.30
TOP = SILL_H + LEAF_H + FRIEZE_H     # 2.64 top of jambs
STILE = 0.085
RAIL_TOP, RAIL_MID, RAIL_BOT = 0.085, 0.07, 0.12
P_TOP, P_MAIN = 0.30, 1.20
P_BOT = LEAF_H - (RAIL_TOP + RAIL_MID * 2 + RAIL_BOT + P_TOP + P_MAIN)
PANEL_INSET = 0.016     # chamfer moulding width
PANEL_DEPTH = 0.018
KNOCK_Z = 1.20          # knocker centre height above leaf bottom
JPROF = [0.047, 0.09, 0.015, 0.03]   # developed widths of jamb front profile parts: bead, flat, step, outer
JFRONT = sum(JPROF)
CORN_PROF = 0.16

PX_LEAF = 1 / 420.0
PX_FRAME = 1 / 380.0
PX_PLAIN = 1 / 300.0

def _w(m, px): return int(round(m / px))

ISL = {
    'leaf_front': (0, 0, _w(LEAF_W, PX_LEAF), _w(LEAF_H, PX_LEAF), PX_LEAF),
    'leaf_back': (264, 0, _w(LEAF_W, PX_LEAF), _w(LEAF_H, PX_LEAF), PX_LEAF),
    'sill_top': (0, 954, 520, 68, PX_PLAIN),
    'jamb': (528, 0, _w(JFRONT, PX_FRAME), _w(TOP, PX_FRAME), PX_FRAME),
    'frieze': (602, 0, _w(OW, PX_LEAF), _w(FRIEZE_H, PX_LEAF), PX_LEAF),
    'iron': (896, 0, 128, 128, 1 / 1000.0),
    'cornice': (602, 132, _w(0.84, PX_FRAME), _w(CORN_PROF, PX_FRAME), PX_FRAME),
    'plain': (602, 200, 422, 824, PX_PLAIN),
}

def leaf_rows():
    """z breaks of the leaf (from bottom) and which rows are panels."""
    zs = [0.0]
    parts = [(RAIL_BOT, None), (P_BOT, 'bot'), (RAIL_MID, None), (P_MAIN, 'main'), (RAIL_MID, None), (P_TOP, 'top'), (RAIL_TOP, None)]
    rows = []
    for h, tag in parts:
        rows.append((zs[-1], zs[-1] + h, tag)); zs.append(zs[-1] + h)
    return rows
