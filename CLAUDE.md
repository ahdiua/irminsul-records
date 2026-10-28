# Teyvat Chronicle — working notes

《提瓦特编年史》: a ~13.8 min Chinese-narrated lore chronicle of Genshin Impact's Teyvat, from the
dragon age to Snezhnaya (7.0). Everything on screen is code-rendered: **no AI-generated images, no game assets**.
One exception, at the user's request: the seven element emblems come from the vector file the user supplied
(`app/src/scenes/elements.svg`), so they match the game's icons.
The engine is a fork of `../黑凤梨/app` (itself pdoom-video): read `../pdoom-video/docs/ENGINE.md` for the engine
rules (determinism on `f.t`, 1920×1080 logical px, linear HDR colours, `frameIdx` for per-frame jitter).

The film was first titled 《伊尔明苏尔档案》 and renamed: Irminsul holds no records of beings from outside Teyvat
(Descenders, the Traveler), so it can't be the narrator of a story they drive. Don't frame the narration as
"Irminsul's records". The folder and the `irminsul*` picture ids keep the old name (`../teyvat-chronicle` is an
earlier abandoned attempt).

## Layout
- `pipeline/` — Python stages (uv project at the root; `uv sync`). `paths.py` = every path.
  - `script_src.py` — THE SCRIPT: chapters → shots (picture id, camera move, fx, tag) → lines (`L` narration,
    `Q` quotation of 《日月前事》 read by the second voice, `plate=` for montage lines).
  - `tts.py` → `build/tts/<hash>.wav|json` (Gemini 3.8 Flash TTS via OpenRouter `/audio/speech`, key `$env:OR_API`
    — never print it; voices + delivery `instructions` in `VOICES`; cached by model+text+voice). `--audition` renders
    sample lines in candidate voices. Gemini gives no word times: `align.py` force-aligns the known text (pinyin over
    torchaudio MMS_FA, own CTC Viterbi); low-scoring takes (skipped/invented words) are re-taken.
  - `assemble.py` → `data/chapters.json` (the edit), `data/lyrics.json` (subtitle cues ≤20 chars with word times),
    `build/narration.wav`. Pacing constants at the top (cards, gaps, quote air).
  - `music.py` → `build/music/score.wav` (synthesised: pads, choir, FM bells, harp, drone, taiko, booms, hall).
    Event hits are found from chapters.json by shot plate id (`shot_start` / `line_start`).
  - `mix.py` → `audio/chronicle.m4a` + `data/audio.json` (voice -17 LUFS; score -25 LUFS, two-band ducking).
  - `fonts.py` → `app/public/fonts/` (subset from data + `ui_strings.txt` + script). Add new display strings there.
  - QA: `qa_audio.py <wav> <png>` (spectrogram + loudness with chapter lines), `sheet.py <dir>` (contact sheet),
    `qa_tts.py` (STT of every take diffed against the script in pinyin; run after any TTS change).
- `app/src/scenes/` — one scene for the whole film (`chronicle.ts`, every chapter entry shares one `Film`):
  - `_film.ts` data → segments (one per shot; montage shots one per line; title; endcard), camera moves, `project()`.
  - `_sky.ts` parametric sky pass (gradient, nebula, stars/milky, glow+rays, ≤3 moons, aurora, clouds, sea, rift,
    false-sky shell + cracks). `_land.ts` silhouette layers: Canvas2D paths → cached RGBA mask → GLSL shading
    (fog, engraving hatch, rim light, inscribed contour). `_shapes.ts` the path vocabulary.
  - `_art.ts` line art (`Ink` over LineBatch: serpent/wyvern dragons, `makeTree`/`drawTree`, nail, cube, chess,
    sigil, rings, moon `shatter`, tendrils, particles). `_pics.ts` EVERY PICTURE (keyed by the script's plate ids).
  - `_emblem.ts` element emblems: `elements.svg` paths → atlas mask (glyph + two glows) → additive pass with a
    burn-in reveal; a picture lists them in `emblems: (k) => [...]` (`sy` < 1 lays one flat on the ground).
  - `_overlay.ts` typography: subtitles, quote cards lit per character, chapter cards + year ruler, era stamp,
    place tags, title, end card.
- `docs/RESEARCH.md` sources and the adopted chronology; `docs/research/` raw page captures.

## Commands
```
uv run python pipeline/tts.py; uv run python pipeline/assemble.py; uv run python pipeline/fonts.py
uv run python pipeline/music.py; uv run python pipeline/mix.py
cd app; bunx tsc --noEmit -p .
$env:PDOOM_NO_HMR=1; bunx --bun vite --port 5190 --strictPort --host 127.0.0.1     # keep one running: render.ts's
                                                                                  # private server times out here
bun scripts/render.ts stills --url http://127.0.0.1:5190 --t 58.4,122.5 --out ../out/wip/x
bun scripts/render.ts video --url http://127.0.0.1:5190 --samples 1 --codec hevc_nvenc --cq 22 --out ../out/draft-1080.mp4
```
After changing the script: tts → assemble → fonts → music → mix (times move; pictures follow by id).

## Research access
WebFetch cannot reach Fandom (Cloudflare) or archive.org; use the Chrome DevTools MCP on
`https://web.archive.org/web/2026id_/https://genshin-impact.fandom.com/wiki/<Page>`. Chinese names: check against the
game text, in this order: 米游社观测枢 (official; from its tab, `fetch` `api-static.mihoyo.com/common/blackboard/ys_obc/v1/
search/content?app_sn=ys_obc&keyword=…` and `…/content/info?app_sn=ys_obc&content_id=…`), BWIKI (from its tab,
`/ys/api.php` search / `action=parse` works; unquoted search terms only, ~1 req/s), 萌娘百科 (no API or `action=raw`;
fetch page HTML from a moegirl tab, the body is inside `<template id="MOE_SKIN_TEMPLATE_BODYCONTENT">`; fast requests hit
Cloudflare; it has errors, e.g. it calls the last king 伊尔明苏尔). Captures go to `docs/research/<site>/`.

## Shell
PowerShell 7. Python one-liners with quotes break in pwsh: write a script file.
