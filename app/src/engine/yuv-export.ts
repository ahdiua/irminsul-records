import * as THREE from 'three';
import { FSPass, makeRT, PW, PH } from './gl';
import { HDR_PQ_GLSL } from './hdr-color';

/** HDR10 levels: the source is the HDR grade (extended-sRGB-encoded Display-P3, 1 = whiteNits). */
export interface YuvHdr { whiteNits: number; peakNits: number }

/**
 * Video frames converted on the GPU to what the encoder takes: limited-range Y'CbCr 4:2:0, planar,
 * top-down (FFmpeg rawvideo yuv420p; with 10 bits, yuv420p10le once unpacked), read back as is.
 * SDR is BT.709; HDR (10 bits only) is PQ / BT.2020 non-constant luminance, the HDR10 signal.
 * Headless Chrome hands frames to the render script at ~165 MB/s whatever the transport (WebSocket,
 * several of them, fetch: slower), so the bytes per frame set the export's speed: 1.5 per pixel (2 with
 * 10 bits) instead of RGBA's 4 (HDR's 16-bit RGB: 8), and FFmpeg no longer flips and converts on the CPU.
 *
 * The source is the post pass's output in a half-float target, undithered: 8 bits are dithered
 * here (one level, as the post pass did for RGBA8); 10 bits are not (an encoder drops a dither at
 * 4K60 anyway, and 10 bits leave only steps of a quarter of an 8-bit level, PQ's ~1/3 of one).
 *
 * 10 bits travel packed, three samples to a little-endian 32-bit word (s0 | s1 << 10 | s2 << 20): 2 bytes
 * per pixel instead of yuv420p10le's 3. Every plane row is a multiple of 3 samples, so the receiver
 * unpacks the frame with one flat loop (unpackYuv10).
 *
 * Layout: each RGBA8 texel holds 4 samples (8 bits) or one word of 3 (10 bits); one texel row per luma
 * row, then the Cb rows (two chroma rows per texel row), then the Cr rows: 1.5 PH rows. Chroma is
 * co-sited with the even luma columns and sits between two luma rows (MPEG-2 "left", what players
 * assume when untagged): a [1 2 1] / 4 filter across, the mean of the two rows down.
 */
export class YuvExport {
  readonly pixelFormat: 'yuv420p' | 'yuv420p10-packed';
  readonly bytesPerPixel: number;
  private target: THREE.WebGLRenderTarget;
  private pack: FSPass;
  private width: number;
  private height: number;

