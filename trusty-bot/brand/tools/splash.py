"""Mini App loading screen: a short version of the logo intro, then an idle coin turn until the app is ready.

The snippet is plain HTML + CSS + JS (no dependencies) so it plays before the app bundle loads.
Usage: python3 splash.py <brand_dir> <miniapp index.html>
It replaces the block between <!-- splash:start --> and <!-- splash:end --> in the given index.html, and also writes
logo/animation/trusty-splash.html for previewing (?theme=dark, ?capture for frame capture).

API for the app: window.__tlSplash.finish() -> Promise; plays the exit once the intro has finished, then removes itself.
"""
import os
import re
import sys

from final import AXIS, BOX, COIN_R, DEEP, HALF, INK, MINT, STROKE, TETHER, WHITE, coin_symbol, nib, wordmark_svg
from svglib import f

LIGHT_BG, DARK_BG = "#F2F5F3", "#071C19"  # the app's own background tokens, so the hand-off is seamless
CAP = 15.0

CSS = f"""
#tl-splash{{--tl-bg:{LIGHT_BG};--tl-mark:{INK};--tl-coin:{TETHER};--tl-sym:{WHITE};--tl-ring:{TETHER};
  position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:var(--tl-bg);
  transition:background-color .2s}}
@media (prefers-color-scheme:dark){{html:not(.light) #tl-splash{{--tl-bg:{DARK_BG};--tl-mark:{MINT}}}}}
html.dark #tl-splash{{--tl-bg:{DARK_BG};--tl-mark:{MINT}}}
#tl-splash svg{{width:min(46vw,190px);height:auto;overflow:visible;will-change:transform,opacity}}
#tl-splash .tl-half{{fill:none;stroke:var(--tl-mark);stroke-width:{STROKE};stroke-linecap:round;stroke-linejoin:round}}
#tl-splash .tl-nib,#tl-splash .tl-w{{fill:var(--tl-mark)}}
#tl-splash .tl-body{{fill:var(--tl-coin)}}#tl-splash .tl-sym{{fill:var(--tl-sym)}}#tl-splash .tl-symr{{fill:none;stroke:var(--tl-sym)}}
#tl-splash #tl-ring{{fill:none;stroke:var(--tl-ring)}}
"""

