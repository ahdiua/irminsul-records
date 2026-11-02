"""Retake one line for what the other checks can't hear: pace, stalls, and the tone of one syllable.

tts.py's checks and qa_tts.py's STT diff work on toneless pinyin, so 亥 hài read in the wrong tone passes both, and
neither looks at pace. This reads a line again with its neighbours (tts.take) several times and measures each take:
chars/s over the speech (against the film's median), the longest stall, and the pitch fall of one syllable (hài is a
fourth tone: it should fall). The best take goes into the cache; every take stays in build/tts/cand/ to listen to.
The ear still decides: the pitch fall is evidence, not proof.

usage:  uv run python pipeline/retake.py <fragment of the line> [--takes N] [--syllable 亥] [--avoid 海] [--check] [--use N]
  --check   measure the cached take only, no API calls
  --use N   put candidate N of an earlier run into the cache, no API calls
"""
import argparse, json, shutil

import numpy as np
import soundfile as sf

import qa_tts
import tts
from paths import TTS

CAND = TTS / 'cand'
F0_LO, F0_HI = 70.0, 320.0
FALLING = 2.0       # semitones a fourth tone falls at least, within its syllable
STALL = 0.8         # s: a pause longer than this reads as a stall


def f0_track(x: np.ndarray, sr: int, hop: float = 0.01, win: float = 0.05) -> np.ndarray:
    """Pitch per hop by autocorrelation normalised over each lag's overlap (a low voice's lag is a large part of the
    window); NaN where the frame isn't clearly voiced. out[i] is the frame centred at i * hop."""
    n, h = int(win * sr), int(hop * sr)
    lo, hi = int(sr / F0_HI), int(sr / F0_LO)
    out = np.full(len(x) // h, np.nan)
    pad = np.concatenate((np.zeros(n // 2, x.dtype), x, np.zeros(n, x.dtype)))
    for i in range(len(out)):
        f = pad[i * h:i * h + n]
        f = f - f.mean()
        if f @ f < 1e-4:
            continue
        ac = np.correlate(f, f, 'full')[n - 1:]
        cum = np.cumsum(f ** 2)
        lags = np.arange(lo, hi)
        nac = ac[lags] / np.sqrt(np.maximum(cum[n - 1 - lags] * (cum[n - 1] - cum[lags - 1]), 1e-12))
        j = int(np.argmax(nac))
        if nac[j] > 0.6:
            out[i] = sr / lags[j]
    return out


def syllable_fall(x: np.ndarray, sr: int, marks: list[dict], ch: str) -> tuple[float, float] | None:
    """(semitones the syllable falls from its first to its last voiced third, its level against the line's median)."""
    m = next((m for m in marks if m['w'] == ch), None)
    if m is None:
        return None
    f0 = f0_track(x, sr)
    a, b = int(m['start'] / 0.01), int(m['end'] / 0.01)
    v = f0[a:b]
    v = v[np.isfinite(v)]
    if len(v) < 6:
        return None
    k = len(v) // 3
    st = lambda p, q: 12 * np.log2(p / q)
    return float(st(np.median(v[:k]), np.median(v[-k:]))), float(st(np.median(v), np.nanmedian(f0)))


def pace(marks: list[dict]) -> tuple[float, float]:
    """(chars/s from the first character to the last, the longest gap between characters)."""
    gaps = [b['start'] - a['end'] for a, b in zip(marks, marks[1:])]
    return len(marks) / (marks[-1]['end'] - marks[0]['start']), max(gaps, default=0.0)


def film_pace(items: list[tts.Item]) -> float:
    """The narrator's median chars/s over the cached lines."""
    p = []
    for t, r in items:
        f = TTS / f'{tts.key(t, r)}.json'
        if r == 'narrator' and f.exists():
            m = json.loads(f.read_text(encoding='utf-8'))['marks']
            if len(m) > 8:
                p.append(pace(m)[0])
    return float(np.median(p))


def measure(text: str, c: tts.Cut, ch: str) -> dict:
    seg, marks, checks = c
    heard = qa_tts.stt(seg, tts.PCM_SR)['text']
    d = qa_tts.diff(text, heard)
    cps, gap = pace(marks) if marks else (0.0, 9.0)
    fall = syllable_fall(seg, tts.PCM_SR, marks, ch) if ch else None
    return {'len': round(len(seg) / tts.PCM_SR, 1), 'cps': round(cps, 2), 'gap': round(gap, 2), 'fall': fall and round(fall[0], 1),
            'level': fall and round(fall[1], 1), 'worst': checks['worst'], 'flagged': tts.flagged(checks), 'diff': d, 'heard': heard}


def rank(m: dict, target: float, ch: str, avoid: str = '') -> tuple:
    return (not m['flagged'] and not m['diff'] and not (avoid and avoid in m['heard']), not ch or (m['fall'] or -9) >= FALLING,
            -abs(m['cps'] - target) - 0.5 * max(0.0, m['gap'] - STALL))


def main(fragment: str, takes: int, ch: str, check: bool, use: int | None, avoid: str = ''):
    items, _ = tts.script()
    hits = [i for i, (t, _) in enumerate(items) if fragment in t]
    if len(hits) != 1:
        raise SystemExit(f'{len(hits)} lines contain {fragment!r}')
    i = hits[0]
    item = items[i]
    k = tts.key(*item)
    target = film_pace(items)
    print(f'{k}  {item[0]}\nfilm median {target:.2f} chars/s', flush=True)
    if use is not None:
        shutil.copy(CAND / f'{k}_{use}.wav', TTS / f'{k}.wav')
        shutil.copy(CAND / f'{k}_{use}.json', TTS / f'{k}.json')
        print(f'candidate {use} is in the cache')
        return
    if check:
        x, sr = sf.read(TTS / f'{k}.wav', dtype='float32')
        c = json.loads((TTS / f'{k}.json').read_text(encoding='utf-8'))
        print(measure(item[0], (x, c['marks'], {n: c[n] for n in ('score', 'worst', 'extra')}), ch))
        return
    CAND.mkdir(exist_ok=True)
    lo, hi = max(0, i - 1), min(len(items), i + 2)
    best = None
    first = len(list(CAND.glob(f'{k}_*.wav'))) + 1       # earlier runs' candidates stay
    for n in range(first, first + takes):
        c = tts.take(items[lo:hi])[i - lo]
        m = measure(item[0], c, ch)
        sf.write(CAND / f'{k}_{n}.wav', c[0], tts.PCM_SR, subtype='PCM_16')
        (CAND / f'{k}_{n}.json').write_text(json.dumps({'text': item[0], 'role': item[1], 'model': tts.MODEL, 'voice': tts.VOICES[item[1]]['voice'],
                                                        'said': tts.spoken(item[0]), **c[2], 'take': f'retake {n}', 'marks': c[1]}, ensure_ascii=False), encoding='utf-8')
        print(f'take {n}: {m}', flush=True)
        if best is None or rank(m, target, ch, avoid) > best[0]:
            best = (rank(m, target, ch, avoid), n, c)
    tts.write(item, best[2], f'retake {best[1]}')
    print(f'kept take {best[1]} of this run: {best[0]}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('fragment')
    ap.add_argument('--takes', type=int, default=6)
    ap.add_argument('--syllable', default='')
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--use', type=int)
    ap.add_argument('--avoid', default='', help='a take STT hears this in is not kept (the wrong tone as a homophone: 海)')
    a = ap.parse_args()
    main(a.fragment, a.takes, a.syllable, a.check, a.use, a.avoid)
