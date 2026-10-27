// Line art: everything drawn as glowing strokes on top of the land (dragons, the world tree, nails, sigils, chess
// pieces, cubes, moon shards, rings) and the particles. Plate coordinates (logical px, y down) go through the
// camera at a parallax depth; colours are linear and may exceed 1 (they bloom).
import { LineBatch } from '../engine/lines';
import { clamp, fbm1, hash, lerp, mulberry32, noise1, noise2, smoothstep } from '../engine/util';
import { project, type Cam } from './_film';
import type { RGB } from './_sky';

export type P2 = [number, number];
const TAU = Math.PI * 2;

export class Ink {
  d = 1;           // parallax depth of what is being drawn
  fade = 1;        // global alpha multiplier (picture dissolves are done by the compositor; this is for local fades)
  constructor(public lb: LineBatch, public cam: Cam) {}
  get z() { return 1 + (this.cam.zoom - 1) * this.d; }
  P(x: number, y: number): P2 { return project(this.cam, x, y, this.d); }
  seg(a: P2, b: P2, w: number, c: RGB, al = 1) {
    if (al * this.fade <= 0.002) return;
    const [ax, ay] = this.P(a[0], a[1]), [bx, by] = this.P(b[0], b[1]);
    this.lb.seg2(ax, ay, bx, by, w * this.z, c, clamp(al * this.fade, 0, 1));
  }
  /** Polyline; `frac` draws only the first part of its length (inscription), with a hot head. */
  poly(pts: P2[], w: number, c: RGB, al = 1, frac = 1, closed = false, head = 0) {
    const ps = closed ? [...pts, pts[0]!] : pts;
    if (frac >= 1) { for (let i = 1; i < ps.length; i++) this.seg(ps[i - 1]!, ps[i]!, w, c, al); return; }
    if (frac <= 0) return;
    let L = 0;
    const ls: number[] = [0];
    for (let i = 1; i < ps.length; i++) { L += Math.hypot(ps[i]![0] - ps[i - 1]![0], ps[i]![1] - ps[i - 1]![1]); ls.push(L); }
    const stop = L * frac;
    for (let i = 1; i < ps.length; i++) {
      if (ls[i - 1]! >= stop) break;
      const a = ps[i - 1]!, b = ps[i]!;
      if (ls[i]! <= stop) this.seg(a, b, w, c, al);
      else {
        const k = (stop - ls[i - 1]!) / Math.max(1e-6, ls[i]! - ls[i - 1]!);
        const e: P2 = [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];
        this.seg(a, e, w, c, al);
        if (head > 0) this.dot(e, w * 2.2, [c[0] * head, c[1] * head, c[2] * head], al);
      }
    }
  }
  dot(p: P2, r: number, c: RGB, al = 1) { this.seg(p, [p[0] + 0.01, p[1]], r * 2, c, al); }
  circle(x: number, y: number, r: number, w: number, c: RGB, al = 1, frac = 1, n = 96, a0 = -Math.PI / 2) {
    const pts: P2[] = [];
    const m = Math.max(2, Math.ceil(n * frac));
    for (let i = 0; i <= m; i++) { const a = a0 + TAU * frac * (i / m); pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    this.poly(pts, w, c, al);
  }
  /** A glowing stroke: a wide faint halo under a thin bright core. */
  glow(pts: P2[], w: number, c: RGB, al = 1, frac = 1, closed = false) {
    this.poly(pts, w * 4, [c[0] * 0.12, c[1] * 0.12, c[2] * 0.12], al, frac, closed);
    this.poly(pts, w, c, al, frac, closed, 1.6);
  }
}

export const mul = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const mixc = (a: RGB, b: RGB, k: number): RGB => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

// ------------------------------------------------------------------ dragons

/**
 * An eastern serpent dragon along a spine `spine(s)` (s: 0 head .. 1 tail), drawn as two flanks, belly scales,
 * a dorsal crest, a horned head, whiskers and four small limbs. `w` = max body half-width.
 */
export function serpent(ink: Ink, spine: (s: number) => P2, w: number, col: RGB, o: { reveal?: number; seed?: number; al?: number; dark?: boolean } = {}) {
  const N = 90, rev = o.reveal ?? 1, al = o.al ?? 1, seed = o.seed ?? 1;
  const pts: P2[] = [], nrm: P2[] = [], wid: number[] = [];
  for (let i = 0; i <= N; i++) {
    const s = i / N;
    pts.push(spine(s));
  }
  for (let i = 0; i <= N; i++) {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(N, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    nrm.push([-dy / L, dx / L]);
    const s = i / N;
    wid.push(w * (s < 0.08 ? lerp(0.55, 1, s / 0.08) : Math.pow(1 - (s - 0.08) / 0.92, 0.75)) * (0.92 + 0.08 * Math.sin(s * 40)));
  }
  const n = Math.max(2, Math.floor(N * rev));
  const L: P2[] = [], R: P2[] = [];
  for (let i = 0; i <= n; i++) {
    L.push([pts[i]![0] + nrm[i]![0] * wid[i]!, pts[i]![1] + nrm[i]![1] * wid[i]!]);
    R.push([pts[i]![0] - nrm[i]![0] * wid[i]!, pts[i]![1] - nrm[i]![1] * wid[i]!]);
  }
  const core = o.dark ? mul(col, 0.5) : col;
  ink.glow(L, 1.6, core, al);
  ink.glow(R, 1.2, mul(core, 0.8), al);
  // belly scales: chevrons pointing to the head
  for (let i = 3; i < n - 1; i += 2) {
    const c = pts[i]!, f = pts[i - 2]!, k = wid[i]! * 0.85;
    const l: P2 = [c[0] + nrm[i]![0] * k, c[1] + nrm[i]![1] * k], r: P2 = [c[0] - nrm[i]![0] * k, c[1] - nrm[i]![1] * k];
    const m: P2 = [lerp(c[0], f[0], 0.55), lerp(c[1], f[1], 0.55)];
    ink.seg(l, m, 0.9, mul(core, 0.45), al);
    ink.seg(m, r, 0.9, mul(core, 0.45), al);
  }
  // dorsal crest
  for (let i = 5; i < n - 6; i += 5) {
    const c = L[i]!, h = wid[i]! * (0.55 + 0.35 * Math.abs(noise1(i * 0.7, seed)));
    const tip: P2 = [c[0] + nrm[i]![0] * h + (pts[i + 2]![0] - pts[i]![0]) * 0.8, c[1] + nrm[i]![1] * h + (pts[i + 2]![1] - pts[i]![1]) * 0.8];
    ink.seg(c, tip, 1.1, core, al * 0.9);
    ink.seg(tip, L[i + 2]!, 0.9, mul(core, 0.7), al * 0.9);
  }
  // limbs
  for (const s of [0.16, 0.42]) {
    const i = Math.floor(N * s); if (i > n) continue;
    for (const sg of [1, -1]) {
      const b: P2 = [pts[i]![0] - nrm[i]![0] * wid[i]! * sg * 0.9, pts[i]![1] - nrm[i]![1] * wid[i]! * sg * 0.9];
      const k: P2 = [b[0] - nrm[i]![0] * w * 1.3 * sg + (pts[i + 3]![0] - pts[i]![0]), b[1] - nrm[i]![1] * w * 1.3 * sg + (pts[i + 3]![1] - pts[i]![1])];
      const f: P2 = [k[0] + (pts[i - 2]![0] - pts[i]![0]) * 0.8, k[1] + (pts[i - 2]![1] - pts[i]![1]) * 0.8 - w * 0.2];
      ink.poly([b, k, f], 1.3, core, al);
      for (let c = -1; c <= 1; c++) ink.seg(f, [f[0] + (f[0] - k[0]) * 0.3 + c * w * 0.18, f[1] + (f[1] - k[1]) * 0.3 + w * 0.15], 0.9, core, al);
    }
  }
  // head
  const h0 = pts[0]!, dir: P2 = [pts[0]![0] - pts[3]![0], pts[0]![1] - pts[3]![1]];
  const dl = Math.hypot(dir[0], dir[1]) || 1; const fx = dir[0] / dl, fy = dir[1] / dl;
  const nx = -fy, ny = fx, hw = w * 1.15;
  const H = (a: number, b: number): P2 => [h0[0] + fx * a * hw + nx * b * hw, h0[1] + fy * a * hw + ny * b * hw];
  ink.glow([H(-0.5, 0.8), H(0.6, 0.75), H(1.9, 0.35), H(2.3, 0.05), H(2.0, -0.25), H(1.2, -0.55), H(0.3, -0.75), H(-0.5, -0.8)], 1.5, core, al);
  ink.dot(H(1.0, 0.38), 2.2, mul(col, 2.5), al);
  // horns sweeping back, whiskers trailing
  ink.poly([H(0.2, 0.7), H(-0.6, 1.4), H(-1.6, 1.7), H(-2.3, 1.5)], 1.4, core, al);
  ink.poly([H(0.0, 0.6), H(-0.9, 1.0), H(-1.7, 0.95)], 1.1, core, al);
  for (const sg of [1, -1]) {
    const wh: P2[] = [];
    for (let k = 0; k <= 16; k++) {
      const u = k / 16;
      const b = pts[Math.min(n, Math.floor(u * 10))]!;
      wh.push([lerp(H(2.0, 0.3 * sg)[0], b[0] + nrm[0]![0] * w * 1.6 * sg, u) + Math.sin(u * 7 + seed) * w * 0.3, lerp(H(2.0, 0.3 * sg)[1], b[1] + nrm[0]![1] * w * 1.6 * sg, u) + Math.cos(u * 5 + seed) * w * 0.3]);
    }
    ink.poly(wh, 0.9, mul(core, 0.8), al);
  }
}

/** A winged western dragon (Dvalin, Durin): body, neck, tail and two flapping wings. */
export function wyvern(ink: Ink, x: number, y: number, s: number, flap: number, col: RGB, facing = 1, al = 1) {
  const F = (a: number, b: number): P2 => [x + a * s * facing, y + b * s];
  const c = col;
  // body & neck & tail
  ink.glow([F(-0.9, 0.05), F(-0.4, -0.12), F(0.3, -0.1), F(0.75, -0.3), F(1.05, -0.55), F(1.35, -0.6)], 1.6, c, al);
  ink.glow([F(-0.9, 0.05), F(-0.3, 0.2), F(0.35, 0.12), F(0.75, -0.15), F(1.1, -0.45), F(1.4, -0.48)], 1.3, mul(c, 0.8), al);
  ink.glow([F(-0.9, 0.05), F(-1.6, 0.22), F(-2.3, 0.15), F(-2.9, -0.05), F(-3.2, -0.25)], 1.3, c, al);
  ink.poly([F(1.35, -0.6), F(1.62, -0.55), F(1.42, -0.46), F(1.4, -0.48)], 1.4, c, al);
  ink.poly([F(1.32, -0.62), F(1.18, -0.82), F(1.05, -0.86)], 1.1, c, al);
  ink.dot(F(1.42, -0.55), 2, mul(c, 2.5), al);
  // wings: a shoulder, an elbow, four fingers; flap moves the elbow up/down
  for (const side of [1, -1]) {
    const k = side === 1 ? 1 : 0.7;
    const sh = F(0.25, -0.15);
    const el = F(0.0 + 0.2 * side, -0.9 * k - flap * 0.7 * k);
    const tipBase = -1.7 * k - flap * 1.3 * k;
    const tips = [F(-0.3, tipBase - 0.2), F(-0.9, tipBase + 0.1), F(-1.4, tipBase + 0.55), F(-1.6, tipBase + 1.0)];
    ink.glow([sh, el], 1.6, c, al);
    for (const tp of tips) ink.poly([el, tp], 1.1, c, al);
    const mem: P2[] = [el, tips[0]!, [lerp(tips[0]![0], tips[1]![0], 0.5), lerp(tips[0]![1], tips[1]![1], 0.5) + 0.12 * s], tips[1]!, [lerp(tips[1]![0], tips[2]![0], 0.5), lerp(tips[1]![1], tips[2]![1], 0.5) + 0.12 * s], tips[2]!,
      [lerp(tips[2]![0], tips[3]![0], 0.5), lerp(tips[2]![1], tips[3]![1], 0.5) + 0.1 * s], tips[3]!, F(-0.6, -0.05)];
    ink.poly(mem, 0.9, mul(c, 0.7), al);
  }
}

// ------------------------------------------------------------------ the world tree

export interface Branch { a: P2; b: P2; w: number; depth: number; t0: number; t1: number }

/** Irminsul: a branching structure (and roots below), each branch with its own growth window in 0..1. */
export function makeTree(x: number, y: number, h: number, seed: number, depthMax = 7, roots = true): Branch[] {
  const rnd = mulberry32(seed);
  const out: Branch[] = [];
  const grow = (p: P2, ang: number, len: number, w: number, d: number, t0: number, up: boolean) => {
    const bend = (rnd() - 0.5) * 0.35;
    const q: P2 = [p[0] + Math.cos(ang + bend) * len, p[1] + Math.sin(ang + bend) * len];
    const dur = 0.16 + 0.05 * (depthMax - d) / depthMax;
    out.push({ a: p, b: q, w, depth: d, t0, t1: t0 + dur });
    if (d >= depthMax) return;
    const n = d < 2 ? 3 : 2 + (rnd() < 0.35 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const spread = (up ? 0.55 : 0.7) * (1 + d * 0.06);
      const a2 = ang + bend + (k - (n - 1) / 2) * spread + (rnd() - 0.5) * 0.3;
      const pull = up ? -Math.PI / 2 : Math.PI / 2;
      const aa = lerp(a2, pull, up ? 0.08 : 0.25);
      grow(q, aa, len * (0.7 + rnd() * 0.16), w * 0.68, d + 1, t0 + dur * 0.85, up);
    }
  };
  grow([x, y], -Math.PI / 2, h * 0.26, h * 0.022, 0, 0, true);
  if (roots) for (let k = 0; k < 5; k++) grow([x + (k - 2) * h * 0.01, y], Math.PI / 2 + (k - 2) * 0.55, h * 0.14, h * 0.012, 2, 0.05, false);
  const T = Math.max(...out.map((b) => b.t1));
  for (const b of out) { b.t0 /= T; b.t1 /= T; }
  return out;
}

/** Draw a tree grown to `g` (0..1), with leaves of light on the outer twigs. */
export function drawTree(ink: Ink, tree: Branch[], g: number, col: RGB, leaf: RGB, t: number, al = 1) {
  for (const b of tree) {
    const k = clamp((g - b.t0) / (b.t1 - b.t0), 0, 1);
    if (k <= 0) continue;
    const e: P2 = [lerp(b.a[0], b.b[0], k), lerp(b.a[1], b.b[1], k)];
    const bright = 0.6 + 0.4 * (1 - b.depth / 8);
    ink.seg(b.a, e, b.w * 3.2, mul(col, 0.07 * bright), al);
    ink.seg(b.a, e, Math.max(0.8, b.w), mul(col, bright), al);
    if (k < 1) ink.dot(e, Math.max(1.2, b.w * 0.8), mul(col, 3), al);
    else if (b.depth >= 5 && b.b[1] < b.a[1] + 5) {
      const h = hash(b.b[0], b.b[1]);
      const tw = 0.6 + 0.4 * Math.sin(t * (0.8 + h * 2) + h * 30);
      ink.dot(b.b, 1.6 + h * 2.2, mul(leaf, (1.2 + h * 1.6) * tw), al * smoothstep(b.t1, b.t1 + 0.08, g));
    }
  }
}

// ------------------------------------------------------------------ heavenly things

/** A Celestial Nail: a long tapered spike from (x, y0) to its tip at (x, y1), banded, with a light core. */
export function nail(ink: Ink, x: number, y0: number, y1: number, w: number, col: RGB, al = 1, tilt = 0) {
  const P = (u: number, s: number): P2 => [x + tilt * (y1 - y0) * u + s * w * (1 - u) * (u < 0.04 ? u / 0.04 : 1), lerp(y0, y1, u)];
  const L: P2[] = [], R: P2[] = [], C: P2[] = [];
  for (let i = 0; i <= 30; i++) { const u = i / 30; L.push(P(u, -1)); R.push(P(u, 1)); C.push(P(u, 0)); }
  ink.glow(L, 1.6, col, al); ink.glow(R, 1.6, col, al);
  ink.poly(C, w * 0.5, mul(col, 0.25), al);
  ink.poly(C, 1.2, mul(col, 2.2), al);
  for (const u of [0.05, 0.1, 0.22, 0.4]) ink.seg(P(u, -1.15), P(u, 1.15), 1.3, col, al);
}

/** A wireframe cube (Asmoday's prison / the heavens' geometry), rotating. */
export function cube(ink: Ink, cx: number, cy: number, s: number, ry: number, rx: number, col: RGB, al = 1) {
  const V: [number, number, number][] = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) V.push([x, y, z]);
  const pr = ([x, y, z]: [number, number, number]): P2 => {
    const x1 = x * Math.cos(ry) + z * Math.sin(ry), z1 = -x * Math.sin(ry) + z * Math.cos(ry);
    const y1 = y * Math.cos(rx) - z1 * Math.sin(rx), z2 = y * Math.sin(rx) + z1 * Math.cos(rx);
    const f = 1 / (1 + z2 * 0.12);
    return [cx + x1 * s * f, cy + y1 * s * f];
  };
  const P = V.map(pr);
  for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
    const d = Math.abs(V[i]![0] - V[j]![0]) + Math.abs(V[i]![1] - V[j]![1]) + Math.abs(V[i]![2] - V[j]![2]);
    if (d === 2) ink.glow([P[i]!, P[j]!], 1.3, col, al);
  }
}

