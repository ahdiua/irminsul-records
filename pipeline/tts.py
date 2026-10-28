"""Stage: narration TTS. One wav + char-times json per line of script_src.py, cached by content hash in build/tts/.

Gemini 3.8 Flash TTS on Vertex AI (vertex.py; service-account key in secrets/, never printed). Narrator: Schedar;
quotations of in-game texts (《日月前事》): Aoede, slower, so the record has its own voice. Gemini 3.8 reads the
text verbatim (directions written into it are spoken, and Vertex rejects systemInstruction for it): the delivery goes
in each part's `speech_metadata.style`, and two-voice takes name each part's `speech_metadata.speaker`.

Lines read one request each came out in a different mood every time, so the film is read in a few long takes:
`--whole` sends a run of whole chapters per request, every line in order (both voices: one part per line, Gemini
multi-speaker) and cuts the audio back into lines: `split` picks the pauses between them by dynamic programming
(segment lengths close to what each line's text predicts, cuts on long pauses). A take after the first opens with the
previous take's last line, read again and dropped, to carry the tone over. Gemini returns no word times: align.py
force-aligns each line, and a line that fails the checks (MIN_SCORE / MIN_WORST / MAX_EXTRA: a skipped, garbled or
invented phrase) is read again together with its neighbours, so it keeps their tone, and cut out of that take. A line
missing from the cache (a script edit) is read the same way, so a plain run only fills gaps. Requests go one at a time.

usage:  uv run python pipeline/tts.py [--whole] [--recut TAKE ...] [--audition [narrator|quote ...]] [--realign]
  --whole      re-read the whole film (replaces every cached line)
  --recut      cut kept takes (build/tts/takes/<TAKE>.wav, in reading order) again, no API calls
  --audition   the opening lines of a role in every candidate voice (AUDITION) -> build/tts/audition/ (cache untouched)
  --realign    re-run the aligner on every cached take (no API calls)
"""
import argparse, base64, hashlib, io, json, re, threading, time
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import soundfile as sf

import vertex
from align import align
from paths import TTS
from script_src import CHAPTERS, all_lines

MODEL = 'gemini-3.8-flash-tts'   # Vertex AI publisher model (global endpoint)
PCM_SR = 24000
TAKES = 3           # takes of a line with its neighbours, when it fails the checks
WHOLE_TAKES = 2     # takes of each chunk of the film; the one with the fewest failing lines is kept
# One 13-minute take of the whole film was clean for its first ~400 s, then dropped and slurred words (21 of the 60
# lines after it failed). So the film is read in chunks of whole chapters of at most this much expected speech:
MAX_TAKE_S = 300
SEC_PER_W = 0.215   # seconds of take per weight() unit (measured on that take)
# take checks (align.py), calibrated on the first full run: clean takes scored >= -0.46, worst char >= -4.7,
# unaligned speech <= 0.38 s; aligning against text with 2 chars the audio lacks gave worst -10.6..-12.9
MIN_SCORE = -0.6    # mean per-character log-prob
MIN_WORST = -7.0    # the lowest character's: a dropped word
MAX_EXTRA = 0.6     # longest loud run on no letter (s): a long invented / repeated stretch

# what Gemini is given to read where it mispronounces: 妲 dá (纳西妲), 叉 chā (夜叉). Subtitles and the aligner keep
# the real text (the homophones have the same toneless pinyin)
SAY = {'纳西妲': '纳西达', '夜叉': '夜插'}

