// The sky of every picture: one parametric fullscreen pass. Gradient, nebula, stars and a milky band, a key glow
// with god rays, up to three moons, aurora, cloud banks, a sea that mirrors the lights, an Abyss rift, and the
// "false sky": a shell of meridians that can crack. Coordinates are logical px (y down) seen through the camera
// at the sky's parallax depth.
import * as THREE from 'three';
import { FSPass, SS_TAP, SS_TAP_GLSL } from '../engine/gl';
import { lin } from '../engine/palette';
import type { Cam } from './_film';

export type RGB = [number, number, number];
export interface Moon { x: number; y: number; r: number; col: RGB; iri?: number; alpha?: number; maria?: number }
export interface SkyParams {
  top: RGB; mid: RGB; hor: RGB; horY: number;     // gradient, horizon height (logical px, y down)
  neb?: number; nebA?: RGB; nebB?: RGB; nebScale?: number; nebSeed?: number;
  stars?: number; milky?: number; milkyAngle?: number;
  glow?: [number, number, number]; glowCol?: RGB; rays?: number;   // glow: x, y, radius
  moons?: Moon[];
  aurora?: number; auroraA?: RGB; auroraB?: RGB;
  clouds?: number; cloudY?: number; cloudCol?: RGB; cloudLit?: RGB;
  seaY?: number; seaCol?: RGB; seaLines?: number;
  rift?: [number, number, number, number];        // x, y, length, amount (0..1)
  shell?: number; crack?: number; crackCol?: RGB;  // false sky
  depth?: number;                                 // camera parallax depth of the sky (default 0.25)
  drift?: number;                                 // nebula drift speed
}

const N_MOONS = 3;

