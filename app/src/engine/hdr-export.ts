import * as THREE from 'three';
import { FSPass, makeRT, W, H, PW, PH, SCALE } from './gl';
import { HDR_PQ_GLSL, type HdrGrade } from './hdr-color';
import { YuvExport } from './yuv-export';

/**
 * The grade's headroom is peakNits / whiteNits; the rest of it is `look`. `frames`: 'yuv' for video (HDR10
 * Y'CbCr 4:2:0, 10 bits packed, converted on the GPU: see YuvExport), 'rgb16' for stills (16-bit PQ RGB).
 */
export interface HdrExportOptions { whiteNits: number; peakNits: number; look: Omit<HdrGrade, 'headroom'>; frames: 'yuv' | 'rgb16' }

/** Static HDR10 content light levels in nits: brightest pixel, and brightest frame average (both of max(R,G,B)). */
export interface HdrLight { max: number; average: number }

// the post pass stores extended-sRGB-encoded Display-P3: linear BT.2020 light in nits
const NITS_GLSL = /* glsl */ `
  uniform sampler2D src;
  uniform float whiteNits, peakNits;
  ${HDR_PQ_GLSL}
  vec3 nitsAt(ivec2 p) {
    return clamp(p3ToRec2020(toLinear(max(texelFetch(src, p, 0).rgb, 0.0))) * whiteNits, 0.0, peakNits);
  }`;

/** HDR export frames. 'rgb16' packs each RGB PQ16 pixel into two RGBA8 texels. Readback is rgba64le:
 * Rlo Rhi Glo Ghi | Blo Bhi Alo Ahi. This keeps all 16 bits without float
 * readback, CPU conversion, or an 8-bit SDR intermediate. Rows remain bottom-up.
 * 'yuv' is a quarter of the bytes (the export's speed is bytes per frame) and needs no conversion in FFmpeg. */
export class HdrExport {
  readonly pixelFormat: 'rgba64le' | 'yuv420p10-packed';
  readonly bytesPerPixel: number;
  readonly grade: HdrGrade;
  private target: THREE.WebGLRenderTarget | null = null;
  private pack: FSPass | null = null;
  private yuv: YuvExport | null = null;
  private lightRT: THREE.WebGLRenderTarget;
  private light: FSPass;
  private lightBuf: Float32Array;

  constructor(renderer: THREE.WebGLRenderer, readonly options: HdrExportOptions) {
    const { whiteNits, peakNits, look } = options;
    if (!Number.isFinite(whiteNits) || !Number.isFinite(peakNits) || whiteNits <= 0 || peakNits < whiteNits || peakNits > 10000) {
      throw new Error('HDR requires 0 < whiteNits <= peakNits <= 10000.');
    }
    if (![look.gamut, look.hue, look.glow].every((x) => x >= 0 && x <= 1)) throw new Error('HDR gamut, hue and glow must be between 0 and 1.');
    this.grade = { headroom: peakNits / whiteNits, ...look };
    const levels = { src: { value: null }, whiteNits: { value: whiteNits }, peakNits: { value: peakNits } };
    if (options.frames === 'yuv') {
      this.yuv = new YuvExport(10, { whiteNits, peakNits });
      this.pixelFormat = this.yuv.pixelFormat as 'yuv420p10-packed';
      this.bytesPerPixel = this.yuv.bytesPerPixel;
    } else {
      if (PW * 2 > renderer.capabilities.maxTextureSize) throw new Error(`HDR packing needs a ${PW * 2}-pixel-wide texture; reduce --scale for this GPU.`);
      this.pixelFormat = 'rgba64le';
      this.bytesPerPixel = 8;
      this.target = makeRT(W * 2, H, { type: THREE.UnsignedByteType, depthBuffer: false });
      this.pack = new FSPass(/* glsl */ `
        ${NITS_GLSL}
        void main() {
          ivec2 p = ivec2(gl_FragCoord.xy);
          uvec3 q = uvec3(round(toPQ(nitsAt(ivec2(p.x / 2, p.y))) * 65535.0));
          uvec4 bytes = (p.x & 1) == 0
            ? uvec4(q.r & 255u, q.r >> 8u, q.g & 255u, q.g >> 8u)
            : uvec4(q.b & 255u, q.b >> 8u, 255u, 255u);
          fragColor = vec4(bytes) / 255.0;
        }`, { ...levels });
    }
    // content light: per block of B x B physical px (8 x 8 logical), the largest and the mean max(R,G,B)
    const B = 8 * SCALE;
    this.lightRT = makeRT(W / 8, H / 8, { type: THREE.FloatType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, pxScale: 1 });
    this.lightBuf = new Float32Array(this.lightRT.width * this.lightRT.height * 4);
    this.light = new FSPass(/* glsl */ `
      ${NITS_GLSL}
      void main() {
        ivec2 p0 = ivec2(gl_FragCoord.xy) * ${B};
        float top = 0.0, sum = 0.0;
        for (int y = 0; y < ${B}; y++) for (int x = 0; x < ${B}; x++) {
          vec3 n = nitsAt(p0 + ivec2(x, y));
          float m = max(n.r, max(n.g, n.b));
          top = max(top, m); sum += m;
        }
        fragColor = vec4(top, sum / ${B * B}.0, 0.0, 1.0);
      }`, { ...levels });
  }

  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, time: number) {
    if (this.yuv) { this.yuv.render(renderer, source, time); return; }
    this.pack!.u.src!.value = source;
    const gl = renderer.getContext(), dither = gl.isEnabled(gl.DITHER);
    gl.disable(gl.DITHER); // these channels are bytes, not display colors
    try { this.pack!.render(renderer, this.target); }
    finally { if (dither) gl.enable(gl.DITHER); }
  }

  /** Light levels of one graded frame (the post pass output). `over`: for each of `levels` (nits), the share
   * of the frame (8 x 8 logical px blocks, by their mean) above it. */
  measureLight(renderer: THREE.WebGLRenderer, source: THREE.Texture, levels: number[] = []): HdrLight & { over: number[] } {
    this.light.u.src!.value = source;
    this.light.render(renderer, this.lightRT);
    renderer.readRenderTargetPixels(this.lightRT, 0, 0, this.lightRT.width, this.lightRT.height, this.lightBuf);
    let max = 0, sum = 0;
    const over = levels.map(() => 0), n = this.lightBuf.length / 4;
    for (let i = 0; i < this.lightBuf.length; i += 4) {
      const mean = this.lightBuf[i + 1]!;
      max = Math.max(max, this.lightBuf[i]!); sum += mean;
      for (let k = 0; k < levels.length; k++) if (mean > levels[k]!) over[k]!++;
    }
    return { max, average: sum / n, over: over.map((c) => c / n) };
  }

  async readPixelsAsync(renderer: THREE.WebGLRenderer, buffer: Uint8Array = new Uint8Array(PW * PH * this.bytesPerPixel)) {
    if (this.yuv) return this.yuv.readPixelsAsync(renderer, buffer);
    if (buffer.byteLength !== PW * PH * this.bytesPerPixel) throw new Error('Incorrect HDR frame buffer size.');
    await renderer.readRenderTargetPixelsAsync(this.target!, 0, 0, PW * 2, PH, buffer);
    return buffer;
  }

  dispose() { this.yuv?.dispose(); this.target?.dispose(); this.pack?.mat.dispose(); this.lightRT.dispose(); this.light.mat.dispose(); }
}
