// Line art: everything drawn as glowing strokes on top of the land (western dragons, the world tree, nails, sigils, chess
// pieces, cubes, moon shards, rings) and the particles. Plate coordinates (logical px, y down) go through the
// camera at a parallax depth; colours are linear and may exceed 1 (they bloom).
import { LineBatch } from '../engine/lines';
import { clamp, fbm1, hash, lerp, mulberry32, noise2, smoothstep } from '../engine/util';
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

/** Piecewise-linear profile through (u, value) knots. */
const knots = (k: [number, number][]) => (u: number) => {
  let i = 1; while (i < k.length - 1 && k[i]![0] < u) i++;
  const [u0, v0] = k[i - 1]!, [u1, v1] = k[i]!; return lerp(v0, v1, clamp((u - u0) / (u1 - u0), 0, 1));
};
// side view: back and belly offsets (units of W): snout, skull, jaw, slim neck, deep chest, hips, tail
const BACK = knots([[0, 0.05], [0.015, 0.22], [0.04, 0.5], [0.06, 0.44], [0.078, 0.28], [0.12, 0.25], [0.18, 0.32], [0.25, 0.75], [0.32, 0.9], [0.4, 0.75], [0.47, 0.48], [0.6, 0.28], [0.8, 0.14], [1, 0.03]]);
const BELLY = knots([[0, 0.05], [0.015, 0.14], [0.035, 0.3], [0.055, 0.42], [0.078, 0.28], [0.12, 0.27], [0.18, 0.38], [0.25, 0.95], [0.32, 1.3], [0.4, 1], [0.47, 0.5], [0.6, 0.26], [0.8, 0.12], [1, 0.03]]);
// top view: half-width
const HALF = knots([[0, 0.2], [0.025, 0.5], [0.045, 0.62], [0.068, 0.42], [0.1, 0.32], [0.17, 0.36], [0.24, 0.85], [0.32, 1.05], [0.4, 0.95], [0.45, 0.62], [0.5, 0.5], [0.7, 0.24], [1, 0.05]]);

/**
 * A western dragon (Teyvat's dragons are horned, four-legged and bat-winged) along a spine `spine(s)` (s: 0 snout ..
 * 1 tail tip). Proportions come from the spine's length: horned head, slim neck, deep torso carrying the wings and four
 * legs, a long tail ending in a spade. `side`: seen side-on, wings raised over the back (near and far wing), legs
 * hanging — for flight across the frame; otherwise seen from above/below with the wings spread symmetrically — for
 * climbing or diving. `flap` −1..1 swings the wings; `reveal` draws it from the snout back.
 */
