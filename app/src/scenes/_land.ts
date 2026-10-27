// Silhouette layers: up to four depths of land, buildings and figures, authored as Canvas2D paths (shapes.ts),
// rasterised once into one RGBA mask (a layer per channel) and shaded here: depth fog, engraving hatch, a rim of
// light on the edges facing the key light, and a contour line that is inscribed across the frame when the
// picture appears (the record writing itself).
import * as THREE from 'three';
import { FSPass, SCALE, SS_TAP, SS_TAP_GLSL } from '../engine/gl';
import { mulberry32 } from '../engine/util';
import type { Cam } from './_film';
import type { RGB } from './_sky';

/** Margin (logical px) the masks extend past the frame on every side, for camera moves. */
export const M = 170;
export const MW = 1920 + 2 * M, MH = 1080 + 2 * M;

export type Draw = (c: CanvasRenderingContext2D, rnd: () => number) => void;
export interface LayerDef {
  draw: Draw;
  depth: number;      // parallax: 0 = as far as the sky, 1 = the plate
  fill: RGB;          // body colour (linear)
  rim: RGB;           // contour / rim colour (linear, may exceed 1)
  hatch?: number;     // engraving strength 0..1
  angle?: number;     // hatch angle (rad)
  fog?: number;       // 0..1 toward the fog colour
  contour?: number;   // contour strength (default 1)
}
export interface LandDef { layers: LayerDef[]; fog?: RGB; light?: [number, number]; seed?: number }

const FRAG = /* glsl */ `
uniform sampler2D mask; uniform vec2 maskSize; uniform float margin;
uniform vec4 cam; uniform vec2 camF; uniform float t;
uniform float depth[4]; uniform vec3 fill[4]; uniform vec3 rim[4]; uniform vec4 look[4]; // hatch, angle, fog, contour
uniform float rev[4]; uniform float on[4];
uniform vec3 fogCol; uniform vec2 light;
uniform sampler2D under;
${SS_TAP_GLSL}

vec2 toPlate(vec2 P, float d) {
  float z = 1.0 + (cam.x - 1.0) * d;
  vec2 c = camF * vec2(1920.0, 1080.0);
  return (P - c - cam.yz * d) / z + c;
}
float ch(vec4 m, int i) { return i == 0 ? m.r : i == 1 ? m.g : i == 2 ? m.b : m.a; }
float sampleL(vec2 q, int i) { return ch(texture(mask, (q + margin) / maskSize * vec2(1.0, 1.0)), i); }

vec4 layer(vec2 P, int i, vec3 col) {
  vec2 q = toPlate(P, depth[i]);
  vec2 uv = (q + margin) / maskSize;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(col, 0.0);
  float a = ch(texture(mask, uv), i);
  float e = 1.6;
  float mn = min(min(sampleL(q + vec2(e, 0.0), i), sampleL(q - vec2(e, 0.0), i)), min(sampleL(q + vec2(0.0, e), i), sampleL(q - vec2(0.0, e), i)));
  float mx = max(max(sampleL(q + vec2(e, 0.0), i), sampleL(q - vec2(e, 0.0), i)), max(sampleL(q + vec2(0.0, e), i), sampleL(q - vec2(0.0, e), i)));
  float edge = sat((mx - mn) * 1.4);
  // the key light: edges whose outside faces the light glow
  vec2 ld = normalize(light - q + vec2(0.0001));
  float lit = sat(a - sampleL(q + ld * 7.0, i));
  // inscription: contour drawn left to right with a hot front, the body fills in behind it
  float front = rev[i] * 2500.0 - 200.0 + 120.0 * snoise(vec2(q.y / 180.0, float(i)));
  float drawn = smoothstep(front, front - 40.0, q.x);
  float hot = exp(-abs(q.x - front) / 26.0) * step(0.001, rev[i]) * (1.0 - step(0.999, rev[i]));
  float body = a * smoothstep(front - 60.0, front - 420.0, q.x);
  vec4 lk = look[i];
  // body: fill, darker toward its base, fogged with distance, engraved
  float shadeY = sat((q.y - 200.0) / 900.0);
  vec3 f = fill[i] * mix(1.15, 0.6, shadeY);
  f = mix(f, fogCol, lk.z);
  float ink = engrave(q / 1.0, mix(0.08, 0.38, shadeY) * lk.x, 0.16, lk.y);
  f += rim[i] * ink * 0.06 * lk.x;
  vec3 c = mix(col, f, body);
  c += rim[i] * (lit * 0.55) * body;
  c += rim[i] * edge * lk.w * drawn * (0.55 + 0.45 * a);
  c += rim[i] * edge * hot * 6.0 + rim[i] * hot * a * 0.4;
  return vec4(c, max(body, edge * drawn));
}

vec3 shade(vec2 P, vec3 col) {
  for (int i = 0; i < 4; i++) {
    if (on[i] < 0.5) continue;
    col = layer(P, i, col).rgb;
  }
  return col;
}

void main() {
  vec2 P = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  vec3 base = texture(under, vUv).rgb;
  vec3 c = vec3(0.0);
  for (int k = ssK0(); k < ssK1(); k++) c += shade(P + rgss(k) / PX_SCALE, base);
  fragColor = vec4(c * ssWeight(), 1.0);
}
`;

