#!/usr/bin/env bun
// The video-site cover: the film's title card (the world tree, fully lit) with the cover's own words set in the
// card's place. Renders at 4K and writes
//   out/cover-4k.png (3840x2160) and out/cover.jpg (1920x1080, for upload; most sites want 16:9 under ~2 MB).
//   PDOOM_URL=http://127.0.0.1:5190 bun scripts/cover.ts [--t 58.6] [--zh 世界树档案] [--en "IRMINSUL RECORDS"] [--sub 提瓦特编年史]
// New characters must be in the font subset: add them to pipeline/ui_strings.txt and run pipeline/fonts.py.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { BASE } from './server';

const argv = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1]! : d; };
const ROOT = path.resolve(import.meta.dir, '../..');
const { title } = await Bun.file(path.join(ROOT, 'data/chapters.json')).json();
// the title wiped in and its subtitle lit (start + 3.2 s), before it fades (end - 1.4 s)
const T = +opt('t', String(Math.min(title.start + 4.3, title.end - 1.6)));
const TEXT = { zh: opt('zh', '世界树档案'), en: opt('en', 'IRMINSUL RECORDS'), sub: opt('sub', '提瓦特编年史') };
const OUT = path.join(ROOT, 'out');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(`${BASE}/?export=1&scale=2`);
  await page.waitForFunction(() => (window as any).__pdoom?.ready || (window as any).__pdoom?.error, null, { timeout: 180000 });
  const out = await page.evaluate(async ({ T, TEXT }) => {
    const P = (window as any).__pdoom;
    if (P.error) throw new Error(P.error);
    P.still(T); // loads the entry (and the film every entry shares)
    const overlay = [...P.engine.loaded.values()].map((r: any) => r.scene?.overlay).find(Boolean);
    if (!overlay) throw new Error('no chronicle scene loaded');
    overlay.titleText = TEXT;
    P.still(T, 16, 0.5);
    const img = new Image();
    img.src = 'data:image/png;base64,' + (await P.png());
    await img.decode();
    const c2 = document.createElement('canvas');
    c2.width = 1920; c2.height = 1080;
    const g2 = c2.getContext('2d')!;
    g2.imageSmoothingQuality = 'high';
    g2.drawImage(img, 0, 0, 1920, 1080);
    return { png: img.src.split(',')[1]!, jpg: c2.toDataURL('image/jpeg', 0.92).split(',')[1]! };
  }, { T, TEXT });
  // (node's writeFileSync: Bun.write failed with EUNKNOWN overwriting the old cover on this Windows drive)
  writeFileSync(path.join(OUT, 'cover-4k.png'), Buffer.from(out.png, 'base64'));
  writeFileSync(path.join(OUT, 'cover.jpg'), Buffer.from(out.jpg, 'base64'));
  console.log(`t ${T.toFixed(2)}: wrote ${path.join(OUT, 'cover-4k.png')} and cover.jpg`);
} finally { await browser.close(); }
