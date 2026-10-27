#!/usr/bin/env bun
// The video-site cover: chorus 3's rock neon fully lit (her figure, 我很黑凤梨, 喜欢你 ruby, hei fun nei,
// the pineapple) at 181.0 s, from a camera square on to the sign and without the first ribbon's tail
// (in the film it crosses her), with the title set over it. Renders at 4K and writes
//   out/cover.png (3840x2160) and out/cover.jpg (1920x1080, for upload; most sites want 16:9 under ~2 MB).
//   PDOOM_URL=http://127.0.0.1:5190 bun scripts/cover.ts [--t 181.0] [--dist 38]
import { chromium } from 'playwright-core';
import path from 'node:path';
import { BASE } from './server';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const T = +opt('t', '181.0'), DIST = +opt('dist', '47');
const OUT = path.resolve(import.meta.dir, '../../out');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${BASE}/?export=1&scale=2`);
  await page.waitForFunction(() => (window as any).__pdoom?.ready || (window as any).__pdoom?.error, null, { timeout: 180000 });
  const out = await page.evaluate(async ({ T, DIST }) => {
    const P = (window as any).__pdoom;
    if (P.error) throw new Error(P.error);
    const s = P.engine.loaded.get('chorus3').scene;
    // the first ribbon already gone (its tail crosses her), the camera square on to the whole sign
    // (and the second, whose head sits on her as it sets off)
    s.A = { ...s.A, t1: s.A.t0 + 0.01 };
    s.B = { ...s.B, t0: 1e9 };
    const H = s.sign3, c = H.centre, f = H.S.facing;
    // (back far enough and looking up enough that the lit lantern above the sign is whole)
    s.pose = () => ({ pos: [c[0] + f[0] * DIST, c[1] + 3.5, c[2] + f[2] * DIST], look: [c[0], c[1] + 4.2, c[2]], fov: 50 });
    P.still(T, 36, 0.05);
    const img = new Image();
    img.src = 'data:image/png;base64,' + (await P.png());
    await img.decode();
    const W = 3840, H2 = 2160, k = W / 1920;
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H2;
    const g = cv.getContext('2d')!;
    g.drawImage(img, 0, 0, W, H2);
    // a soft darkening at the top for the title (the sky is already dark; this only lifts contrast)
    const grad = g.createLinearGradient(0, 0, 0, 420 * k);
    grad.addColorStop(0, 'rgba(11,14,23,0.55)');
    grad.addColorStop(1, 'rgba(11,14,23,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, 420 * k);
    g.textBaseline = 'alphabetic';
    // 黑凤梨, big, bone; the credit under it in pink (the KTV's colour) — palette only
    g.font = `${170 * k}px "Smiley"`;
    g.fillStyle = '#EEE9DF';
    g.fillText('黑凤梨', 110 * k, 250 * k);
    g.font = `${54 * k}px "Sans-700"`;
    g.fillStyle = '#FF3D7F';
    g.fillText('Z新豪 feat.洛天依', 118 * k, 336 * k);
    return { png: cv.toDataURL('image/png').split(',')[1], jpg: (() => {
      const c2 = document.createElement('canvas');
      c2.width = 1920; c2.height = 1080;
      const g2 = c2.getContext('2d')!;
      g2.imageSmoothingQuality = 'high';
      g2.drawImage(cv, 0, 0, 1920, 1080);
      return c2.toDataURL('image/jpeg', 0.92).split(',')[1];
    })() };
  }, { T, DIST });
  await Bun.write(path.join(OUT, 'cover.png'), Buffer.from(out.png!, 'base64'));
  await Bun.write(path.join(OUT, 'cover.jpg'), Buffer.from(out.jpg, 'base64'));
  console.log(`wrote ${path.join(OUT, 'cover.png')} and cover.jpg`);
} finally { await browser.close(); }
