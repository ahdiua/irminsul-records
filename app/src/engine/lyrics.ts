// Word-timed lyrics (data/lyrics.json) with queries for karaoke rendering.
import { smart } from './type';

export interface Word {
  w: string; // display token (punctuation attached, typographic quotes: don’t, ’cause)
  start: number;
  end: number;
  conf?: number;
  syl?: [number, number][];
  /** 'backing' for the second voice (the "i need" over the chorus-3 stutter). */
  layer?: 'lead' | 'backing';
  /** Latin token: a space separates it from its neighbours when a line is set as text. */
  latin?: boolean;
  /** filled in by Lyrics: */
  line: number;
  index: number; // index within line
  gi: number; // global word index
}
export interface Line {
  i: number;
  text: string;
  start: number;
  end: number;
  layer: 'lead' | 'backing';
  /** audio the line was aligned on: the separated vocal or a pack stem role */
  src: 'vocal' | 'lead' | 'ini';
  /** a timing cue, not a subtitle: 'adlib' (the 呜 hum: draw as motion, never as text),
   * 'stutter' (word times = the stutter's attacks, for glitch typography) */
  kind?: 'adlib' | 'stutter';
  words: Word[];
}

export class Lyrics {
  lines: Line[];
  words: Word[];
  /** The vocal-chop melody phrases ("啊……", ~9.4 s each, starting on downbeats). */
  chops: { start: number; end: number }[];
  /** On-screen credits of the release (from the LRC): title, lyricist, singer... */
  credits: { t: number; text: string }[];
  constructor(j: { lines: any[]; chops?: { start: number; end: number }[]; credits?: { t: number; text: string }[] }) {
    this.chops = j.chops ?? [];
    this.credits = (j.credits ?? []).map((c) => ({ t: c.t, text: c.text.replace(/\u0000/g, '').trim() }));
    // display text gets curly apostrophes and quotes (the data keeps the typed ones); mono UI
    // text that wants them straight uses plain()
    this.lines = (j.lines as any[]).map((l, li) => ({
      ...l,
      i: li,
      text: smart(l.text),
      words: (l.words as any[]).map((w, wi) => ({ ...w, w: smart(w.w), line: li, index: wi, gi: 0 })),
    }));
    this.words = this.lines.flatMap((l) => l.words);
    this.words.forEach((w, i) => (w.gi = i));
  }

  static async load(): Promise<Lyrics> {
    for (const url of ['data/lyrics.json', 'data/lyrics.approx.json']) {
      const r = await fetch(url);
      if (r.ok && (r.headers.get('content-type') ?? '').includes('json')) return new Lyrics(await r.json());
    }
    throw new Error('no lyrics data found');
  }

  /** The line being sung at t (or null in gaps). */
  lineAt(t: number): Line | null {
    return this.lines.find((l) => t >= l.start && t < l.end) ?? null;
  }
  /** Most recent line that started at or before t. */
  lastLine(t: number): Line | null {
    let best: Line | null = null;
    for (const l of this.lines) if (l.start <= t) best = l;
    return best;
  }
  nextLine(t: number): Line | null {
    return this.lines.find((l) => l.start > t) ?? null;
  }
  linesIn(t0: number, t1: number): Line[] {
    return this.lines.filter((l) => l.end > t0 && l.start < t1);
  }
  /** Lines whose text includes `s` (case-insensitive, straight or curly quotes). Handy for finding a lyric by content. */
  find(s: string): Line[] {
    const q = fold(s);
    return this.lines.filter((l) => fold(l.text).includes(q));
  }
  /** First line containing `s`; throws if missing (fail loudly while authoring). */
  get(s: string, nth = 0): Line {
    const l = this.find(s)[nth];
    if (!l) throw new Error(`lyric not found: ${s}`);
    return l;
  }
  wordAt(t: number): Word | null {
    return this.words.find((w) => t >= w.start && t < w.end) ?? null;
  }
  lastWord(t: number): Word | null {
    let best: Word | null = null;
    for (const w of this.words) if (w.start <= t) best = w;
    return best;
  }
  /** Words whose normalized text matches (e.g. 'p(doom)'). */
  findWords(s: string): Word[] {
    const q = norm(s);
    return this.words.filter((w) => norm(w.w) === q);
  }

  /**
   * Sung progress of a word at time t: 0 before start, 1 after end, linear inside
   * (or piecewise across syllables when available). Use for karaoke wipes.
   */
  static wordProgress(w: Word, t: number): number {
    if (t <= w.start) return 0;
    if (t >= w.end) return 1;
    if (w.syl && w.syl.length > 1) {
      const n = w.syl.length;
      for (let i = 0; i < n; i++) {
        const [a, b] = w.syl[i]!;
        if (t < a) return i / n;
        if (t < b) return (i + (t - a) / Math.max(1e-3, b - a)) / n;
      }
      return 1;
    }
    return (t - w.start) / Math.max(1e-3, w.end - w.start);
  }

  /**
   * Progress through a whole line in characters (0..text.length), for per-glyph wipes. Tokens are one
   * Han character each or a Latin word; only two adjacent Latin words have a space between them
   * ("出了KTV我", "i need you"), matching how `text` is built by pipeline/05_align.py.
   */
  static lineCharProgress(l: Line, t: number): number {
    let chars = 0;
    for (let i = 0; i < l.words.length; i++) {
      const w = l.words[i]!;
      const p = Lyrics.wordProgress(w, t);
      chars += p * Array.from(w.w).length;
      if (p < 1) break;
      const nx = l.words[i + 1];
      if (nx && w.latin && nx.latin) chars += 1; // the space between two Latin words
    }
    return Math.min(chars, Array.from(l.text).length);
  }

  /** Words of a line that are sung on the lead layer (default) or the backing layer. */
  static layer(l: Line, layer: 'lead' | 'backing' = 'lead'): Word[] {
    return l.words.filter((w) => (w.layer ?? 'lead') === layer);
  }
}

export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9()㐀-鿿]/g, '');
const fold = (s: string) => s.toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"');
