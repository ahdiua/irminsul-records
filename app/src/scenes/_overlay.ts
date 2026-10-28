// The record's typography, drawn on one Canvas2D layer over the picture: subtitles, quotation cards (lit
// character by character with the second voice), chapter cards with the year ruler, the era stamp, place tags,
// the title card and the end card.
import { Layer2D } from '../engine/gl';
import type { Line, Lyrics } from '../engine/lyrics';
import { rgba } from '../engine/palette';
import { F, font } from '../engine/type';
import { clamp, ease, lerp, smoothstep } from '../engine/util';
import { FILM, type ChapterJ, type Segment, chapterAt } from './_film';

const GOLD = '#E9C47E', BONE = '#EEE6D3', ASH = '#8B93A8';

/** End card. The author: the user's id. SOURCES: the websites docs/RESEARCH.md draws on (the user wants the sites
 * only, not the game texts and quests read on them: RESEARCH.md lists those); new display text also goes in
 * pipeline/ui_strings.txt (font subset). */
const AUTHOR = 'ahdiua';
const SOURCES = [
  '米游社观测枢 · 原神WIKI（BWIKI） · 萌娘百科 · Genshin Impact Wiki（Fandom）',
  'HoYoLAB Wiki · Wikipedia · Notebookcheck · Game Rant · Pocket Tactics · 哔哩哔哩',
];
const MAKING = '旁白 Gemini 3.8 Flash TTS（Schedar）· 引文 Aoede · 字体 汉仪润圆 65W · 画面与配乐均由代码实时生成';
const EL: Record<string, string> = {
  anemo: '#62D6B8', geo: '#F2B54A', electro: '#B48CFF', dendro: '#9CD84F', hydro: '#4DB6F5', pyro: '#FF7240', cryo: '#A9E6F4',
  gold: '#E9C47E', abyss: '#A578F0',
};

/** Ruler stops: years before present -> position 0..1 along the ruler (log-like, so 500 years still has room). */
const RULER: [number, number, string][] = [[Infinity, 0, '纪年之前'], [6000, 0.2, '6000'], [4000, 0.36, '4000'], [2000, 0.56, '2000'], [1000, 0.7, '1000'], [500, 0.82, '500'], [0, 1, '现在']];
function rulerX(years: number | null): number {
  if (years === null || !Number.isFinite(years)) return 0;
  for (let i = 1; i < RULER.length; i++) {
    const [y0, x0] = RULER[i - 1]!, [y1, x1] = RULER[i]!;
    if (years <= y0 && years >= y1) return Number.isFinite(y0) ? lerp(x0, x1, (y0 - years) / (y0 - y1)) : x1;
  }
  return 1;
}

export class Overlay {
  layer = new Layer2D();
  constructor(private lyrics: Lyrics) {}

  draw(t: number, seg: Segment, labels?: (c: CanvasRenderingContext2D) => void) {
    const c = this.layer.ctx;
    this.layer.clear();
    c.textBaseline = 'alphabetic';
    labels?.(c);
    const ch = chapterAt(t);
    this.chapterCard(c, t, ch);
    this.stamp(c, t, ch);
    this.tag(c, t, seg);
    this.journey(c, t, seg);
    this.quote(c, t, ch);
    this.subtitle(c, t);
    this.title(c, t);
    this.endCard(c, t);
    return this.layer.upload();
  }

  private spaced(c: CanvasRenderingContext2D, s: string, x: number, y: number, sp: number, align: 'center' | 'left' | 'right' = 'center') {
    c.letterSpacing = `${sp}px`;
    const w = c.measureText(s).width - sp;
    const x0 = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
    c.textAlign = 'left';
    c.fillText(s, x0, y);
    c.letterSpacing = '0px';
    return w;
  }

