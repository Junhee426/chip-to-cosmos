// Hero demo harness: visual captures, browser smoke checks and a repeated-run
// performance/resource measurement of the Satellite → BEAM LAB → Earth demo.
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core
//   CHROMIUM_PATH=/path/to/chrome node scripts/hero.mjs [url] [out-dir] [--runs=3] [--only=visual,smoke,perf,mobile] [--gpu]
//
// Without --gpu Chromium renders with SwiftShader (CPU): frame times are then a
// property of this machine's CPU rasteriser, NOT of any GPU. Resource counts,
// state checks and layout are valid either way.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:4173';
const out = pos[1] ?? 'hero-out';
const gpu = process.argv.includes('--gpu');
const RUNS = Number(process.argv.find((a) => a.startsWith('--runs='))?.slice(7) ?? 3);
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k) => !ONLY || ONLY.includes(k);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: gpu ? ['--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = { renderer: gpu ? 'hardware GPU' : 'SwiftShader (CPU)', checks: [], perf: [], mobile: [] };
const errors = [];
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};

async function session(viewport, extra = {}, query = '') {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?nointro&quality=balanced${query}`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 180000 });
  return { ctx, page };
}
const stage = (page) => page.evaluate(() => document.body.dataset.demoStage ?? null);
const waitStage = (page, s, timeout = 300000) => page.waitForFunction((x) => document.body.dataset.demoStage === x, s, { timeout });
/** stage composed: camera flight and parameter animation done, caption shown */
const waitReady = (page, s, timeout = 300000) => page.waitForFunction((x) => document.body.dataset.demoReady === x, s, { timeout });
const waitIdle = (page, timeout = 120000) => page.waitForFunction(() => !window.c2c.demo.running, null, { timeout });
const beam = (page) => page.evaluate(() => { const b = window.c2c.beam(); return { steer: b.input.steerThetaDeg, axis: b.pattern.axis, hpbw: b.pattern.hpbwDeg, gain: b.pattern.gainDbi, along: b.footprint.alongTrackKm, area: b.footprint.areaKm2, center: b.footprint.center, lobes: b.lobes.length, secondary: b.secondary.length, margin: b.link?.marginDb ?? null, phaseX: b.pattern.phaseStepX }; });

// ------------------------------------------------------------- visual (desktop demo)
if (want('visual')) {
  // demoHold lengthens only the reading pauses, so a slow renderer can be captured mid-stage
  const { ctx, page } = await session({ width: 1440, height: 900 }, {}, '&level=satellite&demoHold=4');
  await page.waitForTimeout(2500);
  const t0 = Date.now();
  void page.evaluate(() => window.c2c.demo.play());
  const shots = [
    ['hero-01-satellite', 'satellite'],
    ['hero-02-array-focus', 'array-focus'],
    ['hero-03-phase', 'phase'],
    ['hero-04-wavefront', 'wavefront'],
    ['hero-05-pattern', 'pattern'],
    ['hero-06-footprint-lab', 'footprint'],
    ['hero-07-earth-footprint', 'earth-footprint'],
  ];
  for (const [name, s] of shots) {
    await waitReady(page, s);
    await page.screenshot({ path: `${out}/${name}.png` });
    console.log(`  captured ${name} (${s})`);
  }
  await waitIdle(page);
  const wall = (Date.now() - t0) / 1000;
  check('demo completes and ends at COSMOS', (await page.evaluate(() => window.c2c.mgr.current.id)) === 'cosmos', `wall ${wall.toFixed(1)} s (incl. screenshots)`);
  // grating-lobe experiment in BEAM LAB
  await page.evaluate(() => window.c2c.mgr.goTo('array'));
  await page.waitForFunction(() => window.c2c.mgr.current?.id === 'array' && !window.c2c.mgr.isBusy, null, { timeout: 120000 });
  await page.click('.preset-grating');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/hero-08-grating-lobe.png` });
  console.log('  captured hero-08-grating-lobe');
  const g = await beam(page);
  check('grating preset creates a real grating lobe with an Earth footprint', g.lobes > 0 && g.secondary > 0, `lobes ${g.lobes}, secondary footprints ${g.secondary}`);
  check('grating warning shown in the panel', await page.evaluate(() => getComputedStyle(document.querySelector('.gl-warn')).display !== 'none'));
  await ctx.close();
}

