"""Shared paths for the pipeline stages (run everything from the repo root with `uv run python pipeline/<stage>.py`)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PIPE = ROOT / "pipeline"
BUILD = ROOT / "build"          # every intermediate (gitignored)
TTS = BUILD / "tts"             # one wav + char-times json per narration line
MUSIC = BUILD / "music"         # rendered score stems
CACHE = BUILD / "cache"         # model weights (MMS_FA aligner)
ART_RAW = BUILD / "art" / "raw" # ComfyUI outputs, all candidates
QA = BUILD / "qa"
DATA = ROOT / "data"            # what the app reads: lyrics.json (narration), audio.json, chapters.json
APP = ROOT / "app"
ART = APP / "public" / "art"    # the plates the app draws
FONTS_OUT = APP / "public" / "fonts"
PREVIEW = ROOT / "audio" / "chronicle.opus"   # Opus 128k: what the preview player loads (the renders use build/master.wav)
SR = 48000
GCP_KEY = ROOT / "secrets" / "gcp_key.json"   # Vertex AI service-account key (gitignored; never print it)

# the game's own typeface (汉仪润圆 65W), supplied by the user; every text in the film is set in it
FONTS = {
    "runyuan": ROOT / "assets" / "fonts" / "HYRunYuan-65W.ttf",
}

for d in (BUILD, TTS, MUSIC, CACHE, ART_RAW, QA, DATA, ART, FONTS_OUT, PREVIEW.parent):
    d.mkdir(parents=True, exist_ok=True)