  private subtitle(c: CanvasRenderingContext2D, t: number) {
    const l = this.lyrics.lineAt(t) as (Line & { quote?: boolean }) | null;
    if (!l || l.quote) return;
    const a = smoothstep(l.start - 0.02, l.start + 0.14, t) * (1 - smoothstep(l.end - 0.05, l.end + 0.12, t));
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    // a low band of shade so the line reads over bright skies
    const g = c.createLinearGradient(0, 880, 0, 1080);
    g.addColorStop(0, 'rgba(3,5,10,0)'); g.addColorStop(0.55, 'rgba(3,5,10,0.42)'); g.addColorStop(1, 'rgba(3,5,10,0.55)');
    c.fillStyle = g; c.fillRect(0, 880, 1920, 200);
    c.font = font(F.serif(600), 40);
    c.fillStyle = BONE;
    c.shadowColor = 'rgba(0,0,0,0.85)'; c.shadowBlur = 14;
    this.spaced(c, l.text, 960, 992, 3);
    c.shadowBlur = 0;
    c.restore();
  }

  /** Quotation cards: the text of 《日月前事》 set large in 文楷, each character lit as it is read. */
  private quote(c: CanvasRenderingContext2D, t: number, ch: ChapterJ) {
    for (const sh of ch.shots) for (const ln of sh.lines) {
      if (!ln.quote) continue;
      const a = smoothstep(ln.start - 0.6, ln.start, t) * (1 - smoothstep(ln.end + 0.9, ln.end + 1.6, t));
      if (a <= 0) continue;
      // per-char light-up from the cues' word times
      const cues = this.lyrics.lines.filter((l) => (l as any).quote && l.end > ln.start - 0.6 && l.start < ln.end + 0.3);
      const words = cues.flatMap((q) => q.words);
      const body = ln.text.replace(/^「|」$/g, '');
      const rows: string[] = [];
      let cur = '';
      for (const chh of body) {
        cur += chh;
        if ((cur.length >= 15 && '，。；'.includes(chh)) || cur.length >= 19) { rows.push(cur); cur = ''; }
      }
      if (cur) rows.push(cur);
      c.save();
      c.globalAlpha = a;
      // a darkened band for the card
      const g = c.createRadialGradient(960, 470, 50, 960, 470, 900);
      g.addColorStop(0, 'rgba(4,6,12,0.8)'); g.addColorStop(1, 'rgba(4,6,12,0.25)');
      c.fillStyle = g; c.fillRect(0, 0, 1920, 1080);
      const size = 60, lh = 92;
      const y0 = 470 - (rows.length - 1) * lh / 2 + 20;
      // which chars are lit: walk the words through the body text
      const lit: number[] = new Array(body.length).fill(0);
      let k = 0;
      for (const w of words) {
        const j = body.indexOf(w.w, k);
        if (j < 0) continue;
        for (let q = 0; q < w.w.length; q++) lit[j + q] = clamp((t - (w.start + (w.end - w.start) * q / w.w.length)) / 0.25, 0, 1);
        k = j + w.w.length;
      }
      // punctuation follows the char before it
      for (let q = 0; q < body.length; q++) if ('，。；：、'.includes(body[q]!) && q > 0) lit[q] = lit[q - 1]!;
      if (t > ln.end) lit.fill(1);
      c.font = font(F.hand(), size);
      c.textAlign = 'left';
      let idx = 0;
      rows.forEach((row, r) => {
        const sp = 6;
        c.letterSpacing = `${sp}px`;
        const w = c.measureText(row).width - sp;
        let x = 960 - w / 2;
        const y = y0 + r * lh;
        if (r === 0) { c.fillStyle = rgba(GOLD, 0.8); c.fillText('「', x - size * 1.05, y); }
        for (const chh of row) {
          const L = lit[idx++] ?? 0;
          c.fillStyle = `rgba(238,230,211,${0.22 + 0.78 * L})`;
          c.shadowColor = rgba(GOLD, 0.9 * L * (1 - smoothstep(0.3, 1, L) * 0.5)); c.shadowBlur = 22 * L;
          c.fillText(chh, x, y);
          x += c.measureText(chh).width + sp;
        }
        c.shadowBlur = 0;
        if (r === rows.length - 1) { c.fillStyle = rgba(GOLD, 0.8); c.fillText('」', x, y); }
        c.letterSpacing = '0px';
      });
      const ay = y0 + (rows.length - 1) * lh + 78;
      c.font = font(F.serif(600), 26);
      c.fillStyle = rgba(GOLD, 0.85 * smoothstep(ln.start + 0.5, ln.start + 1.5, t));
      this.spaced(c, '——《日月前事》', 1330, ay, 4, 'right');
      c.restore();
    }
  }