JS = r"""
(function () {
  var $ = function (id) { return document.getElementById(id); };
  var root = $('tl-splash');
  if (!root) return;
  var clamp = function (x) { return Math.min(1, Math.max(0, x)); };
  var prog = function (t, a, b) { return clamp((t - a) / (b - a)); };
  var outCubic = function (p) { return 1 - Math.pow(1 - p, 3); };
  var outQuart = function (p) { return 1 - Math.pow(1 - p, 4); };
  var inQuad = function (p) { return p * p; };
  var inOut = function (p) { return p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; };
  var spring = function (tau, z, w) {
    if (tau <= 0) return 1;
    var wd = w * Math.sqrt(1 - z * z);
    return Math.exp(-z * w * tau) * (Math.cos(wd * tau) + (z * w / wd) * Math.sin(wd * tau));
  };
  var letters = [].slice.call(root.querySelectorAll('.tl-l'));
  var nibs = [].slice.call(root.querySelectorAll('.tl-nib'));
  var INTRO = 1.4, LAND = .45, CYCLE = 1.7;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function render(t) {
    // coin: falls in spinning, lands face-on with a small squash
    var pf = prog(t, .04, LAND), y = -95 * (1 - inQuad(pf)), sx = Math.cos(2 * Math.PI * 1.5 * outQuart(pf)), sy = 1, shade = 0;
    shade = .38 * (1 - Math.abs(sx));
    if (t > LAND) {
      var tau = t - LAND;
      y = -3.6 * Math.exp(-8 * tau) * Math.abs(Math.sin(10 * tau));
      var sq = .12 * Math.exp(-7 * tau) * Math.cos(16 * tau);
      sx = 1 + sq; sy = 1 - sq; shade = 0;
    }
    // idle: while the app keeps loading, the coin turns over now and then
    if (t > INTRO + .25) {
      var c = ((t - INTRO - .25) % CYCLE) / CYCLE, p = inOut(clamp(c / .55));
      sx = Math.cos(2 * Math.PI * p); shade = .34 * (1 - Math.abs(sx)); y = 0; sy = 1;
    }
    $('tl-coin').setAttribute('transform', 'translate(50 ' + (AXIS + y) + ')');
    $('tl-spin').setAttribute('transform', 'scale(' + (Math.max(Math.abs(sx), .04) * (sx < 0 ? -1 : 1)) + ' ' + sy + ')');
    $('tl-shade').style.opacity = shade;
    $('tl-coin').style.opacity = t < .04 ? 0 : 1;
    // braces spring in from both sides and draw themselves; a short pinch when they lock
    var tb = t - .28, s = spring(tb, .5, 11), dx = tb < 0 ? 30 : 30 * s, rot = tb < 0 ? 12 : 12 * s;
    var pc = prog(t, .8, .98);
    if (pc > 0 && pc < 1) dx += 1.4 * Math.sin(Math.PI * pc);
    $('tl-hl').setAttribute('transform', 'translate(' + (-dx) + ' 0) rotate(' + (-rot) + ' 22 ' + AXIS + ')');
    $('tl-hr').setAttribute('transform', 'translate(' + dx + ' 0) rotate(' + rot + ' 78 ' + AXIS + ')');
    var pd = outCubic(prog(t, .28, .78));
    $('tl-pl').style.strokeDashoffset = $('tl-pr').style.strokeDashoffset = 1 - pd;
    $('tl-hl').style.opacity = $('tl-hr').style.opacity = outCubic(prog(t, .28, .38));
    var pn = outCubic(prog(t, .5, .7));
    nibs.forEach(function (n) { n.style.opacity = pn; });
    // ring wave and sheen at the lock moment
    var pr = prog(t, .82, 1.5);
    $('tl-ring').setAttribute('r', COIN_R + 20 * outCubic(pr));
    $('tl-ring').style.strokeWidth = 2.4 * (1 - outCubic(pr));
    $('tl-ring').style.opacity = pr > 0 && pr < 1 ? .8 * (1 - inQuad(pr)) : 0;
    var ps = prog(t, .86, 1.35);
    $('tl-sheen').setAttribute('transform', 'translate(' + (-30 + 60 * outCubic(ps)) + ' 0) rotate(22)');
    $('tl-sheen').style.opacity = ps > 0 && ps < 1 ? 1 : 0;
    // wordmark letters rise on a spring
    letters.forEach(function (el, i) {
      var tl = t - (.92 + i * .045), yy = tl < 0 ? 16 : 16 * spring(tl, .62, 13);
      el.setAttribute('transform', 'translate(0 ' + yy + ')');
      el.style.opacity = outCubic(prog(tl, 0, .2));
    });
  }

  var t0 = performance.now(), raf = 0, exiting = null;
  var frame = function (now) { render(reduce ? INTRO : (now - t0) / 1000); raf = requestAnimationFrame(frame); };
  if (/capture/.test(location.search)) render(0); else raf = requestAnimationFrame(frame);

  function exit() {
    return new Promise(function (resolve) {
      var svg = root.querySelector('svg'), a = performance.now();
      var step = function (now) {
        var p = clamp((now - a) / 380), e = inOut(p);
        svg.style.transform = 'scale(' + (1 + .07 * e) + ')';
        svg.style.opacity = 1 - e;
        root.style.opacity = 1 - inQuad(p);
        if (p < 1) requestAnimationFrame(step);
        else { cancelAnimationFrame(raf); root.remove(); resolve(); }
      };
      requestAnimationFrame(step);
    });
  }

  window.__tlSplash = {
    render: render, DURATION: 3.2,
    finish: function () {
      if (exiting) return exiting;
      var left = reduce ? 0 : Math.max(0, INTRO * 1000 - (performance.now() - t0));
      exiting = new Promise(function (r) { setTimeout(r, left); }).then(exit);
      return exiting;
    },
  };
})();
"""