/** Rasterised masks, built on first use and kept for the few pictures around the playhead. */
const cache = new Map<string, THREE.DataTexture>();
const order: string[] = [];

export function buildMask(key: string, def: LandDef): THREE.DataTexture {
  const hit = cache.get(key);
  if (hit) return hit;
  const s = Math.min(SCALE, 2) * (SCALE > 1 ? 1 : 0.75); // contours come from the mask's gradient: full res at 4K
  const w = Math.round(MW * s), h = Math.round(MH * s);
  const data = new Uint8Array(w * h * 4);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  def.layers.slice(0, 4).forEach((L, i) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.setTransform(s, 0, 0, s, M * s, M * s);
    c.fillStyle = '#fff'; c.strokeStyle = '#fff';
    L.draw(c, mulberry32((def.seed ?? 1) * 97 + i * 13));
    const px = c.getImageData(0, 0, w, h).data;
    // canvas rows are top-down; the texture is sampled with uv.y = plate y (down) so no flip
    for (let p = 0, n = w * h; p < n; p++) data[p * 4 + i] = px[p * 4 + 3]!;
  });
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
  tex.flipY = false;
  tex.needsUpdate = true;
  cache.set(key, tex); order.push(key);
  while (order.length > 6) { const k = order.shift()!; cache.get(k)?.dispose(); cache.delete(k); }
  return tex;
}

export class Land {
  pass = new FSPass(FRAG, {
    mask: { value: null }, maskSize: { value: new THREE.Vector2(MW, MH) }, margin: { value: M },
    cam: { value: new THREE.Vector4(1, 0, 0, 0) }, camF: { value: new THREE.Vector2(0.5, 0.5) }, t: { value: 0 },
    depth: { value: [1, 1, 1, 1] }, fill: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) }, rim: { value: [0, 1, 2, 3].map(() => new THREE.Vector3()) },
    look: { value: [0, 1, 2, 3].map(() => new THREE.Vector4()) }, rev: { value: [1, 1, 1, 1] }, on: { value: [0, 0, 0, 0] },
    fogCol: { value: new THREE.Vector3() }, light: { value: new THREE.Vector2(960, 0) }, under: { value: null },
    ssTap: SS_TAP,
  });

  /** Composite the land of `def` over `under` (the sky) into `out`. `rev` = per-layer inscription progress. */
  render(renderer: THREE.WebGLRenderer, under: THREE.Texture, out: THREE.WebGLRenderTarget, key: string, def: LandDef, cam: Cam, t: number, rev: number[], fog: RGB) {
    const u = this.pass.u;
    u.mask!.value = buildMask(key, def);
    u.under!.value = under;
    (u.cam!.value as THREE.Vector4).set(cam.zoom, cam.x, cam.y, 0);
    (u.camF!.value as THREE.Vector2).set(cam.fx, cam.fy);
    u.t!.value = t;
    const L = def.layers;
    for (let i = 0; i < 4; i++) {
      const l = L[i];
      (u.on!.value as number[])[i] = l ? 1 : 0;
      if (!l) continue;
      (u.depth!.value as number[])[i] = l.depth;
      (u.fill!.value as THREE.Vector3[])[i]!.set(...l.fill);
      (u.rim!.value as THREE.Vector3[])[i]!.set(...l.rim);
      (u.look!.value as THREE.Vector4[])[i]!.set(l.hatch ?? 0.6, l.angle ?? 0.35, l.fog ?? 0, l.contour ?? 1);
      (u.rev!.value as number[])[i] = rev[i] ?? 1;
    }
    (u.fogCol!.value as THREE.Vector3).set(...(def.fog ?? fog));
    (u.light!.value as THREE.Vector2).set(...(def.light ?? [960, -200]));
    this.pass.render(renderer, out);
  }
}