  private chapterCard(c: CanvasRenderingContext2D, t: number, ch: ChapterJ) {
    if (!ch.no) return;
    const t0 = ch.start, t1 = ch.cardEnd;
    const a = smoothstep(t0 + 0.2, t0 + 1.1, t) * (1 - smoothstep(t1 - 0.4, t1 + 0.7, t));
    if (a <= 0) return;
    const acc = EL[ch.element] ?? GOLD;
    c.save();
    c.fillStyle = `rgba(5,7,14,${0.78 * a})`;
    c.fillRect(0, 0, 1920, 1080);
    c.globalAlpha = a;
    // 卷 n with rules
    c.font = font(F.serif(700), 32);
    c.fillStyle = GOLD;
    const w = this.spaced(c, ch.no, 960, 400, 14);
    const rl = 140 * ease.outCubic(clamp((t - t0 - 0.4) / 1.2, 0, 1));
    c.strokeStyle = rgba(GOLD, 0.7); c.lineWidth = 1;
    c.beginPath(); c.moveTo(960 - w / 2 - 52, 389); c.lineTo(960 - w / 2 - 52 - rl, 389); c.moveTo(960 + w / 2 + 52, 389); c.lineTo(960 + w / 2 + 52 + rl, 389); c.stroke();
    // title, wiped in from the left with a glow front
    const wipe = ease.outCubic(clamp((t - t0 - 0.5) / 1.6, 0, 1));
    c.font = font(F.serif(900), 124);
    c.letterSpacing = '18px';
    const tw = c.measureText(ch.title).width - 18;
    c.save();
    c.beginPath(); c.rect(960 - tw / 2 - 20, 380, (tw + 40) * wipe, 220); c.clip();
    c.fillStyle = BONE;
    c.shadowColor = rgba(acc, 0.6); c.shadowBlur = 30;
    c.textAlign = 'left';
    c.fillText(ch.title, 960 - tw / 2, 552);
    c.restore();
    c.letterSpacing = '0px';
    // era
    c.font = font(F.sans(500), 30);
    c.fillStyle = rgba(BONE, 0.75 * smoothstep(t0 + 1.2, t0 + 2.0, t));
    if (ch.era) this.spaced(c, ch.era, 960, 640, 10);
    // the ruler: where in time this chapter sits
    const prev = FILM.chapters[FILM.chapters.indexOf(ch) - 1];
    const x0 = 360, x1 = 1560, y = 880;
    const ra = smoothstep(t0 + 0.6, t0 + 1.6, t);
    c.globalAlpha = a * ra;
    c.strokeStyle = rgba(GOLD, 0.45); c.lineWidth = 1;
    c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke();
    c.font = font(F.sans(500), 18);
    for (const [, pos, label] of RULER) {
      const x = lerp(x0, x1, pos);
      c.beginPath(); c.moveTo(x, y - 7); c.lineTo(x, y + 7); c.stroke();
      c.fillStyle = rgba(ASH, 0.85);
      this.spaced(c, label, x, y + 36, 2);
    }
    const from = rulerX(prev ? prev.years : ch.years), to = rulerX(ch.years);
    const mk = lerp(from, to, ease.inOutCubic(clamp((t - t0 - 0.9) / 1.8, 0, 1)));
    const mx = lerp(x0, x1, mk);
    c.fillStyle = acc; c.shadowColor = acc; c.shadowBlur = 18;
    c.beginPath(); c.moveTo(mx, y - 11); c.lineTo(mx + 8, y); c.lineTo(mx, y + 11); c.lineTo(mx - 8, y); c.closePath(); c.fill();
    c.shadowBlur = 0;
    c.strokeStyle = rgba(acc, 0.8); c.lineWidth = 2;
    c.beginPath(); c.moveTo(x0, y); c.lineTo(mx, y); c.stroke();
    c.restore();
  }