# Narrator: the user found every "documentary narrator, low voice, gravitas" read too performed (装), and of the
# plain reads picked Schedar with no instructions (Gemini's own read, ~4.8 chars/s). But with no instructions the
# delivery isn't anchored: per-line takes jumped 2 semitones line to line, and one long take grew livelier as it
# went (pitch spread 3.3 -> 7.9 st, 3.7 -> 4.9 chars/s). This plain brief (tone study 2026-10-28: line-to-line pitch
# jumps 1.45 -> 0.82 st, loudness 1.0 -> 0.56 dB, same pace and intonation range; the user approved its sound) keeps
# it even. What no brief removes is take-to-take chance (~1.2 st between two reads of a passage): hence long takes.
VOICES = {
    'narrator': dict(voice='Schedar', instructions=(
        'Read in standard Mandarin Chinese with a plain, steady narrating voice: calm and natural, like reading aloud '
        'to a friend. Keep the same pitch, pace and energy from the first line to the last, whatever the content; no '
        'dramatic emphasis, no acting.')),
    'quote': dict(voice='Aoede', instructions=(
        'Reciting a passage from an ancient sacred chronicle, in standard Mandarin Chinese. Soft, solemn and '
        'slightly distant, like a voice from long ago; measured, a little slower than speech, about 3.5 '
        'characters per second.')),
}
# candidates for --audition; 'name:bare' = no instructions at all (Gemini's own read). Round 1 (Charon, Orus,
# Algenib, Iapetus, Alnilam, Sadaltager, Rasalgethi, Gacrux, on a documentary brief) all sounded too performed;
# round 2 (these, on a plain brief) -> Schedar:bare.
AUDITION = {
    'narrator': ['Schedar', 'Umbriel', 'Achird', 'Zubenelgenubi', 'Iapetus', 'Algieba', 'Charon', 'Orus',
                 'Schedar:bare', 'Charon:bare'],
    'quote': ['Vindemiatrix', 'Kore', 'Sulafat', 'Achernar', 'Despina', 'Aoede'],
}
AUDITION_LINES = 3  # consecutive script lines per sample, joined as in the film

_api = threading.Lock()        # one request in flight
_align_lock = threading.Lock()
SPEAKER = {'narrator': 'Narrator', 'quote': 'Chronicle'}

Item = tuple[str, str]         # (text read, role)


def spoken(text: str) -> str:
    for a, b in SAY.items():
        text = text.replace(a, b)
    return text


def key(text: str, role: str) -> str:
    return hashlib.sha1(json.dumps([MODEL, spoken(text), VOICES[role]], ensure_ascii=False).encode()).hexdigest()[:12]


def voice_config(name: str) -> dict:
    return {'prebuiltVoiceConfig': {'voiceName': name}}