// ------------------------------------------------------------- smoke
if (want('smoke')) {
  const { ctx, page } = await session({ width: 1280, height: 800 }, {}, '&level=array');
  await page.waitForTimeout(2000);
  // steering updates phase, pattern and footprint (same solution in scene + HUD)
  await page.evaluate(() => window.c2c.store.setParams({ steerDeg: 0, spacingLambda: 0.5, arrayN: 16, weighting: 'uniform' }));
  await page.waitForTimeout(800);
  const a = await beam(page);
  await page.evaluate(() => window.c2c.store.setParams({ steerDeg: 30 }));
  await page.waitForTimeout(800);
  const b = await beam(page);
  const lab = await page.evaluate(() => { const l = window.c2c.mgr.current; return { same: l.solution === window.c2c.beam(), axis: l.solution.pattern.axis }; });
  check('steering changes phase gradient', a.phaseX === 0 && b.phaseX < -1, `βx ${a.phaseX.toFixed(2)} → ${b.phaseX.toFixed(2)} rad`);
  check('steering tilts the beam axis and moves the footprint', b.axis[0] > 0.4 && b.center[0] > 200, `axis.x ${b.axis[0].toFixed(3)}, centre along-track ${b.center[0].toFixed(0)} km`);
  check('BEAM LAB scene draws the same BeamSolution object the HUD reads', lab.same);
  const strip = await page.evaluate(() => document.querySelector('.causal-step[data-stage="footprint"] b').textContent);
  check('causal strip shows the solution footprint', strip.startsWith(`${Math.round(b.along)}×`), strip);
  await page.evaluate(() => window.c2c.store.setParams({ arrayN: 32 }));
  await page.waitForTimeout(800);
  const c = await beam(page);
  check('array size changes beam width, footprint and gain', c.hpbw < b.hpbw && c.area < b.area && c.gain > b.gain, `HPBW ${b.hpbw.toFixed(1)}→${c.hpbw.toFixed(1)}°, area ${b.area.toFixed(0)}→${c.area.toFixed(0)} km²`);
  // Earth footprint visible in COSMOS
  await page.evaluate(() => window.c2c.mgr.goTo('cosmos'));
  await page.waitForFunction(() => window.c2c.mgr.current?.id === 'cosmos' && !window.c2c.mgr.isBusy, null, { timeout: 120000 });
  const fp = await page.evaluate(() => { const l = window.c2c.mgr.current; return { n: l.fpLine.geometry.drawRange.count, visible: l.fp.visible }; });
  check('Earth footprint contour drawn in COSMOS', fp.n >= 3 && fp.visible, `${fp.n} contour points`);
  // run → skip → navigation free
  void page.evaluate(() => window.c2c.demo.play());
  await page.waitForFunction(() => window.c2c.demo.running, null, { timeout: 20000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await waitIdle(page, 60000);
  check('Escape skips the demo', !(await page.evaluate(() => window.c2c.demo.running)), `stopped at ${await page.evaluate(() => window.c2c.mgr.current.id)}`);
  await page.evaluate(() => window.c2c.mgr.goTo('array'));
  await page.waitForFunction(() => window.c2c.mgr.current?.id === 'array' && !window.c2c.mgr.isBusy, null, { timeout: 120000 });
  check('manual navigation works after skip', true);
  // replay: navigation request during the demo ends it and goes where asked
  void page.evaluate(() => window.c2c.demo.play());
  await page.waitForFunction(() => window.c2c.demo.running, null, { timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.evaluate(() => document.querySelector('.rung[data-level="cosmos"] button').click());
  await page.waitForFunction(() => !window.c2c.demo.running && window.c2c.mgr.current?.id === 'cosmos' && !window.c2c.mgr.isBusy, null, { timeout: 120000 });
  check('replay + navigation request ends the demo (no trap)', true);
  await ctx.close();

  // reduced motion: demo still completes, intro never autoplays
  const rm = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rm.newPage();
  rp.on('pageerror', (e) => errors.push(e.message));
  await rp.goto(`${url}/?quality=balanced&level=satellite`);
  await rp.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 180000 });
  const introOn = await rp.evaluate(() => document.body.classList.contains('intro-on'));
  const r0 = Date.now();
  await rp.evaluate(() => window.c2c.demo.play());
  const rmWall = (Date.now() - r0) / 1000;
  const motion = await rp.evaluate(() => window.c2c.mgr.motionScale);
  check('reduced motion: no intro autoplay, demo completes with shortened motion', !introOn && motion < 1 && (await rp.evaluate(() => window.c2c.mgr.current.id)) === 'cosmos', `motionScale ${motion}, wall ${rmWall.toFixed(1)} s`);
  await rm.close();
}

// ------------------------------------------------------------- perf (repeated runs)
if (want('perf')) {
  const { ctx, page } = await session({ width: 1280, height: 800 }, {}, '&level=satellite');
  await page.waitForTimeout(3000);
  const mem = () => page.evaluate(() => ({ geo: window.c2c.renderer.info.memory.geometries, tex: window.c2c.renderer.info.memory.textures, prog: window.c2c.renderer.info.programs.length }));
  for (let k = 0; k < RUNS; k++) {
    await page.evaluate(() => window.c2c.mgr.jumpTo('satellite'));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.c2c.stats.clear());
    // FrameStats keeps the last 600 frames; collect every frame of the run here instead
    await page.evaluate(() => {
      window.__ft = [];
      let last = performance.now();
      const f = (t) => { window.__ft.push(t - last); last = t; if (window.c2c.demo.running || window.__ft.length < 2) requestAnimationFrame(f); };
      requestAnimationFrame(f);
    });
    const t0 = Date.now();
    await page.evaluate(() => window.c2c.demo.play());
    const wall = (Date.now() - t0) / 1000;
    const ft = await page.evaluate(() => window.__ft.slice(1));
    const s = [...ft].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    const m = await mem();
    const row = { run: k + 1, wallS: +wall.toFixed(1), frames: ft.length, avgMs: +(ft.reduce((a, b) => a + b, 0) / ft.length).toFixed(1), p95Ms: +q(0.95).toFixed(1), p99Ms: +q(0.99).toFixed(1), maxMs: Math.round(s[s.length - 1]), long: ft.filter((x) => x > 66.7).length, ...m };
    results.perf.push(row);
    console.log(JSON.stringify(row));
  }
  // drag: 80 steering steps at input rate, frames measured over the drag
  await page.evaluate(() => window.c2c.mgr.jumpTo('array'));
  await page.waitForTimeout(2000);
  const drag = await page.evaluate(async () => {
    const ft = [];
    let last = performance.now();
    let on = true;
    const f = (t) => { ft.push(t - last); last = t; if (on) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    for (let i = 0; i <= 80; i++) {
      window.c2c.store.setParams({ steerDeg: -40 + i });
      await new Promise((r) => setTimeout(r, 16));
    }
    await new Promise((r) => setTimeout(r, 300));
    on = false;
    const s = ft.slice(1).sort((a, b) => a - b);
    return { frames: s.length, p95Ms: +s[Math.floor(s.length * 0.95)].toFixed(1), maxMs: Math.round(s[s.length - 1]) };
  });
  results.drag = drag;
  console.log('drag', JSON.stringify(drag));
  await ctx.close();
}

// ------------------------------------------------------------- mobile journey (emulated)
if (want('mobile')) {
  const phone = { deviceScaleFactor: 2, isMobile: true, hasTouch: true };
  for (const [name, vp] of [['390x844', { width: 390, height: 844 }], ['430x932', { width: 430, height: 932 }], ['844x390', { width: 844, height: 390 }]]) {
    const { ctx, page } = await session(vp, phone, `&level=satellite${name === '390x844' ? '&demoHold=4' : ''}`);
    await page.waitForTimeout(2500);
    const btn = page.locator('.sheet-summary [data-act="demo"]');
    const box = await btn.boundingBox();
    await btn.tap();
    await page.waitForFunction(() => window.c2c.demo.running, null, { timeout: 20000 });
    if (name === '390x844') {
      await waitReady(page, 'earth-footprint');
      await page.screenshot({ path: `${out}/hero-09-mobile.png` });
      console.log('  captured hero-09-mobile');
    }
    // the caption must not sit on top of the beam: safe viewport top is below it
    const layout = await page.evaluate(() => {
      const cap = document.querySelector('.hero-demo').getBoundingClientRect();
      const ins = window.c2c.viewport.insetsNow?.() ?? null;
      const strip = document.querySelector('.causal').getBoundingClientRect();
      return { capBottom: Math.round(cap.bottom), stripBottom: Math.round(strip.bottom), insTop: ins ? Math.round(ins.top) : null, skipH: Math.round(document.querySelector('.hd-skip').getBoundingClientRect().height) };
    });
    await waitIdle(page, 900000);
    const end = await page.evaluate(() => window.c2c.mgr.current.id);
    // continue manually: Beam Lab, grating experiment, back
    await page.evaluate(() => window.c2c.mgr.goTo('array'));
    await page.waitForFunction(() => window.c2c.mgr.current?.id === 'array' && !window.c2c.mgr.isBusy, null, { timeout: 120000 });
    await page.tap('.sheet-summary [data-act="experiment"]');
    await page.waitForTimeout(800);
    await page.locator('.preset-grating').tap();
    await page.waitForTimeout(1200);
    const g = await beam(page);
    const small = await page.evaluate(() => [...document.querySelectorAll('.preset, .beam-hero .seg-btn, .hd-skip, .sum-btn')].filter((e) => e.offsetParent && (e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44)).length);
    await page.tap('.nav-back');
    await page.waitForFunction(() => window.c2c.mgr.current?.id === 'satellite' && !window.c2c.mgr.isBusy, null, { timeout: 120000 }).catch(() => {});
    const back = await page.evaluate(() => window.c2c.mgr.current.id);
    const row = { device: name, demoBtnH: box ? Math.round(box.height) : null, endLevel: end, grating: g.lobes > 0, smallTargets: small, back, ...layout };
    results.mobile.push(row);
    console.log(JSON.stringify(row));
    check(`mobile ${name}: demo → Beam Lab → grating → back`, end === 'cosmos' && g.lobes > 0 && back === 'satellite' && small === 0, JSON.stringify(row));
    await ctx.close();
  }
}

await browser.close();
results.errors = errors;
writeFileSync(`${out}/hero.json`, JSON.stringify(results, null, 2));
if (errors.length) console.error('Page errors:\n' + errors.join('\n'));
const failed = results.checks.filter((c) => !c.ok).length;
console.log(`\n${results.checks.length - failed}/${results.checks.length} checks passed · renderer: ${results.renderer}`);
process.exit(failed || errors.length ? 1 : 0);