  /** Top-right: the chapter we are in, small. */
  private stamp(c: CanvasRenderingContext2D, t: number, ch: ChapterJ) {
    if (!ch.no) return;
    const a = smoothstep(ch.cardEnd + 0.5, ch.cardEnd + 1.6, t) * (1 - smoothstep(ch.end - 1.2, ch.end - 0.3, t)) * 0.75;
    if (a <= 0) return;
    c.save();
    c.globalAlpha = a;
    c.font = font(F.serif(700), 22);
    c.fillStyle = GOLD;
    const label = `${ch.no} · ${ch.title}`;
    this.spaced(c, label, 1856, 74, 6, 'right');
    if (ch.era) { c.font = font(F.sans(500), 16); c.fillStyle = rgba(BONE, 0.7); this.spaced(c, ch.era, 1856, 102, 4, 'right'); }
    c.restore();
  }

  /** Place / subject tags: a gold rule and a name, upper left. */
  private tag(c: CanvasRenderingContext2D, t: number, seg: Segment) {
    if (!seg.tag) return;
    const t0 = seg.start + (seg.shot && seg.shot === seg.chapter.shots[0] ? seg.chapter.cardEnd - seg.start + 0.4 : 0.9);
    const a = smoothstep(t0, t0 + 0.6, t) * (1 - smoothstep(t0 + 5.0, t0 + 6.0, t));
    if (a <= 0) return;
    const acc = EL[seg.chapter.element] ?? GOLD;
    c.save();
    c.globalAlpha = a;
    const grow = ease.outCubic(clamp((t - t0) / 0.9, 0, 1));
    c.strokeStyle = rgba(acc, 0.9); c.lineWidth = 2;
    c.beginPath(); c.moveTo(64, 92); c.lineTo(64, 92 + 54 * grow); c.stroke();
    c.font = font(F.serif(700), 34);
    c.fillStyle = BONE; c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 10;
    this.spaced(c, seg.tag, 84, 134, 6, 'left');
    c.restore();
  }

  /** The journey montage: a ring of the seven nations, lit one by one as the narration reaches each. */
  private journey(c: CanvasRenderingContext2D, t: number, seg: Segment) {
    const sh = seg.shot;
    if (!sh || sh.plate !== 'diagram:journey') return;
    const NAT: [string, string][] = [['蒙德', 'anemo'], ['璃月', 'geo'], ['稻妻', 'electro'], ['须弥', 'dendro'], ['枫丹', 'hydro'], ['纳塔', 'pyro'], ['至冬', 'cryo']];
    const lineNation = [0, 1, 2, 3, 4, 4, 5];
    const a = smoothstep(sh.start, sh.start + 1, t) * (1 - smoothstep(sh.end - 0.8, sh.end + 0.4, t));
    if (a <= 0) return;
    let cur = 0;
    sh.lines.forEach((l, k) => { if (t >= l.start - 0.45) cur = lineNation[k] ?? cur; });
    const cx = 132, cy = 160, R = 52;
    c.save();
    c.globalAlpha = a;
    c.strokeStyle = rgba(GOLD, 0.35); c.lineWidth = 1;
    c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.stroke();
    NAT.forEach(([, el], i) => {
      const ang = -Math.PI / 2 + i * Math.PI * 2 / 7;
      const x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
      const on = i < cur ? 0.55 : i === cur ? 1 : 0.15;
      c.fillStyle = rgba(EL[el]!, on);
      c.shadowColor = EL[el]!; c.shadowBlur = i === cur ? 16 : 0;
      c.beginPath(); c.arc(x, y, i === cur ? 7 : 5, 0, Math.PI * 2); c.fill();
    });
    c.shadowBlur = 0;
    const [name, el] = NAT[cur]!;
    c.font = font(F.serif(700), 34);
    c.fillStyle = BONE; c.shadowColor = 'rgba(0,0,0,0.8)'; c.shadowBlur = 10;
    this.spaced(c, name, cx + R + 34, cy + 12, 8, 'left');
    c.font = font(F.sans(500), 16); c.fillStyle = rgba(EL[el]!, 0.9); c.shadowBlur = 0;
    this.spaced(c, `${cur + 1} / 7`, cx + R + 36, cy + 40, 4, 'left');
    c.restore();
  }