def request(parts: list[dict], speech: dict) -> np.ndarray:
    """One generateContent call -> mono float32 at PCM_SR."""
    body = {'contents': [{'role': 'user', 'parts': parts}],
            'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': speech}}
    with _api:
        res = vertex.generate(MODEL, body)
    cand = res['candidates'][0]
    if cand.get('finishReason') not in (None, 'STOP'):
        print(f'  finishReason {cand["finishReason"]}', flush=True)
    data = base64.b64decode(next(p['inlineData']['data'] for p in cand['content']['parts'] if 'inlineData' in p))
    if data[:4] == b'RIFF':
        x, sr = sf.read(io.BytesIO(data), dtype='float32')
        assert sr == PCM_SR, sr
        return x if x.ndim == 1 else x.mean(axis=1)
    return np.frombuffer(data[: len(data) // 2 * 2], '<i2').astype(np.float32) / 32768


def meta(role: str, speaker: bool) -> dict:
    m = {'style': VOICES[role]['instructions']} if VOICES[role]['instructions'] else {}
    return {'speech_metadata': {**m, 'speaker': SPEAKER[role]}} if speaker else ({'speech_metadata': m} if m else {})


def speak(items: list[Item]) -> np.ndarray:
    """One take of consecutive script lines. One role: one part, a line per line of text, in that role's voice and
    style. Both roles: Gemini multi-speaker, a part per line naming its speaker and style."""
    roles = {r for _, r in items}
    if len(roles) == 1:
        r = roles.pop()
        return request([{'text': '\n'.join(spoken(t) for t, _ in items), **meta(r, False)}],
                       {'voiceConfig': voice_config(VOICES[r]['voice'])})
    speakers = [{'speaker': SPEAKER[r], 'voiceConfig': voice_config(VOICES[r]['voice'])} for r in VOICES]
    return request([{'text': spoken(t), **meta(r, True)} for t, r in items],
                   {'multiSpeakerVoiceConfig': {'speakerVoiceConfigs': speakers}})


# ------------------------------------------------------------------ cutting a take into lines

PAUSE_DB = -42      # 20 ms frames below this are silence
MIN_PAUSE = 4       # frames: shorter dips are not pauses
CUT_REWARD = 3.0    # a cut on a long pause is worth this much (a 0.7 s line break beats a 0.25 s comma unless the
                    # segment lengths disagree by about a second)


def pauses(x: np.ndarray) -> tuple[np.ndarray, np.ndarray, float, float]:
    """Interior pauses (starts, ends in s) of a take, and its first and last speech."""
    hop = PCM_SR // 50
    n = len(x) // hop
    loud = 20 * np.log10(np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-12) > PAUSE_DB
    on = np.nonzero(loud)[0]
    if not len(on):
        return np.zeros(0), np.zeros(0), 0.0, len(x) / PCM_SR
    a, b = on[0], on[-1] + 1
    edges = np.flatnonzero(np.diff(loud[a:b].astype(np.int8))) + 1 + a      # frame where loudness flips
    st, en = edges[loud[edges] == 0], edges[loud[edges] == 1]                # silence starts / ends
    en = en[en > st[0]] if len(st) else en
    k = min(len(st), len(en))
    st, en = st[:k], en[:k]
    keep = en - st >= MIN_PAUSE
    return st[keep] * hop / PCM_SR, en[keep] * hop / PCM_SR, a * hop / PCM_SR, b * hop / PCM_SR


def weight(text: str, role: str) -> float:
    """A line's expected length in character-units: its characters, plus pauses at punctuation; quotes read slower."""
    n = len(re.sub(r'[，。、；：！？—…「」《》（）·“”\s]', '', text))
    p = 1.2 * len(re.findall('[，、；：]', text)) + 2.0 * len(re.findall('[。！？]', text)) + 1.5 * text.count('——')
    return (n + p) * (1.35 if role == 'quote' else 1.0)


def split(x: np.ndarray, items: list[Item]) -> list[tuple[int, int]]:
    """Sample ranges of each line in a take of `items`: N-1 cuts at pause midpoints, chosen to minimise
    sum((length - expected) / (0.12 expected + 0.4 s))^2 - CUT_REWARD * min(pause, 1.2 s); the expected lengths are
    re-scaled to the result once."""
    N = len(items)
    if N == 1:
        return [(0, len(x))]
    ps, pe, on, off = pauses(x)
    K = len(ps)
    if K < N - 1:
        raise ValueError(f'{K} pauses for {N - 1} line breaks')
    w = np.array([weight(*it) for it in items])
    reward = CUT_REWARD * np.minimum(pe - ps, 1.2)
    D = ps[None, :] - pe[:, None]                         # [j, k]: a line from the end of pause j to the start of k
    ok = np.triu(np.ones((K, K), bool), 1) & (D > 0.15)
    big = 1e18
    scale = (off - on - (N - 1) * 0.6) / w.sum()
    for _ in range(2):
        d = scale * w
        sc = lambda dur, e: ((dur - e) / (0.12 * e + 0.4)) ** 2
        cost = np.where(ps - on > 0.15, sc(ps - on, d[0]), big) - reward
        back = []
        for i in range(1, N - 1):
            C = np.where(ok, cost[:, None] + sc(D, d[i]), big)
            back.append(C.argmin(axis=0))
            cost = C.min(axis=0) - reward
        last = np.where(off - pe > 0.15, cost + sc(off - pe, d[N - 1]), big)
        k = [int(last.argmin())]
        for b in reversed(back):
            k.append(int(b[k[-1]]))
        k.reverse()                                       # k[i]: the pause after line i
        starts = [on] + [pe[j] for j in k]
        ends = [ps[j] for j in k] + [off]
        scale = sum(e - s for s, e in zip(starts, ends)) / w.sum()
    cut = [0] + [int((ps[j] + pe[j]) / 2 * PCM_SR) for j in k] + [len(x)]
    return list(zip(cut[:-1], cut[1:]))


def flagged(c: dict) -> bool:
    return c['score'] < MIN_SCORE or c['worst'] < MIN_WORST or c['extra'] > MAX_EXTRA


Cut = tuple[np.ndarray, list[dict], dict]   # a line's audio, its marks, its checks


def take(items: list[Item]) -> list[Cut]:
    """Read `items` in one take and cut it into aligned lines. Takes of more than 3 lines are kept in
    build/tts/takes/ (with their lines), to re-cut without new requests."""
    x = speak(items)
    if len(items) > 3:
        (TTS / 'takes').mkdir(exist_ok=True)
        stem = TTS / 'takes' / f'{time.strftime("%m%d-%H%M%S")}-{len(items)}'
        sf.write(stem.with_suffix('.wav'), x, PCM_SR, subtype='PCM_16')
        stem.with_suffix('.json').write_text(json.dumps(items, ensure_ascii=False), encoding='utf-8')
    return cut(x, items)


BAD = {'score': -99.0, 'worst': -99.0, 'extra': 99.0}
REFINE_S = 5.0      # how far a cut next to a failing line may move to another pause


def cut(x: np.ndarray, items: list[Item]) -> list[Cut]:
    """A take of `items` cut into lines, each aligned. split() goes by lengths and pauses only, and can cut in the
    wrong pause (a clause of one line ending up in its neighbour: both fail, or the neighbour quietly carries the
    extra words). So each cut beside a failing line is tried at every other pause within REFINE_S, and the one that
    best aligns the two lines it divides is kept."""
    try:
        bounds = split(x, items)
    except ValueError as e:
        print(f'  cannot split a {len(x) / PCM_SR:.0f}s take of {len(items)} lines: {e}', flush=True)
        return [(x[:0], [], dict(BAD)) for _ in items]
    N = len(items)
    cuts = [a for a, _ in bounds] + [len(x)]

    def al(i: int) -> Cut:
        seg = x[cuts[i]:cuts[i + 1]]
        with _align_lock:
            try:
                marks, c = align(items[i][0], seg, PCM_SR)
            except ValueError:                            # a cut too short for its text
                marks, c = [], dict(BAD)
        return seg, marks, c

    out = [al(i) for i in range(N)]
    ps, pe, _, _ = pauses(x)
    cand = ((ps + pe) / 2 * PCM_SR).astype(int)
    rank = lambda *cs: (sum(not flagged(c[2]) for c in cs), sum(c[2]['score'] for c in cs))
    for i in range(N):
        if not flagged(out[i][2]):
            continue
        for b, j in ((i, i - 1), (i + 1, i + 1)):        # cut b lies between line i and its neighbour j
            if b in (0, N):
                continue
            lo, hi = cuts[b - 1] + int(0.3 * PCM_SR), cuts[b + 1] - int(0.3 * PCM_SR)
            best = (rank(out[i], out[j]), cuts[b], out[i], out[j])
            old = cuts[b]
            for c in cand:
                if lo < c < hi and c != old and abs(c - old) < REFINE_S * PCM_SR:
                    cuts[b] = c
                    ri, rj = al(i), al(j)
                    if rank(ri, rj) > best[0]:
                        best = (rank(ri, rj), c, ri, rj)
            cuts[b], out[i], out[j] = best[1], best[2], best[3]
            if best[1] != old:
                print(f'  moved a cut {(best[1] - old) / PCM_SR:+.2f}s: {items[i][0][:20]}', flush=True)
    return out


def recut(names: list[str]):
    """Re-cut kept takes (build/tts/takes/<name>.wav|json, in reading order) with the current cut(); a line that now
    passes replaces its cached take (a context take included: the long take keeps the tone), one that still fails
    keeps what the cache has. A take's opening line read again from the previous take is skipped."""
    items, _ = script()
    index = {it: i for i, it in enumerate(items)}
    done = set()
    for name in names:
        x, sr = sf.read(TTS / 'takes' / f'{name}.wav', dtype='float32')
        sub = [tuple(i) for i in json.loads((TTS / 'takes' / f'{name}.json').read_text(encoding='utf-8'))]
        for it, c in zip(sub, cut(x, sub)):
            i = index[it]
            if i in done:
                continue
            done.add(i)
            if flagged(c[2]):
                print(f'  still failing, cache kept: {c[2]} {it[0][:24]}', flush=True)
            else:
                write(it, c, f'whole {name}')


def better(a: Cut, b: Cut | None) -> bool:
    return b is None or (not flagged(a[2]), a[2]['score']) > (not flagged(b[2]), b[2]['score'])


def in_context(items: list[Item], i: int) -> tuple[Cut, int]:
    """Line i read with the lines either side of it (so it keeps their tone), cut out; the first take that passes
    the checks, else the best of TAKES."""
    lo, hi = max(0, i - 1), min(len(items), i + 2)
    best, n_best = None, 0
    for n in range(1, TAKES + 1):
        c = take(items[lo:hi])[i - lo]
        if better(c, best):
            best, n_best = c, n
        if not flagged(c[2]):
            break
        print(f'  flagged {c[2]} (context take {n}): {items[i][0][:24]}', flush=True)
    return best, n_best


def write(item: Item, c: Cut, how: str):
    t, role = item
    k = key(t, role)
    seg, marks, checks = c
    sf.write(TTS / f'{k}.wav', seg, PCM_SR, subtype='PCM_16')
    (TTS / f'{k}.json').write_text(json.dumps({'text': t, 'role': role, 'model': MODEL, 'voice': VOICES[role]['voice'],
                                               'said': spoken(t), **checks, 'take': how, 'marks': marks}, ensure_ascii=False),
                                   encoding='utf-8')


def script() -> tuple[list[Item], list[int]]:
    """Every line as (text read, role), and its chapter index."""
    items, chap = [], []
    ids = {c.id: i for i, c in enumerate(CHAPTERS)}
    for c, _, l in all_lines():
        items.append((l.voice_text or l.text, 'quote' if l.quote else 'narrator'))
        chap.append(ids[c.id])
    return items, chap


def chunks(items: list[Item], chap: list[int], n: int) -> list[list[int]]:
    """Line indices in n runs of whole chapters, of about equal length."""
    w = [weight(*it) for it in items]
    per = [sum(w[i] for i in range(len(items)) if chap[i] == c) for c in range(len(CHAPTERS))]
    bounds, acc, total = [0], 0.0, sum(per)
    for c in range(len(CHAPTERS) - 1):
        acc += per[c]
        if acc >= total * len(bounds) / n and len(bounds) < n:
            bounds.append(c + 1)
    bounds.append(len(CHAPTERS))
    return [[i for i in range(len(items)) if a <= chap[i] < b] for a, b in zip(bounds, bounds[1:])]


def whole():
    """The film in takes of whole chapters up to MAX_TAKE_S long; failing lines re-read in context."""
    items, chap = script()
    got: dict[int, tuple[Cut, str]] = {}
    n0 = max(1, int(np.ceil(sum(weight(*it) for it in items) * SEC_PER_W / MAX_TAKE_S)))
    for n in range(n0, n0 + 3):
        got.clear()
        for gi, g in enumerate(chunks(items, chap, n)):
            lead = [items[g[0] - 1]] if g[0] > 0 else []      # the line before, read again to carry the tone over
            sub = [items[i] for i in g]
            best = None
            for attempt in range(1, WHOLE_TAKES + 1):
                t0 = time.time()
                r = take(lead + sub)[len(lead):]
                nf = sum(flagged(c[2]) for c in r)
                print(f'take {gi + 1}/{n}#{attempt}: {len(sub)} lines, {sum(len(c[0]) for c in r) / PCM_SR:.0f}s audio '
                      f'in {time.time() - t0:.0f}s, {nf} lines flagged', flush=True)
                if best is None or nf < best[0]:
                    best = (nf, r)
                if nf <= max(2, len(sub) // 20):
                    break
            if best[0] > len(sub) * 0.3:                  # truncated or derailed: smaller takes
                print(f'  {best[0]} of {len(sub)} lines failed: reading in {n + 1} takes', flush=True)
                break
            for i, c in zip(g, best[1]):
                got[i] = (c, f'whole {gi + 1}/{n}')
        else:
            break
    else:
        raise SystemExit(f'the film could not be read in up to {n0 + 2} takes')
    for i in sorted(i for i, (c, _) in got.items() if flagged(c[2])):
        c, nt = in_context(items, i)
        if better(c, got[i][0]):
            got[i] = (c, f'context {nt}')
    for i, (c, how) in got.items():
        write(items[i], c, how)


def fill():
    """Lines missing from the cache (script edits), each read with its neighbours."""
    items, _ = script()
    todo = [i for i, it in enumerate(items) if not ((TTS / f'{key(*it)}.wav').exists() and (TTS / f'{key(*it)}.json').exists())]
    if len(todo) > len(items) // 3:
        print(f'{len(todo)} of {len(items)} lines are not cached: consider --whole', flush=True)
    for i in todo:
        c, nt = in_context(items, i)
        write(items[i], c, f'context {nt}')
        print(f'tts {key(*items[i])} {len(c[0]) / PCM_SR:5.1f}s {c[2]} take {nt}  {items[i][0][:24]}', flush=True)


def trim(x: np.ndarray) -> np.ndarray:
    """Cut a take to its speech (20 ms windows above -45 dBFS), as assemble.py lays lines."""
    hop = PCM_SR // 50
    n = len(x) // hop
    on = np.nonzero(20 * np.log10(np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1)) + 1e-12) > -45)[0]
    return x[on[0] * hop: (on[-1] + 1) * hop] if len(on) else x


def audition(roles: list[str]):
    """The first AUDITION_LINES lines of each role in every candidate voice, joined with a line gap ->
    build/tts/audition/<role>-<voice>.wav (that role's earlier samples are removed)."""
    out = TTS / 'audition'
    out.mkdir(exist_ok=True)
    roles = roles or list(AUDITION)
    for role in roles:
        for f in out.glob(f'{role}-*.wav'):
            f.unlink()
    items, _ = script()
    sample = {role: [t for t, r in items if r == role][:AUDITION_LINES] for role in roles}
    jobs = [(role, name) for role in roles for name in AUDITION[role]]
    gap = np.zeros(int(0.4 * PCM_SR), np.float32)

    def one(job):
        role, name = job
        voice, _, mode = name.partition(':')
        parts, worst = [], 0.0
        for t in sample[role]:
            style = '' if mode == 'bare' else VOICES[role]['instructions']
            x = request([{'text': spoken(t), **({'speech_metadata': {'style': style}} if style else {})}],
                        {'voiceConfig': voice_config(voice)})
            with _align_lock:
                worst = min(worst, align(t, x, PCM_SR)[1]['worst'])
            parts.append(trim(x))
        speech = sum(len(p) for p in parts) / PCM_SR
        sf.write(out / f'{role}-{name.replace(":", "-")}.wav', np.concatenate([q for p in parts for q in (p, gap)]),
                 PCM_SR, subtype='PCM_16')
        print(f'{role:8s} {name:16s} {speech:5.1f}s speech, {sum(map(len, sample[role])) / speech:.2f} chars/s, '
              f'worst char {worst:.1f}', flush=True)

    with ThreadPoolExecutor(4) as ex:
        list(ex.map(one, jobs))
    for role, ts in sample.items():
        print(role, 'sample:', ''.join(ts))
    print('->', out)


def realign(k: str):
    """Re-run align.py on a cached take (after changing the aligner), keeping the audio."""
    js = TTS / f'{k}.json'
    d = json.loads(js.read_text(encoding='utf-8'))
    x, sr = sf.read(TTS / f'{k}.wav', dtype='float32')
    d['marks'], c = align(d['text'], x, sr)
    if c['score'] != d.get('score'):
        print(f'realign {k} score {d.get("score")} -> {c["score"]}  {d["text"][:24]}', flush=True)
    d.update(c)
    js.write_text(json.dumps(d, ensure_ascii=False), encoding='utf-8')


def main(full: bool, re_align: bool, re_cut: list[str] | None):
    items, _ = script()
    if re_align:
        for it in items:
            realign(key(*it))
    elif re_cut:
        recut(re_cut)
    else:
        whole() if full else fill()
    ds = [json.loads((TTS / f'{key(*it)}.json').read_text(encoding='utf-8')) for it in items]
    scores = sorted(d['score'] for d in ds)
    print(len(ds), 'lines ok; alignment score min', scores[0], 'median', scores[len(scores) // 2],
          '; worst char min', min(d['worst'] for d in ds), '; unaligned speech max', max(d['extra'] for d in ds), 's')
    for d in ds:
        if flagged(d):
            print(f'  CHECK score {d["score"]:.2f} worst {d["worst"]:.2f} extra {d["extra"]:.2f}: {d["text"]}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--whole', action='store_true')
    ap.add_argument('--audition', nargs='*', metavar='ROLE', help='narrator / quote; none = both')
    ap.add_argument('--realign', action='store_true')
    ap.add_argument('--recut', nargs='+', metavar='TAKE', help='kept takes (build/tts/takes/), in reading order')
    a = ap.parse_args()
    audition(a.audition) if a.audition is not None else main(a.whole, a.realign, a.recut)
