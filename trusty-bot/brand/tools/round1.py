"""Round 1: broad exploration — 26 concept families x 8 variants, black ink only.

Usage: python3 round1.py <out_dir>
Writes NNN.svg files plus index.json (id -> family, variant, note).
"""
import json
import math
import os
import sys

from svglib import (BG, INK, P, S, T_poly, arc_d, cd, f, masked, mirror, poly, rot,
                    rr, shield, svg, wavy_circle)


# ---------------------------------------------------------------- 1 split T
def fam_splitT(v):
    L = [(16, 18), (48, 18), (48, 84), (40, 84), (40, 36), (16, 36)]
    R = [(52, 18), (84, 18), (84, 36), (60, 36), (60, 84), (52, 84)]
    if v == 0:
        return P(rr(16, 18, 31, 17)) + P(rr(53, 18, 31, 17)) + P(rr(41.5, 39, 17, 45))
    if v == 1:
        return P(poly(L)) + P(poly(R))
    if v == 2:
        return P(poly([(x, y - 4) for x, y in L])) + P(poly([(x, y + 4) for x, y in R]))
    if v == 3:
        Ls = [(19, 21), (45, 21), (45, 81), (43, 81), (43, 33), (19, 33)]
        Rs = [(55, 21), (81, 21), (81, 33), (57, 33), (57, 81), (55, 81)]
        return (P(poly(Ls)) + S(poly(Ls), 6) + P(poly(Rs)) + S(poly(Rs), 6))
    if v == 4:
        return P(rr(14, 22, 34, 16, 8)) + P(rr(52, 22, 34, 16, 8)) + P(cd(50, 64, 15))
    if v == 5:
        # diagonal split through the stem
        def cut(y, off):
            return 55 - (y - 18) / 66 * 10 + off
        Lp = [(16, 18), (cut(18, -2), 18), (cut(84, -2), 84), (40, 84), (40, 36), (16, 36)]
        Rp = [(cut(18, 2), 18), (84, 18), (84, 36), (60, 36), (60, 84), (cut(84, 2), 84)]
        return P(poly(Lp)) + P(poly(Rp))
    if v == 6:
        Ls = [(19, 21), (45, 21), (45, 81), (43, 81), (43, 33), (19, 33)]
        Rs = [(55, 21), (81, 21), (81, 33), (57, 33), (57, 81), (55, 81)]
        return S(poly(Ls), 5) + S(poly(Rs), 5)
    if v == 7:
        return (P(rr(41, 28, 18, 58, 9)) + P(rr(12, 18, 44, 18, 9))
                + S(rr(44, 18, 44, 18, 9), 5, BG) + P(rr(44, 18, 44, 18, 9)))


# ---------------------------------------------------------------- 2 shield T
def fam_shieldT(v):
    tcut = T_poly(50, 30, 34, 10, 10, 44)
    if v == 0:
        return P(shield() + tcut, rule="evenodd")
    if v == 1:
        return P(shield(r=9) + tcut, rule="evenodd")
    if v == 2:
        return S(shield(23, 77, 16, 46, 87), 6) + P(T_poly(50, 31, 28, 9, 9, 38))
    if v == 3:
        cuts = (f'<rect x="0" y="29" width="100" height="7" fill="black"/>'
                f'<rect x="46.5" y="29" width="7" height="70" fill="black"/>')
        return masked(P(shield(r=4)), cuts)
    if v == 4:
        d = "M20 14H80V62Q80 76 66 83L50 90L34 83Q20 76 20 62Z"
        return P(d + T_poly(50, 30, 32, 10, 10, 40), rule="evenodd")
    if v == 5:
        cuts = S("M34 50L46 62L68 38", 9, "black")
        return masked(P(shield(r=6)), cuts)
    if v == 6:
        left = "M20 14H48V88.6C34 81 20 69 20 48Z"
        return P(left) + S(shield(23, 77, 17, 46, 86.5), 5)
    if v == 7:
        cuts = S("M46 26V60Q46 70 56 70H62", 9, "black", cap="butt") + S("M36 38H60", 9, "black", cap="butt")
        return masked(P(shield(r=10)), cuts)


# ---------------------------------------------------------------- 3 t + check
def fam_tcheck(v):
    stem = "M40 14V62Q40 78 54 76L84 42"
    bar = "M24 34H60"
    if v == 0:
        return S(stem, 12) + S(bar, 12)
    if v == 1:
        return S(stem, 13, cap="butt", join="miter") + S(bar, 13, cap="butt")
    if v == 2:
        return S(stem, 12) + S("M40 34H64", 12)
    if v == 3:
        return P(cd(50, 50, 42)) + S("M44 22V58Q44 70 54 69L74 46", 9, BG) + S("M32 36H58", 9, BG)
    if v == 4:
        return P(rr(10, 10, 80, 80, 22)) + S("M44 22V58Q44 70 54 69L74 46", 9, BG) + S("M32 36H58", 9, BG)
    if v == 5:
        return S(stem, 8) + S(bar, 8) + P(cd(84, 26, 5))
    if v == 6:
        return rot(S(stem, 12) + S(bar, 12), 10)
    if v == 7:
        return S("M40 14V70L50 80L84 40", 12, cap="square", join="miter") + S(bar, 12, cap="square")


# ---------------------------------------------------------------- 4 braces + coin
def brace(x, top, bot, w=10):
    mid = (top + bot) / 2
    return (f"M{x+w} {top}C{x+2} {top} {x+3} {top+8} {x+3} {top+14}V{mid-8}"
            f"C{x+3} {mid-3} {x} {mid} {x-6} {mid}C{x} {mid} {x+3} {mid+3} {x+3} {mid+8}"
            f"V{bot-14}C{x+3} {bot-8} {x+2} {bot} {x+w} {bot}")


