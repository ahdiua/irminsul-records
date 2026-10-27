"""Stage: the score, synthesised from scratch (no samples, no generative models) and laid on data/chapters.json.

Instruments: wavetable string pad (3 detuned voices, low-passed), formant "choir", FM celesta / bells, plucked harp
(additive, upper partials die first), low drone, taiko-like drum, impact boom, noise riser; a synthetic stereo hall
(convolution) over everything. Harmony per chapter in the D minor / F major family; the "Irminsul" motif opens the
film, crowns the title card, returns for the traveler and closes the epilogue. Hits land on the picture's events
(the Celestial Nail's impact, the Musou slash, the chapter cards).

usage:  uv run python pipeline/music.py      -> build/music/score.wav (48 kHz stereo float)
"""
import json

import numpy as np
import soundfile as sf
from scipy import signal

from paths import DATA, MUSIC, SR

rng = np.random.default_rng(7)
film = json.loads((DATA / 'chapters.json').read_text(encoding='utf-8'))
DUR = film['duration'] + 1.0
N = int(DUR * SR)
dry = np.zeros((N, 2), np.float32)   # percussion, close sounds
wet = np.zeros((N, 2), np.float32)   # sent to the hall
CH = {c['id']: c for c in film['chapters']}


def hz(m: float) -> float:
    return 440.0 * 2 ** ((m - 69) / 12)


def place(buf: np.ndarray, t0: float, x: np.ndarray, pan: float = 0.0, gain: float = 1.0):
    i0 = int(round(t0 * SR))
    if i0 >= len(buf) or len(x) == 0:
        return
    if i0 < 0:
        x = x[-i0:]; i0 = 0
    x = x[: len(buf) - i0]
    l, r = np.cos((pan + 1) * np.pi / 4), np.sin((pan + 1) * np.pi / 4)
    if x.ndim == 1:
        buf[i0:i0 + len(x), 0] += x * l * gain * 1.414
        buf[i0:i0 + len(x), 1] += x * r * gain * 1.414
    else:
        buf[i0:i0 + len(x)] += x * gain


def env(n: int, a: float, r: float, curve=2.0) -> np.ndarray:
    t = np.arange(n) / SR
    e = np.minimum(1.0, t / max(a, 1e-3)) ** curve
    rel = np.clip((n / SR - t) / max(r, 1e-3), 0, 1) ** 1.5
    return (e * rel).astype(np.float32)


# ------------------------------------------------------------------ instruments

TAB = 4096
_saw = np.zeros(TAB)
for k in range(1, 28):
    _saw += np.sin(2 * np.pi * k * np.arange(TAB) / TAB) / k ** 1.25
_saw /= np.abs(_saw).max()


def osc(f: float, n: int, phase: float = 0.0, vib=0.0) -> np.ndarray:
    t = np.arange(n) / SR
    ph = phase + f * t + (vib * np.sin(2 * np.pi * 4.7 * t) / (2 * np.pi * 4.7) if vib else 0)
    idx = (ph * TAB) % TAB
    i = idx.astype(np.int32)
    fr = idx - i
    return (_saw[i] * (1 - fr) + _saw[(i + 1) % TAB] * fr).astype(np.float32)


def pad(notes, t0: float, dur: float, gain=0.12, bright=1800.0, a=1.8, r=2.5, pan_spread=0.6):
    n = int((dur + r) * SR)
    out = np.zeros((n, 2), np.float32)
    for j, m in enumerate(notes):
        f = hz(m)
        for v, det in enumerate((-0.09, 0.0, 0.11)):
            x = osc(f * 2 ** (det / 12), n, rng.random(), vib=f * 0.002)
            p = (v - 1) * pan_spread * 0.6 + (j / max(1, len(notes) - 1) - 0.5) * 0.4
            out[:, 0] += x * np.cos((p + 1) * np.pi / 4)
            out[:, 1] += x * np.sin((p + 1) * np.pi / 4)
    sos = signal.butter(2, bright, 'low', fs=SR, output='sos')
    out = signal.sosfilt(sos, out, axis=0).astype(np.float32)
    out *= env(n, a, r)[:, None] * gain / (len(notes) * 1.5)
    place(wet, t0, out)


