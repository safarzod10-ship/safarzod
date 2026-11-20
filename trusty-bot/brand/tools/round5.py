"""Round 5: three finalists with corrected geometry, shown as a full mini identity.

Usage: python3 round5.py <out_dir> <fonts_dir>
"""
import os
import sys

from svglib import INK, P, S, cd, mirror, svg

FOREST, IVORY, GOLD = "#0E4D3A", "#F4EFE3", "#E9B949"

# A': braces-shield. Smaller, smoother brace nib; equal top/bottom gaps; coin lifted to optical centre.
A_HALF = ("M43 15L27.5 20.6Q22 22.6 22 28.4V41C22 44.6 20.2 46.6 16.8 47"
          "C20.2 47.4 22 49.4 22 53V58C22 70 30.8 79.4 43 85.5")
# B': plain bracket-shield, same skeleton without the nib.
B_HALF = "M43 15L27.5 20.6Q22 22.6 22 28.4V58C22 70 30.8 79.4 43 85.5"


def mark_A(m=INK, a=INK, sw=9):
    return S(A_HALF, sw, m) + mirror(S(A_HALF, sw, m)) + P(cd(50, 48, 8.5), fill=a)


def mark_B(m=INK, a=INK, sw=9.5):
    return S(B_HALF, sw, m) + mirror(S(B_HALF, sw, m)) + P(cd(50, 48, 8.5), fill=a)


def mark_E(m=INK, a=INK):
    return (S("M40 14V60C40 69 43.5 75 49 76.5", 12, m) + S("M24 34H60", 12, m)
            + S("M60 69.5L84 42", 12, a))


CANDS = [("A", "Фигурные скобки-щит + монета", mark_A), ("B", "Скобки-щит + монета", mark_B),
         ("E", "t-галочка", mark_E)]


def g(inner, s=0.62, cx=50, cy=50):
    return f'<g transform="translate(50 50) scale({s}) translate({-cx} {-cy})">{inner}</g>'


def tile(inner, size, bg=None, shape="circle", s=0.62):
    back = ""
    if bg and shape == "circle":
        back = f'<circle cx="50" cy="50" r="50" fill="{bg}"/>'
    elif bg:
        back = f'<rect width="100" height="100" rx="23" fill="{bg}"/>'
    return f'<svg viewBox="0 0 100 100" width="{size}" height="{size}">{back}{g(inner, s) if bg else inner}</svg>'


def main(out, fonts):
    os.makedirs(out, exist_ok=True)
    rel = os.path.relpath(fonts, out)
    for k, _, fn in CANDS:
        with open(os.path.join(out, f"{k}.svg"), "w") as fh:
            fh.write(svg(fn()))
    secs = []
    for k, name, fn in CANDS:
        big = tile(fn(), 190)
        rev = tile(fn(IVORY, GOLD), 190, FOREST, "rect", 0.66)
        sizes = "".join(tile(fn(IVORY, GOLD), s, FOREST) for s in (64, 48, 32, 24, 16))
        mono_sizes = "".join(tile(fn(), s) for s in (48, 32, 24, 16))
        lock_h = (f'<div class="lh">{tile(fn(FOREST, GOLD), 64)}<span class="w1">TRUSTY</span></div>'
                  f'<div class="lh">{tile(fn(FOREST, GOLD), 64)}<span class="w2">trusty</span></div>')
        lock_d = (f'<div class="lh dk">{tile(fn(IVORY, GOLD), 56)}<span class="w1" style="color:{IVORY}">TRUSTY</span></div>')
        header = (f'<div class="app"><div class="hd">{tile(fn(IVORY, GOLD), 30)}<b>Trusty</b><i>гарант сделок</i></div>'
                  f'<div class="ld">{tile(fn(FOREST, GOLD), 70)}</div></div>')
        secs.append(f'<section><h2>{k}. {name}</h2><div class="r">{big}{rev}<div class="col"><div class="sz">{sizes}</div>'
                    f'<div class="sz">{mono_sizes}</div></div></div><div class="r">{lock_h}</div><div class="r">{lock_d}{header}</div></section>')
    html = f"""<!doctype html><meta charset=utf-8><style>
@font-face{{font-family:Onest;src:url('{rel}/Onest-800.font')}}
@font-face{{font-family:Geologica;src:url('{rel}/Geologica-700.font')}}
body{{background:#F3F1EC;margin:0;padding:24px;font-family:Inter;color:#16181D;width:1180px}}
section{{background:#fff;border-radius:14px;padding:18px;margin-bottom:18px}}
h2{{font:600 15px Inter;margin:0 0 12px}}
.r{{display:flex;align-items:center;gap:22px;margin-bottom:14px}}
.col{{display:flex;flex-direction:column;gap:14px}}.sz{{display:flex;align-items:center;gap:12px}}
.lh{{display:flex;align-items:center;gap:12px;padding:10px 18px;border-radius:12px;background:#F7F5F0}}
.lh.dk{{background:{FOREST}}}
.w1{{font:800 46px Onest;color:{FOREST};letter-spacing:.02em}}
.w2{{font:700 50px Geologica;color:{FOREST};letter-spacing:-.01em}}
.app{{width:300px;border-radius:16px;overflow:hidden;border:1px solid #e6e2d8}}
.hd{{display:flex;align-items:center;gap:8px;background:{FOREST};color:{IVORY};padding:10px 12px}}
.hd b{{font:800 16px Onest}}.hd i{{font-style:normal;opacity:.7;font-size:12px;margin-left:auto}}
.ld{{height:120px;display:flex;align-items:center;justify-content:center;background:#FBFAF6}}
</style>{''.join(secs)}"""
    with open(os.path.join(out, "round5.html"), "w") as fh:
        fh.write(html)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