def fam_braces(v):
    bl = brace(20, 18, 82)
    pair = S(bl, 8) + mirror(S(bl, 8))
    if v == 0:
        return pair + P(cd(50, 50, 10))
    if v == 1:
        sq = S("M32 18H20V82H32", 8, cap="square", join="miter")
        return sq + mirror(sq) + P(cd(50, 50, 10))
    if v == 2:
        ang = S("M34 22L14 50L34 78", 9)
        return ang + mirror(ang) + P(cd(50, 50, 9))
    if v == 3:
        return pair + S(cd(50, 50, 9), 6)
    if v == 4:
        return pair + P(cd(50, 50, 13)) + P(T_poly(50, 44, 13, 4, 4, 13), fill=BG)
    if v == 5:
        return pair + rot(P(rr(41, 41, 18, 18, 2)), 45)
    if v == 6:
        sq = S("M32 18H20V82H32", 8, cap="square", join="miter")
        return sq + mirror(sq) + P(shield(38, 62, 36, 50, 66, r=2))
    if v == 7:
        return pair + S("M40 51L47 58L61 42", 7)


# ---------------------------------------------------------------- 5 chevrons
def fam_chevrons(v):
    L = "M44 18L16 50L44 82"
    if v == 0:
        return S(L, 12) + mirror(S(L, 12)) + P(cd(50, 50, 7))
    if v == 1:
        return S("M46 16L16 50L46 84", 12, cap="butt", join="miter") + mirror(S("M46 16L16 50L46 84", 12, cap="butt", join="miter"))
    if v == 2:
        return P(poly([(47, 14), (13, 50), (47, 86)])) + P(poly([(53, 14), (87, 50), (53, 86)]))
    if v == 3:
        return S("M44 22L20 30V56L44 80", 11) + mirror(S("M44 22L20 30V56L44 80", 11))
    if v == 4:
        return S(L, 11) + mirror(S(L, 11)) + P(T_poly(50, 38, 18, 6, 6, 24))
    if v == 5:
        return S("M60 18L24 50L60 82", 11) + mirror(S("M60 18L24 50L60 82", 11, color=INK))
    if v == 6:
        return S(L, 10) + mirror(S(L, 10)) + S(cd(50, 50, 8), 5)
    if v == 7:
        return rot(S(L, 12) + mirror(S(L, 12)) + P(cd(50, 50, 7)), 90)


# ---------------------------------------------------------------- 6 padlock T
def fam_padlock(v):
    tk = T_poly(50, 55, 20, 7, 7, 22)
    if v == 0:
        return S("M34 46V32A16 16 0 0 1 66 32V46", 9) + P(rr(20, 44, 60, 44, 8) + tk, rule="evenodd")
    if v == 1:
        return S("M35 46V34A15 15 0 0 1 65 34V46", 12) + P(rr(18, 42, 64, 46, 16) + tk, rule="evenodd")
    if v == 2:
        return S("M37 40V30A13 13 0 0 1 63 30V40", 9) + P(cd(50, 62, 27) + T_poly(50, 52, 20, 7, 7, 22), rule="evenodd")
    if v == 3:
        return S("M66 46V32A16 16 0 0 0 34 32V24", 9) + P(rr(20, 44, 60, 44, 8) + tk, rule="evenodd")
    if v == 4:
        return S("M30 46V22H70V46", 9, cap="butt", join="miter") + P(rr(18, 44, 64, 44, 4) + tk, rule="evenodd")
    if v == 5:
        return S("M36 42V30A14 14 0 0 1 64 30V42", 9) + P(shield(20, 80, 40, 60, 92, r=6) + T_poly(50, 52, 20, 7, 7, 22), rule="evenodd")
    if v == 6:
        return S("M34 46V32A16 16 0 0 1 66 32V46", 7) + S(rr(22, 46, 56, 40, 8), 7) + P(T_poly(50, 56, 20, 7, 7, 20))
    if v == 7:
        kh = cd(50, 61, 6) + poly([(47, 63), (53, 63), (55, 76), (45, 76)])
        return S("M34 46V32A16 16 0 0 1 66 32V46", 9) + P(rr(20, 44, 60, 44, 8)) + P(cd(50, 61, 6), fill=BG) + P(poly([(46.5, 63), (53.5, 63), (55, 76), (45, 76)]), fill=BG)


# ---------------------------------------------------------------- 7 lock-bubble
def fam_bubblelock(v):
    shackle = S("M36 42V31A14 14 0 0 1 64 31V42", 9)
    body = P(rr(18, 40, 64, 42, 12))
    tailL = P(poly([(24, 74), (22, 94), (42, 80)]))
    tailR = mirror(tailL)
    dots = "".join(P(cd(x, 61, 4.2), fill=BG) for x in (37, 50, 63))
    chk = S("M38 61L46 69L63 52", 7, BG)
    if v == 0:
        return shackle + body + tailL + dots
    if v == 1:
        return shackle + body + tailR + chk
    if v == 2:
        return shackle + body + tailL + P(T_poly(50, 52, 22, 7, 7, 21), fill=BG)
    if v == 3:
        return S("M36 42V31A14 14 0 0 1 64 31V42", 7) + S(rr(20, 42, 60, 38, 11), 7) + S("M28 80L26 92L40 81", 7) + "".join(P(cd(x, 61, 4)) for x in (38, 50, 62))
    if v == 4:
        return shackle + P(cd(50, 62, 28)) + P(poly([(28, 78), (18, 92), (40, 86)])) + chk
    if v == 5:
        return shackle + body + P(poly([(50, 80), (50, 94), (62, 80)])) + dots
    if v == 6:
        return S("M40 40V33A10 10 0 0 1 60 33V40", 8) + body + tailL + chk
    if v == 7:
        return S("M36 42V31A14 14 0 0 1 64 31V42", 9) + P(rr(18, 40, 64, 42, 21)) + tailL + dots


