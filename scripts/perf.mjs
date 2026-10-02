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

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:4173';
const out = pos[1] ?? 'perf-out';
const gpu = process.argv.includes('--gpu');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = new Set(onlyArg ? onlyArg.slice(7).split(',') : ['tiers', 'memory', 'mobile', 'devices']);
const DEVICE_FILTER = process.argv.find((a) => a.startsWith('--device='))?.slice(9).split(',');
const CYCLES = Number(process.argv.find((a) => a.startsWith('--cycles='))?.slice(9) ?? 10);
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
for (const tier of only.has('tiers') ? ['high', 'balanced', 'performance'] : []) {
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
const memory = [];
const hitch = [];
if (only.has('memory')) {
const { ctx: c2, page: p2 } = await open({ width: 1600, height: 900 }, {}, '&quality=balanced');
// shorter flights for the leak cycles: the same steps, renormalisations and level builds/disposals run
await p2.evaluate(() => (window.c2c.mgr.motionScale = 0.2));
for (let k = 0; k < CYCLES; k++) {
  await p2.evaluate(() => window.c2c.mgr.jumpTo('satellite'));
  await p2.waitForTimeout(800);
  await p2.evaluate(() => window.c2c.stats.clear());
  await p2.evaluate(() => window.c2c.mgr.goTo('die'));
  await p2.evaluate(() => window.c2c.mgr.goTo('satellite'));
  await p2.waitForTimeout(1500);
  const r = await p2.evaluate(() => ({ geo: window.c2c.renderer.info.memory.geometries, tex: window.c2c.renderer.info.memory.textures, prog: window.c2c.renderer.info.programs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null, maxFrameMs: Math.round(window.c2c.stats.maxMs), longFrames: window.c2c.stats.longFrames, p95: +window.c2c.stats.summary().p95Ms.toFixed(1) }));
  memory.push({ cycle: k + 1, geo: r.geo, tex: r.tex, prog: r.prog, heapMB: r.heapMB });
  hitch.push({ cycle: k + 1, maxFrameMs: r.maxFrameMs, longFrames: r.longFrames, p95Ms: r.p95 });
  console.log(`cycle ${k + 1}: geo ${r.geo} tex ${r.tex} prog ${r.prog} heap ${r.heapMB} MB · max frame ${r.maxFrameMs} ms`);
}
console.log('\nmemory after satellite→die→satellite cycles');
console.table(memory);
console.table(hitch);
// render-target / texture leak check: quality changes and resizes allocate post targets, shadow maps and PMREM
const rt = [];
for (let k = 0; k < 6; k++) {
  for (const q of ['high', 'performance', 'balanced']) {
    await p2.evaluate((m) => window.c2c.store.set({ quality: m }), q);
    await p2.waitForTimeout(150);
  }
  await p2.setViewportSize({ width: k % 2 ? 1200 : 1600, height: 900 });
  await p2.waitForTimeout(400);
  rt.push(await p2.evaluate(() => ({ round: 0, tex: window.c2c.renderer.info.memory.textures, geo: window.c2c.renderer.info.memory.geometries })));
  rt[rt.length - 1].round = k + 1;
}
console.log('\nrender targets after quality/resize rounds');
console.table(rt);
memory.push({ rtRounds: rt });
await c2.close();
}

// ---- 3. mobile emulation (390×844, DPR 3, touch) ----
let mobile = null;
const mob = [];
if (only.has('mobile')) {
const { ctx: c3, page: p3 } = await open({ width: 390, height: 844 }, { deviceScaleFactor: 3, isMobile: true, hasTouch: true });
mobile = await p3.evaluate(() => {
  const c = window.c2c;
  const big = [...document.querySelectorAll('.hud button, .hud select')].filter((b) => b.offsetParent !== null).map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0);
  const small = big.filter((r) => r.height < 44 || r.width < 44).length;
  return { detected: c.detected, tier: c.quality.tier, mode: c.store.get().quality, renderDpr: c.renderer.getPixelRatio(), deviceDpr: devicePixelRatio, canvasPx: `${c.renderer.domElement.width}×${c.renderer.domElement.height}`, sheetH: Math.round(document.querySelector('.panel').getBoundingClientRect().height), controlsBelow44: small, controlsVisible: big.length };
});
await p3.screenshot({ path: `${out}/mobile-collapsed.png` });
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
}

