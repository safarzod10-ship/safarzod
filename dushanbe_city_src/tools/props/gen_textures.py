#!/usr/bin/env python3
"""Procedural textures for the DUSHANBE prop library (all original work, CC0 by the project).

Writes to dushanbe_city/assets/models/props/textures/:
  signs_atlas.png      1024², 4x4 cells of 256 px: road sign faces (GOST R 52290 style, as used in TJ)
  plates_atlas.png     1024²: street name plates, house numbers, bus-stop plates, countdown, ped lenses, ad
  manhole_*.png        512²: cast-iron hatch (albedo / normal GL / orm)
  paint_grunge_*.png   512² tileable: light neutral painted-metal grunge, tinted by material colour
  sand_*.png           512² tileable sand (sandboxes)
  fabric_red/green.png 256² awning stripes
The cell layout constants are mirrored in props_lib.py (SIGN_CELLS / PLATE_RECTS).
"""
import math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "dushanbe_city", "assets", "models", "props", "textures")
FONT_B = os.path.join(ROOT, "dushanbe_city", "assets", "fonts", "DejaVuSans-Bold.ttf")
FONT_R = os.path.join(ROOT, "dushanbe_city", "assets", "fonts", "DejaVuSans.ttf")

RED = (200, 16, 30)
BLUE = (0, 84, 166)
YELLOW = (250, 190, 0)
WHITE = (246, 246, 242)
BLACK = (22, 22, 24)
SS = 4  # supersampling


def font(sz, bold=True):
    return ImageFont.truetype(FONT_B if bold else FONT_R, int(sz))


def fit_font(draw, text, max_w, max_h, bold=True):
    sz = max_h
    while sz > 6:
        f = font(sz, bold)
        b = draw.textbbox((0, 0), text, font=f)
        if b[2] - b[0] <= max_w and b[3] - b[1] <= max_h:
            return f
        sz -= 2
    return font(6, bold)


def text_c(draw, cx, cy, text, f, fill):
    b = draw.textbbox((0, 0), text, font=f)
    draw.text((cx - (b[0] + b[2]) / 2, cy - (b[1] + b[3]) / 2), text, font=f, fill=fill)


# ---------------------------------------------------------------- pictograms
def walker(d, cx, cy, h, col, mirror=False):
    """Walking person, height h, feet at cy + h/2."""
    s = -1 if mirror else 1
    w = h * 0.085
    head = (cx + s * h * 0.06, cy - h * 0.40)
    d.ellipse([head[0] - h * 0.085, head[1] - h * 0.085, head[0] + h * 0.085, head[1] + h * 0.085], fill=col)
    sh = (cx + s * h * 0.03, cy - h * 0.25)
    hip = (cx - s * h * 0.02, cy + h * 0.06)
    d.line([sh, hip], fill=col, width=int(w * 1.5))
    d.line([sh, (cx + s * h * 0.17, cy - h * 0.06), (cx + s * h * 0.26, cy + h * 0.06)], fill=col, width=int(w), joint="curve")
    d.line([sh, (cx - s * h * 0.12, cy - h * 0.08), (cx - s * h * 0.20, cy + h * 0.04)], fill=col, width=int(w), joint="curve")
    d.line([hip, (cx + s * h * 0.12, cy + h * 0.26), (cx + s * h * 0.22, cy + h * 0.48)], fill=col, width=int(w * 1.1), joint="curve")
    d.line([hip, (cx - s * h * 0.10, cy + h * 0.27), (cx - s * h * 0.24, cy + h * 0.44)], fill=col, width=int(w * 1.1), joint="curve")


