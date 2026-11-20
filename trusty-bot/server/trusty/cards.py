"""Picture cards for the bot (Pillow): menu banners and per-deal cards in the Trusty style."""
import io
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(__file__), "assets")
W, H = 1200, 630
EMERALD, TETHER, INK, MUTED, BG, LINE, WHITE = "#178A66", "#26A17B", "#0D2C27", "#5E7A72", "#F2F5F3", "#DCE6E1", "#FFFFFF"
AMBER, RED, BLUE = "#A8701A", "#C4472B", "#2F6DB5"

STEPS = ["Оплата", "Работа", "Приёмка", "Выплата"]
STEP_OF = {"awaiting_payment": 0, "in_work": 1, "review": 2, "dispute": 2, "done": 4, "refunded": 4, "cancelled": -1}
STATUS = {
    "awaiting_payment": ("Ожидает оплаты", AMBER, "#FBF1DF"), "in_work": ("В работе", BLUE, "#E5EEF9"),
    "review": ("На приёмке", AMBER, "#FBF1DF"), "done": ("Завершена", EMERALD, "#E3F3EC"),
    "dispute": ("Спор у арбитра", RED, "#FBE9E4"), "cancelled": ("Отменена", MUTED, "#ECF0EE"),
    "refunded": ("Возврат заказчику", MUTED, "#ECF0EE"),
}


@lru_cache(maxsize=32)
def font(size: int, weight: int = 400) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(os.path.join(ASSETS, "Onest.ttf"), size)
    try:
        f.set_variation_by_axes([weight])
    except OSError:
        pass
    return f


@lru_cache(maxsize=4)
def mark(size: int, light: bool) -> Image.Image:
    name = "mark-light.png" if light else "mark-dark.png"
    return Image.open(os.path.join(ASSETS, name)).convert("RGBA").resize((size, size), Image.LANCZOS)


def _jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=92, optimize=True)
    return buf.getvalue()


def _wrap(d: ImageDraw.ImageDraw, text: str, f, width: int, lines: int) -> list[str]:
    words, out, cur = text.split(), [], ""
    for w in words:
        t = f"{cur} {w}".strip()
        if d.textlength(t, font=f) <= width:
            cur = t
        else:
            if cur:
                out.append(cur)
            cur = w
        if len(out) == lines:
            break
    if cur and len(out) < lines:
        out.append(cur)
    if len(out) == lines and " ".join(out) != " ".join(words):
        last = out[-1]
        while last and d.textlength(last + "…", font=f) > width:
            last = last[:-1]
        out[-1] = last.rstrip() + "…"
    return out


def _pill(d: ImageDraw.ImageDraw, x: int, y: int, text: str, fg: str, bg: str, size: int = 26) -> int:
    f = font(size, 600)
    w = int(d.textlength(text, font=f)) + 32
    d.rounded_rectangle((x, y, x + w, y + size + 22), radius=12, fill=bg)
    d.text((x + 16, y + 9), text, font=f, fill=fg)
    return w


def _side(img: Image.Image, d: ImageDraw.ImageDraw, label: str) -> None:
    d.rectangle((0, 0, 380, H), fill=EMERALD)
    m = mark(210, True)
    img.paste(m, (85, 150), m)
    f = font(30, 700)
    tw = d.textlength("TRUSTY", font=f)
    d.text(((380 - tw) / 2, 392), "TRUSTY", font=f, fill=WHITE)
    f2 = font(22, 500)
    tw = d.textlength(label, font=f2)
    d.text(((380 - tw) / 2, 440), label, font=f2, fill="#CFEDE2")


def amount_text(x) -> str:
    s = f"{float(x):,.2f}".replace(",", " ").replace(".", ",")
    return s[:-3] if s.endswith(",00") else s


