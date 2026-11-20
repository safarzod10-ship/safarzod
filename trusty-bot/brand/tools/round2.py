"""Round 2: the 30 strongest round-1 concepts, redrawn with tuned proportions.

Usage: python3 round2.py <out_dir>
"""
import json
import os
import sys

from svglib import BG, INK, P, S, T_poly, cd, masked, mirror, poly, rot, rr, shield, svg


def inset_round(pts, r):
    """Fill + same-colour stroke = polygon with rounded convex corners (r)."""
    return P(poly(pts)) + S(poly(pts), r * 2)


L_HALF = [(16, 20), (48, 20), (48, 82), (40, 82), (40, 38), (16, 38)]


def flipx(pts):
    return [(100 - x, y) for x, y in pts]


def tcheck_paths(sw=12, color=INK, bar="M24 34H60"):
    stem = "M40 14V58C40 70 47.4 81.5 54 74L84 40"
    return S(stem, sw, color) + S(bar, sw, color)


def scaled(inner, s, cx, cy):
    return f'<g transform="translate(50 50) scale({s}) translate({-cx} {-cy})">{inner}</g>'


def brace(x, top, bot, w=12):
    mid = (top + bot) / 2
    return (f"M{x+w} {top}C{x+2} {top} {x+3} {top+8} {x+3} {top+14}V{mid-8}"
            f"C{x+3} {mid-3} {x} {mid} {x-6} {mid}C{x} {mid} {x+3} {mid+3} {x+3} {mid+8}"
            f"V{bot-14}C{x+3} {bot-8} {x+2} {bot} {x+w} {bot}")


def c(n, src, fn):
    return (n, src, fn)


def d01():
    return P(poly(L_HALF)) + P(poly(flipx(L_HALF)))


def d02():
    Ls = [(18.5, 22.5), (45.5, 22.5), (45.5, 79.5), (42.5, 79.5), (42.5, 35.5), (18.5, 35.5)]
    return inset_round(Ls, 2.5) + inset_round(flipx(Ls), 2.5)


def d03():
    def cut(y, off):
        return 57 - (y - 20) / 62 * 14 + off
    Lp = [(16, 20), (cut(20, -1.8), 20), (cut(82, -1.8), 82), (40, 82), (40, 38), (16, 38)]
    Rp = [(cut(20, 1.8), 20), (84, 20), (84, 38), (60, 38), (60, 82), (cut(82, 1.8), 82)]
    return P(poly(Lp)) + P(poly(Rp))


def d04():
    return P(poly([(x, y - 3) for x, y in L_HALF])) + P(poly([(x, y + 3) for x, y in flipx(L_HALF)]))


def d05():
    return (P(rr(41, 26, 18, 60, 9)) + P(rr(12, 18, 46, 18, 9))
            + S(rr(42, 18, 46, 18, 9), 5, BG) + P(rr(42, 18, 46, 18, 9)))


def d06():
    cuts = ('<rect x="0" y="31" width="100" height="6" fill="black"/>'
            '<rect x="47" y="31" width="6" height="70" fill="black"/>')
    return masked(P(shield(16, 84, 12, 46, 90, r=7)), cuts)


def d07():
    return P("M18 14H47V89C31 81 18 69 18 47Z") + S(shield(20.5, 79.5, 16.5, 46, 86.5, r=0), 5)


def d08():
    return tcheck_paths()


def d09():
    return P(cd(50, 50, 46)) + scaled(tcheck_paths(12, BG), 0.62, 54, 48)


def d10():
    return P(rr(6, 6, 88, 88, 26)) + scaled(tcheck_paths(12, BG), 0.62, 54, 48)


def d11():
    return S("M40 12V68L52 80L86 42", 13, cap="butt", join="miter") + S("M22 32H62", 13, cap="butt")


def d12():
    return tcheck_paths(bar="M40 34H64")


def d13():
    bl = brace(18, 16, 84)
    return S(bl, 7) + mirror(S(bl, 7)) + P(cd(50, 50, 11))


def d14():
    sq = S("M32 18H20V82H32", 8, cap="square", join="miter")
    return sq + mirror(sq) + P(cd(50, 50, 11))


def d15():
    bl = brace(18, 16, 84)
    return S(bl, 7) + mirror(S(bl, 7)) + P(cd(50, 50, 15)) + P(T_poly(50, 43, 15, 4.5, 4.5, 15), fill=BG)


def d16():
    bl = brace(18, 16, 84)
    return S(bl, 7) + mirror(S(bl, 7)) + S("M39 51L46.5 58.5L62 42", 7.5)


