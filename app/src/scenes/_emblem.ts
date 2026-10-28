// The seven element emblems, from the vector file elements.svg (one 314.1-unit square per element, left to right:
// pyro, hydro, anemo, electro, dendro, cryo, geo). Their paths are rasterised once into an atlas (R the glyph,
// G a near glow, B a wide glow) and drawn additively into the picture: they bloom with the line art and are burnt
// in from the centre outward, the same ink-burn as the dissolves.
import * as THREE from 'three';
import SVG from './elements.svg?raw';
import { FSPass, SCALE } from '../engine/gl';
import { hexToLinear } from '../engine/util';
import { project, type Cam } from './_film';
import type { RGB } from './_sky';

const ORDER = ['pyro', 'hydro', 'anemo', 'electro', 'dendro', 'cryo', 'geo'];
const COLS = 4, ROWS = 2, MAX = 8;
/** The glyph's square takes this much of its atlas cell (the rest is room for the glows). */
const INNER = 0.68;

interface Glyph { paths: Path2D[]; box: [number, number, number]; col: string }
let glyphs: Map<string, Glyph> | null = null;

function parse(): Map<string, Glyph> {
  if (glyphs) return glyphs;
  const doc = new DOMParser().parseFromString(SVG, 'image/svg+xml');
  const fills = new Map([...SVG.matchAll(/\.(st\d+)\{fill:([^;}]+)/g)].map((m) => [m[1]!, m[2]!.trim()]));
  glyphs = new Map();
  [...doc.documentElement.children].filter((g) => g.tagName === 'g').forEach((g, i) => {
    const out: Glyph = { paths: [], box: [0, 0, 1], col: '#ffffff' };
    for (const e of g.querySelectorAll('path, circle, rect')) {
      const n = (k: string) => +(e.getAttribute(k) ?? 0);
      if (e.tagName === 'rect') { out.box = [n('x'), n('y'), n('width')]; continue; }   // the element's square
      const fill = fills.get(e.getAttribute('class') ?? '') ?? 'none';
      if (fill === 'none') continue;
      out.col = fill;
      if (e.tagName === 'path') out.paths.push(new Path2D(e.getAttribute('d')!));
      else { const p = new Path2D(); p.arc(n('cx'), n('cy'), n('r'), 0, Math.PI * 2); out.paths.push(p); }
    }
    glyphs!.set(ORDER[i]!, out);
  });
  return glyphs;
}

/** The emblem's own colour (linear). */
export function emblemCol(el: string, k = 1): RGB {
  const c = hexToLinear(parse().get(el)?.col ?? '#ffffff');
  return [c[0] * k, c[1] * k, c[2] * k];
}

let atlas: THREE.DataTexture | null = null;
function buildAtlas(): THREE.DataTexture {
  if (atlas) return atlas;
  const N = 512 * Math.min(SCALE, 2), w = N * COLS, h = N * ROWS;
  const data = new Uint8Array(w * h * 4);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const c = cv.getContext('2d', { willReadFrequently: true })!;
  const G = parse();
  // each pass draws every glyph into its cell, blurred by `blur` cell-widths, into one channel
  [0, 0.025, 0.075].forEach((blur, ch) => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, w, h);
    c.filter = blur > 0 ? `blur(${(blur * N).toFixed(1)}px)` : 'none';
    c.fillStyle = '#fff';
    ORDER.forEach((el, i) => {
      const g = G.get(el); if (!g) return;
      const [bx, by, bs] = g.box, s = N * INNER / bs;
      c.setTransform(s, 0, 0, s, (i % COLS + 0.5) * N - (bx + bs / 2) * s, ((i / COLS | 0) + 0.5) * N - (by + bs / 2) * s);
      for (const p of g.paths) c.fill(p);   // each path on its own, as the SVG fills them
    });
    const px = c.getImageData(0, 0, w, h).data;
    for (let p = 0, n = w * h; p < n; p++) data[p * 4 + ch] = px[p * 4 + 3]!;
  });
  for (let p = 0, n = w * h; p < n; p++) data[p * 4 + 3] = 255;
  atlas = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  atlas.minFilter = THREE.LinearMipmapLinearFilter; atlas.magFilter = THREE.LinearFilter;
  atlas.generateMipmaps = true;
  atlas.flipY = false;   // canvas rows are top-down and so is the cell lookup
  atlas.needsUpdate = true;
  return atlas;
}

