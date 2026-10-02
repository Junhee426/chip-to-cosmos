// V4 hero harness: visual captures, browser checks and performance measurement of the
// Quick Demo (~15 s), the Engineering Demo, the grating-lobe demo, the poster and the
// mobile journey.
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core
//   CHROMIUM_PATH=/path/to/chrome node scripts/hero.mjs [url] [out-dir] [--runs=5] [--only=visual,smoke,perf,mobile] [--gpu]
//
// Renderer honesty: without --gpu Chromium renders with SwiftShader (CPU). Frame times are then a
// property of this machine's CPU rasteriser — NOT a GPU, phone or laptop frame rate. Mobile rows are
// Chromium viewport/touch EMULATION, not real devices. State checks, resource counts and the
// main-thread model cost (`calc`) are renderer-independent.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:4173';
const out = pos[1] ?? 'hero-out';
const gpu = process.argv.includes('--gpu');
const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 5);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k) => !ONLY || ONLY.includes(k);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: gpu ? ['--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const RENDERER = gpu ? 'HARDWARE GPU' : 'SWIFTSHADER';
const results = { renderer: RENDERER, checks: [], perf: [], moments: {}, mobile: [] };
const errors = [];
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const T = 600000;

async function session(viewport, extra = {}, query = '?nointro&quality=balanced') {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/${query}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 180000 });
  return { ctx, page };
}
const waitReady = (page, s, timeout = T) => page.waitForFunction((x) => document.body.dataset.demoReady === x, s, { timeout });
const waitIdle = (page, timeout = T) => page.waitForFunction(() => !window.c2c.demo.running, null, { timeout });
const at = (page, level, timeout = T) => page.waitForFunction((l) => window.c2c.mgr.current?.id === l && !window.c2c.mgr.isBusy, level, { timeout });
const beam = (page) => page.evaluate(() => { const b = window.c2c.beam(); return { steer: b.input.steerThetaDeg, axis: b.pattern.axis, gain: b.pattern.gainDbi, hpbw: b.pattern.hpbwDeg, along: b.footprint.alongTrackKm, center: b.footprint.center, lobes: b.lobes.length, secondary: b.secondary.length, margin: b.link?.marginDb ?? null }; });
/** world quaternions of the physical antenna (satellite sub-array + array tiles) and of the BEAM LAB panel */
const panelPose = (page) => page.evaluate(() => {
  const q = (o) => { const v = o.getWorldQuaternion(new o.quaternion.constructor()); return [v.x, v.y, v.z, v.w].map((x) => +x.toFixed(6)); };
  const out = {};
  for (const l of window.c2c.mgr.levelsBuilt()) {
    if (l.id === 'satellite') { out.subarray = q(l.subarray); out.tiles = q(l.components.find((c) => c.id === 'phased-array').object); }
    if (l.id === 'array') out.labPanel = q(l.panel);
  }
  return out;
});
const screenOf = (page, expr) => page.evaluate((e) => {
  const c = window.c2c; const o = eval(e); if (!o) return null;
  const v = o.getWorldPosition(c.rig.camera.position.clone()).project(c.rig.camera);
  return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight, z: v.z };
}, expr);
const rect = (page, sel) => page.evaluate((s) => {
  const e = document.querySelector(s);
  const r = e && !e.hidden ? e.getBoundingClientRect() : null;
  return r && r.height ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
}, sel);