# ---------------------------------------------------------------- 8 interlocking rings
def interlock(c1, c2, r, sw, gap=3.5, delta=0.42):
    (x1, y1), (x2, y2) = c1, c2
    dx, dy = x2 - x1, y2 - y1
    d = math.hypot(dx, dy)
    h = math.sqrt(max(r * r - (d / 2) ** 2, 0))
    mx, my = (x1 + x2) / 2, (y1 + y2) / 2
    ux, uy = -dy / d, dx / d
    p_top = (mx - ux * h, my - uy * h)
    p_bot = (mx + ux * h, my + uy * h)
    out = S(cd(x1, y1, r), sw) + S(cd(x2, y2, r), sw)
    a = math.atan2(p_top[1] - y1, p_top[0] - x1)
    seg = arc_d(x1, y1, r, a - delta, a + delta)
    out += S(seg, sw + 2 * gap, BG, cap="butt") + S(seg, sw, cap="butt")
    b = math.atan2(p_bot[1] - y2, p_bot[0] - x2)
    seg2 = arc_d(x2, y2, r, b - delta, b + delta)
    out += S(seg2, sw + 2 * gap, BG, cap="butt") + S(seg2, sw, cap="butt")
    return out


def fam_rings(v):
    if v == 0:
        return interlock((36, 50), (64, 50), 22, 8)
    if v == 1:
        return interlock((50, 36), (50, 64), 22, 8)
    if v == 2:
        return interlock((38, 50), (62, 50), 24, 11)
    if v == 3:
        return interlock((34, 50), (66, 50), 20, 6) + P(cd(50, 50, 4))
    if v == 4:
        return rot(interlock((36, 50), (64, 50), 22, 8), -35)
    if v == 5:
        return interlock((38, 50), (64, 50), 20, 7, delta=0.5) + P(cd(38, 50, 7))
    if v == 6:
        return (S(cd(36, 50, 22), 8) + S(cd(64, 50, 22), 8)
                + P("M50 33A22 22 0 0 1 50 67A22 22 0 0 1 50 33Z"))
    if v == 7:
        c = S(arc_d(38, 50, 20, 0.6, 2 * math.pi - 0.6), 9)
        return c + mirror(c)


# ---------------------------------------------------------------- 9 seal
def fam_seal(v):
    if v == 0:
        return P(wavy_circle(50, 50, 40, 2.6, 16) + T_poly(50, 32, 32, 10, 10, 38), rule="evenodd")
    if v == 1:
        return P(wavy_circle(50, 50, 40, 2.6, 24)) + S(cd(50, 50, 31), 2.5, BG) + P(T_poly(50, 34, 28, 9, 9, 33), fill=BG)
    if v == 2:
        star = []
        for i in range(32):
            t = math.pi * i / 16
            rr_ = 42 if i % 2 == 0 else 37
            star.append((50 + rr_ * math.cos(t), 50 + rr_ * math.sin(t)))
        return P(poly(star)) + S("M35 51L46 62L66 40", 9, BG)
    if v == 3:
        return S(cd(50, 50, 38), 5) + S(cd(50, 50, 29), 2) + P(T_poly(50, 35, 26, 8, 8, 30))
    if v == 4:
        return P(wavy_circle(50, 50, 40, 3, 12)) + P(cd(50, 50, 26), fill=BG) + P(cd(50, 50, 16))
    if v == 5:
        return P(wavy_circle(50, 50, 40, 2.2, 20) + cd(50, 50, 30), rule="evenodd") + P(T_poly(50, 34, 28, 9, 9, 32))
    if v == 6:
        ticks = "".join(S(f"M{f(50+36*math.cos(t))} {f(50+36*math.sin(t))}L{f(50+42*math.cos(t))} {f(50+42*math.sin(t))}", 3)
                        for t in [i * math.pi / 18 for i in range(36)])
        return ticks + P(cd(50, 50, 30) + T_poly(50, 35, 26, 8, 8, 30), rule="evenodd")
    if v == 7:
        return P(wavy_circle(50, 50, 40, 2.6, 16)) + S("M36 52L46 62L65 41", 8, BG) + S(cd(50, 50, 32), 2, BG)


# ---------------------------------------------------------------- 10 venn lens
LENS = "M50 31.56A22 22 0 0 1 50 68.44A22 22 0 0 1 50 31.56Z"


def fam_venn(v):
    if v == 0:
        return S(cd(38, 50, 22), 5) + S(cd(62, 50, 22), 5) + P(LENS)
    if v == 1:
        return P(LENS)
    if v == 2:
        return P(cd(38, 50, 22) + LENS, rule="evenodd") + mirror(P(cd(38, 50, 22) + LENS, rule="evenodd"))
    if v == 3:
        return S(cd(38, 50, 22), 3) + S(cd(62, 50, 22), 3) + P(LENS) + P(T_poly(50, 42, 10, 3, 3, 16), fill=BG)
    if v == 4:
        return rot(S(cd(38, 50, 22), 6) + S(cd(62, 50, 22), 6) + P(LENS), 90)
    if v == 5:
        return P(cd(38, 50, 22)) + S(cd(62, 50, 22), 6) + P(LENS, fill=BG) + S(LENS, 2)
    if v == 6:
        return S(cd(36, 50, 24), 7) + S(cd(64, 50, 24), 7) + S("M44 50L48.5 54.5L56 46", 4)
    if v == 7:
        big = "M50 18.8A32 32 0 0 1 50 81.2A32 32 0 0 1 50 18.8Z"
        return P(big) + P(cd(50, 50, 7), fill=BG)