const FRAG = /* glsl */ `
uniform float t;
uniform vec4 cam; uniform vec2 camF; uniform float depth;
uniform vec3 top, mid, hor; uniform float horY;
uniform float neb; uniform vec3 nebA, nebB; uniform float nebScale, nebSeed, drift;
uniform float stars, milky, milkyAngle;
uniform vec3 glow; uniform vec3 glowCol; uniform float rays;
uniform vec4 moon[${N_MOONS}]; uniform vec3 moonCol[${N_MOONS}]; uniform vec3 moonX[${N_MOONS}]; // x: iri, y: alpha, z: maria
uniform float aurora; uniform vec3 auroraA, auroraB;
uniform float clouds, cloudY; uniform vec3 cloudCol, cloudLit;
uniform float seaY; uniform vec3 seaCol; uniform float seaLines;
uniform vec4 rift;
uniform float shell, crack; uniform vec3 crackCol;
${SS_TAP_GLSL}

vec2 toSky(vec2 P, float d) {
  float z = 1.0 + (cam.x - 1.0) * d;
  vec2 c = camF * vec2(1920.0, 1080.0);
  return (P - c - cam.yz * d) / z + c;
}

vec3 starField(vec2 q, float density) {
  vec3 s = vec3(0.0);
  for (int layer = 0; layer < 3; layer++) {
    float sc = layer == 0 ? 9.0 : layer == 1 ? 17.0 : 31.0;
    vec2 g = q / sc; vec2 id = floor(g); vec2 f = fract(g) - 0.5;
    float h = hash12(id + float(layer) * 37.1);
    if (h > 1.0 - 0.09 * density) {
      vec2 o = (hash22(id * 1.7 + 3.1) - 0.5) * 0.7;
      float r = length(f - o) * sc;
      float size = mix(0.55, 1.5, pow(hash12(id + 9.2), 6.0)) * (layer == 2 ? 1.25 : 1.0);
      float tw = 0.75 + 0.25 * sin(t * (1.0 + 3.0 * hash12(id + 2.0)) + h * 40.0);
      float b = exp(-r * r / (size * size)) * tw;
      vec3 c = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.86, 0.66), hash12(id + 5.5));
      s += c * b * mix(0.5, 2.2, pow(hash12(id + 7.7), 3.0));
    }
  }
  return s;
}

float voronoiEdge(vec2 p, out vec2 cell) {
  vec2 n = floor(p), f = fract(p);
  float md = 8.0; vec2 mr = vec2(0.0), mg = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j)); vec2 o = hash22(n + g); vec2 r = g + o - f;
    float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j)); vec2 o = hash22(n + g); vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  cell = n + mg;
  return md;
}

vec3 shade(vec2 P) {
  vec2 q = toSky(P, depth);
  float y = q.y;
  // gradient: top -> mid -> horizon glow, below the horizon the far haze
  vec3 col = mix(top, mid, smoothstep(-200.0, horY * 0.8, y));
  col = mix(col, hor, smoothstep(horY * 0.55, horY + 30.0, y));
  // nebula
  if (neb > 0.0) {
    vec2 nq = q / (nebScale * 900.0) + vec2(nebSeed, nebSeed * 0.37) + vec2(t * drift * 0.004, 0.0);
    float n1 = fbm(nq, 5) * 0.5 + 0.5;
    float n2 = fbm(nq * 2.3 + 7.1 + vec2(0.0, t * drift * 0.003), 4) * 0.5 + 0.5;
    float m = smoothstep(0.42, 0.95, n1) * (0.6 + 0.6 * n2);
    col += mix(nebA, nebB, smoothstep(0.3, 0.8, n2)) * m * m * neb * smoothstep(horY + 120.0, horY * 0.4, y);
  }
  // milky band
  if (milky > 0.0) {
    vec2 r = rot2(milkyAngle) * (q - vec2(960.0, horY * 0.5));
    float band = exp(-pow(r.y / 220.0, 2.0)) * (0.55 + 0.45 * fbm(r / 260.0 + 3.0, 4));
    col += vec3(0.55, 0.6, 0.85) * band * milky * 0.06;
    col += starField(q * 1.0 + 11.0, 2.4 * band * milky);
  }
  // stars (fade near the horizon)
  if (stars > 0.0) col += starField(q, stars) * smoothstep(horY + 40.0, horY * 0.6, y) * 0.9;
  // false sky: the shell's meridians and parallels, and its cracks
  if (shell > 0.0) {
    vec2 c = q - vec2(960.0, horY + 900.0);
    float R = length(c), A = atan(c.x, -c.y);
    float lat = abs(fract(R / 140.0) - 0.5) * 140.0;
    float lon = abs(fract(A * 9.0 / PI) - 0.5) * (PI / 9.0) * R;
    float g = max(pxLine(lat, 0.3, 1.4), pxLine(lon, 0.3, 1.4)) * smoothstep(horY + 60.0, horY * 0.2, y);
    col += C_GOLD * g * shell * 0.22;
  }
  if (crack > 0.0) {
    vec2 cell; float e = voronoiEdge(q / 190.0 + 4.0, cell);
    float grow = smoothstep(0.0, 1.0, crack * 1.4 - hash12(cell) * 0.7);
    float line = exp(-e * 190.0 / 1.6) * grow;
    float glowc = exp(-e * 190.0 / 18.0) * grow * 0.25;
    col += crackCol * (line * 3.0 + glowc) * smoothstep(horY + 40.0, horY * 0.3, y);
  }
  // aurora curtains
  if (aurora > 0.0) {
    float x = q.x / 1920.0;
    float base = horY * 0.42 + 90.0 * fbm(vec2(x * 2.2, t * 0.03), 3);
    float h = smoothstep(base + 260.0, base, y) * smoothstep(base - 380.0, base - 40.0, y);
    float curtain = pow(0.5 + 0.5 * sin(x * 38.0 + 6.0 * fbm(vec2(x * 3.0, t * 0.05), 3)), 3.0) * 0.6 + 0.4;
    float k = smoothstep(base + 200.0, base - 300.0, y);
    col += mix(auroraA, auroraB, k) * h * curtain * aurora * (0.6 + 0.4 * fbm(vec2(x * 6.0, y / 200.0 - t * 0.1), 3));
  }
  // glow and rays
  vec2 gp = glow.xy; float gr = glow.z;
  if (gr > 0.0) {
    float d = length(q - gp);
    col += glowCol * (exp(-d / gr) * 0.9 + exp(-d / (gr * 0.18)) * 0.8);
    if (rays > 0.0) {
      float ang = atan(q.y - gp.y, q.x - gp.x);
      float s = fbm(vec2(ang * 7.0, t * 0.05), 3) * 0.5 + 0.5;
      float r2 = pow(s, 3.0) * exp(-d / (gr * 3.5)) * smoothstep(gr * 0.2, gr, d);
      col += glowCol * r2 * rays * 1.4;
    }
  }
  // moons
  for (int i = 0; i < ${N_MOONS}; i++) {
    vec4 m = moon[i];
    if (m.z <= 0.0 || moonX[i].y <= 0.0) continue;
    vec2 d = (q - m.xy) / m.z; float r = length(d);
    float a = moonX[i].y;
    vec3 mc = moonCol[i];
    col += mc * exp(-max(r - 1.0, 0.0) * 2.4) * 0.18 * a;                 // halo
    col += mc * exp(-max(r - 1.0, 0.0) * 9.0) * 0.25 * a;
    float disc = 1.0 - smoothstep(1.0 - 1.5 / m.z, 1.0 + 1.5 / m.z, r);
    if (disc > 0.0) {
      float mu = sqrt(max(0.0, 1.0 - r * r));
      vec2 sp = d / (1.0 + mu) * 2.2 + float(i) * 7.3;
      float maria = smoothstep(0.1, 0.6, fbm(sp * 1.6, 5) * 0.5 + 0.5) * moonX[i].z;
      float crater = smoothstep(0.82, 0.95, fbm(sp * 5.0 + 3.0, 3) * 0.5 + 0.5);
      vec3 base = mc * (0.85 + 0.35 * mu) * (1.0 - 0.45 * maria) * (1.0 - 0.15 * crater);
      if (moonX[i].x > 0.0) {   // iridescent: a slow rainbow film over the disc
        float h = atan(d.y, d.x) / TAU + fbm(sp * 0.8 + t * 0.02, 3) * 0.6 + t * 0.01;
        vec3 rb = 0.55 + 0.45 * cos(TAU * (h + vec3(0.0, 0.33, 0.67)));
        base = mix(base, base * rb * 1.6, moonX[i].x);
      }
      col = mix(col, base, disc * a);
    }
  }
  // clouds: dark banks with lit rims
  if (clouds > 0.0) {
    vec2 cq = vec2(q.x / 700.0 + t * 0.006, (q.y - cloudY) / 140.0);
    float n = fbm(vec2(cq.x, cq.y * 0.8), 5) + 0.6 - abs(cq.y) * 0.55;
    float body = smoothstep(0.15, 0.45, n);
    float rim = smoothstep(0.15, 0.3, n) - smoothstep(0.3, 0.5, n);
    col = mix(col, cloudCol, body * clouds);
    col += cloudLit * rim * clouds * 0.6;
  }
  // the Abyss rift: a jagged tear with violet fire and smoke
  if (rift.w > 0.0) {
    vec2 rp = q - rift.xy;
    float wob = fbm(vec2(rp.y / 90.0, t * 0.2), 4) * 40.0 * rift.w;
    float len = rift.z * rift.w;
    float along = smoothstep(len, len * 0.6, abs(rp.y));
    float w = (6.0 + 26.0 * rift.w) * along;
    float dd = abs(rp.x - wob);
    float core = smoothstep(w, 0.0, dd) * along;
    float smoke = fbm(rp / 160.0 + vec2(0.0, t * 0.12), 5) * 0.5 + 0.5;
    float halo = exp(-dd / (60.0 + 140.0 * rift.w)) * along * smoke;
    col = mix(col, vec3(0.0), halo * 0.7 * rift.w);
    col += C_ABYSS * (halo * 1.6 + core * 5.0) * rift.w + C_CRIMSON * core * 1.5 * rift.w;
  }
  // the sea: mirrored lights on lines of swell
  if (seaY < 1300.0) {
    vec2 sq = toSky(P, mix(depth, 1.0, 0.55));
    if (sq.y > seaY) {
      float dy = sq.y - seaY;
      float persp = 1.0 / (0.02 + dy / 400.0);
      float swell = fbm(vec2(sq.x / (900.0 / persp * 0.08 + 60.0), dy / 40.0 - t * 0.15), 4);
      vec3 s = mix(seaCol * 1.6, seaCol * 0.5, smoothstep(0.0, 700.0, dy));
      float lines = hatch(persp * 1.6 + swell * 2.0, 0.08 + 0.12 * smoothstep(0.0, 400.0, dy)) * seaLines;
      float refl = 0.0;
      for (int i = 0; i < ${N_MOONS}; i++) {
        if (moon[i].z > 0.0 && moonX[i].y > 0.0) refl += exp(-abs(sq.x - moon[i].x) / (moon[i].z * 0.7 + dy * 0.25)) * moonX[i].y;
      }
      float g = glow.z > 0.0 ? exp(-abs(sq.x - glow.x) / (glow.z * 0.6 + dy * 0.3)) : 0.0;
      vec3 shine = (glowCol * g * 1.2 + moonCol[0] * refl * 0.35) * (0.4 + 0.9 * lines) * smoothstep(0.0, 30.0, dy);
      col = s + shine + hor * lines * 0.18;
      col = mix(col, hor * 0.8, exp(-dy / 26.0) * 0.6);     // the bright line of the horizon
    }
  }
  return col;
}

void main() {
  vec2 P = vec2(FRAG_PX.x, 1080.0 - FRAG_PX.y);
  vec3 c = vec3(0.0);
  for (int k = ssK0(); k < ssK1(); k++) c += shade(P + rgss(k) / PX_SCALE);
  fragColor = vec4(c * ssWeight(), 1.0);
}
`;