// ------------------------------------------------------------------ visual
if (want('visual')) {
  // 00: Earth-facing array (satellite, Earth limb, nadir deck, aperture, beam) — steer 0
  {
    const { ctx, page } = await session({ width: 1440, height: 900 }, {}, '?nointro&quality=balanced&level=satellite');
    await page.evaluate(() => { const c = window.c2c; c.store.set({ mode: 'signal', presentation: true }); c.store.setParams({ steerDeg: 0 }); c.rig.setView(c.mgr.current.demoView('earth-facing')); });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${out}/hero-00-earth-facing-array.png` });
    console.log('  captured hero-00-earth-facing-array');
    await ctx.close();
  }
  // 01: landing (first screen)
  {
    const { ctx, page } = await session({ width: 1440, height: 900 }, {}, '?quality=balanced');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${out}/hero-01-quick-start.png` });
    console.log('  captured hero-01-quick-start');
    check('landing: first screen shows title + Run 15-second demo over the live satellite scene', await page.evaluate(() => window.c2c.store.get().presentation && window.c2c.poster.view === 'landing' && window.c2c.mgr.current.id === 'satellite'));
    // 02–05: Quick Demo stages (demoHold only lengthens reading pauses so a CPU renderer can be captured)
    await page.goto(`${url}/?quality=balanced&demoHold=4`);
    await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 180000 });
    await page.waitForTimeout(1500);
    await page.click('.pst-landing .pst-btn.primary');
    for (const [name, s] of [['hero-02-phase', 'q-phase'], ['hero-03-beam', 'q-beam'], ['hero-04-earth-footprint', 'q-footprint'], ['hero-05-poster', 'q-poster']]) {
      await waitReady(page, s);
      await page.screenshot({ path: `${out}/${name}.png` });
      console.log(`  captured ${name} (${s})`);
    }
    await waitIdle(page);
    await ctx.close();
  }
  // 06: grating demo — Beam Lab main beam, then the secondary footprint on Earth
  {
    const { ctx, page } = await session({ width: 1440, height: 900 }, {}, '?nointro&quality=balanced&level=array&demoHold=4');
    await page.waitForTimeout(2000);
    void page.evaluate(() => window.c2c.demo.play('grating'));
    await waitReady(page, 'g-main');
    await page.screenshot({ path: `${out}/hero-06-grating-main.png` });
    await waitReady(page, 'g-spacing');
    await page.screenshot({ path: `${out}/hero-06-grating.png` });
    await waitReady(page, 'g-earth');
    await page.screenshot({ path: `${out}/hero-06b-grating-earth.png` });
    console.log('  captured hero-06-grating-main / hero-06-grating / hero-06b-grating-earth');
    await waitIdle(page);
    const g = await beam(page);
    check('grating demo: spacing crosses the limit, a lobe and a secondary Earth footprint appear', g.lobes > 0 && g.secondary > 0, `lobes ${g.lobes}, secondary ${g.secondary}`);
    // 07: array compare (Beam Lab panel)
    await page.evaluate(() => window.c2c.mgr.goTo('array'));
    await at(page, 'array');
    await page.evaluate(() => window.c2c.store.setParams({ spacingLambda: 0.5 }));
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('.compare')?.scrollIntoView({ block: 'center' }));
    await page.click('.cmp-show .pst-btn >> nth=1');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/hero-07-array-compare.png` });
    console.log('  captured hero-07-array-compare');
    const cmp = await page.evaluate(() => [...document.querySelectorAll('.cmp-row')].map((r) => r.textContent));
    check('array compare: 8×8 vs 32×32 table rendered from the model', cmp.length >= 7 && cmp.some((t) => t.includes('Gain')), cmp[2]);
    // 08: link X-ray (Cosmos panel), emphasise the Earth-facing transmitter
    await page.evaluate(() => window.c2c.mgr.goTo('cosmos'));
    await at(page, 'cosmos');
    await page.waitForTimeout(1000);
    await page.evaluate(() => document.querySelector('.xray')?.scrollIntoView({ block: 'start' }));
    await page.hover('.xr[data-k="path"]');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/hero-08-link-xray.png` });
    console.log('  captured hero-08-link-xray');
    await ctx.close();
  }
}

