# Irminsul Records — working notes

《伊尔明苏尔档案：提瓦特编年史》: a ~13.6 min Chinese-narrated lore chronicle of Genshin Impact's Teyvat, from the
dragon age to Snezhnaya (7.0). Everything on screen is code-rendered: **no AI-generated images, no game assets**.
The engine is a fork of `../黑凤梨/app` (itself pdoom-video): read `../pdoom-video/docs/ENGINE.md` for the engine
rules (determinism on `f.t`, 1920×1080 logical px, linear HDR colours, `frameIdx` for per-frame jitter).

## Layout
- `pipeline/` — Python stages (uv project at the root; `uv sync`). `paths.py` = every path.
  - `script_src.py` — THE SCRIPT: chapters → shots (picture id, camera move, fx, tag) → lines (`L` narration,
    `Q` quotation of 《日月前事》 read by the second voice, `plate=` for montage lines).
  - `tts.py` → `build/tts/<hash>.mp3|json` (Edge TTS: 云健 narrator, 晓晓 quotes; cached by text+voice).
  - `assemble.py` → `data/chapters.json` (the edit), `data/lyrics.json` (subtitle cues ≤20 chars with word times),
    `build/narration.wav`. Pacing constants at the top (cards, gaps, quote air).
  - `music.py` → `build/music/score.wav` (synthesised: pads, choir, FM bells, harp, drone, taiko, booms, hall).
    Event hits are found from chapters.json by shot plate id (`shot_start` / `line_start`).
  - `mix.py` → `audio/chronicle.m4a` + `data/audio.json` (voice -17 LUFS; score -25 LUFS, two-band ducking).
  - `fonts.py` → `app/public/fonts/` (subset from data + `ui_strings.txt` + script). Add new display strings there.
  - QA: `qa_audio.py <wav> <png>` (spectrogram + loudness with chapter lines), `sheet.py <dir>` (contact sheet).
- `app/src/scenes/` — one scene for the whole film (`chronicle.ts`, every chapter entry shares one `Film`):
  - `_film.ts` data → segments (one per shot; montage shots one per line; title; endcard), camera moves, `project()`.
  - `_sky.ts` parametric sky pass (gradient, nebula, stars/milky, glow+rays, ≤3 moons, aurora, clouds, sea, rift,
    false-sky shell + cracks). `_land.ts` silhouette layers: Canvas2D paths → cached RGBA mask → GLSL shading
    (fog, engraving hatch, rim light, inscribed contour). `_shapes.ts` the path vocabulary.
  - `_art.ts` line art (`Ink` over LineBatch: serpent/wyvern dragons, `makeTree`/`drawTree`, nail, cube, chess,
    sigil, rings, moon `shatter`, tendrils, particles). `_pics.ts` EVERY PICTURE (keyed by the script's plate ids).
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
`https://web.archive.org/web/2026id_/https://genshin-impact.fandom.com/wiki/<Page>`; BWIKI loads directly in Chrome.

## Shell
PowerShell 7. Python one-liners with quotes break in pwsh: write a script file.