def d17():
    L = "M42 20L16 50L42 80"
    return S(L, 11) + mirror(S(L, 11)) + P(cd(50, 50, 8))


def d18():
    L = "M43 14L20 23V49C20 64 29 76 44 85"
    return S(L, 10) + mirror(S(L, 10)) + P(cd(50, 49, 8))


def d19():
    L = "M44 12L18 22V48C18 66 28 78 45 88"
    return S(L, 13, cap="butt", join="miter") + mirror(S(L, 13, cap="butt", join="miter")) + P(cd(50, 50, 9))


def d20():
    return (S("M36 42V31A14 14 0 0 1 64 31V42", 9) + P(rr(16, 40, 68, 42, 14))
            + P(poly([(24, 72), (20, 92), (44, 80)])) + S("M37 61L46 70L64 52", 7.5, BG))


def d21():
    A = "M18 28H58Q70 28 70 40V58"
    B = "M82 72H42Q30 72 30 60V42"
    return rot(S(A, 11) + S(B, 11), 45)


def d22():
    return S("M22 22H62Q76 22 76 36V50", 11) + S("M78 78H38Q24 78 24 64V50", 11) + P(cd(50, 50, 7))


def d23():
    return P(cd(50, 30, 13)) + P(rr(24, 50, 52, 36, 18))


def d24():
    return S("M22 22H78", 12) + S("M48 22V78", 12) + S("M32 62L48 78L76 50", 12)


def d25():
    head = "M18 14L36 30H64L82 14V52C82 73 67 84 50 90C33 84 18 73 18 52Z"
    return P(head + T_poly(50, 42, 28, 8, 8, 30), rule="evenodd")


def d26():
    head = "M28 26H72Q80 26 80 34V54C80 72 66 82 50 88C34 82 20 72 20 54V34Q20 26 28 26Z"
    earL = "M22 28C14 28 10 36 12 50C14 58 20 58 22 52Z"
    return P(head + cd(39, 50, 4) + cd(61, 50, 4), rule="evenodd") + P(earL) + mirror(P(earL)) + P(rr(44, 62, 12, 7, 3.5), fill=BG)


def d27():
    return P(cd(26, 26, 10)) + P(cd(50, 26, 10)) + P(cd(74, 26, 10)) + P(rr(40, 42, 20, 44, 10))


def d28():
    return S("M14 22H86", 10) + S("M34 22V82", 10) + S("M54 40L68 66M82 40L62 88", 9)


def d29():
    return P("M14 88V46A36 36 0 0 1 86 46V88H74V48A24 24 0 0 0 26 48V88Z") + P("M34 88V54A16 16 0 0 1 66 54V88H58V56A8 8 0 0 0 42 56V88Z")


def d30():
    return P("M18 86V50A32 32 0 0 1 82 50V86H66V52A16 16 0 0 0 34 52V86Z") + P(cd(50, 66, 6))


DESIGNS = [
    (1, "002", "Split T", d01), (2, "004", "Split T rounded", d02), (3, "006", "Split T diagonal", d03),
    (4, "003", "Split T offset", d04), (5, "008", "Pill T overlap", d05), (6, "012", "Shield T-gap", d06),
    (7, "015", "Half shield", d07), (8, "017", "t-check", d08), (9, "020", "t-check circle", d09),
    (10, "021", "t-check squircle", d10), (11, "024", "t-check sharp", d11), (12, "018", "t-check right bar", d12),
    (13, "025", "Braces coin", d13), (14, "026", "Brackets coin", d14), (15, "029", "Braces T-coin", d15),
    (16, "032", "Braces check", d16), (17, "033", "Angle coin", d17), (18, "036", "Chevron shield", d18),
    (19, "036", "Chevron shield sharp", d19), (20, "050", "Chat lock", d20), (21, "084", "Hooks diamond", d21),
    (22, "088", "Hooks square", d22), (23, "094", "Person", d23), (24, "118", "T check", d24),
    (25, "138", "Ear shield T", d25), (26, "137", "Dog shield", d26), (27, "146", "Three dots T", d27),
    (28, "161", "Ty", d28), (29, "205", "Double arch", d29), (30, "207", "Arch dot", d30),
]


def main(out):
    os.makedirs(out, exist_ok=True)
    idx = []
    for n, src, name, fn in DESIGNS:
        with open(os.path.join(out, f"{n:02d}.svg"), "w") as fh:
            fh.write(svg(fn()))
        idx.append({"id": n, "from_round1": src, "name": name})
    with open(os.path.join(out, "index.json"), "w") as fh:
        json.dump(idx, fh, ensure_ascii=False, indent=1)
    print(len(idx))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out")
