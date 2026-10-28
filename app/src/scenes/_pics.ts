// Every picture of the film, as code: a sky, up to four silhouette layers, line art behind and in front of the
// land, particles, and (diagrams) labels on the overlay. Times inside a picture come from its segment: `k.lt` is
// seconds since the picture started dissolving in, `k.L(i)` the start of the shot's i-th narration line.
import type { PostOverrides } from '../engine/scene';
import { lin } from '../engine/palette';
import { hexToLinear, clamp, ease, hash, lerp, mulberry32, noise1, smoothstep, fbm1, frameIdx } from '../engine/util';
import { F, font } from '../engine/type';
import type { Cam, Segment } from './_film';
import { project } from './_film';
import type { LandDef, LayerDef, Draw } from './_land';
import type { RGB, SkyParams } from './_sky';
import * as S from './_shapes';
import { Ink, chess, cube, dragon, drawTree, makeTree, mixc, mul, nail, particles, rings, shatter, sigil, spear, tendrils, wyvern, type P2 } from './_art';
import { emblemCol, type Emblem } from './_emblem';

export interface PicCtx {
  t: number; lt: number; seg: Segment; cam: Cam;
  /** this picture's weight in a dissolve (labels fade with it) */
  w: number;
  /** start time of the shot's i-th narration line (absolute) */
  L(i: number): number;
  /** when the narration of this shot says `s` (absolute; its first character's word time), else the shot's start */
  say(s: string): number;
  /** 0..1 eased progress over [a, a + d] (absolute times) */
  at(a: number, d: number): number;
}
export interface PicDef {
  sky: (k: PicCtx) => SkyParams;
  land?: LandDef;
  landDelay?: number[];               // per-layer inscription delays (s)
  back?: (ink: Ink, k: PicCtx) => void;
  art?: (ink: Ink, k: PicCtx) => void;
  /** element emblems (elements.svg), added over the art */
  emblems?: (k: PicCtx) => Emblem[];
  fx?: { kind: string; col: RGB; amount?: number };
  ui?: (c: CanvasRenderingContext2D, k: PicCtx) => void;
  post?: (k: PicCtx) => PostOverrides;
}

const hx = (h: string, k = 1): RGB => { const c = hexToLinear(h); return [c[0] * k, c[1] * k, c[2] * k]; };
const E = {
  gold: lin('gold'), goldHot: lin('goldHot'), bone: lin('bone'), anemo: lin('anemo'), geo: lin('geo'), electro: lin('electro'),
  dendro: lin('dendro'), hydro: lin('hydro'), pyro: lin('pyro'), cryo: lin('cryo'), abyss: lin('abyss'), crimson: lin('crimson'),
};
const ELS: [string, RGB][] = [['anemo', E.anemo], ['geo', E.geo], ['electro', E.electro], ['dendro', E.dendro], ['hydro', E.hydro], ['pyro', E.pyro], ['cryo', E.cryo]];

const LY = (draw: Draw, depth: number, fill: RGB, rim: RGB, o: Partial<LayerDef> = {}): LayerDef => ({ draw, depth, fill, rim, hatch: 0.6, angle: 0.45, fog: 0, ...o });

const night = (o: Partial<SkyParams> = {}): SkyParams => ({
  top: hx('#02040a'), mid: hx('#0a1330'), hor: hx('#1b2a4c'), horY: 760, stars: 1, neb: 0.5, nebA: hx('#2b4ea0', 0.6), nebB: hx('#6b2f8a', 0.5), ...o,
});

// ------------------------------------------------------------------ shared drawings

const IRMIN = makeTree(960, 930, 800, 11, 8);
const IRMIN_SMALL = makeTree(960, 905, 760, 5, 7);
const LUMIN_TREE = makeTree(980, 760, 520, 23, 6, false);
const SAKURA_GLOW = makeTree(1040, 700, 420, 31, 6, false);
const SUMERU_TREE = makeTree(960, 660, 640, 41, 7, false);

