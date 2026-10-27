// Encoder-independent raw input and color conversion, plus encoder-specific
// defaults. Extra output arguments are appended as argv entries, never a shell.
export interface VideoEncoding {
  hdr: boolean;
  codec?: string;
  preset?: string;
  crf?: string;
  cq?: string;
  /** NVENC rate ceiling (e.g. 32M); default 400M, so CQ decides. */
  maxrate?: string;
  /** SDR in 10 bits (HEVC Main10 / AV1), converted from the half-float frame (yuv420p10le, undithered). From
   * 8-bit frames the encoder had to keep the dither that hides the 8-bit steps; at 4K60 it couldn't (even at
   * 80 Mbps) and dark skies came out in blocky bands. (On an 8-bit display a player still has to dither.) */
  tenBit?: boolean;
  x264?: string;
  x265?: string;
  width: number;
  height: number;
  fps: number;
  from: number;
  to: number;
  audio?: string;
  output: string;
  whiteNits: number;
  peakNits: number;
  /** Content light levels in nits. Unset: MaxCLL is the grading ceiling and MaxFALL unknown (0). */
  maxCLL?: number;
  maxFALL?: number;
  inputHdrMetadata?: boolean;
  extra: string[];
}

/** The app's 10-bit YUV frame (three samples to a little-endian 32-bit word) as yuv420p10le. */
export function unpackYuv10(packed: Uint8Array): Uint8Array {
  const aligned = packed.byteOffset % 4 === 0 ? packed : packed.slice();
  const words = new Uint32Array(aligned.buffer, aligned.byteOffset, aligned.byteLength >> 2);
  const out = new Uint16Array(words.length * 3);
  for (let i = 0, j = 0; i < words.length; i++, j += 3) {
    const w = words[i]!;
    out[j] = w & 1023; out[j + 1] = (w >>> 10) & 1023; out[j + 2] = (w >>> 20) & 1023;
  }
  return new Uint8Array(out.buffer);
}

export function videoEncodingArgs(o: VideoEncoding) {
  const codec = o.codec ?? (o.hdr ? 'libx265' : 'libx264');
  if (o.hdr && ['libx264', 'h264_nvenc', 'libopenh264'].includes(codec)) throw new Error('--hdr requires a 10-bit HEVC or AV1 encoder (for example hevc_nvenc or libx265).');
  if (!Number.isFinite(o.fps) || o.fps <= 0 || !Number.isFinite(o.from) || !Number.isFinite(o.to) || o.from < 0 || o.to <= o.from) throw new Error('Require fps > 0 and 0 <= from < to.');
  if (o.hdr && (!Number.isFinite(o.whiteNits) || !Number.isFinite(o.peakNits) || o.whiteNits <= 0 || o.peakNits < o.whiteNits || o.peakNits > 10000)) throw new Error('Require 0 < --hdr-white <= --hdr-peak <= 10000.');
  if (o.extra.some((arg) => typeof arg !== 'string' || arg.includes('\0'))) throw new Error('Custom FFmpeg arguments must be strings without NUL bytes.');
  const nvenc = codec.endsWith('_nvenc');
  if (o.tenBit && ['libx264', 'h264_nvenc', 'libopenh264'].includes(codec)) throw new Error('--10bit needs HEVC or AV1 (for example hevc_nvenc).');
  const deep = o.hdr || !!o.tenBit;
  // frames arrive as Y'CbCr 4:2:0 (HDR: PQ / BT.2020nc), converted and flipped on the GPU (the app's
  // YuvExport); 10 bits packed on the wire (wireFormat), unpacked by unpackYuv10
  const pixelFormat = deep ? 'yuv420p10le' : 'yuv420p';
  const wireFormat = deep ? 'yuv420p10-packed' : 'yuv420p';
  const wireBytesPerPixel = deep ? 2 : 1.5;
  const outFormat = deep ? (nvenc ? 'p010le' : 'yuv420p10le') : 'yuv420p';
  if (o.hdr && [o.maxCLL ?? 0, o.maxFALL ?? 0].some((nits) => !Number.isFinite(nits) || nits < 0 || nits > 10000)) throw new Error('Content light levels must be 0..10000 nits.');
  // The grade stays inside Display-P3 (D65), carried in a BT.2020 container.
  const mastering = `G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(${Math.round(o.peakNits * 10000)},1)`;
  const light = `${Math.ceil(o.maxCLL ?? o.peakNits)},${Math.ceil(o.maxFALL ?? 0)}`;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', pixelFormat,
    '-s', `${o.width}x${o.height}`, '-r', String(o.fps)];
  if (o.hdr && o.inputHdrMetadata) args.push('-mastering_display', mastering, '-content_light', light);
  args.push('-i', 'pipe:0');
  if (o.audio) args.push('-ss', String(o.from), '-t', String(o.to - o.from), '-i', o.audio);
  args.push('-map', '0:v:0');
  if (o.audio) args.push('-map', '1:a:0');
  // (tags only: the frames are already the output signal)
  const filter = o.hdr
    ? 'setparams=range=tv:colorspace=bt2020nc:color_primaries=bt2020:color_trc=smpte2084'
    : 'setparams=range=tv:colorspace=bt709:color_primaries=bt709:color_trc=bt709';
  args.push('-vf', filter, '-c:v', codec, '-pix_fmt', outFormat);
  if (nvenc) {
    // (-maxrate: without it NVENC's VBR caps the rate at its level's default, ~32 Mbps for 4K60 HEVC,
    // and CQ only decides below that; every 4K minute came out at exactly 32 Mbps)
    const max = o.maxrate ?? '400M', buf = `${2 * parseFloat(max)}${max.replace(/^[\d.]+/, '')}`;
    args.push('-preset', o.preset ?? 'p6', '-rc', 'vbr', '-cq', o.cq ?? o.crf ?? '18', '-b:v', '0', '-maxrate', max, '-bufsize', buf);
    if (deep && codec === 'hevc_nvenc') args.push('-profile:v', 'main10');
  } else if (codec === 'libx264' || codec === 'libx265') {
    args.push('-preset', o.preset ?? 'slow', '-crf', o.crf ?? (o.hdr ? '18' : '16'));
    if (codec === 'libx264') args.push('-tune', 'grain', '-x264-params', o.x264 ?? 'aq-mode=3');
    else {
      // Nominal P3-D65 mastering volume. Without measured light levels MaxFALL
      // is left unknown (0), rather than inventing an average for the content.
      const hdrParams = `hdr10=1:repeat-headers=1:master-display=${mastering}:max-cll=${light}`;
      args.push('-x265-params', [o.hdr ? hdrParams : '', o.x265 ?? ''].filter(Boolean).join(':') || 'aq-mode=3');
    }
  } else {
    if (o.preset) args.push('-preset', o.preset);
    if (o.crf) args.push('-crf', o.crf);
  }
  if (o.hdr) args.push('-color_primaries', 'bt2020', '-color_trc', 'smpte2084', '-colorspace', 'bt2020nc', '-color_range', 'tv');
  if (o.audio) args.push('-c:a', 'copy', '-shortest');
  if (/\.(mp4|mov|m4v)$/i.test(o.output)) {
    args.push('-movflags', '+faststart');
    if (/hevc|265/.test(codec)) args.push('-tag:v', 'hvc1'); // (QuickTime / Apple players need hvc1)
  }
  args.push(...o.extra, o.output);
  return { args, codec, pixelFormat, wireFormat, wireBytesPerPixel };
}