const CHESS: Record<string, [number, number][]> = { // (radius, height) profiles, base to top, unit height
  pawn: [[0.42, 0], [0.42, 0.06], [0.3, 0.1], [0.22, 0.14], [0.12, 0.45], [0.2, 0.5], [0.12, 0.54], [0.2, 0.62], [0.22, 0.72], [0.18, 0.82], [0.08, 0.88], [0, 0.89]],
  rook: [[0.45, 0], [0.45, 0.07], [0.32, 0.12], [0.25, 0.2], [0.22, 0.62], [0.3, 0.66], [0.32, 0.86], [0.24, 0.86], [0.24, 0.8], [0.12, 0.8], [0.12, 0.86], [0, 0.86]],
  bishop: [[0.43, 0], [0.43, 0.06], [0.3, 0.11], [0.2, 0.18], [0.12, 0.55], [0.22, 0.6], [0.12, 0.63], [0.2, 0.72], [0.2, 0.84], [0.1, 0.94], [0.05, 0.97], [0, 1.0]],
  queen: [[0.46, 0], [0.46, 0.06], [0.33, 0.11], [0.22, 0.2], [0.13, 0.62], [0.26, 0.66], [0.15, 0.69], [0.3, 0.88], [0.2, 0.86], [0.16, 0.93], [0.06, 0.96], [0.07, 1.0], [0, 1.03]],
  king: [[0.46, 0], [0.46, 0.06], [0.33, 0.11], [0.22, 0.2], [0.14, 0.62], [0.26, 0.66], [0.15, 0.69], [0.24, 0.85], [0.1, 0.9], [0.04, 0.93], [0.04, 0.98], [0.1, 0.98], [0.1, 1.02], [0.04, 1.02], [0.04, 1.08], [0, 1.08]],
  knight: [],
};

