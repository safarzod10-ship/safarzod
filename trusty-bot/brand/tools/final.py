import json
import os
import subprocess
import sys

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

from svglib import S, P, cd, f, mirror

EMERALD = "#178A66"
TETHER = "#26A17B"
DEEP = "#0B2A27"
INK = "#0D2C27"
MINT = "#E8F5EF"
WHITE = "#FFFFFF"
COIN_SYM = WHITE

STROKE = 7.5
AXIS = 48
COIN_R = 14.5
TIP = 43.5
HALF = f"M{TIP} 15L27.5 20.6Q22 22.6 22 28.4V58C22 70 30.8 79.4 {TIP} 85.5"
BOX = (13.6, 11.25, 86.4, 89.25)


def nib(sw=STROKE):
    k = sw / 9
    xo = 22 - sw / 2
    a = AXIS
    return (f"M{f(xo+1.5)} {f(a-8.5*k)}H{f(xo)}C{f(xo)} {f(a-3.4*k)} {f(xo-1.2*k)} {f(a-2.3*k)} {f(xo-3.2*k)} {f(a-2.05*k)}"
            f"A{f(2.05*k)} {f(2.05*k)} 0 0 0 {f(xo-3.2*k)} {f(a+2.05*k)}"
            f"C{f(xo-1.2*k)} {f(a+2.3*k)} {f(xo)} {f(a+3.4*k)} {f(xo)} {f(a+8.5*k)}H{f(xo+1.5)}Z")


NIB = nib()


def coin_symbol(sym=COIN_SYM, r=COIN_R):
    u = r / 12
    return (f'<path d="M{f(-6.3*u)} {f(-6.7*u)}H{f(6.3*u)}V{f(-4.05*u)}H{f(1.75*u)}V{f(7.1*u)}H{f(-1.75*u)}'
            f'V{f(-4.05*u)}H{f(-6.3*u)}Z" fill="{sym}"/>'
            f'<ellipse cx="0" cy="{f(-.95*u)}" rx="{f(7.3*u)}" ry="{f(2.15*u)}" fill="none" stroke="{sym}" stroke-width="{f(1.35*u)}"/>')


def coin_inner(r=COIN_R, sym=COIN_SYM, body=TETHER, rim=True):
    u = r / 12
    out = f'<circle r="{f(r)}" fill="{body}"/>'
    if rim:
        out += f'<circle r="{f(r-1.05*u)}" fill="none" stroke="#FFFFFF" stroke-opacity=".16" stroke-width="{f(.7*u)}"/>'
    return out + coin_symbol(sym, r)


def coin_mono(color, mid="knock"):
    return (f'<mask id="{mid}"><circle r="{f(COIN_R)}" fill="#fff"/>{coin_symbol("#000")}</mask>'
            f'<circle r="{f(COIN_R)}" fill="{color}" mask="url(#{mid})"/>')


def mark(m=INK, sw=STROKE, mono_coin=None, coin_body=TETHER, coin_sym=COIN_SYM):
    half = S(HALF, sw, m) + P(nib(sw), fill=m)
    c = coin_mono(mono_coin) if mono_coin else coin_inner(body=coin_body, sym=coin_sym)
    return (f'<g class="half-l">{half}</g><g class="half-r">{mirror(half)}</g>'
            f'<g class="coin" transform="translate(50 {AXIS})">{c}</g>')


def wordmark_paths(text="TRUSTY", font_path=None, tracking=24):
    here = os.path.dirname(os.path.abspath(__file__))
    meas = json.loads(subprocess.check_output(["node", os.path.join(here, "measure.js"), font_path, text]))
    tt = TTFont(font_path)
    gs = tt.getGlyphSet()
    cmap = tt.getBestCmap()
    out = []
    for i, m in enumerate(meas):
        pen = SVGPathPen(gs)
        tp = TransformPen(pen, (1, 0, 0, -1, m["x"] + i * tracking, 0))
        gs[cmap[ord(m["ch"])]].draw(tp)
        out.append(pen.getCommands())
    last = meas[-1]
    width = last["x"] + (len(meas) - 1) * tracking + tt["hmtx"][cmap[ord(last["ch"])]][0]
    return out, width, tt["OS/2"].sCapHeight


def wordmark_svg(fill, cap=34.0, x0=0.0, baseline=0.0, font_path=None, cls="ltr"):
    glyphs, width, capu = wordmark_paths(font_path=font_path)
    s = cap / capu
    parts = [f'<g class="{cls}" transform="translate({f(x0)} {f(baseline)}) scale({s:.5f})"><path d="{d}" fill="{fill}"/></g>'
             for d in glyphs]
    return "".join(parts), width * s


LOCK_CAP, LOCK_GAP = 33.0, 16.0


def lockup_parts(m, font_path):
    base = AXIS + LOCK_CAP / 2 + 0.5
    x_text = BOX[2] + LOCK_GAP
    text, tw = wordmark_svg(m, LOCK_CAP, x_text, base, font_path)
    return text, tw, x_text, base


