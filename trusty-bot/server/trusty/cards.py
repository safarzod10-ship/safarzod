"""Picture cards for the bot (Pillow), 1200×630: the green welcome banner and dark cards for deals and offers.

Style: graphite background, white text, one green (#176345) for plates. Unbounded for amounts and headings,
Manrope for text, the shield-with-a-wave mark.
"""
import io
import os
from functools import lru_cache

from PIL import Image, ImageDraw, ImageFont

ASSETS = os.path.join(os.path.dirname(__file__), "assets")
W, H = 1200, 630
BG, WHITE, MUTED, FAINT, LINE = "#111214", "#F2F3F5", "#8E9299", "#5E636B", "#26282C"
EMERALD, BRAND_BG = "#176345", "#176345"
RED_BG, RED_FG = "#3A1E1C", "#FF8A80"
X0 = 72  # left margin

STEPS = ["Оплата", "Работа", "Проверка", "Выплата"]
STEP_OF = {"awaiting_payment": 0, "in_work": 1, "review": 2, "dispute": 2, "done": 4, "refunded": 4, "cancelled": -1}
STATUS = {"awaiting_payment": "Ждёт оплаты", "in_work": "В работе", "review": "На проверке", "done": "Завершена",
          "dispute": "Спор у арбитра", "cancelled": "Отменена", "refunded": "Возврат"}


@lru_cache(maxsize=48)
def font(family: str, size: int, weight: int) -> ImageFont.FreeTypeFont:
    f = ImageFont.truetype(os.path.join(ASSETS, f"{family}.ttf"), size)
    try:
        f.set_variation_by_axes([weight])
    except OSError:
        pass
    return f


def man(size: int, weight: int = 500):
    return font("Manrope", size, weight)


def unb(size: int, weight: int = 700):
    return font("Unbounded", size, weight)


@lru_cache(maxsize=8)
def mark(height: int) -> Image.Image:
    m = Image.open(os.path.join(ASSETS, "mark.png")).convert("RGBA")
    return m.resize((round(m.width * height / m.height), height), Image.LANCZOS)


def _jpeg(img: Image.Image) -> bytes:
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "JPEG", quality=92, optimize=True)
    return buf.getvalue()


def amount_text(x) -> str:
    s = f"{float(x):,.2f}".replace(",", " ").replace(".", ",")
    return s[:-3] if s.endswith(",00") else s


def _fit(d: ImageDraw.ImageDraw, text: str, f, width: int) -> str:
    if d.textlength(text, font=f) <= width:
        return text
    while text and d.textlength(text + "…", font=f) > width:
        text = text[:-1]
    return text.rstrip() + "…"


def _header(img: Image.Image, d: ImageDraw.ImageDraw, right: str | None = None, plate: str | None = None) -> None:
    m = mark(52)
    img.paste(m, (X0, 62), m)
    d.text((X0 + m.width + 18, 88), "IT TRUSTY", font=unb(26, 600), fill=WHITE, anchor="lm")
    if plate:
        f = man(24, 800)
        w = int(d.textlength(plate, font=f)) + 52
        d.rounded_rectangle((W - X0 - w, 60, W - X0, 116), radius=28, fill=EMERALD)
        d.text((W - X0 - w / 2, 88), plate, font=f, fill=WHITE, anchor="mm")
    elif right:
        d.text((W - X0, 88), right, font=man(28, 700), fill=MUTED, anchor="rm")


def _amount(d: ImageDraw.ImageDraw, amount, asset: str, strike=None, y: int = 300) -> None:
    """Big number on the baseline y, the currency after it, an old price crossed out."""
    big, cur = unb(160, 700), unb(42, 600)
    text = amount_text(amount)
    d.text((X0, y), text, font=big, fill=WHITE, anchor="ls")
    x = X0 + d.textlength(text, font=big) + 22
    d.text((x, y), asset, font=cur, fill=MUTED, anchor="ls")
    if strike is not None:
        x += d.textlength(asset, font=cur) + 28
        old = amount_text(strike)
        f = man(46, 600)
        d.text((x, y), old, font=f, fill=FAINT, anchor="ls")
        w = d.textlength(old, font=f)
        d.line((x - 2, y - 17, x + w + 2, y - 17), fill=FAINT, width=4)