/** A chess piece outline standing on (x, y), height h (the Gnoses are cast like chess pieces). */
export function chess(ink: Ink, kind: string, x: number, y: number, h: number, col: RGB, al = 1, frac = 1) {
  let pts: P2[];
  if (kind === 'knight') {
    const K: P2[] = [[-0.42, 0], [-0.42, -0.06], [-0.28, -0.12], [-0.24, -0.3], [-0.3, -0.5], [-0.22, -0.7], [-0.05, -0.86], [0.08, -0.92], [0.12, -0.84],
      [0.3, -0.7], [0.4, -0.58], [0.36, -0.5], [0.2, -0.54], [0.06, -0.46], [0.22, -0.3], [0.28, -0.12], [0.42, -0.06], [0.42, 0]];
    pts = K.map(([a, b]) => [x + a * h, y + b * h]);
  } else {
    const prof = CHESS[kind]!;
    const Lh: P2[] = prof.map(([r, v]) => [x - r * h, y - v * h]);
    const Rh: P2[] = prof.slice().reverse().map(([r, v]) => [x + r * h, y - v * h]);
    pts = [...Lh, ...Rh];
  }
  ink.glow(pts, 1.5, col, al, frac, true);
}

/** Sigils of the Four Shades (life, death, time, space) and the seven elements: our own geometric marks. */
export function sigil(ink: Ink, kind: string, x: number, y: number, r: number, col: RGB, al = 1, frac = 1, t = 0) {
  const C = (rr: number, f = frac) => ink.circle(x, y, rr, 1.3, col, al, f);
  const G = (pts: P2[], closed = false) => ink.glow(pts.map(([a, b]) => [x + a * r, y + b * r] as P2), 1.4, col, al, frac, closed);
  switch (kind) {
    case 'life': C(r); G([[0, 0.7], [0, -0.1]]); G([[0, 0.2], [-0.35, -0.2], [-0.3, -0.5]]); G([[0, 0.05], [0.35, -0.35], [0.28, -0.62]]); G([[0, -0.1], [0, -0.55]]); break;
    case 'death': C(r); G(Array.from({ length: 25 }, (_, i) => { const a = Math.PI * 0.25 + Math.PI * 1.5 * i / 24; return [Math.cos(a) * 0.62, Math.sin(a) * 0.62] as P2; })); G([[0.05, -0.75], [0.05, 0.75]]); G([[-0.2, 0.45], [0.3, 0.45]]); break;
    case 'time': C(r); C(r * 0.7); G([[-0.4, -0.5], [0.4, -0.5], [-0.4, 0.5], [0.4, 0.5]], true); G([[0, -0.85], [0, -0.7]]); G([[0, 0.7], [0, 0.85]]);
      G([[0, 0], [Math.cos(t * 0.6) * 0.55, Math.sin(t * 0.6) * 0.55]]); break;
    case 'space': C(r); { const s = 0.62; for (const k of [0, 1]) { const a = k * Math.PI / 4 + t * 0.1; G([0, 1, 2, 3].map((i) => [Math.cos(a + i * Math.PI / 2) * s, Math.sin(a + i * Math.PI / 2) * s] as P2), true); } } break;
    case 'anemo': C(r); G(Array.from({ length: 40 }, (_, i) => { const u = i / 39, a = u * TAU * 1.4; return [Math.cos(a) * 0.65 * u, Math.sin(a) * 0.65 * u] as P2; })); break;
    case 'geo': C(r); G([[0, -0.7], [0.55, 0], [0, 0.7], [-0.55, 0]], true); G([[0, -0.7], [0, 0.7]]); G([[-0.55, 0], [0.55, 0]]); break;
    case 'electro': C(r); G([[0, -0.72], [0.62, 0.38], [-0.62, 0.38]], true); G([[0.1, -0.35], [-0.12, 0.05], [0.12, 0.05], [-0.1, 0.4]]); break;
    case 'dendro': C(r); G([[0, 0.7], [-0.45, 0.05], [0, -0.7], [0.45, 0.05]], true); G([[0, 0.7], [0, -0.45]]); G([[0, 0.1], [-0.25, -0.12]]); G([[0, 0.25], [0.25, 0.03]]); break;
    case 'hydro': C(r); G([[0, -0.72], [0.4, -0.05], [0.42, 0.25], [0.2, 0.55], [0, 0.6], [-0.2, 0.55], [-0.42, 0.25], [-0.4, -0.05]], true); G([[-0.3, 0.22], [-0.1, 0.12], [0.1, 0.3], [0.3, 0.2]]); break;
    case 'pyro': C(r); G([[0, 0.65], [-0.38, 0.35], [-0.32, -0.1], [-0.12, -0.35], [-0.08, -0.05], [0.05, -0.72], [0.3, -0.3], [0.4, 0.2], [0.25, 0.5]], true); break;
    case 'cryo': C(r); for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3; G([[Math.cos(a) * 0.7, Math.sin(a) * 0.7], [-Math.cos(a) * 0.7, -Math.sin(a) * 0.7]]); }
      for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3, m: P2 = [Math.cos(a) * 0.42, Math.sin(a) * 0.42]; G([[m[0] + Math.cos(a + 0.9) * 0.18, m[1] + Math.sin(a + 0.9) * 0.18], m, [m[0] + Math.cos(a - 0.9) * 0.18, m[1] + Math.sin(a - 0.9) * 0.18]]); } break;
  }
}

