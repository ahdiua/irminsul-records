"""QA: transcribe every cached take (OpenRouter STT) and diff it against the script, so a mis-read, dropped or added
word that the alignment checks can't see (tts.py MAX_EXTRA misses one or two added chars) shows up.

The diff is on toneless pinyin, so the transcriber's homophones (神座/神作, 尘世/陈氏) don't count; numerals are
compared as a run (the transcriber writes 3700 for 三千七百). Transcripts are cached in build/tts/stt/<key>.json.

usage:  uv run python pipeline/qa_tts.py
"""
import base64, difflib, io, json, re, urllib.request
from concurrent.futures import ThreadPoolExecutor

import soundfile as sf
from pypinyin import Style, lazy_pinyin

from paths import TTS
from script_src import all_lines
from tts import api_key, key

URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
STT_MODEL = 'microsoft/mai-transcribe-2'
OUT = TTS / 'stt'
NUM = '零一二两三四五六七八九十百千万亿'


def transcribe(k: str) -> str:
    out = OUT / f'{k}.json'
    if out.exists():
        return json.loads(out.read_text(encoding='utf-8'))['text']
    x, sr = sf.read(TTS / f'{k}.wav', dtype='float32')
    buf = io.BytesIO()
    sf.write(buf, x, sr, format='WAV', subtype='PCM_16')
    body = {'model': STT_MODEL, 'input_audio': {'data': base64.b64encode(buf.getvalue()).decode(), 'format': 'wav'},
            'language': 'zh', 'temperature': 0}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method='POST', headers={
        'Content-Type': 'application/json', 'Authorization': f'Bearer {api_key()}'})
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.loads(r.read())
    out.write_text(json.dumps(res, ensure_ascii=False), encoding='utf-8')
    return res['text']


def tokens(s: str) -> list[tuple[str, str]]:
    """(display, toneless pinyin) per Han character; a numeral run (Han or Arabic) is one '#' token."""
    s = re.sub(rf'[{NUM}]+|\d+(?:\.\d+)?', '#', s)
    s = ''.join(ch for ch in s if ch == '#' or '一' <= ch <= '鿿')
    py = lazy_pinyin(s, style=Style.NORMAL, errors=lambda r: list(r))
    return list(zip(s, py)) if len(py) == len(s) else [(ch, lazy_pinyin(ch)[0]) for ch in s]


def main():
    OUT.mkdir(exist_ok=True)
    jobs = [(l.voice_text or l.text, 'quote' if l.quote else 'narrator') for _, _, l in all_lines()]
    keys = [key(*j) for j in jobs]
    with ThreadPoolExecutor(4) as ex:
        heard = list(ex.map(transcribe, keys))
    bad = 0
    for (text, _), k, h in zip(jobs, keys, heard):
        a, b = tokens(text), tokens(h)
        sm = difflib.SequenceMatcher(a=[p for _, p in a], b=[p for _, p in b], autojunk=False)
        diffs = [(op, ''.join(c for c, _ in a[i1:i2]), ''.join(c for c, _ in b[j1:j2]))
                 for op, i1, i2, j1, j2 in sm.get_opcodes() if op != 'equal']
        if diffs:
            bad += 1
            print(f'{k}  {text}\n    heard: {h}\n    ' + '; '.join(f'{op} 「{x}」→「{y}」' for op, x, y in diffs))
    print(f'{len(jobs)} takes, {bad} differ from the script (in pinyin)')


if __name__ == '__main__':
    main()