// ------------------------------------------------------------------ smoke
if (want('smoke')) {
  const { ctx, page } = await session({ width: 1280, height: 800 }, {}, '?nointro&quality=balanced&level=satellite');
  await page.waitForTimeout(2000);
  // P0: steering never rotates the physical antenna; only the beam moves
  await page.evaluate(() => window.c2c.store.set({ mode: 'signal' }));
  await page.evaluate(() => window.c2c.store.setParams({ steerDeg: 0 }));
  await page.waitForTimeout(800);
  const p0 = await panelPose(page);
  const b0 = await beam(page);
  await page.evaluate(() => window.c2c.store.setParams({ steerDeg: 40 }));
  await page.waitForTimeout(800);
  const p1 = await panelPose(page);
  const b1 = await beam(page);
  const nadir = await page.evaluate(() => { const l = window.c2c.mgr.current; const n = new l.subarray.position.constructor(0, 1, 0).applyQuaternion(l.subarray.getWorldQuaternion(l.subarray.quaternion.clone())); return [n.x, n.y, n.z].map((x) => +x.toFixed(6)); });
  check('P0: array normal points to nadir (body −Y) in the satellite scene', nadir[1] < -0.999999, JSON.stringify(nadir));
  check('P0: steering 0° → 40° does not rotate the antenna panel', JSON.stringify(p0.subarray) === JSON.stringify(p1.subarray) && JSON.stringify(p0.tiles) === JSON.stringify(p1.tiles), JSON.stringify(p1.subarray));
  check('P0: … but the beam axis and footprint move', b1.axis[0] > b0.axis[0] + 0.5 && b1.center[0] > 300, `axis.x ${b0.axis[0].toFixed(2)} → ${b1.axis[0].toFixed(2)}, centre ${b1.center[0].toFixed(0)} km`);
  await page.evaluate(() => window.c2c.mgr.goTo('array'));
  await at(page, 'array');
  const l0 = await panelPose(page);
  await page.evaluate(() => window.c2c.store.setParams({ steerDeg: 5 }));
  await page.waitForTimeout(800);
  const l1 = await panelPose(page);
  check('P0: BEAM LAB panel orientation unchanged under steering', JSON.stringify(l0.labPanel) === JSON.stringify(l1.labPanel), JSON.stringify(l1.labPanel));

  // Quick Demo: start → complete → poster → Try it
  await page.evaluate(() => window.c2c.mgr.goTo('satellite'));
  await at(page, 'satellite');
  await page.evaluate(() => window.c2c.store.setParams({ arrayN: 24, weighting: 'hamming', steerDeg: -10 }));
  await page.evaluate(() => window.c2c.demo.play('quick'));
  const q = await page.evaluate(() => ({ level: window.c2c.mgr.current.id, presentation: window.c2c.store.get().presentation, poster: window.c2c.poster.view, planned: window.c2c.demo.plannedSeconds, wall: window.c2c.demo.lastWallSeconds }));
  check('Quick Demo completes and ends on the poster frame (COSMOS, presentation)', q.level === 'cosmos' && q.presentation && q.poster === 'poster', JSON.stringify(q));
  check('Quick Demo designed duration is 12–17 s', q.planned >= 12 && q.planned <= 17, `planned ${q.planned.toFixed(1)} s · wall ${q.wall.toFixed(1)} s on ${RENDERER}`);
  const before = await page.evaluate(() => document.querySelector('.pst-m[data-k="footprint"] b').textContent);
  await page.evaluate(() => { const i = document.querySelector('.pst-try input'); i.value = '45'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(1200);
  const after = await page.evaluate(() => ({ steer: window.c2c.store.get().params.steerDeg, fp: document.querySelector('.pst-m[data-k="footprint"] b').textContent, strip: document.querySelector('.causal-step[data-stage="footprint"] b').textContent }));
  check('Try it: poster slider steers the beam; footprint metric and causal strip update', after.steer === 45 && after.fp !== before, `${before} → ${after.fp} (strip ${after.strip})`);
  await page.click('.pst-bottom .pst-btn.primary');
  await page.waitForTimeout(500);
  check('Explore freely leaves presentation mode', !(await page.evaluate(() => window.c2c.store.get().presentation)));
  await page.evaluate(() => window.c2c.mgr.goTo('satellite'));
  await at(page, 'satellite');
  check('manual navigation works after the demo', true);

  // Skip restores the user's state
  await page.evaluate(() => { window.c2c.store.set({ mode: 'thermal' }); window.c2c.store.setParams({ arrayN: 12, steerDeg: 33, weighting: 'hann' }); });
  void page.evaluate(() => window.c2c.demo.play('quick'));
  await page.waitForFunction(() => window.c2c.demo.running && document.body.dataset.demoStage === 'q-phase', null, { timeout: T });
  await page.keyboard.press('Escape');
  await waitIdle(page);
  const r = await page.evaluate(() => { const s = window.c2c.store.get(); return { mode: s.mode, n: s.params.arrayN, steer: s.params.steerDeg, w: s.params.weighting, presentation: s.presentation }; });
  check('Skip (Esc) stops the Quick Demo and restores mode, parameters and chrome', r.mode === 'thermal' && r.n === 12 && r.steer === 33 && r.w === 'hann' && !r.presentation, JSON.stringify(r));

  // X-ray: hovering a stage emphasises the matching 3D component
  await page.evaluate(() => window.c2c.mgr.goTo('cosmos'));
  await at(page, 'cosmos');
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('.xray')?.scrollIntoView({ block: 'start' }));
  await page.hover('.xr[data-k="rx"]');
  await page.waitForTimeout(300);
  const em = await page.evaluate(() => ({ e: window.c2c.store.get().emphasis, label: document.querySelector('.callout.active .callout-title')?.textContent ?? null }));
  check('X-ray: hovering RX ANTENNA emphasises the ground terminal', em.e === 'rx', JSON.stringify(em));
  await ctx.close();

  // ?view=poster is reproducible
  const snap = async () => {
    const s = await session({ width: 1280, height: 800 }, {}, '?view=poster&quality=balanced');
    await s.page.waitForTimeout(1500);
    const v = await s.page.evaluate(() => ({ metrics: [...document.querySelectorAll('.pst-m b')].map((e) => e.textContent).join('|'), cam: window.c2c.rig.camera.position.toArray().map((x) => +x.toFixed(4)).join(',') }));
    await s.ctx.close();
    return v;
  };
  const a = await snap();
  const b = await snap();
  check('?view=poster reproduces the same state and camera', a.metrics === b.metrics && a.cam === b.cam, a.metrics);

  // Engineering Demo still works
  {
    const e = await session({ width: 1280, height: 800 }, {}, '?nointro&quality=balanced&level=satellite');
    await e.page.waitForTimeout(1500);
    await e.page.evaluate(() => window.c2c.demo.play('engineering'));
    const ee = await e.page.evaluate(() => ({ level: window.c2c.mgr.current.id, planned: window.c2c.demo.plannedSeconds }));
    check('Engineering Demo still completes (ends at COSMOS)', ee.level === 'cosmos', `planned ${ee.planned.toFixed(1)} s`);
    await e.ctx.close();
  }

  // reduced motion
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  rp.on('pageerror', (e) => errors.push(e.message));
  await rp.goto(`${url}/?quality=balanced&level=satellite`);
  await rp.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 180000 });
  const intro = await rp.evaluate(() => document.body.classList.contains('intro-on'));
  await rp.evaluate(() => window.c2c.demo.play('quick'));
  const rq = await rp.evaluate(() => ({ motion: window.c2c.mgr.motionScale, poster: window.c2c.poster.view, planned: window.c2c.demo.plannedSeconds }));
  check('reduced motion: no intro autoplay; Quick Demo completes with shortened motion', !intro && rq.motion < 1 && rq.poster === 'poster', JSON.stringify(rq));
  await rm.close();
}