# ---------------------------------------------------------------- 11 interlocking hooks
def fam_hooks(v):
    A = "M18 28H58Q70 28 70 40V58"
    B = "M82 72H42Q30 72 30 60V42"
    if v == 0:
        return S(A, 11) + S(B, 11) + S("M70 44V58", 17, BG, cap="butt") + S("M70 40V58", 11)
    if v == 1:
        return S(A, 11, cap="butt") + S(B, 11, cap="butt")
    if v == 2:
        return S("M18 30H56Q68 30 68 42V60", 12, cap="square", join="miter") + S("M82 70H44Q32 70 32 58V40", 12, cap="square", join="miter")
    if v == 3:
        return rot(S(A, 11) + S(B, 11), 45)
    if v == 4:
        return S("M20 36H60V64", 10, join="miter", cap="butt") + S("M80 64H40V36", 10, join="miter", cap="butt") + S("M60 40V60", 16, BG, cap="butt") + S("M60 34V64", 10, cap="butt")
    if v == 5:
        return S("M18 34H50A16 16 0 0 1 50 66", 10) + S("M82 66H50A16 16 0 0 1 50 34", 10)
    if v == 6:
        return S(A, 7) + S(B, 7) + P(cd(50, 50, 6))
    if v == 7:
        return S("M24 22H64Q76 22 76 34V50", 12) + S("M76 78H36Q24 78 24 66V50", 12)


# ---------------------------------------------------------------- 12 keyhole
def keyhole(cx=50, cy=40, r=13, w0=12, w1=20, bot=80):
    return cd(cx, cy, r) + poly([(cx - w0 / 2, cy + r * 0.5), (cx + w0 / 2, cy + r * 0.5), (cx + w1 / 2, bot), (cx - w1 / 2, bot)])


def fam_keyhole(v):
    if v == 0:
        return P(cd(50, 40, 15)) + P(poly([(43, 46), (57, 46), (62, 82), (38, 82)]))
    if v == 1:
        return P(cd(50, 50, 42)) + P(cd(50, 40, 11), fill=BG) + P(poly([(45, 44), (55, 44), (59, 72), (41, 72)]), fill=BG)
    if v == 2:
        return P(rr(10, 10, 80, 80, 20)) + P(cd(50, 40, 11), fill=BG) + P(poly([(45, 44), (55, 44), (59, 72), (41, 72)]), fill=BG)
    if v == 3:
        return P(rr(30, 16, 40, 16, 8)) + P(poly([(43, 30), (57, 30), (62, 84), (38, 84)]))
    if v == 4:
        return P(shield(r=8)) + P(cd(50, 42, 10), fill=BG) + P(poly([(45.5, 45), (54.5, 45), (58, 70), (42, 70)]), fill=BG)
    if v == 5:
        return P(cd(50, 30, 14)) + P(rr(26, 50, 48, 36, 18))
    if v == 6:
        return S(cd(50, 40, 15), 7) + S("M44 56L40 82H60L56 56", 7, join="round")
    if v == 7:
        return P(cd(50, 50, 42) + cd(50, 38, 9), rule="evenodd") + P(poly([(45.5, 44), (54.5, 44), (58, 70), (42, 70)]), fill=BG)


# ---------------------------------------------------------------- 13 vault dial
def fam_vault(v):
    def ticks(n, r0, r1, sw):
        return "".join(S(f"M{f(50+r0*math.cos(t))} {f(50+r0*math.sin(t))}L{f(50+r1*math.cos(t))} {f(50+r1*math.sin(t))}", sw, cap="butt")
                       for t in [i * 2 * math.pi / n for i in range(n)])
    spokes = "".join(S(f"M50 50L{f(50+22*math.cos(t))} {f(50+22*math.sin(t))}", 7) for t in (-math.pi / 2, math.pi / 6, 5 * math.pi / 6))
    if v == 0:
        return S(cd(50, 50, 36), 7) + spokes + P(cd(50, 50, 8))
    if v == 1:
        return ticks(24, 36, 42, 3) + P(cd(50, 50, 30)) + P(T_poly(50, 36, 24, 7, 7, 28), fill=BG)
    if v == 2:
        return P(rr(12, 12, 76, 76, 12)) + S(cd(50, 50, 24), 6, BG) + P(cd(50, 50, 6), fill=BG)
    if v == 3:
        return S(cd(50, 50, 38), 4) + ticks(12, 26, 32, 4) + P(cd(50, 50, 14))
    if v == 4:
        return S(cd(50, 50, 36), 8) + S("M50 26V74M26 50H74", 7)
    if v == 5:
        return P(cd(50, 50, 40)) + ticks(36, 30, 35, 2).replace(INK, BG) + P(cd(50, 50, 14), fill=BG) + P(poly([(50, 14), (46, 20), (54, 20)]), fill=BG)
    if v == 6:
        return S(cd(50, 50, 36), 7) + S("M50 50L50 28M50 50L69 61", 7) + P(cd(50, 50, 7))
    if v == 7:
        return P(rr(14, 14, 72, 72, 8)) + S(cd(50, 50, 22), 5, BG) + S("M50 32V68M32 50H68", 5, BG)


