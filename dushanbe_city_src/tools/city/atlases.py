"""Procedural texture atlases for the city: window interiors and Tajik-language signage.

window_atlas: 4x4 cells (256 px). Each cell = what is seen through glass: tulle curtains,
coloured drapes, blinds, dark rooms with ceiling lamp, office ceilings, shop interiors.
Alpha channel = night emission mask (lit rooms), used by the glass shader at night.

sign_atlas: 2 columns x 16 rows of 1024x128 px cells. SIGNS lists text + colours; buildings
reference signs by key. Text is Tajik (Cyrillic with Ҳ Ӣ Ӯ Қ Ғ Ҷ), sometimes with Russian
duplicates — as on real Dushanbe shopfronts.
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_B = None
FONT_R = None

# key: (main text, sub text, bg, fg, accent/style)
SIGNS = {
    "dorukhona":    ("ДОРУХОНА", "АПТЕКА · 24/7", (18, 140, 70), (255, 255, 255), "cross"),
    "dorukhona2":   ("ДОРУХОНАИ «ШИФО»", "", (255, 255, 255), (20, 130, 60), "cross"),
    "magoza":       ("МАҒОЗА", "ХӮРОКВОРӢ · ПРОДУКТЫ", (200, 30, 35), (255, 255, 255), ""),
    "supermarket":  ("СУПЕРМАРКЕТ «БАРАКАТ»", "ҲАР РӮЗ 8:00–23:00 · ЕЖЕДНЕВНО", (250, 190, 20), (120, 20, 20), ""),
    "nonvoikhona":  ("НОНВОЙХОНА", "НОНИ ГАРМ · ГОРЯЧИЙ ХЛЕБ", (120, 70, 30), (255, 230, 170), ""),
    "choikhona":    ("ЧОЙХОНА «ДӮСТОН»", "ОШ · ШАШЛИК · ЧОЙ", (30, 70, 140), (255, 215, 90), "orn"),
    "qahvakhona":   ("ҚАҲВАХОНА", "КОФЕЙНЯ · COFFEE", (40, 30, 28), (235, 200, 150), ""),
    "sartaroshkhona": ("САРТАРОШХОНА", "ПАРИКМАХЕРСКАЯ", (245, 245, 245), (30, 30, 30), "stripe"),
    "avtoservis":   ("ХИЗМАТРАСОНИИ АВТОМОБИЛӢ", "АВТОСЕРВИС", (20, 60, 150), (255, 255, 255), ""),
    "shinomontazh": ("ШИНОМОНТАЖ", "24 СОАТ · КРУГЛОСУТОЧНО", (240, 200, 0), (20, 20, 20), ""),
    "telefon":      ("ТЕЛЕФОНҲО ВА ЛАВОЗИМОТ", "ТЕЛЕФОНЫ И АКСЕССУАРЫ", (230, 90, 20), (255, 255, 255), ""),
    "meva":         ("МЕВА ВА САБЗАВОТ", "ФРУКТЫ И ОВОЩИ", (60, 150, 40), (255, 255, 255), ""),
    "libos":        ("ЛИБОСИ ЗАНОНА", "ЖЕНСКАЯ ОДЕЖДА", (150, 40, 90), (255, 255, 255), ""),
    "bank":         ("БОНК · БАНКОМАТ", "БАНК · БАНКОМАТ 24/7", (10, 60, 110), (255, 255, 255), ""),
    "mehmonkhona":  ("МЕҲМОНХОНА «НАВРӮЗ»", "ГОСТИНИЦА «НАВРУЗ»", (60, 25, 20), (230, 190, 110), "orn"),
    "bemorkhona":   ("БЕМОРХОНАИ ШАҲРӢ № 3", "ГОРОДСКАЯ БОЛЬНИЦА № 3", (255, 255, 255), (170, 20, 30), "cross_red"),
    "qabul":        ("ҚАБУЛИ БЕМОРОН", "ПРИЁМНОЕ ОТДЕЛЕНИЕ", (170, 20, 30), (255, 255, 255), ""),
    "maktab":       ("МАКТАБИ МИЁНАИ ТАЪЛИМИ УМУМИИ № 45", "СРЕДНЯЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ШКОЛА № 45", (20, 70, 140), (255, 255, 255), ""),
    "idora":        ("МАҚОМОТИ ИҶРОИЯИ ҲОКИМИЯТИ ДАВЛАТӢ", "НОҲИЯИ ШАҲРӢ", (240, 240, 235), (20, 40, 90), ""),
    "office":       ("МАРКАЗИ ТИҶОРАТӢ «САДАФ»", "ТОРГОВЫЙ ЦЕНТР «САДАФ»", (35, 35, 40), (220, 220, 225), ""),
    "kitob":        ("КИТОБФУРӮШӢ", "КНИЖНЫЙ МАГАЗИН", (90, 50, 120), (255, 255, 255), ""),
    "gul":          ("ГУЛФУРӮШӢ", "ЦВЕТЫ", (240, 120, 160), (255, 255, 255), ""),
    "khojagi":      ("МОЛҲОИ ХОҶАГИИ ХОНАГӢ", "ХОЗЯЙСТВЕННЫЕ ТОВАРЫ", (40, 120, 160), (255, 255, 255), ""),
    "osh":          ("ОШХОНА", "ТАОМҲОИ МИЛЛӢ · НАЦИОНАЛЬНАЯ КУХНЯ", (140, 20, 20), (255, 220, 120), "orn"),
    "pharm_cross":  ("", "", (18, 140, 70), (255, 255, 255), "bigcross"),
    "num1":         ("1", "1–20", (20, 60, 140), (255, 255, 255), "plate"),
    "num2":         ("2", "21–40", (20, 60, 140), (255, 255, 255), "plate"),
    "num3":         ("3", "41–60", (20, 60, 140), (255, 255, 255), "plate"),
    "num4":         ("4", "61–80", (20, 60, 140), (255, 255, 255), "plate"),
    "street1":      ("кӯчаи Гулистон", "", (20, 60, 140), (255, 255, 255), "plate"),
    "street2":      ("кӯчаи Бахор", "", (20, 60, 140), (255, 255, 255), "plate"),
    # stage 3: public buildings and more services (Tajik + Russian)
    "darmongoh":    ("ДАРМОНГОҲИ ШАҲРИИ № 5", "ГОРОДСКАЯ ПОЛИКЛИНИКА № 5", (255, 255, 255), (20, 90, 160), "cross_red"),
    "varzish":      ("МАҶМААИ ВАРЗИШӢ «ПАХТАКОР»", "СПОРТИВНЫЙ КОМПЛЕКС «ПАХТАКОР»", (20, 90, 60), (255, 255, 255), ""),
    "otashnishon":  ("ХАДАМОТИ ОТАШНИШОНӢ · 101", "ПОЖАРНАЯ ЧАСТЬ · 101", (190, 25, 25), (255, 255, 255), ""),
    "pochta":       ("ПОЧТАИ ТОҶИК", "ПОЧТА", (250, 200, 0), (20, 50, 120), ""),
    "salon":        ("ОРОИШГОҲИ ЗЕБОӢ", "САЛОН КРАСОТЫ", (60, 20, 50), (240, 200, 220), ""),
    "kafe":         ("КАФЕ «РОҲАТ»", "ТАОМҲО · ШИРИНӢ · ДЕСЕРТЫ", (110, 60, 30), (255, 235, 200), "orn"),
    "idora_ru":     ("ҲУКУМАТИ НОҲИЯИ ШАҲРӢ", "ХУКУМАТ ГОРОДСКОГО РАЙОНА", (240, 240, 235), (20, 40, 90), ""),
}
SIGN_KEYS = list(SIGNS.keys())
CELL_W, CELL_H, COLS = 1024, 128, 2
ROWS = (len(SIGN_KEYS) + COLS - 1) // COLS
ATLAS_H = 2048 if ROWS <= 16 else 4096


def sign_uv(key):
    """Return (u0, v0, u1, v1) of the sign cell in the 2048 x ATLAS_H atlas."""
    i = SIGN_KEYS.index(key)
    c, r = i % COLS, i // COLS
    W, H = CELL_W * COLS, ATLAS_H
    return (c * CELL_W / W, r * CELL_H / H, (c + 1) * CELL_W / W, (r + 1) * CELL_H / H)


def _fit_font(draw, text, max_w, max_h, bold=True):
    size = max_h
    while size > 10:
        f = ImageFont.truetype(FONT_B if bold else FONT_R, size)
        bb = draw.textbbox((0, 0), text, font=f)
        if bb[2] - bb[0] <= max_w and bb[3] - bb[1] <= max_h:
            return f, bb
        size -= 2
    f = ImageFont.truetype(FONT_B if bold else FONT_R, 10)
    return f, draw.textbbox((0, 0), text, font=f)


def make_sign_atlas(path, font_dir):
    global FONT_B, FONT_R
    FONT_B = os.path.join(font_dir, "DejaVuSans-Bold.ttf")
    FONT_R = os.path.join(font_dir, "DejaVuSans.ttf")
    img = Image.new("RGB", (CELL_W * COLS, ATLAS_H), (40, 40, 40))
    for i, key in enumerate(SIGN_KEYS):
        main, sub, bg, fg, style = SIGNS[key]
        cell = Image.new("RGB", (CELL_W, CELL_H), bg)
        d = ImageDraw.Draw(cell)
        x0 = 24
        if style in ("cross", "cross_red", "bigcross"):
            cc = (255, 255, 255) if style != "cross_red" else (200, 20, 30)
            if style == "cross" and bg[0] > 200:
                cc = (20, 150, 70)
            s = 34 if style != "bigcross" else 56
            cx, cy = (CELL_H // 2 + 8, CELL_H // 2) if style != "bigcross" else (CELL_W // 2, CELL_H // 2)
            d.rectangle([cx - s // 3, cy - s, cx + s // 3, cy + s], fill=cc)
            d.rectangle([cx - s, cy - s // 3, cx + s, cy + s // 3], fill=cc)
            x0 = CELL_H + 20
        if style == "stripe":
            for k in range(0, CELL_H, 16):
                d.polygon([(0, k), (60, k - 30), (60, k - 22), (0, k + 8)], fill=(200, 30, 30))
            x0 = 80
        if style == "orn":
            for k in range(0, CELL_W, 32):
                d.polygon([(k, 6), (k + 16, 0), (k + 32, 6), (k + 16, 12)], fill=fg)
                d.polygon([(k, CELL_H - 6), (k + 16, CELL_H), (k + 32, CELL_H - 6), (k + 16, CELL_H - 12)], fill=fg)
        if style == "plate":
            d.rectangle([4, 4, CELL_W - 5, CELL_H - 5], outline=fg, width=4)
        if main:
            mh = 70 if sub else 84
            f, bb = _fit_font(d, main, CELL_W - x0 - 24, mh)
            tw = bb[2] - bb[0]
            tx = x0 + (CELL_W - x0 - 24 - tw) // 2 - bb[0]
            ty = (12 if sub else (CELL_H - (bb[3] - bb[1])) // 2) - bb[1]
            d.text((tx, ty), main, font=f, fill=fg)
        if sub:
            f, bb = _fit_font(d, sub, CELL_W - x0 - 40, 30, bold=False)
            tw = bb[2] - bb[0]
            d.text((x0 + (CELL_W - x0 - 24 - tw) // 2 - bb[0], 88 - bb[1]), sub, font=f, fill=fg)
        # subtle weathering: light vignette + noise
        cell = cell.filter(ImageFilter.GaussianBlur(0.6))
        img.paste(cell, ((i % COLS) * CELL_W, (i // COLS) * CELL_H))
    img.save(path)


def _noise(rng, w, h, amp):
    im = Image.new("L", (w // 8, h // 8))
    im.putdata([int(128 + rng.uniform(-amp, amp)) for _ in range((w // 8) * (h // 8))])
    return im.resize((w, h), Image.BICUBIC)


def make_window_atlas(path, seed=7):
    """16 cells: index meaning listed in WINDOW_KINDS."""
    rng = random.Random(seed)
    S = 256
    img = Image.new("RGBA", (S * 4, S * 4))
    kinds = []
    for i in range(16):
        cell = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        d = ImageDraw.Draw(cell)
        # room depth: dark gradient (ceiling lighter at top)
        base = rng.choice([(38, 36, 34), (45, 42, 40), (30, 32, 36), (52, 46, 40)])
        for y in range(S):
            k = 0.65 + 0.5 * (1 - y / S) ** 2
            d.line([(0, y), (S, y)], fill=(int(base[0] * k), int(base[1] * k), int(base[2] * k), 0))
        lit = rng.random() < 0.45
        kind = i % 8
        if kind in (0, 1, 2):        # white tulle (very common) + optional drapes
            for x in range(0, S, 3):
                v = 205 + int(30 * math.sin(x * 0.21 + i) * math.sin(x * 0.05))
                a = 0.78 + 0.14 * math.sin(x * 0.13 + i)
                for y in range(int(S * 0.06), S):
                    r, g, b, _ = cell.getpixel((x, y))
                    cell.putpixel((x, y), (int(r * (1 - a) + v * a), int(g * (1 - a) + v * a), int(b * (1 - a) + (v - 8) * a), 0))
            if kind != 0:
                col = rng.choice([(150, 40, 50), (190, 150, 80), (60, 90, 140), (120, 80, 50), (90, 120, 70), (200, 170, 140)])
                w = rng.randint(30, 60)
                for side in (0, 1):
                    xa = 0 if side == 0 else S - w
                    for x in range(xa, xa + w):
                        f = 0.75 + 0.25 * math.sin((x - xa) * 0.5)
                        d.line([(x, 0), (x, S)], fill=(int(col[0] * f), int(col[1] * f), int(col[2] * f), 0))
            d.rectangle([0, 0, S, int(S * 0.06)], fill=(90, 80, 70, 0))  # cornice
        elif kind == 3:              # horizontal blinds
            col = rng.choice([(210, 205, 195), (180, 190, 200), (220, 200, 160)])
            for y in range(0, S, 9):
                d.rectangle([0, y, S, y + 6], fill=col + (0,))
        elif kind == 4:              # dark room with furniture silhouettes
            d.rectangle([20, int(S * 0.55), 120, S], fill=(25, 22, 20, 0))
            d.rectangle([150, int(S * 0.35), 230, S], fill=(30, 26, 22, 0))
        elif kind == 5:              # office: ceiling panels + light
            for x in range(0, S, 64):
                d.rectangle([x + 6, 6, x + 56, 22], fill=(230, 230, 220, 0))
            d.rectangle([0, int(S * 0.6), S, S], fill=(70, 70, 75, 0))
        elif kind == 6:              # roller curtain half down
            h = rng.randint(60, 160)
            d.rectangle([0, 0, S, h], fill=(225, 215, 190, 0))
        else:                        # empty dark (reflection dominates)
            pass
        # emission mask for night
        if lit:
            glow = Image.new("L", (S, S), 0)
            gd = ImageDraw.Draw(glow)
            gd.rectangle([0, 0, S, S], fill=rng.randint(150, 230))
            cell.putalpha(glow)
        else:
            cell.putalpha(0)
        kinds.append(kind)
        img.paste(cell, ((i % 4) * S, (i // 4) * S))
    # alpha 0 means "not lit" — the shader uses alpha only at night.
    img.save(path)
    return kinds


def window_uv(cell):
    c, r = cell % 4, cell // 4
    return (c / 4, r / 4, (c + 1) / 4, (r + 1) / 4)


if __name__ == "__main__":
    import sys
    root = sys.argv[1]
    make_sign_atlas(os.path.join(root, "assets/textures/signs_atlas.png"), os.path.join(root, "assets/fonts"))
    make_window_atlas(os.path.join(root, "assets/textures/windows_atlas.png"))