export class Sky {
  pass = new FSPass(FRAG, {
    t: { value: 0 }, cam: { value: new THREE.Vector4(1, 0, 0, 0) }, camF: { value: new THREE.Vector2(0.5, 0.5) }, depth: { value: 0.25 },
    top: { value: new THREE.Vector3() }, mid: { value: new THREE.Vector3() }, hor: { value: new THREE.Vector3() }, horY: { value: 700 },
    neb: { value: 0 }, nebA: { value: new THREE.Vector3() }, nebB: { value: new THREE.Vector3() }, nebScale: { value: 1 }, nebSeed: { value: 0 }, drift: { value: 1 },
    stars: { value: 0 }, milky: { value: 0 }, milkyAngle: { value: 0.4 },
    glow: { value: new THREE.Vector3() }, glowCol: { value: new THREE.Vector3() }, rays: { value: 0 },
    moon: { value: Array.from({ length: N_MOONS }, () => new THREE.Vector4()) },
    moonCol: { value: Array.from({ length: N_MOONS }, () => new THREE.Vector3()) },
    moonX: { value: Array.from({ length: N_MOONS }, () => new THREE.Vector3()) },
    aurora: { value: 0 }, auroraA: { value: new THREE.Vector3() }, auroraB: { value: new THREE.Vector3() },
    clouds: { value: 0 }, cloudY: { value: 600 }, cloudCol: { value: new THREE.Vector3() }, cloudLit: { value: new THREE.Vector3() },
    seaY: { value: 9999 }, seaCol: { value: new THREE.Vector3() }, seaLines: { value: 1 },
    rift: { value: new THREE.Vector4() },
    shell: { value: 0 }, crack: { value: 0 }, crackCol: { value: new THREE.Vector3() },
    ssTap: SS_TAP,
  });