# ---------------------------------------------------------------- 14 corner brackets
def fam_corners(v):
    c = "M16 34V16H34"
    four = "".join(rot(S(c, 7, cap="square", join="miter"), a) for a in (0, 90, 180, 270))
    two = S(c, 7, cap="square", join="miter") + rot(S(c, 7, cap="square", join="miter"), 180)
    if v == 0:
        return four + P(rr(34, 34, 32, 32, 3))
    if v == 1:
        return two + P(cd(50, 50, 16))
    if v == 2:
        return four + P(cd(50, 50, 14))
    if v == 3:
        return two + S("M36 52L46 62L66 40", 8)
    if v == 4:
        return four + P(T_poly(50, 34, 30, 9, 9, 32))
    if v == 5:
        r4 = "".join(rot(S("M16 36V24Q16 16 24 16H36", 7), a) for a in (0, 90, 180, 270))
        return r4 + P(rr(36, 36, 28, 28, 14))
    if v == 6:
        return two + P(shield(34, 66, 30, 50, 72, r=3))
    if v == 7:
        return S("M30 16H16V84H30", 7, cap="square", join="miter") + mirror(S("M30 16H16V84H30", 7, cap="square", join="miter")) + P(rr(34, 34, 32, 32, 3))


# ---------------------------------------------------------------- 15 T-check
def fam_Tcheck(v):
    if v == 0:
        return S("M22 24H78M50 24V78M34 62L50 78", 11)
    if v == 1:
        return S("M22 24H78", 12) + S("M50 24V80L32 62", 12, join="miter", cap="round")
    if v == 2:
        return rot(S("M24 28H76M50 28V80M32 62L50 80", 11), 15)
    if v == 3:
        return S("M20 24H80", 12, cap="butt") + S("M50 30V72Q50 82 40 76L32 70", 12, cap="butt")
    if v == 4:
        return S("M22 22H78", 12) + S("M30 56L46 72L72 40", 12)
    if v == 5:
        return S("M18 22H82", 11) + S("M50 22V50", 11) + S("M30 60L44 74L72 44", 11)
    if v == 6:
        return P(cd(50, 50, 42)) + S("M30 32H70M50 32V70M38 58L50 70", 8, BG)
    if v == 7:
        return S("M22 24H78", 12) + S("M50 36V78", 12) + S("M50 78L76 52", 12)


# ---------------------------------------------------------------- 16 hourglass
def fam_hourglass(v):
    if v == 0:
        return P(rr(22, 12, 56, 8, 3)) + P(rr(22, 80, 56, 8, 3)) + P(poly([(28, 24), (72, 24), (50, 50)])) + P(poly([(28, 76), (72, 76), (50, 50)]))
    if v == 1:
        return S("M24 14H76M24 86H76", 8) + S("M30 14L70 86M70 14L30 86", 7)
    if v == 2:
        return P(rr(20, 12, 60, 10, 2)) + P(poly([(30, 22), (70, 22), (54, 50), (70, 86), (30, 86), (46, 50)]), extra='opacity="1"') + P(poly([(36, 30), (64, 30), (50, 46)]), fill=BG)
    if v == 3:
        return S("M28 16H72L28 84H72Z", 7, join="round") + P(cd(50, 66, 5))
    if v == 4:
        return P(T_poly(50, 12, 60, 10, 10, 16)) + P(poly([(30, 30), (70, 30), (50, 56)])) + P(poly([(50, 56), (72, 88), (28, 88)]))
    if v == 5:
        return P(rr(14, 14, 72, 72, 18)) + P(poly([(34, 30), (66, 30), (50, 50)]), fill=BG) + P(poly([(50, 50), (66, 70), (34, 70)]), fill=BG)
    if v == 6:
        return P(poly([(24, 16), (76, 16), (50, 50)])) + S(poly([(29, 82), (71, 82), (50, 56)]), 5)
    if v == 7:
        return rot(P(rr(22, 12, 56, 8, 3)) + P(rr(22, 80, 56, 8, 3)) + P(poly([(28, 24), (72, 24), (50, 50)])) + P(poly([(28, 76), (72, 76), (50, 50)])), 90)


# ---------------------------------------------------------------- 17 anchor T
def fam_anchor(v):
    arc = "M22 58Q26 84 50 86Q74 84 78 58"
    if v == 0:
        return S("M50 24V84M32 36H68", 9) + S(arc, 9) + S(cd(50, 15, 6), 5)
    if v == 1:
        return S("M50 18V84", 10) + S("M26 30H74", 10) + S(arc, 10)
    if v == 2:
        return S("M50 18V84M24 26H76", 11, cap="butt") + S("M22 56Q26 84 50 86Q74 84 78 56", 11, cap="butt") + P(poly([(14, 60), (28, 52), (24, 66)])) + mirror(P(poly([(14, 60), (28, 52), (24, 66)])))
    if v == 3:
        return P(T_poly(50, 14, 52, 11, 11, 72)) + S("M24 58A26 26 0 0 0 76 58", 10, cap="butt")
    if v == 4:
        return S("M50 16V86", 9) + S("M30 64Q34 82 50 84Q66 82 70 64", 9) + S("M36 30H64", 9)
    if v == 5:
        return P(cd(50, 50, 42)) + S("M50 26V74M38 34H62", 6, BG) + S("M32 56Q35 72 50 74Q65 72 68 56", 6, BG)
    if v == 6:
        return S("M50 20V84M30 30H70", 9) + S("M24 62L50 84L76 62", 9)
    if v == 7:
        return S("M50 14V84", 8) + S("M22 26H78", 8) + S("M18 58Q22 86 50 86Q78 86 82 58", 8) + P(cd(50, 84, 6))