def choir(notes, t0: float, dur: float, gain=0.1, vowel='a', a=2.0, r=3.0):
    n = int((dur + r) * SR)
    src = np.zeros(n, np.float32)
    for m in notes:
        for det in (-0.07, 0.06):
            src += osc(hz(m) * 2 ** (det / 12), n, rng.random(), vib=hz(m) * 0.004)
    forms = {'a': [(800, 1.0), (1150, 0.5), (2900, 0.25)], 'o': [(450, 1.0), (800, 0.45), (2830, 0.15)], 'u': [(325, 1.0), (700, 0.3), (2530, 0.1)]}[vowel]
    out = np.zeros(n, np.float32)
    for fc, g in forms:
        sos = signal.butter(2, [fc * 0.85, fc * 1.15], 'band', fs=SR, output='sos')
        out += signal.sosfilt(sos, src).astype(np.float32) * g
    out *= env(n, a, r) * gain / len(notes)
    place(wet, t0, out, pan=-0.15)
    place(wet, t0 + 0.013, out * 0.9, pan=0.25)


def bell(m: float, t0: float, gain=0.08, ratio=3.5, index=2.2, decay=3.5, pan=0.0, celesta=False):
    d = decay
    n = int(d * 1.6 * SR)
    t = np.arange(n) / SR
    f = hz(m)
    I = index * np.exp(-t * (2.5 if celesta else 1.2))
    x = np.sin(2 * np.pi * f * t + I * np.sin(2 * np.pi * f * (2.0 if celesta else ratio) * t))
    x += 0.25 * np.sin(2 * np.pi * f * 2 * t) * np.exp(-t * 3)
    e = np.exp(-t / (d * 0.35)) * np.minimum(1, t / 0.004)
    place(wet, t0, (x * e * gain).astype(np.float32), pan)
    place(dry, t0, (x * e * gain * 0.35).astype(np.float32), pan)


def pluck(m: float, t0: float, gain=0.07, decay=2.6, pan=0.0):
    n = int(decay * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.zeros(n)
    for k in range(1, 12):
        if f * k > SR / 2.2:
            break
        x += np.sin(2 * np.pi * f * k * t + k) / k ** 1.1 * np.exp(-t * (1.2 + 0.9 * k)) * (1 - 0.5 * np.cos(k * 1.3))
    x *= np.minimum(1, t / 0.002)
    place(wet, t0, (x * gain * 0.7).astype(np.float32), pan)
    place(dry, t0, (x * gain * 0.5).astype(np.float32), pan)


def drone(m: float, t0: float, dur: float, gain=0.08, a=4.0, r=4.0):
    gain *= 0.55  # kept under the narrator's register (QA: the drone bands masked 100-150 Hz)
    n = int((dur + r) * SR)
    t = np.arange(n) / SR
    f = hz(m)
    x = np.sin(2 * np.pi * f * t) + 0.5 * np.sin(2 * np.pi * f * 1.5 * t + 0.3) + 0.3 * np.sin(2 * np.pi * f * 2 * t + 1)
    x *= 1 + 0.15 * np.sin(2 * np.pi * 0.11 * t)
    x = (x * env(n, a, r) * gain).astype(np.float32)
    place(wet, t0, x * 0.6)
    place(dry, t0, x * 0.5)


def taiko(t0: float, gain=0.22, pitch=1.0, pan=0.0):
    n = int(1.6 * SR)
    t = np.arange(n) / SR
    f = (55 + 70 * np.exp(-t * 18)) * pitch
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) * np.exp(-t * 4.5)
    nz = signal.sosfilt(signal.butter(2, 900, 'low', fs=SR, output='sos'), rng.standard_normal(n)) * np.exp(-t * 30) * 0.6
    y = ((x + nz) * gain).astype(np.float32)
    place(dry, t0, y, pan)
    place(wet, t0, y * 0.35, pan)


