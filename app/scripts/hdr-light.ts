#!/usr/bin/env bun
// HDR light survey: the HDR grade's light levels through the film, per scene. Every frame is rendered (stateful
// scenes stay sequential), every --every'th measured: brightest 8x8-px block peak (MaxCLL), frame average
// (FALL), and the share of the frame above reference white, 400 and 600 nits.
//   bun scripts/hdr-light.ts [--from 0] [--to end] [--every 4] [--csv ../out/wip/light.csv] [--hdr-peak 1000] [--hdr-glow 0.3] ...
// Uses PDOOM_URL or the default dev server; starts a private one if unreachable. Renders at 1080p (the
// light pass works on logical px, so the levels are those of the 4K video, up to resampling).
import { chromium } from 'playwright-core';
import path from 'node:path';
import { BASE, reachable, startServer } from './server';
import { HDR_LOOK_KEYS, HDR_WHITE_NITS } from '../src/engine/hdr-color';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const EVERY = Math.max(1, Math.round(+opt('every', '4')!));
const WHITE = +opt('hdr-white', String(HDR_WHITE_NITS))!;
const LEVELS = [WHITE, 400, 600];

const server = (await reachable(BASE)) ? { url: BASE, stop: () => {} } : await startServer();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force_high_performance_gpu', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const url = new URL(server.url);
  url.searchParams.set('export', '1');
  url.searchParams.set('output', 'hdr10');
  for (const key of ['white', 'peak', ...HDR_LOOK_KEYS]) if (opt(`hdr-${key}`)) url.searchParams.set(`hdr-${key}`, opt(`hdr-${key}`)!);
  await page.goto(url.href);
  await page.waitForFunction(() => (window as any).__pdoom?.ready || (window as any).__pdoom?.error, null, { timeout: 120000 });
  const err = await page.evaluate(() => (window as any).__pdoom.error);
  if (err) throw new Error(err);
  await page.evaluate(() => { (window as any).__pdoom.engine.effects.grain = false; });
  const dur: number = await page.evaluate(() => (window as any).__pdoom.duration);
  const timeline: { id: string; start: number; end: number }[] = await page.evaluate(() => (window as any).__pdoom.timeline);
  const from = +opt('from', '0')!, to = +opt('to', String(dur))!;
  const t0 = performance.now();
  const rows: { t: number; max: number; fall: number; over: number[] }[] = await page.evaluate(async ({ from, to, every, levels }) => {
    const E = (window as any).__pdoom.engine, dt = 1 / 60, out: any[] = [];
    const n0 = Math.round(from * 60), n1 = Math.round(to * 60);
    if (n0 > 0) E.render((n0 - 1) * dt, dt, false);
    for (let n = n0; n < n1; n++) {
      E.render(n * dt, dt, false);
      if ((n - n0) % every) continue;
      const l = E.measureHdrLight(levels);
      out.push({ t: n * dt, max: l.max, fall: l.average, over: l.over });
      if (out.length % 30 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    return out;
  }, { from, to, every: EVERY, levels: LEVELS });
  console.log(`${rows.length} frames measured in ${((performance.now() - t0) / 1000).toFixed(0)}s (${WHITE} nit white)`);
  const pct = (x: number) => `${(100 * x).toFixed(1)}%`.padStart(6);
  console.log(`${'scene'.padEnd(10)} ${'from'.padStart(6)} ${'to'.padStart(6)}  MaxCLL   at    MaxFALL   at    FALL p50  >${WHITE} max  >400 max  >600 max (at)`);
  for (const e of timeline) {
    const r = rows.filter((x) => x.t >= e.start && x.t < e.end);
    if (!r.length) continue;
    const top = r.reduce((a, b) => (b.max > a.max ? b : a)), bright = r.reduce((a, b) => (b.fall > a.fall ? b : a));
    const p50 = [...r].sort((a, b) => a.fall - b.fall)[r.length >> 1]!.fall;
    const most = (k: number) => r.reduce((a, b) => (b.over[k]! > a.over[k]! ? b : a));
    const m600 = most(2);
    console.log(`${e.id.padEnd(10)} ${e.start.toFixed(1).padStart(6)} ${e.end.toFixed(1).padStart(6)}  ${top.max.toFixed(0).padStart(6)} ${top.t.toFixed(1).padStart(6)}  ${bright.fall.toFixed(0).padStart(6)} ${bright.t.toFixed(1).padStart(6)}  ${p50.toFixed(0).padStart(7)}  ${pct(most(0).over[0]!)}    ${pct(most(1).over[1]!)}  ${pct(m600.over[2]!)} (${m600.t.toFixed(1)})`);
  }
  const all = rows.reduce((a, b) => (b.fall > a.fall ? b : a));
  console.log(`film: MaxCLL ${Math.max(...rows.map((r) => r.max)).toFixed(0)} nits, MaxFALL ${all.fall.toFixed(0)} nits at ${all.t.toFixed(2)}s`);
  if (opt('csv')) {
    const f = path.resolve(opt('csv')!);
    await Bun.write(f, `t,max,fall,${LEVELS.map((l) => `over${l}`).join(',')}\n` + rows.map((r) => [r.t.toFixed(3), r.max.toFixed(1), r.fall.toFixed(2), ...r.over.map((x) => x.toFixed(4))].join(',')).join('\n') + '\n');
    console.log(f);
  }
} finally {
  await browser.close();
  server.stop();
}