def doc(inner, w, h, bg=None, title="TRUSTY"):
    b = f'<rect width="{f(w)}" height="{f(h)}" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {f(w)} {f(h)}" width="{f(w*8)}" height="{f(h*8)}">'
            f'<title>{title}</title>{b}{inner}</svg>')


def lockup(m, font_path, pad=12, bg=None, mono_coin=None, coin=(TETHER, COIN_SYM)):
    text, tw, x_text, _ = lockup_parts(m, font_path)
    x_min, x_max = BOX[0] - pad, x_text + tw + pad
    y_min, y_max = BOX[1] - pad, BOX[3] + pad
    inner = f'<g transform="translate({f(-x_min)} {f(-y_min)})">{mark(m, mono_coin=mono_coin, coin_body=coin[0], coin_sym=coin[1])}{text}</g>'
    return doc(inner, x_max - x_min, y_max - y_min, bg)


def placed(inner, scale, bg_shape):
    cy = (BOX[1] + BOX[3]) / 2
    return doc(bg_shape + f'<g transform="translate(50 50) scale({scale}) translate(-50 {f(-cy)})">{inner}</g>', 100, 100)


def construction():
    g = []
    for i in range(0, 101, 5):
        w = 0.25 if i % 10 else 0.4
        g.append(f'<path d="M{i} 0V100M0 {i}H100" stroke="#C3D2CC" stroke-width="{w}"/>')
    red, blue = "#C4472B", "#2343D6"
    gap_l, gap_r = TIP + STROKE / 2, 100 - TIP - STROKE / 2
    guides = (f'<path d="M0 {AXIS}H100" stroke="{red}" stroke-width=".5" stroke-dasharray="1.5 1"/>'
              f'<path d="M50 0V100" stroke="{red}" stroke-width=".5" stroke-dasharray="1.5 1"/>'
              f'<circle cx="50" cy="{AXIS}" r="{COIN_R}" fill="none" stroke="{red}" stroke-width=".4"/>'
              f'<path d="M{f(gap_l)} {BOX[1]}V8.5M{f(gap_r)} {BOX[1]}V8.5M{f(gap_l)} 9.5H{f(gap_r)}" stroke="{blue}" stroke-width=".35"/>'
              f'<path d="M{f(gap_l)} {BOX[3]}V91.5M{f(gap_r)} {BOX[3]}V91.5M{f(gap_l)} 90.5H{f(gap_r)}" stroke="{blue}" stroke-width=".35"/>')
    labels = (f'<g font-family="Inter" font-size="2.6" fill="{blue}">'
              f'<text x="54" y="8.6">зазор {f(2*(50-TIP)-STROKE)}</text><text x="54" y="94.4">зазор {f(2*(50-TIP)-STROKE)}</text>'
              f'<text x="57" y="{AXIS-15}" fill="{red}">ось: усики = центр монеты</text>'
              f'<text x="40" y="{AXIS+COIN_R+5}" fill="{red}">монета Ø{f(2*COIN_R)}, штрих {f(STROKE)}</text></g>')
    body = (f'<rect width="100" height="100" fill="#F5F9F7"/>{"".join(g)}'
            f'<g opacity=".94">{mark(INK)}</g>'
            f'<path d="{HALF}" fill="none" stroke="#fff" stroke-width=".3"/>{guides}{labels}')
    return doc(body, 100, 100, title="TRUSTY: построение знака")


def main(root):
    out = os.path.join(root, "logo")
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.endswith(".svg"):
            os.remove(os.path.join(out, old))
    font = os.path.join(root, "fonts", "Onest-ExtraBold-subset.ttf")
    on_emerald = mark(WHITE, coin_body=WHITE, coin_sym=EMERALD)
    files = {
        "mark-on-light.svg": doc(mark(INK), 100, 100),
        "mark-on-dark.svg": doc(mark(MINT), 100, 100),
        "mark-on-emerald.svg": doc(on_emerald, 100, 100),
        "mark-mono.svg": doc(mark(INK, mono_coin=INK), 100, 100),
        "avatar.svg": placed(on_emerald, .64, f'<circle cx="50" cy="50" r="50" fill="{EMERALD}"/>'),
        "avatar-square.svg": placed(on_emerald, .64, f'<rect width="100" height="100" fill="{EMERALD}"/>'),
        "app-icon.svg": placed(on_emerald, .66, f'<rect width="100" height="100" rx="23" fill="{EMERALD}"/>'),
        "construction.svg": construction(),
        "lockup-on-light.svg": lockup(INK, font),
        "lockup-on-dark.svg": lockup(MINT, font),
        "lockup-on-emerald.svg": lockup(WHITE, font, coin=(WHITE, EMERALD)),
        "lockup-mono.svg": lockup(INK, font, mono_coin=INK),
    }
    for name, content in files.items():
        with open(os.path.join(out, name), "w") as fh:
            fh.write(content)
    print("\n".join(sorted(files)))


if __name__ == "__main__":
    main(sys.argv[1])
