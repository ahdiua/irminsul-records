"""Stage: narration TTS. One mp3 + word-boundary json per line of script_src.py, cached by content hash in build/tts/.

Narrator: zh-CN-YunjianNeural (deep, documentary). Quotations of in-game texts: zh-CN-XiaoxiaoNeural, slower, so the
"record" has its own voice.

usage:  uv run python pipeline/tts.py [--force]
"""
import argparse, asyncio, hashlib, json

import edge_tts

from paths import TTS
from script_src import all_lines

VOICES = {
    'narrator': dict(voice='zh-CN-YunjianNeural', rate='-6%', pitch='-2Hz', volume='+0%'),
    'quote': dict(voice='zh-CN-XiaoxiaoNeural', rate='-14%', pitch='-4Hz', volume='+0%'),
}


def key(text: str, role: str) -> str:
    v = VOICES[role]
    return hashlib.sha1(json.dumps([text, v], ensure_ascii=False).encode()).hexdigest()[:12]


async def synth(text: str, role: str, force: bool, sem: asyncio.Semaphore) -> str:
    k = key(text, role)
    mp3, js = TTS / f'{k}.mp3', TTS / f'{k}.json'
    if mp3.exists() and js.exists() and not force:
        return k
    v = VOICES[role]
    async with sem:
        for attempt in range(4):
            try:
                com = edge_tts.Communicate(text, v['voice'], rate=v['rate'], pitch=v['pitch'], volume=v['volume'], boundary='WordBoundary')
                audio, marks = bytearray(), []
                async for ch in com.stream():
                    if ch['type'] == 'audio':
                        audio += ch['data']
                    elif ch['type'] in ('WordBoundary', 'SentenceBoundary'):
                        marks.append({'w': ch['text'], 'start': ch['offset'] / 1e7, 'end': (ch['offset'] + ch['duration']) / 1e7})
                mp3.write_bytes(bytes(audio))
                js.write_text(json.dumps({'text': text, 'role': role, 'marks': marks}, ensure_ascii=False), encoding='utf-8')
                print('tts', k, role, text[:24], len(marks), 'marks', flush=True)
                return k
            except Exception as e:  # the free endpoint drops connections now and then
                print('retry', attempt, k, repr(e)[:120], flush=True)
                await asyncio.sleep(2 + attempt * 3)
    raise RuntimeError(f'TTS failed: {text}')


async def main(force: bool):
    sem = asyncio.Semaphore(4)
    jobs = []
    for _, _, l in all_lines():
        role = 'quote' if l.quote else 'narrator'
        jobs.append(synth(l.voice_text or l.text, role, force, sem))
    keys = await asyncio.gather(*jobs)
    print(len(keys), 'lines ok')


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--force', action='store_true')
    asyncio.run(main(ap.parse_args().force))
