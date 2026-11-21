import os
import sys

from final import (AXIS, BOX, COIN_R, DEEP, EMERALD, HALF, INK, LOCK_CAP, LOCK_GAP, MINT, STROKE,
                   TETHER, WHITE, coin_symbol, nib, wordmark_svg)
from svglib import f

JS = r"""
const $ = id => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const prog = (t, a, b) => clamp((t - a) / (b - a));
const eOutCubic = p => 1 - Math.pow(1 - p, 3);
const eOutQuart = p => 1 - Math.pow(1 - p, 4);
const eInQuad = p => p * p;
const eInOutQuint = p => p < .5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2;
// damped spring: 1 at tau=0, settles at 0 with a soft overshoot
const spring = (tau, zeta = .55, w = 11) => {
  if (tau <= 0) return 1;
  const wd = w * Math.sqrt(1 - zeta * zeta);
  return Math.exp(-zeta * w * tau) * (Math.cos(wd * tau) + (zeta * w / wd) * Math.sin(wd * tau));
};
const LETTERS = [...document.querySelectorAll('.lw')];
const T_LAND = .72;

function render(t) {
  // 1. the coin falls in while spinning; the spin slows down and ends face-on exactly at landing
  const pf = prog(t, .08, T_LAND);
  let y = -92 * (1 - eInQuad(pf));
  const theta = 2 * Math.PI * 2 * eOutQuart(pf);
  let sx = Math.cos(theta), sy = 1;
  if (t > T_LAND) {                       // landing: two small decaying bounces and a squash
    const tau = t - T_LAND;
    y = -4.2 * Math.exp(-7 * tau) * Math.abs(Math.sin(9 * tau));
    const sq = .13 * Math.exp(-6.5 * tau) * Math.cos(15 * tau);
    sx = 1 + sq; sy = 1 - sq;
  }
  $('coin').setAttribute('transform', `translate(50 ${AXIS + y})`);
  $('spin').setAttribute('transform', `scale(${Math.max(Math.abs(sx), .04) * Math.sign(sx || 1)} ${sy})`);
  $('shade').style.opacity = t > T_LAND ? 0 : .38 * (1 - Math.abs(Math.cos(theta)));
  $('coin').style.opacity = t < .08 ? 0 : 1;

  // 2. braces spring in from both sides (client and developer) and draw themselves
  const tb = t - .5;
  const s = spring(tb, .5, 10.5);
  let dx = tb < 0 ? 34 : 34 * s;
  let rot = tb < 0 ? 12 : 12 * s;
  // 3. lock: a short pinch toward the coin
  const pc = prog(t, 1.12, 1.34);
  if (pc > 0 && pc < 1) dx += 1.5 * Math.sin(Math.PI * pc);
  $('hl').setAttribute('transform', `translate(${-dx} 0) rotate(${-rot} 22 ${AXIS})`);
  $('hr').setAttribute('transform', `translate(${dx} 0) rotate(${rot} 78 ${AXIS})`);
  const pd = eOutCubic(prog(t, .5, 1.05));
  $('pl').style.strokeDashoffset = $('pr').style.strokeDashoffset = 1 - pd;
  $('hl').style.opacity = $('hr').style.opacity = eOutCubic(prog(t, .5, .62));
  document.querySelectorAll('.nib').forEach(n => {
    const p = eOutCubic(prog(t, .78, 1.0));
    n.style.opacity = p;
    n.setAttribute('transform', `translate(${(1 - p) * 3} 0)`);
  });
  // ring wave and sheen at the lock moment
  const pr = prog(t, 1.16, 2.0);
  $('ring').setAttribute('r', COIN_R + 24 * eOutCubic(pr));
  $('ring').style.strokeWidth = 2.6 * (1 - eOutCubic(pr));
  $('ring').style.opacity = pr > 0 && pr < 1 ? .85 * (1 - eInQuad(pr)) : 0;
  const ps = prog(t, 1.2, 1.85);
  $('sheen').setAttribute('transform', `translate(${-30 + 60 * eOutCubic(ps)} 0) rotate(22)`);
  $('sheen').style.opacity = ps > 0 && ps < 1 ? 1 : 0;

  // 4. lock-up: the mark glides aside and uncovers the letters, which rise on a spring
  if (window.LOCKUP) {
    const pm = eInOutQuint(prog(t, 1.5, 2.35));
    const shift = MARK_SHIFT * (1 - pm);
    $('mk').setAttribute('transform', `translate(${shift} 0)`);
    $('cliprect').setAttribute('x', CLIP_X + shift);
    LETTERS.forEach((el, i) => {
      const tl = t - (1.78 + i * .055);
      const yy = tl < 0 ? 38 : 38 * spring(tl, .62, 12.5);
      el.setAttribute('transform', `translate(0 ${yy})`);
      el.style.opacity = eOutCubic(prog(tl, 0, .18));
    });
  }
}
const DURATION = window.LOCKUP ? 3.6 : 2.6;
window.render = render; window.DURATION = DURATION;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
if (location.search.includes('capture')) render(0);
else if (reduce) render(DURATION);
else {
  let t0 = null;
  const loop = ts => { if (t0 === null) t0 = ts; const t = ((ts - t0) / 1000) % (DURATION + 1.2); render(Math.min(t, DURATION)); requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
}
"""

