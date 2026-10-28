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
MASTER = ROOT / "audio" / "chronicle.m4a"
SR = 48000

_UF = Path.home() / "AppData" / "Local" / "Microsoft" / "Windows" / "Fonts"
FONTS = {
    "sans-500": _UF / "思源黑体 CN Medium.otf",
    "sans-700": _UF / "思源黑体 CN Bold 2.001.otf",
    "sans-900": _UF / "思源黑体 CN Heavy.otf",
    "serif-600": _UF / "思源宋体 CN SemiBold.otf",
    "serif-700": _UF / "思源宋体 CN Bold.otf",
    "serif-900": _UF / "思源宋体 CN Heavy.otf",
    "display": BUILD / "dl" / "smiley" / "SmileySans-Oblique.ttf",
    "hand": BUILD / "dl" / "LXGWWenKai-Regular.ttf",
}

for d in (BUILD, TTS, MUSIC, CACHE, ART_RAW, QA, DATA, ART, FONTS_OUT, MASTER.parent):
    d.mkdir(parents=True, exist_ok=True)