def markup(font: str) -> str:
    base = BOX[3] + 12 + CAP
    text, tw = wordmark_svg("X", CAP, 0, 0, font, cls="tl-li")
    # each glyph group: wrap so it can rise on its own; centre the word under the mark
    parts = text.split('<g class="tl-li"')[1:]
    x0 = 50 - tw / 2
    letters = "".join(f'<g class="tl-l" style="opacity:0"><g class="tl-li"{p}</g>' for p in parts)
    letters = letters.replace('fill="X"', 'class="tl-w"')
    word = f'<g transform="translate({f(x0)} {f(base)})">{letters}</g>'
    half = (f'<path id="{{id}}" class="tl-half" d="{HALF}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1"/>'
            f'<path class="tl-nib" d="{nib()}" style="opacity:0"/>')
    sym = (coin_symbol("X").replace('fill="X"', 'class="tl-sym"').replace('fill="none" stroke="X"', 'class="tl-symr"'))
    w = max(tw, BOX[2] - BOX[0]) + 8
    vb = f"{f(50 - w / 2)} {f(BOX[1] - 6)} {f(w)} {f(base - BOX[1] + 10)}"
    return (f'<div id="tl-splash" role="status" aria-label="Загрузка Trusty">'
            f'<svg viewBox="{vb}" aria-hidden="true">'
            f'<defs><clipPath id="tl-clip"><circle r="{COIN_R}"/></clipPath>'
            f'<linearGradient id="tl-sg" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/>'
            f'<stop offset=".5" stop-color="#fff" stop-opacity=".55"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>'
            f'<g id="tl-hl" style="opacity:0">{half.format(id="tl-pl")}</g>'
            f'<g id="tl-hr" style="opacity:0"><g transform="matrix(-1 0 0 1 100 0)">{half.format(id="tl-pr")}</g></g>'
            f'<circle id="tl-ring" cx="50" cy="{AXIS}" r="{COIN_R}" style="opacity:0"/>'
            f'<g id="tl-coin" style="opacity:0"><g id="tl-spin"><circle class="tl-body" r="{COIN_R}"/>'
            f'<circle id="tl-shade" r="{COIN_R}" fill="#000" opacity="0"/>{sym}'
            f'<g clip-path="url(#tl-clip)"><rect id="tl-sheen" x="-4" y="-30" width="8" height="60" fill="url(#tl-sg)" opacity="0"/></g>'
            f'</g></g>{word}</svg></div>')


def snippet(font: str) -> str:
    js = JS.replace("AXIS", str(AXIS)).replace("COIN_R", str(COIN_R))
    css = " ".join(CSS.split())
    return f"<style>{css}</style>\n    {markup(font)}\n    <script>{js.strip()}</script>"


def main(root: str, index_html: str) -> None:
    font = os.path.join(root, "fonts", "Onest-ExtraBold-subset.ttf")
    snip = snippet(font)
    html = open(index_html, encoding="utf-8").read()
    new, n = re.subn(r"<!-- splash:start -->.*?<!-- splash:end -->",
                     lambda _: f"<!-- splash:start -->\n    {snip}\n    <!-- splash:end -->", html, flags=re.S)
    if n != 1:
        raise SystemExit("index.html needs <!-- splash:start --> and <!-- splash:end --> markers")
    open(index_html, "w", encoding="utf-8").write(new)
    demo = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>Trusty: загрузка</title><script>if(/theme=dark/.test(location.search))document.documentElement.classList.add("dark");'
            f'else document.documentElement.classList.add("light");</script></head><body style="margin:0">{snip}'
            f'<script>window.render=__tlSplash.render;window.DURATION=__tlSplash.DURATION;'
            f'if(!/capture/.test(location.search))setTimeout(function(){{__tlSplash.finish()}},3400);</script></body></html>')
    with open(os.path.join(root, "logo", "animation", "trusty-splash.html"), "w", encoding="utf-8") as fh:
        fh.write(demo)
    print("splash written:", len(snip) // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
