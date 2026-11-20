"""Round 3: hybrids — elements of the round-2 shortlist combined.

Usage: python3 round3.py <out_dir>
"""
import json
import os
import sys

from svglib import BG, INK, P, S, T_poly, cd, mirror, poly, rr, shield, svg

BRK = "M43 14L20 23V49C20 64 29 76 44 85"


def bracket_shield(sw=10, path=BRK):
    return S(path, sw) + mirror(S(path, sw))


def tcheck_small(color=INK, sw=7, dx=0, dy=0):
    stem = f"M{45+dx} {31+dy}V{54+dy}C{45+dx} {60.5+dy} {48.5+dx} {66+dy} {52+dx} {62.5+dy}L{66+dx} {45+dy}"
    bar = f"M{37+dx} {40+dy}H{56+dx}"
    return S(stem, sw, color) + S(bar, sw, color)


def h01():
    return bracket_shield(9) + tcheck_small(sw=7, dx=-1, dy=0)


def h02():
    return bracket_shield(10) + S("M39 37H61M50 37V61", 8)


def h03():
    L = "M44 14L27 20Q22 21.8 22 27V39Q22 45.5 16 46.5Q22 47.5 22 54V58C22 70 31 79 44 86"
    return S(L, 9) + mirror(S(L, 9)) + P(cd(50, 49, 8))


def h04():
    return bracket_shield(10) + S("M39 49L47 57L62 41", 8)


def h06():
    return (S("M40 14V60C40 69 43.5 75 49 76.5", 12) + S("M24 34H60", 12)
            + S("M60 69.5L84 42", 12))


def h07():
    return P(shield(16, 84, 12, 46, 90, r=8)) + tcheck_small(BG, 8, dx=-2, dy=1)


def h09():
    L = "M43 28H35L20 15V52C20 67 30 78 44 86"
    return S(L, 9) + mirror(S(L, 9)) + P(cd(50, 55, 7.5))


def h10():
    head = "M18 14L36 30H64L82 14V52C82 73 67 84 50 90C33 84 18 73 18 52Z"
    return P(head) + tcheck_small(BG, 8, dx=-2, dy=8)


def h11():
    def cut(y, off):
        return 57 - (y - 20) / 62 * 14 + off
    s = 0.62
    Lp = [(16, 20), (cut(20, -2.2), 20), (cut(82, -2.2), 82), (40, 82), (40, 38), (16, 38)]
    Rp = [(cut(20, 2.2), 20), (84, 20), (84, 38), (60, 38), (60, 82), (cut(82, 2.2), 82)]
    g = P(poly(Lp), fill=BG) + P(poly(Rp), fill=BG)
    return P(cd(50, 50, 46)) + f'<g transform="translate(50 50) scale({s}) translate(-50 -51)">{g}</g>'


def h12():
    L = "M46 12L20 28V50C20 66 30 78 44 86"
    return S(L, 10) + mirror(S(L, 10)) + P(cd(50, 52, 8))


def h13():
    return bracket_shield(8) + S(cd(50, 49, 7.5), 5)


def h14():
    g = bracket_shield(10, BRK).replace(INK, BG) + P(cd(50, 49, 8), fill=BG)
    return P(cd(50, 50, 46)) + f'<g transform="translate(50 50) scale(0.6) translate(-50 -49.5)">{g}</g>'


def h15():
    return P(rr(10, 20, 30, 16, 8)) + P(rr(60, 20, 30, 16, 8)) + P(cd(50, 28, 12.5)) + P(rr(42, 45, 16, 41, 8))


def h16():
    L = "M44 14L27 20Q22 21.8 22 27V39Q22 45.5 16 46.5Q22 47.5 22 54V58C22 70 31 79 44 86"
    return S(L, 9) + mirror(S(L, 9)) + S("M40 38H60M50 38V62", 7.5)


def h05():
    # brackets-shield whose inner space holds the split T (two halves)
    Ls = [(36, 34), (48.6, 34), (48.6, 64), (45.5, 64), (45.5, 41), (36, 41)]
    return bracket_shield(9) + P(poly(Ls)) + P(poly([(100 - x, y) for x, y in Ls]))


def h08():
    # split-T crossbar holding the coin, inside avatar circle
    g = (P(rr(10, 20, 30, 16, 8), fill=BG) + P(rr(60, 20, 30, 16, 8), fill=BG)
         + P(cd(50, 28, 12.5), fill=BG) + P(rr(42, 45, 16, 41, 8), fill=BG))
    return P(cd(50, 50, 46)) + f'<g transform="translate(50 50) scale(0.62) translate(-50 -53)">{g}</g>'


DESIGNS = [
    (1, "18 + 08", "Bracket shield + t-check", h01),
    (2, "18 + 01", "Bracket shield + T", h02),
    (3, "18 + 13", "Brace shield + coin", h03),
    (4, "18 + 16", "Bracket shield + check", h04),
    (5, "18 + 01", "Bracket shield + split T", h05),
    (6, "08 + 01", "t-check in two pieces", h06),
    (7, "06 + 08", "Shield + t-check knockout", h07),
    (8, "15 + 05", "Coin-T avatar", h08),
    (9, "18 + 25", "Eared bracket shield + coin", h09),
    (10, "25 + 08", "Eared shield + t-check", h10),
    (11, "03", "Diagonal split T avatar", h11),
    (12, "18", "Roof bracket shield + coin", h12),
    (13, "18 + 13", "Bracket shield + ring coin", h13),
    (14, "18", "Bracket shield avatar", h14),
    (15, "05 + 13", "Coin held between two bars (T)", h15),
    (16, "13 + 01", "Brace shield + T", h16),
]


def main(out):
    os.makedirs(out, exist_ok=True)
    idx = []
    for n, src, name, fn in DESIGNS:
        with open(os.path.join(out, f"{n:02d}.svg"), "w") as fh:
            fh.write(svg(fn()))
        idx.append({"id": n, "combines_round2": src, "name": name})
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(idx, fh, ensure_ascii=False, indent=1)
    print(len(idx))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
