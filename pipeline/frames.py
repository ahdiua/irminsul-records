"""QA: pull frames out of a rendered video at given times into a labelled contact sheet.
usage: uv run python pipeline/frames.py <video> <out.jpg> t1,t2,... [cols] [width]
       uv run python pipeline/frames.py <video> <out.jpg> transitions   (each segment boundary +0.4 / +0.9 / +1.4 s)"""
import json, subprocess, sys
from io import BytesIO

from PIL import Image, ImageDraw

from paths import DATA

video, out, spec = sys.argv[1], sys.argv[2], sys.argv[3]
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 4
tw = int(sys.argv[5]) if len(sys.argv) > 5 else 480
if spec == 'transitions':
    film = json.loads((DATA / 'chapters.json').read_text(encoding='utf-8'))
    starts = [s['start'] for c in film['chapters'] for s in c['shots']][1:]
    times = [round(s + d, 2) for s in starts[:12] for d in (0.4, 0.9, 1.4)]
else:
    times = [float(x) for x in spec.split(',')]
th = tw * 9 // 16
rows = (len(times) + cols - 1) // cols
sheet = Image.new('RGB', (cols * tw, rows * th))
dr = ImageDraw.Draw(sheet)
for i, t in enumerate(times):
    png = subprocess.run(['ffmpeg', '-v', 'error', '-ss', f'{t:.3f}', '-i', video, '-frames:v', '1', '-f', 'image2pipe', '-vcodec', 'png', '-'],
                         check=True, capture_output=True).stdout
    im = Image.open(BytesIO(png)).convert('RGB').resize((tw, th), Image.LANCZOS)
    x, y = (i % cols) * tw, (i // cols) * th
    sheet.paste(im, (x, y))
    dr.text((x + 5, y + 4), f'{t:.2f}', fill=(255, 255, 0))
sheet.save(out, quality=85)
print(out, len(times), 'frames')
