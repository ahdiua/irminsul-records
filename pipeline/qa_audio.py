"""QA: spectrogram + short-term loudness of an audio file with the chapter boundaries.
usage: uv run python pipeline/qa_audio.py build/music/score.wav [out.png] [t0 t1]"""
import json, sys

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import soundfile as sf
from scipy import signal

from paths import DATA, QA

src = sys.argv[1]
out = sys.argv[2] if len(sys.argv) > 2 else str(QA / 'audio.png')
x, sr = sf.read(src, dtype='float32', always_2d=True)
t0 = float(sys.argv[3]) if len(sys.argv) > 3 else 0
t1 = float(sys.argv[4]) if len(sys.argv) > 4 else len(x) / sr
x = x[int(t0 * sr):int(t1 * sr)]
m = x.mean(1)
print(f'peak {np.abs(x).max():.3f}  dc {x.mean(0)}  rms {np.sqrt((m ** 2).mean()):.4f}  len {len(x) / sr:.1f}s')
f, tt, S = signal.spectrogram(m, sr, nperseg=4096, noverlap=2048)
fig, ax = plt.subplots(2, 1, figsize=(22, 9), sharex=True, gridspec_kw={'height_ratios': [3, 1]})
ax[0].pcolormesh(tt + t0, f, 10 * np.log10(S + 1e-12), vmin=-120, vmax=-40, shading='auto', cmap='magma')
ax[0].set_yscale('symlog', linthresh=200); ax[0].set_ylim(30, 16000)
hop = sr // 10
n = len(m) // hop
r = np.sqrt((m[: n * hop] ** 2).reshape(n, hop).mean(1))
ax[1].plot(np.arange(len(r)) / 10 + t0, 20 * np.log10(r + 1e-6))
ax[1].set_ylim(-70, 0)
film = json.loads((DATA / 'chapters.json').read_text(encoding='utf-8'))
for c in film['chapters']:
    for a in ax:
        a.axvline(c['start'], color='cyan', lw=0.8)
    ax[0].text(c['start'], 12000, c['id'], color='cyan')
plt.tight_layout(); plt.savefig(out, dpi=60)
print(out)