/** Astrolabe rings with ticks (the record's frame for diagrams and cards). */
export function rings(ink: Ink, x: number, y: number, r: number, col: RGB, al = 1, t = 0, frac = 1) {
  ink.circle(x, y, r, 1.0, col, al * 0.8, frac, 180, -Math.PI / 2 + t * 0.02);
  ink.circle(x, y, r * 1.06, 0.7, col, al * 0.45, frac, 180, -Math.PI / 2 - t * 0.015);
  const n = 72;
  for (let i = 0; i < n * frac; i++) {
    const a = -Math.PI / 2 + TAU * i / n + t * 0.02;
    const l = i % 6 === 0 ? 14 : 6;
    ink.seg([x + Math.cos(a) * r, y + Math.sin(a) * r], [x + Math.cos(a) * (r - l), y + Math.sin(a) * (r - l)], 0.8, col, al * 0.6);
  }
}

// ------------------------------------------------------------------ moon shards

interface Shard { poly: P2[]; c: P2; dir: P2; spin: number; speed: number }
const shardCache = new Map<string, Shard[]>();

function clipHalf(poly: P2[], px: number, py: number, nx: number, ny: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!, b = poly[(i + 1) % poly.length]!;
    const da = (a[0] - px) * nx + (a[1] - py) * ny, db = (b[0] - px) * nx + (b[1] - py) * ny;
    if (da <= 0) out.push(a);
    if ((da < 0) !== (db < 0)) { const k = da / (da - db); out.push([lerp(a[0], b[0], k), lerp(a[1], b[1], k)]); }
  }
  return out;
}

