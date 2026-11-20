"""Palette comparison for the USDT coin version. Usage: python3 palette_board.py <out.html>"""
import os
import sys

from final import AXIS, BOX, LOCK_CAP, LOCK_GAP, mark, wordmark_svg

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = os.path.join(ROOT, "fonts", "Onest-ExtraBold-subset.ttf")

PALETTES = [
    ("Глубокая морская зелень", "#0B2A27", "#E6F3EE"),
    ("Ночной синий", "#0F1B2E", "#E9F0F5"),
    ("Графит", "#141817", "#F1F4F2"),
    ("Светлая мята", "#EEF5F1", "#0D2C27"),
    ("Цвет монеты", "#1E8C69", "#FFFFFF"),
]


def av(bg, m, size, coin_body="#26A17B"):
    cy = (BOX[1] + BOX[3]) / 2
    return (f'<svg viewBox="0 0 100 100" width="{size}" height="{size}"><circle cx="50" cy="50" r="50" fill="{bg}"/>'
            f'<g transform="translate(50 50) scale(.6) translate(-50 {-cy})">{mark(m, coin_body=coin_body, coin_sym=("#1E8C69" if coin_body == "#FFFFFF" else "#FFFFFF"))}</g></svg>')


def lock(m, bg):
    text, tw = wordmark_svg(m, LOCK_CAP, BOX[2] + LOCK_GAP, AXIS + LOCK_CAP / 2 + .5, FONT)
    x0, x1 = BOX[0] - 10, BOX[2] + LOCK_GAP + tw + 10
    return (f'<div class="lk" style="background:{bg}"><svg viewBox="{x0} {BOX[1]-10} {x1-x0} {BOX[3]-BOX[1]+20}" height="70">'
            f'{mark(m)}{text}</svg></div>')


def tg(avatar, dark):
    rows = [("#E17076", "АК", "Алина К.", "Скинула ТЗ, глянь"), None,
            ("#7BC862", "DV", "Dev chat", "Новый проект: парсер…"), ("#65AADD", "МС", "Максим", "ок, завтра созвон")]
    out = []
    for r in rows:
        if r is None:
            out.append(f'<div class="tr"><div class="a">{avatar}</div><div class="tx"><b>Trusty</b><span>Сделка #1042 закрыта, 250 USDT отправлены</span></div></div>')
        else:
            out.append(f'<div class="tr"><div class="a" style="background:{r[0]}">{r[1]}</div><div class="tx"><b>{r[2]}</b><span>{r[3]}</span></div></div>')
    return f'<div class="tg{" dk" if dark else ""}">{"".join(out)}</div>'


def main(out):
    secs = []
    for name, bg, m in PALETTES:
        coin = "#FFFFFF" if name == "Цвет монеты" else "#26A17B"
        sizes = "".join(av(bg, m, s, coin) if coin != "#FFFFFF" else av(bg, m, s, coin) for s in (64, 40, 28, 20))
        secs.append(f'<section><h2>{name}</h2><div class="r">{av(bg, m, 150, coin)}<div class="sz">{sizes}</div>'
                    f'{lock(m, bg)}</div><div class="r">{tg(av(bg, m, 54, coin), False)}{tg(av(bg, m, 54, coin), True)}</div></section>')
    html = f"""<!doctype html><meta charset=utf-8><style>
body{{background:#DDE3E0;margin:0;padding:20px;font-family:Inter;width:1180px}}
section{{background:#fff;border-radius:12px;padding:14px;margin-bottom:14px}}h2{{font:600 14px Inter;margin:0 0 8px}}
.r{{display:flex;gap:16px;align-items:center;margin-bottom:10px}}.sz{{display:flex;gap:8px;align-items:center}}
.lk{{padding:6px 14px;border-radius:10px}}
.tg{{width:300px;background:#fff;border:1px solid #eee;border-radius:10px;font:13px Inter}}.tg.dk{{background:#17212B;color:#fff;border-color:#17212B}}
.tr{{display:flex;gap:10px;align-items:center;padding:6px 10px}}.a{{width:54px;height:54px;border-radius:50%;flex:none;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;overflow:hidden}}
.tx{{display:flex;flex-direction:column;overflow:hidden}}.tx span{{color:#8a8a8a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}}.dk .tx span{{color:#7f91a4}}
</style>{''.join(secs)}"""
    with open(out, "w") as fh:
        fh.write(html)


if __name__ == "__main__":
    main(sys.argv[1])