export function dragon(ink: Ink, spine: (s: number) => P2, col: RGB, o: { reveal?: number; al?: number; dark?: boolean; flap?: number; side?: boolean } = {}) {
  const rev = o.reveal ?? 1, al = o.al ?? 1, flap = o.flap ?? 0;
  const core = o.dark ? mul(col, 0.5) : col;
  // resample the spine by arc length
  const M = 160, raw: P2[] = Array.from({ length: M + 1 }, (_, i) => spine(i / M)), cum = [0];
  for (let i = 1; i <= M; i++) cum.push(cum[i - 1]! + Math.hypot(raw[i]![0] - raw[i - 1]![0], raw[i]![1] - raw[i - 1]![1]));
  const Ltot = cum[M]! || 1, W = Ltot / 20;
  const at = (u: number): P2 => {
    const d = clamp(u, 0, 1) * Ltot; let i = 1;
    while (i < M && cum[i]! < d) i++;
    const k = (d - cum[i - 1]!) / Math.max(1e-6, cum[i]! - cum[i - 1]!);
    return [lerp(raw[i - 1]![0], raw[i]![0], k), lerp(raw[i - 1]![1], raw[i]![1], k)];
  };
  const fwd = (u: number): P2 => { const a = at(u + 0.01), b = at(u - 0.01), L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
  // a point in the body's frame at u: f along the body (toward the head), n across, both in units of W
  const B = (u: number, f: number, n: number): P2 => { const p = at(u), t = fwd(u); return [p[0] + (t[0] * f - t[1] * n) * W, p[1] + (t[1] * f + t[0] * n) * W]; };
  const n = 90, end = Math.max(0.02, rev);
  // the membrane between a wing's fingertips (scalloped toward the wrist) back to its root on the body, faintly ruled
  const membrane = (wrist: P2, tips: P2[], root: P2, a: number) => {
    const edge: P2[] = [tips[0]!];
    for (let i = 1; i <= tips.length; i++) {
      const p = tips[i - 1]!, q = i < tips.length ? tips[i]! : root;
      edge.push(lerp2(lerp2(p, q, 0.5), wrist, i < tips.length ? 0.14 : 0.1), q);
    }
    ink.glow(edge, 1.0, mul(core, 0.85), a);
    for (let i = 0; i < 18; i++) {
      const x = i / 17 * (edge.length - 1), j = Math.min(edge.length - 2, Math.floor(x));
      const q = lerp2(edge[j]!, edge[j + 1]!, x - j);
      ink.seg(lerp2(wrist, q, 0.12), lerp2(wrist, q, 0.96), 0.6, mul(core, 0.22), a);
    }
  };
  const spade = (V: (u: number, f: number, v: number) => P2) => { if (rev >= 1) ink.glow([V(0.965, 0, 0.08), V(0.975, 0.1, 0.6), V(1, -0.8, 0), V(0.975, 0.1, -0.6), V(0.965, 0, -0.08)], 1.2, core, al); };

  if (o.side) {
    // "up" is whichever side of the body faces the top of the frame; sig fades to 0 when the torso points up/down
    // (wings and legs are then seen edge-on), its sign keeps the body's back on top
    const sig = clamp(-fwd(0.3)[0] * 2.5, -1, 1), sg = sig >= 0 ? 1 : -1;
    const S = (u: number, f: number, v: number) => B(u, f, sg * v), Q = (u: number, f: number, v: number) => B(u, f, sig * v);
    const top = Array.from({ length: n + 1 }, (_, i) => { const u = end * i / n; return S(u, 0, BACK(u)); });
    const bot = Array.from({ length: n + 1 }, (_, i) => { const u = end * i / n; return S(u, 0, -BELLY(u)); });
    ink.glow([...top.reverse(), S(0, 0.15, 0), ...bot], 1.5, core, al);
    ink.poly([S(0.003, 0, -0.02), S(0.035, 0, -0.1), S(0.05, 0, -0.05)], 0.9, mul(core, 0.8), al);       // mouth
    ink.dot(S(0.028, 0, 0.17), 0.1 * W + 1, mul(col, 2.6), al);
    ink.glow([S(0.045, 0, 0.4), S(0.045, -0.8, 0.85), S(0.045, -1.7, 1.05), S(0.045, -2.3, 0.95)], 1.3, core, al);
    ink.poly([S(0.055, 0, 0.36), S(0.055, -0.6, 0.62), S(0.055, -1.1, 0.6)], 1.1, mul(core, 0.8), al);
    for (let u = 0.08; u < Math.min(end, 0.88); u += 0.032) {                                  // spines along the back
      const h = 0.12 + 0.22 * Math.sin(Math.PI * clamp((u - 0.08) / 0.6, 0, 1));
      ink.poly([S(u, 0.15, BACK(u)), S(u, -0.35, BACK(u) + h), S(u - 0.012, 0, BACK(u - 0.012))], 0.9, mul(core, 0.75), al);
    }
    for (let u = 0.2; u < Math.min(end, 0.62); u += 0.02) ink.seg(S(u, 0, -BELLY(u) * 0.55), S(u - 0.008, 0, -BELLY(u)), 0.7, mul(core, 0.35), al);
    ink.poly(Array.from({ length: 22 }, (_, i) => { const u = 0.2 + 0.42 * i / 21; return S(u, 0, -BELLY(u) * 0.55); }), 0.7, mul(core, 0.35), al);
    // legs hanging, tucked back in flight (a wide faint stroke gives them flesh); the far pair dimmer, a little ahead
    const limb = (pts: P2[], th: number, a: number) => {
      for (let i = 1; i < pts.length; i++) ink.seg(pts[i - 1]!, pts[i]!, th * W * (1 - 0.25 * i), mul(core, 0.16), a);
      ink.glow(pts, 1.2, core, a);
    };
    for (const [df, a] of [[0.4, 0.45], [0, 1]] as [number, number][]) {
      const fu = 0.27, hu = 0.42;
      if (end >= fu) {
        const sh = S(fu, df, -BELLY(fu) * 0.55), el = Q(fu, df - 0.5, -(BELLY(fu) + 0.6)), wr = Q(fu, df - 1.0, -(BELLY(fu) + 1.1));
        limb([sh, el, wr], 0.42, al * a);
        for (const c of [-0.18, 0, 0.18]) ink.seg(wr, Q(fu, df - 1.3 + c, -(BELLY(fu) + 1.3)), 0.9, core, al * a);
      }
      if (end >= hu) {
        const hp = S(hu, df, -BELLY(hu) * 0.4), kn = Q(hu, df + 0.4, -(BELLY(hu) + 0.55)), hk = Q(hu, df - 0.45, -(BELLY(hu) + 0.95)), ft = Q(hu, df - 0.95, -(BELLY(hu) + 1.25));
        limb([hp, kn, hk, ft], 0.6, al * a);
        for (const c of [-0.18, 0, 0.18]) ink.seg(ft, Q(hu, df - 1.25 + c, -(BELLY(hu) + 1.4)), 0.9, core, al * a);
      }
    }
    // wings raised over the back: built in the wing's own (forward, up) plane, turned about the root by the flap
    const wa = al * smoothstep(0.3, 0.5, end), Sp = 0.42 * Ltot / W, phi = 0.35 - 0.75 * flap;
    if (wa > 0.01) for (const [k, df, dv, a] of [[0.82, 0.35, 0.18, 0.5], [1, 0, 0, 1]] as [number, number, number, number][]) {
      const ru = 0.25, p0 = S(ru, df, BACK(ru) + dv), t = fwd(ru), nn: P2 = [-t[1], t[0]];   // root on the back line
      const Wg = (fa: number, ub: number): P2 => {
        const fr = (fa * Math.cos(phi) - ub * Math.sin(phi)) * k * Sp * W, ur = sig * (fa * Math.sin(phi) + ub * Math.cos(phi)) * k * Sp * W;
        return [p0[0] + t[0] * fr + nn[0] * ur, p0[1] + t[1] * fr + nn[1] * ur];
      };
      const root = Wg(0, 0), elbow = Wg(-0.05, 0.28), wrist = Wg(0.12, 0.55);
      ink.glow([root, elbow, wrist], 1.7, core, wa * a);
      ink.seg(wrist, Wg(0.17, 0.6), 1.2, core, wa * a);
      const tips = [[0.15, 0.55], [0.55, 0.58], [0.95, 0.5], [1.3, 0.4]].map(([th, l]) => Wg(0.12 - Math.sin(th!) * l!, 0.55 + Math.cos(th!) * l!));
      for (const tp of tips) ink.glow([wrist, tp], 1.0, mul(core, 0.9), wa * a);
      membrane(wrist, tips, S(0.42, df, BACK(0.42) + dv), wa * a);
    }
    spade(S);
    return;
  }

  const hw = HALF;
  // body outline, closed at the snout
  const side = (sg: number) => Array.from({ length: n + 1 }, (_, i) => { const u = end * i / n; return B(u, 0, sg * hw(u)); });
  ink.glow([...side(1).reverse(), B(0, 0.25, 0), ...side(-1)], 1.5, core, al);
  // dorsal ridge: small spines pointing back down the centre line
  for (let u = 0.1; u < Math.min(end, 0.8); u += 0.032) {
    const h = hw(u);
    ink.poly([B(u, 0, 0.28 * h), B(u, -0.4, 0), B(u, 0, -0.28 * h)], 0.9, mul(core, 0.6), al);
  }
  // head: eyes, a long pair of horns swept back and a short pair below them
  ink.dot(B(0.028, 0, 0.32), 0.1 * W + 1, mul(col, 2.6), al); ink.dot(B(0.028, 0, -0.32), 0.1 * W + 1, mul(col, 2.6), al);
  for (const sg of [1, -1]) {
    ink.glow([B(0.045, 0, sg * 0.55), B(0.045, -0.9, sg * 0.9), B(0.045, -1.8, sg * 1.0), B(0.045, -2.4, sg * 0.8)], 1.3, core, al);
    ink.poly([B(0.06, 0, sg * 0.48), B(0.06, -0.6, sg * 0.75), B(0.06, -1.1, sg * 0.72)], 1.1, mul(core, 0.8), al);
  }
  // legs, tucked back along the flanks, three claws each
  for (const u of [0.27, 0.42]) {
    if (end < u) continue;
    for (const sg of [1, -1]) {
      const h = hw(u), base = B(u, 0, sg * h), knee = B(u, -0.35, sg * (h + 0.55)), foot = B(u, -1.0, sg * (h + 0.45));
      ink.glow([base, knee, foot], 1.2, core, al);
      for (const c of [-0.18, 0, 0.18]) ink.seg(foot, B(u, -1.3, sg * (h + 0.45 + c)), 0.9, core, al);
    }
  }
  // wings, bat-like: a short upper arm, a forearm reaching forward along the leading edge, four long fingers fanning
  // from the wrist and the membrane they spread, scalloped between the fingertips and running back to the hip
  const wa = al * smoothstep(0.3, 0.5, end), Sp = 0.42 * Ltot / W, sp = 0.85 + 0.15 * flap, sw = 0.1 * flap;
  if (wa > 0.01) for (const sg of [1, -1]) {
    const out = (n: number) => sg * (0.85 + n * Sp * sp);
    const A = B(0.25, 0, sg * 0.85), hip = B(0.43, 0, sg * 0.8);
    const elbow = B(0.25, -0.04 * Sp, out(0.17)), wrist = B(0.25, (0.13 + sw) * Sp, out(0.4));
    ink.glow([A, elbow, wrist], 1.7, core, wa);
    ink.seg(wrist, B(0.25, (0.19 + sw) * Sp, out(0.42)), 1.2, core, wa);                      // thumb claw
    const tips = [[-0.12, 0.62], [0.35, 0.6], [0.8, 0.52], [1.25, 0.42]].map(([a, l]) =>
      B(0.25, (0.13 + sw) * Sp - Math.sin(a!) * l! * Sp * sp, out(0.4 + Math.cos(a!) * l!)));
    for (const tp of tips) ink.glow([wrist, tp], 1.0, mul(core, 0.9), wa);
    membrane(wrist, tips, hip, wa);
  }
  spade(B);
}

const lerp2 = (a: P2, b: P2, k: number): P2 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k)];

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