// ---- 4. device layouts & mobile journey (emulation — not a real-device measurement) ----
const devices = [];
if (only.has('devices')) {
  const sizes = [
    ['phone-390', 390, 844, true], ['phone-430', 430, 932, true], ['tablet-768', 768, 1024, true], ['tablet-820', 820, 1180, true],
    ['desktop-1280', 1280, 800, false], ['desktop-1440', 1440, 900, false],
  ];
  for (const [name, w, h, touch] of sizes.filter(([n]) => !DEVICE_FILTER || DEVICE_FILTER.includes(n))) {
    for (const orient of touch ? ['portrait', 'landscape'] : ['landscape']) {
      const vw = orient === 'portrait' ? w : Math.max(w, h);
      const vh = orient === 'portrait' ? h : Math.min(w, h);
      const { ctx, page } = await open({ width: vw, height: vh }, touch ? { deviceScaleFactor: 2, isMobile: true, hasTouch: true } : {});
      await page.waitForTimeout(2000);
      const r = await page.evaluate(() => {
        const vis = [...document.querySelectorAll('.hud button, .hud select, .hud input[type=range], .callout.clickable')].filter((b) => b.offsetParent !== null && getComputedStyle(b).visibility !== 'hidden');
        const rects = vis.map((b) => ({ b, r: b.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.height > 0 && x.r.bottom > 0 && x.r.top < innerHeight);
        const coarse = matchMedia('(pointer: coarse)').matches;
        const small = coarse ? rects.filter((x) => x.b.tagName !== 'INPUT' && (x.r.height < 44 || x.r.width < 44) && !x.b.classList.contains('callout')).map((x) => x.b.className) : [];
        let overlaps = 0;
        const ov = [];
        for (let i = 0; i < rects.length; i++)
          for (let j = i + 1; j < rects.length; j++) {
            const a = rects[i].r, b = rects[j].r;
            if (rects[i].b.contains(rects[j].b) || rects[j].b.contains(rects[i].b)) continue;
            const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ix > 2 && iy > 2) { overlaps++; ov.push(`${rects[i].b.className}×${rects[j].b.className}`); }
          }
        const panel = document.querySelector('.panel').getBoundingClientRect();
        const mobile = document.querySelector('.hud').classList.contains('is-mobile');
        return { mobile, panel: `${Math.round(panel.left)},${Math.round(panel.top)} ${Math.round(panel.width)}×${Math.round(panel.height)}`, freeArea: Math.round(((innerWidth - (panel.left > innerWidth * 0.3 && panel.height > innerHeight * 0.6 ? innerWidth - panel.left : 0)) * (panel.top > innerHeight * 0.3 ? panel.top : innerHeight)) / (innerWidth * innerHeight) * 100), small: small.length, smallList: [...new Set(small)].slice(0, 4).join(' '), overlaps, overlapList: ov.slice(0, 3).join(' | ') };
      });
      // journey: select a part from the parts list → it must be in the free viewport;
      // Internal view → child level; back → parent; expand sheet; experiment
      const j = {};
      if (r.mobile) {
        await page.evaluate(() => document.querySelector('.hud .sheet-handle').click());
        await page.waitForTimeout(500);
        j.expand = await page.evaluate(() => document.querySelector('.panel').classList.contains('expanded'));
        const part = await page.$('.parts .part');
        if (part) {
          await part.tap();
          await page.waitForTimeout(2500);
          j.selected = await page.evaluate(() => window.c2c.store.get().selected);
          j.selectedVisible = await page.evaluate(() => {
            const id = window.c2c.store.get().selected;
            const c = window.c2c.mgr.current.components.find((k) => k.id === id);
            if (!c) return null;
            // anchor of the part's callout (or its origin) in world space
            const p = c.object.getWorldPosition(c.object.position.clone());
            return window.c2c.viewport.isVisible(p);
          });
        }
        await page.evaluate(() => document.querySelector('.hud .sheet-handle').click());
        await page.waitForTimeout(400);
        await page.evaluate(() => window.c2c.store.set({ selected: null }));
        await page.waitForTimeout(200);
        await page.tap('.sheet-summary [data-act="enter"]');
        await page.waitForFunction(() => !window.c2c.store.get().transitioning && window.c2c.store.get().level !== 'satellite', null, { timeout: 120000 });
        j.internalView = await page.evaluate(() => window.c2c.store.get().level);
        await page.tap('.nav-back');
        await page.waitForFunction(() => !window.c2c.store.get().transitioning && window.c2c.store.get().level === 'satellite', null, { timeout: 120000 });
        j.back = await page.evaluate(() => window.c2c.store.get().level);
        await page.tap('.sheet-summary [data-act="experiment"]');
        await page.waitForTimeout(800);
        j.experiment = await page.evaluate(() => document.querySelector('.panel').classList.contains('expanded'));
      }
      await page.screenshot({ path: `${out}/device-${name}-${orient}.png` });
      devices.push({ device: name, orient, size: `${vw}×${vh}`, ...r, ...j });
      console.log(JSON.stringify(devices[devices.length - 1]));
      await ctx.close();
    }
  }
  console.log('\ndevices (emulated)');
  console.table(devices);
}

await browser.close();
writeFileSync(`${out}/perf.json`, JSON.stringify({ env, tiers, memory, hitch, mobile, mobileLevels: mob, devices, errors }, null, 2));
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log(`\nwrote ${out}/perf.json`);
