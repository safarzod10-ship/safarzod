"""Tiny SVG helpers shared by the logo exploration scripts (viewBox 0 0 100 100)."""
import math

INK = "#16181D"
BG = "#F3F1EC"


def svg(inner, bg=None, size=400):
    b = f'<rect width="100" height="100" fill="{bg}"/>' if bg else ""
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" '
            f'width="{size}" height="{size}">{b}{inner}</svg>')


def f(n):
    s = f"{n:.2f}".rstrip("0").rstrip(".")
    return "0" if s == "-0" else s


def P(d, fill=INK, rule=None, extra=""):
    fr = f' fill-rule="{rule}"' if rule else ""
    return f'<path d="{d}" fill="{fill}"{fr} {extra}/>'


def S(d, sw, color=INK, cap="round", join="round", extra=""):
    return (f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{f(sw)}" '
            f'stroke-linecap="{cap}" stroke-linejoin="{join}" {extra}/>')


def rr(x, y, w, h, r=0):
    r = min(r, w / 2, h / 2)
    if r <= 0:
        return f"M{f(x)} {f(y)}H{f(x+w)}V{f(y+h)}H{f(x)}Z"
    return (f"M{f(x+r)} {f(y)}H{f(x+w-r)}A{f(r)} {f(r)} 0 0 1 {f(x+w)} {f(y+r)}"
            f"V{f(y+h-r)}A{f(r)} {f(r)} 0 0 1 {f(x+w-r)} {f(y+h)}"
            f"H{f(x+r)}A{f(r)} {f(r)} 0 0 1 {f(x)} {f(y+h-r)}"
            f"V{f(y+r)}A{f(r)} {f(r)} 0 0 1 {f(x+r)} {f(y)}Z")


def cd(cx, cy, r):
    return (f"M{f(cx-r)} {f(cy)}A{f(r)} {f(r)} 0 1 0 {f(cx+r)} {f(cy)}"
            f"A{f(r)} {f(r)} 0 1 0 {f(cx-r)} {f(cy)}Z")


def poly(pts, close=True):
    d = "M" + "L".join(f"{f(x)} {f(y)}" for x, y in pts)
    return d + ("Z" if close else "")


def T_poly(cx, top, bw, bh, sw, sh):
    """T outline: bar width/height, stem width, total height."""
    x0, x1, s0, s1 = cx - bw / 2, cx + bw / 2, cx - sw / 2, cx + sw / 2
    return poly([(x0, top), (x1, top), (x1, top + bh), (s1, top + bh), (s1, top + sh),
                 (s0, top + sh), (s0, top + bh), (x0, top + bh)])


def shield(x0=20, x1=80, top=14, mid=46, bot=90, r=0):
    cx = (x0 + x1) / 2
    k = bot - mid
    if r:
        head = (f"M{f(x0)} {f(top+r)}Q{f(x0)} {f(top)} {f(x0+r)} {f(top)}"
                f"H{f(x1-r)}Q{f(x1)} {f(top)} {f(x1)} {f(top+r)}")
    else:
        head = f"M{f(x0)} {f(top)}H{f(x1)}"
    return (head + f"V{f(mid)}C{f(x1)} {f(mid+k*0.55)} {f(cx+(x1-cx)*0.45)} {f(bot-k*0.12)} {f(cx)} {f(bot)}"
            f"C{f(cx-(cx-x0)*0.45)} {f(bot-k*0.12)} {f(x0)} {f(mid+k*0.55)} {f(x0)} {f(mid)}Z")


def masked(shape, cuts, mid="m"):
    return (f'<defs><mask id="{mid}" maskUnits="userSpaceOnUse" x="-10" y="-10" width="120" height="120">'
            f'<rect x="-10" y="-10" width="120" height="120" fill="white"/>{cuts}</mask></defs>'
            f'<g mask="url(#{mid})">{shape}</g>')


def mirror(inner):
    return f'<g transform="matrix(-1 0 0 1 100 0)">{inner}</g>'


def rot(inner, a, cx=50, cy=50):
    return f'<g transform="rotate({f(a)} {f(cx)} {f(cy)})">{inner}</g>'


def arc_pts(cx, cy, r, a0, a1, n=24):
    return [(cx + r * math.cos(a0 + (a1 - a0) * i / n), cy + r * math.sin(a0 + (a1 - a0) * i / n))
            for i in range(n + 1)]


def arc_d(cx, cy, r, a0, a1):
    """Arc path from angle a0 to a1 (radians, clockwise in SVG space when a1>a0)."""
    x0, y0 = cx + r * math.cos(a0), cy + r * math.sin(a0)
    x1, y1 = cx + r * math.cos(a1), cy + r * math.sin(a1)
    large = 1 if abs(a1 - a0) > math.pi else 0
    sweep = 1 if a1 > a0 else 0
    return f"M{f(x0)} {f(y0)}A{f(r)} {f(r)} 0 {large} {sweep} {f(x1)} {f(y1)}"


def wavy_circle(cx, cy, R, amp, n, steps=360):
    pts = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        rr_ = R + amp * math.cos(n * t)
        pts.append((cx + rr_ * math.cos(t), cy + rr_ * math.sin(t)))
    return poly(pts)