  constructor(readonly bits: 8 | 10, readonly hdr: YuvHdr | null = null) {
    const S = bits === 8 ? 4 : 3; // samples per texel
    if (PW % (2 * S) || PH % 4) throw new Error(`YUV export needs a width divisible by ${2 * S} and a height by 4.`);
    if (hdr && bits !== 10) throw new Error('HDR10 is 10 bits.');
    this.pixelFormat = bits === 8 ? 'yuv420p' : 'yuv420p10-packed';
    this.bytesPerPixel = 1.5 * (4 / S);
    this.width = PW / S;
    this.height = (PH * 3) / 2;
    this.target = makeRT(this.width, this.height, { pxScale: 1, type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const k = 2 ** (bits - 8); // code values scale with the bit depth
    // luma weights (Kr, Kb) of the matrix
    const [kr, kb] = hdr ? [0.2627, 0.0593] : [0.2126, 0.0722];
    const f = (x: number) => x.toFixed(6);
    this.pack = new FSPass(/* glsl */ `
      uniform sampler2D src;
      uniform float time, dither, whiteNits, peakNits;
      const int PWI = ${PW}, PHI = ${PH}, S = ${S}, ROW = ${PW / S}; // ROW: texels per texel row
      const vec3 KY = vec3(${f(kr)}, ${f(1 - kr - kb)}, ${f(kb)});
      ${hdr ? HDR_PQ_GLSL : ''}
      // the non-linear R'G'B' the matrix takes: sRGB as rendered (SDR), PQ of BT.2020 light in nits (HDR)
      vec3 rgbAt(int x, int yTop) {
        vec3 c = texelFetch(src, ivec2(clamp(x, 0, PWI - 1), PHI - 1 - yTop), 0).rgb;
        ${hdr ? 'return toPQ(clamp(p3ToRec2020(toLinear(max(c, 0.0))) * whiteNits, 0.0, peakNits));' : 'return clamp(c, 0.0, 1.0);'}
      }
      // code value of sample (sx, sy) of plane 0 (Y), 1 (Cb) or 2 (Cr)
      float code(int plane, int sx, int sy) {
        float v;
        if (plane == 0) {
          v = (16.0 + 219.0 * dot(rgbAt(sx, sy), KY)) * ${k}.0;
        } else {
          int x = 2 * sx, y = 2 * sy;
          vec3 c = (rgbAt(x - 1, y) + 2.0 * rgbAt(x, y) + rgbAt(x + 1, y)
                  + rgbAt(x - 1, y + 1) + 2.0 * rgbAt(x, y + 1) + rgbAt(x + 1, y + 1)) / 8.0;
          float l = dot(c, KY);
          v = (128.0 + 224.0 * (plane == 1 ? (c.b - l) / ${f(2 * (1 - kb))} : (c.r - l) / ${f(2 * (1 - kr))})) * ${k}.0;
        }
        v += (hash12(vec2(float(sx), float(sy + plane * PHI)) * 1.37 + time) - 0.5) * dither;
        return clamp(floor(v + 0.5), 0.0, ${2 ** bits - 1}.0);
      }
      void main() {
        ivec2 t = ivec2(gl_FragCoord.xy); // readback is bottom-up: texel row t.y is buffer row t.y
        int plane = 0, sy = t.y, sx = t.x * S;
        if (t.y >= PHI) {
          int r = t.y - PHI;
          plane = r < PHI / 4 ? 1 : 2;
          r -= (plane - 1) * (PHI / 4);
          sy = 2 * r + (t.x >= ROW / 2 ? 1 : 0);
          sx = (t.x % (ROW / 2)) * S;
        }
        if (S == 4) {
          fragColor = vec4(code(plane, sx, sy), code(plane, sx + 1, sy), code(plane, sx + 2, sy), code(plane, sx + 3, sy)) / 255.0;
        } else {
          uint w = uint(code(plane, sx, sy)) | (uint(code(plane, sx + 1, sy)) << 10u) | (uint(code(plane, sx + 2, sy)) << 20u);
          fragColor = vec4(float(w & 255u), float((w >> 8u) & 255u), float((w >> 16u) & 255u), float(w >> 24u)) / 255.0;
        }
      }`, { src: { value: null }, time: { value: 0 }, dither: { value: bits === 8 ? 1 : 0 }, whiteNits: { value: hdr?.whiteNits ?? 0 }, peakNits: { value: hdr?.peakNits ?? 0 } });
  }

  render(renderer: THREE.WebGLRenderer, source: THREE.Texture, time: number) {
    this.pack.u.src!.value = source;
    this.pack.u.time!.value = time;
    const gl = renderer.getContext(), dither = gl.isEnabled(gl.DITHER);
    gl.disable(gl.DITHER); // these channels are bytes, not display colors
    try { this.pack.render(renderer, this.target); }
    finally { if (dither) gl.enable(gl.DITHER); }
  }

  async readPixelsAsync(renderer: THREE.WebGLRenderer, buffer: Uint8Array = new Uint8Array(PW * PH * this.bytesPerPixel)) {
    if (buffer.byteLength !== PW * PH * this.bytesPerPixel) throw new Error('Incorrect YUV frame buffer size.');
    await renderer.readRenderTargetPixelsAsync(this.target, 0, 0, this.width, this.height, buffer);
    return buffer;
  }

  dispose() { this.target.dispose(); this.pack.mat.dispose(); }
}
