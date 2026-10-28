"""Character times for a TTS clip whose text is known: CTC forced alignment over torchaudio's MMS_FA emissions.

Gemini TTS returns audio only, so the subtitle / quote-card timing comes from here. Every Han character is romanised
with pypinyin (toneless; ü -> u, as uroman writes it), the letters are aligned by a plain CTC Viterbi pass
(20 ms frames), and a character runs from its first letter's frame to its last; across a short gap it runs on to the
next character. Punctuation gets no mark (assemble.char_times gives it the gap it sits in).

score = mean per-character log-prob of the aligned letters: near 0 for a clean read, far lower when the clip doesn't
say the text (a skipped or invented phrase); worst = the lowest character's, which catches a single dropped word.
tts.py re-takes a line on either.

weights: build/cache/torch/checkpoints/model.pt (downloaded on first use, ~1.2 GB).
"""
import os

import numpy as np
from pypinyin import Style, lazy_pinyin

from paths import CACHE

os.environ.setdefault('TORCH_HOME', str(CACHE / 'torch'))

import torch  # noqa: E402  (TORCH_HOME must be set first)
import torchaudio  # noqa: E402

SR = 16000
# CTC letters fire a little late. Against Edge TTS's word boundaries starts were a steady 78 ms late (IQR 66-93), but
# those boundaries run early: with LEAD 0.075 a Gemini line's first char started 54 ms before its -45 dBFS onset
LEAD = 0.02
GAP_JOIN = 0.15   # a character's end runs to the next start across gaps up to this
TAIL = 0.16       # otherwise it ends this long after its last letter fired (the vowel rings on)
# uroman turns Chinese numerals into digits, which MMS_FA's training text then dropped: correctly read numerals still
# score -4..-9 (STT confirmed the reads), so they are aligned but left out of the score
NUMERALS = set('零一二两三四五六七八九十百千万亿')

_model = None
_labels: dict[str, int] = {}


def _load():
    global _model, _labels
    if _model is None:
        torch.hub.set_dir(os.environ['TORCH_HOME'])
        bundle = torchaudio.pipelines.MMS_FA
        dev = 'cuda' if torch.cuda.is_available() else 'cpu'
        _model = bundle.get_model(with_star=False).to(dev).eval()
        _labels = {c: i for i, c in enumerate(bundle.get_labels(star=None))}
    return _model


def romanise(text: str) -> list[list[int]]:
    """Per character of text: its MMS_FA label ids (empty for punctuation)."""
    _load()
    py = lazy_pinyin(text, style=Style.NORMAL, errors=lambda s: [''] * len(s))
    if len(py) != len(text):  # pypinyin grouped something unexpectedly: romanise char by char
        py = [lazy_pinyin(ch, style=Style.NORMAL, errors=lambda s: [''])[0] for ch in text]
    # pypinyin writes ü as v; MMS_FA's uroman romanisation writes it u (its v is the consonant)
    return [[_labels[c] for c in p.lower().replace('v', 'u') if c in _labels and c not in "-'"] for p in py]


def emissions(x: np.ndarray, sr: int) -> np.ndarray:
    """(frames, labels) log-probs of a mono clip."""
    model = _load()
    w = torch.from_numpy(x.astype(np.float32, copy=True))[None]
    if sr != SR:
        w = torchaudio.functional.resample(w, sr, SR)
    with torch.inference_mode():
        em, _ = model(w.to(next(model.parameters()).device))
        em = torch.log_softmax(em[0], dim=-1)
    return em.float().cpu().numpy()