# ---------------------------------------------------------------- 18 guardian dog
def fam_dog(v):
    head = "M20 16L36 30H64L80 16V54C80 74 66 84 50 90C34 84 20 74 20 54Z"
    if v == 0:
        return P(head + cd(38, 54, 4.5) + cd(62, 54, 4.5) + poly([(44, 66), (56, 66), (50, 74)]), rule="evenodd")
    if v == 1:
        return P(head + T_poly(50, 44, 28, 8, 8, 30), rule="evenodd")
    if v == 2:
        h2 = "M18 22Q18 12 28 16L40 26H60L72 16Q82 12 82 22V52C82 74 66 86 50 90C34 86 18 74 18 52Z"
        return P(h2 + cd(38, 52, 4.5) + cd(62, 52, 4.5), rule="evenodd") + P(rr(44, 64, 12, 7, 3.5), fill=BG)
    if v == 3:
        return S(head, 6) + P(cd(38, 54, 4)) + P(cd(62, 54, 4)) + P(poly([(45, 66), (55, 66), (50, 72)]))
    if v == 4:
        h = "M22 20L38 34H62L78 20V50C78 66 66 76 50 80C34 76 22 66 22 50Z"
        return P(h) + P(cd(39, 52, 4), fill=BG) + P(cd(61, 52, 4), fill=BG) + S("M38 88H62", 6)
    if v == 5:
        return P(head) + S("M34 56L46 66L66 46", 8, BG)
    if v == 6:
        return P("M20 16L36 30H50V90C34 84 20 74 20 54Z") + S(head, 5) + P(cd(62, 54, 4.5))
    if v == 7:
        sq = "M18 14L34 28H66L82 14V78Q82 88 72 88H28Q18 88 18 78Z"
        return P(sq + cd(38, 54, 5) + cd(62, 54, 5), rule="evenodd")


# ---------------------------------------------------------------- 19 modular T
def fam_modT(v):
    if v == 0:
        cells = [(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)]
        return "".join(P(rr(17 + c * 23, 17 + r * 23, 20, 20, 3)) for c, r in cells)
    if v == 1:
        cells = [(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)]
        return "".join(P(cd(27 + c * 23, 27 + r * 23, 10)) for c, r in cells)
    if v == 2:
        return P(rr(17, 17, 31, 20, 3)) + P(rr(52, 17, 31, 20, 3)) + P(rr(40, 41, 20, 42, 3))
    if v == 3:
        cells = [(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)]
        return "".join(P(cd(27 + c * 23, 27 + r * 23, 10)) if (c, r) != (1, 0) else P(rr(40, 17, 20, 20, 3)) for c, r in cells)
    if v == 4:
        return P(cd(28, 28, 12)) + P(cd(72, 28, 12)) + P(rr(38, 44, 24, 40, 12))
    if v == 5:
        cells = [(c, r) for c in range(5) for r in range(5) if r == 0 or c == 2]
        return "".join(P(cd(18 + c * 16, 18 + r * 16, 6)) for c, r in cells)
    if v == 6:
        return P(rr(14, 16, 34, 20, 10)) + P(rr(52, 16, 34, 20, 10)) + P(rr(40, 40, 20, 46, 10))
    if v == 7:
        cells = [(0, 0), (1, 0), (2, 0), (1, 1), (1, 2)]
        return "".join(P(rr(17 + c * 23, 17 + r * 23, 20, 20, 3)) if (c, r) != (1, 1) else S(rr(42, 42, 16, 16, 2), 4) for c, r in cells)


# ---------------------------------------------------------------- 20 key
def fam_key(v):
    if v == 0:
        return S(cd(30, 50, 14), 8) + S("M44 50H84", 8) + P(T_poly(76, 50, 14, 0.01, 6, 16))
    if v == 1:
        return P(cd(30, 50, 18) + cd(30, 50, 7), rule="evenodd") + P(rr(46, 46, 40, 8, 2)) + P(rr(66, 54, 6, 12, 1)) + P(rr(78, 54, 6, 16, 1))
    if v == 2:
        return rot(S(cd(30, 50, 14), 8) + S("M44 50H84M74 50V64M84 50V60", 8), -45)
    if v == 3:
        return S(cd(50, 26, 13), 8) + S("M50 39V86M50 64H62M50 78H66", 8)
    if v == 4:
        return P(shield(30, 70, 12, 26, 44, r=4) + cd(50, 26, 5), rule="evenodd") + P(rr(46, 42, 8, 44, 1)) + P(rr(54, 66, 10, 6)) + P(rr(54, 78, 14, 6))
    if v == 5:
        return S(cd(30, 50, 14), 8) + S("M44 50H72", 8) + P(T_poly(78, 40, 8, 20, 0.01, 20))
    if v == 6:
        return P(rr(14, 34, 32, 32, 9)) + P(cd(30, 50, 6), fill=BG) + P(rr(44, 46, 42, 8)) + P(T_poly(78, 54, 14, 6, 6, 18))
    if v == 7:
        return S("M24 22H76", 10) + S("M50 22V86M50 64H62M50 78H66", 10)


