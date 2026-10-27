#!/usr/bin/env bun
// Trace the city camera frame by frame (position, view direction, fov) and flag jerks: frames where the
// camera's velocity or turn rate reverses or jumps. For hunting camera stutter.
//   PDOOM_URL=http://127.0.0.1:5190 bun scripts/cam-trace.ts --from 124 --to 130 [--id chorus2] [--csv out.csv]
import { chromium } from 'playwright-core';
import { BASE } from './server';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const from = +opt('from', '0')!, to = +opt('to', '5')!, id = opt('id'), csv = opt('csv');

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage();
  await page.goto(`${BASE}/?export=1`);
  await page.waitForFunction(() => (window as any).__pdoom?.ready || (window as any).__pdoom?.error, null, { timeout: 180000 });
  const entries = await page.evaluate(({ from, to }) => ((window as any).__pdoom.timeline as { id: string; start: number; end: number }[])
    .filter((s) => s.end > from && s.start < to).map((s) => `${s.id} ${s.start.toFixed(3)}-${s.end.toFixed(3)}`), { from, to });
  console.log('entries:', entries.join(' | '));
  const rows = await page.evaluate(({ from, to, id }) => {
    const P = (window as any).__pdoom, e = P.engine;
    if (P.error) throw new Error(P.error);
    const out: number[][] = [];
    for (let f = Math.round(from * 60); f < Math.round(to * 60); f++) {
      const t = f / 60;
      P.still(t);
      // the scene drawing the city at t (the last entry covering t, or the one asked for)
      const recs = [...e.loaded.values()].filter((r: any) => r.scene?.world && (id ? r.entry.id === id : t >= r.entry.start && t < r.entry.end));
      const cam = recs[recs.length - 1]?.scene.world.camera;
      if (!cam) continue;
      const d = [0, 0, -1];
      const m = cam.matrixWorld.elements;
      const dir = [-m[8], -m[9], -m[10]];
      out.push([t, cam.position.x, cam.position.y, cam.position.z, dir[0], dir[1], dir[2], cam.fov]);
      void d;
    }
    return out;
  }, { from, to, id });
  if (csv) await Bun.write(csv, 't,x,y,z,dx,dy,dz,fov\n' + rows.map((r) => r.map((v) => v.toFixed(5)).join(',')).join('\n'));
  // jerks: per frame, speed (m/s) and turn rate (deg/s); flag sign flips of acceleration with large magnitude
  const sp: number[] = [], tr: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1]!, b = rows[i]!;
    sp.push(Math.hypot(b[1]! - a[1]!, b[2]! - a[2]!, b[3]! - a[3]!) * 60);
    const dot = Math.min(1, a[4]! * b[4]! + a[5]! * b[5]! + a[6]! * b[6]!);
    tr.push((Math.acos(dot) * 180) / Math.PI * 60);
  }
  console.log('t        speed m/s   turn deg/s   fov');
  for (let i = 0; i < sp.length; i++) {
    const r = rows[i + 1]!;
    const jerk = i > 0 && i < sp.length - 1 && (Math.abs(sp[i]! - sp[i - 1]!) > 0.25 * Math.max(sp[i]!, 1) || Math.abs(tr[i]! - tr[i - 1]!) > Math.max(6, 0.3 * tr[i]!));
    if (jerk || i % 12 === 0) console.log(`${r[0]!.toFixed(3)}  ${sp[i]!.toFixed(2).padStart(9)}  ${tr[i]!.toFixed(1).padStart(10)}  ${r[7]!.toFixed(1)}${jerk ? '   <-- jerk' : ''}`);
  }
} finally { await browser.close(); }