def standing(d, cx, cy, h, col):
    w = h * 0.10
    d.ellipse([cx - h * 0.09, cy - h * 0.5, cx + h * 0.09, cy - h * 0.32], fill=col)
    d.rounded_rectangle([cx - h * 0.15, cy - h * 0.30, cx + h * 0.15, cy + h * 0.08], radius=h * 0.05, fill=col)
    d.line([(cx - h * 0.18, cy - h * 0.26), (cx - h * 0.21, cy + h * 0.05)], fill=col, width=int(w * 0.8))
    d.line([(cx + h * 0.18, cy - h * 0.26), (cx + h * 0.21, cy + h * 0.05)], fill=col, width=int(w * 0.8))
    d.rectangle([cx - h * 0.13, cy + h * 0.06, cx - h * 0.02, cy + h * 0.5], fill=col)
    d.rectangle([cx + h * 0.02, cy + h * 0.06, cx + h * 0.13, cy + h * 0.5], fill=col)


def tri_pts(S, inv=False, inset=0.0):
    # equilateral triangle of side 1 (normalised), centred in the square cell like the mesh in props_lib
    h = math.sqrt(3) / 2
    pts = [(-0.5, -h / 2), (0.5, -h / 2), (0.0, h / 2)]
    if inv:
        pts = [(x, -y) for x, y in pts]
    if inset:
        cx, cy = 0, (-h / 6 if not inv else h / 6)
        pts = [(cx + (x - cx) * (1 - inset), cy + (y - cy) * (1 - inset)) for x, y in pts]
    return [((x + 0.5) * S, (0.5 - y) * S) for x, y in pts]


def sign_cell(kind):
    S = 256 * SS
    im = Image.new("RGB", (S, S), WHITE)
    d = ImageDraw.Draw(im)
    m = S * 0.035  # white rim of square signs
    if kind == "5.19.1":
        im.paste(WHITE, (0, 0, S, S))
        d.rounded_rectangle([m, m, S - m, S - m], radius=S * 0.05, fill=BLUE)
        h = math.sqrt(3) / 2
        tri = [(S * 0.5, S * 0.12), (S * 0.92, S * 0.84), (S * 0.08, S * 0.84)]
        d.polygon(tri, fill=WHITE)
        for i in range(4):  # zebra
            x0 = S * (0.27 + i * 0.13)
            d.polygon([(x0, S * 0.79), (x0 + S * 0.08, S * 0.79), (x0 + S * 0.065, S * 0.73), (x0 - S * 0.015, S * 0.73)], fill=BLACK)
        walker(d, S * 0.5, S * 0.52, S * 0.40, BLACK)
    elif kind == "5.16":
        d.rounded_rectangle([m, m, S - m, S - m], radius=S * 0.05, fill=BLUE)
        d.rectangle([S * 0.16, S * 0.16, S * 0.84, S * 0.84], fill=WHITE)
        # bus, front view
        d.rounded_rectangle([S * 0.30, S * 0.24, S * 0.70, S * 0.70], radius=S * 0.05, fill=BLACK)
        d.rectangle([S * 0.34, S * 0.31, S * 0.66, S * 0.50], fill=WHITE)
        d.rectangle([S * 0.36, S * 0.26, S * 0.64, S * 0.285], fill=WHITE)
        d.ellipse([S * 0.34, S * 0.58, S * 0.40, S * 0.64], fill=WHITE)
        d.ellipse([S * 0.60, S * 0.58, S * 0.66, S * 0.64], fill=WHITE)
        d.rectangle([S * 0.32, S * 0.70, S * 0.40, S * 0.77], fill=BLACK)
        d.rectangle([S * 0.60, S * 0.70, S * 0.68, S * 0.77], fill=BLACK)
        d.line([(S * 0.30, S * 0.36), (S * 0.25, S * 0.33), (S * 0.25, S * 0.43)], fill=BLACK, width=int(S * 0.02))
        d.line([(S * 0.70, S * 0.36), (S * 0.75, S * 0.33), (S * 0.75, S * 0.43)], fill=BLACK, width=int(S * 0.02))
    elif kind == "2.1":  # drawn axis aligned, mesh rotated 45 deg
        im.paste(WHITE, (0, 0, S, S))
        d.rectangle([0, 0, S, S], outline=BLACK, width=int(S * 0.012))
        d.rectangle([S * 0.17, S * 0.17, S * 0.83, S * 0.83], fill=YELLOW, outline=BLACK, width=int(S * 0.01))
    elif kind in ("2.4", "1.23"):
        inv = kind == "2.4"
        im.paste(RED, (0, 0, S, S))
        outer = tri_pts(S, inv)
        d.polygon(outer, fill=RED)
        d.polygon(tri_pts(S, inv, inset=0.22), fill=WHITE)
        if kind == "1.23":
            walker(d, S * 0.58, S * 0.60, S * 0.30, BLACK)
            walker(d, S * 0.42, S * 0.64, S * 0.22, BLACK)
            d.line([(S * 0.47, S * 0.60), (S * 0.53, S * 0.58)], fill=BLACK, width=int(S * 0.02))
    elif kind in ("3.24", "3.27", "3.1"):
        im.paste({"3.24": RED, "3.27": RED, "3.1": RED}[kind], (0, 0, S, S))
        if kind == "3.24":
            d.ellipse([S * 0.11, S * 0.11, S * 0.89, S * 0.89], fill=WHITE)
            f = fit_font(d, "60", S * 0.56, S * 0.40)
            text_c(d, S * 0.5, S * 0.5, "60", f, BLACK)
        elif kind == "3.27":
            d.ellipse([S * 0.11, S * 0.11, S * 0.89, S * 0.89], fill=BLUE)
            w = int(S * 0.10)
            a = S * 0.5 - S * 0.39 * 0.7071
            b = S * 0.5 + S * 0.39 * 0.7071
            d.line([(a, a), (b, b)], fill=RED, width=w)
            d.line([(a, b), (b, a)], fill=RED, width=w)
        else:
            d.ellipse([S * 0.01, S * 0.01, S * 0.99, S * 0.99], outline=WHITE, width=int(S * 0.015))
            d.rectangle([S * 0.18, S * 0.42, S * 0.82, S * 0.58], fill=WHITE)
    elif kind == "6.4":
        d.rounded_rectangle([m, m, S - m, S - m], radius=S * 0.05, fill=BLUE)
        f = fit_font(d, "P", S * 0.7, S * 0.62)
        text_c(d, S * 0.5, S * 0.5, "P", f, WHITE)
    elif kind == "5.5":
        d.rounded_rectangle([m, m, S - m, S - m], radius=S * 0.05, fill=BLUE)
        d.rectangle([S * 0.43, S * 0.40, S * 0.57, S * 0.86], fill=WHITE)
        d.polygon([(S * 0.5, S * 0.12), (S * 0.75, S * 0.44), (S * 0.25, S * 0.44)], fill=WHITE)
    elif kind == "back":
        im.paste((150, 152, 150), (0, 0, S, S))
    return im.resize((256, 256), Image.LANCZOS)