THEMES = f"""
:root{{--bg:{EMERALD};--mark:{WHITE};--coin:{WHITE};--sym:{EMERALD};--ring:{WHITE}}}
:root.dark{{--bg:{DEEP};--mark:{MINT};--coin:{TETHER};--sym:{WHITE};--ring:{TETHER}}}
:root.light{{--bg:{WHITE};--mark:{INK};--coin:{TETHER};--sym:{WHITE};--ring:{TETHER}}}
"""


def mark_svg():
    half = (f'<path id="{{id}}" d="{HALF}" fill="none" stroke="var(--mark)" stroke-width="{STROKE}" '
            f'stroke-linecap="round" stroke-linejoin="round" pathLength="1" stroke-dasharray="1 1"/>'
            f'<path class="nib" d="{nib()}" fill="var(--mark)"/>')
    sym = coin_symbol("var(--sym)").replace('fill="var(--sym)"', 'style="fill:var(--sym)"').replace(
        'stroke="var(--sym)"', 'style="stroke:var(--sym)"')
    return (f'<g id="hl">{half.format(id="pl")}</g>'
            f'<g id="hr"><g transform="matrix(-1 0 0 1 100 0)">{half.format(id="pr")}</g></g>'
            f'<circle id="ring" cx="50" cy="{AXIS}" r="{COIN_R}" fill="none" style="stroke:var(--ring)"/>'
            f'<g id="coin"><g id="spin">'
            f'<circle r="{COIN_R}" style="fill:var(--coin)"/>'
            f'<circle id="shade" r="{COIN_R}" fill="#000" opacity="0"/>'
            f'{sym}'
            f'<g clip-path="url(#coinclip)"><rect id="sheen" x="-4" y="-30" width="8" height="60" fill="url(#sheengrad)" opacity="0"/></g>'
            f'</g></g>')


DEFS = (f'<clipPath id="coinclip"><circle r="{COIN_R}"/></clipPath>'
        '<linearGradient id="sheengrad" x1="0" x2="1" y1="0" y2="0">'
        '<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".55"/>'
        '<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>')


def page(lockup, font):
    cy = (BOX[1] + BOX[3]) / 2
    if lockup:
        base = AXIS + LOCK_CAP / 2 + 0.5
        x_text = BOX[2] + LOCK_GAP
        text, tw = wordmark_svg("var(--mark)", LOCK_CAP, x_text, base, font, cls="lw-inner")
        text = text.replace('fill="var(--mark)"', 'style="fill:var(--mark)"')
        parts = text.split('<g class="lw-inner"')[1:]
        text = "".join(f'<g class="lw"><g class="lw-inner"{p}</g>' for p in parts)
        x0, x1 = BOX[0], x_text + tw
        W = (x1 - x0) / 0.6
        H = W * 9 / 16
        vx, vy = x0 - (W - (x1 - x0)) / 2, cy - H / 2
        shift = (x0 + x1) / 2 - 50
        clip_x = BOX[2] + 3
        clip = (f'<clipPath id="base"><rect id="cliprect" x="{f(clip_x)}" y="{f(AXIS - 45)}" '
                f'width="{f(tw + LOCK_GAP + 20)}" height="{f(base - AXIS + 45 + 0.8)}"/></clipPath>')
        body = (f'<svg viewBox="{f(vx)} {f(vy)} {f(W)} {f(H)}" preserveAspectRatio="xMidYMid meet">'
                f'<defs>{DEFS}{clip}</defs><g id="mk">{mark_svg()}</g><g clip-path="url(#base)">{text}</g></svg>')
        pre = f"window.LOCKUP=true;const MARK_SHIFT={shift:.3f};const CLIP_X={clip_x:.3f};"
        ratio, rw = "16 / 9", "16/9"
    else:
        span = (BOX[3] - BOX[1]) / 0.56
        body = (f'<svg viewBox="{f(50 - span/2)} {f(cy - span/2)} {f(span)} {f(span)}" preserveAspectRatio="xMidYMid meet">'
                f'<defs>{DEFS}</defs><g id="mk">{mark_svg()}</g></svg>')
        pre = "window.LOCKUP=false;const MARK_SHIFT=0;const CLIP_X=0;"
        ratio, rw = "1 / 1", "1"
    pre += f"const AXIS={AXIS};const COIN_R={COIN_R};"
    return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Trusty</title>
<style>{THEMES}
html,body{{margin:0;height:100%;background:var(--bg);overflow:hidden}}
body{{display:flex;align-items:center;justify-content:center}}
.stage{{width:min(100vw,100vh * {rw});aspect-ratio:{ratio}}}
svg{{width:100%;height:100%;display:block}}
.lw{{opacity:0}}
</style></head><body><div class="stage">{body}</div>
<script>
const th = (location.search.match(/theme=(\\w+)/) || [])[1];
if (th === 'dark' || th === 'light') document.documentElement.classList.add(th);
{pre}{JS}</script>
</body></html>"""


def main(root):
    out = os.path.join(root, "logo", "animation")
    os.makedirs(out, exist_ok=True)
    font = os.path.join(root, "fonts", "Onest-ExtraBold-subset.ttf")
    for name, lk in (("trusty-intro.html", True), ("trusty-mark.html", False)):
        with open(os.path.join(out, name), "w") as fh:
            fh.write(page(lk, font))
    print("ok")


if __name__ == "__main__":
    main(sys.argv[1])