# ---------------------------------------------------------------- 21 Ty ligature
def fam_Ty(v):
    if v == 0:
        return S("M14 22H86", 10) + S("M34 22V82", 10) + S("M54 40L68 66M82 40L62 88", 9)
    if v == 1:
        return S("M18 24H62M40 24V82", 11) + S("M56 42L68 64M80 42L62 86", 10)
    if v == 2:
        return P(rr(12, 16, 76, 12, 2)) + P(rr(28, 28, 12, 56, 0)) + S("M52 36L66 62M80 36L60 88", 10, cap="butt", join="miter")
    if v == 3:
        return S("M16 20H84", 9) + S("M50 20V50L30 82M50 50L70 82", 9)
    if v == 4:
        return S("M16 22H84M50 22V44", 10) + S("M32 44L50 66L68 44M50 66V86", 10)
    if v == 5:
        return S("M14 24H60M37 24V84", 12, cap="butt") + S("M58 42L70 64", 10, cap="butt") + S("M84 42L66 88", 10, cap="butt")
    if v == 6:
        return S("M20 22H80M50 22V58", 10) + S("M30 46Q30 72 50 72Q70 72 70 46M70 46V80Q70 90 58 90", 10)
    if v == 7:
        return S("M14 20H86", 8) + S("M30 20V80", 8) + S("M50 36L64 60M78 36L58 84", 8) + P(cd(80, 82, 5))


# ---------------------------------------------------------------- 22 exchange
def fam_exchange(v):
    if v == 0:
        return S("M18 38H80M66 24L80 38", 9) + S("M82 62H20M34 76L20 62", 9)
    if v == 1:
        return S("M18 40H80L64 26", 9) + S("M82 60H20L36 74", 9)
    if v == 2:
        return S(arc_d(50, 50, 30, math.pi * 1.05, math.pi * 1.95), 9) + P(poly([(80, 40), (86, 56), (70, 52)])) + S(arc_d(50, 50, 30, math.pi * 0.05, math.pi * 0.95), 9) + P(poly([(20, 60), (14, 44), (30, 48)]))
    if v == 3:
        return S("M18 40H80L64 26", 9) + S("M82 60H20L36 74", 9) + P(cd(50, 50, 4))
    if v == 4:
        return P(T_poly(50, 18, 64, 10, 10, 66)) + P(poly([(18, 30), (18, 54), (8, 42)]), fill=INK) + mirror(P(poly([(18, 30), (18, 54), (8, 42)])))
    if v == 5:
        return S("M20 32H76L62 18", 10, cap="butt", join="miter") + S("M80 68H24L38 82", 10, cap="butt", join="miter")
    if v == 6:
        return P(rr(10, 10, 80, 80, 20)) + S("M28 42H70L60 32", 7, BG) + S("M72 58H30L40 68", 7, BG)
    if v == 7:
        return S("M24 70V40Q24 26 38 26H70L60 16", 9) + S("M76 30V60Q76 74 62 74H30L40 84", 9)


# ---------------------------------------------------------------- 23 bubble T
def fam_bubbleT(v):
    bub = rr(14, 16, 72, 58, 16)
    tail = poly([(26, 70), (22, 90), (44, 74)])
    if v == 0:
        return P(bub + T_poly(50, 30, 30, 9, 9, 32), rule="evenodd") + P(tail)
    if v == 1:
        return P(cd(50, 46, 34) + T_poly(50, 30, 28, 9, 9, 32), rule="evenodd") + P(poly([(28, 66), (18, 90), (44, 78)]))
    if v == 2:
        return S(bub, 7) + S(poly([(28, 74), (26, 88), (42, 74)], close=False), 7) + P(T_poly(50, 31, 26, 8, 8, 28))
    if v == 3:
        return P(bub) + P(tail) + S("M34 46L45 57L66 35", 8, BG)
    if v == 4:
        return P(rr(14, 16, 72, 58, 29) + T_poly(50, 30, 30, 9, 9, 32), rule="evenodd") + P(poly([(24, 62), (16, 88), (42, 70)]))
    if v == 5:
        return P(bub) + mirror(P(tail)) + "".join(P(cd(x, 45, 5), fill=BG) for x in (34, 50, 66))
    if v == 6:
        return P(rr(10, 14, 52, 42, 12)) + P(poly([(18, 52), (16, 66), (30, 54)])) + P(rr(38, 40, 52, 42, 12)) + mirror(P(poly([(18, 78), (16, 92), (30, 80)]), )) + S(rr(38, 40, 52, 42, 12), 4, BG)
    if v == 7:
        return P(bub) + P(tail) + P(shield(38, 62, 28, 44, 64, r=3), fill=BG)


# ---------------------------------------------------------------- 24 hexagon
def hexd(cx=50, cy=50, r=40, rot0=-90):
    return poly([(cx + r * math.cos(math.radians(rot0 + 60 * i)), cy + r * math.sin(math.radians(rot0 + 60 * i))) for i in range(6)])


def fam_hex(v):
    if v == 0:
        return P(hexd() + T_poly(50, 32, 30, 9, 9, 38), rule="evenodd")
    if v == 1:
        return S(hexd(r=36), 7) + P(T_poly(50, 34, 26, 8, 8, 32))
    if v == 2:
        return P(hexd() + hexd(r=16, rot0=0), rule="evenodd")
    if v == 3:
        return P(hexd()) + S("M34 51L45 62L66 40", 8, BG)
    if v == 4:
        return P(hexd(rot0=0) + T_poly(50, 32, 30, 9, 9, 38), rule="evenodd")
    if v == 5:
        return P(hexd()) + S(hexd(r=30), 3, BG) + P(T_poly(50, 36, 22, 7, 7, 28), fill=BG)
    if v == 6:
        return S(hexd(r=37), 9) + P(cd(50, 50, 8))
    if v == 7:
        return P(hexd() + hexd(r=24), rule="evenodd") + P(T_poly(50, 38, 20, 6, 6, 24))


