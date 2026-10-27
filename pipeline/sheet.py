"""QA: a labelled contact sheet of PNG stills.  uv run python pipeline/sheet.py <dir> [cols] [width]"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

d = Path(sys.argv[1])
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 3
tw = int(sys.argv[3]) if len(sys.argv) > 3 else 640
files = sorted(d.glob('f_*.png'))
th = tw * 9 // 16
rows = (len(files) + cols - 1) // cols
sh = Image.new('RGB', (cols * tw, rows * th), (0, 0, 0))
dr = ImageDraw.Draw(sh)
for i, f in enumerate(files):
    im = Image.open(f).convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * th
    sh.paste(im, (x, y))
    dr.text((x + 6, y + 4), f.stem[2:], fill=(255, 255, 0))
out = d / 'sheet.jpg'
sh.save(out, quality=86)
print(out)