def viterbi(em: np.ndarray, targets: list[int]) -> np.ndarray:
    """Best CTC path of the target sequence through the emissions: the target index each frame is on, -1 on blank."""
    T, L = len(em), len(targets)
    ext = np.zeros(2 * L + 1, np.int64)
    ext[1::2] = targets
    S = len(ext)
    skip = np.zeros(S, bool)  # a letter may follow the previous letter directly (no blank) unless it repeats it
    skip[3::2] = ext[3::2] != ext[1:-2:2]
    if T < L + int(np.sum(~skip[3::2])):
        raise ValueError('clip too short for its text')
    neg = -1e30
    dp = np.full(S, neg)
    dp[0], dp[1] = em[0, ext[0]], em[0, ext[1]]
    back = np.zeros((T, S), np.int8)
    for t in range(1, T):
        c1 = np.concatenate(([neg], dp[:-1]))
        c2 = np.where(skip, np.concatenate(([neg, neg], dp[:-2])), neg)
        cand = np.stack([dp, c1, c2])
        b = np.argmax(cand, axis=0)
        dp = cand[b, np.arange(S)] + em[t, ext]
        back[t] = b
    s = S - 1 if dp[S - 1] >= dp[S - 2] else S - 2
    path = np.empty(T, np.int64)
    for t in range(T - 1, -1, -1):
        path[t] = s
        s -= int(back[t, s])
    return np.where(path % 2 == 1, (path - 1) // 2, -1)


def unaligned_speech(x: np.ndarray, sr: int, on: np.ndarray) -> float:
    """Longest run (s) of frames that are loud (within 30 dB of the clip's peak frame) yet on no letter: speech the
    text doesn't account for. Letters fire in spikes, so normal speech leaves only syllable-sized runs."""
    T = len(on)
    edge = (np.arange(T + 1) * len(x) / T).astype(int)
    c = np.concatenate(([0.0], np.cumsum(x.astype(np.float64) ** 2)))
    db = 10 * np.log10((c[edge[1:]] - c[edge[:-1]]) / np.maximum(1, np.diff(edge)) + 1e-12)
    bad = (on < 0) & (db > db.max() - 30)
    best = run = 0
    for b in bad:
        run = run + 1 if b else 0
        best = max(best, run)
    return best * len(x) / T / sr


def align(text: str, x: np.ndarray, sr: int) -> tuple[list[dict], dict]:
    """Marks [{'w': char, 'start', 'end'}] for the Han characters of text in clip x, and the take's checks:
    score (mean over characters of their letters' mean log-prob) and worst (the lowest character's), numerals left
    out (see NUMERALS); extra = unaligned_speech in seconds."""
    toks = romanise(text)
    flat, owner = [], []
    for ci, ids in enumerate(toks):
        flat += ids
        owner += [ci] * len(ids)
    if not flat:
        return [], {'score': 0.0, 'worst': 0.0, 'extra': 0.0}
    em = emissions(x, sr)
    sec = len(x) / sr / len(em)
    on = viterbi(em, flat)
    frames = np.nonzero(on >= 0)[0]
    lp = em[frames, np.array(flat)[on[frames]]]
    spans: dict[int, list[int]] = {}
    per: dict[int, list[float]] = {}
    for f, p in zip(frames, lp):
        ci = owner[on[f]]
        per.setdefault(ci, []).append(float(p))
        if ci in spans:
            spans[ci][1] = f
        else:
            spans[ci] = [f, f]
    char_lp = [np.mean(v) for ci, v in per.items() if text[ci] not in NUMERALS] or [np.mean(v) for v in per.values()]
    checks = {'score': round(float(np.mean(char_lp)), 3), 'worst': round(float(np.min(char_lp)), 3),
              'extra': round(unaligned_speech(x, sr, on), 3)}
    order = sorted(spans)
    marks = []
    for i, ci in enumerate(order):
        a, b = max(0.0, spans[ci][0] * sec - LEAD), (spans[ci][1] + 1) * sec - LEAD
        if i + 1 < len(order):
            nxt = max(0.0, spans[order[i + 1]][0] * sec - LEAD)
            b = nxt if nxt - b <= GAP_JOIN else b + TAIL
        else:
            b += TAIL
        marks.append({'w': text[ci], 'start': round(float(a), 3), 'end': round(float(b), 3)})
    return marks, checks