  /** The title card's words (scripts/cover.ts sets the cover's own). */
  titleText = { en: 'A CHRONICLE OF TEYVAT', zh: '提瓦特编年史', sub: '从龙之世，到至冬' };

  private title(c: CanvasRenderingContext2D, t: number) {
    const { start, end } = FILM.title;
    const a = smoothstep(start + 0.3, start + 1.6, t) * (1 - smoothstep(end - 1.4, end - 0.2, t));
    if (a <= 0) return;
    const { en, zh, sub } = this.titleText;
    c.save();
    c.globalAlpha = a;
    c.font = font(F.sans(500), 22);
    c.fillStyle = rgba(GOLD, 0.85);
    this.spaced(c, en, 960, 388, 16);
    const wipe = ease.outCubic(clamp((t - start - 0.6) / 2.2, 0, 1));
    c.font = font(F.serif(900), 140);
    c.letterSpacing = '30px';
    const tw = c.measureText(zh).width - 30;
    c.save(); c.beginPath(); c.rect(960 - tw / 2 - 30, 380, (tw + 60) * wipe, 240); c.clip();
    c.fillStyle = BONE; c.shadowColor = rgba(GOLD, 0.65); c.shadowBlur = 36; c.textAlign = 'left';
    c.fillText(zh, 960 - tw / 2, 548);
    c.restore();
    c.letterSpacing = '0px';
    c.font = font(F.serif(600), 38);
    c.fillStyle = rgba(BONE, 0.8 * smoothstep(start + 2.2, start + 3.2, t));
    this.spaced(c, sub, 960, 640, 18);
    c.restore();
  }

  /** The end card: title, author, every source the chronicle draws on (docs/RESEARCH.md), credits, dedication. */
  private endCard(c: CanvasRenderingContext2D, t: number) {
    const { start, end } = FILM.end;
    const a = smoothstep(start + 0.4, start + 1.8, t) * (1 - smoothstep(end - 1.2, end, t));
    if (a <= 0) return;
    // the block centred on the frame: it starts lower the fewer source lines there are
    const y0 = 250 + (7 - SOURCES.length) * 19;
    c.save();
    c.globalAlpha = a;
    c.font = font(F.serif(900), 76);
    c.fillStyle = BONE; c.shadowColor = rgba(GOLD, 0.6); c.shadowBlur = 30;
    this.spaced(c, '历史仍在书写', 960, y0, 16);
    c.shadowBlur = 0;
    c.font = font(F.sans(500), 22);
    c.fillStyle = rgba(GOLD, 0.8);
    this.spaced(c, '提瓦特编年史 · A CHRONICLE OF TEYVAT', 960, y0 + 56, 8);
    c.font = font(F.serif(700), 32);
    c.fillStyle = BONE;
    this.spaced(c, `作者  ${AUTHOR}`, 960, y0 + 130, 6);
    c.globalAlpha = a * smoothstep(start + 1.4, start + 2.6, t);
    c.font = font(F.sans(500), 20);
    c.fillStyle = rgba(GOLD, 0.85);
    this.spaced(c, '资料来源', 960, y0 + 206, 8);
    c.font = font(F.sans(500), 21);
    c.fillStyle = rgba(BONE, 0.78);
    SOURCES.forEach((s, i) => this.spaced(c, s, 960, y0 + 250 + i * 38, 2));
    const y = y0 + 250 + SOURCES.length * 38 + 30;
    c.fillStyle = rgba(BONE, 0.66);
    this.spaced(c, MAKING, 960, y, 1);
    this.spaced(c, '《原神》及相关设定归 HoYoverse / 米哈游 所有 · 同人编年史', 960, y + 34, 1);
    c.font = font(F.serif(600), 28);
    c.fillStyle = rgba(GOLD, 0.9);
    this.spaced(c, '谨以此片献给所有提瓦特的旅行者', 960, y + 112, 8);
    c.restore();
  }
}