  render(renderer: THREE.WebGLRenderer, out: THREE.WebGLRenderTarget, p: SkyParams, cam: Cam, t: number) {
    const u = this.pass.u;
    const v3 = (k: string, c: RGB | undefined) => (u[k]!.value as THREE.Vector3).set(...(c ?? [0, 0, 0]));
    u.t!.value = t;
    (u.cam!.value as THREE.Vector4).set(cam.zoom, cam.x, cam.y, 0);
    (u.camF!.value as THREE.Vector2).set(cam.fx, cam.fy);
    u.depth!.value = p.depth ?? 0.25;
    v3('top', p.top); v3('mid', p.mid); v3('hor', p.hor); u.horY!.value = p.horY;
    u.neb!.value = p.neb ?? 0; v3('nebA', p.nebA); v3('nebB', p.nebB); u.nebScale!.value = p.nebScale ?? 1; u.nebSeed!.value = p.nebSeed ?? 0; u.drift!.value = p.drift ?? 1;
    u.stars!.value = p.stars ?? 0; u.milky!.value = p.milky ?? 0; u.milkyAngle!.value = p.milkyAngle ?? 0.4;
    (u.glow!.value as THREE.Vector3).set(...(p.glow ?? [0, 0, 0])); v3('glowCol', p.glowCol); u.rays!.value = p.rays ?? 0;
    const ms = p.moons ?? [];
    for (let i = 0; i < N_MOONS; i++) {
      const m = ms[i];
      (u.moon!.value as THREE.Vector4[])[i]!.set(m?.x ?? 0, m?.y ?? 0, m?.r ?? 0, 0);
      (u.moonCol!.value as THREE.Vector3[])[i]!.set(...(m?.col ?? [0, 0, 0]));
      (u.moonX!.value as THREE.Vector3[])[i]!.set(m?.iri ?? 0, m ? m.alpha ?? 1 : 0, m?.maria ?? 1);
    }
    u.aurora!.value = p.aurora ?? 0; v3('auroraA', p.auroraA ?? lin('anemo')); v3('auroraB', p.auroraB ?? lin('electro'));
    u.clouds!.value = p.clouds ?? 0; u.cloudY!.value = p.cloudY ?? p.horY - 200; v3('cloudCol', p.cloudCol); v3('cloudLit', p.cloudLit);
    u.seaY!.value = p.seaY ?? 9999; v3('seaCol', p.seaCol ?? lin('sea')); u.seaLines!.value = p.seaLines ?? 1;
    (u.rift!.value as THREE.Vector4).set(...(p.rift ?? [0, 0, 0, 0]));
    u.shell!.value = p.shell ?? 0; u.crack!.value = p.crack ?? 0; v3('crackCol', p.crackCol ?? lin('goldHot'));
    this.pass.render(renderer, out);
  }
}