# ---------------------------------------------------------------- 25 coin
def fam_coin(v):
    if v == 0:
        return P(cd(50, 50, 40) + T_poly(50, 30, 32, 10, 10, 40), rule="evenodd")
    if v == 1:
        return P(cd(50, 50, 40)) + S(cd(50, 50, 31), 3, BG) + P(T_poly(50, 34, 26, 8, 8, 32), fill=BG)
    if v == 2:
        return S(cd(50, 50, 36), 8) + P(T_poly(50, 32, 30, 9, 9, 36))
    if v == 3:
        return P(cd(50, 50, 40)) + P(rr(30, 46, 40, 8, 4), fill=BG)
    if v == 4:
        return P(cd(44, 56, 30)) + S(cd(58, 42, 30), 6, BG) + P(cd(58, 42, 30)) + P(T_poly(58, 28, 22, 7, 7, 26), fill=BG)
    if v == 5:
        return P(cd(50, 50, 40)) + S("M30 42H70M50 42V74M36 30H64", 0.01) + P(T_poly(50, 30, 28, 8, 8, 40), fill=BG) + P(rr(30, 22, 40, 4, 2), fill=BG)
    if v == 6:
        return P(cd(50, 50, 40) + cd(50, 50, 24), rule="evenodd") + P(T_poly(50, 38, 20, 6, 6, 24))
    if v == 7:
        return P("M50 10A40 40 0 0 1 50 90Z") + S(cd(50, 50, 37), 6) + P(T_poly(50, 32, 28, 9, 9, 36), fill=BG) + masked(P(T_poly(50, 32, 28, 9, 9, 36)), '<rect x="50" y="0" width="60" height="100" fill="black"/>', mid="c7")


# ---------------------------------------------------------------- 26 arch / gate
def fam_arch(v):
    if v == 0:
        return P("M18 86V50A32 32 0 0 1 82 50V86H66V52A16 16 0 0 0 34 52V86Z")
    if v == 1:
        return P("M18 86V50A32 32 0 0 1 82 50V86H66V52A16 16 0 0 0 34 52V86Z") + P(poly([(44, 16), (56, 16), (54, 30), (46, 30)]), fill=BG)
    if v == 2:
        return P("M14 88V46A36 36 0 0 1 86 46V88H72V48A22 22 0 0 0 28 48V88Z") + P(T_poly(50, 44, 20, 6, 6, 36))
    if v == 3:
        return S("M24 86V50A26 26 0 0 1 76 50V86", 12, cap="butt")
    if v == 4:
        return P("M14 88V46A36 36 0 0 1 86 46V88H74V48A24 24 0 0 0 26 48V88Z") + P("M34 88V54A16 16 0 0 1 66 54V88H58V56A8 8 0 0 0 42 56V88Z")
    if v == 5:
        return P(rr(12, 12, 76, 76, 6)) + P("M30 88V52A20 20 0 0 1 70 52V88Z", fill=BG)
    if v == 6:
        return P("M18 86V50A32 32 0 0 1 82 50V86H66V52A16 16 0 0 0 34 52V86Z") + P(cd(50, 64, 6))
    if v == 7:
        return S("M20 86V50A30 30 0 0 1 80 50V86M20 86H80", 8, cap="butt", join="miter") + S("M50 20V86", 8, cap="butt")


FAMILIES = [
    ("Split T", "Два участника сделки: T из двух половин", fam_splitT),
    ("Shield T", "Щит с T", fam_shieldT),
    ("t + check", "Строчная t, переходящая в галочку", fam_tcheck),
    ("Braces + coin", "Скобки кода держат монету: деньги под защитой кода", fam_braces),
    ("Chevrons", "Две стороны сходятся в ромб", fam_chevrons),
    ("Padlock T", "Замок с T-скважиной", fam_padlock),
    ("Chat lock", "Замок-сообщение: чат + защита", fam_bubblelock),
    ("Rings", "Сцепленные кольца: связь сторон", fam_rings),
    ("Seal", "Печать гаранта", fam_seal),
    ("Venn", "Пересечение: зона доверия", fam_venn),
    ("Hooks", "Сцепленные крюки: рукопожатие", fam_hooks),
    ("Keyhole", "Замочная скважина / силуэт человека", fam_keyhole),
    ("Vault", "Сейф", fam_vault),
    ("Corners", "Рамка держит ценность", fam_corners),
    ("T-check", "T с галочкой", fam_Tcheck),
    ("Hourglass", "Время удержания (эскроу)", fam_hourglass),
    ("Anchor T", "Якорь из T: надёжность", fam_anchor),
    ("Guard dog", "Верный пёс-охранник (trusty = верный)", fam_dog),
    ("Modular T", "T из модулей", fam_modT),
    ("Key", "Ключ", fam_key),
    ("Ty", "Лигатура Ty", fam_Ty),
    ("Exchange", "Обмен: деньги ⇄ работа", fam_exchange),
    ("Bubble T", "Сообщение с T", fam_bubbleT),
    ("Hex", "Гайка/шестигранник", fam_hex),
    ("Coin", "Монета с T", fam_coin),
    ("Arch", "Арка/врата: безопасный проход", fam_arch),
]


def main(out):
    os.makedirs(out, exist_ok=True)
    index = []
    n = 0
    for fi, (name, note, fn) in enumerate(FAMILIES):
        for v in range(8):
            n += 1
            inner = fn(v)
            with open(os.path.join(out, f"{n:03d}.svg"), "w") as fh:
                fh.write(svg(inner))
            index.append({"id": n, "family": fi + 1, "name": name, "variant": v, "note": note})
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(index, fh, ensure_ascii=False, indent=1)
    print(n, "concepts")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
