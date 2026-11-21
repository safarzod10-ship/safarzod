import os
import sys

from svglib import INK, S, P, cd, mirror, svg

BRK = "M43 14L20 23V49C20 64 29 76 44 85"
BRC = "M44 14L27 20Q22 21.8 22 27V39Q22 45.5 16 46.5Q22 47.5 22 54V58C22 70 31 79 44 86"


def pair(path, sw, col):
    return S(path, sw, col) + mirror(S(path, sw, col))


def A(m, a):
    return pair(BRC, 9, m) + P(cd(50, 49, 8), fill=a)


def B(m, a):
    return pair(BRK, 10, m) + P(cd(50, 49, 8), fill=a)


def C(m, a):
    return pair(BRK, 10, m) + S("M39 37H61", 8, m) + S("M50 37V61", 8, a)


def D(m, a):
    return pair(BRK, 10, m) + S("M39 49L47 57L62 41", 8, a)


def E(m, a):
    return (S("M40 14V60C40 69 43.5 75 49 76.5", 12, m) + S("M24 34H60", 12, m)
            + S("M60 69.5L84 42", 12, a))


def F(m, a):
    return pair(BRC, 9, m) + S("M40 38H60", 7.5, m) + S("M50 38V62", 7.5, a)


CANDS = [("A", "Скобки-щит + монета", A), ("B", "Угловые скобки-щит + монета", B),
         ("C", "Скобки-щит + T", C), ("D", "Скобки-щит + галочка", D),
         ("E", "t-галочка из двух частей", E), ("F", "Фигурные скобки-щит + T", F)]

PALETTES = [("Forest", "#0E4D3A", "#F4EFE3", "#E9B949"),
            ("Ink", "#15171C", "#F4EFE3", "#E9B949"),
            ("Cobalt", "#2343D6", "#FFFFFF", "#FFD15C")]


def avatar(fn, bg, m, a, size, scale=0.62):
    inner = fn(m, a)
    return (f'<svg viewBox="0 0 100 100" width="{size}" height="{size}"><circle cx="50" cy="50" r="50" fill="{bg}"/>'
            f'<g transform="translate(50 50) scale({scale}) translate(-50 -50)">{inner}</g></svg>')


def tg_list(fn, bg, m, a, dark):
    others = [("#E17076", "АК", "Алина К.", "Скинула ТЗ, глянь"), ("#7BC862", "DV", "Dev Vacancies", "Новый проект: парсер…"),
              ("#65AADD", "МС", "Максим", "ок, завтра созвон")]
    rows = []
    me = (f'<div class="tr"><div class="av">{avatar(fn, bg, m, a, 54)}</div><div class="tx"><b>Trusty</b>'
          f'<span>✅ Сделка #1042 закрыта. Средства отправлены</span></div><i>12:41</i></div>')
    rows.append(others[0])
    html = []
    for i, o in enumerate(others):
        if i == 1:
            html.append(me)
        html.append(f'<div class="tr"><div class="av" style="background:{o[0]}">{o[1]}</div><div class="tx"><b>{o[2]}</b><span>{o[3]}</span></div><i>12:3{i}</i></div>')
    cls = "tg dark" if dark else "tg"
    return f'<div class="{cls}">{"".join(html)}</div>'


def main(out, fonts):
    os.makedirs(out, exist_ok=True)
    for key, _, fn in CANDS:
        with open(os.path.join(out, f"{key}.svg"), "w") as fh:
            fh.write(svg(fn(INK, INK)))
    rel = os.path.relpath(fonts, out)
    blocks = []
    for key, name, fn in CANDS:
        mono = f'<svg viewBox="0 0 100 100" width="150" height="150">{fn(INK, INK)}</svg>'
        avs = "".join(avatar(fn, bg, m, a, 96) for _, bg, m, a in PALETTES)
        smalls = "".join(avatar(fn, bg, m, a, s) for _, bg, m, a in PALETTES[:1] for s in (40, 28, 20))
        lock = (f'<div class="lock"><svg viewBox="0 0 100 100" width="58" height="58">{fn("#0E4D3A", "#E9B949")}</svg>'
                f'<span>TRUSTY</span></div>')
        blocks.append(
            f'<section><h2>{key}. {name}</h2><div class="row">{mono}<div class="avs">{avs}</div>'
            f'<div class="sm">{smalls}</div></div>{lock}<div class="row2">{tg_list(fn, *PALETTES[0][1:], False)}'
            f'{tg_list(fn, *PALETTES[1][1:], True)}</div></section>')
    html = f"""<!doctype html><meta charset=utf-8><style>
@font-face{{font-family:Onest;src:url('{rel}/Onest-800.font')}}
body{{background:#F3F1EC;margin:0;padding:24px;font-family:Inter;color:#16181D;width:1180px}}
.grid{{display:grid;grid-template-columns:1fr 1fr;gap:18px}}
section{{background:#fff;border-radius:14px;padding:16px}}
h2{{font:600 15px Inter;margin:0 0 10px}}
.row{{display:flex;align-items:center;gap:16px}}
.avs{{display:flex;gap:8px}}.sm{{display:flex;gap:8px;align-items:center}}
.lock{{display:flex;align-items:center;gap:10px;margin:10px 0}}
.lock span{{font:800 40px Onest;letter-spacing:.01em;color:#0E4D3A}}
.row2{{display:flex;gap:10px}}
.tg{{width:260px;background:#fff;border:1px solid #eee;border-radius:10px;padding:4px 0;font:13px -apple-system,Inter}}
.tg.dark{{background:#17212B;border-color:#17212B;color:#fff}}
.tr{{display:flex;align-items:center;gap:10px;padding:6px 10px}}
.av{{width:54px;height:54px;border-radius:50%;color:#fff;font-weight:600;display:flex;align-items:center;justify-content:center;flex:none;overflow:hidden}}
.tx{{display:flex;flex-direction:column;overflow:hidden;flex:1}}.tx b{{font-weight:600}}
.tx span{{color:#8a8a8a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}
.dark .tx span{{color:#7f91a4}}
i{{font-style:normal;color:#999;font-size:11px;align-self:flex-start;margin-top:6px}}
</style><div class=grid>{''.join(blocks)}</div>"""
    with open(os.path.join(out, "round4.html"), "w") as fh:
        fh.write(html)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