/** A stone spear (Rex Lapis's spears in Liyue): a long tapered spike from (x, y0) to its tip at (x, y1), banded, with a light core. */
export function spear(ink: Ink, x: number, y0: number, y1: number, w: number, col: RGB, al = 1, tilt = 0) {
  const P = (u: number, s: number): P2 => [x + tilt * (y1 - y0) * u + s * w * (1 - u) * (u < 0.04 ? u / 0.04 : 1), lerp(y0, y1, u)];
  const L: P2[] = [], R: P2[] = [], C: P2[] = [];
  for (let i = 0; i <= 30; i++) { const u = i / 30; L.push(P(u, -1)); R.push(P(u, 1)); C.push(P(u, 0)); }
  ink.glow(L, 1.6, col, al); ink.glow(R, 1.6, col, al);
  ink.poly(C, w * 0.5, mul(col, 0.25), al);
  ink.poly(C, 1.2, mul(col, 2.2), al);
  for (const u of [0.05, 0.1, 0.22, 0.4]) ink.seg(P(u, -1.15), P(u, 1.15), 1.3, col, al);
}

export interface NailOpts {
  /** the part of the length to draw, 0 head .. 1 point; broken ends get a jagged glowing edge */
  cut?: [number, number];
  /** turn about the long axis (radians): the lattice, crown points and gems wrap round the column */
  spin?: number;
  gem?: RGB;
  body?: RGB;
  seed?: number;
}