def boom(t0: float, gain=0.35, long=3.5):
    n = int(long * SR)
    t = np.arange(n) / SR
    f = 30 + 60 * np.exp(-t * 3)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.3)
    nz = signal.sosfilt(signal.butter(2, 300, 'low', fs=SR, output='sos'), rng.standard_normal(n)) * np.exp(-t * 2.2) * 0.8
    crack = signal.sosfilt(signal.butter(2, 2500, 'high', fs=SR, output='sos'), rng.standard_normal(n)) * np.exp(-t * 14) * 0.25
    y = ((x + nz + crack) * gain).astype(np.float32)
    place(dry, t0, y)
    place(wet, t0, y * 0.6)


def riser(t_hit: float, length=2.5, gain=0.06):
    n = int(length * SR)
    t = np.arange(n) / SR
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    for k in range(8):  # a sweep of bands, upward
        a, b = int(k * n / 8), int((k + 1) * n / 8)
        fc = 300 * 2 ** (k * 0.6)
        out[a:b] = signal.sosfilt(signal.butter(2, [fc, fc * 1.6], 'band', fs=SR, output='sos'), nz[a:b])
    out *= (t / length) ** 2.5 * gain
    place(wet, t_hit - length, out.astype(np.float32))


# ------------------------------------------------------------------ the score

D2, A2, F2, G2, C3, D3, E3, F3, G3, A3, Bb2, Bb3, C4, D4, E4, F4, G4, A4, Bb4, C5, D5, E5, F5, A5 = 38, 45, 41, 43, 48, 50, 52, 53, 55, 57, 46, 58, 60, 62, 64, 65, 67, 69, 70, 72, 74, 76, 77, 81

CHORDS = {  # roman-free: concrete voicings
    'Dm9': [D3, A3, C4, E4, F4], 'Bbmaj7': [Bb2, F3, A3, D4], 'F': [F2 + 12, C4, F4, A4], 'C/E': [E3, G3, C4, E4], 'Am': [A2 + 12, E4, A4, C5],
    'Gm': [G2 + 12, D4, G4, Bb4], 'Asus': [A2 + 12, E4, A4, D5], 'A': [A2 + 12, E4, A4, 73], 'Fmaj7': [F3, C4, E4, A4], 'G/F': [F3, D4, G4, B4] if (B4 := 71) else [],
    'C': [C3, G3, C4, E4], 'Dm': [D3, A3, D4, F4], 'Eb/D': [D3, Bb3, Eb4 := 63, G4], 'Bbm': [Bb2, F3, 61, F4], 'E': [E3, B3 := 59, 68, E4 + 12], 'Dmaj': [D3, A3, 66, A4],
}

MOTIF = [(D5, 0, 1), (A4, 1, 1), (C5, 2, 1), (D5, 3, 2), (F5, 5, 1), (E5, 6, 1), (D5, 7, 3)]   # (note, beat, length) at 66 bpm


def motif(t0: float, beat=60 / 66, gain=0.07, octave=0, inst='celesta', pan=0.1):
    for m, b, _ in MOTIF:
        if inst == 'celesta':
            bell(m + octave, t0 + b * beat, gain=gain, celesta=True, decay=2.8, pan=pan)
        else:
            pluck(m + octave, t0 + b * beat, gain=gain, pan=pan)


def progression(t0: float, t1: float, chords: list[str], step: float, **kw):
    t = t0
    i = 0
    while t < t1 - 0.5:
        d = min(step, t1 - t)
        pad(CHORDS[chords[i % len(chords)]], t, d + 1.2, **kw)
        t += step
        i += 1