/** Voronoi shards of a unit disc (cached per seed). */
function shardsOf(seed: number, n = 16): Shard[] {
  const key = `${seed}:${n}`;
  const hit = shardCache.get(key); if (hit) return hit;
  const rnd = mulberry32(seed);
  const pts: P2[] = [];
  while (pts.length < n) { const x = rnd() * 2 - 1, y = rnd() * 2 - 1; if (x * x + y * y < 0.95) pts.push([x, y]); }
  const disc: P2[] = Array.from({ length: 48 }, (_, i) => [Math.cos(TAU * i / 48), Math.sin(TAU * i / 48)]);
  const out = pts.map((p, i) => {
    let poly = disc;
    pts.forEach((q, j) => {
      if (i === j) return;
      const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2;
      poly = clipHalf(poly, mx, my, q[0] - p[0], q[1] - p[1]);
    });
    const c: P2 = poly.reduce((s, v) => [s[0] + v[0] / poly.length, s[1] + v[1] / poly.length] as P2, [0, 0] as P2);
    const L = Math.hypot(c[0], c[1]) || 1;
    return { poly, c, dir: [c[0] / L, c[1] / L] as P2, spin: (rnd() - 0.5) * 2, speed: 0.5 + rnd() };
  });
  shardCache.set(key, out);
  return out;
}