// ------------------------------------------------------------------ perf
if (want('perf')) {
  const { ctx, page } = await session({ width: 1280, height: 800 }, {}, '?nointro&quality=balanced&level=satellite');
  await page.waitForTimeout(3000);
  const mem = () => page.evaluate(() => ({ geo: window.c2c.renderer.info.memory.geometries, tex: window.c2c.renderer.info.memory.textures, prog: window.c2c.renderer.info.programs.length, heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null }));
  const startFrames = () => page.evaluate(() => { window.__ft = []; window.__on = true; let last = performance.now(); const f = (t) => { window.__ft.push(t - last); last = t; if (window.__on) requestAnimationFrame(f); }; requestAnimationFrame(f); });
  const stopFrames = async () => {
    const ft = await page.evaluate(() => { window.__on = false; return window.__ft.slice(1); });
    const s = [...ft].sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
    return { frames: ft.length, avgMs: +(ft.reduce((a, b) => a + b, 0) / Math.max(1, ft.length)).toFixed(1), p95Ms: +q(0.95).toFixed(1), p99Ms: +q(0.99).toFixed(1), maxMs: Math.round(s[s.length - 1] ?? 0), long: ft.filter((x) => x > 66.7).length };
  };
  const calc = () => page.evaluate(() => ({ ...window.c2c.calc }));
  const moment = async (name, fn, ms = 3000) => {
    const c0 = await calc();
    await startFrames();
    await fn();
    if (ms) await page.waitForTimeout(ms);
    const f = await stopFrames();
    const c1 = await calc();
    const lab = await page.evaluate(() => { const l = window.c2c.mgr.levelsBuilt().find((x) => x.id === 'array'); return l ? { applyMs: +l.lastApplyMs.toFixed(2), applies: l.applyCount } : null; });
    results.moments[name] = { ...f, solves: c1.solves - c0.solves, solveMsTotal: +(c1.totalMs - c0.totalMs).toFixed(1), solveMsMax: +c1.maxMs.toFixed(2), lab };
    console.log(name, JSON.stringify(results.moments[name]));
  };
  await moment('satellite-idle', async () => {}, 3000);
  await moment('phase-steering-tween', () => page.evaluate(async () => { for (let i = 0; i <= 25; i++) { window.c2c.store.setParams({ steerDeg: i }); await new Promise((r) => requestAnimationFrame(r)); } }), 500);
  await moment('satellite-to-array', () => page.evaluate(() => window.c2c.mgr.goTo('array')), 500);
  await moment('radiation-surface-update', () => page.evaluate(async () => { for (const n of [8, 16, 32, 16]) { window.c2c.store.setParams({ arrayN: n }); await new Promise((r) => setTimeout(r, 400)); } }), 300);
  await moment('grating-appearance', () => page.evaluate(async () => { for (let d = 0.5; d <= 1.0001; d += 0.02) { window.c2c.store.setParams({ spacingLambda: +d.toFixed(2) }); await new Promise((r) => requestAnimationFrame(r)); } }), 300);
  await page.evaluate(() => window.c2c.store.setParams({ spacingLambda: 0.5 }));
  await moment('earth-footprint-update', async () => { await page.evaluate(() => window.c2c.mgr.goTo('cosmos')); await page.evaluate(async () => { for (let i = 0; i <= 40; i += 2) { window.c2c.store.setParams({ steerDeg: i }); await new Promise((r) => requestAnimationFrame(r)); } }); }, 300);
  await page.evaluate(() => window.c2c.mgr.goTo('satellite'));
  await at(page, 'satellite');
  for (let k = 0; k < RUNS; k++) {
    await page.evaluate(() => { window.c2c.explore(); return window.c2c.mgr.jumpTo('satellite'); });
    await page.waitForTimeout(1200);
    await startFrames();
    const c0 = await calc();
    const t0 = Date.now();
    await page.evaluate(() => window.c2c.demo.play('quick'));
    const wall = (Date.now() - t0) / 1000;
    const f = await stopFrames();
    const c1 = await calc();
    const m = await mem();
    const planned = await page.evaluate(() => window.c2c.demo.plannedSeconds);
    const row = { run: k + 1, wallS: +wall.toFixed(1), plannedS: +planned.toFixed(1), ...f, solves: c1.solves - c0.solves, solveMsMax: +c1.maxMs.toFixed(2), ...m };
    results.perf.push(row);
    console.log(JSON.stringify(row));
  }
  await moment('poster-idle', async () => {}, 3000);
  await ctx.close();
}

