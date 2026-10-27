#!/usr/bin/env bun
// HDR preview check: the preview's HDR path (?hdr=test: the HDR display path even when the browser reports
// SDR) boots, presents through WebGPU, and shows the export's grade: a highlight above reference white,
// in the same place and of the same level as the HDR video's frame (export ?output=hdr10, same time).
// Against Vite at PDOOM_URL (default http://127.0.0.1:5173), or a private one.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BASE, reachable, startServer } from './server';

declare global { interface Window { __pdoom: any } }

const T = 182.5, AT: [number, number] = [693, 717]; // the sea's sunlit glint (1080p px, top-down)
const server = (await reachable(BASE)) ? { url: BASE, stop: () => {} } : await startServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1200 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${server.url}/?hdr=test&t=${T}&warmup=0`);
  await page.waitForFunction(() => window.__pdoom?.ready || window.__pdoom?.error, null, { timeout: 120000 });
  const state = await page.evaluate(() => window.__pdoom.hdr);
  assert.ok(state.active, `HDR preview inactive: ${state.reason}`);
  // the preview's level at AT: extended-sRGB Display-P3 (1 = SDR white), as presented
  const preview: number[] = await page.evaluate(async ([t, x, y]) => {
    const E = window.__pdoom.engine;
    E.render(t);
    return E.hdrDisplay.readPixel(x, y);
  }, [T, ...AT] as const);
  // the export's level there: the HDR video's post output, same grade
  const exp = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await exp.goto(`${server.url}/?export=1&output=hdr10`);
  await exp.waitForFunction(() => window.__pdoom?.ready, null, { timeout: 120000 });
  const exported: number[] = await exp.evaluate(([t, x, y]) => {
    const E = window.__pdoom.engine;
    E.effects.grain = false;
    E.render(t, 1 / 60, false);
    // (a half-float target reads back as half floats)
    const px = new Uint16Array(4), rt = (E as any).hdrRT;
    E.renderer.readRenderTargetPixels(rt, x, rt.height - 1 - y, 1, 1, px);
    return Array.from(px, (bits) => {
      const e = (bits >> 10) & 31, m = bits & 1023;
      return (bits & 32768 ? -1 : 1) * (e === 0 ? m / 1024 * 2 ** -14 : (1 + m / 1024) * 2 ** (e - 15));
    });
  }, [T, ...AT] as const);
  console.log(`preview ${preview.slice(0, 3).map((v) => v.toFixed(3)).join(' ')}, export ${exported.slice(0, 3).map((v) => v.toFixed(3)).join(' ')}`);
  assert.ok(Math.max(...preview.slice(0, 3)) > 1.2, 'no light above SDR white in the HDR preview');
  // (the preview takes one spatial sample per pixel, the export several: a glint differs a little)
  for (let c = 0; c < 3; c++) assert.ok(Math.abs(preview[c]! - exported[c]!) < 0.08 * Math.max(1, exported[c]!), `channel ${c}: preview ${preview[c]} vs export ${exported[c]}`);
  assert.deepEqual(errors, []);
  console.log('HDR preview: ok');
} finally {
  await browser.close();
  server.stop();
}
