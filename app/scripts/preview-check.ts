#!/usr/bin/env bun
// Browser regression checks; run through `bun run check`, or with Vite at PDOOM_URL (default http://127.0.0.1:5173).
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { BASE } from './server';

declare global { interface Window { __pdoom: any } }

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--force_high_performance_gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`); });
  const ready = async () => {
    await page.waitForFunction(() => window.__pdoom?.ready, null, { timeout: 120000 });
    assert.deepEqual(await page.evaluate(() => window.__pdoom.engine.errors), []);
    await page.waitForFunction(() => document.querySelector('#info')!.textContent!.includes('paused'));
  };
  await page.goto(`${BASE}/?t=10.64`);
  await ready();
  // Pausing must stop rendering, not simply freeze the audio clock.
  await page.waitForTimeout(500); // allow the initial audio seeked event to repaint
  const frameCount = () => page.evaluate(() => window.__pdoom.engine.renderer.info.render.frame);
  const initialFrames = await frameCount();
  await page.waitForTimeout(500);
  assert.equal(await frameCount(), initialFrames, 'paused preview keeps redrawing');

  const oldHeight = await page.locator('#wrap').evaluate((el) => el.clientHeight);
  await page.keyboard.press('h');
  assert.equal(await page.locator('#ui').isVisible(), false);
  assert.ok(await page.locator('#wrap').evaluate((el) => el.clientHeight) > oldHeight);
  await page.keyboard.press('h');
  assert.equal(await page.locator('#ui').isVisible(), true);
  await page.locator('#scrub').focus();
  await page.keyboard.press('h');
  assert.equal(await page.locator('#ui').isVisible(), false);
  await page.keyboard.press('h');
  assert.equal(await page.locator('#ui').isVisible(), true);

  assert.equal(await page.locator('#grain').getAttribute('aria-pressed'), 'false');
  await page.waitForFunction(() => window.__pdoom.engine.lastPost.grain === 0);
  const pixelsWithoutGrain = await page.evaluate(() => Array.from(window.__pdoom.engine.readPixels().slice(400000, 404000)));
  await page.locator('#grain').click();
  assert.equal(await page.locator('#grain').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => window.__pdoom.engine.lastPost.grain > 0);
  const pixelsWithGrain = await page.evaluate(() => Array.from(window.__pdoom.engine.readPixels().slice(400000, 404000)));
  assert.notDeepEqual(pixelsWithGrain, pixelsWithoutGrain, 'grain switch did not change pixels');

  // The motion-blur switch (no scene of this film authors its own blur; the switch must still toggle).
  await page.evaluate(() => window.__pdoom.seek(83));
  await page.waitForFunction(() => document.querySelector('#info')!.textContent!.startsWith('83.00s'));
  assert.equal(await page.locator('#motion-blur').getAttribute('aria-pressed'), 'false');
  await page.locator('#motion-blur').click();
  assert.equal(await page.locator('#motion-blur').getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => window.__pdoom.engine.effects.motionBlur === true);
  await page.locator('#motion-blur').click();
  assert.equal(await page.locator('#motion-blur').getAttribute('aria-pressed'), 'false');

  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => !document.fullscreenElement);

  await page.evaluate(() => window.__pdoom.seek(10.64));
  await page.waitForFunction(() => document.querySelector('#info')!.textContent!.startsWith('10.64s'));
  assert.equal(await page.locator('#resolution').textContent(), '1080p (Switch to 2160p)');
  await Promise.all([page.waitForURL(/scale=2/), page.locator('#resolution').click()]);
  await ready();
  assert.deepEqual(await page.locator('#c').evaluate((el) => [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height]), [3840, 2160]);
  assert.equal(await page.evaluate(() => window.__pdoom.time), 10.64);
  assert.equal(await page.locator('#resolution').textContent(), '2160p (Switch to 1080p)');
  assert.equal(await page.locator('#motion-blur').getAttribute('aria-pressed'), 'false');
  assert.equal(await page.locator('#grain').getAttribute('aria-pressed'), 'true');
  await Promise.all([page.waitForURL(/scale=1/), page.locator('#resolution').click()]);
  await ready();
  assert.deepEqual(await page.locator('#c').evaluate((el) => [(el as HTMLCanvasElement).width, (el as HTMLCanvasElement).height]), [1920, 1080]);
  assert.equal(await page.locator('#resolution').textContent(), '1080p (Switch to 2160p)');

  // Render every plate and both sides of all cuts, with both effect settings.
  for (const enabled of [false, true]) {
    await page.evaluate((enabled) => {
      const e = window.__pdoom.engine;
      e.effects.motionBlur = e.effects.grain = enabled;
      for (const entry of e.timeline) {
        for (const t of [entry.start + 0.01, (entry.start + entry.end) / 2, entry.end - 0.01]) e.render(t);
      }
    }, enabled);
  }
  // Play/pause and frame stepping still work with a focused button.
  await page.locator('#play').click();
  await page.waitForFunction(() => window.__pdoom.playing && window.__pdoom.time > 10.7);
  await page.locator('#play').click();
  await page.waitForFunction(() => !window.__pdoom.playing);
  await page.evaluate(() => window.__pdoom.seek(10.64));
  await page.locator('#play').click();
  await page.waitForFunction(() => window.__pdoom.playing);
  await Promise.all([page.waitForURL(/scale=2/), page.locator('#resolution').click()]);
  await page.waitForFunction(() => window.__pdoom?.ready && window.__pdoom.playing, null, { timeout: 120000 });
  assert.ok(await page.evaluate(() => window.__pdoom.time) >= 10.64);
  await page.locator('#play').click();
  await page.waitForFunction(() => !window.__pdoom.playing);
  await page.evaluate(() => window.__pdoom.seek(10.64));
  await page.keyboard.press('.');
  assert.ok(Math.abs(await page.evaluate(() => window.__pdoom.time) - (10.64 + 1 / 60)) < 1e-6);

  // Space key toggles play/pause even when a button or scrub input has focus
  await page.locator('#grain').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => window.__pdoom.playing);
  await page.locator('#scrub').focus();
  await page.keyboard.press('Space');
  await page.waitForFunction(() => !window.__pdoom.playing);
  assert.deepEqual(errors, []);
  console.log('PASS: paused rendering, hide/restore layout, grain pixels, scene motion blur, fullscreen, 4K/1080p switching, settings/time/playback retention, all scene cuts, playback and stepping.');
} finally { await browser.close(); }
