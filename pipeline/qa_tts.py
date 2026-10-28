"""QA: transcribe every cached take (OpenRouter STT) and diff it against the script, so a mis-read, dropped or added
word that the alignment checks can't see (tts.py MAX_EXTRA misses one or two added chars) shows up.

The diff is on toneless pinyin, so the transcriber's homophones (神座/神作, 尘世/陈氏) don't count; numerals are
compared as a run (the transcriber writes 3700 for 三千七百). Transcripts are cached in build/tts/stt/<key>.json
(redone when the take is newer).

--retake: a differing line is read again with its neighbours (tts.in_context) up to RETAKES times and transcribed;
the take with the fewest differing characters replaces it. A difference that survives the retakes is the
transcriber's mishearing or a reading Gemini repeats every time: listen to those.

usage:  uv run python pipeline/qa_tts.py [--retake]
"""
import argparse, base64, difflib, io, json, os, re, urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import soundfile as sf
from pypinyin import Style, lazy_pinyin, pinyin

import tts
from paths import TTS
from tts import key

URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
STT_MODEL = 'microsoft/mai-transcribe-2'
OUT = TTS / 'stt'
NUM = '零一二两三四五六七八九十百千万亿'
RETAKES = 2


def api_key() -> str:
    """The OpenRouter key ($env:OR_API, never printed)."""
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


def stt(x: np.ndarray, sr: int) -> dict:
    buf = io.BytesIO()
    sf.write(buf, x, sr, format='WAV', subtype='PCM_16')
    body = {'model': STT_MODEL, 'input_audio': {'data': base64.b64encode(buf.getvalue()).decode(), 'format': 'wav'},
            'language': 'zh', 'temperature': 0}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key()}'})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read())


def transcribe(k: str) -> str:
    out = OUT / f'{k}.json'
    if out.exists() and out.stat().st_mtime >= (TTS / f'{k}.wav').stat().st_mtime:   # not re-cut since
        return json.loads(out.read_text(encoding='utf-8'))['text']
    x, sr = sf.read(TTS / f'{k}.wav', dtype='float32')
    res = stt(x, sr)
    out.write_text(json.dumps(res, ensure_ascii=False), encoding='utf-8')
    return res['text']


def tokens(s: str) -> list[tuple[str, str]]:
    """(display, toneless pinyin) per Han character; a numeral run (Han or Arabic) is one '#' token."""
    s = re.sub(rf'[{NUM}]+|\d+(?:\.\d+)?', '#', s)
    s = ''.join(ch for ch in s if ch == '#' or '一' <= ch <= '鿿')
    py = lazy_pinyin(s, style=Style.NORMAL, errors=lambda r: list(r))
    return list(zip(s, py)) if len(py) == len(s) else [(ch, lazy_pinyin(ch)[0]) for ch in s]


def readings(ch: str) -> set[str]:
    return set(pinyin(ch, style=Style.NORMAL, heteronym=True)[0]) if ch != '#' else {'#'}


def diff(text: str, heard: str) -> list[tuple[str, str, str]]:
    """Differences in toneless pinyin; a heard character that can be read as the script's (heteronyms: 藏 zàng for
    葬) counts as the same."""
    a, b = tokens(text), tokens(heard)
    sm = difflib.SequenceMatcher(a=[p for _, p in a], b=[p for _, p in b], autojunk=False)
    out = []
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == 'equal':
            continue
        if op == 'replace' and i2 - i1 == j2 - j1 and all(a[i1 + n][1] in readings(b[j1 + n][0]) for n in range(i2 - i1)):
            continue
        out.append((op, ''.join(c for c, _ in a[i1:i2]), ''.join(c for c, _ in b[j1:j2])))
    return out


def size(d: list[tuple[str, str, str]]) -> int:
    return sum(max(len(x), len(y)) for _, x, y in d)


def show(d) -> str:
    return '; '.join(f'{op} 「{x}」→「{y}」' for op, x, y in d)


def retake(items: list, i: int, d0: list) -> list:
    """Line i read again in context up to RETAKES times; the take with the fewest differing chars replaces it."""
    t, _ = items[i]
    best = None
    for n in range(RETAKES):
        c, _ = tts.in_context(items, i)
        if tts.flagged(c[2]):
            continue
        res = stt(c[0], tts.PCM_SR)
        d = diff(t, res['text'])
        print(f'    retake {n + 1}: heard {res["text"]}\n      {show(d) or "matches"}', flush=True)
        if best is None or size(d) < size(best[1]):
            best = (c, d, res)
        if not d:
            break
    if best is None or size(best[1]) >= size(d0):
        return d0
    tts.write(items[i], best[0], 'context (stt)')
    (OUT / f'{key(*items[i])}.json').write_text(json.dumps(best[2], ensure_ascii=False), encoding='utf-8')
    return best[1]


def main(fix: bool):
    OUT.mkdir(exist_ok=True)
    items, _ = tts.script()
    keys = [key(*it) for it in items]
    with ThreadPoolExecutor(4) as ex:
        heard = list(ex.map(transcribe, keys))
    bad = []
    for i, ((text, _), k, h) in enumerate(zip(items, keys, heard)):
        d = diff(text, h)
        if d:
            print(f'{k}  {text}\n    heard: {h}\n    {show(d)}', flush=True)
            if fix:
                d = retake(items, i, d)
            if d:
                bad.append((i, text, d))
    print(f'{len(items)} takes, {len(bad)} differ from the script (in pinyin)')
    if fix:
        for i, text, d in bad:
            print(f'  still differs (listen): {i:3d} {show(d)}  | {text}')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--retake', action='store_true')
    main(ap.parse_args().retake)
