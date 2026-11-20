"""Mini App loading animation: pure CSS + inline SVG, works before any JS loads.

The coin turns on its vertical axis (flip, pause, flip back); the braces tighten
around it each time it is edge-on. Theme follows Telegram (class "dark" on <html>) or the OS.

Usage: python3 loader.py <brand_dir>
Writes logo/animation/trusty-loader.html (demo, frame-capturable) and logo/animation/loader-snippet.html
(the <style> + markup to paste into the Mini App's index.html).
"""
import os
import sys

from final import AXIS, BOX, COIN_R, DEEP, HALF, INK, MINT, STROKE, TETHER, WHITE, coin_symbol, nib
from svglib import f

PERIOD = 2.2

CSS = f"""
.tl-splash{{--tl-bg:{WHITE};--tl-mark:{INK};--tl-coin:{TETHER};--tl-sym:{WHITE};--tl-cap:#5E7A72;
  position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
  background:var(--tl-bg);z-index:1000;transition:opacity .35s ease,visibility .35s}}
@media (prefers-color-scheme:dark){{html:not(.light) .tl-splash{{--tl-bg:{DEEP};--tl-mark:{MINT};--tl-cap:#86A79D}}}}
html.dark .tl-splash{{--tl-bg:{DEEP};--tl-mark:{MINT};--tl-cap:#86A79D}}
.tl-splash.tl-done{{opacity:0;visibility:hidden}}
.tl-splash svg{{width:92px;height:92px;overflow:visible;animation:tl-in .5s cubic-bezier(.2,.8,.2,1) both}}
.tl-half{{fill:none;stroke:var(--tl-mark);stroke-width:{STROKE};stroke-linecap:round;stroke-linejoin:round}}
.tl-nib{{fill:var(--tl-mark)}}
.tl-l{{animation:tl-grip {PERIOD}s cubic-bezier(.45,0,.55,1) infinite}}
.tl-r{{animation:tl-grip-r {PERIOD}s cubic-bezier(.45,0,.55,1) infinite}}
.tl-spin{{animation:tl-spin {PERIOD}s infinite}}
.tl-shade{{animation:tl-shade {PERIOD}s infinite}}
.tl-coin{{fill:var(--tl-coin)}}.tl-sym{{fill:var(--tl-sym)}}.tl-ring{{fill:none;stroke:var(--tl-sym)}}
@keyframes tl-in{{from{{opacity:0;transform:translateY(6px) scale(.96)}}to{{opacity:1;transform:none}}}}
@keyframes tl-spin{{
  0%{{transform:scaleX(1);animation-timing-function:cubic-bezier(.55,0,.45,1)}}
  38%{{transform:scaleX(-1)}}
  50%{{transform:scaleX(-1);animation-timing-function:cubic-bezier(.55,0,.45,1)}}
  88%{{transform:scaleX(1)}}
  100%{{transform:scaleX(1)}}}}
@keyframes tl-shade{{0%,38%,50%,88%,100%{{opacity:0}}19%,69%{{opacity:.34}}}}
@keyframes tl-grip{{0%,38%,50%,88%,100%{{transform:translateX(0)}}19%,69%{{transform:translateX(1.8px)}}}}
@keyframes tl-grip-r{{0%,38%,50%,88%,100%{{transform:translateX(0)}}19%,69%{{transform:translateX(-1.8px)}}}}
@media (prefers-reduced-motion:reduce){{.tl-l,.tl-r,.tl-spin,.tl-shade{{animation:none}}}}
"""


def markup(caption="Загружаем Trusty"):
    cy = (BOX[1] + BOX[3]) / 2
    span = BOX[3] - BOX[1] + 4
    sym = (coin_symbol("X").replace('fill="X"', 'class="tl-sym"')
           .replace('fill="none" stroke="X"', 'class="tl-ring"'))
    half = f'<path class="tl-half" d="{HALF}"/><path class="tl-nib" d="{nib()}"/>'
    return (f'<div class="tl-splash" id="tl-splash" role="status" aria-label="{caption}">'
            f'<svg viewBox="{f(50-span/2)} {f(cy-span/2)} {f(span)} {f(span)}" aria-hidden="true">'
            f'<g class="tl-l">{half}</g>'
            f'<g class="tl-r"><g transform="matrix(-1 0 0 1 100 0)">{half}</g></g>'
            f'<g transform="translate(50 {AXIS})"><g class="tl-spin">'
            f'<circle class="tl-coin" r="{COIN_R}"/><circle class="tl-shade" r="{COIN_R}" fill="#000" opacity="0"/>{sym}'
            f'</g></g></svg></div>')


def main(root):
    out = os.path.join(root, "logo", "animation")
    os.makedirs(out, exist_ok=True)
    snippet = f"<style>{CSS}</style>\n{markup()}\n"
    with open(os.path.join(out, "loader-snippet.html"), "w") as fh:
        fh.write(snippet)
    demo = f"""<!doctype html><html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Trusty: загрузка</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Onest:wght@500&display=swap" rel="stylesheet">
<script>if(/theme=dark/.test(location.search))document.documentElement.classList.add('dark');
if(/theme=light/.test(location.search))document.documentElement.classList.add('light');</script>
</head><body style="margin:0">{snippet}
<script>
// frame capture support: ?capture pauses CSS animations, render(t) seeks them
window.DURATION = {PERIOD * 2};
window.render = t => document.getAnimations().forEach(a => {{ a.pause(); a.currentTime = t * 1000 + 600; }});
if (location.search.includes('capture')) window.render(0);
</script></body></html>"""
    with open(os.path.join(out, "trusty-loader.html"), "w") as fh:
        fh.write(demo)
    print("ok")


if __name__ == "__main__":
    main(sys.argv[1])