SIGN_CELLS = ["5.19.1", "5.16", "2.1", "2.4", "3.24", "3.27", "6.4", "3.1", "5.5", "1.23"]


def make_signs():
    atlas = Image.new("RGB", (1024, 1024), (150, 152, 150))
    for i, k in enumerate(SIGN_CELLS):
        atlas.paste(sign_cell(k), ((i % 4) * 256, (i // 4) * 256))
    atlas.save(os.path.join(OUT, "signs_atlas.png"))


# ---------------------------------------------------------------- plates
STREETS = [("кӯчаи Гулистон", "улица Гулистон", "12"), ("кӯчаи Бахор", "улица Бахор", "14"),
           ("кӯчаи Навбаҳор", "улица Навбахор", "7"), ("хиёбони Ҷавонон", "проспект Джавонон", "45")]
HOUSE_NUMBERS = ["14", "27", "3а", "105"]
# rects in pixels (x, y, w, h) in the 1024 atlas
PLATE_RECTS = {
    "street_0": (0, 0, 512, 128), "street_1": (512, 0, 512, 128),
    "street_2": (0, 128, 512, 128), "street_3": (512, 128, 512, 128),
    "house_0": (0, 256, 128, 128), "house_1": (128, 256, 128, 128),
    "house_2": (256, 256, 128, 128), "house_3": (384, 256, 128, 128),
    "stop_name": (512, 256, 512, 128),
    "route": (0, 384, 512, 128),
    "countdown": (512, 384, 128, 128), "ped_red": (640, 384, 128, 128), "ped_green": (768, 384, 128, 128),
    "electro": (896, 384, 128, 128),
    "ad": (0, 512, 384, 512),
    "gas": (384, 512, 256, 64),
    "container_label": (384, 576, 256, 64),
}


def blue_plate(w, h, border=True):
    im = Image.new("RGB", (w, h), BLUE)
    d = ImageDraw.Draw(im)
    if border:
        b = max(3, h // 22)
        d.rounded_rectangle([b, b, w - b - 1, h - b - 1], radius=h // 10, outline=WHITE, width=b)
    return im, d


def make_plates():
    atlas = Image.new("RGB", (1024, 1024), (40, 40, 44))
    S = SS
    for i, (tj, ru, num) in enumerate(STREETS):
        x, y, w, h = PLATE_RECTS[f"street_{i}"]
        im, d = blue_plate(w * S, h * S)
        W, H = w * S, h * S
        nb = H * 0.86  # number box width
        f1 = fit_font(d, tj, W - nb - H * 0.3, H * 0.42)
        text_c(d, (W - nb) / 2 + H * 0.05, H * 0.38, tj, f1, WHITE)
        f2 = fit_font(d, ru, W - nb - H * 0.5, H * 0.20, bold=False)
        text_c(d, (W - nb) / 2 + H * 0.05, H * 0.76, ru, f2, WHITE)
        d.rounded_rectangle([W - nb, H * 0.12, W - H * 0.12, H * 0.88], radius=H * 0.06, fill=WHITE)
        f3 = fit_font(d, num, nb * 0.75, H * 0.52)
        text_c(d, W - nb / 2 - H * 0.06, H * 0.5, num, f3, BLUE)
        atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    for i, num in enumerate(HOUSE_NUMBERS):
        x, y, w, h = PLATE_RECTS[f"house_{i}"]
        im, d = blue_plate(w * S, h * S)
        f = fit_font(d, num, w * S * 0.78, h * S * 0.62)
        text_c(d, w * S / 2, h * S / 2, num, f, WHITE)
        atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    # bus stop name: "ИСТГОҲ" + stop name + bus pictogram
    x, y, w, h = PLATE_RECTS["stop_name"]
    W, H = w * S, h * S
    im, d = blue_plate(W, H)
    d.rectangle([H * 0.14, H * 0.14, H * 0.86, H * 0.86], fill=WHITE)
    bus = sign_cell("5.16").resize((int(H * 0.72), int(H * 0.72)))
    im.paste(bus.crop((int(H * 0.72 * 0.16), int(H * 0.72 * 0.16), int(H * 0.72 * 0.84), int(H * 0.72 * 0.84))).resize((int(H * 0.72), int(H * 0.72))), (int(H * 0.14), int(H * 0.14)))
    f = fit_font(d, "ИСТГОҲ", W - H * 1.2, H * 0.42)
    text_c(d, H + (W - H) / 2, H * 0.36, "ИСТГОҲ", f, WHITE)
    f = fit_font(d, "«Бахор»", W - H * 1.3, H * 0.26, bold=False)
    text_c(d, H + (W - H) / 2, H * 0.74, "«Бахор»", f, WHITE)
    atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    # route plate (white)
    x, y, w, h = PLATE_RECTS["route"]
    W, H = w * S, h * S
    im = Image.new("RGB", (W, H), WHITE)
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, W - 1, H - 1], outline=BLUE, width=S * 4)
    lines = [("Автобус", "3, 8, 29"), ("Троллейбус", "1, 12"), ("Микроавтобус", "15, 43, 55")]
    fl = font(H * 0.2)
    fr = font(H * 0.22)
    for k, (a, b) in enumerate(lines):
        yy = H * (0.21 + k * 0.29)
        d.rounded_rectangle([H * 0.08, yy - H * 0.12, H * 0.08 + W * 0.42, yy + H * 0.12], radius=H * 0.04, fill=BLUE)
        text_c(d, H * 0.08 + W * 0.21, yy, a, fit_font(d, a, W * 0.39, H * 0.17), WHITE)
        d.text((W * 0.52, yy), "№ " + b, font=fr, fill=BLACK, anchor="lm")
    atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    # countdown timer digits (red LEDs on black)
    x, y, w, h = PLATE_RECTS["countdown"]
    im = Image.new("RGB", (w * S, h * S), (12, 12, 12))
    d = ImageDraw.Draw(im)
    f = fit_font(d, "18", w * S * 0.86, h * S * 0.7)
    text_c(d, w * S / 2, h * S / 2, "18", f, (255, 40, 30))
    atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    for key, col, fn in (("ped_red", (255, 40, 30), "stand"), ("ped_green", (40, 255, 120), "walk")):
        x, y, w, h = PLATE_RECTS[key]
        im = Image.new("RGB", (w * S, h * S), (14, 14, 14))
        d = ImageDraw.Draw(im)
        if fn == "stand":
            standing(d, w * S / 2, h * S / 2, h * S * 0.80, col)
        else:
            walker(d, w * S / 2, h * S / 2, h * S * 0.80, col)
        atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    # electrical warning plate (yellow triangle lightning) for cabinets
    x, y, w, h = PLATE_RECTS["electro"]
    im = Image.new("RGB", (w * S, h * S), (235, 235, 230))
    d = ImageDraw.Draw(im)
    W = w * S
    d.polygon([(W * 0.5, W * 0.08), (W * 0.95, W * 0.88), (W * 0.05, W * 0.88)], fill=BLACK)
    d.polygon([(W * 0.5, W * 0.2), (W * 0.84, W * 0.82), (W * 0.16, W * 0.82)], fill=YELLOW)
    d.polygon([(W * 0.55, W * 0.3), (W * 0.40, W * 0.58), (W * 0.52, W * 0.58), (W * 0.44, W * 0.78), (W * 0.62, W * 0.5), (W * 0.50, W * 0.5)], fill=BLACK)
    atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    # gas label (on yellow pipes: "ГАЗ")
    x, y, w, h = PLATE_RECTS["gas"]
    im = Image.new("RGB", (w * S, h * S), (232, 190, 30))
    d = ImageDraw.Draw(im)
    text_c(d, w * S / 2, h * S / 2, "ГАЗ", fit_font(d, "ГАЗ", w * S * 0.5, h * S * 0.7), (180, 20, 20))
    atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    x, y, w, h = PLATE_RECTS["container_label"]
    im = Image.new("RGB", (w * S, h * S), WHITE)
    d = ImageDraw.Draw(im)
    t = "ПАРТОВҲО / МУСОР"
    text_c(d, w * S / 2, h * S / 2, t, fit_font(d, t, w * S * 0.9, h * S * 0.55), BLACK)
    atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    # advertising poster (fictional brand "ОБИ ТОЗА", mountain water)
    x, y, w, h = PLATE_RECTS["ad"]
    W, H = w * S, h * S
    g = np.linspace(0, 1, H)[:, None]
    sky = (np.array([40, 120, 205]) * (1 - g) + np.array([215, 235, 250]) * g)
    im = Image.fromarray(np.repeat(sky[:, None, :], W, 1).reshape(H, W, 3).astype(np.uint8))
    d = ImageDraw.Draw(im)
    d.polygon([(0, H * 0.62), (W * 0.18, H * 0.44), (W * 0.33, H * 0.55), (W * 0.55, H * 0.36), (W * 0.78, H * 0.52), (W, H * 0.42), (W, H), (0, H)], fill=(70, 90, 120))
    d.polygon([(W * 0.11, H * 0.505), (W * 0.18, H * 0.44), (W * 0.25, H * 0.50), (W * 0.20, H * 0.49), (W * 0.16, H * 0.51)], fill=WHITE)
    d.polygon([(W * 0.86, H * 0.48), (W * 0.96, H * 0.43), (W * 1.0, H * 0.43), (W * 1.0, H * 0.47), (W * 0.93, H * 0.465)], fill=WHITE)
    d.polygon([(0, H * 0.75), (W * 0.4, H * 0.66), (W, H * 0.72), (W, H), (0, H)], fill=(60, 130, 80))
    # bottle
    bx = W * 0.5
    d.rounded_rectangle([bx - W * 0.11, H * 0.38, bx + W * 0.11, H * 0.86], radius=W * 0.05, fill=(160, 210, 240), outline=(30, 90, 160), width=S * 3)
    d.rectangle([bx - W * 0.04, H * 0.30, bx + W * 0.04, H * 0.39], fill=(160, 210, 240), outline=(30, 90, 160), width=S * 3)
    d.rectangle([bx - W * 0.05, H * 0.27, bx + W * 0.05, H * 0.31], fill=(20, 80, 170))
    d.rectangle([bx - W * 0.11, H * 0.56, bx + W * 0.11, H * 0.68], fill=(20, 80, 170))
    f = fit_font(d, "ОБИ ТОЗА", W * 0.88, H * 0.1)
    text_c(d, W / 2, H * 0.1, "ОБИ ТОЗА", f, WHITE)
    f = fit_font(d, "оби кӯҳии табиӣ", W * 0.8, H * 0.05, bold=False)
    text_c(d, W / 2, H * 0.19, "оби кӯҳии табиӣ", f, WHITE)
    text_c(d, bx, H * 0.62, "ТОЗА", fit_font(d, "ТОЗА", W * 0.18, H * 0.05), WHITE)
    f = fit_font(d, "0,5 л · 1,5 л · 5 л", W * 0.8, H * 0.05)
    text_c(d, W / 2, H * 0.93, "0,5 л · 1,5 л · 5 л", f, WHITE)
    atlas.paste(im.resize((w, h), Image.LANCZOS), (x, y))
    atlas.save(os.path.join(OUT, "plates_atlas.png"))


# ---------------------------------------------------------------- tileable noise helpers
def tile_noise(n, scale, seed):
    rng = np.random.default_rng(seed)
    f = np.fft.fftfreq(n)
    fx, fy = np.meshgrid(f, f)
    r = np.sqrt(fx ** 2 + fy ** 2) + 1e-6
    spec = np.fft.fft2(rng.standard_normal((n, n))) * np.exp(-(r * n / scale) ** 2) / r ** 0.5
    a = np.real(np.fft.ifft2(spec))
    return (a - a.mean()) / (a.std() + 1e-9)


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * strength
    n = np.stack([-dx, dy, np.ones_like(h)], -1)  # OpenGL: +Y up (image rows go down)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return Image.fromarray(((n * 0.5 + 0.5) * 255).astype(np.uint8))


def save_orm(path, ao, rough, metal):
    a = np.stack([ao, rough, metal], -1)
    Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8)).save(path)


def make_paint():
    n = 512
    big = tile_noise(n, 6, 1)
    mid = tile_noise(n, 30, 2)
    fine = tile_noise(n, 180, 3)
    stains = np.clip(big * 0.6 + mid * 0.4 - 0.9, 0, 3)
    chips = (tile_noise(n, 90, 4) > 2.6).astype(float)
    val = 0.90 + 0.025 * mid + 0.02 * fine - 0.09 * stains
    col = np.stack([val, val * 0.985, val * 0.96], -1)
    chipc = np.array([0.42, 0.33, 0.26])  # rust/primer
    col = col * (1 - chips[..., None]) + chipc * chips[..., None]
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "paint_grunge_albedo.png"))
    h = 0.3 * mid + 0.15 * fine - chips * 1.5
    normal_from_height(h, 1.2).save(os.path.join(OUT, "paint_grunge_normal.png"))
    save_orm(os.path.join(OUT, "paint_grunge_orm.png"), np.clip(1 - stains * 0.15, 0, 1), np.clip(0.55 + 0.08 * mid + 0.15 * stains + 0.3 * chips, 0, 1), chips * 0.0)


