"""Stage: narration TTS. One wav + char-times json per line of script_src.py, cached by content hash in build/tts/.

Gemini 3.8 Flash TTS through OpenRouter (POST /api/v1/audio/speech; key in $env:OR_API, never printed). Narrator: a
low documentary read; quotations of in-game texts (《日月前事》): a second, slower voice, so the record has its own
voice. Delivery goes in `instructions` (Gemini reads `input` verbatim, so directions written there would be spoken).
Gemini returns 24 kHz s16 PCM and no word times: align.py force-aligns the known text for them. A take that fails the
alignment checks (MIN_SCORE / MIN_WORST / MAX_EXTRA: a skipped, garbled or invented phrase) is re-taken; the best of
TAKES is kept. Gemini ignores `speed` (1.25 changed nothing); pace is asked for in the instructions.

usage:  uv run python pipeline/tts.py [--force] [--audition [narrator|quote ...]] [--realign]
  --audition   the opening lines of a role in every candidate voice (AUDITION) -> build/tts/audition/ (cache untouched)
  --realign    re-run the aligner on every cached take (no API calls)
"""
import argparse, hashlib, json, os, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import soundfile as sf

from align import align
from paths import TTS
from script_src import all_lines

URL = 'https://openrouter.ai/api/v1/audio/speech'
MODEL = 'google/gemini-3.8-flash-tts'   # pinned id, not an alias
PCM_SR = 24000
TAKES = 3
# take checks (align.py), calibrated on the first full run: clean takes scored >= -0.46, worst char >= -4.7,
# unaligned speech <= 0.38 s; aligning against text with 2 chars the audio lacks gave worst -10.6..-12.9
MIN_SCORE = -0.6    # mean per-character log-prob
MIN_WORST = -7.0    # the lowest character's: a dropped word
MAX_EXTRA = 0.6     # longest loud run on no letter (s): a long invented / repeated stretch

_LINE = ('Each request is one line of a longer narration: when it ends on a comma, keep the cadence open, '
         'as the sentence goes on in the next line.')
