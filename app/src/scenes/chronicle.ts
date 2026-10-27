// The whole film is one continuous function of time: every chapter's timeline entry is served by this module,
// sharing one renderer (Film). A frame = the current picture (and, while it dissolves in, the previous one),
// an ink-burn dissolve between them, then the record's typography on top.
import * as THREE from 'three';
import { Scene, type Frame, type PostOverrides, type SceneCtx } from '../engine/scene';
import { FSPass, makeRT } from '../engine/gl';
import { LineBatch } from '../engine/lines';
import { clamp, smoothstep } from '../engine/util';
import { FILM, SEGMENTS, XFADE, camera, segmentAt, type Segment } from './_film';
import { Sky } from './_sky';
import { Land } from './_land';
import { Ink, particles } from './_art';
import { PICS, type PicCtx, type PicDef } from './_pics';
import { Overlay } from './_overlay';

const DISSOLVE = /* glsl */ `
uniform sampler2D a; uniform sampler2D b; uniform float k; uniform float seed;
void main() {
  vec3 A = texture(a, vUv).rgb, B = texture(b, vUv).rgb;
  vec2 p = vec2(vUv.x * 1.78, 1.0 - vUv.y);
  float n = sat((fbm(p * 2.6 + seed, 5) * 0.5 + 0.5 - 0.22) / 0.56);   // stretched to fill 0..1
  n = mix(n, vUv.x, 0.5);
  float th = mix(-0.06, 1.06, k);
  float m = smoothstep(n - 0.05, n + 0.05, th);
  float live = step(0.0005, k) * step(k, 0.9995);
  float edge = exp(-abs(th - n) / 0.007) * live;
  float scorch = exp(-max(th - n, 0.0) / 0.05) * step(n, th) * live;
  vec3 c = mix(A, B * (1.0 - 0.6 * scorch), m);
  c += C_GOLDHOT * edge * 1.3;
  fragColor = vec4(c, 1.0);
}`;

class Film {
  sky = new Sky();
  land = new Land();
  lb = new LineBatch(160000);
  rts = [makeRT(), makeRT(), makeRT(), makeRT()];
  dissolve = new FSPass(DISSOLVE, { a: { value: null }, b: { value: null }, k: { value: 0 }, seed: { value: 0 } });
  overlay: Overlay;
  constructor(public ctx: SceneCtx) { this.overlay = new Overlay(ctx.lyrics); }

  pic(seg: Segment): PicDef {
    return PICS[seg.pic] ?? PICS['endcard']!;
  }

  ctxOf(seg: Segment, t: number, w: number): PicCtx {
    const cam = camera(seg, t);
    const lines = seg.shot?.lines ?? [];
    return {
      t, lt: t - seg.start, seg, cam, w,
      L: (i: number) => lines[Math.min(i, lines.length - 1)]?.start ?? seg.start,
      at: (a: number, d: number) => smoothstep(a, a + d, t),
    } as PicCtx;
  }

  /** Render one picture at t into rts[slot*2 .. +1]; returns the texture holding it. */
  renderPic(seg: Segment, t: number, slot: number, w: number): THREE.Texture {
    const r = this.ctx.renderer;
    const skyRT = this.rts[slot * 2]!, picRT = this.rts[slot * 2 + 1]!;
    const def = this.pic(seg);
    const k = this.ctxOf(seg, t, w);
    const sp = def.sky(k);
    this.sky.render(r, skyRT, sp, k.cam, t);
    const ink = new Ink(this.lb, k.cam);
    if (def.back) { this.lb.clear(); def.back(ink, k); this.lb.render(r, skyRT); }
    let target = skyRT;
    if (def.land) {
      const revs = def.land.layers.map((_, i) => {
        const fast = seg.n > 1;                       // montage shots last ~5 s: inscribe quicker
        const d = def.landDelay?.[i] ?? i * (fast ? 0.2 : 0.45);
        return smoothstep(seg.start - 0.2 + d, seg.start - 0.2 + d + (fast ? 1.6 : 2.9), t);
      });
      this.land.render(r, skyRT.texture, picRT, seg.pic, def.land, k.cam, t, revs, sp.hor);
      target = picRT;
    }
    this.lb.clear();
    ink.d = 1; ink.fade = 1;
    def.art?.(ink, k);
    if (def.fx) particles(ink, def.fx.kind, t, def.fx.col, def.fx.amount ?? 1, 7 + seg.i);
    this.lb.render(r, target);
    return target.texture;
  }

  frame(f: Frame, out: THREE.WebGLRenderTarget): PostOverrides {
    const t = f.t;
    const i = segmentAt(t);
    const seg = SEGMENTS[i]!;
    const kx = clamp((t - seg.start) / XFADE, 0, 1);
    const prev = i > 0 && kx < 1 ? SEGMENTS[i - 1]! : null;
    const r = this.ctx.renderer;
    const B = this.renderPic(seg, t, 0, prev ? kx : 1);
    let A = B;
    if (prev) A = this.renderPic(prev, t, 1, 1 - kx);
    const d = this.dissolve.u;
    d.a!.value = A; d.b!.value = B; d.k!.value = prev ? kx : 1; d.seed!.value = seg.i * 3.17;
    this.dissolve.render(r, out);
    // typography (and the diagrams' labels)
    const ui = [prev && this.pic(prev).ui ? [prev, 1 - kx] as const : null, this.pic(seg).ui ? [seg, prev ? kx : 1] as const : null].filter(Boolean) as (readonly [Segment, number])[];
    const tex = this.overlay.draw(t, seg, (c) => {
      for (const [s, w] of ui) { c.save(); this.pic(s).ui!(c, this.ctxOf(s, t, w)); c.restore(); }
    });
    this.ctx.comp.draw(r, tex, out);
    const base: PostOverrides = { bloom: 0.6, bloomThreshold: 0.72, bloomRadius: 0.8, vignette: 0.5, grain: 0.035, ca: 0.45, halation: 0.12 };
    const own = this.pic(seg).post?.(this.ctxOf(seg, t, 1)) ?? {};
    const fade = Math.max(1 - smoothstep(0, 2.2, t), smoothstep(FILM.end.end - 2.4, FILM.end.end - 0.2, t));
    return { ...base, ...own, fade };
  }
}

let film: Film | null = null;

export default class Chronicle extends Scene {
  override init() { film ??= new Film(this.ctx); }
  render(f: Frame, out: THREE.WebGLRenderTarget) { return film!.frame(f, out); }
  override warmupTimes() {
    // one time inside every picture of this entry (each has its own sky / land variant)
    const { start, end } = this.ctx;
    return SEGMENTS.filter((s) => s.start < end && s.end > start).map((s) => clamp(s.start + 2, start, end - 0.01));
  }
}
