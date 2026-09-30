// Performance + mobile verification harness.
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core
//   CHROMIUM_PATH=/path/to/chrome node scripts/perf.mjs [url] [out-dir] [--gpu]
//
// Without --gpu it uses SwiftShader (CPU rasteriser): frame times are then a
// CPU-bound worst case, NOT a GPU measurement. Draw calls, triangles, memory,
// tier detection and layout checks are valid either way.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';

const url = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'perf-out';
const gpu = process.argv.includes('--gpu');
mkdirSync(out, { recursive: true });
const LEVELS = ['cosmos', 'satellite', 'array', 'payload', 'pcb', 'package', 'die', 'mosfet', 'silicon', 'energy'];
const args = gpu ? ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args });
const env = { date: new Date().toISOString(), browser: browser.version(), renderer: gpu ? 'hardware GPU' : 'SwiftShader (software)', cpu: os.cpus()[0]?.model, cores: os.cpus().length, os: `${os.platform()} ${os.release()}` };
const errors = [];

async function open(viewport, extra = {}, query = '') {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?nointro${query}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 90000 });
  return { ctx, page };
}
const glInfo = (page) => page.evaluate(() => {
  const gl = document.querySelector('canvas.gl').getContext('webgl2');
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
});

async function measure(page, sampleMs) {
  await page.evaluate(() => window.c2c.stats.clear());
  await page.waitForTimeout(sampleMs);
  return page.evaluate(() => {
    const c = window.c2c;
    const s = c.stats.summary();
    const i = c.frameInfo();
    const m = c.renderer.info.memory;
    return { fps: +s.fps.toFixed(1), avgMs: +s.avgMs.toFixed(1), p95Ms: +s.p95Ms.toFixed(1), stdMs: +s.stdMs.toFixed(1), long: c.stats.longFrames, calls: i.calls, trisK: Math.round(i.triangles / 1000), geo: m.geometries, tex: m.textures, dpr: c.renderer.getPixelRatio() };
  });
}

// ---- 1. per tier, per level (desktop 1600×900, DPR 1) ----
const tiers = {};
for (const tier of ['high', 'balanced', 'performance']) {
  const { ctx, page } = await open({ width: 1600, height: 900 }, {}, `&quality=${tier}`);
  env.gl = env.gl ?? (await glInfo(page));
  const rows = [];
  for (const l of LEVELS) {
    await page.evaluate((id) => window.c2c.mgr.jumpTo(id), l);
    await page.waitForTimeout(1500);
    rows.push({ level: l, ...(await measure(page, 3000)) });
  }
  tiers[tier] = rows;
  console.log(`\n${tier}`);
  console.table(rows);
  await ctx.close();
}

// ---- 2. transition hitch + memory growth over repeated zoom cycles ----
const { ctx: c2, page: p2 } = await open({ width: 1600, height: 900 }, {}, '&quality=balanced');
const memory = [];
const hitch = [];
for (let k = 0; k < 4; k++) {
  await p2.evaluate(() => window.c2c.mgr.jumpTo('satellite'));
  await p2.waitForTimeout(800);
  await p2.evaluate(() => window.c2c.stats.clear());
  await p2.evaluate(() => window.c2c.mgr.goTo('die'));
  await p2.evaluate(() => window.c2c.mgr.goTo('satellite'));
  await p2.waitForTimeout(1500);
  const r = await p2.evaluate(() => ({ geo: window.c2c.renderer.info.memory.geometries, tex: window.c2c.renderer.info.memory.textures, prog: window.c2c.renderer.info.programs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, maxFrameMs: Math.round(window.c2c.stats.maxMs), longFrames: window.c2c.stats.longFrames, p95: +window.c2c.stats.summary().p95Ms.toFixed(1) }));
  memory.push({ cycle: k + 1, geo: r.geo, tex: r.tex, prog: r.prog, heapMB: r.heapMB });
  hitch.push({ cycle: k + 1, maxFrameMs: r.maxFrameMs, longFrames: r.longFrames, p95Ms: r.p95 });
}
console.log('\nmemory after satellite→die→satellite cycles');
console.table(memory);
console.table(hitch);
await c2.close();

// ---- 3. mobile emulation (390×844, DPR 3, touch) ----
const { ctx: c3, page: p3 } = await open({ width: 390, height: 844 }, { deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const mobile = await p3.evaluate(() => {
  const c = window.c2c;
  const big = [...document.querySelectorAll('.hud button, .hud select')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0);
  const small = big.filter((r) => r.height < 44 || r.width < 44).length;
  return { detected: c.detected, tier: c.quality.tier, mode: c.store.get().quality, renderDpr: c.renderer.getPixelRatio(), deviceDpr: devicePixelRatio, canvasPx: `${c.renderer.domElement.width}×${c.renderer.domElement.height}`, sheetH: Math.round(document.querySelector('.panel').getBoundingClientRect().height), controlsBelow44: small, controlsVisible: big.length };
});
await p3.screenshot({ path: `${out}/mobile-collapsed.png` });
const mob = [];
for (const l of ['satellite', 'mosfet', 'array']) {
  await p3.evaluate((id) => window.c2c.mgr.jumpTo(id), l);
  await p3.waitForTimeout(1500);
  mob.push({ level: l, ...(await measure(p3, 3000)) });
}
await p3.evaluate(() => window.c2c.mgr.jumpTo('satellite'));
await p3.waitForTimeout(800);
await p3.tap('.sheet-summary [data-act="experiment"]');
await p3.waitForTimeout(800);
await p3.screenshot({ path: `${out}/mobile-expanded.png` });
await p3.tap('.sheet-handle');
await p3.tap('.nav-menu');
await p3.waitForTimeout(400);
await p3.screenshot({ path: `${out}/mobile-menu.png` });
console.log('\nmobile');
console.table([mobile]);
console.table(mob);
await c3.close();
await browser.close();

writeFileSync(`${out}/perf.json`, JSON.stringify({ env, tiers, memory, hitch, mobile, mobileLevels: mob, errors }, null, 2));
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`\nwrote ${out}/perf.json`);