/** A spine for something flying along path(t): the last `len` px of its track behind it at time t (s: 0 head .. 1 tail). */
function trail(path: (t: number) => P2, t: number, len: number): (s: number) => P2 {
  const pts: P2[] = [path(t)], cum = [0];
  for (let j = 1; j < 2000 && cum[cum.length - 1]! < len; j++) {
    const p = path(t - j * 0.02), q = pts[pts.length - 1]!;
    pts.push(p); cum.push(cum[cum.length - 1]! + Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return (s) => {
    const d = s * len; let i = 1;
    while (i < pts.length - 1 && cum[i]! < d) i++;
    const k = clamp((d - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!), 0, 1);
    return [lerp(pts[i - 1]![0], pts[i]![0], k), lerp(pts[i - 1]![1], pts[i]![1], k)];
  };
}

const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 64): P2[] =>
  Array.from({ length: n }, (_, i) => [cx + Math.cos(Math.PI * 2 * i / n) * rx, cy + Math.sin(Math.PI * 2 * i / n) * ry] as P2);

/** A robed figure of light, chest at (x, y): head, shoulders, a mantle flaring to the hem at y + 1.05s, folds. */
function robed(ink: Ink, x: number, y: number, s: number, col: RGB, al: number) {
  const c = mul(col, 1.6);
  ink.seg([x, y - 0.55 * s], [x, y + 0.9 * s], 0.34 * s, mul(col, 0.05), al);           // a faint body of light
  ink.dot([x, y - 0.8 * s], 0.08 * s, mul(col, 0.18), al);
  ink.glow(ellipse(x, y - 0.8 * s, 0.085 * s, 0.11 * s, 32), 1.4, c, al, 1, true);
  const side = (sg: number): P2[] => [[x + sg * 0.035 * s, y - 0.69 * s], [x + sg * 0.07 * s, y - 0.63 * s], [x + sg * 0.19 * s, y - 0.58 * s], [x + sg * 0.23 * s, y - 0.46 * s],
    [x + sg * 0.2 * s, y - 0.12 * s], [x + sg * 0.22 * s, y + 0.35 * s], [x + sg * 0.3 * s, y + 0.75 * s], [x + sg * 0.4 * s, y + 1.05 * s]];
  ink.glow(side(-1), 1.5, c, al); ink.glow(side(1), 1.5, c, al);
  const hem: P2[] = [];
  for (let i = 0; i <= 14; i++) { const u = i / 14; hem.push([x + lerp(-0.4, 0.4, u) * s, y + (1.05 + 0.025 * Math.sin(u * Math.PI * 4) + 0.04 * Math.sin(Math.PI * u)) * s]); }
  ink.glow(hem, 1.3, c, al);
  for (const f of [-0.11, 0, 0.12]) ink.poly([[x + f * 0.5 * s, y - 0.1 * s], [x + f * 0.9 * s, y + 0.45 * s], [x + f * 1.7 * s, y + 1.05 * s]], 1, mul(col, 0.8), al * 0.8);
}

/**
 * Phanes, "the Primordial One". The game never shows it; its texts call it the winged one (有翼者, 身披羽翼的降临者),
 * crowned, the lord of the world in the eggshell (蛋壳中的世界之主), the morning star (晨星), the pheasant (雉鸡).
 * Built from those: three pairs of feathered wings, crown and halo, a morning star overhead, barred pheasant plumes
 * for a tail, and the shell of light it breaks out of. `open`: 0 sealed egg .. 1 shell gone, wings spread.
 */
function phanes(ink: Ink, x: number, y: number, s: number, col: RGB, t: number, al = 1, open = 1) {
  const crack = smoothstep(0, 0.2, open), sep = smoothstep(0.15, 0.9, open), lit = lerp(0.3, 1, sep);
  const white: RGB = [1, 0.96, 0.88];
  // the egg: two halves of shell split along a zigzag crack, parting and fading
  const ex = x, ey = y + 0.15 * s, rx = 1.15 * s, ry = 1.6 * s, cy0 = y - 0.1 * s;
  if (sep < 1) {
    const tri = (u: number) => 2 * Math.abs(u - Math.floor(u + 0.5));
    const phc = Math.asin((cy0 - ey) / ry);                                    // the crack meets the shell at phc and π − phc
    const arc = (a0: number, a1: number): P2[] => Array.from({ length: 61 }, (_, i) => { const a = lerp(a0, a1, i / 60); return [ex + Math.cos(a) * rx, ey + Math.sin(a) * ry] as P2; });
    const xr = ex + Math.cos(phc) * rx, xl = ex - Math.cos(phc) * rx;
    const zig: P2[] = []; for (let i = 0; i <= 16; i++) { const px = lerp(xl, xr, i / 16); zig.push([px, cy0 + 0.14 * s * (tri((px - ex) / (0.32 * s)) - 0.5)]); }
    for (const half of [-1, 1]) {
      const pts = half < 0 ? arc(Math.PI - phc, 2 * Math.PI + phc) : arc(phc, Math.PI - phc);
      const off = half < 0 ? -1.3 * s * sep : 0.9 * s * sep, rot = half * 0.22 * sep;
      const mv = (p: P2): P2 => { const dx = p[0] - ex, dy = p[1] - cy0; return [ex + dx * Math.cos(rot) - dy * Math.sin(rot), cy0 + off + dx * Math.sin(rot) + dy * Math.cos(rot)]; };
      const a = al * (1 - sep) ** 1.5;
      ink.glow(pts.map(mv), 1.6, mul(col, 1.5), a);
      ink.poly(pts.map((p) => mv([lerp(ex, p[0], 0.95), lerp(ey, p[1], 0.95)] as P2)), 0.8, mul(col, 0.6), a);
      if (crack > 0) ink.glow(zig.map(mv), 1.4, mul(white, 1 + 3 * crack * (1 - sep)), a * crack);
    }
    ink.dot([x, y], 0.5 * s, mul(col, 0.06 * (1 - sep)), al);
  }
  // the wings: a bone arcing out from the shoulder, coverts along it, flight feathers sweeping toward the tip
  const tiers = [{ ang: -0.62, span: 1.8, n: 12, dy: 0 }, { ang: -0.12, span: 2.2, n: 14, dy: 0.22 }, { ang: 0.45, span: 1.6, n: 10, dy: 0.44 }];
  const VANE = [0, 0.06, 0.16, 0.3, 0.45, 0.6, 0.74, 0.86, 0.94, 1], vane = (v: number) => Math.sin(Math.PI * v ** 0.75) ** 0.7;
  tiers.forEach((tr, ti) => {
    const u = ease.inOutCubic(clamp((open - 0.3 - ti * 0.1) / 0.45, 0, 1));
    if (u <= 0) return;
    const ang = lerp(1.35, tr.ang, u) + Math.sin(t * 0.9 + ti * 0.8) * 0.05 * u, span = tr.span * s * lerp(0.45, 1, u);
    const spread = 0.15 + 0.85 * u, a = al * lit * (0.95 - ti * 0.12);
    for (const side of [-1, 1]) {
      const X = (px: number, py: number): P2 => [x + side * px, py];            // built for the right wing, mirrored
      const r0: P2 = [0.14 * s, y - 0.5 * s + tr.dy * s];
      const c0: P2 = [r0[0] + Math.cos(ang - 0.35) * span * 0.55, r0[1] + Math.sin(ang - 0.35) * span * 0.55];
      const tp: P2 = [r0[0] + Math.cos(ang + 0.1) * span, r0[1] + Math.sin(ang + 0.1) * span];
      const B = (v: number): P2 => [(1 - v) ** 2 * r0[0] + 2 * (1 - v) * v * c0[0] + v * v * tp[0], (1 - v) ** 2 * r0[1] + 2 * (1 - v) * v * c0[1] + v * v * tp[1]];
      const bone: P2[] = []; for (let i = 0; i <= 16; i++) bone.push(X(...B(i / 16)));
      ink.glow(bone, 1.6, mul(col, 1.5), a);
      for (let i = 0; i < tr.n; i++) {
        const v = 0.16 + 0.84 * i / (tr.n - 1), b = B(v), h = hash(i, ti * 7 + 3);
        const fa = ang + (Math.PI / 2 - v * 1.25) * spread, L = span * (0.3 + 0.5 * v ** 1.3) * (0.92 + 0.12 * h);
        const fx = Math.cos(fa), fy = Math.sin(fa), qx = -fy, qy = fx, wf = L * 0.075;
        const F = (al_: number, ac: number): P2 => X(b[0] + fx * L * al_ + qx * ac - qx * Math.sin(Math.PI * al_) * L * 0.05, b[1] + fy * L * al_ + qy * ac - qy * Math.sin(Math.PI * al_) * L * 0.05);
        const outline = [...VANE.map((v) => F(v, wf * 0.65 * vane(v))), ...VANE.slice(1, -1).reverse().map((v) => F(v, -wf * vane(v)))];
        const fc = mixc(mul(col, 1.1), mul(white, 1.4), v * 0.5);
        ink.glow(outline, 0.9, fc, a, 1, true);
        ink.seg(F(0.02, 0), F(0.9, 0), 0.7, mul(fc, 0.6), a);
      }
      for (let v = 0.06; v < 0.86; v += 0.075) {                               // coverts: a scalloped row under the bone
        const b = B(v), fa = ang + (Math.PI / 2 - v * 0.9) * spread, L = span * 0.15;
        const fx = Math.cos(fa), fy = Math.sin(fa), qx = -fy, qy = fx;
        ink.poly([X(b[0] + qx * L * 0.25, b[1] + qy * L * 0.25), X(b[0] + fx * L * 0.8 + qx * L * 0.18, b[1] + fy * L * 0.8 + qy * L * 0.18), X(b[0] + fx * L, b[1] + fy * L), X(b[0] + fx * L * 0.8 - qx * L * 0.18, b[1] + fy * L * 0.8 - qy * L * 0.18), X(b[0] - qx * L * 0.25, b[1] - qy * L * 0.25)], 0.9, mul(col, 1.2), a * 0.85);
      }
    }
  });
  // pheasant plumes: long tail feathers trailing from the hem, fanned, curling at the ends, barred with chevrons
  const tl = al * sep;
  if (tl > 0.01) for (let i = 0; i < 5; i++) {
    const k = i - 2, Lp = s * (1.5 + 0.8 * (1 - Math.abs(k) / 2)) * lerp(0.5, 1, sep), n = 30;
    const C: P2[] = [], nr: P2[] = [];
    for (let j = 0; j <= n; j++) {
      const v = j / n, curl = smoothstep(0.55, 1, v) ** 2 * (k === 0 ? 0.12 : Math.sign(k) * 0.24) * s;
      C.push([x + k * 0.05 * s + k * 0.22 * s * v ** 1.4 + curl + Math.sin(t * 0.7 + i * 1.3 + v * 3) * 0.1 * s * v, y + 1.02 * s + v * Lp]);
    }
    for (let j = 0; j <= n; j++) { const p = C[Math.max(0, j - 1)]!, q = C[Math.min(n, j + 1)]!, L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; nr.push([-(q[1] - p[1]) / L, (q[0] - p[0]) / L]); }
    const hw = (j: number) => 0.04 * s * Math.sin(Math.PI * Math.min(1, j / n * 1.04) ** 0.55);
    const Lft = C.map((p, j) => [p[0] + nr[j]![0] * hw(j), p[1] + nr[j]![1] * hw(j)] as P2), Rgt = C.map((p, j) => [p[0] - nr[j]![0] * hw(j), p[1] - nr[j]![1] * hw(j)] as P2);
    ink.glow([...Lft, ...[...Rgt].reverse()], 0.9, mul(col, 1.2), tl, 1, true);
    ink.poly(C, 0.6, mul(col, 0.7), tl);
    for (let j = 4; j < n - 1; j += 3) ink.poly([Lft[j]!, C[j + 1]!, Rgt[j]!], 0.8, mul(j % 2 ? white : col, 0.9), tl * 0.7);
  }
  robed(ink, x, y, s, col, al * lit);
  // halo, crown, and the morning star above it
  const hy = y - 0.8 * s, ha = al * sep;
  ink.circle(x, hy, 0.3 * s, 1.1, mul(col, 1.3), ha);
  ink.circle(x, hy, 0.38 * s, 0.8, mul(col, 0.8), ha, 1, 120, t * 0.05);
  for (let i = 0; i < 36; i++) { const a = t * 0.05 + i * Math.PI * 2 / 36, l = i % 3 === 0 ? 0.05 : 0.025; ink.seg([x + Math.cos(a) * 0.38 * s, hy + Math.sin(a) * 0.38 * s], [x + Math.cos(a) * (0.38 + l) * s, hy + Math.sin(a) * (0.38 + l) * s], 0.8, mul(col, 0.9), ha); }
  const cr: P2[] = [[x - 0.095 * s, y - 0.87 * s]];
  [[-0.075, 0.07], [-0.0375, 0.11], [0, 0.155], [0.0375, 0.11], [0.075, 0.07]].forEach(([cx, h], i, arr) => {
    cr.push([x + cx! * s, y - (0.89 + h!) * s]);
    if (i < arr.length - 1) cr.push([x + (cx! + 0.019) * s, y - 0.9 * s]);
    ink.dot([x + cx! * s, y - (0.89 + h!) * s], 0.012 * s + 1, mul(white, 3), al * lit);
  });
  cr.push([x + 0.095 * s, y - 0.87 * s]);
  ink.glow(cr, 1.3, mul(col, 2), al * lit);
  ink.poly([[x - 0.095 * s, y - 0.87 * s], [x, y - 0.85 * s], [x + 0.095 * s, y - 0.87 * s]], 1.2, mul(col, 2), al * lit);
  const sy = y - 1.3 * s, tw = 0.8 + 0.2 * Math.sin(t * 2.3);
  for (const [ddx, ddy, l] of [[0, -1, 0.3], [0, 1, 0.3], [-1, 0, 0.2], [1, 0, 0.2]] as [number, number, number][]) {
    ink.seg([x, sy], [x + ddx * l * s * 0.5, sy + ddy * l * s * 0.5], 2.2, mul(white, 2.5 * tw), ha);
    ink.seg([x + ddx * l * s * 0.5, sy + ddy * l * s * 0.5], [x + ddx * l * s, sy + ddy * l * s], 1, mul(white, 1.8 * tw), ha);
  }
  ink.dot([x, sy], 0.03 * s + 1.5, mul(white, 4 * tw), ha);
}

/**
 * The Sustainer of Heavenly Principles (Asmoday) as the game shows her: no wings; long pale hair streaming behind,
 * and a great geometric halo of rings and turning square frames behind her head.
 */
function sustainer(ink: Ink, x: number, y: number, s: number, col: RGB, t: number, al = 1) {
  const hy = y - 0.8 * s;
  for (const [r, w, k] of [[0.55, 1.2, 1.3], [0.63, 0.8, 0.8], [0.95, 0.8, 0.6]] as [number, number, number][]) ink.circle(x, hy, r * s, w, mul(col, k), al, 1, 120, t * 0.03);
  for (const [a0, r] of [[t * 0.12, 0.62], [-t * 0.09 + Math.PI / 4, 0.62], [t * 0.05 + Math.PI / 8, 0.9]] as [number, number][]) {
    ink.glow([0, 1, 2, 3].map((i) => [x + Math.cos(a0 + i * Math.PI / 2) * r * s, hy + Math.sin(a0 + i * Math.PI / 2) * r * s] as P2), 1.1, mul(col, 1.1), al * 0.8, 1, true);
  }
  for (let i = 0; i < 12; i++) {
    const a = -t * 0.06 + i * Math.PI / 6, cx = x + Math.cos(a) * 0.95 * s, cy = hy + Math.sin(a) * 0.95 * s, d = 0.035 * s;
    ink.poly([[cx, cy - d], [cx + d * 0.6, cy], [cx, cy + d], [cx - d * 0.6, cy], [cx, cy - d]], 1, mul(col, 1.8), al);
  }
  for (let i = 0; i < 9; i++) {                                                  // hair: strands streaming down and aside
    const k = (i - 4) / 4, pts: P2[] = [];
    for (let j = 0; j <= 14; j++) { const v = j / 14; pts.push([x + k * 0.07 * s + k * 0.35 * s * v + Math.sin(t * 0.8 + i + v * 3) * 0.06 * s * v, hy - 0.06 * s + v * (0.9 + 0.25 * (1 - Math.abs(k))) * s]); }
    ink.poly(pts, 1, mul([1, 0.98, 0.95], 1.4), al * 0.7);
  }
  robed(ink, x, y, s, col, al);
}

/** A bolt of lightning between two points, re-forked every few frames. */
function bolt(ink: Ink, a: P2, b: P2, col: RGB, seed: number, al = 1, w = 1.6) {
  const rnd = mulberry32(seed);
  const pts: P2[] = [a];
  const n = 14;
  for (let i = 1; i < n; i++) {
    const u = i / n;
    pts.push([lerp(a[0], b[0], u) + (rnd() - 0.5) * 90 * Math.sin(Math.PI * u), lerp(a[1], b[1], u) + (rnd() - 0.5) * 30]);
  }
  pts.push(b);
  ink.glow(pts, w, col, al);
  for (let f = 0; f < 3; f++) {
    const i = 2 + Math.floor(rnd() * (n - 4));
    const p = pts[i]!;
    const q: P2 = [p[0] + (rnd() - 0.5) * 220, p[1] + 60 + rnd() * 140];
    ink.poly([p, [lerp(p[0], q[0], 0.5) + (rnd() - 0.5) * 40, lerp(p[1], q[1], 0.5)], q], w * 0.6, col, al * 0.7);
  }
}

/** A flock of birds (white doves): little V strokes flapping along a drift. */
function birds(ink: Ink, x: number, y: number, n: number, t: number, col: RGB, spread = 300, seed = 1, al = 1) {
  for (let i = 0; i < n; i++) {
    const h = hash(i, seed), g = hash(i, seed + 1);
    const bx = x + (h - 0.5) * spread + t * (30 + 20 * g), by = y + (g - 0.5) * spread * 0.4 - t * 8 + Math.sin(t * 0.9 + i) * 8;
    const s = 6 + 6 * g, f = Math.sin(t * 7 + i * 1.7) * 0.6;
    ink.poly([[bx - s, by - s * f], [bx, by + s * 0.2], [bx + s, by - s * f]], 1.1, col, al);
  }
}

/** A sweeping ring of wind lines around (x, y). */
function windRing(ink: Ink, x: number, y: number, rx: number, ry: number, t: number, col: RGB, n = 18, al = 1) {
  for (let i = 0; i < n; i++) {
    const h = hash(i, 9);
    const a0 = t * (0.8 + h * 0.6) + h * 20;
    const len = 0.8 + h * 1.2;
    const pts: P2[] = [];
    for (let k = 0; k <= 20; k++) {
      const a = a0 + len * k / 20;
      const r = 1 + 0.12 * Math.sin(a * 3 + i);
      pts.push([x + Math.cos(a) * rx * r, y + Math.sin(a) * ry * r - (h - 0.5) * ry * 1.4]);
    }
    ink.poly(pts, 0.9 + h, col, al * (0.3 + 0.5 * h), 1, false, 1.3);
  }
}

/** Rising lights (lanterns, sparks of a festival). */
function lanterns(ink: Ink, n: number, t: number, col: RGB, x0: number, x1: number, yb: number, seed = 4, al = 1) {
  for (let i = 0; i < n; i++) {
    const h = hash(i, seed), g = hash(i, seed + 1), d = 0.4 + 0.6 * hash(i, seed + 2);
    const life = ((t * (0.035 + 0.03 * g) + h) % 1);
    const x = lerp(x0, x1, hash(i, seed + 3)) + Math.sin(t * 0.4 + i) * 20 + life * 60;
    const y = yb - life * 900 * d;
    ink.d = d;
    ink.dot([x, y], 2.2 * d + 1, mul(col, 1.4 + g), al * smoothstep(0, 0.1, life) * (1 - smoothstep(0.75, 1, life)));
  }
  ink.d = 1;
}

/** Concentric expanding shock rings at time te. */
function shock(ink: Ink, x: number, y: number, t: number, te: number, col: RGB, max = 900) {
  if (t < te) return;
  for (let k = 0; k < 3; k++) {
    const u = clamp((t - te - k * 0.25) / 2.2, 0, 1);
    if (u <= 0 || u >= 1) continue;
    const r = ease.outCubic(u) * max;
    ink.circle(x, y, r, 2.2 * (1 - u) + 0.6, mul(col, 2 * (1 - u)), 1 - u, 1, 160);
  }
}

const arcPts = (cx: number, cy: number, r: number, a0: number, a1: number, n = 120): P2[] =>
  Array.from({ length: n + 1 }, (_, j) => { const a = lerp(a0, a1, j / n); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as P2; });

/**
 * The four cycles of the Narcissenkreuz Ordo (the plaque of its tower, 自体自身之塔; the tower's keys, 根源之轮, fit
 * together in "three and a half rings"): Hyperborea innermost, Natlantean, Remuria, and Khraun-Arya, the fourth, only
 * half way round. Each ring lights as the narration names it, its meaning as that is said (`key`); `ang` is where
 * its label's leader leaves the ring.
 */
const CYC_C: P2 = [960, 520];
const CYCLES = [
  { name: '亥珀波瑞亚', en: 'Hyperborea', mean: '失乐园', key: '失乐园', r: 92, col: E.cryo, css: '#A9E6F4', ang: -2.62 },
  { name: '纳塔兰提亚', en: 'Natlantean', mean: '战胜恶龙', key: '战胜恶龙', r: 170, col: E.pyro, css: '#FF7240', ang: 2.62 },
  { name: '雷穆利亚', en: 'Remuria', mean: '原罪与洗礼', key: '原罪', r: 248, col: E.hydro, css: '#4DB6F5', ang: -0.52 },
  { name: '克劳雅利亚', en: 'Khraun-Arya', mean: '从神那里获得自由', key: '获得自由', r: 326, col: E.goldHot, css: '#E9C47E', ang: 0.52 },
];
/** A cycle's label leader: from its ring, out along `ang`, then level to the label. */
function cycleLeader(i: number): [P2, P2, P2] {
  const c = CYCLES[i]!, [cx, cy] = CYC_C, ca = Math.cos(c.ang), sa = Math.sin(c.ang);
  const e: P2 = [cx + ca * 380, cy + sa * 380];
  return [[cx + ca * c.r, cy + sa * c.r], e, [e[0] + Math.sign(ca) * 70, e[1]]];
}

/**
 * The heavens split the wild light realm force (光界力) into the seven elements: 纳西妲 in 「幽暗时分」 (「天理」降临后，
 * 使光界力化分为元素力); 夜神 in 「秘源之下」 likens it to light refracted into the rainbow's seven colours. A prism at
 * PRISM, the seven beams fanned over PRISM_SPREAD, in ELS order (the narration names them in that order).
 */
const PRISM: P2 = [700, 540];
const PRISM_SPREAD = 0.6;
const EL_ZH = ['风', '岩', '雷', '草', '水', '火', '冰'];
const prismAng = (i: number) => lerp(-PRISM_SPREAD, PRISM_SPREAD, i / 6);

// ------------------------------------------------------------------ the pictures

export const PICS: Record<string, PicDef> = {
  // ================================================================ prologue
  'diagram:tree': {
    sky: () => night({ top: hx('#010207'), mid: hx('#040a18'), hor: hx('#06152a'), horY: 900, stars: 0.6, neb: 0.35, nebA: hx('#1d6b7a', 0.5), nebB: hx('#28356e', 0.4) }),
    art: (ink, k) => {
      const g = smoothstep(0.8, 10.5, k.lt);
      drawTree(ink, IRMIN_SMALL, g, mul(E.dendro, 1.0), mixc(E.anemo, E.goldHot, 0.4), k.t);
      // ley lines: roots spreading along the ground into the dark
      for (let i = 0; i < 14; i++) {
        const h = hash(i, 3), side = i % 2 ? 1 : -1;
        const pts: P2[] = [];
        for (let s = 0; s <= 30; s++) {
          const u = s / 30;
          pts.push([960 + side * u * (500 + 500 * h), 905 + u * (40 + 80 * hash(i, 5)) + Math.sin(u * 9 + i) * 10 * u]);
        }
        ink.poly(pts, 1.0, mul(E.anemo, 0.9), 0.7, smoothstep(2 + h * 2, 9 + h * 2, k.lt), false, 2);
      }
    },
    fx: { kind: 'motes', col: mixc(E.anemo, E.gold, 0.3), amount: 0.6 },
  },
  irminsul: {
    sky: (k) => night({ top: hx('#020610'), mid: hx('#062031'), hor: hx('#0d3a48'), horY: 820, stars: 1, neb: 0.8, nebA: hx('#1f8a8f', 0.55), nebB: hx('#2d3f8f', 0.5), glow: [960, 520, 340], glowCol: hx('#57d6c8', 0.25 + 0.05 * Math.sin(k.t)) }),
    back: (ink, k) => {
      ink.d = 0.6; drawTree(ink, IRMIN, 1, mul(E.anemo, 1.25), mixc(E.anemo, E.goldHot, 0.5), k.t);
      // 「从世界之外到来的存在」: lights fall from beyond the sky through the tree and leave nothing behind
      ink.d = 0.4;
      const fall = (x0: number, x1: number, te: number, col: RGB) => {
        const u = k.at(te, 3.4);
        if (u <= 0 || u >= 1) return;
        const tail: P2[] = [];
        for (let s = 0; s <= 14; s++) { const v = Math.max(0, u - s * 0.03); tail.push([lerp(x0, x1, v), lerp(-60, 960, ease.inQuad(v))]); }
        const a = smoothstep(0, 0.08, u) * (1 - smoothstep(0.82, 1, u));
        ink.glow(tail, 2.2, col, 0.85 * a);
        ink.dot(tail[0]!, 5, mul(col, 3), a);
      };
      fall(260, 780, k.L(2) + 2.4, mul(E.goldHot, 1.6));
      fall(1720, 1180, k.L(2) + 3.6, mul(E.cryo, 1.6));
      fall(1180, 1560, k.L(3) + 1.0, mul(E.abyss, 2.2));
      ink.d = 1;
    },
    land: { layers: [
      LY((c) => S.ridge(c, 900, 160, 260, 3, 0.7), 0.5, hx('#06131c'), hx('#3fbfb0', 0.7), { fog: 0.45 }),
      LY((c) => S.ridge(c, 1010, 140, 340, 7, 0.55), 0.85, hx('#03080d'), hx('#58e0c8', 0.9), { fog: 0.1 }),
    ] },
    fx: { kind: 'motes', col: mixc(E.anemo, E.goldHot, 0.35), amount: 1 },
  },
  title: {
    sky: () => night({ top: hx('#010207'), mid: hx('#050b1c'), hor: hx('#0a1830'), horY: 900, stars: 1, milky: 0.8, neb: 0.4 }),
    back: (ink, k) => { ink.d = 0.5; ink.fade = 0.35; drawTree(ink, IRMIN, 1, mul(E.anemo, 0.8), E.gold, k.t); ink.fade = 1; ink.d = 1; },
    art: (ink, k) => { rings(ink, 960, 520, 430, mul(E.gold, 0.9), 0.6, k.t, smoothstep(0, 2.5, k.lt)); rings(ink, 960, 520, 300, mul(E.gold, 0.6), 0.35, -k.t, smoothstep(0.5, 3, k.lt)); },
    fx: { kind: 'motes', col: E.gold, amount: 0.6 },
  },

  // ================================================================ I dragons
  dragons: {
    sky: () => ({ top: hx('#0b0614'), mid: hx('#3a0f22'), hor: hx('#d0542a', 1.1), horY: 720, neb: 0.6, nebA: hx('#ff6a3a', 0.35), nebB: hx('#7a2a6a', 0.35), stars: 0.25, glow: [1300, 700, 260], glowCol: hx('#ff8a3a', 0.6), rays: 0.6, clouds: 0.5, cloudY: 600, cloudCol: hx('#1a0710'), cloudLit: hx('#ff7a3a', 0.8) }),
    land: { layers: [
      LY((c) => S.ridge(c, 790, 220, 230, 11, 0.85), 0.45, hx('#1a0a0e'), hx('#ff7a3a', 0.6), { fog: 0.55 }),
      LY((c) => { S.ridge(c, 900, 160, 300, 4, 0.7); S.volcano(c, 1320, 905, 420, 330, 2); }, 0.75, hx('#0c0508'), hx('#ff6a30', 0.9), { fog: 0.2 }),
      LY((c) => S.ridge(c, 1050, 120, 380, 9, 0.5), 1, hx('#040204'), hx('#ff8a40', 0.8)),
    ], light: [1300, 700] },
    art: (ink, k) => {
      ELS.forEach(([, col], i) => {
        const ph = i * 0.9, sc = 0.75 + 0.75 * hash(i, 2), y0 = 150 + i * 70;
        const speed = 70 + 18 * i;
        const head = ((k.lt * speed + i * 520) % 3600) - 500;
        ink.d = 0.45 + 0.55 * sc;
        dragon(ink, (s) => [head - s * 640 * sc, y0 + Math.sin(k.t * 0.7 + ph + s * 4) * 50 * sc * s + s * 30], mul(col, 1.3), { reveal: smoothstep(0.5 + i * 0.3, 2.5 + i * 0.3, k.lt), flap: Math.sin(k.t * 1.6 + ph * 2), side: true });
      });
      ink.d = 1;
    },
    fx: { kind: 'embers', col: E.pyro, amount: 0.8 },
  },
  primordial: {
    sky: () => ({ top: hx('#071019'), mid: hx('#1c3a3a'), hor: hx('#e8b46a', 0.9), horY: 640, neb: 0.3, nebA: hx('#8ad8a8', 0.3), nebB: hx('#e8c47e', 0.3), glow: [700, 610, 300], glowCol: hx('#ffd08a', 0.7), rays: 0.5, seaY: 650, seaCol: hx('#1f5b5a'), clouds: 0.35, cloudY: 540, cloudCol: hx('#2a3a30'), cloudLit: hx('#ffc070', 0.6) }),
    land: { layers: [
      LY((c, r) => { c.beginPath(); c.moveTo(1120, 712); c.quadraticCurveTo(1300, 682, 1600, 690); c.lineTo(2120, 686); c.lineTo(2120, 720); c.closePath(); c.fill(); for (let i = 0; i < 9; i++) S.fern(c, 1250 + i * 85, 700, 90 + r() * 70, r, 40 + r() * 60); }, 0.55, hx('#0d201c'), hx('#a8e08a', 0.6), { fog: 0.45 }),
      LY((c, r) => { S.fern(c, 470, 980, 330, r, 380); for (let i = 0; i < 7; i++) S.fern(c, 60 + i * 95, 1010, 130 + r() * 70, r); for (let i = 0; i < 5; i++) S.fern(c, 1500 + i * 110, 1010, 120 + r() * 60, r); S.ground(c, 990, 14, 4); }, 0.95, hx('#04100c'), hx('#b8f08a', 0.95)),
    ], light: [700, 600] },
    art: (ink, k) => { ink.d = 0.95; ink.fade = 0.6; drawTree(ink, LUMIN_TREE.map((b) => ({ ...b, a: [b.a[0] - 460, b.a[1] + 200] as P2, b: [b.b[0] - 460, b.b[1] + 200] as P2 })), smoothstep(1, 7, k.lt), mul(E.dendro, 0.9), E.goldHot, k.t); ink.fade = 1; ink.d = 1; },
    fx: { kind: 'motes', col: mixc(E.dendro, E.goldHot, 0.5), amount: 1 },
  },
  tower: {
    sky: () => night({ top: hx('#010208'), mid: hx('#081232'), hor: hx('#2a2a48'), horY: 820, stars: 1.4, milky: 1, milkyAngle: -0.9, neb: 0.4 }),
    land: { layers: [
      LY((c) => S.ridge(c, 860, 200, 260, 14, 0.8), 0.5, hx('#070a14'), hx('#6a8ad8', 0.5), { fog: 0.4 }),
      LY((c) => { S.pyramid(c, 960, 930, 520, 230, 7); S.ground(c, 925, 6, 1); }, 0.85, hx('#05060c'), hx('#f2b54a', 0.9)),
    ] },
    art: (ink, k) => {
      ink.d = 0.85;
      const top = -700, base = 700;
      ink.glow([[960, base], [960, top]], 2, mul(E.goldHot, 1.4), 1, smoothstep(0.5, 4, k.lt));
      ink.poly([[952, base], [952, top]], 0.8, mul(E.gold, 0.6), 0.7, smoothstep(0.5, 4, k.lt));
      ink.poly([[968, base], [968, top]], 0.8, mul(E.gold, 0.6), 0.7, smoothstep(0.5, 4, k.lt));
      for (let i = 0; i < 8; i++) { const u = (k.t * 0.07 + i / 8) % 1; ink.dot([960, lerp(base, top, u)], 3, mul(E.goldHot, 3), smoothstep(3, 5, k.lt)); }
      // the orbital ring
      const ry = 60, rx = 700, yc = 120;
      const pts: P2[] = Array.from({ length: 121 }, (_, i) => { const a = i / 120 * Math.PI * 2; return [960 + Math.cos(a) * rx, yc + Math.sin(a) * ry] as P2; });
      ink.glow(pts, 1.2, mul(E.gold, 1.2), 0.8, smoothstep(3, 7, k.lt));
      ink.d = 1;
    },
    fx: { kind: 'stars', col: E.bone, amount: 0.5 },
  },
  moons: {
    sky: (k) => night({ top: hx('#01030a'), mid: hx('#0a1838'), hor: hx('#33507a'), horY: 760, stars: 1, neb: 0.4, aurora: 0.6, auroraA: hx('#5fd6b8'), auroraB: hx('#8a6cf0'),
      moons: [{ x: 620, y: 300, r: 120, col: hx('#f4f0e6', 1.1) }, { x: 1180, y: 210, r: 78, col: hx('#bfe6ff', 1.0), maria: 0.6 }, { x: 1530, y: 380, r: 92, col: hx('#e8e0ff', 1.0), iri: 0.45 }],
      seaY: 770, seaCol: hx('#0c2440') }),
    land: { layers: [
      LY((c, r) => S.iceShelves(c, 800, r), 0.7, hx('#0a1626'), hx('#a9e6f4', 0.8), { fog: 0.3, hatch: 0.4 }),
      LY((c, r) => { S.iceShelves(c, 950, r); S.ground(c, 1020, 6, 3); }, 1, hx('#060d18'), hx('#c8f0ff', 0.9)),
    ] },
    art: (ink, k) => {
      // Nibelung leaving: a far dragon climbing toward the stars
      const u = smoothstep(k.L(1) - 1, k.L(1) + 6, k.t);
      ink.d = 0.3;
      dragon(ink, (s) => [1200 + 300 * u - s * 220 * (1 - 0.5 * u), 520 - 560 * u + s * 100 * (1 - 0.5 * u) + Math.sin(k.t + s * 4) * 10 * s], mul(E.bone, 1.4), { al: 1 - smoothstep(0.8, 1, u), flap: Math.sin(k.t * 2.2), side: true });
      ink.d = 1;
    },
    fx: { kind: 'stars', col: E.bone, amount: 0.4 },
  },

  // ================================================================ II doves
  descent: {
    sky: (k) => ({ top: hx('#04050c'), mid: hx('#1c1a30'), hor: hx('#b89a60', 0.7), horY: 820, neb: 0.4, nebA: hx('#e8c47e', 0.3), nebB: hx('#6a5aa0', 0.3), stars: 0.4,
      glow: [960, 330, 200 + 50 * smoothstep(0, 6, k.lt)], glowCol: hx('#ffe6b0', 0.45), rays: 0.55, clouds: 0.8, cloudY: 760, cloudCol: hx('#141020'), cloudLit: hx('#ffe0a0', 0.7), crack: 0.12 * smoothstep(0, 4, k.lt), crackCol: hx('#ffe6b0', 0.8) }),
    art: (ink, k) => {
      // an egg of light comes down; it breaks open on 「一位来自世界之外的存在降临了」
      const y = lerp(80, 330, ease.outCubic(smoothstep(0, 8, k.lt)));
      phanes(ink, 960, y, 150, E.goldHot, k.t, smoothstep(0.3, 2.5, k.lt), k.at(k.L(2) - 0.5, 6));
      ink.d = 0.8;
      for (let i = 0; i < 3; i++) cube(ink, 960, y, 260 + i * 70, k.t * (0.12 + i * 0.05) + i, 0.4 + i * 0.3, mul(E.gold, 0.7), 0.35 * smoothstep(1, 4, k.lt));
      ink.d = 1;
      birds(ink, 300, 640, 14, k.lt, mul(E.bone, 1.6), 380, 3, smoothstep(2, 4, k.lt));
      birds(ink, 1300, 560, 10, k.lt, mul(E.bone, 1.4), 300, 8, smoothstep(3, 5, k.lt));
    },
    fx: { kind: 'gold', col: E.gold, amount: 0.8 },
  },
  'diagram:shades': {
    sky: () => night({ top: hx('#03040a'), mid: hx('#141428'), hor: hx('#3a3050'), horY: 900, stars: 0.8, neb: 0.4, nebA: hx('#e8c47e', 0.25), nebB: hx('#4a3a8a', 0.3), glow: [960, 500, 160], glowCol: hx('#ffe6b0', 0.5) }),
    art: (ink, k) => {
      const shades: [string, number, number][] = [['life', 560, 330], ['death', 1360, 330], ['time', 560, 730], ['space', 1360, 730]];
      rings(ink, 960, 530, 150, mul(E.gold, 0.8), 0.6, k.t, smoothstep(0, 2, k.lt));
      ink.dot([960, 530], 10, mul(E.goldHot, 3), 1);
      shades.forEach(([s, x, y], i) => {
        const a = k.at(k.L(1) + i * 1.25, 1.2);
        ink.poly([[960, 530], [x, y]], 1, mul(E.gold, 0.8), 0.6, a, false, 2);
        sigil(ink, s, x, y, 92, mul(E.goldHot, 1.2), 1, a, k.t);
      });
    },
    ui: (c, k) => {
      const names: [string, string, number, number][] = [['生之执政', '纳贝里士', 560, 470], ['死之执政', '若娜瓦', 1360, 470], ['时之执政', '伊斯塔露', 560, 870], ['空之执政', '阿斯莫代', 1360, 870]];
      names.forEach(([a, b, x, y], i) => {
        const al = k.at(k.L(1) + i * 1.25 + 0.4, 0.8);
        if (al <= 0) return;
        c.globalAlpha = al * k.w; c.textAlign = 'center';
        c.font = font(F.serif(700), 30); c.fillStyle = '#EEE6D3'; c.fillText(b, x, y);
        c.font = font(F.sans(500), 18); c.fillStyle = '#E9C47E'; c.fillText(a, x, y + 30);
        c.globalAlpha = 1;
      });
    },
    fx: { kind: 'gold', col: E.gold, amount: 0.4 },
  },
  war: {
    sky: (k) => ({ top: hx('#0a0408'), mid: hx('#4a1010'), hor: hx('#ff6a2a', 1.2), horY: 760, neb: 0.7, nebA: hx('#ff5020', 0.4), nebB: hx('#ffe0a0', 0.3), glow: [960, 760, 400], glowCol: hx('#ff8a40', 0.5), rays: 0.4,
      clouds: 0.7, cloudY: 330, cloudCol: hx('#120406'), cloudLit: hx('#ff8040', 1), seaY: 780, seaCol: hx('#3a1008'), seaLines: 0.5, crack: 0 * k.t }),
    art: (ink, k) => {
      for (let i = 0; i < 3; i++) {
        const ph = i * 2.1, path = (tt: number): P2 => [960 + Math.cos(tt * 0.25 + ph) * 520, 360 + Math.sin(tt * 0.4 + ph) * 120];
        dragon(ink, trail(path, k.t, 330 + 90 * i), mul(ELS[i * 2]![1], 1.4), { flap: Math.sin(k.t * 2 + i * 1.7), side: true });
      }
      const shades: P2[] = [[420, 200], [760, 120], [1180, 140], [1520, 220]];
      shades.forEach((p, i) => {
        ink.dot(p, 7, mul(E.goldHot, 4), 1);
        ink.circle(p[0], p[1], 22 + 4 * Math.sin(k.t * 3 + i), 1.2, mul(E.goldHot, 2), 0.8);
        // lances of light striking down
        const f = frameIdx(k.t) % 40 < 6 ? 1 : 0;
        const tgt: P2 = [p[0] + 200 * Math.sin(i * 2 + Math.floor(k.t / 0.66)), 520 + 120 * Math.cos(i + Math.floor(k.t / 0.66))];
        ink.glow([p, tgt], 2.2, mul(E.goldHot, 2.5), 0.5 + 0.5 * f);
      });
    },
    fx: { kind: 'embers', col: E.pyro, amount: 1.4 },
    post: () => ({ bloom: 0.75 }),
  },
  'diagram:prism': {
    sky: () => night({ top: hx('#02030a'), mid: hx('#100f26'), hor: hx('#2e2a44'), horY: 900, stars: 0.8, neb: 0.45, nebA: hx('#e8c47e', 0.22), nebB: hx('#4a3a8a', 0.3) }),
    art: (ink, k) => {
      const [px, py] = PRISM;
      const base = k.at(k.seg.start + 0.3, 1.5);
      // the light realm force: five strands twisting round one another and flickering, narrowing into the prism
      const reach = k.at(k.say('光界力') - 0.6, 1.6);
      for (let s = 0; s < 5; s++) {
        const pts: P2[] = [];
        for (let j = 0; j <= 60; j++) {
          const u = j / 60, x = lerp(60, px, u);
          pts.push([x, py + lerp(70, 5, u ** 1.5) * fbm1(x * 0.006 - k.t * (0.9 + s * 0.2), 3, 40 + s)]);
        }
        const flick = 0.6 + 0.4 * noise1(k.t * 7 + s * 3, 9);
        ink.glow(pts, 1.2 + 0.4 * (s % 2), mul(s % 2 ? E.bone : E.goldHot, 1.6), 0.55 * flick * base, reach);
      }
      // the prism: a triangle of light in the heavens' rings, flaring as the force is split (「化分」)
      const tri = (r: number, a0: number): P2[] => [0, 1, 2].map((i) => [px + Math.cos(a0 + i * Math.PI * 2 / 3) * r, py + Math.sin(a0 + i * Math.PI * 2 / 3) * r] as P2);
      ink.glow(tri(70, -Math.PI / 2), 1.4, mul(E.goldHot, 1.4), 0.9 * base, 1, true);
      ink.poly(tri(84, Math.PI / 2), 0.8, mul(E.gold, 1), 0.4 * base, 1, true);
      rings(ink, px, py, 120, mul(E.gold, 0.7), 0.4, k.t, base);
      const hit = k.say('化分'), flash = k.t > hit ? Math.exp(-(k.t - hit) * 1.5) : 0;
      ink.dot([px, py], 9 + 14 * flash, mul(E.goldHot, 3 + 4 * flash), 1);
      // the seven beams, each drawn out as its element is named; brighter at 「彩虹」
      const bow = k.at(k.say('彩虹'), 1.5);
      ELS.forEach(([name], i) => {
        const a = prismAng(i), g = k.at(k.say(EL_ZH[i]!) - 0.15, 0.7);
        ink.glow([[px, py], [px + Math.cos(a) * 560, py + Math.sin(a) * 560]], 1.3 + 0.8 * bow, emblemCol(name, 1.2 + 0.6 * bow), 0.75 * g, g);
      });
    },
    emblems: (k) => {
      const bow = k.at(k.say('彩虹'), 1.5);
      return ELS.map(([el], i) => {
        const a = prismAng(i);
        return { el, x: PRISM[0] + Math.cos(a) * 640, y: PRISM[1] + Math.sin(a) * 640, size: 110, rev: k.at(k.say(EL_ZH[i]!), 1.0), glow: 1 + 0.3 * bow + 0.15 * Math.sin(k.t * 1.3 + i * 0.9) };
      });
    },
    ui: (c, k) => {
      c.textAlign = 'center';
      const head = k.at(k.seg.start + 0.6, 1);
      let [x, y] = project(k.cam, 960, 118, 1);
      c.globalAlpha = head * k.w; c.font = font(F.serif(700), 26); c.fillStyle = '#E9C47E'; c.fillText('光界力 · 元素力', x, y);
      [x, y] = project(k.cam, 300, 660, 1);
      c.globalAlpha = k.at(k.say('光界力'), 0.8) * k.w; c.font = font(F.serif(700), 32); c.fillStyle = '#EEE6D3'; c.fillText('光界力', x, y);
      c.textAlign = 'left'; c.font = font(F.serif(700), 30); c.fillStyle = '#EEE6D3';
      EL_ZH.forEach((n, i) => {
        const a = prismAng(i);
        [x, y] = project(k.cam, PRISM[0] + Math.cos(a) * 640 + 76, PRISM[1] + Math.sin(a) * 640 + 11, 1);
        c.globalAlpha = k.at(k.say(n) + 0.2, 0.6) * k.w;
        c.fillText(n, x, y);
      });
      c.globalAlpha = 1;
    },
    fx: { kind: 'gold', col: E.gold, amount: 0.35 },
  },
  falsesky: {
    sky: (k) => night({ top: hx('#010208'), mid: hx('#0a1430'), hor: hx('#20304e'), horY: 820, stars: 1.3, milky: 1, milkyAngle: 0.5, neb: 0.5, shell: smoothstep(0.5, 5, k.lt), crack: 0.15 + 0.25 * smoothstep(3, 12, k.lt), crackCol: hx('#cfe0ff', 0.9) }),
    land: { layers: [
      LY((c) => S.ridge(c, 870, 160, 240, 21, 0.7), 0.6, hx('#060a16'), hx('#8aa8e8', 0.6), { fog: 0.4 }),
      LY((c) => S.ridge(c, 1080, 260, 520, 22, 0.75, -200, 1100), 1, hx('#020409'), hx('#b8c8ff', 0.8)),
    ] },
    fx: { kind: 'stars', col: E.bone, amount: 0.3 },
  },
  paradise: {
    sky: () => ({ top: hx('#1a2a48'), mid: hx('#6a7aa0'), hor: hx('#ffe0a8', 1.0), horY: 760, neb: 0.2, nebA: hx('#ffffff', 0.2), nebB: hx('#ffe0a8', 0.2), glow: [1350, 520, 360], glowCol: hx('#fff0c8', 0.8), rays: 0.8, clouds: 0.5, cloudY: 520, cloudCol: hx('#8a90b0'), cloudLit: hx('#fff0d0', 0.9) }),
    land: { layers: [
      LY((c, r) => { S.city(c, 380, 1600, 790, 220, r, 'dome'); S.spire(c, 980, 795, 30, 330); S.dome(c, 980, 795, 90); S.ground(c, 785, 4, 7); }, 0.55, hx('#5a6080'), hx('#fff4d8', 0.8), { fog: 0.55, hatch: 0.3 }),
      LY((c, r) => { for (let i = 0; i < 5; i++) S.tree(c, 120 + i * 150 + r() * 40, 1000, 260 + r() * 120, 'round', r); for (let i = 0; i < 4; i++) S.tree(c, 1450 + i * 140, 1010, 240 + r() * 120, 'round', r); S.ground(c, 990, 10, 5); }, 0.95, hx('#283048'), hx('#fff4d8', 1.0), { fog: 0.15, hatch: 0.4 }),
    ], light: [1350, 520], fog: hx('#c8c0c0') },
    art: (ink, k) => {
      for (let i = 0; i < 9; i++) {
        const h = hash(i, 12);
        const x = 300 + h * 1300 + Math.sin(k.t * 0.3 + i) * 60, y = 220 + hash(i, 13) * 260 + Math.cos(k.t * 0.5 + i) * 20;
        const f = Math.sin(k.t * 2.2 + i) * 0.35;
        ink.dot([x, y], 3, mul(E.goldHot, 2.4), 0.9);
        ink.poly([[x - 26, y - 14 - f * 20], [x - 10, y - 2], [x, y]], 1.2, mul(E.bone, 1.4), 0.8);
        ink.poly([[x + 26, y - 14 - f * 20], [x + 10, y - 2], [x, y]], 1.2, mul(E.bone, 1.4), 0.8);
      }
    },
    fx: { kind: 'motes', col: E.goldHot, amount: 0.8 },
    post: () => ({ bloom: 0.5, vignette: 0.35 }),
  },

  // ================================================================ III flame
  abyssdragon: {
    sky: (k) => ({ top: hx('#030108'), mid: hx('#1a0830'), hor: hx('#4a1840'), horY: 820, stars: 0.6, neb: 0.8, nebA: hx('#7a3bd6', 0.5), nebB: hx('#c8243f', 0.35),
      rift: [960, 260, 600, smoothstep(0, 6, k.lt)], crack: 0.2 * smoothstep(2, 8, k.lt), crackCol: hx('#a578f0', 0.8) }),
    land: { layers: [
      LY((c) => S.ridge(c, 880, 200, 250, 31, 0.85), 0.55, hx('#0e0616'), hx('#a578f0', 0.6), { fog: 0.4 }),
      LY((c) => S.ridge(c, 1040, 160, 360, 32, 0.6), 1, hx('#050208'), hx('#c06cff', 0.9)),
    ] },
    back: (ink, k) => {
      const u = smoothstep(1, 9, k.lt);
      ink.d = 0.5;
      // out of the rift and down to the left of it (straight down, the rift's glare would swallow the body)
      dragon(ink, (s) => [lerp(880, 600, u) + s * 260 + Math.sin(k.t * 0.5 + s * 3) * 60 * s, lerp(-150, 450, u) - s * 780], mul(E.abyss, 2.4), { flap: Math.sin(k.t * 1.3) });
      tendrils(ink, 960, 900, 1400, 700, k.t, mul(E.abyss, 0.8), 30, 0.6);
      ink.d = 1;
    },
    fx: { kind: 'ash', col: mixc(E.abyss, E.crimson, 0.3), amount: 1 },
    post: () => ({ bloom: 0.7 }),
  },
  shattered: {
    sky: (k) => {
      const u = smoothstep(k.L(1) - 0.5, k.L(1) + 4, k.t);
      return night({ top: hx('#020108'), mid: hx('#120a28'), hor: hx('#2a1a3a'), horY: 840, stars: 1, neb: 0.6, nebA: hx('#7a3bd6', 0.4), nebB: hx('#c8243f', 0.3),
        moons: [{ x: lerp(1500, 1900, u), y: lerp(260, -60, u), r: lerp(80, 30, u), col: hx('#bfe6ff', 1.0), maria: 0.6, alpha: 1 - smoothstep(0.8, 1, u) },
          { x: 600, y: 330, r: 130, col: hx('#f4f0e6'), alpha: 1 - smoothstep(0, 0.08, k.at(k.L(1) - 0.6, 1)) }, { x: 1060, y: 250, r: 95, col: hx('#e8e0ff'), iri: 0.45, alpha: 1 - smoothstep(0, 0.08, k.at(k.L(1) - 0.2, 1)) }] });
    },
    land: { layers: [ LY((c, r) => { S.ridge(c, 960, 120, 300, 41, 0.5); S.ruins(c, 300, 900, 900, 90, r); }, 0.9, hx('#06040c'), hx('#a578f0', 0.6)) ] },
    art: (ink, k) => {
      ink.d = 0.25;
      shatter(ink, 600, 330, 130, smoothstep(k.L(1) - 0.6, k.L(1) + 7, k.t), hx('#f4f0e6', 1.2), 3);
      shatter(ink, 1060, 250, 95, smoothstep(k.L(1) - 0.2, k.L(1) + 7, k.t), hx('#e0d0ff', 1.2), 9);
      ink.d = 1;
      // falling debris
      for (let i = 0; i < 16; i++) {
        const h = hash(i, 31), te = k.L(1) + 1 + h * 6;
        if (k.t < te) continue;
        const u = (k.t - te) / 3; if (u > 1) continue;
        const x0 = 500 + h * 900, y0 = 250 + hash(i, 32) * 100;
        ink.glow([[x0 + u * 200, y0 + u * u * 700], [x0 + u * 200 - 30, y0 + u * u * 700 - 90]], 1.5, mul(E.goldHot, 1.5), 1 - u);
      }
    },
    fx: { kind: 'ash', col: E.abyss, amount: 0.6 },
  },
  nail: {
    sky: (k) => {
      const te = k.seg.start + 3.2;
      return { top: hx('#04060e'), mid: hx('#1a2440'), hor: hx('#5a6a90'), horY: 800, stars: 0.5, neb: 0.3, clouds: 0.6, cloudY: 420, cloudCol: hx('#0c1020'), cloudLit: hx('#ffe6b0', 0.4 + 3 * Math.exp(-Math.max(0, k.t - te) * 1.2) * (k.t > te ? 1 : 0)),
        glow: [980, 600, k.t > te ? 200 + 200 * Math.exp(-(k.t - te)) : 1], glowCol: hx('#ffe6b0', k.t > te ? 0.4 + 1.6 * Math.exp(-(k.t - te) * 0.8) : 0) };
    },
    land: { layers: [
      LY((c) => S.ridge(c, 820, 260, 260, 51, 0.85), 0.55, hx('#0e1424'), hx('#cfe0ff', 0.6), { fog: 0.4 }),
      LY((c, r) => { S.ridge(c, 980, 200, 320, 52, 0.75); S.city(c, 860, 1120, 760, 70, r, 'gothic'); }, 0.9, hx('#060810'), hx('#ffe6b0', 0.8)),
    ], light: [980, 300] },
    art: (ink, k) => {
      const te = k.seg.start + 3.2;
      const u = clamp((k.t - k.seg.start - 0.5) / 2.7, 0, 1);
      const tipY = lerp(-300, 760, ease.inQuad(u));
      ink.d = 0.9;
      nail(ink, 980, tipY - 720, tipY, 44, mul(E.goldHot, 1.6), 1, 0.02, { spin: 0.5 * Math.min(k.t, te) });
      if (k.t < te) ink.glow([[980, tipY - 720], [980, tipY - 1600]], 6, mul(E.goldHot, 0.4), 0.5);
      shock(ink, 980, 760, k.t, te, E.goldHot, 1100);
      ink.d = 1;
    },
    fx: { kind: 'gold', col: E.gold, amount: 0.6 },
    post: (k) => { const te = k.seg.start + 3.2; const d = k.t - te; return { flash: d > 0 && d < 1.5 ? 0.9 * Math.exp(-d * 4) : 0, shake: d > 0 && d < 1 ? [Math.sin(k.t * 90) * 8 * (1 - d), Math.cos(k.t * 77) * 6 * (1 - d)] : [0, 0] }; },
  },
  vindagnyr: {
    sky: () => ({ top: hx('#0a1220'), mid: hx('#3a5070'), hor: hx('#a8c0d8'), horY: 760, stars: 0, neb: 0.3, nebA: hx('#ffffff', 0.15), nebB: hx('#a9e6f4', 0.2), clouds: 0.8, cloudY: 380, cloudCol: hx('#3a4a60'), cloudLit: hx('#e8f4ff', 0.6), glow: [960, 240, 120], glowCol: hx('#cfe8ff', 0.5) }),
    land: { layers: [
      LY((c) => S.ridge(c, 760, 200, 240, 61, 0.8), 0.5, hx('#506078'), hx('#e8f4ff', 0.5), { fog: 0.6, hatch: 0.3 }),
      LY((c, r) => { S.ridge(c, 900, 120, 280, 62, 0.6); S.city(c, 1150, 1600, 840, 160, r, 'gothic'); S.spire(c, 1380, 845, 40, 300); }, 0.8, hx('#202c40'), hx('#e8f4ff', 0.8), { fog: 0.3 }),
      LY((c, r) => { S.tree(c, 520, 1060, 640, 'dead', r); S.ground(c, 1030, 12, 6); }, 1, hx('#0c121e'), hx('#f0f8ff', 1.0)),
    ], light: [960, 200], fog: hx('#a0b0c8') },
    back: (ink, k) => {
      // the Skyfrost Nail: its stump driven into the peak behind the city, its broken head drifting above in three pieces
      ink.d = 0.5;
      const Ly = 880, w = 30, gold = mul(E.goldHot, 1.2);
      nail(ink, 960, 140, 140 + Ly, w, gold, 0.95, 0, { cut: [0.16, 1], seed: 3 });
      const pieces: [number, number, number, number, number][] = [[0, 0.06, 905, 130, 0.35], [0.06, 0.11, 1045, 190, -0.3], [0.11, 0.16, 850, 235, 0.18]];
      pieces.forEach(([c0, c1, px, py, tl], i) => {
        const c = (c0 + c1) / 2, bx = px + Math.sin(k.t * 0.3 + i * 2) * 6, by = py + Math.sin(k.t * 0.45 + i) * 8;
        nail(ink, bx - c * Ly * tl, by - c * Ly, by - c * Ly + Ly, w, gold, 0.9, tl, { cut: [c0, c1], seed: 11 + i });
      });
      ink.d = 1;
    },
    fx: { kind: 'snow', col: E.bone, amount: 1.6 },
    post: () => ({ bloom: 0.45 }),
  },
  enkanomiya: {
    sky: () => ({ top: hx('#000104'), mid: hx('#020a1a'), hor: hx('#0a2240'), horY: 900, stars: 0, neb: 0.3, nebA: hx('#1a4a8a', 0.3), nebB: hx('#0a3a5a', 0.3), glow: [960, 170, 160], glowCol: hx('#ffe6b0', 0.9), rays: 0.9 }),
    land: { layers: [
      LY((c) => { S.pillar(c, 120, 1200, 260, 1000, 1); S.pillar(c, 1820, 1200, 300, 1100, 2); }, 0.5, hx('#030a14'), hx('#4db6f5', 0.4), { fog: 0.35 }),
      LY((c, r) => { S.ruins(c, 420, 1500, 880, 160, r); S.dome(c, 760, 880, 90); S.dome(c, 1240, 880, 70); S.spire(c, 960, 880, 40, 420); S.ground(c, 870, 6, 2); }, 0.8, hx('#030914'), hx('#ffe6b0', 0.7), { fog: 0.15 }),
    ], light: [960, 170] },
    art: (ink) => { ink.d = 0.8; ink.glow([[960, 460], [960, 200]], 1.2, mul(E.goldHot, 1.2), 0.8); ink.d = 1; },
    fx: { kind: 'bubbles', col: mul(E.hydro, 1.2), amount: 0.8 },
  },
  seelie: {
    sky: () => ({ top: hx('#060a16'), mid: hx('#18304a'), hor: hx('#406a70'), horY: 760, stars: 0.4, neb: 0.3, nebA: hx('#62d6b8', 0.25), nebB: hx('#2b4ea0', 0.3) }),
    land: { layers: [
      LY((c, r) => { for (let i = 0; i < 12; i++) S.tree(c, i * 170 + r() * 60, 820, 300 + r() * 200, 'round', r); S.ground(c, 800, 6, 2); }, 0.55, hx('#0a1a20'), hx('#62d6b8', 0.4), { fog: 0.45 }),
      LY((c, r) => { S.arch(c, 760, 960, 300, 280, 22); S.arch(c, 1250, 960, 260, 240, 20, 0.7); S.ruins(c, 900, 1500, 960, 120, r); S.ground(c, 950, 8, 3); }, 0.9, hx('#06121a'), hx('#8af0d8', 0.8)),
    ] },
    art: (ink, k) => {
      for (let i = 0; i < 7; i++) {
        const ph = i * 1.3;
        const x = 960 + Math.sin(k.t * 0.37 + ph) * 520 + Math.sin(k.t * 0.9 + ph * 2) * 60;
        const y = 640 + Math.cos(k.t * 0.29 + ph) * 160;
        const trail: P2[] = [];
        for (let s = 0; s <= 12; s++) { const tt = k.t - s * 0.08; trail.push([960 + Math.sin(tt * 0.37 + ph) * 520 + Math.sin(tt * 0.9 + ph * 2) * 60, 640 + Math.cos(tt * 0.29 + ph) * 160]); }
        ink.poly(trail, 2.2, mul(E.anemo, 0.6), 0.5);
        ink.dot([x, y], 7, mul(E.anemo, 2.4), 1);
        ink.dot([x, y], 16, mul(E.anemo, 0.25), 1);
      }
    },
    fx: { kind: 'motes', col: E.anemo, amount: 0.8 },
  },
  khaenriah: {
    sky: () => ({ top: hx('#010204'), mid: hx('#060c18'), hor: hx('#18263a'), horY: 900, stars: 0, neb: 0.5, nebA: hx('#2a3a5a', 0.4), nebB: hx('#3a2a1a', 0.3), glow: [960, 760, 400], glowCol: hx('#f2b54a', 0.35) }),
    land: { layers: [
      LY((c, r) => { c.beginPath(); c.moveTo(-200, -200); for (let x = -200; x <= 2120; x += 40) c.lineTo(x, 140 + 90 * Math.abs(noise1(x / 90, 3)) + 60 * r()); c.lineTo(2120, -200); c.closePath(); c.fill(); }, 0.5, hx('#04060a'), hx('#6a8ad8', 0.3), { fog: 0.2 }),
      LY((c, r) => { S.city(c, 200, 1720, 880, 420, r, 'block'); for (let i = 0; i < 6; i++) S.spire(c, 300 + i * 260 + r() * 80, 880, 30, 380 + r() * 200); S.ground(c, 875, 4, 1); }, 0.75, hx('#05070c'), hx('#f2b54a', 0.8), { fog: 0.15 }),
    ], light: [960, 760] },
    back: (ink, k) => {
      ink.d = 0.4;
      const gear = (x: number, y: number, r: number, n: number, a: number, al: number) => {
        ink.circle(x, y, r, 1.2, mul(E.gold, 0.8), al, 1, 120, a);
        ink.circle(x, y, r * 0.35, 1, mul(E.gold, 0.6), al);
        for (let i = 0; i < n; i++) { const b = a + i * Math.PI * 2 / n; ink.seg([x + Math.cos(b) * r, y + Math.sin(b) * r], [x + Math.cos(b) * (r + 14), y + Math.sin(b) * (r + 14)], 5, mul(E.gold, 0.7), al); }
      };
      gear(500, 420, 140, 24, k.t * 0.12, 0.5); gear(735, 340, 90, 16, -k.t * 0.19, 0.45); gear(1450, 400, 170, 28, -k.t * 0.09, 0.5);
      ink.d = 1;
    },
    art: (ink, k) => { for (let i = 0; i < 60; i++) { const h = hash(i, 41); ink.d = 0.75; ink.dot([200 + h * 1520, 600 + hash(i, 42) * 260], 1.6, mul(E.goldHot, 1.5 + Math.sin(k.t + i)), 0.8); } ink.d = 1; },
    fx: { kind: 'ash', col: mul(E.gold, 0.5), amount: 0.5 },
  },

  // ================================================================ IV archon war
  'diagram:thrones': {
    sky: () => night({ top: hx('#02030a'), mid: hx('#0d1430'), hor: hx('#2a2a40'), horY: 900, stars: 0.8, neb: 0.4, nebA: hx('#e8c47e', 0.2) }),
    art: (ink, k) => {
      // the Gnoses' chess forms (BWIKI 神之心 / 萌娘百科 神之眼): anemo queen, geo rook, electro knight, dendro and hydro
      // bishops, pyro knight, cryo king; order as ELS
      const kinds = ['queen', 'rook', 'knight', 'bishop', 'bishop', 'knight', 'king'];
      rings(ink, 960, 520, 330, mul(E.gold, 0.7), 0.5, k.t, smoothstep(0, 2, k.lt));
      for (let i = 0; i < 7; i++) {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 7;
        const x = 960 + Math.cos(a) * 330, y = 520 + Math.sin(a) * 330;
        const g = k.at(k.L(1) + 0.6 + i * 0.35, 1.2);
        chess(ink, kinds[i]!, x, y + 55, 110, mul(ELS[i]![1], 1.4), 1, g);
        const th = k.at(k.L(1) + 4 + i * 0.25, 1);
        // a throne glyph above the piece
        ink.poly([[x - 26, y - 72], [x - 26, y - 118], [x + 26, y - 118], [x + 26, y - 72], [x + 34, y - 72], [x + 34, y - 52], [x - 34, y - 52], [x - 34, y - 72], [x - 26, y - 72]], 1.2, mul(E.goldHot, 1.4), th, th);
      }
      // the gods' war: sparks clashing between the seats on the last line
      const w = k.at(k.L(2), 1.5);
      for (let i = 0; i < 24 * w; i++) {
        const h = hash(i, 51), a1 = h * Math.PI * 2, a2 = hash(i, 52) * Math.PI * 2;
        const p: P2 = [960 + Math.cos(a1) * 250, 520 + Math.sin(a1) * 250], q: P2 = [960 + Math.cos(a2) * 250, 520 + Math.sin(a2) * 250];
        const f = (k.t * 0.8 + h) % 1;
        ink.seg([lerp(p[0], q[0], f), lerp(p[1], q[1], f)], [lerp(p[0], q[0], f + 0.05), lerp(p[1], q[1], f + 0.05)], 1.6, mul(ELS[i % 7]![1], 2), w);
      }
    },
    fx: { kind: 'gold', col: E.gold, amount: 0.4 },
  },
  mondstadt_old: {
    sky: (k) => { const calm = k.at(k.L(2), 4); return { top: hx('#04080e'), mid: mixc(hx('#1a2a3a'), hx('#2a5a6a'), calm), hor: mixc(hx('#4a6a7a'), hx('#a8e0d0'), calm), horY: 760, stars: 0.2 + 0.6 * calm, neb: 0.3, nebA: hx('#62d6b8', 0.3), clouds: 0.9 * (1 - calm), cloudY: 300, cloudCol: hx('#0a121a'), cloudLit: hx('#a8f0e0', 0.5), glow: [960, 300, 200 * calm + 1], glowCol: hx('#a8f0e0', 0.6 * calm) }; },
    land: { layers: [
      LY((c) => { S.ridge(c, 820, 140, 220, 71, 0.7); S.spire(c, 960, 800, 90, 520); S.rect(c, 960, 800, 130, 300); }, 0.55, hx('#0a141c'), hx('#62d6b8', 0.6), { fog: 0.35 }),
      LY((c) => { c.beginPath(); c.moveTo(-200, 1300); c.lineTo(-200, 860); c.quadraticCurveTo(300, 840, 560, 880); c.lineTo(620, 1300); c.closePath(); c.fill(); S.figure(c, 420, 862, 95, 'lyre', -1); }, 1, hx('#03070a'), hx('#8af0d8', 1.0)),
    ], light: [960, 300] },
    art: (ink, k) => { const calm = k.at(k.L(2), 4); ink.d = 0.55; windRing(ink, 960, 470, 360, 120, k.t * (1 + 0.5 * (1 - calm)), mul(E.anemo, 1.3), 26, 1 - 0.7 * calm); ink.d = 1; },
    fx: { kind: 'snow', col: E.bone, amount: 1.2 },
  },
  liyue_old: {
    sky: () => ({ top: hx('#05060a'), mid: hx('#2a2418'), hor: hx('#8a7040'), horY: 720, stars: 0, neb: 0.3, nebA: hx('#f2b54a', 0.3), clouds: 0.8, cloudY: 280, cloudCol: hx('#0c0a08'), cloudLit: hx('#f2c06a', 0.8), seaY: 740, seaCol: hx('#1a2a30'), seaLines: 1.4, glow: [960, 200, 150], glowCol: hx('#ffd080', 0.6), rays: 0.6 }),
    land: { layers: [
      LY((c, r) => { for (let i = 0; i < 10; i++) S.pillar(c, 80 + i * 200 + r() * 60, 780, 50 + r() * 40, 180 + r() * 220, i); }, 0.5, hx('#141210'), hx('#f2c06a', 0.5), { fog: 0.5 }),
      LY((c, r) => { S.pillar(c, 200, 1150, 160, 700, 5); S.pillar(c, 1750, 1150, 180, 760, 6); S.pillar(c, 1500, 1150, 90, 430, 8); void r; }, 1, hx('#060504'), hx('#ffd080', 0.9)),
    ], light: [960, 200] },
    art: (ink, k) => {
      // the whirlpool on the sea and stone spears falling into it
      ink.d = 0.7;
      for (let i = 0; i < 9; i++) {
        const pts: P2[] = [];
        for (let s = 0; s <= 40; s++) { const a = s / 40 * Math.PI * 1.6 + k.t * 0.8 + i * 0.7; const r = 40 + i * 34 + s * 2; pts.push([960 + Math.cos(a) * r * 2.2, 830 + Math.sin(a) * r * 0.35]); }
        ink.poly(pts, 1, mul(E.hydro, 0.9), 0.5);
      }
      for (let i = 0; i < 5; i++) {
        const te = k.L(1) - 0.5 + i * 0.7; if (k.t < te) continue;
        const u = clamp((k.t - te) / 0.9, 0, 1);
        const x = 760 + i * 100, yT = lerp(-200, 860, ease.inQuad(u));
        spear(ink, x, yT - 520, yT, 16, mul(E.geo, 1.8), 1, -0.08);
        if (u >= 1) shock(ink, x, 860, k.t, te + 0.9, E.geo, 220);
      }
      ink.d = 1;
    },
    fx: { kind: 'rain', col: E.bone, amount: 0.7 },
  },
  inazuma_old: {
    sky: () => ({ top: hx('#05030c'), mid: hx('#2a1648'), hor: hx('#6a3a8a'), horY: 760, stars: 0, neb: 0.6, nebA: hx('#b48cff', 0.4), nebB: hx('#c8243f', 0.2), clouds: 0.9, cloudY: 260, cloudCol: hx('#0a0614'), cloudLit: hx('#c8a0ff', 1.0), seaY: 780, seaCol: hx('#3a0a1a'), seaLines: 1.3 }),
    land: { layers: [
      LY((c) => { S.ridge(c, 800, 260, 200, 81, 0.8, -200, 900); S.ridge(c, 800, 240, 220, 82, 0.8, 1020, 2120); }, 0.6, hx('#0e0818'), hx('#c8a0ff', 0.6), { fog: 0.3 }),
      LY((c) => { S.torii(c, 560, 830, 180, 150); S.ground(c, 830, 4, 1); }, 0.75, hx('#08040c'), hx('#ff6a8a', 0.6)),
      LY((c) => { // Orobashi's bones in the shallows: a spine, ribs hanging from it, a skull
        const B = (u: number): [number, number] => [(1 - u) ** 2 * 1080 + 2 * (1 - u) * u * 1460 + u * u * 1980, (1 - u) ** 2 * 1010 + 2 * (1 - u) * u * 850 + u * u * 950];
        c.lineCap = 'round'; c.lineWidth = 11; c.beginPath(); for (let k = 0; k <= 40; k++) { const [x, y] = B(k / 40); if (k) c.lineTo(x, y); else c.moveTo(x, y); } c.stroke();
        for (let i = 1; i < 15; i++) { const u = i / 15, [x, y] = B(u), L = 150 * Math.sin(Math.PI * (0.15 + u * 0.75)); c.lineWidth = 7 - u * 3; c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 46, y + L * 0.45, x + 8, y + L); c.stroke(); c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x - 30, y + L * 0.5, x - 22, y + L * 0.92); c.stroke(); }
        const [hx0, hy0] = B(0); c.beginPath(); c.ellipse(hx0 - 40, hy0 + 10, 62, 34, -0.25, 0, Math.PI * 2); c.fill(); }, 1, hx('#0a0610'), hx('#f0e0ff', 0.8)),
    ] },
    art: (ink, k) => {
      const te = k.L(1) + 0.8;
      if (k.t > te) {
        const u = clamp((k.t - te) / 0.25, 0, 1), fade = Math.exp(-(k.t - te) * 0.7);
        ink.d = 0.6;
        ink.glow([[960 + 260, -100], [960 - 60 + (1 - u) * 200, 1200 * u - 100]], 4, mul(E.electro, 3 * fade), fade);
        ink.d = 1;
      }
      if (frameIdx(k.t) % 97 < 5) bolt(ink, [400 + (frameIdx(k.t) % 7) * 160, 200], [500 + (frameIdx(k.t) % 5) * 200, 700], mul(E.electro, 2.5), frameIdx(k.t) / 97 | 0, 0.8);
    },
    fx: { kind: 'rain', col: E.bone, amount: 1 },
    post: (k) => { const d = k.t - k.L(1) - 0.8; return { flash: d > 0 && d < 1 ? 0.7 * Math.exp(-d * 5) : 0 }; },
  },
  sumeru_old: {
    sky: () => ({ top: hx('#0a0408'), mid: hx('#5a1a14'), hor: hx('#f08040', 1.0), horY: 760, stars: 0, neb: 0.3, nebA: hx('#ff8040', 0.3), glow: [1500, 640, 220], glowCol: hx('#ffa060', 0.7), rays: 0.5 }),
    land: { layers: [
      LY((c, r) => { for (let i = 0; i < 26; i++) S.tree(c, -100 + i * 22, 770, 60 + r() * 50, 'round', r); S.ground(c, 770, 4, 3); }, 0.4, hx('#24301a'), hx('#9cd84f', 0.5), { fog: 0.5 }),
      LY((c) => { S.dunes(c, 820, 60, 220, 2); S.pyramid(c, 1150, 830, 760, 380, 9); }, 0.65, hx('#3a1810'), hx('#ffb070', 0.8), { fog: 0.3 }),
      LY((c) => S.dunes(c, 1000, 90, 300, 5), 1, hx('#1a0a06'), hx('#ffb070', 0.8)),
    ], light: [1500, 640], fog: hx('#a05030') },
    // the nail that buried the rainforest (萌娘百科 须弥地区), half sunk in the sand
    back: (ink) => { ink.d = 0.5; nail(ink, 600, 330, 1060, 30, mul(E.gold, 1.2), 0.95, 0.2, { spin: 0.6 }); ink.d = 1; },
    fx: { kind: 'ash', col: hx('#ffb070', 0.8), amount: 1.2 },
  },
  fontaine_old: {
    sky: () => ({ top: hx('#0a0a18'), mid: hx('#4a3048'), hor: hx('#ffc070', 1.0), horY: 760, stars: 0, neb: 0.3, nebA: hx('#ffb070', 0.3), glow: [1400, 700, 240], glowCol: hx('#ffc890', 0.8), rays: 0.6, seaY: 770, seaCol: hx('#2a3048'), seaLines: 1.3 }),
    land: { layers: [
      LY((c, r) => { S.city(c, 300, 1500, 790, 200, r, 'dome'); S.dome(c, 820, 790, 110); S.spire(c, 1060, 790, 40, 360); for (let i = 0; i < 6; i++) S.rect(c, 420 + i * 80, 790, 14, 140); }, 0.6, hx('#1a1420'), hx('#ffd090', 0.8), { fog: 0.4 }),
      LY((c) => S.waves(c, 920, 110, 420, 0.3), 1, hx('#0a1020'), hx('#a8e0ff', 0.8)),
    ], light: [1400, 700] },
    art: (ink, k) => { ink.d = 0.6; for (let i = 0; i < 5; i++) { const x = 380 + i * 280, s = 1 + 0.2 * Math.sin(k.t + i); ink.poly([[x - 16 * s, 790], [x - 10, 650], [x, 630], [x + 10, 650], [x + 16 * s, 790]], 1.2, mul(E.goldHot, 1.2), 0.8); } ink.d = 1; },
    fx: { kind: 'motes', col: E.goldHot, amount: 0.6 },
  },
  natlan_old: {
    sky: () => ({ top: hx('#060204'), mid: hx('#2a0a08'), hor: hx('#a02a10'), horY: 800, stars: 0.5, neb: 0.5, nebA: hx('#ff5020', 0.3), glow: [960, 360, 180], glowCol: hx('#ff6a30', 1.0), rays: 0.4 }),
    land: { layers: [
      LY((c) => { S.ridge(c, 860, 120, 260, 91, 0.6); S.volcano(c, 960, 880, 640, 520, 4); }, 0.6, hx('#120604'), hx('#ff6a30', 0.9), { fog: 0.25 }),
      LY((c, r) => { S.ground(c, 1000, 10, 3); for (let i = 0; i < 40; i++) S.figure(c, 200 + i * 38 + r() * 10, 1004, 34 + r() * 8, i % 3 === 0 ? 'torch' : 'stand'); }, 1, hx('#050202'), hx('#ff8040', 1.0)),
    ], light: [960, 360] },
    back: (ink, k) => {
      ink.d = 0.6;
      dragon(ink, trail((tt) => [960 + Math.cos(tt * 0.45) * 330, 430 + Math.sin(tt * 0.45) * 110], k.t, 520), mul(E.pyro, 1.8), { flap: Math.sin(k.t * 1.8), side: true });
      ink.d = 1;
    },
    art: (ink, k) => { for (let i = 0; i < 40; i++) if (i % 3 === 0) { ink.d = 1; ink.dot([200 + i * 38 + 7, 1004 - 40], 3, mul(E.pyro, 3 + Math.sin(k.t * 9 + i)), 1); } },
    fx: { kind: 'embers', col: E.pyro, amount: 1.2 },
  },
  snezhnaya_old: {
    sky: () => ({ top: hx('#02040a'), mid: hx('#0e1a30'), hor: hx('#5a7aa0'), horY: 760, stars: 0.6, neb: 0.2, aurora: 0.9, auroraA: hx('#a9e6f4'), auroraB: hx('#62d6b8'), clouds: 0.4, cloudY: 600, cloudCol: hx('#1a2840'), cloudLit: hx('#cfe8ff', 0.4) }),
    land: { layers: [
      LY((c) => S.ridge(c, 800, 140, 280, 101, 0.6), 0.5, hx('#1a2a40'), hx('#cfe8ff', 0.5), { fog: 0.5 }),
      LY((c, r) => { S.ground(c, 880, 4, 2); S.onion(c, 960, 880, 120, 420); S.onion(c, 780, 880, 80, 280); S.onion(c, 1140, 880, 80, 300); S.city(c, 560, 1380, 880, 150, r, 'block'); S.onion(c, 640, 880, 50, 200); S.onion(c, 1290, 880, 54, 210); }, 0.8, hx('#0a1424'), hx('#e8f6ff', 0.9), { fog: 0.2 }),
    ] },
    fx: { kind: 'snow', col: E.bone, amount: 1.8 },
  },
  'diagram:seven': {
    sky: () => night({ top: hx('#02030a'), mid: hx('#0d1430'), hor: hx('#2a2a40'), horY: 900, stars: 0.8, neb: 0.5 }),
    art: (ink, k) => {
      rings(ink, 960, 500, 110, mul(E.gold, 1), 0.8, k.t, smoothstep(0, 1.5, k.lt));
      ink.dot([960, 500], 8, mul(E.goldHot, 3), 1);
      ELS.forEach(([name], i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 7;
        const g = k.at(k.seg.start + 0.6 + i * 0.45, 1.0);
        ink.poly([[960 + Math.cos(a) * 120, 500 + Math.sin(a) * 120], [960 + Math.cos(a) * 262, 500 + Math.sin(a) * 262]], 1, emblemCol(name, 0.8), 0.6, g, false, 2);
      });
      // the defeated: dim sparks drifting out to the dark sea
      const f = k.at(k.L(1), 3);
      for (let i = 0; i < 30; i++) {
        const a = hash(i, 61) * Math.PI * 2, r = 450 + f * (200 + 300 * hash(i, 62));
        ink.dot([960 + Math.cos(a) * r * 1.5, 500 + Math.sin(a) * r * 0.9], 2.5, mul(E.abyss, 1.4), f * (1 - f * 0.5));
      }
    },
    // each emblem burns in as its spoke arrives
    emblems: (k) => ELS.map(([el], i) => {
      const a = -Math.PI / 2 + i * Math.PI * 2 / 7;
      return { el, x: 960 + Math.cos(a) * 340, y: 500 + Math.sin(a) * 340, size: 150, rev: k.at(k.seg.start + 1.2 + i * 0.45, 1.3), glow: 1 + 0.2 * Math.sin(k.t * 1.3 + i * 0.9) };
    }),
    ui: (c, k) => {
      const N: [string, string][] = [['蒙德', '巴巴托斯'], ['璃月', '摩拉克斯'], ['稻妻', '巴尔'], ['须弥', '大慈树王'], ['枫丹', '厄歌莉娅'], ['纳塔', '希巴拉克'], ['至冬', '冰神']];
      N.forEach(([n, g], i) => {
        const a = -Math.PI / 2 + i * Math.PI * 2 / 7;
        const [x, y] = project(k.cam, 960 + Math.cos(a) * 470, 500 + Math.sin(a) * 455, 1);
        const al = k.at(k.seg.start + 1.0 + i * 0.45, 0.8);
        if (al <= 0) return;
        c.globalAlpha = al * k.w; c.textAlign = 'center';
        c.font = font(F.serif(700), 30); c.fillStyle = '#EEE6D3'; c.fillText(n, x, y);
        c.font = font(F.sans(500), 18); c.fillStyle = '#E9C47E'; c.fillText(g, x, y + 28);
        c.globalAlpha = 1;
      });
    },
    fx: { kind: 'gold', col: E.gold, amount: 0.3 },
  },

  // ================================================================ V golden age
  khaenriah_gold: {
    sky: () => ({ top: hx('#020203'), mid: hx('#0e0c08'), hor: hx('#4a3a18'), horY: 900, stars: 0, neb: 0.4, nebA: hx('#f2b54a', 0.25), glow: [960, 600, 500], glowCol: hx('#f2b54a', 0.4), rays: 0.3 }),
    land: { layers: [
      LY((c, r) => { S.city(c, 100, 1820, 760, 500, r, 'block'); }, 0.4, hx('#0c0a06'), hx('#f2b54a', 0.5), { fog: 0.35 }),
      LY((c) => { S.ground(c, 960, 2, 1); for (let i = 0; i < 9; i++) { const x = 180 + i * 195, h = 300; c.fillRect(x - 34, 960 - h, 68, h * 0.75); c.beginPath(); c.arc(x, 960 - h, 42, 0, Math.PI * 2); c.fill(); c.fillRect(x - 70, 960 - h * 0.7, 140, 26); } }, 0.9, hx('#080604'), hx('#f2c06a', 0.9)),
    ], light: [960, 600] },
    art: (ink, k) => { for (let i = 0; i < 9; i++) { const x = 180 + i * 195; ink.d = 0.9; ink.dot([x, 660], 6, mul(E.cryo, 3 + Math.sin(k.t * 2 + i)), 1); ink.dot([x, 660], 16, mul(E.cryo, 0.4), 1); } ink.d = 1; },
    fx: { kind: 'gold', col: E.gold, amount: 0.6 },
  },
  crimsonmoon: {
    sky: () => ({ top: hx('#030004'), mid: hx('#1a0408'), hor: hx('#3a0a10'), horY: 900, stars: 0.3, neb: 0.6, nebA: hx('#c8243f', 0.4), nebB: hx('#7a3bd6', 0.3), moons: [{ x: 960, y: 330, r: 170, col: hx('#e83040', 1.4), maria: 1.4 }] }),
    land: { layers: [
      LY((c, r) => { S.city(c, 0, 1920, 900, 380, r, 'gothic'); for (let i = 0; i < 7; i++) S.spire(c, 140 + i * 270, 900, 46, 520 + r() * 160); }, 0.8, hx('#060205'), hx('#ff4060', 0.8)),
    ], light: [960, 330] },
    fx: { kind: 'ash', col: E.crimson, amount: 0.7 },
  },

  // ================================================================ VI cataclysm
  twins_fall: {
    sky: () => night({ top: hx('#010208'), mid: hx('#0a1636'), hor: hx('#3a4a70'), horY: 820, stars: 1.4, milky: 1.2, milkyAngle: 0.3, neb: 0.5 }),
    land: { layers: [
      LY((c) => S.dunes(c, 900, 50, 180, 3), 0.6, hx('#1a2440'), hx('#cfe0ff', 0.5), { fog: 0.4, hatch: 0.3 }),
      LY((c) => S.dunes(c, 1030, 70, 260, 7), 1, hx('#0e1428'), hx('#e0ecff', 0.7), { hatch: 0.3 }),
    ] },
    art: (ink, k) => {
      const star = (x0: number, y0: number, x1: number, y1: number, d: number, col: RGB) => {
        const u = k.at(k.seg.start + d, 5.5);
        const x = lerp(x0, x1, u), y = lerp(y0, y1, ease.inQuad(u));
        const tail: P2[] = [];
        for (let s = 0; s <= 12; s++) { const v = Math.max(0, u - s * 0.025); tail.push([lerp(x0, x1, v), lerp(y0, y1, ease.inQuad(v))]); }
        ink.glow(tail, 2.4, col, 0.8 * (u > 0 && u < 1 ? 1 : 0.3));
        if (u < 1) ink.dot([x, y], 6, mul(col, 3), 1);
      };
      star(300, -40, 860, 860, 0.5, mul(E.goldHot, 1.6));
      star(1700, -60, 1180, 900, 1.6, mul(E.cryo, 1.6));
    },
    fx: { kind: 'stars', col: E.bone, amount: 0.4 },
  },
  sinners: {
    sky: () => ({ top: hx('#030106'), mid: hx('#12061a'), hor: hx('#2a0a2a'), horY: 900, stars: 0, neb: 0.7, nebA: hx('#7a3bd6', 0.5), nebB: hx('#c8243f', 0.3), glow: [960, 520, 160], glowCol: hx('#a578f0', 0.7) }),
    land: { layers: [
      LY((c, r) => { for (let i = 0; i < 8; i++) { const x = 120 + i * 240; S.rect(c, x, 1100, 46, 900 - r() * 200); S.arch(c, x + 120, 420, 220, 0, 22); } }, 0.5, hx('#0a040e'), hx('#a578f0', 0.5), { fog: 0.3 }),
      LY((c) => { S.ground(c, 980, 2, 1); c.fillRect(890, 640, 140, 30); c.fillRect(900, 520, 120, 130); c.fillRect(870, 470, 30, 190); c.fillRect(1020, 470, 30, 190); for (let i = 0; i < 5; i++) S.figure(c, 560 + i * 200, 990, 170, 'stand', i < 2 ? 1 : -1); }, 1, hx('#040206'), hx('#c890ff', 0.9)),
    ] },
    art: (ink, k) => {
      const c0: P2 = [960, 500];
      ink.dot(c0, 10, mul(E.goldHot, 3), 1);
      for (let i = 0; i < 5; i++) {
        const tgt: P2 = [560 + i * 200, 860];
        const f = k.at(k.L(0) + 1, 3);
        const pts: P2[] = [];
        for (let s = 0; s <= 30; s++) { const u = s / 30; pts.push([lerp(c0[0], tgt[0], u) + Math.sin(u * 9 + k.t * 2 + i) * 40 * Math.sin(Math.PI * u), lerp(c0[1], tgt[1], u) - Math.sin(Math.PI * u) * 120]); }
        ink.glow(pts, 1.6, mul(E.abyss, 2), 0.8, f);
      }
      tendrils(ink, 960, 560, 300, 420, k.t, mul(E.abyss, 1), 24, 0.6, 5);
    },
    fx: { kind: 'ash', col: E.abyss, amount: 0.8 },
  },
  judgment: {
    sky: (k) => ({ top: hx('#020103'), mid: hx('#100a14'), hor: hx('#3a2018'), horY: 860, stars: 0.3, neb: 0.4, nebA: hx('#e8c47e', 0.2), nebB: hx('#7a3bd6', 0.3), glow: [960, 120, 200], glowCol: hx('#ffe6b0', 0.6 * k.at(k.seg.start, 3)), rays: 0.8 }),
    land: { layers: [
      LY((c, r) => { S.city(c, 0, 1920, 900, 300, r, 'gothic'); S.ground(c, 895, 4, 2); }, 0.75, hx('#08060a'), hx('#ffb070', 0.7), { fog: 0.15 }),
    ] },
    art: (ink, k) => {
      const cols = [E.anemo, E.geo, E.electro, E.hydro, E.pyro, E.cryo];
      cols.forEach((col, i) => {
        const x = 330 + i * 250, f = k.at(k.seg.start + 0.6 + i * 0.35, 1.2);
        ink.glow([[x, -100], [x, lerp(-100, 900, f)]], 3, mul(col, 2), 0.9);
        ink.poly([[x - 14, -100], [x - 14, lerp(-100, 900, f)]], 6, mul(col, 0.2), 0.8);
        if (f >= 1) shock(ink, x, 900, k.t, k.seg.start + 1.8 + i * 0.35, col, 240);
      });
      for (let i = 0; i < 4; i++) cube(ink, 420 + i * 360, 150 + 30 * Math.sin(k.t + i), 46, k.t * 0.4 + i, 0.5 + i * 0.2, mul(E.goldHot, 1.4), k.at(k.seg.start + 2, 2));
    },
    fx: { kind: 'ash', col: mul(E.gold, 0.7), amount: 1 },
    post: () => ({ bloom: 0.7 }),
  },
  durin: {
    sky: () => ({ top: hx('#04030a'), mid: hx('#1a1a30'), hor: hx('#4a4a6a'), horY: 800, stars: 0, neb: 0.5, nebA: hx('#7a3bd6', 0.3), nebB: hx('#62d6b8', 0.25), clouds: 0.9, cloudY: 360, cloudCol: hx('#08080e'), cloudLit: hx('#8af0d8', 0.5), seaY: 840, seaCol: hx('#1a2030') }),
    land: { layers: [
      LY((c, r) => { S.ground(c, 850, 4, 2); S.city(c, 560, 1360, 850, 140, r, 'gothic'); S.spire(c, 960, 852, 50, 300); S.windmill(c, 520, 856, 110, 0.4); S.windmill(c, 1420, 858, 120, 1.2); }, 0.75, hx('#08080e'), hx('#cfe0ff', 0.7), { fog: 0.2 }),
    ] },
    art: (ink, k) => {
      const a = k.t * 0.35;
      wyvern(ink, 960 + Math.cos(a) * 380, 380 + Math.sin(a * 1.6) * 80, 120, Math.sin(k.t * 3), mul(E.abyss, 1.6), Math.cos(a) > 0 ? -1 : 1);
      wyvern(ink, 960 - Math.cos(a) * 340, 300 - Math.sin(a * 1.6) * 70, 105, Math.sin(k.t * 3.6 + 1), mul(E.anemo, 1.6), Math.cos(a) > 0 ? 1 : -1);
      if (frameIdx(k.t) % 120 < 4) bolt(ink, [300, 150], [600, 600], mul(E.electro, 2), frameIdx(k.t) / 120 | 0, 0.6);
    },
    fx: { kind: 'ash', col: mixc(E.abyss, E.bone, 0.3), amount: 1 },
  },
  chasm: {
    sky: () => ({ top: hx('#030305'), mid: hx('#1a1410'), hor: hx('#4a3a2a'), horY: 600, stars: 0, neb: 0.4, nebA: hx('#7a3bd6', 0.3), nebB: hx('#f2b54a', 0.2) }),
    land: { layers: [
      LY((c) => S.ridge(c, 620, 120, 300, 111, 0.6), 0.5, hx('#141008'), hx('#f2b54a', 0.4), { fog: 0.4 }),
      LY((c) => { for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(960, 760 + i * 70, 900 - i * 120, 120 - i * 12, 0, 0, Math.PI * 2); c.fill(); } }, 0.8, hx('#0a0806'), hx('#f2c06a', 0.7), { fog: 0.1 }),
    ] },
    art: (ink, k) => {
      for (let i = 0; i < 14; i++) {
        const pts: P2[] = [];
        let x = 960 + (hash(i, 71) - 0.5) * 700, y = 1000;
        for (let s = 0; s < 10; s++) { pts.push([x, y]); x += (hash(i, s) - 0.5) * 90; y -= 25 + hash(s, i) * 25; }
        ink.glow(pts, 1.4, mul(E.abyss, 1.8 + Math.sin(k.t * 2 + i)), 0.8, k.at(k.seg.start + i * 0.15, 1.5));
      }
    },
    // the seal, lying over the mouth of the chasm
    emblems: (k) => [{ el: 'geo', x: 960, y: 772, size: 440, sy: 0.42, al: 0.8, rev: k.at(k.L(0) + 2, 2), glow: 1.3 }],
    fx: { kind: 'ash', col: E.abyss, amount: 0.8 },
  },
  sakura: {
    sky: () => ({ top: hx('#05030c'), mid: hx('#1e1240'), hor: hx('#6a3a7a'), horY: 800, stars: 0.6, neb: 0.6, nebA: hx('#b48cff', 0.4), nebB: hx('#ff8ab0', 0.3), glow: [1040, 520, 260], glowCol: hx('#ff9ac0', 0.4) }),
    land: { layers: [
      LY((c) => S.ridge(c, 900, 360, 360, 121, 0.4), 0.7, hx('#0c0816'), hx('#c8a0ff', 0.7), { fog: 0.2 }),
      LY((c) => { S.torii(c, 700, 1000, 200, 170); S.ground(c, 1000, 4, 1); }, 1, hx('#060410'), hx('#ff9ac0', 0.8)),
    ] },
    back: (ink, k) => { ink.d = 0.7; drawTree(ink, SAKURA_GLOW, 1, hx('#ff9ac0', 1.2), hx('#ffc0d8', 1.4), k.t); ink.d = 1; },
    art: (ink, k) => { if (frameIdx(k.t) % 140 < 5) bolt(ink, [1300 + (frameIdx(k.t) % 9) * 40, -20], [1250, 420], mul(E.electro, 2.6), frameIdx(k.t) / 140 | 0, 0.8); },
    fx: { kind: 'motes', col: hx('#ff9ac0', 1.3), amount: 1.4 },
  },
  amrita: {
    sky: () => night({ top: hx('#02040a'), mid: hx('#0c1a30'), hor: hx('#2a4a5a'), horY: 760, stars: 1.2, milky: 0.8, neb: 0.4, nebA: hx('#4db6f5', 0.3), nebB: hx('#9cd84f', 0.2), seaY: 790, seaCol: hx('#1a5a6a'), seaLines: 1.6, glow: [980, 600, 200], glowCol: hx('#8af0e0', 0.4) }),
    land: { layers: [
      LY((c) => S.dunes(c, 780, 40, 200, 4), 0.5, hx('#141a24'), hx('#cfe0ff', 0.4), { fog: 0.4, hatch: 0.3 }),
      LY((c) => S.dunes(c, 1040, 70, 320, 8), 1, hx('#0a0e16'), hx('#8af0e0', 0.7), { hatch: 0.3 }),
    ] },
    back: (ink, k) => { ink.d = 0.65; drawTree(ink, LUMIN_TREE, 1, mixc(E.hydro, E.dendro, 0.5), E.goldHot, k.t); ink.d = 1; },
    fx: { kind: 'motes', col: mixc(E.hydro, E.dendro, 0.4), amount: 1 },
  },
  nightwar: {
    sky: (k) => ({ top: hx('#030104'), mid: hx('#1a0610'), hor: hx('#6a1a10'), horY: 820, stars: 0.4, neb: 0.6, nebA: hx('#7a3bd6', 0.4), nebB: hx('#ff6a30', 0.3), rift: [1400, 240, 380, 0.5 + 0.3 * Math.sin(k.t * 0.3)] }),
    land: { layers: [
      LY((c) => { S.ridge(c, 860, 140, 260, 131, 0.7); S.volcano(c, 500, 870, 420, 300, 9); }, 0.55, hx('#100406'), hx('#ff6a30', 0.6), { fog: 0.3 }),
      LY((c, r) => { S.ground(c, 1000, 8, 3); for (let i = 0; i < 6; i++) { c.beginPath(); c.ellipse(1250 + i * 110 + r() * 30, 990, 60 + r() * 40, 90 + r() * 60, 0, Math.PI, 0); c.fill(); } for (let i = 0; i < 7; i++) S.figure(c, 300 + i * 90, 1006, 120 + r() * 20, 'sword', 1); S.figure(c, 960, 1010, 170, 'torch', 1); }, 1, hx('#050203'), hx('#ff8040', 1.0)),
    ] },
    art: (ink, k) => {
      for (let i = 0; i < 6; i++) { const x = 1250 + i * 110; ink.dot([x - 14, 920], 3, mul(E.abyss, 4), 1); ink.dot([x + 14, 920], 3, mul(E.abyss, 4), 1); }
      for (let i = 0; i < 26; i++) { const h = hash(i, 81); const u = (k.t * (0.6 + h) + h) % 1; ink.dot([960 + 32 + Math.sin(k.t * 3 + i) * 14 * u, 1010 - 230 - u * 160], 3 * (1 - u), mul(E.pyro, 3), 1 - u); }
    },
    fx: { kind: 'embers', col: E.pyro, amount: 1.4 },
  },
  cubes: {
    sky: () => night({ top: hx('#010207'), mid: hx('#0a1030'), hor: hx('#202a48'), horY: 880, stars: 1.2, milky: 0.8, neb: 0.4, glow: [960, 180, 120], glowCol: hx('#ffe6b0', 0.6), rays: 0.6 }),
    art: (ink, k) => {
      const sep = smoothstep(k.L(1) - 0.5, k.L(1) + 4, k.t);
      sustainer(ink, 960, 215, 100, E.goldHot, k.t, 0.85);
      const pos: P2[] = [[lerp(860, 520, sep), lerp(520, 560, sep)], [lerp(1060, 1400, sep), lerp(520, 470, sep)]];
      pos.forEach(([x, y], i) => {
        cube(ink, x, y, 90, k.t * (0.3 + i * 0.1) + i, 0.5 + i * 0.3, mul(E.goldHot, 1.6), k.at(k.seg.start + i * 0.8, 1.5));
        const f = 0.55;
        ink.poly([[x, y - 40 * f], [x, y + 50 * f]], 3, mul(i ? E.cryo : E.goldHot, 1.5), 0.9);
        ink.circle(x, y - 52 * f, 9 * f, 2, mul(i ? E.cryo : E.goldHot, 1.5), 0.9);
      });
      // the thread between them stretching and breaking
      if (sep < 0.85) ink.poly([pos[0]!, [(pos[0]![0] + pos[1]![0]) / 2, 600], pos[1]!], 1, mul(E.bone, 1.2), 0.6 * (1 - sep));
    },
    fx: { kind: 'gold', col: E.gold, amount: 0.5 },
  },

  // ================================================================ VII aftermath
  abyssorder: {
    sky: () => ({ top: hx('#020104'), mid: hx('#0c0614'), hor: hx('#1a0a24'), horY: 900, stars: 0, neb: 0.5, nebA: hx('#7a3bd6', 0.4), glow: [960, 480, 220], glowCol: hx('#7a3bd6', 0.9) }),
    land: { layers: [
      LY((c, r) => { S.ruins(c, 100, 1820, 900, 380, r); S.arch(c, 960, 900, 700, 560, 40, 0); }, 0.6, hx('#06030a'), hx('#a578f0', 0.6), { fog: 0.2 }),
      LY((c) => { S.ground(c, 1010, 4, 2); for (let i = 0; i < 6; i++) S.figure(c, 640 + i * 130, 1016, 200 + (i % 2) * 20, 'stand', 1); }, 1, hx('#030105'), hx('#c890ff', 0.9)),
    ] },
    back: (ink, k) => {
      for (let i = 0; i < 12; i++) {
        const pts: P2[] = [];
        for (let s = 0; s <= 60; s++) { const a = s / 60 * Math.PI * 3 + k.t * 0.6 + i * Math.PI / 6; const r = 20 + s * 4.2; pts.push([960 + Math.cos(a) * r, 520 + Math.sin(a) * r * 0.9]); }
        ink.poly(pts, 1.2, mul(E.abyss, 1.6), 0.6);
      }
      rings(ink, 960, 520, 270, mul(E.crimson, 1.2), 0.5, -k.t * 2);
    },
    fx: { kind: 'ash', col: E.abyss, amount: 0.8 },
  },
  fatui: {
    sky: () => ({ top: hx('#05070c'), mid: hx('#2a3448'), hor: hx('#8a98b0'), horY: 700, stars: 0, neb: 0.2, clouds: 0.6, cloudY: 400, cloudCol: hx('#3a4458'), cloudLit: hx('#e0e8f8', 0.3) }),
    land: { layers: [
      LY((c, r) => { S.ground(c, 720, 2, 1); S.onion(c, 960, 720, 150, 480); S.onion(c, 700, 720, 90, 300); S.onion(c, 1220, 720, 90, 320); S.city(c, 300, 1620, 720, 220, r, 'block'); }, 0.5, hx('#2a3448'), hx('#e8f0ff', 0.6), { fog: 0.45 }),
      LY((c) => { S.ground(c, 1080, 1, 1); for (let row = 0; row < 5; row++) for (let i = 0; i < 26; i++) { const s = 0.5 + row * 0.13, x = 960 + (i - 12.5) * 66 * s, y = 820 + row * 52; c.fillRect(x - 9 * s, y - 50 * s, 18 * s, 50 * s); c.beginPath(); c.arc(x, y - 58 * s, 8 * s, 0, Math.PI * 2); c.fill(); } }, 1, hx('#0a0e16'), hx('#e0e8ff', 0.6), { hatch: 0.3 }),
    ] },
    art: (ink, k) => { for (let i = 0; i < 6; i++) { const x = 380 + i * 230; ink.d = 0.5; ink.seg([x, 420], [x, 700], 1.2, mul(E.bone, 0.8), 0.7); const pts: P2[] = []; for (let s = 0; s <= 10; s++) pts.push([x + s * 6 + Math.sin(k.t * 2 + s * 0.6 + i) * 4 * s / 10, 425 + s * 9]); ink.poly(pts, 10, mul(E.crimson, 0.9), 0.9); } ink.d = 1; },
    fx: { kind: 'snow', col: E.bone, amount: 1.4 },
  },
  euthymia: {
    sky: () => ({ top: hx('#05020c'), mid: hx('#1a0c34'), hor: hx('#3a1a5a'), horY: 900, stars: 0.5, neb: 0.7, nebA: hx('#b48cff', 0.4), nebB: hx('#ff8ab0', 0.2), glow: [960, 620, 300], glowCol: hx('#b48cff', 0.25) }),
    land: { layers: [
      LY((c) => { c.beginPath(); c.ellipse(960, 880, 300, 34, 0, 0, Math.PI * 2); c.fill(); S.figure(c, 960, 868, 230, 'sit', 1); }, 1, hx('#0a0614'), hx('#d0b0ff', 1.0), { hatch: 0.2 }),
    ] },
    art: (ink, k) => {
      if (frameIdx(k.t) % 150 < 4) bolt(ink, [400 + (frameIdx(k.t) % 11) * 100, -20], [520 + (frameIdx(k.t) % 7) * 120, 500], mul(E.electro, 1.6), frameIdx(k.t) / 150 | 0, 0.5);
      // Furina's stage (the second line): a spotlight cone and a lone figure
      const s = k.at(k.L(1), 1.5) * (1 - k.at(k.L(2), 1));
      ink.poly([[1500, -40], [1380, 860]], 1.2, mul(E.hydro, 1.4), s * 0.7); ink.poly([[1540, -40], [1640, 860]], 1.2, mul(E.hydro, 1.4), s * 0.7);
      ink.poly([[1380, 860], [1640, 860]], 1.4, mul(E.hydro, 1.6), s);
      ink.circle(1510, 760, 10, 1.6, mul(E.hydro, 2), s); ink.poly([[1510, 770], [1494, 850], [1526, 850], [1510, 770]], 1.6, mul(E.hydro, 2), s);
      // Nahida's cage (the third line)
      const n = k.at(k.L(2), 1.5);
      for (let i = 0; i < 9; i++) { const x = 330 + i * 26; ink.seg([x, 620], [x, 860], 1.2, mul(E.dendro, 1.4), n * 0.8); }
      ink.poly([[320, 620], [450, 560], [540, 620]], 1.4, mul(E.dendro, 1.4), n); ink.circle(435, 780, 9, 1.6, mul(E.dendro, 2), n);
    },
    fx: { kind: 'motes', col: hx('#ff9ac0', 1.2), amount: 1 },
  },
  sleeping: {
    sky: () => night({ top: hx('#010207'), mid: hx('#0a1430'), hor: hx('#3a3a58'), horY: 860, stars: 1.2, milky: 0.8, neb: 0.4, clouds: 0.8, cloudY: 840, cloudCol: hx('#0c1020'), cloudLit: hx('#e8c47e', 0.4), glow: [960, 360, 280], glowCol: hx('#e8c47e', 0.18) }),
    land: { layers: [
      LY((c) => S.floatingIsland(c, 960, 430, 760, 380, 3), 0.55, hx('#0a0c18'), hx('#ffe6b0', 0.8), { fog: 0.1 }),
    ], light: [960, 200] },
    back: (ink, k) => { ink.d = 0.55; for (let i = 0; i < 3; i++) { const pts: P2[] = Array.from({ length: 121 }, (_, j) => { const a = j / 120 * Math.PI * 2 + k.t * (0.05 + i * 0.02); return [960 + Math.cos(a) * (520 + i * 70), 470 + Math.sin(a) * (70 + i * 14)] as P2; }); ink.poly(pts, 1, mul(E.gold, 0.8), 0.35); } ink.d = 1; },
    fx: { kind: 'stars', col: E.bone, amount: 0.4 },
  },

  // ================================================================ VIII traveler
  awaken: {
    sky: () => ({ top: hx('#0a1430'), mid: hx('#3a5a8a'), hor: hx('#ffc890', 1.1), horY: 700, stars: 0.2, neb: 0.2, nebA: hx('#ffd0a0', 0.2), glow: [1240, 690, 200], glowCol: hx('#ffe0b0', 0.9), rays: 0.8, clouds: 0.5, cloudY: 560, cloudCol: hx('#3a4060'), cloudLit: hx('#ffd0a0', 0.9) }),
    land: { layers: [
      LY((c) => S.ridge(c, 720, 90, 260, 141, 0.6), 0.3, hx('#4a5a7a'), hx('#ffe0b0', 0.4), { fog: 0.6, hatch: 0.2 }),
      LY((c) => S.ridge(c, 820, 120, 320, 142, 0.5), 0.6, hx('#2a3450'), hx('#ffe0b0', 0.6), { fog: 0.4, hatch: 0.3 }),
      LY((c) => { c.beginPath(); c.moveTo(-200, 1300); c.lineTo(-200, 900); c.quadraticCurveTo(400, 860, 820, 930); c.lineTo(880, 1300); c.closePath(); c.fill(); S.figure(c, 620, 900, 150, 'stand', 1); S.companion(c, 700, 760, 14); }, 1, hx('#0a0c16'), hx('#ffe6b0', 1.0)),
    ], light: [1240, 690], fog: hx('#c8a890') },
    fx: { kind: 'motes', col: mixc(E.anemo, E.goldHot, 0.5), amount: 0.8 },
  },
  j_mondstadt: {
    sky: () => ({ top: hx('#0a2a50'), mid: hx('#3a7ab0'), hor: hx('#d0eaf0'), horY: 760, stars: 0, neb: 0.2, nebA: hx('#ffffff', 0.2), clouds: 0.4, cloudY: 500, cloudCol: hx('#8ab0d0'), cloudLit: hx('#ffffff', 0.5), seaY: 840, seaCol: hx('#2a5a7a'), glow: [1500, 260, 160], glowCol: hx('#fff0d0', 0.6) }),
    land: { layers: [
      LY((c) => S.ridge(c, 800, 120, 260, 151, 0.4), 0.4, hx('#4a7a8a'), hx('#e0fff0', 0.4), { fog: 0.6, hatch: 0.2 }),
      LY((c, r) => { S.ground(c, 850, 2, 1); S.city(c, 760, 1180, 850, 150, r, 'gothic'); S.spire(c, 960, 852, 60, 330); S.windmill(c, 700, 856, 110, r() * 3); S.windmill(c, 1250, 856, 120, 1); }, 0.75, hx('#1a3040'), hx('#e0fff0', 0.8), { fog: 0.25 }),
    ] },
    art: (ink, k) => wyvern(ink, 600 + k.lt * 40, 330 + Math.sin(k.t * 0.8) * 30, 110, Math.sin(k.t * 2.4), mul(E.anemo, 1.6), 1),
    fx: { kind: 'motes', col: mul(E.bone, 1.2), amount: 1 },
    post: () => ({ bloom: 0.45 }),
  },
  j_liyue: {
    sky: () => night({ top: hx('#03040a'), mid: hx('#141a30'), hor: hx('#4a3a2a'), horY: 780, stars: 0.8, neb: 0.3, nebA: hx('#f2b54a', 0.2), seaY: 820, seaCol: hx('#141a24') }),
    land: { layers: [
      LY((c, r) => { for (let i = 0; i < 9; i++) S.pillar(c, 100 + i * 220 + r() * 60, 800, 60 + r() * 40, 220 + r() * 200, i + 40); }, 0.45, hx('#0e0c10'), hx('#f2c06a', 0.4), { fog: 0.45 }),
      LY((c, r) => { S.ground(c, 830, 2, 1); S.city(c, 300, 1650, 830, 120, r, 'east'); S.pagoda(c, 1150, 830, 120, 4, 50); }, 0.8, hx('#08070a'), hx('#ffc070', 0.8)),
    ] },
    art: (ink, k) => lanterns(ink, 120, k.t, hx('#ffb050', 1), 200, 1700, 840, 4),
    fx: { kind: 'motes', col: E.goldHot, amount: 0.5 },
  },
  j_inazuma: {
    sky: () => ({ top: hx('#05030c'), mid: hx('#24123e'), hor: hx('#5a3a7a'), horY: 800, stars: 0, neb: 0.6, nebA: hx('#b48cff', 0.4), clouds: 0.8, cloudY: 280, cloudCol: hx('#0a0614'), cloudLit: hx('#d0b0ff', 1) }),
    land: { layers: [
      LY((c) => { S.ridge(c, 830, 120, 260, 161, 0.6); S.pagoda(c, 1400, 830, 150, 5, 56); }, 0.6, hx('#0c0818'), hx('#c8a0ff', 0.7), { fog: 0.3 }),
      LY((c) => { c.beginPath(); c.moveTo(-200, 1300); c.lineTo(-200, 960); c.lineTo(760, 940); c.lineTo(820, 1300); c.closePath(); c.fill(); S.figure(c, 520, 944, 130, 'sword', 1); }, 1, hx('#05030a'), hx('#e0c8ff', 1.0)),
    ] },
    art: (ink, k) => {
      const te = k.seg.start + 3.5;
      if (k.t < te) { if (frameIdx(k.t) % 50 < 6) bolt(ink, [1300, -20], [1100, 820], mul(E.electro, 3), frameIdx(k.t) / 50 | 0, 1, 3); }
      else { const d = k.t - te; ink.glow([[560 - 200, 1000 + 100], [1700, -100]], 3 + 4 * Math.exp(-d), mul(E.goldHot, 4 * Math.exp(-d * 0.8)), Math.exp(-d * 0.6)); }
    },
    fx: { kind: 'rain', col: E.bone, amount: 0.9 },
    post: (k) => { const d = k.t - k.seg.start - 3.5; return { flash: d > 0 && d < 1 ? 0.8 * Math.exp(-d * 5) : 0 }; },
  },
  j_sumeru: {
    sky: () => ({ top: hx('#04100a'), mid: hx('#123a28'), hor: hx('#6ab070'), horY: 820, stars: 0.4, neb: 0.5, nebA: hx('#9cd84f', 0.3), nebB: hx('#62d6b8', 0.3), glow: [960, 360, 260], glowCol: hx('#c8ff90', 0.35) }),
    land: { layers: [
      LY((c, r) => { for (let i = 0; i < 14; i++) S.tree(c, i * 150 + r() * 50, 860, 220 + r() * 160, 'round', r); S.ground(c, 840, 6, 2); }, 0.5, hx('#0a1a10'), hx('#9cd84f', 0.5), { fog: 0.4 }),
      LY((c, r) => { c.beginPath(); c.moveTo(900, 1100); c.quadraticCurveTo(930, 860, 940, 640); c.lineTo(980, 640); c.quadraticCurveTo(990, 860, 1020, 1100); c.closePath(); c.fill(); S.city(c, 860, 1060, 660, 60, r, 'dome'); }, 0.8, hx('#06100a'), hx('#c8ff90', 0.8)),
    ] },
    back: (ink, k) => { ink.d = 0.8; drawTree(ink, SUMERU_TREE, 1, mul(E.dendro, 1.3), mixc(E.dendro, E.goldHot, 0.5), k.t); ink.d = 1; },
    fx: { kind: 'motes', col: mixc(E.dendro, E.goldHot, 0.4), amount: 1.6 },
  },
  j_fontaine: {
    sky: () => night({ top: hx('#02040a'), mid: hx('#0c1830'), hor: hx('#2a3a5a'), horY: 780, stars: 0.3, neb: 0.3, seaY: 820, seaCol: hx('#0e2440'), seaLines: 1.5, clouds: 0.6, cloudY: 300, cloudCol: hx('#060a14'), cloudLit: hx('#8ad0ff', 0.5) }),
    land: { layers: [
      LY((c, r) => { S.city(c, 200, 1720, 820, 160, r, 'belle'); }, 0.5, hx('#0a1220'), hx('#a8d8ff', 0.5), { fog: 0.4 }),
      LY((c) => { S.rect(c, 960, 830, 520, 140); S.dome(c, 960, 692, 170); for (let i = 0; i < 8; i++) S.rect(c, 740 + i * 63, 830, 14, 180); S.spire(c, 720, 700, 30, 120); S.spire(c, 1200, 700, 30, 120); }, 0.8, hx('#060a14'), hx('#ffe6b0', 0.8)),
    ] },
    art: (ink, k) => { ink.d = 0.8; for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + Math.sin(k.t * 0.4 + i * 2) * 0.35; ink.glow([[960 + (i - 1) * 140, 560], [960 + (i - 1) * 140 + Math.cos(a) * 900, 560 + Math.sin(a) * 900]], 2, mul(E.hydro, 0.8), 0.5); } ink.d = 1; },
    fx: { kind: 'rain', col: E.bone, amount: 1.2 },
  },
  j_dragon: {
    sky: (k) => ({ top: hx('#02060c'), mid: hx('#10283a'), hor: hx('#5a8aa0'), horY: 800, stars: 0, neb: 0.3, nebA: hx('#4db6f5', 0.3), clouds: 0.8 * (1 - k.at(k.seg.start + 0.5, 2.5)) + 0.2, cloudY: 300, cloudCol: hx('#081018'), cloudLit: hx('#cfefff', 0.35), glow: [960, 260, 260], glowCol: hx('#cfefff', 0.6 * k.at(k.seg.start + 0.5, 2.5)), rays: 0.8, seaY: 830, seaCol: hx('#0e2a40') }),
    land: { layers: [ LY((c, r) => S.city(c, 100, 1820, 840, 120, r, 'belle'), 0.5, hx('#081420'), hx('#a8d8ff', 0.5), { fog: 0.4 }) ] },
    art: (ink, k) => { const u = k.at(k.seg.start, 3.2); dragon(ink, (s) => [960 + Math.sin(k.t * 0.6 + s * 3) * 80 * s, lerp(1000, 380, u) + s * 700], hx('#e0f6ff', 1.8), { flap: Math.sin(k.t * 1.5) }); },
    fx: { kind: 'rain', col: E.bone, amount: 1.4 },
    post: () => ({ bloom: 0.7 }),
  },
  j_natlan: {
    sky: () => night({ top: hx('#030104'), mid: hx('#1a0a10'), hor: hx('#6a2a14'), horY: 820, stars: 1, neb: 0.4, nebA: hx('#ff6a30', 0.3), nebB: hx('#f2b54a', 0.2) }),
    land: { layers: [
      LY((c) => { S.ridge(c, 860, 120, 260, 171, 0.6); S.volcano(c, 1500, 870, 380, 300, 7); }, 0.5, hx('#100604'), hx('#ff7240', 0.6), { fog: 0.3 }),
      LY((c, r) => { S.ground(c, 960, 6, 3); for (let i = 0; i < 30; i++) S.figure(c, 300 + i * 46 + r() * 10, 966, 60 + r() * 14, i % 4 ? 'stand' : 'torch'); }, 1, hx('#050202'), hx('#ff9050', 0.9)),
    ] },
    art: (ink, k) => {
      ink.d = 0.75;
      const pts: P2[] = Array.from({ length: 161 }, (_, i) => { const a = i / 160 * Math.PI * 2; return [960 + Math.cos(a) * 420, 600 + Math.sin(a) * 110] as P2; });
      ink.glow(pts, 3, mul(E.pyro, 2), 1, k.at(k.seg.start + 0.5, 2.5));
      for (let i = 0; i < 80; i++) { const a = i / 80 * Math.PI * 2, h = hash(i, 91); const u = (k.t * (0.5 + h) + h) % 1; ink.dot([960 + Math.cos(a) * 420, 600 + Math.sin(a) * 110 - u * 90], 2.4 * (1 - u), mul(E.pyro, 3), (1 - u) * k.at(k.seg.start + 0.5, 2.5)); }
      ink.d = 1;
    },
    fx: { kind: 'embers', col: E.pyro, amount: 1 },
  },
  nodkrai: {
    sky: () => night({ top: hx('#01030a'), mid: hx('#0a1834'), hor: hx('#3a5a80'), horY: 780, stars: 1, neb: 0.3, aurora: 1, auroraA: hx('#a9e6f4'), auroraB: hx('#b48cff'), moons: [{ x: 1280, y: 420, r: 220, col: hx('#e8f0ff', 1.1), maria: 0.8 }], seaY: 800, seaCol: hx('#0c2034'), seaLines: 1.4 }),
    land: { layers: [
      LY((c, r) => { for (let i = 0; i < 40; i++) S.tree(c, i * 30 + r() * 10, 820, 70 + r() * 60, 'pine', r); S.ground(c, 815, 4, 2); }, 0.5, hx('#0a1424'), hx('#cfe8ff', 0.5), { fog: 0.4 }),
      LY((c) => { c.beginPath(); c.moveTo(-200, 1300); c.lineTo(-200, 920); c.quadraticCurveTo(200, 880, 520, 950); c.lineTo(560, 1300); c.closePath(); c.fill(); S.lighthouse(c, 260, 905, 240); }, 1, hx('#050a14'), hx('#e0f0ff', 0.9)),
    ] },
    art: (ink, k) => {
      for (let i = 0; i < 14; i++) { const h = hash(i, 101); const x = 700 + h * 1100, y = 860 + hash(i, 102) * 160 + Math.sin(k.t + i) * 4; const s = 6 + 10 * hash(i, 103); ink.glow([[x - s, y], [x, y - s * 0.6], [x + s, y], [x, y + s * 0.4]], 1.2, mul(E.cryo, 1.6 + Math.sin(k.t * 2 + i)), 0.9, 1, true); }
      ink.d = 1; const a = k.t * 0.8; ink.glow([[260, 685], [260 + Math.cos(a) * 900, 685 + Math.sin(a) * 120]], 2, mul(E.goldHot, 0.9), 0.4 * Math.max(0, Math.cos(a)));
    },
    fx: { kind: 'snow', col: E.bone, amount: 0.6 },
  },
  snezhnaya: {
    sky: () => ({ top: hx('#05080e'), mid: hx('#2a3448'), hor: hx('#8090a8'), horY: 760, stars: 0, neb: 0.3, nebA: hx('#ffffff', 0.15), clouds: 0.9, cloudY: 340, cloudCol: hx('#1a2030'), cloudLit: hx('#cfe0f0', 0.3) }),
    land: { layers: [
      LY((c, r) => { S.ground(c, 780, 2, 1); S.onion(c, 1250, 780, 110, 380); S.onion(c, 1100, 780, 70, 250); S.onion(c, 1400, 780, 74, 260); S.city(c, 900, 1700, 780, 160, r, 'block'); }, 0.45, hx('#3a4458'), hx('#ffd8a0', 0.6), { fog: 0.6 }),
      LY((c) => { S.dunes(c, 1000, 40, 300, 3); S.figure(c, 560, 990, 120, 'stand', 1); S.companion(c, 620, 880, 10); }, 1, hx('#0e121c'), hx('#e8f0ff', 0.8), { hatch: 0.3 }),
    ] },
    art: (ink, k) => { ink.d = 0.45; for (let i = 0; i < 50; i++) { const h = hash(i, 111); ink.dot([920 + h * 760, 640 + hash(i, 112) * 120], 1.8, mul(hx('#ffb060'), 1.5 + 0.5 * Math.sin(k.t * 2 + i)), 0.8); } ink.d = 1; },
    fx: { kind: 'snow', col: E.bone, amount: 2.2 },
  },

  // ================================================================ epilogue
  'diagram:cycles': {
    sky: () => night({ top: hx('#02030a'), mid: hx('#0a1130'), hor: hx('#22283e'), horY: 900, stars: 0.9, milky: 0.6, milkyAngle: -0.4, neb: 0.45, nebA: hx('#4db6f5', 0.22), nebB: hx('#e8c47e', 0.2) }),
    art: (ink, k) => {
      const [cx, cy] = CYC_C, TAU = Math.PI * 2, top = -Math.PI / 2;
      const base = k.at(k.seg.chapter.cardEnd - 1.5, 3);
      const told = k.at(k.say('水仙十字结社'), 1.5);                  // the society is named: the root lights
      const doom = k.at(k.say('不会再有'), 1.5);
      // the root: four quadrants in a small circle
      const rc = mul(E.goldHot, 1.4);
      ink.circle(cx, cy, 24, 1.2, rc, (0.4 + 0.6 * told) * base);
      ink.poly([[cx - 24, cy], [cx + 24, cy]], 1, rc, (0.3 + 0.6 * told) * base);
      ink.poly([[cx, cy - 24], [cx, cy + 24]], 1, rc, (0.3 + 0.6 * told) * base);
      ink.dot([cx, cy], 5, mul(E.goldHot, 3), (0.5 + 0.5 * told) * base);
      // 「一次又一次的覆灭与重来」: a light runs round every ring until the society is named
      const run = base * (1 - told);
      CYCLES.forEach((c, i) => {
        const a = k.t * (1.1 - i * 0.18) + i * 1.7;
        ink.glow(arcPts(cx, cy, c.r, a, a + 0.7, 24), 1.3, mul(c.col, 1.6), 0.7 * run);
      });
      // 「人会在一轮又一轮的轮回中不断完善」: a spiral out from the root through the rings
      const sp: P2[] = Array.from({ length: 281 }, (_, j) => { const s = j / 280, a = top + s * TAU * 3.5; return [cx + Math.cos(a) * lerp(30, 326, s), cy + Math.sin(a) * lerp(30, 326, s)] as P2; });
      ink.poly(sp, 0.8, mul(E.gold, 0.9), 0.3 * told * (1 - 0.6 * k.at(k.say('亥珀波瑞亚'), 2)), k.at(k.say('一轮又一轮'), 3.5), false, 1.4);
      CYCLES.forEach((c, i) => {
        const half = i === 3, span = half ? Math.PI : TAU;
        const lit = k.at(k.say(c.name), 1.3), ts = k.say(c.key);
        const flash = k.t > ts ? Math.exp(-(k.t - ts) * 1.2) : 0;
        const col = mul(c.col, 1.2 + 2 * flash);
        // faint outline from the start (the fourth: its first half), lit and inscribed as the cycle is named
        ink.poly(arcPts(cx, cy, c.r, top, top + span, half ? 90 : 180), 0.8, mul(c.col, 0.6), 0.3 * base);
        ink.glow(arcPts(cx, cy, c.r, top, top + span, half ? 90 : 180), 1.4 + flash, col, 0.9, lit);
        const sym = 0.8 * lit;
        if (i === 0) for (let j = 0; j < 8; j++) {            // Hyperborea: frost stars (a world frozen, paradise lost)
          const a = top + j * TAU / 8 + 0.2, px = cx + Math.cos(a) * c.r, py = cy + Math.sin(a) * c.r;
          for (let q = 0; q < 3; q++) { const b = q * Math.PI / 3 + a; ink.seg([px - Math.cos(b) * 8, py - Math.sin(b) * 8], [px + Math.cos(b) * 8, py + Math.sin(b) * 8], 1, col, sym); }
        }
        if (i === 1) for (let j = 0; j < 12; j++) {           // Natlantean: scales turned outward (the dragon overcome)
          const a = top + j * TAU / 12 + 0.13, P = (r: number, d: number): P2 => [cx + Math.cos(a + d) * r, cy + Math.sin(a + d) * r];
          ink.poly([P(c.r - 4, -0.06), P(c.r + 11, 0), P(c.r - 4, 0.06)], 1.1, col, sym);
        }
        if (i === 2) {                                         // Remuria: a wave round the ring (the flood)
          const w: P2[] = Array.from({ length: 241 }, (_, j) => { const a = top + j / 240 * TAU; const r = c.r + 7 * Math.sin(a * 16 + k.t * 0.8); return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as P2; });
          ink.poly(w, 0.9, col, 0.6 * lit, lit);
        }
        if (half) {                                            // Khraun-Arya: ticks on the half drawn, a head at "now"
          for (let j = 0; j <= 36; j++) {
            const a = top + j * Math.PI / 36, l = j % 6 === 0 ? 12 : 5;
            ink.seg([cx + Math.cos(a) * c.r, cy + Math.sin(a) * c.r], [cx + Math.cos(a) * (c.r - l), cy + Math.sin(a) * (c.r - l)], 0.8, col, 0.6 * smoothstep(j / 36 - 0.05, j / 36, lit));
          }
          const now: P2 = [cx + Math.cos(top + Math.PI * lit) * c.r, cy + Math.sin(top + Math.PI * lit) * c.r];
          ink.dot(now, 6 + 1.5 * Math.sin(k.t * 3), mul(E.goldHot, 3), lit);
          // the half not yet run: dotted, until the reckoning says no cycle comes after this one
          for (let j = 1; j < 30; j++) { const a = top + Math.PI + j * Math.PI / 30; ink.dot([cx + Math.cos(a) * c.r, cy + Math.sin(a) * c.r], 2, mul(E.gold, 1.6), 0.8 * lit * (1 - doom)); }
        }
        // the label's leader
        const [p, e, x] = cycleLeader(i);
        ink.poly([p, e, x], 0.8, mul(c.col, 0.9), 0.6, k.at(k.say(c.name) + 0.2, 0.8));
      });
      // 「用他推导出的『世界式』反复推演」: a hand sweeping round and round
      const calc = k.at(k.say('世界式'), 0.6) * (1 - doom);
      if (calc > 0) {
        const a0 = (k.t - k.say('世界式')) * 2.4 + top;
        for (let q = 0; q < 6; q++) { const a = a0 - q * 0.05; ink.seg([cx + Math.cos(a) * 30, cy + Math.sin(a) * 30], [cx + Math.cos(a) * 360, cy + Math.sin(a) * 360], 1, mul(E.goldHot, 1.4), calc * (0.6 - q * 0.1)); }
      }
      // 「除非，引入系统之外的『变量』」: a light from outside the rings, coming to rest by the half not yet run
      const tv = k.say('除非');
      if (k.t > tv) {
        const u = ease.outCubic(clamp((k.t - tv) / 2.6, 0, 1));
        const a = top + Math.PI * 1.75, dest: P2 = [cx + Math.cos(a) * 380, cy + Math.sin(a) * 380];
        const at = (v: number): P2 => [lerp(80, dest[0], v), lerp(-60, dest[1], v) - 90 * Math.sin(Math.PI * v)];
        const tail: P2[] = Array.from({ length: 14 }, (_, j) => at(Math.max(0, u - j * 0.02)));
        ink.glow(tail, 1.6, mul(E.bone, 2), 0.8 * (1 - 0.7 * smoothstep(0.8, 1, u)));
        ink.dot(at(u), 6 + 1.5 * Math.sin(k.t * 2.4), mul([1, 0.95, 0.85] as RGB, 4), 1);
        ink.dot(at(u), 22, mul(E.goldHot, 0.25), 1);
      }
    },
    ui: (c, k) => {
      const head = k.at(k.say('水仙十字结社'), 1);
      if (head > 0) {
        const [x, y] = project(k.cam, 960, 118, 1);
        c.globalAlpha = head * k.w; c.textAlign = 'center';
        c.font = font(F.serif(700), 26); c.fillStyle = '#E9C47E'; c.fillText('水仙十字结社 · 根源之轮', x, y);
      }
      CYCLES.forEach((cy_, i) => {
        const al = k.at(k.say(cy_.name) + 0.4, 0.8);
        if (al <= 0) return;
        const [, , X] = cycleLeader(i), left = Math.cos(cy_.ang) < 0;
        const [x, y] = project(k.cam, X[0] + (left ? -16 : 16), X[1], 1);
        c.globalAlpha = al * k.w; c.textAlign = left ? 'right' : 'left';
        c.font = font(F.serif(700), 34); c.fillStyle = '#EEE6D3'; c.fillText(cy_.name, x, y + 10);
        c.font = font(F.sans(500), 18); c.fillStyle = cy_.css; c.fillText(cy_.en, x, y + 38);
        const m = k.at(k.say(cy_.key), 0.6);
        if (m > 0) { c.globalAlpha = m * k.w; c.font = font(F.serif(600), 22); c.fillStyle = '#E9C47E'; c.fillText(cy_.mean, x, y + 70); }
      });
      c.globalAlpha = 1;
    },
    fx: { kind: 'stars', col: E.bone, amount: 0.4 },
  },
  ruins_sky: {
    sky: (k) => night({ top: hx('#010207'), mid: hx('#081432'), hor: hx('#1e2c4a'), horY: 840, stars: 1.4, milky: 1.2, milkyAngle: -0.4, neb: 0.4, shell: 0.35, crack: 0.06 + 0.1 * k.at(k.seg.start, 12), crackCol: hx('#ffe6b0', 0.7) }),
    land: { layers: [
      LY((c) => S.ridge(c, 880, 120, 300, 181, 0.6), 0.5, hx('#060a16'), hx('#8aa8e8', 0.5), { fog: 0.4 }),
      LY((c, r) => { S.ruins(c, 200, 1200, 960, 260, r); S.arch(c, 1500, 960, 300, 280, 22, 0.6); S.ground(c, 955, 6, 3); }, 1, hx('#03050c'), hx('#cfe0ff', 0.8)),
    ] },
    back: (ink) => { ink.d = 0.45; nail(ink, 1560, 180, 1000, 34, mul(E.gold, 1.1), 0.8, -0.06, { spin: 0.3 }); ink.d = 1; },
    fx: { kind: 'stars', col: E.bone, amount: 0.4 },
  },
  irminsul_end: {
    sky: (k) => night({ top: hx('#020610'), mid: hx('#062031'), hor: hx('#0d3a48'), horY: 820, stars: 1, neb: 0.8, nebA: hx('#1f8a8f', 0.55), nebB: hx('#e8c47e', 0.3), glow: [960, 520, 380], glowCol: hx('#57d6c8', 0.3 + 0.05 * Math.sin(k.t)) }),
    back: (ink, k) => { ink.d = 0.6; drawTree(ink, IRMIN, 1, mul(E.anemo, 1.25), mixc(E.goldHot, E.anemo, 0.3), k.t); ink.d = 1; },
    land: { layers: [
      LY((c) => S.ridge(c, 920, 120, 300, 3, 0.6), 0.5, hx('#06131c'), hx('#3fbfb0', 0.7), { fog: 0.45 }),
      LY((c) => { c.beginPath(); c.moveTo(-200, 1300); c.lineTo(-200, 1000); c.quadraticCurveTo(700, 930, 1300, 1000); c.lineTo(2120, 1020); c.lineTo(2120, 1300); c.closePath(); c.fill(); S.figure(c, 780, 972, 110, 'stand', 1); S.companion(c, 830, 880, 9); }, 1, hx('#03080d'), hx('#ffe6b0', 0.9)),
    ] },
    fx: { kind: 'motes', col: mixc(E.goldHot, E.anemo, 0.4), amount: 1.4 },
  },
  endcard: {
    sky: () => night({ top: hx('#010207'), mid: hx('#040a18'), hor: hx('#081428'), horY: 900, stars: 1, milky: 0.6, neb: 0.3 }),
    art: (ink, k) => { rings(ink, 960, 470, 420, mul(E.gold, 0.6), 0.2, k.t, smoothstep(0, 3, k.lt)); },   // faint: the sources are set over it
    fx: { kind: 'motes', col: E.gold, amount: 0.5 },
  },
};

// unused helpers kept for scenes that may want them
void fbm1; void noise1;