/**
 * A Celestial Nail, after the Skyfrost Nail in Dragonspine: a pale fluted column; at the head a gold crown band of
 * pointed arches over an interlaced gold lattice set with blue gems; gem lozenges down the shaft; a tapered point.
 * Drawn from the head (x, y0) to the point (x + tilt·(y1 − y0), y1); w = shaft half-width; `col` = gold and glow.
 * Ornament is laid out on the cylinder (angle θ about the axis, front θ = 0) and projected, so it wraps.
 */
export function nail(ink: Ink, x: number, y0: number, y1: number, w: number, col: RGB, al = 1, tilt = 0, o: NailOpts = {}) {
  const hx0 = x, hy0 = y0, tx = x + tilt * (y1 - y0), ty = y1;
  const len = Math.hypot(tx - hx0, ty - hy0) || 1;
  const dx = (tx - hx0) / len, dy = (ty - hy0) / len, nx = dy, ny = -dx;      // n: across, toward the lit (left) side
  const gem = o.gem ?? [0.25, 0.9, 2.4], body = o.body ?? [0.78, 0.83, 0.9], spin = o.spin ?? 0;
  const [c0, c1] = o.cut ?? [0, 1];
  const aMin = c0 * len, aMax = c1 * len;
  const capH = 1.1 * w, bandA = capH, bandH = 1.3 * w, latA = bandA + bandH, latH = 5.2 * w, colA = latA + latH;
  const tipL = Math.min(len * 0.16, 7 * w), tipA = len - tipL;
  const R = (a: number) => a < capH ? w * (0.3 + 0.68 * Math.sqrt(Math.max(0, 1 - ((capH - a) / capH) ** 2)))
    : a < latA ? w * 1.12 : a < tipA ? w : w * Math.pow(Math.max(0, (len - a) / tipL), 0.85);
  const P = (a: number, s: number): P2 => [hx0 + dx * a + nx * s, hy0 + dy * a + ny * s];
  const E = 0.14;                                                               // rings seen from below bulge up
  const onCyl = (a: number, th: number, r = R(a)): [number, number] => [a - E * r * Math.cos(th), r * Math.sin(th)];
  // breaks run slantwise across the column: the drawn part is aMin + slMin·s <= a <= aMax + slMax·s
  const rnd = mulberry32(o.seed ?? 5);
  const slMin = c0 > 0 ? (rnd() - 0.5) * 1.1 : 0, slMax = c1 < 1 ? (rnd() - 0.5) * 1.1 : 0;
  const halves: ((a: number, s: number) => number)[] = [(a, s) => a - aMin - slMin * s, (a, s) => aMax + slMax * s - a];
  // every stroke goes through here, clipped to the drawn part
  const line = (pts: [number, number][], wd: number, c: RGB, a = 1) => {
    for (let i = 1; i < pts.length; i++) {
      let p = pts[i - 1]!, q = pts[i]!, out = false;
      for (const g of halves) {
        const gp = g(p[0], p[1]), gq = g(q[0], q[1]);
        if (gp < 0 && gq < 0) { out = true; break; }
        if (gp < 0) p = [lerp(p[0], q[0], gp / (gp - gq)), lerp(p[1], q[1], gp / (gp - gq))];
        else if (gq < 0) q = [lerp(p[0], q[0], gp / (gp - gq)), lerp(p[1], q[1], gp / (gp - gq))];
      }
      if (!out) ink.seg(P(p[0], p[1]), P(q[0], q[1]), wd, c, al * a);
    }
  };
  const glowLine = (pts: [number, number][], wd: number, c: RGB, a = 1) => { line(pts, wd * 4, mul(c, 0.1), a); line(pts, wd, c, a); };
  const front = (th: number) => Math.cos(th);                                   // > 0: facing us
  const wrap = (th: number) => Math.atan2(Math.sin(th), Math.cos(th));

  // body: long single strokes (additive joints would bead), the point filled by strokes converging on it
  // (thin strokes side by side, shaded as a cylinder lit from the left; thin, so their round caps barely pass a break)
  for (let i = 0; i < 9; i++) {
    const s = (i - 4) * 0.22 * w, th = Math.asin(s / w);
    line([[latA, s], [tipA, s]], 0.22 * w, mul(body, 0.12 + 0.16 * Math.max(0, Math.cos(th - 0.6))));
  }
  line([[latA, 0.74 * w], [tipA, 0.74 * w]], 0.1 * w, mul(body, 0.25));
  for (let a = 1; a < latA; a += Math.max(2, w * 0.12)) { const r = R(a) * 0.92; line([[a, -r], [a, r]], w * 0.12, mul(body, 0.11)); }  // head: strokes across
  // silhouette
  const sil = (sg: number) => { const pts: [number, number][] = []; for (let i = 0; i <= 60; i++) { const a = len * i / 60; pts.push([a, sg * R(a)]); } return pts; };
  glowLine(sil(1), 1.4, mul(body, 1.1)); glowLine(sil(-1), 1.2, mul(body, 0.7));
  // flutes down the shaft (gem-blue light in the front grooves) converging into the point
  for (let j = -5; j <= 5; j++) {
    const th = j * 0.3, f = front(th);
    if (j === 0 || f <= 0.05) continue;
    const s = w * Math.sin(th);
    line([[colA, s], [tipA, s], [len - 1, s * 0.02]], 0.9, mul(Math.abs(j) <= 1 ? gem : body, Math.abs(j) <= 1 ? 0.35 : 0.3 * f), 1);
  }
  for (const s of [-0.6, 0, 0.6]) line([[tipA, s * w], [len, 0]], w * 0.3, mul(body, 0.12));   // point fill
  // gold rings: crown band foot, lattice collar (double), the band where the point begins
  const ring = (a: number, r: number, c: RGB, wd = 1.3) => { const pts: [number, number][] = []; for (let i = 0; i <= 24; i++) { const th = -Math.PI / 2 + Math.PI * i / 24; pts.push(onCyl(a, th, r)); } glowLine(pts, wd, c); };
  ring(bandA, w * 1.12, col); ring(latA, w * 1.12, col, 1.5); ring(colA, w, col, 1.4); ring(colA + 0.28 * w, w, mul(col, 0.7), 1);
  ring(tipA, w, col, 1.3);
  // crown band: pointed arches (5 across the front) with a gem finial on each apex and a lozenge under it
  const nArch = 10;
  for (let k = 0; k < nArch; k++) {
    const thP = wrap(spin + k * Math.PI * 2 / nArch), thQ = thP + Math.PI * 2 / nArch;
    const pts: [number, number][] = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10, th = thP + (thQ - thP) * u;
      if (front(th) < -0.05) continue;
      const dip = Math.pow(Math.sin(Math.PI * u), 0.6) * 0.95 * w;               // ogee: the apexes come to a point
      pts.push(onCyl(bandA + 0.1 * w + dip, th, w * 1.12));
    }
    glowLine(pts, 1.3, col);
    const fP = front(thP);
    if (fP > 0.1) {
      const [pa, ps] = onCyl(bandA + 0.1 * w, thP, w * 1.12);
      line([[pa, ps], [pa + 0.01, ps]], 0.22 * w * (0.4 + 0.6 * fP), mul(gem, 1.6), fP);
      const [ma, ms] = onCyl(bandA + 0.62 * w, thP, w * 1.12), hw = 0.15 * w * fP, hh = 0.24 * w;
      line([[ma - hh, ms], [ma, ms + hw], [ma + hh, ms], [ma, ms - hw], [ma - hh, ms]], 1, col, fP);
      line([[ma - hh * 0.5, ms], [ma + hh * 0.5, ms]], hw * 1.3, mul(gem, 0.9), fP);
    }
  }
  // the lattice: two families of helices crossing into pointed ovals, a gem in each
  const nH = 6, kH = 0.42 / w, dTh = Math.PI * 2 / nH;
  for (let j = 0; j < nH; j++) for (const sg of [1, -1]) {
    let run: [number, number][] = [];
    for (let i = 0; i <= 28; i++) {
      const a = latA + latH * i / 28, th = wrap(spin + j * dTh + sg * kH * (a - latA));
      if (front(th) > 0) run.push(onCyl(a, th, w * 1.02));
      else { if (run.length > 1) glowLine(run, 1.1, col); run = []; }
    }
    if (run.length > 1) glowLine(run, 1.1, col);
  }
  // crossings fall every `step` along the axis, offset by half a cell each row; a cell's centre is a row below its top
  const step = dTh / (2 * kH);
  for (let r = 1; r * step + 0.6 * step <= latH; r++) for (let j = 0; j < nH; j++) {
    const th = wrap(spin + (j + (r - 1) / 2) * dTh), f = front(th);
    if (f < 0.25) continue;
    const [ca, cs] = onCyl(latA + r * step, th, w * 1.02), hw = 0.22 * w * f, hh = 0.45 * step;
    line([[ca - hh, cs], [ca, cs + hw], [ca + hh, cs], [ca, cs - hw], [ca - hh, cs]], 0.9, mul(gem, 1.2), f);
    line([[ca - hh * 0.55, cs], [ca + hh * 0.55, cs]], hw * 1.4, mul(gem, 0.7), f);
  }
  // gem lozenges down the front of the shaft, gold-rimmed
  for (const u of [0.32, 0.7]) {
    const a = lerp(colA, tipA, u), hw = 0.3 * w, hh = 0.8 * w;
    if (tipA - colA < 6 * w) break;
    const lz: [number, number][] = [[a - hh, 0], [a, hw], [a + hh, 0], [a, -hw], [a - hh, 0]];
    glowLine(lz, 1.3, col); line([[a - hh * 0.6, 0], [a + hh * 0.6, 0]], hw * 1.2, mul(gem, 0.8)); line([[a - hh * 0.3, 0], [a + hh * 0.3, 0]], hw * 0.5, mul(gem, 2));
    line([[a + hh, 0], [a + hh + 1.6 * w, 0]], 0.9, mul(gem, 0.6));                 // a thread of light hanging below
  }
  // broken ends: a ragged glowing edge along each slanted break
  for (const [a0, sl, on] of [[aMin, slMin, c0 > 0], [aMax, slMax, c1 < 1]] as [number, number, boolean][]) {
    if (!on) continue;
    const r = R(a0), pts: P2[] = [];
    for (let i = 0; i <= 10; i++) { const s = -r + 2 * r * i / 10; pts.push(P(a0 + sl * s + (rnd() - 0.5) * 0.3 * w, s)); }
    ink.poly(pts, 5, mul(col, 0.12), al);
    ink.poly(pts, 1.4, mul(body, 1.3), al);
  }
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
  bishop: [[0.43, 0], [0.43, 0.06], [0.3, 0.11], [0.2, 0.18], [0.12, 0.52], [0.22, 0.56], [0.12, 0.6], [0.17, 0.66], [0.21, 0.75], [0.19, 0.84],
    [0.12, 0.93], [0.05, 0.98], [0.03, 1.0], [0.06, 1.03], [0.05, 1.07], [0, 1.08]],
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
  if (kind === 'bishop') ink.glow([[x + 0.18 * h, y - 0.71 * h], [x - 0.03 * h, y - 0.88 * h]], 1.2, col, al * frac);   // the mitre's slit
}