def _clock(d: ImageDraw.ImageDraw, cx: int, cy: int, r: int, color: str) -> None:
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color, width=4)
    d.line((cx, cy, cx, cy - r + 8), fill=color, width=4)
    d.line((cx, cy, cx + r - 9, cy + 4), fill=color, width=4)


def deal_card(deal_id: int, title: str, amount, total, status: str, asset: str = "USDT") -> bytes:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    _header(img, d, right=f"Сделка #{deal_id}")
    _amount(d, amount, asset)
    # status plate + title
    label = STATUS.get(status, status)
    f = man(26, 800)
    w = int(d.textlength(label, font=f)) + 52
    bg, fg = (RED_BG, RED_FG) if status == "dispute" else (LINE, WHITE) if status in ("cancelled", "refunded") else (EMERALD, WHITE)
    d.rounded_rectangle((X0, 354, X0 + w, 410), radius=28, fill=bg)
    d.text((X0 + w / 2, 382), label, font=f, fill=fg, anchor="mm")
    d.text((X0 + w + 24, 382), _fit(d, title, man(34, 700), W - X0 - (X0 + w + 24)), font=man(34, 700), fill=WHITE, anchor="lm")
    if status == "awaiting_payment" and total:
        d.text((X0, 452), f"К оплате {amount_text(total)} {asset} с комиссией гаранта", font=man(26, 600), fill=MUTED, anchor="lm")
    # progress: four bars with names
    step = STEP_OF.get(status, 0)
    if step >= 0:
        gap, y = 16, 520
        bw = (W - 2 * X0 - gap * 3) / 4
        for i, name in enumerate(STEPS):
            x = X0 + i * (bw + gap)
            on = i < step or (i == step and status != "dispute")
            color = RED_FG if (status == "dispute" and i == step) else EMERALD if on else LINE
            d.rounded_rectangle((x, y, x + bw, y + 10), radius=5, fill=color)
            d.text((x, y + 30), name, font=man(25, 700), fill=WHITE if i <= step else FAINT, anchor="lt")
    return _jpeg(img)


def offer_card(amount: int, prev_amount: int | None, title: str, sender: str, days: int, left: str, asset: str = "USDT") -> bytes:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    _header(img, d, plate="ВСТРЕЧНАЯ ЦЕНА" if prev_amount else "ОФФЕР")
    _amount(d, amount, asset, strike=prev_amount)
    d.text((X0, 382), _fit(d, title, man(40, 700), W - 2 * X0), font=man(40, 700), fill=WHITE, anchor="lm")
    d.text((X0, 548), _fit(d, f"{sender} · срок {days} дн.", man(30, 600), 700), font=man(30, 600), fill=MUTED, anchor="lm")
    f = man(32, 700)
    tw = d.textlength(left, font=f)
    d.text((W - X0, 548), left, font=f, fill=WHITE, anchor="rm")
    _clock(d, int(W - X0 - tw - 34), 548, 17, WHITE)
    return _jpeg(img)


# The welcome banner copies the brand banner: green field, white shield, "IT TRUSTY" and the four lines under it.
BANNER_LINES = ["Безопасный сервис для проведения сделок.", "Простой и удобный инструмент для прозрачного",
                "сотрудничества, фиксации договорённостей", "и комфортной работы на каждом этапе."]


@lru_cache(maxsize=8)
def banner(kind: str) -> bytes:
    """Menu pictures: welcome (the green banner) | how | help | deals."""
    if kind == "welcome":
        img = Image.new("RGB", (W, H), BRAND_BG)
        d = ImageDraw.Draw(img)
        k = 0.946  # the brand banner is 1230×666
        ox = (W - 855 * k) / 2 - 222 * k
        m = mark(round(244 * k))
        img.paste(m, (round(ox + 222 * k), round(222 * k)), m)
        d.text((ox + 482 * k, 270 * k), "IT TRUSTY", font=man(round(66 * k), 600), fill=WHITE, anchor="ls")
        for i, line in enumerate(BANNER_LINES):
            d.text((ox + 482 * k, (364 + i * 33.5) * k), line, font=man(round(26 * k), 500), fill=WHITE, anchor="ls")
        return _jpeg(img)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    titles = {"how": ("Как работает гарант", [("Договоритесь о цене", "оффер с суммой и сроком, можно торговаться"),
                                               ("Оплатите в гарант", "USDT в @CryptoBot, деньги заморожены"),
                                               ("Примите работу", "исполнитель получает оплату")]),
              "help": ("Правила", [("Только через IT Trusty", "сделки мимо гаранта не защищены"),
                                   ("Спор", "арбитр решает по переписке и доказательствам"),
                                   ("Блокировка", "30 дней, при повторе навсегда")]),
              "deals": ("Мои сделки", [("Оплата", "через @CryptoBot, в USDT"), ("Проверка", "или спор, если что-то не так"),
                                       ("Выплата", "исполнителю после приёмки")])}
    title, items = titles.get(kind, ("IT Trusty", []))
    _header(img, d)
    d.text((X0, 215), title, font=unb(50, 700), fill=WHITE, anchor="ls")
    y = 300
    for i, (h, t) in enumerate(items):
        d.text((X0, y), f"{i + 1:02d}", font=unb(28, 600), fill=FAINT, anchor="lt")
        d.text((X0 + 80, y - 4), h, font=man(34, 700), fill=WHITE, anchor="lt")
        d.text((X0 + 80, y + 42), t, font=man(26, 500), fill=MUTED, anchor="lt")
        y += 104
    return _jpeg(img)