/** A moon breaking apart: `k` 0 (whole) .. 1 (scattered); fragments drift out and spin, hatched faces. */
export function shatter(ink: Ink, x: number, y: number, r: number, k: number, col: RGB, seed: number, al = 1) {
  for (const s of shardsOf(seed)) {
    const off = k * k * r * 2.2 * s.speed, rot = s.spin * k * 1.6;
    const ox = x + s.dir[0] * off + s.c[0] * r, oy = y + s.dir[1] * off + s.c[1] * r;
    const pts: P2[] = s.poly.map(([a, b]) => {
      const u = (a - s.c[0]) * r, v = (b - s.c[1]) * r;
      return [ox + u * Math.cos(rot) - v * Math.sin(rot), oy + u * Math.sin(rot) + v * Math.cos(rot)];
    });
    const a = al * (1 - smoothstep(0.75, 1, k) * 0.6);
    ink.glow(pts, 1.3, mul(col, 1 + 2 * (1 - k)), a, 1, true);
    // a few hatch lines across the face
    for (let h = -2; h <= 2; h++) {
      const u0: P2 = [ox - r * 0.5, oy + h * r * 0.08], u1: P2 = [ox + r * 0.5, oy + h * r * 0.08];
      void u0; void u1;
    }
    // glowing crack light between the shards early on
    if (k < 0.4) ink.dot([ox, oy], r * 0.05, mul(col, 3 * (0.4 - k)), a);
  }
}

