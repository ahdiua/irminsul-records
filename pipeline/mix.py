"""Stage: the master. Narration (build/narration.wav) over the score (build/music/score.wav, if present), the score
ducked under the voice; loudness to -16 LUFS integrated, true peak <= -1.5 dBTP.

Writes audio/chronicle.m4a (AAC 256k, what the renders mux), audio/chronicle.opus (Opus 128k, what the preview player
loads: 13.6 MB against the m4a's 27; constrained VBR, as plain VBR averaged 157k on the score) and data/audio.json
(envelopes the scenes can react to: `vocal` = narration, `other` = score, `rms` = mix; no beat grid: a slow 60 BPM
placeholder).

usage:  uv run python pipeline/mix.py
"""
import json, subprocess

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy import signal
from scipy.ndimage import maximum_filter1d, uniform_filter1d

from paths import BUILD, DATA, MASTER, MUSIC, PREVIEW, SR

FPS = 100


def env(x: np.ndarray) -> np.ndarray:
    hop = SR // FPS
    n = len(x) // hop
    r = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = np.clip((20 * np.log10(r) + 60) / 60, 0, 1)
    return uniform_filter1d(db, 5)


def main():
    voice = sf.read(BUILD / 'narration.wav', dtype='float32')[0]
    chapters = json.loads((DATA / 'chapters.json').read_text(encoding='utf-8'))
    n = int(round(chapters['duration'] * SR))
    voice = np.pad(voice, (0, max(0, n - len(voice))))[:n]
    score_path = MUSIC / 'score.wav'
    if score_path.exists():
        score = sf.read(score_path, dtype='float32', always_2d=True)[0]
        score = np.pad(score, ((0, max(0, n - len(score))), (0, 0)))[:n]
    else:
        score = np.zeros((n, 2), np.float32)
    # narration loudness first (it sets the level of the film), then the score under it
    meter = pyln.Meter(SR)
    v_lufs = meter.integrated_loudness(voice[voice != 0][: SR * 600] if np.any(voice) else voice)
    voice *= 10 ** ((-17.0 - v_lufs) / 20)
    # the score sits at a fixed distance under the voice
    if score_path.exists():
        s_lufs = meter.integrated_loudness(score)
        score *= 10 ** ((-25.0 - s_lufs) / 20)
    # ducking: a smoothed voice-activity envelope (attack 60 ms, release 700 ms); the score's low band (where the
    # narrator's fundamental lives) is ducked harder than its upper band
    hop = SR // FPS
    act = env(voice) > 0.35
    act = maximum_filter1d(act.astype(np.float32), 40)  # hold 0.4 s across word gaps

    def gain_curve(db: float) -> np.ndarray:
        g = np.ones_like(act)
        for i in range(1, len(act)):
            target = 10 ** (db / 20) if act[i] else 1.0
            k = 0.15 if target < g[i - 1] else 0.014
            g[i] = g[i - 1] + (target - g[i - 1]) * k
        return np.interp(np.arange(n) / hop, np.arange(len(g)), g).astype(np.float32)

    lo_sos = signal.butter(4, 380, 'low', fs=SR, output='sos')
    low = signal.sosfiltfilt(lo_sos, score, axis=0).astype(np.float32)
    high = score - low
    duck_lo, duck_hi = gain_curve(-12.0), gain_curve(-6.0)
    mix = np.stack([voice, voice], 1) * 1.0 + low * duck_lo[:, None] + high * duck_hi[:, None]
    lufs = meter.integrated_loudness(mix)
    mix *= 10 ** ((-16.0 - lufs) / 20)
    peak = np.max(np.abs(mix))
    if peak > 10 ** (-1.5 / 20):  # soft limit only if needed
        mix = np.tanh(mix / peak * 1.2) / np.tanh(1.2) * 10 ** (-1.5 / 20) if peak > 1.0 else mix * (10 ** (-1.5 / 20) / peak)
    wav = BUILD / 'master.wav'
    sf.write(wav, mix, SR, subtype='FLOAT')
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(wav), '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', str(MASTER)], check=True)
    # AAC priming is removed by the m4a's edit list, Opus's by its pre-skip: in both t = 0 is the first sample
    subprocess.run(['ffmpeg', '-y', '-v', 'error', '-i', str(wav), '-c:a', 'libopus', '-b:a', '128k', '-vbr', 'constrained', str(PREVIEW)], check=True)
    a = {'duration': chapters['duration'], 'bpm': 60, 'fps': FPS,
         'beats': [round(i * 1.0, 3) for i in range(int(chapters['duration']) + 2)],
         'downbeats': [round(i * 4.0, 3) for i in range(int(chapters['duration'] / 4) + 2)],
         'sections': [{'name': c['id'], 'start': c['start'], 'end': c['end']} for c in chapters['chapters']],
         'features': {'vocal': np.round(env(voice), 3).tolist(), 'other': np.round(env(score.mean(1)), 3).tolist(),
                      'rms': np.round(env(mix.mean(1)), 3).tolist()},
         'onsets': {}}
    (DATA / 'audio.json').write_text(json.dumps(a), encoding='utf-8')
    print(f'master {MASTER.name} {MASTER.stat().st_size / 2**20:.1f} MB, preview {PREVIEW.name} {PREVIEW.stat().st_size / 2**20:.1f} MB: {n / SR:.1f}s, voice {v_lufs:.1f} -> -17 LUFS, mix -16 LUFS, score {"yes" if score_path.exists() else "none"}')


if __name__ == '__main__':
    main()