/** Sigils of the Four Shades (life, death, time, space): our own geometric marks. (The elements: _emblem.ts.) */
export function sigil(ink: Ink, kind: string, x: number, y: number, r: number, col: RGB, al = 1, frac = 1, t = 0) {
  const C = (rr: number, f = frac) => ink.circle(x, y, rr, 1.3, col, al, f);
  const G = (pts: P2[], closed = false) => ink.glow(pts.map(([a, b]) => [x + a * r, y + b * r] as P2), 1.4, col, al, frac, closed);
  switch (kind) {
    case 'life': C(r); G([[0, 0.7], [0, -0.1]]); G([[0, 0.2], [-0.35, -0.2], [-0.3, -0.5]]); G([[0, 0.05], [0.35, -0.35], [0.28, -0.62]]); G([[0, -0.1], [0, -0.55]]); break;
    case 'death': C(r); G(Array.from({ length: 25 }, (_, i) => { const a = Math.PI * 0.25 + Math.PI * 1.5 * i / 24; return [Math.cos(a) * 0.62, Math.sin(a) * 0.62] as P2; })); G([[0.05, -0.75], [0.05, 0.75]]); G([[-0.2, 0.45], [0.3, 0.45]]); break;
    case 'time': C(r); C(r * 0.7); G([[-0.4, -0.5], [0.4, -0.5], [-0.4, 0.5], [0.4, 0.5]], true); G([[0, -0.85], [0, -0.7]]); G([[0, 0.7], [0, 0.85]]);
      G([[0, 0], [Math.cos(t * 0.6) * 0.55, Math.sin(t * 0.6) * 0.55]]); break;
    case 'space': C(r); { const s = 0.62; for (const k of [0, 1]) { const a = k * Math.PI / 4 + t * 0.1; G([0, 1, 2, 3].map((i) => [Math.cos(a + i * Math.PI / 2) * s, Math.sin(a + i * Math.PI / 2) * s] as P2), true); } } break;
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