const FRAG = /* glsl */ `
uniform sampler2D atlas; uniform int count;
uniform vec4 geo[${MAX}];    // centre x, y (logical px, y down), half the cell (px), reveal 0..1
uniform vec3 col[${MAX}];    // linear, may exceed 1
uniform vec4 look[${MAX}];   // alpha, glow, atlas cell, vertical squash (lying flat)
void main() {
  vec2 P = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  vec3 c = vec3(0.0);
  for (int i = 0; i < ${MAX}; i++) {
    if (i >= count) break;
    vec4 g = geo[i], L = look[i];
    vec2 q = (P - g.xy) / (2.0 * g.z * vec2(1.0, L.w)) + 0.5;
    if (q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
    vec2 uv = (vec2(mod(L.z, ${COLS}.0), floor(L.z / ${COLS}.0)) + q) / vec2(${COLS}.0, ${ROWS}.0);
    vec3 m = texture(atlas, uv).rgb;
    // burnt in from the centre outward along a ragged front; a hot edge where the front crosses the glyph
    vec2 b = (q - 0.5) / ${INNER};
    float n = sat(length(b) * 1.25 + 0.22 * fbm(b * 3.2 + L.z * 1.7, 4));
    float th = mix(-0.06, 1.06, g.w);
    float shown = smoothstep(n - 0.03, n + 0.03, th);
    float edge = exp(-abs(th - n) / 0.02) * step(0.0005, g.w) * step(g.w, 0.9995);
    c += (col[i] * (m.r + L.y * (0.45 * m.g + 0.3 * m.b)) * shown + C_GOLDHOT * (3.0 * m.r + m.g) * edge) * L.x;
  }
  fragColor = vec4(c, 0.0);
}`;

export interface Emblem {
  el: string;
  x: number; y: number;   // centre (plate px)
  size: number;           // the element's square (px)
  sy?: number;            // vertical squash: < 1 lays the emblem flat on the ground (default 1)
  d?: number;             // parallax depth (default 1)
  rev?: number;           // burn-in 0..1 (default 1)
  al?: number;
  glow?: number;          // glow strength (default 1)
  k?: number;             // brightness over the emblem's colour (default 1.2)
}

export class Emblems {
  pass = new FSPass(FRAG, {
    atlas: { value: null }, count: { value: 0 },
    geo: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
    col: { value: Array.from({ length: MAX }, () => new THREE.Vector3()) },
    look: { value: Array.from({ length: MAX }, () => new THREE.Vector4()) },
  }, { blending: THREE.CustomBlending, transparent: true });
  constructor() {
    const m = this.pass.mat;
    m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
  }

  /** Add the emblems over `target` (additive, like the line art). */
  render(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget, list: Emblem[], cam: Cam) {
    const u = this.pass.u;
    const live = list.filter((e) => (e.al ?? 1) > 0.002 && (e.rev ?? 1) > 0 && ORDER.includes(e.el)).slice(0, MAX);
    if (!live.length) return;
    u.atlas!.value = buildAtlas();
    u.count!.value = live.length;
    live.forEach((e, i) => {
      const d = e.d ?? 1, z = 1 + (cam.zoom - 1) * d;
      const [x, y] = project(cam, e.x, e.y, d);
      (u.geo!.value as THREE.Vector4[])[i]!.set(x, y, e.size * z / INNER / 2, e.rev ?? 1);
      (u.col!.value as THREE.Vector3[])[i]!.set(...emblemCol(e.el, e.k ?? 1.2));
      (u.look!.value as THREE.Vector4[])[i]!.set(e.al ?? 1, e.glow ?? 1, ORDER.indexOf(e.el), e.sy ?? 1);
    });
    this.pass.render(renderer, target);
  }
}
