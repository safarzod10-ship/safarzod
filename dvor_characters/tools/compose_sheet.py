"""Compose review sheets from viewer screenshots (Pillow only).

    /opt/dvor-venv/bin/python tools/compose_sheet.py CH_Technik technik
Writes review/<char>/turnaround_sheet.png and review/<char>/poses_sheet.png
"""
import glob
import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG = (231, 227, 222)


def font(size):
    for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"):
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def label(im, text, size=18):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, size + 10], fill=(40, 38, 40))
    d.text((8, 4), text, fill=(255, 255, 255), font=font(size))
    return im


def fit(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)


def turnaround(char, ref_key):
    d = os.path.join(ROOT, "review", char)
    H = 640
    tiles = []
    ref = os.path.join(ROOT, "ref", f"{ref_key}.png")
    if os.path.exists(ref):
        r = Image.open(ref).convert("RGB")
        r = r.crop((0, int(r.height * 0.22), r.width, int(r.height * 0.92)))
        tiles.append(label(fit(r, H), "референс"))
    names = {"front": "спереди", "side": "сбоку", "back": "сзади", "threequarter": "3/4"}
    for v, ru in names.items():
        tiles.append(label(Image.open(os.path.join(d, f"{v}_lod0.png")).convert("RGB"), f"{ru} · LOD0"))
    row1 = Image.new("RGB", (sum(t.width for t in tiles) + 8 * (len(tiles) - 1), H), BG)
    x = 0
    for t in tiles:
        row1.paste(t, (x, 0))
        x += t.width + 8
    tiles2 = []
    for lod in (0, 1):
        gp = os.path.join(d, f"game_lod{lod}.png")
        if os.path.exists(gp):
            tiles2.append(label(Image.open(gp).convert("RGB"), f"игровая камера · LOD{lod}"))
    for lod in (0, 1):
        w = os.path.join(d, f"wire_lod{lod}.png")
        if os.path.exists(w):
            tiles2.append(label(fit(Image.open(w).convert("RGB"), 420), f"сетка · LOD{lod}"))
    for v in ("front", "side"):
        fp = os.path.join(d, f"{v}_lod1.png")
        if os.path.exists(fp):
            tiles2.append(label(fit(Image.open(fp).convert("RGB"), 420), f"{names[v]} · LOD1"))
    fp = os.path.join(d, "face_lod0.png")
    if os.path.exists(fp):
        tiles2.append(label(fit(Image.open(fp).convert("RGB"), 420), "лицо"))
    row2 = Image.new("RGB", (sum(t.width for t in tiles2) + 8 * (len(tiles2) - 1), 420), BG)
    x = 0
    for t in tiles2:
        row2.paste(t, (x, 0))
        x += t.width + 8
    W = max(row1.width, row2.width)
    sheet = Image.new("RGB", (W, H + 420 + 8), BG)
    sheet.paste(row1, (0, 0))
    sheet.paste(row2, (0, H + 8))
    out = os.path.join(d, "turnaround_sheet.png")
    sheet.save(out, optimize=True)
    return out


def poses(char):
    d = os.path.join(ROOT, "review", char, "poses")
    files = sorted(glob.glob(os.path.join(d, "*.png")))
    if not files:
        return None
    order = ["Idle", "Run", "Attack", "Ability", "Hit", "Defeat", "Victory"]
    files.sort(key=lambda f: (order.index(os.path.basename(f).split("_")[0]), f))
    ims = [label(Image.open(f).convert("RGB"), os.path.basename(f)[:-4].replace("_", " t="), 15) for f in files]
    cols = 7
    w, h = ims[0].size
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (cols * (w + 4), rows * (h + 4)), BG)
    for i, im in enumerate(ims):
        sheet.paste(im, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
    out = os.path.join(ROOT, "review", char, "poses_sheet.png")
    sheet.save(out, optimize=True)
    return out


if __name__ == "__main__":
    char, ref_key = sys.argv[1], sys.argv[2]
    if "--poses-only" not in sys.argv:
        print(turnaround(char, ref_key))
    print(poses(char))
