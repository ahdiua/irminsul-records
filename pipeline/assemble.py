"""Stage: lay the narration on the master timeline.

Reads script_src.CHAPTERS and the TTS cache; writes
  build/narration.wav     the voice track (48 kHz mono float)
  data/chapters.json      chapters / shots / lines with their times (the edit the app follows)
  data/lyrics.json        subtitle cues (<= ~20 chars each) with word times, in the engine's lyrics format

Pacing: the film opens on the tree being drawn; every chapter opens on a title card with no voice; quotations get
air around them; the end card holds after the last line.

usage:  uv run python pipeline/assemble.py
"""
import json, re, subprocess

import numpy as np
import soundfile as sf

from paths import BUILD, DATA, SR, TTS
from script_src import CHAPTERS
from tts import key

OPEN = 6.0          # the tree draws itself before the first word
TITLE = 7.5         # the title card after the prologue
CARD = 4.6          # each chapter's card before its first line
CHAPTER_TAIL = 1.4  # after a chapter's last line, before the next card
LINE_GAP = 0.36
SHOT_GAP = 0.8
QUOTE_AIR = 0.55    # extra silence before and after a quotation
END_HOLD = 3.0      # after the last line, before the end card
END_CARD = 9.0
CUE_MAX = 20        # subtitle cue length (chars)


def decode(path) -> np.ndarray:
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def speech_bounds(x: np.ndarray) -> tuple[float, float]:
    """First and last sample above -45 dBFS (20 ms windows), in seconds."""
    hop = SR // 50
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    on = np.nonzero(20 * np.log10(rms) > -45)[0]
    return (on[0] * hop / SR, (on[-1] + 1) * hop / SR) if len(on) else (0.0, len(x) / SR)


PUNCT = set('，。、；：！？—…「」《》（）·“”')


def char_times(text: str, marks: list[dict]) -> list[tuple[float, float]]:
    """Per-character (start, end) from the word marks; punctuation takes the time of the gap it sits in."""
    times: list[tuple[float, float] | None] = [None] * len(text)
    i = 0
    for m in marks:
        w = m['w']
        j = text.find(w, i)
        if j < 0:  # normalisation differences: fall back to char-by-char matching
            continue
        n = len(w)
        for k in range(n):
            a = m['start'] + (m['end'] - m['start']) * k / n
            b = m['start'] + (m['end'] - m['start']) * (k + 1) / n
            times[j + k] = (a, b)
        i = j + n
    # fill holes (punctuation, unmatched) from neighbours
    last = 0.0
    for k in range(len(text)):
        if times[k] is None:
            nxt = next((times[q][0] for q in range(k + 1, len(text)) if times[q] is not None), last)
            times[k] = (last, max(last, nxt))
        last = times[k][1]
    return times  # type: ignore


def cues(text: str) -> list[tuple[int, int]]:
    """Split a line into subtitle cues at punctuation, greedily packing clauses up to CUE_MAX chars."""
    clauses, s = [], 0
    for k, ch in enumerate(text):
        if ch in '，。；：！？' or (ch == '—' and k + 1 < len(text) and text[k + 1] == '—'):
            if ch == '—':
                continue
            clauses.append((s, k + 1)); s = k + 1
        elif ch == '—' and k > 0 and text[k - 1] == '—':
            clauses.append((s, k + 1)); s = k + 1
    if s < len(text):
        clauses.append((s, len(text)))
    out: list[tuple[int, int]] = []
    for a, b in clauses:
        if out and text[out[-1][1] - 1] in '。！？':
            out.append((a, b))              # never across a sentence end
        elif out and (b - out[-1][0]) <= CUE_MAX and len(clean(text[out[-1][0]:out[-1][1]])) < 9:
            out[-1] = (out[-1][0], b)       # a very short clause joins the previous cue
        elif out and (b - out[-1][0]) <= CUE_MAX * 0.75:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    # clauses still longer than CUE_MAX are split in the middle
    final = []
    for a, b in out:
        while b - a > CUE_MAX + 4:
            m = a + (b - a) // 2
            final.append((a, m)); a = m
        final.append((a, b))
    return final


def clean(s: str) -> str:
    """Display form of a cue: no trailing comma / full stop / semicolon (Chinese subtitle convention)."""
    s = s.strip()
    s = re.sub(r'[，。；、：]+$', '', s)
    return s