# Narrator: the user found every "documentary narrator, low voice, gravitas" read too performed (装), and of the
# plain reads picked Schedar with no instructions at all (Gemini's own read, ~4.8 chars/s).
VOICES = {
    'narrator': dict(voice='Schedar', instructions=''),
    'quote': dict(voice='Aoede', instructions=(
        'Reciting a passage from an ancient sacred chronicle, in standard Mandarin Chinese. Soft, solemn and '
        'slightly distant, like a voice from long ago; measured, a little slower than speech, about 3.5 '
        'characters per second. ' + _LINE)),
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

_align_lock = threading.Lock()


def key(text: str, role: str) -> str:
    return hashlib.sha1(json.dumps([MODEL, text, VOICES[role]], ensure_ascii=False).encode()).hexdigest()[:12]


def api_key() -> str:
    k = os.environ.get('OR_API')
    if not k and os.name == 'nt':  # set as a user variable after this shell started
        import winreg
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as h:
                k = winreg.QueryValueEx(h, 'OR_API')[0]
        except OSError:
            pass
    if not k:
        raise SystemExit('OR_API is not set (OpenRouter key)')
    return k


def speak(text: str, voice: str, instructions: str) -> np.ndarray:
    """One take: mono float32 at PCM_SR."""
    body = {'model': MODEL, 'input': text, 'voice': voice, 'response_format': 'pcm'}
    if instructions:
        body['instructions'] = instructions
    req = urllib.request.Request(URL, data=json.dumps(body, ensure_ascii=False).encode(), method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key()}'})
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=180) as r:
                data = r.read()
            if data[:4] == b'RIFF':  # a wav container instead of raw pcm
                import io
                x, sr = sf.read(io.BytesIO(data), dtype='float32')
                assert sr == PCM_SR, sr
                return x if x.ndim == 1 else x.mean(axis=1)
            return np.frombuffer(data[: len(data) // 2 * 2], '<i2').astype(np.float32) / 32768
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors='replace')[:600]
            if (e.code < 500 and e.code != 429) or attempt == 4:
                raise SystemExit(f'HTTP {e.code}: {msg}')
            print('retry', attempt, e.code, msg[:120], flush=True)
        except (TimeoutError, urllib.error.URLError) as e:
            if attempt == 4:
                raise
            print('retry', attempt, repr(e)[:120], flush=True)
        time.sleep(2 + attempt * 4)


def flagged(c: dict) -> bool:
    return c['score'] < MIN_SCORE or c['worst'] < MIN_WORST or c['extra'] > MAX_EXTRA


def take(text: str, voice: str, instructions: str) -> tuple[np.ndarray, list[dict], dict, int]:
    """The first take that passes the alignment checks, else the best of TAKES by score."""
    best = None
    for n in range(1, TAKES + 1):
        x = speak(text, voice, instructions)
        with _align_lock:
            marks, c = align(text, x, PCM_SR)
        if best is None or (not flagged(c), c['score']) > (not flagged(best[2]), best[2]['score']):
            best = (x, marks, c, n)
        if not flagged(c):
            break
        print(f'  flagged {c} (take {n}): {text[:24]}', flush=True)
    return best


def synth(text: str, role: str, force: bool) -> str:
    k = key(text, role)
    wav, js = TTS / f'{k}.wav', TTS / f'{k}.json'
    if wav.exists() and js.exists() and not force:
        return k
    v = VOICES[role]
    x, marks, c, n = take(text, v['voice'], v['instructions'])
    sf.write(wav, x, PCM_SR, subtype='PCM_16')
    js.write_text(json.dumps({'text': text, 'role': role, 'model': MODEL, 'voice': v['voice'], **c, 'takes': n,
                              'marks': marks}, ensure_ascii=False), encoding='utf-8')
    print(f'tts {k} {role} {v["voice"]} {len(x) / PCM_SR:5.1f}s {c} take {n}  {text[:24]}', flush=True)
    return k


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
    lines = [(l.voice_text or l.text, 'quote' if l.quote else 'narrator') for _, _, l in all_lines()]
    sample = {role: [t for t, r in lines if r == role][:AUDITION_LINES] for role in roles}
    jobs = [(role, name) for role in roles for name in AUDITION[role]]
    gap = np.zeros(int(0.4 * PCM_SR), np.float32)

    def one(job):
        role, name = job
        voice, _, mode = name.partition(':')
        parts, worst = [], 0.0
        for t in sample[role]:
            x = speak(t, voice, '' if mode == 'bare' else VOICES[role]['instructions'])
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


def main(force: bool, re_align: bool):
    jobs = [(l.voice_text or l.text, 'quote' if l.quote else 'narrator') for _, _, l in all_lines()]
    if re_align:
        keys = [key(*j) for j in jobs]
        for k in keys:
            realign(k)
    else:
        with ThreadPoolExecutor(4) as ex:
            keys = list(ex.map(lambda j: synth(*j, force), jobs))
    ds = [json.loads((TTS / f'{k}.json').read_text(encoding='utf-8')) for k in keys]
    scores = sorted(d['score'] for d in ds)
    print(len(keys), 'lines ok; alignment score min', scores[0], 'median', scores[len(scores) // 2],
          '; worst char min', min(d['worst'] for d in ds), '; unaligned speech max', max(d['extra'] for d in ds), 's')
    for d in ds:
        if flagged(d):
            print(f'  CHECK score {d["score"]:.2f} worst {d["worst"]:.2f} extra {d["extra"]:.2f}: {d["text"]}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--audition', nargs='*', metavar='ROLE', help='narrator / quote; none = both')
    ap.add_argument('--realign', action='store_true')
    a = ap.parse_args()
    audition(a.audition) if a.audition is not None else main(a.force, a.realign)