def make_sand():
    n = 512
    a = tile_noise(n, 200, 11)
    b = tile_noise(n, 25, 12)
    v = 0.78 + 0.05 * a + 0.04 * b
    col = np.stack([v * 0.93, v * 0.82, v * 0.62], -1)
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "sand_albedo.png"))
    normal_from_height(0.4 * a + 0.6 * b, 1.5).save(os.path.join(OUT, "sand_normal.png"))


def make_fabric():
    n = 256
    rng = np.random.default_rng(5)
    weave = (np.sin(np.arange(n) * math.pi / 2)[None, :] * np.sin(np.arange(n) * math.pi / 2)[:, None]) * 0.03
    for name, c in (("fabric_red", (175, 30, 32)), ("fabric_green", (24, 110, 60))):
        img = np.zeros((n, n, 3))
        stripe = ((np.arange(n) // 32) % 2 == 0)[None, :, None]
        img[:] = np.where(stripe, np.array(c) / 255, np.array([0.93, 0.92, 0.88]))
        img *= (1 + weave[..., None] + rng.normal(0, 0.02, (n, n, 1)))
        Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, name + ".png"))


def make_manhole():
    n = 512
    yy, xx = np.mgrid[0:n, 0:n]
    cx = cy = (n - 1) / 2
    r = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2) / (n / 2)
    ang = np.arctan2(yy - cy, xx - cx)
    h = np.zeros((n, n))
    h[(r > 0.86) & (r < 1.0)] = 1.0          # frame
    h[(r > 0.80) & (r <= 0.86)] = 0.0        # gap
    lid = r <= 0.80
    # diamond knurl pattern
    u = (xx - cx) / n * 26
    v = (yy - cy) / n * 26
    k = (np.abs(((u + v) % 2) - 1) < 0.28) | (np.abs(((u - v) % 2) - 1) < 0.28)
    h[lid] = 0.45 + 0.35 * k[lid]
    ring = lid & (np.abs(r - 0.75) < 0.035)
    h[ring] = 0.85
    inner = lid & (r < 0.30)
    h[inner] = 0.5
    h[lid & (np.abs(r - 0.30) < 0.025)] = 0.85
    # letter "К" (kanalizatsiya)
    im = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(im)
    text_c(d, cx, cy, "К", font(n * 0.24), 255)
    letter = np.asarray(im) / 255.0
    h = np.maximum(h, np.where(inner, 0.5 + 0.4 * letter, 0))
    for a in range(4):  # pry slots
        aa = a * math.pi / 2 + math.pi / 4
        px, py = cx + math.cos(aa) * n * 0.41, cy + math.sin(aa) * n * 0.41
        h[((xx - px) ** 2 + (yy - py) ** 2) < (n * 0.018) ** 2] = 0.05
    h = np.asarray(Image.fromarray((h * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.6))) / 255.0
    noise = tile_noise(n, 60, 21)
    rust = np.clip(0.5 - h + 0.25 * noise, 0, 1)
    base = np.array([0.20, 0.19, 0.18]) + 0.12 * h[..., None]
    col = base * (1 - rust[..., None] * 0.6) + np.array([0.33, 0.22, 0.14]) * rust[..., None] * 0.6
    col *= (1 + 0.06 * noise[..., None])
    col[r > 1.0] = [0.35, 0.34, 0.32]
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(os.path.join(OUT, "manhole_albedo.png"))
    normal_from_height(h * 6, 1.0).save(os.path.join(OUT, "manhole_normal.png"))
    save_orm(os.path.join(OUT, "manhole_orm.png"), 0.55 + 0.45 * h, np.clip(0.85 - 0.45 * h, 0.3, 1), np.clip(h * 0.5, 0, 1) * (r <= 1.0))


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    make_signs()
    make_plates()
    make_paint()
    make_sand()
    make_fabric()
    make_manhole()
    print("textures ->", OUT)