// ------------------------------------------------------------------ the Abyss

/** Violet tendrils: streamlines of a slowly turning flow, rising from (x, y) over width w. */
export function tendrils(ink: Ink, x: number, y: number, w: number, h: number, t: number, col: RGB, n = 40, al = 1, seed = 3) {
  for (let i = 0; i < n; i++) {
    const r = hash(i, seed);
    let px = x + (r - 0.5) * w, py = y;
    const pts: P2[] = [[px, py]];
    const steps = 26;
    for (let k = 0; k < steps; k++) {
      const a = -Math.PI / 2 + 1.6 * noise2(px / 260 + seed, py / 260 + t * 0.07, seed) + 0.4 * Math.sin(t * 0.3 + i);
      px += Math.cos(a) * h / steps; py += Math.sin(a) * h / steps;
      pts.push([px, py]);
    }
    const life = 0.5 + 0.5 * Math.sin(t * 0.4 + r * 20);
    ink.poly(pts, 1.1 + r * 1.2, mul(col, 0.6 + life), al * (0.25 + 0.5 * life));
  }
}

// ------------------------------------------------------------------ particles

/** Deterministic particle fields in plate space. kind: motes | embers | snow | ash | rain | gold | bubbles | stars */
export function particles(ink: Ink, kind: string, t: number, col: RGB, amount = 1, seed = 7) {
  const N = Math.round((kind === 'rain' ? 320 : kind === 'snow' ? 420 : 220) * amount);
  const W = 1920 + 340, H = 1080 + 340;
  for (let i = 0; i < N; i++) {
    const h1 = hash(i, seed), h2 = hash(i, seed + 1), h3 = hash(i, seed + 2), h4 = hash(i, seed + 3);
    const depth = 0.35 + 0.65 * h3;
    let x = 0, y = 0, w = 1, len = 0, a = 1, c = col;
    switch (kind) {
      case 'snow': {
        const v = 26 + 50 * depth;
        y = ((h2 * H + t * v) % H) - 170;
        x = ((h1 * W + Math.sin(t * 0.6 + h4 * 9) * 30 + t * 12 * depth) % W) - 170;
        w = 1.2 + 2.6 * depth; a = 0.35 + 0.5 * depth; break;
      }
      case 'ash': {
        const v = 10 + 26 * depth;
        y = ((h2 * H + t * v) % H) - 170;
        x = ((h1 * W + Math.sin(t * 0.4 + h4 * 9) * 50) % W) - 170;
        w = 1 + 2 * depth; a = 0.25 + 0.4 * depth; break;
      }
      case 'embers': {
        const v = 30 + 60 * depth;
        y = H - ((h2 * H + t * v) % H) - 170;
        x = ((h1 * W + Math.sin(t * 1.3 + h4 * 9) * 40 + fbm1(t * 0.2 + i, 2) * 60) % W) - 170;
        w = 1 + 2.4 * depth; a = (0.4 + 0.6 * depth) * (0.6 + 0.4 * Math.sin(t * 6 + h4 * 50));
        c = mul(col, 1.5 + 2 * h4); break;
      }
      case 'rain': {
        const v = 900 + 600 * depth;
        y = ((h2 * H + t * v) % H) - 170;
        x = ((h1 * W - t * v * 0.18) % W + W) % W - 170;
        w = 0.8 + 0.8 * depth; len = 24 + 30 * depth; a = 0.18 + 0.25 * depth; break;
      }
      case 'bubbles': {
        const v = 14 + 30 * depth;
        y = H - ((h2 * H + t * v) % H) - 170;
        x = ((h1 * W + Math.sin(t * 0.9 + h4 * 9) * 18) % W) - 170;
        w = 1.4 + 3 * depth; a = 0.3 + 0.4 * depth; break;
      }
      case 'gold': {
        const v = 8 + 20 * depth;
        y = ((h2 * H + t * v) % H) - 170;
        x = ((h1 * W + Math.sin(t * 0.5 + h4 * 9) * 40) % W) - 170;
        w = 1 + 2.2 * depth; a = (0.3 + 0.5 * depth) * (0.5 + 0.5 * Math.sin(t * 2 + h4 * 40)); c = mul(col, 1.2 + h4 * 2); break;
      }
      case 'stars': {
        x = h1 * 1920; y = h2 * 700; w = 1 + 1.6 * h3; a = 0.2 + 0.5 * (0.5 + 0.5 * Math.sin(t * (1 + h4 * 3) + h4 * 60)); break;
      }
      default: { // motes: slow drifting glimmers
        x = ((h1 * W + t * (6 + 10 * depth) + Math.sin(t * 0.3 + h4 * 9) * 30) % W) - 170;
        y = ((h2 * H - t * (4 + 8 * depth) + H * 10) % H) - 170;
        w = 1.2 + 2.6 * depth * h4; a = (0.25 + 0.55 * depth) * (0.4 + 0.6 * Math.max(0, Math.sin(t * (0.5 + h4) + h3 * 40)));
        c = mul(col, 1 + h4 * 2.5);
      }
    }
    ink.d = depth;
    if (len > 0) ink.seg([x, y], [x - len * 0.18, y - len], w, c, a);
    else ink.dot([x, y], w * 0.5, c, a);
  }
  ink.d = 1;
}