def deal_card(deal_id: int, title: str, amount, total, status: str, due: str, asset: str = "USDT") -> bytes:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    _side(img, d, "гарант сделок")
    x = 440
    d.text((x, 62), f"СДЕЛКА #{deal_id}", font=font(26, 600), fill=MUTED)
    y = 106
    for line in _wrap(d, title, font(50, 700), W - x - 60, 2):
        d.text((x, y), line, font=font(50, 700), fill=INK)
        y += 62
    y += 14
    d.text((x, y), f"{amount_text(amount)} {asset}", font=font(76, 700), fill=INK)
    y += 100
    label, fg, bg = STATUS.get(status, (status, MUTED, "#ECF0EE"))
    w = _pill(d, x, y, label, fg, bg)
    if status == "awaiting_payment" and total:
        d.text((x + w + 18, y + 12), f"к оплате {amount_text(total)} {asset}", font=font(26, 500), fill=MUTED)
    elif due and status in ("in_work", "review"):
        d.text((x + w + 18, y + 12), f"срок до {due}", font=font(26, 500), fill=MUTED)
    # progress: payment -> work -> acceptance -> payout
    step = STEP_OF.get(status, 0)
    y0, x0, x1 = 520, x + 14, W - 80
    gap = (x1 - x0) / (len(STEPS) - 1)
    d.line((x0, y0, x1, y0), fill=LINE, width=4)
    if step > 0:
        d.line((x0, y0, x0 + gap * min(step, len(STEPS) - 1), y0), fill=EMERALD, width=4)
    for i, name in enumerate(STEPS):
        cx = x0 + gap * i
        done, cur = i < step, i == step
        r = 13 if cur else 10
        d.ellipse((cx - r, y0 - r, cx + r, y0 + r), fill=EMERALD if done or cur else WHITE,
                  outline=EMERALD if done or cur else LINE, width=4)
        f = font(23, 600 if cur else 500)
        tw = d.textlength(name, font=f)
        d.text((cx - tw / 2, y0 + 24), name, font=f, fill=INK if (done or cur) else MUTED)
    return _jpeg(img)


@lru_cache(maxsize=8)
def banner(kind: str) -> bytes:
    """Static menu pictures: welcome | how | help | deals."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    if kind == "welcome":
        img.paste(Image.new("RGB", (W, H), EMERALD))
        d = ImageDraw.Draw(img)
        m = mark(250, True)
        img.paste(m, (120, 190), m)
        d.text((430, 200), "TRUSTY", font=font(96, 700), fill=WHITE)
        d.text((434, 320), "Гарант сделок с разработчиками", font=font(40, 500), fill="#DDF3EA")
        d.text((434, 378), "Оплата в USDT хранится у гаранта до приёмки", font=font(30, 400), fill="#BFE6D7")
        return _jpeg(img)
    titles = {"how": ("Как работает гарант", "4 шага, деньги под защитой"), "help": ("Правила и поддержка", "чтобы сделки проходили спокойно"),
              "deals": ("Мои сделки", "оплата, работа, приёмка, выплата")}
    title, sub = titles.get(kind, ("Trusty", ""))
    _side(img, d, "гарант сделок")
    d.text((440, 70), title, font=font(54, 700), fill=INK)
    d.text((442, 140), sub, font=font(28, 500), fill=MUTED)
    if kind == "how":
        items = [("Условия", "сумма, срок и ТЗ фиксируются"), ("Оплата", "USDT хранятся у гаранта"),
                 ("Работа", "исполнитель сдаёт в чате"), ("Выплата", "после приёмки или через 3 дня")]
    elif kind == "help":
        items = [("Только через Trusty", "оплата мимо гаранта не защищена"), ("Спор", "арбитр решает по переписке"),
                 ("Блокировка", "30 дней, при повторе навсегда")]
    else:
        items = [("Оплата", "через @CryptoBot, в USDT"), ("Приёмка", "или спор, если что-то не так"),
                 ("Выплата", "исполнителю после приёмки")]
    y = 222
    for i, (h, t) in enumerate(items):
        d.ellipse((442, y + 2, 490, y + 50), fill=EMERALD)
        n = str(i + 1)
        f = font(26, 700)
        d.text((466 - d.textlength(n, font=f) / 2, y + 9), n, font=f, fill=WHITE)
        d.text((512, y - 2), h, font=font(32, 700), fill=INK)
        d.text((512, y + 38), t, font=font(25, 400), fill=MUTED)
        y += 96
    return _jpeg(img)