def main():
    voice = np.zeros(int(SR * 60 * 25), np.float32)
    t = OPEN
    chapters_out, cue_lines = [], []
    title = None
    for ci, ch in enumerate(CHAPTERS):
        c_start = 0.0 if ci == 0 else t
        if ci > 0:
            t += CARD
        c = {'id': ch.id, 'no': ch.no, 'title': ch.title, 'era': ch.era,
             'years': None if ch.years == float('inf') else ch.years, 'element': ch.element,
             'start': round(c_start, 3), 'cardEnd': round(t if ci > 0 else OPEN, 3), 'shots': []}
        for si, sh in enumerate(ch.shots):
            if si > 0:
                t += SHOT_GAP - LINE_GAP
            s_start = t if si > 0 or ci == 0 else c['cardEnd']
            s = {'plate': sh.plate, 'bg': sh.bg, 'move': sh.move, 'fx': sh.fx, 'focus': list(sh.focus), 'tag': sh.tag,
                 'start': round(s_start if si > 0 else c['start'], 3), 'lines': []}
            for li, ln in enumerate(sh.lines):
                role = 'quote' if ln.quote else 'narrator'
                k = key(ln.voice_text or ln.text, role)
                x = decode(TTS / f'{k}.wav')
                marks = json.loads((TTS / f'{k}.json').read_text(encoding='utf-8'))['marks']
                on, off = speech_bounds(x)
                if ln.quote:
                    t += QUOTE_AIR
                a0 = t - on                        # where the clip starts so that speech begins at t
                i0 = int(round(a0 * SR))
                voice[i0:i0 + len(x)] += x
                l_start, l_end = t, a0 + off
                s['lines'].append({'text': ln.text, 'start': round(l_start, 3), 'end': round(l_end, 3),
                                   'quote': ln.quote, 'plate': ln.plate})
                # subtitle cues with word times
                ct = char_times(ln.text, marks)
                for a, b in cues(ln.text):
                    seg = ln.text[a:b]
                    disp = clean(seg)
                    if not disp:
                        continue
                    words = [{'w': m['w'], 'start': round(a0 + m['start'], 3), 'end': round(a0 + m['end'], 3)}
                             for m in marks if a0 + m['start'] >= a0 + ct[a][0] - 1e-3 and a0 + m['end'] <= a0 + ct[b - 1][1] + 1e-3]
                    cue_lines.append({'text': disp, 'start': round(a0 + ct[a][0], 3), 'end': round(a0 + ct[b - 1][1], 3),
                                      'layer': 'lead', 'src': 'vocal', 'words': words or [{'w': disp, 'start': round(a0 + ct[a][0], 3), 'end': round(a0 + ct[b - 1][1], 3)}],
                                      'quote': ln.quote, 'chapter': ch.id})
                t = l_end + LINE_GAP + ln.pause + (QUOTE_AIR if ln.quote else 0.0)
            s['end'] = round(t - LINE_GAP, 3)
            c['shots'].append(s)
        t += CHAPTER_TAIL - LINE_GAP
        if ci == 0:  # the title card follows the prologue
            title = {'start': round(t, 3), 'end': round(t + TITLE, 3)}
            t += TITLE
        c['end'] = round(t, 3)
        # shots tile the chapter: each runs to the next one's start, the last to the chapter's end
        for a, b in zip(c['shots'], c['shots'][1:]):
            a['end'] = b['start']
        c['shots'][-1]['end'] = round(title['start'] if ci == 0 else c['end'], 3)
        chapters_out.append(c)
    last_line = t
    end = {'start': round(t - CHAPTER_TAIL + END_HOLD, 3)}
    end['end'] = round(end['start'] + END_CARD, 3)
    chapters_out[-1]['end'] = end['start']
    chapters_out[-1]['shots'][-1]['end'] = end['start']
    duration = end['end']
    # subtitle cues must not overlap: a cue ends when the next starts at the latest
    for a, b in zip(cue_lines, cue_lines[1:]):
        a['end'] = min(a['end'], b['start'])
    voice = voice[: int(duration * SR) + SR]
    BUILD.mkdir(exist_ok=True)
    sf.write(BUILD / 'narration.wav', voice, SR, subtype='FLOAT')
    (DATA / 'chapters.json').write_text(json.dumps({'duration': round(duration, 3), 'open': OPEN, 'title': title, 'end': end,
                                                    'chapters': chapters_out}, ensure_ascii=False, indent=1), encoding='utf-8')
    (DATA / 'lyrics.json').write_text(json.dumps({'lines': cue_lines}, ensure_ascii=False, indent=0), encoding='utf-8')
    print(f'duration {duration:.1f}s ({duration / 60:.2f} min), {len(cue_lines)} cues, longest cue {max(len(c["text"]) for c in cue_lines)} chars')
    for c in chapters_out:
        print(f'  {c["id"]:10s} {c["start"]:7.1f} - {c["end"]:7.1f}  ({c["end"] - c["start"]:5.1f}s, {len(c["shots"])} shots)')
    print('title', title, 'end', end, 'last line', round(last_line, 2))


if __name__ == '__main__':
    main()