def arps(t0: float, t1: float, chords: list[str], step: float, rate: float, gain=0.045, inst='pluck', up=12, pan=0.3):
    t, i = t0, 0
    while t < t1 - 0.3:
        notes = CHORDS[chords[int((t - t0) // step) % len(chords)]]
        m = notes[1:][i % (len(notes) - 1)] + up
        (pluck(m, t, gain=gain, pan=pan * np.sin(i)) if inst == 'pluck' else bell(m, t, gain=gain, celesta=True, decay=2.2, pan=pan * np.sin(i)))
        t += rate
        i += 1


def drums(t0: float, t1: float, bpm: float, gain=0.18, pattern=(1, 0, 0.6, 0, 1, 0.5, 0.7, 0)):
    beat = 60 / bpm / 2
    t, i = t0, 0
    while t < t1:
        v = pattern[i % len(pattern)]
        if v:
            taiko(t, gain=gain * v * (0.85 + 0.3 * rng.random()), pitch=1.0 if v > 0.8 else 1.3, pan=(rng.random() - 0.5) * 0.4)
        t += beat
        i += 1


def card(c):
    """A chapter card: a deep hit as the card opens, a bell on the title wipe."""
    riser(c['start'] + 0.4, 2.2, 0.035)
    boom(c['start'] + 0.4, gain=0.22)
    bell(D4 if c['element'] != 'gold' else F4, c['start'] + 0.9, gain=0.08, ratio=3.5, decay=6)
    bell(A4, c['start'] + 0.95, gain=0.05, ratio=3.5, decay=6, pan=0.3)


def shot_start(chap: str, plate: str) -> float:
    for s in CH[chap]['shots']:
        if s['plate'] == plate:
            return s['start']
    raise KeyError(plate)


def line_start(chap: str, plate: str, i: int) -> float:
    for s in CH[chap]['shots']:
        if s['plate'] == plate:
            return s['lines'][i]['start']
    raise KeyError(plate)


def build():
    T = film['title']; END = film['end']
    # ---- prologue: the tree grows in the dark
    c = CH['prologue']
    drone(D2, 0.0, T['start'] + 2, gain=0.05, a=6)
    progression(1.0, T['start'], ['Dm9', 'Bbmaj7', 'F', 'C/E'], 8.0, gain=0.10, bright=1200, a=3)
    motif(4.0, gain=0.06)
    motif(22.0, gain=0.05, octave=12, pan=-0.2)
    arps(12.0, T['start'] - 1, ['Dm9', 'Bbmaj7', 'F', 'C/E'], 8.0, 0.6, gain=0.022, inst='celesta', up=24)
    # title: the swell
    riser(T['start'] + 0.5, 3.0, 0.05)
    boom(T['start'] + 0.5, gain=0.3, long=5)
    choir(CHORDS['Dm9'][1:], T['start'] + 0.3, T['end'] - T['start'], gain=0.07, a=1.5)
    pad(CHORDS['Dm9'], T['start'] + 0.3, T['end'] - T['start'], gain=0.13, bright=2600, a=1.0)
    motif(T['start'] + 1.0, gain=0.09)
    # ---- I dragons: primal, warm, low horns
    c = CH['dragons']; card(c)
    drone(D2, c['start'], c['end'] - c['start'], gain=0.07)
    progression(c['cardEnd'] - 1, c['end'], ['Dm', 'Am', 'Bbmaj7', 'C'], 7.0, gain=0.12, bright=900, a=2.5)
    drums(c['cardEnd'] + 6, c['end'] - 8, 54, gain=0.1, pattern=(1, 0, 0, 0, 0.6, 0, 0, 0))
    arps(shot_start('dragons', 'moons'), c['end'], ['Dm', 'Am', 'Bbmaj7', 'C'], 7.0, 0.45, gain=0.03, inst='celesta', up=12)
    # ---- II doves: radiant, sacred (F lydian), choir
    c = CH['doves']; card(c)
    progression(c['cardEnd'] - 1, c['end'], ['Fmaj7', 'G/F', 'Am', 'C'], 8.0, gain=0.11, bright=2200)
    choir([F3, C4, A4], c['cardEnd'], 26, gain=0.06, vowel='a')
    choir([F3, A3, E4], shot_start('doves', 'paradise'), 30, gain=0.05, vowel='o')
    arps(c['cardEnd'] + 8, c['end'] - 3, ['Fmaj7', 'G/F', 'Am', 'C'], 8.0, 0.5, gain=0.028, inst='celesta', up=12)
    w = shot_start('doves', 'war')
    drums(w + 1, shot_start('doves', 'falsesky'), 76, gain=0.15)
    for k in range(4):
        bell(D4 + 12 * (k % 2), line_start('doves', 'diagram:shades', 1) + k * 1.25 + 0.3, gain=0.07, ratio=2.76, decay=5, pan=(-0.5, 0.5, -0.3, 0.3)[k])
    # ---- III the funerary flame: dark, phrygian, impacts
    c = CH['flame']; card(c)
    drone(D2, c['start'], c['end'] - c['start'], gain=0.09)
    progression(c['cardEnd'] - 1, c['end'], ['Dm', 'Eb/D', 'Bbm', 'A'], 6.5, gain=0.12, bright=1100)
    choir([D3, A3, Eb4], shot_start('flame', 'abyssdragon'), 20, gain=0.06, vowel='u')
    nail = shot_start('flame', 'nail') + 3.2
    riser(nail, 3.0, 0.07); boom(nail, gain=0.45, long=6)
    for k in range(5):
        taiko(nail + 0.02 + k * 0.11, gain=0.12 / (k + 1))
    sh = line_start('flame', 'shattered', 1)
    for k in range(6):
        bell(D5 + (-1, 3, -5, 2, -8, 0)[k], sh - 0.4 + k * 0.45, gain=0.05, ratio=1.41, index=3, decay=4, pan=(k % 2 - 0.5))
    boom(sh - 0.5, gain=0.25)
    # ---- IV the Archon War: epic pulse
    c = CH['archonwar']; card(c)
    drone(D2, c['start'], c['end'] - c['start'], gain=0.07)
    progression(c['cardEnd'] - 1, c['end'], ['Dm', 'Bbmaj7', 'Gm', 'A'], 6.0, gain=0.12, bright=1500)
    drums(shot_start('archonwar', 'mondstadt_old'), shot_start('archonwar', 'diagram:seven') - 1, 72, gain=0.16)
    arps(shot_start('archonwar', 'mondstadt_old'), shot_start('archonwar', 'diagram:seven'), ['Dm', 'Bbmaj7', 'Gm', 'A'], 6.0, 0.417, gain=0.026, up=12)
    boom(line_start('archonwar', 'inazuma_old', 1) + 0.8, gain=0.4)
    for k in range(5):
        boom(line_start('archonwar', 'liyue_old', 1) - 0.5 + k * 0.7 + 0.9, gain=0.12, long=2)
    seven = shot_start('archonwar', 'diagram:seven')
    choir([D3, A3, D4, F4], seven, c['end'] - seven, gain=0.07)
    for k in range(7):
        bell((D4, F4, A4, C5, D5, F5, A5)[k], seven + 0.6 + k * 0.45, gain=0.06, ratio=2.0, decay=4, pan=np.cos(k))
    # ---- V the godless kingdom: mechanical ostinato
    c = CH['golden']; card(c)
    progression(c['cardEnd'] - 1, c['end'], ['Am', 'F', 'Dm', 'E'], 6.0, gain=0.10, bright=1300)
    arps(c['cardEnd'], c['end'] - 2, ['Am', 'F', 'Dm', 'E'], 6.0, 0.25, gain=0.03, up=0)
    drums(c['cardEnd'] + 2, c['end'] - 4, 120, gain=0.06, pattern=(1, 0, 0, 0.4))
    # ---- VI the Cataclysm: tragic, heavy
    c = CH['cataclysm']; card(c)
    drone(D2, c['start'], c['end'] - c['start'], gain=0.1)
    progression(c['cardEnd'] - 1, c['end'], ['Dm', 'Bbmaj7', 'Gm', 'Asus', 'A'], 6.0, gain=0.13, bright=1200)
    choir([D3, F3, A3, D4], shot_start('cataclysm', 'sinners'), 26, gain=0.06, vowel='o')
    j = shot_start('cataclysm', 'judgment')
    for k in range(6):
        boom(j + 1.8 + k * 0.35, gain=0.14, long=2.5)
    drums(shot_start('cataclysm', 'durin'), shot_start('cataclysm', 'cubes'), 66, gain=0.12, pattern=(1, 0, 0, 0, 0.5, 0, 0.7, 0))
    cb = shot_start('cataclysm', 'cubes')
    choir([D3, A3, F4], cb, c['end'] - cb, gain=0.07, vowel='a')
    motif(cb + 6, gain=0.05, octave=-12, inst='pluck')
    # ---- VII five hundred years: sparse piano
    c = CH['aftermath']; card(c)
    progression(c['cardEnd'] - 1, c['end'], ['Bbmaj7', 'F', 'Gm', 'Dm'], 8.0, gain=0.09, bright=1000)
    arps(c['cardEnd'] + 1, c['end'] - 3, ['Bbmaj7', 'F', 'Gm', 'Dm'], 8.0, 1.0, gain=0.035, up=12)
    # ---- VIII the traveler: hopeful, building
    c = CH['traveler']; card(c)
    progression(c['cardEnd'] - 1, c['end'], ['F', 'C/E', 'Dm', 'Bbmaj7'], 5.0, gain=0.12, bright=2400)
    motif(c['cardEnd'] + 0.5, gain=0.07, octave=0, inst='pluck', pan=-0.2)
    arps(c['cardEnd'] + 5, c['end'] - 2, ['F', 'C/E', 'Dm', 'Bbmaj7'], 5.0, 0.3125, gain=0.03, inst='celesta', up=12)
    drums(c['cardEnd'] + 10, c['end'] - 6, 96, gain=0.1, pattern=(1, 0, 0.5, 0, 0.8, 0, 0.5, 0.4))
    ji = line_start('traveler', 'diagram:journey', 2) - 0.45 + 3.5
    boom(ji, gain=0.35)
    dr = line_start('traveler', 'diagram:journey', 5)
    choir([F3, C4, F4, A4], dr - 0.5, 10, gain=0.08)
    riser(dr - 0.4, 2.5, 0.05)
    # ---- epilogue: the motif returns, resolves to D major
    c = CH['epilogue']; card(c)
    progression(c['cardEnd'] - 1, END['start'] - 1, ['Dm9', 'Bbmaj7', 'F', 'C/E'], 8.0, gain=0.10, bright=1400)
    motif(c['cardEnd'] + 2, gain=0.06)
    motif(shot_start('epilogue', 'irminsul_end') + 2, gain=0.06, octave=12, pan=-0.2)
    pad(CHORDS['Dmaj'], END['start'] - 1, END['end'] - END['start'] + 1, gain=0.12, bright=2000, a=2.5, r=4)
    choir([D3, A3, 66, A4], END['start'] - 1, END['end'] - END['start'] + 1, gain=0.06)
    bell(D5, END['start'] + 0.4, gain=0.08, celesta=True, decay=6)
    bell(66 + 12, END['start'] + 0.9, gain=0.06, celesta=True, decay=6, pan=0.3)
    bell(A5, END['start'] + 1.4, gain=0.05, celesta=True, decay=6, pan=-0.3)


def hall(x: np.ndarray, t60=3.4) -> np.ndarray:
    n = int(t60 * 1.2 * SR)
    t = np.arange(n) / SR
    ir = np.zeros((n, 2), np.float32)
    for ch in range(2):
        nz = rng.standard_normal(n)
        lo = signal.sosfilt(signal.butter(2, 1500, 'low', fs=SR, output='sos'), nz) * np.exp(-6.9 * t / t60)
        hi = signal.sosfilt(signal.butter(2, 1500, 'high', fs=SR, output='sos'), nz) * np.exp(-6.9 * t / (t60 * 0.45))
        ir[:, ch] = (lo + 0.6 * hi) * np.minimum(1, t / 0.02)
        for k in range(8):  # early reflections
            d = int((0.011 + 0.009 * k + 0.003 * ch) * SR)
            ir[d, ch] += 0.5 * 0.8 ** k
    ir /= np.sqrt((ir ** 2).sum(axis=0, keepdims=True))
    out = np.stack([signal.oaconvolve(x[:, c], ir[:, c])[: len(x)] for c in range(2)], 1)
    return out.astype(np.float32)


def main():
    build()
    print('voices placed; reverb...', flush=True)
    mix = dry + 0.55 * hall(wet) + 0.45 * wet
    # gentle master glue: high-pass the rumble, soft-clip
    mix = signal.sosfilt(signal.butter(2, 28, 'high', fs=SR, output='sos'), mix, axis=0).astype(np.float32)
    peak = np.abs(mix).max()
    mix = np.tanh(mix / peak * 1.4) / np.tanh(1.4) * 0.9
    MUSIC.mkdir(parents=True, exist_ok=True)
    sf.write(MUSIC / 'score.wav', mix, SR, subtype='FLOAT')
    print(f'score.wav {len(mix) / SR:.1f}s')


if __name__ == '__main__':
    main()