// ------------------------------------------------------------------ mobile (EMULATED)
if (want('mobile')) {
  const phone = { deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  for (const [name, vp] of [['390x844', { width: 390, height: 844 }], ['430x932', { width: 430, height: 932 }], ['844x390', { width: 844, height: 390 }]]) {
    const { ctx, page } = await session(vp, phone, `?quality=balanced${name === '390x844' ? '&demoHold=3' : ''}`);
    await page.waitForTimeout(2000);
    const run = page.locator('.pst-landing .pst-btn.primary');
    const runBox = await run.boundingBox();
    await run.tap();
    await page.waitForFunction(() => window.c2c.demo.running, null, { timeout: 30000 });
    await waitReady(page, 'q-poster');
    if (name === '390x844') {
      await page.screenshot({ path: `${out}/hero-09-mobile-poster.png` });
      console.log('  captured hero-09-mobile-poster');
    }
    // the satellite and the footprint must stay in the visible scene (not under the poster bar or strip)
    const sat = await screenOf(page, "window.c2c.mgr.current.hero");
    const fp = await screenOf(page, "window.c2c.mgr.current.fpLabel");
    const bar = await rect(page, '.pst-bottom');
    const strip = await rect(page, '.causal');
    const inScene = (p) => p && p.x >= 0 && p.x <= vp.width && p.y >= (strip?.bottom ?? 0) && (!bar || p.y <= bar.top || p.x < bar.left || p.x > bar.right);
    await waitIdle(page);
    const small = await page.evaluate(() => [...document.querySelectorAll('.pst-bottom .pst-btn, .pst-bottom input, .hd-skip')].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44 && e.tagName !== 'INPUT').length);
    // Try it on touch
    const inp = page.locator('.pst-try input');
    const ib = await inp.boundingBox();
    if (ib) await page.touchscreen.tap(ib.x + ib.width * 0.9, ib.y + ib.height / 2);
    await page.waitForTimeout(800);
    const steer = await page.evaluate(() => window.c2c.store.get().params.steerDeg);
    const row = { device: name, runBtnH: runBox ? Math.round(runBox.height) : null, satelliteVisible: inScene(sat), footprintVisible: inScene(fp), smallTargets: small, tapSteer: steer, poster: await page.evaluate(() => window.c2c.poster.view) };
    results.mobile.push(row);
    console.log(JSON.stringify(row));
    check(`EMULATED mobile ${name}: Quick Demo → poster, satellite + footprint unobstructed, Try-it by touch`, row.poster === 'poster' && row.satelliteVisible && row.footprintVisible && row.smallTargets === 0 && steer > 30, JSON.stringify(row));
    await ctx.close();
  }
}

await browser.close();
results.errors = errors;
writeFileSync(`${out}/hero.json`, JSON.stringify(results, null, 2));
if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
const failed = results.checks.filter((c) => !c.ok).length;
console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed · renderer: ${RENDERER}`);
process.exit(failed || errors.length ? 1 : 0);
