# Contact sheet of snapshots: python3 tools/sheet.py <dir> [cols] [scale]
import sys, glob, os
from PIL import Image, ImageDraw
d = sys.argv[1]; cols = int(sys.argv[2]) if len(sys.argv) > 2 else 4; sc = float(sys.argv[3]) if len(sys.argv) > 3 else 0.5
fs = sorted(glob.glob(os.path.join(d, 't_*.png')), key=lambda f: float(os.path.basename(f)[2:-4]))
ims = [Image.open(f) for f in fs]
w, h = int(ims[0].width * sc), int(ims[0].height * sc)
rows = (len(ims) + cols - 1) // cols
out = Image.new('RGB', (w * cols, h * rows), 'white')
dr = ImageDraw.Draw(out)
for i, (f, im) in enumerate(zip(fs, ims)):
    x, y = (i % cols) * w, (i // cols) * h
    out.paste(im.resize((w, h)), (x, y))
    dr.text((x + 6, y + 6), os.path.basename(f)[2:-4] + 's', fill='black')
out.save(os.path.join(d, 'sheet.png'))
