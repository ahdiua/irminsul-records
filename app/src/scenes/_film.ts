// The edit as data: data/chapters.json (pipeline/assemble.py) flattened into picture segments, plus the camera
// moves. Everything here is a pure function of time.
import film from '@root/data/chapters.json';
import { clamp, lerp, smoothstep } from '../engine/util';

export interface LineJ { text: string; start: number; end: number; quote: boolean; plate: string }
export interface ShotJ { plate: string; bg: string; move: string; fx: string; focus: [number, number]; tag: string; start: number; end: number; lines: LineJ[] }
export interface ChapterJ { id: string; no: string; title: string; era: string; years: number | null; element: string; start: number; cardEnd: number; end: number; shots: ShotJ[] }
export interface FilmJ { duration: number; open: number; title: { start: number; end: number }; end: { start: number; end: number }; chapters: ChapterJ[] }

export const FILM = film as unknown as FilmJ;

/** A stretch of picture: one shot, or one line of a montage shot, or the title / end card. */
export interface Segment {
  i: number;
  pic: string;          // picture id (a shot's plate, a montage line's plate, 'title', 'endcard')
  bg: string;           // diagrams: the picture under the drawing
  start: number;        // the dissolve into it begins here
  end: number;          // the next segment's start
  move: string;
  fx: string;
  focus: [number, number];
  tag: string;
  chapter: ChapterJ;
  shot: ShotJ | null;
  /** index of this segment within its shot (montage), and the shot's segment count */
  k: number;
  n: number;
}

/** Dissolve length between segments (s). */
export const XFADE = 2.2;

export const SEGMENTS: Segment[] = (() => {
  const out: Segment[] = [];
  const push = (s: Omit<Segment, 'i'>) => out.push({ ...s, i: out.length });
  for (const c of FILM.chapters) {
    for (const sh of c.shots) {
      const montage = sh.lines.some((l) => l.plate);
      if (!montage) {
        push({ pic: sh.plate, bg: sh.bg, start: sh.start, end: sh.end, move: sh.move, fx: sh.fx, focus: sh.focus, tag: sh.tag, chapter: c, shot: sh, k: 0, n: 1 });
      } else {
        sh.lines.forEach((l, k) => {
          const a = k === 0 ? sh.start : l.start - 0.45;
          const b = k + 1 < sh.lines.length ? sh.lines[k + 1]!.start - 0.45 : sh.end;
          push({ pic: l.plate, bg: sh.bg, start: a, end: b, move: k % 2 ? 'pan-l' : 'push', fx: sh.fx, focus: sh.focus, tag: '', chapter: c, shot: sh, k, n: sh.lines.length });
        });
      }
    }
    if (c.id === 'prologue') {
      push({ pic: 'title', bg: '', start: FILM.title.start, end: FILM.title.end, move: 'still', fx: 'motes', focus: [0.5, 0.5], tag: '', chapter: c, shot: null, k: 0, n: 1 });
    }
  }
  const last = FILM.chapters[FILM.chapters.length - 1]!;
  push({ pic: 'endcard', bg: '', start: FILM.end.start, end: FILM.end.end + 5, move: 'still', fx: 'motes', focus: [0.5, 0.5], tag: '', chapter: last, shot: null, k: 0, n: 1 });
  // segments tile the film
  for (let i = 0; i + 1 < out.length; i++) out[i]!.end = out[i + 1]!.start;
  return out;
})();

export function segmentAt(t: number): number {
  let i = 0;
  while (i + 1 < SEGMENTS.length && SEGMENTS[i + 1]!.start <= t) i++;
  return i;
}

export function chapterAt(t: number): ChapterJ {
  let c = FILM.chapters[0]!;
  for (const x of FILM.chapters) if (x.start <= t) c = x;
  return c;
}

/** The camera of a segment at time t: zoom about `focus` (uv), and an offset in logical px. */
export interface Cam { zoom: number; x: number; y: number; fx: number; fy: number }

export function camera(seg: Segment, t: number): Cam {
  const dur = Math.max(1, seg.end + XFADE - seg.start);
  const p = clamp((t - seg.start) / dur, 0, 1);
  const e = 0.5 - 0.5 * Math.cos(Math.PI * p); // sine in-out: camera drifts never start or stop abruptly
  const [fx, fy] = seg.focus;
  switch (seg.move) {
    case 'push': return { zoom: lerp(1.0, 1.11, e), x: 0, y: 0, fx, fy };
    case 'pull': return { zoom: lerp(1.13, 1.0, e), x: 0, y: 0, fx, fy };
    case 'pan-l': return { zoom: 1.08, x: lerp(55, -55, e), y: 0, fx, fy };
    case 'pan-r': return { zoom: 1.08, x: lerp(-55, 55, e), y: 0, fx, fy };
    case 'rise': return { zoom: lerp(1.08, 1.04, e), x: 0, y: lerp(-45, 40, e), fx, fy };
    case 'sink': return { zoom: lerp(1.04, 1.09, e), x: 0, y: lerp(40, -40, e), fx, fy };
    default: return { zoom: lerp(1.0, 1.03, e), x: 0, y: 0, fx, fy };
  }
}

/** Screen position of a plate point (logical px) seen through `cam` at parallax depth `d` (0 = infinitely far, 1 = the plate). */
export function project(cam: Cam, x: number, y: number, d = 1): [number, number] {
  const z = 1 + (cam.zoom - 1) * d;
  const cx = cam.fx * 1920, cy = cam.fy * 1080;
  return [(x - cx) * z + cx + cam.x * d, (y - cy) * z + cy + cam.y * d];
}

/** 0..1 how far into its picture a segment is, for draw-on reveals (reaches 1 after `len` s). */
export function reveal(seg: Segment, t: number, len = 3, delay = 0) {
  return smoothstep(seg.start + delay, seg.start + delay + len, t);
}