def _plate(d: ImageDraw.ImageDraw, x: int, y: int, text: str, bg: str = EMERALD, fg: str = WHITE, size: int = 24) -> int:
    f = man(size, 800)
    w = int(d.textlength(text, font=f)) + 44
    d.rounded_rectangle((x, y, x + w, y + size + 26), radius=(size + 26) // 2, fill=bg)
    d.text((x + w / 2, y + (size + 26) / 2), text, font=f, fill=fg, anchor="mm")
    return w


def dev_card(name: str, title: str, level: str, rating: float, deals: int, on_time: int, stack: list[str], pro: bool,
             bot: str) -> bytes:
    """The executor's public card for sharing: link previews and stories."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    _header(img, d, right="исполнитель")
    initials = "".join(w[0] for w in name.split()[:2]).upper() or "?"
    d.ellipse((X0, 160, X0 + 150, 310), fill="#1C1D20")
    d.text((X0 + 75, 235), initials, font=unb(54, 700), fill=WHITE, anchor="mm")
    x = X0 + 186
    d.text((x, 196), _fit(d, name, man(54, 800), W - x - X0), font=man(54, 800), fill=WHITE, anchor="ls")
    d.text((x, 248), _fit(d, title, man(30, 600), W - x - X0), font=man(30, 600), fill=MUTED, anchor="ls")
    px = x
    px += _plate(d, px, 272, level) + 12
    if pro:
        _plate(d, px, 272, "PRO", bg=WHITE, fg="#0B0C0E")
    stats = [(f"{rating:.1f}" if deals else "—", "рейтинг"), (str(deals), "сделок"), (f"{on_time}%" if deals else "—", "в срок")]
    sx = X0
    for value, label in stats:
        d.text((sx, 420), value, font=unb(64, 700), fill=WHITE, anchor="ls")
        d.text((sx, 462), label, font=man(26, 600), fill=MUTED, anchor="ls")
        sx += 300
    d.text((X0, 560), _fit(d, " · ".join(stack[:5]), man(28, 600), 640), font=man(28, 600), fill=MUTED, anchor="lm")
    d.text((W - X0, 560), f"t.me/{bot}", font=man(28, 700), fill=WHITE, anchor="rm")
    return _jpeg(img)


def project_card(title: str, budget: str, days: int, category: str, note: str = "ПРОЕКТ") -> bytes:
    """A project in the bot: alerts for Pro executors, invitations, picks for the client."""
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    _header(img, d, plate=note)
    words, lines, cur = title.split(), [], ""
    f = man(56, 800)
    for w in words:
        t = f"{cur} {w}".strip()
        if d.textlength(t, font=f) <= W - 2 * X0:
            cur = t
        else:
            lines.append(cur)
            cur = w
    lines.append(cur)
    if len(lines) > 2:
        lines = [lines[0], _fit(d, " ".join(lines[1:]), f, W - 2 * X0)]
    for i, line in enumerate(lines):
        d.text((X0, 230 + i * 70), line, font=f, fill=WHITE, anchor="ls")
    d.text((X0, 440), budget, font=unb(72, 700), fill=WHITE, anchor="ls")
    d.text((X0, 548), f"{category} · срок {days} дн." if category else f"срок {days} дн.", font=man(30, 600), fill=MUTED, anchor="lm")
    return _jpeg(img)
