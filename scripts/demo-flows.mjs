// Demo state-contract / resize / legibility regression harness (V4 follow-up).
//
// Drives the production build through the real buttons (▶ Run, ▶ Replay, Skip, Engineering demo,
// Why 0.5λ matters, Explore freely, the Try-it slider, the scale rail) and checks what the user
// ends up seeing: level, overlay, presentation, parameters, orbit state, camera, retained levels.
//
//   npm run build && npm run preview -- --port 4173 &
//   npm i --no-save playwright-core
//   CHROMIUM_PATH=/path/to/chrome node scripts/demo-flows.mjs [url] [out-dir] [--only=p1,races,resize,physics,reduced,captures,timing] [--gpu]
//
// Without --gpu Chromium renders with SwiftShader (CPU). Timings are then a property of this
// machine's software rasteriser — not a phone, laptop or GPU. Mobile rows are viewport/touch
// EMULATION (390×844, DPR 3), not real devices.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = (pos[0] ?? 'http://localhost:4173').replace(/\/$/, '');
const out = pos[1] ?? 'demo-flows-out';
const gpu = process.argv.includes('--gpu');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const want = (k) => (ONLY ? ONLY.includes(k) : k !== 'timing' && k !== 'captures');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: gpu ? ['--ignore-gpu-blocklist'] : ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const results = { url, renderer: gpu ? 'HARDWARE GPU' : 'SWIFTSHADER', checks: [], timing: [], errors: [] };
const check = (name, ok, detail = '') => {
  results.checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
};
const T = 600000;
const DESKTOP = [{ width: 1440, height: 900 }, {}];
const MOBILE = [{ width: 390, height: 844 }, { deviceScaleFactor: 3, isMobile: true, hasTouch: true }];

const contexts = new Set();
/** One scenario: an exception (e.g. a step that never happens on a broken build) is a failed check, not an abort. */
async function guard(fn) {
  try {
    await fn();
  } catch (e) {
    check(`scenario aborted: ${String(e.message).split('\n')[0]}`, false);
  } finally {
    for (const c of contexts) await c.close().catch(() => {});
    contexts.clear();
  }
}

async function open(query, [viewport, extra] = DESKTOP, more = {}) {
  const ctx = await browser.newContext({ viewport, ...extra, ...more });
  contexts.add(ctx);
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000); // software rendering: screenshots and clicks can be slow
  page.on('pageerror', (e) => results.errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && results.errors.push(`console: ${m.text()}`));
  await page.goto(`${url}/${query}`);
  await page.waitForFunction(() => document.body.classList.contains('ready') && window.c2c, null, { timeout: 180000 });
  return { ctx, page };
}
const stage = (page, s, timeout = T) => page.waitForFunction((x) => document.body.dataset.demoStage === x, s, { timeout });
const idle = (page, timeout = T) => page.waitForFunction(() => !window.c2c.demo.running && !window.c2c.mgr.isBusy, null, { timeout });
const running = (page) => page.waitForFunction(() => window.c2c.demo.running, null, { timeout: 30000 });
const posterBtn = (page, text) => page.locator('.pst-bottom button', { hasText: text });
const setSlider = (page, v) => page.evaluate((x) => {
  const i = document.querySelector('.pst-try input');
  i.value = String(x);
  i.dispatchEvent(new Event('input', { bubbles: true }));
  i.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

/** What the user sees, plus the state that makes that screen. */
const snap = (page) => page.evaluate(() => {
  const c = window.c2c;
  const s = c.store.get();
  const p = s.params;
  const f = (v) => v.toArray().map((x) => +x.toFixed(9));
  const vis = (sel) => { const e = document.querySelector(sel); return !!e && !e.hidden && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0; };
  const cos = c.mgr.levelsBuilt().find((l) => l.id === 'cosmos');
  const orbit = cos ? (cos.orbitState ? cos.orbitState() : { time: cos.orbitT, paused: cos.paused }) : null;
  return {
    level: s.level, cur: c.mgr.current?.id ?? null, busy: c.mgr.isBusy, running: c.demo.running,
    view: c.poster.view, pres: s.presentation, mode: s.mode, labels: s.labels,
    params: { n: p.arrayN, d: p.spacingLambda, steer: p.steerDeg, az: p.steerAzDeg, w: p.weighting, pm: p.powerMode, rf: p.totalRfW },
    orbit: orbit && { time: +orbit.time.toFixed(6), paused: orbit.paused },
    cam: { pos: f(c.rig.camera.position), tgt: f(c.rig.controls.target), up: f(c.rig.camera.up) },
    overlay: document.querySelector('.hero-demo')?.classList.contains('on') ?? false,
    demoClass: document.body.classList.contains('demo-running'),
    bottom: vis('.pst-bottom'), landing: vis('.pst-landing'), top: vis('.pst-top'), rail: vis('.rail'),
    retained: c.mgr.retained?.size ?? -1, built: c.mgr.levelsBuilt().map((l) => l.id).sort(),
    reason: c.demo.lastReason ?? null,
  };
});
const camDiff = (a, b) => Math.max(...['pos', 'tgt', 'up'].flatMap((k) => a.cam[k].map((x, i) => Math.abs(x - b.cam[k][i]))));
const sameParams = (a, b) => JSON.stringify(a.params) === JSON.stringify(b.params);
const brief = (s) => JSON.stringify({ level: s.level, view: s.view, pres: s.pres, mode: s.mode, labels: s.labels, steer: s.params.steer, n: s.params.n, d: s.params.d, orbit: s.orbit, overlay: s.overlay, bottom: s.bottom, retained: s.retained, reason: s.reason });

/** hero + every drawn −3 dB contour point projected, against the safe viewport the HUD reports */
const fitInfo = (page) => page.evaluate(() => {
  const c = window.c2c; const l = c.mgr.current; const cam = c.rig.camera;
  const g = l.fpLine.geometry; const a = g.getAttribute('position'); const n = g.drawRange.count;
  const v = new cam.position.constructor();
  const ins = c.hud.insets();
  const px = () => [((v.x + 1) / 2) * innerWidth, ((1 - v.y) / 2) * innerHeight];
  const pts = [];
  for (let i = 0; i < n; i++) { v.fromBufferAttribute(a, i).applyMatrix4(l.fp.matrixWorld).project(cam); pts.push(px()); }
  l.hero.getWorldPosition(v).project(cam); const hero = px();
  const inside = (q) => q[0] >= ins.left && q[0] <= innerWidth - ins.right && q[1] >= ins.top && q[1] <= innerHeight - ins.bottom;
  const xs = pts.map((q) => q[0]); const ys = pts.map((q) => q[1]);
  return { n, all: n > 2 && pts.every(inside), hero: inside(hero), w: Math.round(Math.max(...xs) - Math.min(...xs)), h: +(Math.max(...ys) - Math.min(...ys)).toFixed(1), cx: Math.round((Math.max(...xs) + Math.min(...xs)) / 2), ins: [ins.top, ins.right, ins.bottom, ins.left].map(Math.round), vw: innerWidth };
});

// ======================================================================= P1: start / end policy
if (want('p1')) {
  // Poster → Replay → Skip at each stage: back to the user's poster (their steer, orbit, camera)
  for (const at of ['q-phase', 'q-beam', 'q-footprint']) await guard(async () => {
    const { ctx, page } = await open('?view=poster&quality=balanced');
    await setSlider(page, 40);
    await page.waitForTimeout(400);
    const before = await snap(page);
    await posterBtn(page, 'Replay').click();
    await stage(page, at);
    await page.waitForTimeout(300);
    await page.locator('.hd-skip').click();
    await idle(page);
    await page.waitForTimeout(300);
    const after = await snap(page);
    if (at === 'q-beam') await page.screenshot({ path: `${out}/p1-poster-skip-q-beam.png` });
    check(`poster → Replay → Skip at ${at}: Cosmos poster with the user's params, orbit, camera`,
      after.level === 'cosmos' && after.cur === 'cosmos' && after.view === 'poster' && after.pres && after.bottom && !after.overlay && !after.demoClass
      && sameParams(after, before) && after.params.steer === 40 && JSON.stringify(after.orbit) === JSON.stringify(before.orbit) && camDiff(after, before) < 1e-6 && after.labels === before.labels,
      `${brief(after)} camΔ=${camDiff(after, before).toExponential(1)}`);
    await ctx.close();
  });

  // Landing → Run → Skip at q-beam: Satellite landing restored
  await guard(async () => {
    const { ctx, page } = await open('?quality=balanced');
    await page.waitForTimeout(800);
    const before = await snap(page);
    await page.locator('.pst-landing button', { hasText: 'Run' }).click();
    await stage(page, 'q-beam');
    await page.waitForTimeout(300);
    await page.locator('.hd-skip').click();
    await idle(page);
    await page.waitForTimeout(300);
    const after = await snap(page);
    await page.screenshot({ path: `${out}/p1-landing-skip.png` });
    check('landing → Run → Skip at q-beam: Satellite landing, starting state and framing',
      after.level === 'satellite' && after.view === 'landing' && after.landing && after.pres && !after.bottom && !after.overlay && sameParams(after, before) && after.mode === before.mode && camDiff(after, before) < 1e-6,
      `${brief(after)} camΔ=${camDiff(after, before).toExponential(1)}`);
    await ctx.close();
  });

  // Free exploration (changed mode/labels/params) → ▶ Beam demo → Skip: store restored, stays in a settled scene, can navigate
  await guard(async () => {
    const { ctx, page } = await open('?nointro&quality=balanced&level=satellite');
    await page.evaluate(() => { const c = window.c2c; c.store.set({ mode: 'thermal', labels: false }); c.store.setParams({ arrayN: 12, steerDeg: 33, weighting: 'hann' }); });
    await page.waitForTimeout(300);
    const before = await snap(page);
    await page.locator('.demo-btn').click();
    await stage(page, 'q-beam');
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await idle(page);
    const after = await snap(page);
    const consistent = after.level === after.cur && !after.busy;
    await page.locator('.rung-btn', { hasText: 'Satellite' }).first().click().catch(() => {});
    const nav = await page.waitForFunction(() => window.c2c.mgr.current?.id === 'satellite' && !window.c2c.mgr.isBusy, null, { timeout: T }).then(() => true, () => false);
    check('explore → Beam demo → Skip: mode/labels/params/presentation restored; level consistent; navigation works',
      consistent && after.mode === 'thermal' && !after.labels && sameParams(after, before) && !after.pres && after.view === 'hidden' && !after.overlay && after.retained === 0 && nav,
      `${brief(after)} cur=${after.cur} nav=${nav}`);
    await ctx.close();
  });

  // Poster → Why 0.5λ matters / Engineering demo → completion: free exploration over Cosmos overview
  for (const [btn, mode] of [['Why 0.5λ matters', 'grating'], ['Engineering demo', 'engineering']]) await guard(async () => {
    const { ctx, page } = await open('?view=poster&quality=balanced');
    await posterBtn(page, btn).click();
    await running(page);
    await page.waitForTimeout(500);
    const start = await snap(page);
    await page.screenshot({ path: `${out}/p1-${mode}-start.png` });
    check(`poster → ${btn}: poster card gone, presentation off, signal mode + labels`, !start.bottom && !start.pres && start.view === 'hidden' && start.mode === 'signal' && start.labels, brief(start));
    let secondary = null;
    if (mode === 'grating') {
      await page.waitForFunction(() => document.body.dataset.demoReady === 'g-earth', null, { timeout: T });
      secondary = await page.evaluate(() => ({ lobes: window.c2c.beam().secondary.length, drawn: window.c2c.mgr.current.fpSecondary.geometry.drawRange.count }));
      await page.screenshot({ path: `${out}/p1-grating-earth.png` });
    }
    await idle(page);
    // the completion toast lives 7 s: read it before anything slow (screenshots under SwiftShader)
    const toast = await page.evaluate(() => { const t = document.querySelector('.toast.show'); if (!t) return null; const r = t.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { text: t.textContent.slice(0, 40), onTop: !!e && t.contains(e) }; });
    await page.waitForTimeout(1500);
    const end = await snap(page);
    await page.screenshot({ path: `${out}/p1-${mode}-complete.png` });
    const home = await page.evaluate(() => { const c = window.c2c; const h = c.mgr.current.home; return Math.max(c.rig.camera.position.distanceTo(h.pos), c.rig.controls.target.distanceTo(h.target)); });
    // explorable: select through a real callout, then the inspector shows it
    await page.locator('.callout:visible', { hasText: '−3 dB Footprint' }).first().click({ timeout: 20000 }).catch((e) => console.log('  callout click:', e.message.split('\n')[0]));
    await page.waitForTimeout(500);
    const sel = await page.evaluate(() => ({ selected: window.c2c.store.get().selected, panel: !!document.querySelector('.panel') && getComputedStyle(document.querySelector('.panel')).display !== 'none' }));
    const kept = mode === 'grating' ? end.params.d > 0.5 : end.params.steer === 25;
    check(`${btn} completes into free exploration: Cosmos overview, orbit running, results kept, toast visible, inspector usable`,
      end.level === 'cosmos' && !end.pres && end.view === 'hidden' && !end.bottom && end.rail && end.orbit && !end.orbit.paused && home < 1e-6 && kept && toast?.onTop && sel.selected === 'footprint' && sel.panel && end.retained === 0,
      `${brief(end)} homeΔ=${home.toExponential(1)} toast=${JSON.stringify(toast)} sel=${JSON.stringify(sel)}${secondary ? ` secondary=${JSON.stringify(secondary)}` : ''}`);
    if (mode === 'grating') check('Grating: secondary (grating-lobe) footprint drawn on Earth', secondary.lobes > 0 && secondary.drawn > 0, JSON.stringify(secondary));
    await ctx.close();
  });

  // Poster → Engineering → Skip: back to the poster (snapshot taken before the poster was hidden)
  await guard(async () => {
    const { ctx, page } = await open('?view=poster&quality=balanced');
    await setSlider(page, 10);
    await page.waitForTimeout(300);
    const before = await snap(page);
    await posterBtn(page, 'Engineering demo').click();
    await stage(page, 'array-focus');
    await page.locator('.hd-skip').click();
    await idle(page);
    const after = await snap(page);
    check('poster → Engineering → Skip: poster restored with the user\'s params and orbit',
      after.level === 'cosmos' && after.view === 'poster' && after.pres && after.bottom && sameParams(after, before) && JSON.stringify(after.orbit) === JSON.stringify(before.orbit) && camDiff(after, before) < 1e-6, brief(after));
    await ctx.close();
  });

  // Engineering from explore → click the scale rail during the demo: the requested level wins
  await guard(async () => {
    const { ctx, page } = await open('?nointro&quality=balanced&level=satellite');
    // free exploration has no Engineering button; start it through the same entry the poster button uses
    void page.evaluate(() => window.c2c.demo.play('engineering'));
    await stage(page, 'beam-lab');
    await page.locator('.rung-btn', { hasText: 'Payload' }).first().click();
    await page.waitForFunction(() => window.c2c.mgr.current?.id === 'payload' && !window.c2c.mgr.isBusy && !window.c2c.demo.running, null, { timeout: T }).catch(() => {});
    await page.waitForTimeout(1500);
    const s = await snap(page);
    check('navigation during a demo: the requested level is the final state (no restore over it)', s.level === 'payload' && s.cur === 'payload' && !s.running && !s.pres && s.view === 'hidden' && s.reason === 'navigate', brief(s));
    await ctx.close();
  });
}

// ======================================================================= races
if (want('races')) {
  // double Skip, Skip then immediate Replay
  await guard(async () => {
    const { ctx, page } = await open('?view=poster&quality=balanced');
    await setSlider(page, 30);
    await page.waitForTimeout(300);
    const before = await snap(page);
    await posterBtn(page, 'Replay').click();
    await stage(page, 'q-phase');
    const both = await page.evaluate(async () => { const d = window.c2c.demo; const a = d.skip(); const b = d.skip(); await Promise.all([a, b]); return !d.running; });
    const after = await snap(page);
    check('double Skip: both calls settle on the same end; poster restored once', both && after.view === 'poster' && after.params.steer === 30 && camDiff(after, before) < 1e-6 && after.retained === 0, brief(after));
    // Skip → Replay right away: the new run is not overwritten by the old one's restore
    await posterBtn(page, 'Replay').click();
    await stage(page, 'q-satellite');
    await page.locator('.hd-skip').click();
    await posterBtn(page, 'Replay').click({ timeout: 60000 });
    await idle(page);
    await page.waitForTimeout(1500);
    const s = await snap(page);
    check('Skip then immediate Replay: the second run completes into the reference poster (POSTER_STATE, orbit 0, paused)', s.view === 'poster' && s.params.steer === 25 && s.orbit?.time === 0 && s.orbit?.paused && s.reason === 'complete' && s.retained === 0, brief(s));
    await ctx.close();
  });
  // Skip during preparation (cold: nothing preloaded yet)
  await guard(async () => {
    const { ctx, page } = await open('?quality=balanced');
    await page.waitForTimeout(500);
    const before = await snap(page);
    await page.locator('.pst-landing button', { hasText: 'Run' }).click();
    await page.locator('.hd-skip').click();
    const ok = await idle(page, 120000).then(() => true, () => false);
    const s = await snap(page);
    check('Skip during preparation: ends promptly, landing restored, no hang', ok && s.view === 'landing' && s.level === 'satellite' && sameParams(s, before) && !s.overlay, brief(s));
    await ctx.close();
  });
  // Explore freely in the last Quick segment; slider in the last segment
  await guard(async () => {
    const { ctx, page } = await open('?view=poster&quality=balanced');
    await posterBtn(page, 'Replay').click();
    await stage(page, 'q-poster');
    await setSlider(page, 45);
    await posterBtn(page, 'Explore freely').click();
    await idle(page);
    await page.waitForTimeout(4500); // longer than the remaining reading holds
    const s = await snap(page);
    check('Explore freely during the Link segment: stays in exploration (no late poster/pause), keeps the slider value', !s.pres && s.view === 'hidden' && s.orbit && !s.orbit.paused && s.params.steer === 45 && s.reason === 'explore' && s.rail, brief(s));
    await ctx.close();
  });
  await guard(async () => {
    const { ctx, page } = await open('?view=poster&quality=balanced');
    await posterBtn(page, 'Replay').click();
    await stage(page, 'q-poster');
    await setSlider(page, 12);
    await idle(page);
    const s = await snap(page);
    check('Try-it slider during the Link segment: completion keeps the user\'s value on the poster', s.view === 'poster' && s.pres && s.params.steer === 12 && s.reason === 'complete', brief(s));
    await ctx.close();
  });
}

// ======================================================================= resize
if (want('resize')) await guard(async () => {
  const { ctx, page } = await open('?view=poster&quality=balanced');
  await page.waitForTimeout(800);
  const ref = await snap(page);
  for (const steer of [0, 25, 50]) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(900);
    await setSlider(page, steer);
    await page.waitForTimeout(600);
    const d0 = await snap(page);
    const f0 = await fitInfo(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(1200);
    const m = await snap(page);
    const fm = await fitInfo(page);
    if (steer === 50) await page.screenshot({ path: `${out}/resize-390-50.png` });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(1200);
    const d1 = await snap(page);
    const f1 = await fitInfo(page);
    check(`resize 1440×900 → 390×844 → 1440×900 at θ0=${steer}°: hero + full contour inside the safe viewport at both sizes; params/orbit preserved; no drift`,
      f0.all && f0.hero && fm.all && fm.hero && f1.all && f1.hero && sameParams(m, d0) && sameParams(d1, d0) && JSON.stringify(d1.orbit) === JSON.stringify(ref.orbit) && camDiff(d1, ref) < 1e-6,
      `390: ${JSON.stringify(fm)} | 1440: all=${f1.all} hero=${f1.hero} camΔ(ref)=${camDiff(d1, ref).toExponential(1)}`);
  }
  await ctx.close();
});

// ======================================================================= physics
if (want('physics')) await guard(async () => {
  const { ctx, page } = await open('?nointro&quality=balanced&level=satellite', [{ width: 1280, height: 800 }, {}]);
  await page.waitForTimeout(1000);
  const sat = await page.evaluate(async () => {
    const c = window.c2c; const l = c.mgr.current; const o = [];
    for (const [t, p] of [[0, 0], [40, 0], [40, 90], [40, 180]]) {
      c.store.setParams({ steerDeg: t, steerAzDeg: p });
      await new Promise((r) => setTimeout(r, 300));
      const q = l.subarray.getWorldQuaternion(l.subarray.quaternion.clone());
      const n = new l.subarray.position.constructor(0, 1, 0).applyQuaternion(q);
      o.push({ t, p, dot: -n.y, q: q.toArray() });
    }
    return o;
  });
  const sameAtt = (a, b) => Math.abs(Math.abs(a.reduce((s, x, i) => s + x * b[i], 0)) - 1) < 1e-9; // q and −q are the same attitude
  check('SATELLITE: panel normal · nadir ≥ 0.999999; attitude fixed for θ 0/40, φ 0/90/180', sat.every((s) => s.dot >= 0.999999 && sameAtt(s.q, sat[0].q)), sat.map((s) => s.dot.toFixed(9)).join(','));
  await page.evaluate(() => window.c2c.mgr.goTo('cosmos'));
  await page.waitForFunction(() => window.c2c.mgr.current?.id === 'cosmos' && !window.c2c.mgr.isBusy, null, { timeout: T });
  const cos = await page.evaluate(async () => {
    const c = window.c2c; const l = c.mgr.current; const o = [];
    const ap = l.hero.children.find((x) => x.name === 'earth-facing-array');
    const axes = [];
    for (const T of [0, 13, 37]) {
      l.setOrbitState({ time: T, paused: true });
      const qs = []; let minDot = 1;
      for (const [s, az] of [[0, 0], [40, 0], [40, 90], [40, 180]]) {
        c.store.setParams({ steerDeg: s, steerAzDeg: az });
        await new Promise((r) => setTimeout(r, 250));
        l.hero.updateMatrixWorld(true);
        const q = ap.getWorldQuaternion(ap.quaternion.clone());
        const n = new l.hero.position.constructor(0, -1, 0).applyQuaternion(q);
        const nad = l.hero.getWorldPosition(new l.hero.position.constructor()).negate().normalize();
        minDot = Math.min(minDot, n.dot(nad)); qs.push(q.toArray());
        if (T === 0) axes.push(c.beam().pattern.axis.map((x) => +x.toFixed(4)).join(','));
      }
      o.push({ T, minDot, qs });
    }
    return { o, axes };
  });
  check('COSMOS: aperture normal · nadir ≥ 0.999999 at 3 orbit positions; steering leaves the attitude fixed', cos.o.every((x) => x.minDot >= 0.999999 && x.qs.every((q) => sameAtt(q, x.qs[0]))), cos.o.map((x) => `T${x.T}:${x.minDot.toFixed(9)}`).join(' '));
  check('steering changes the beam axis (phase → beam → footprint)', new Set(cos.axes).size === 4, cos.axes.join(' | '));
  await ctx.close();
});

// ======================================================================= reduced motion
if (want('reduced')) {
  for (const path of ['complete', 'skip']) await guard(async () => {
    const { ctx, page } = await open('?quality=balanced', DESKTOP, { reducedMotion: 'reduce' });
    await page.waitForTimeout(500);
    const before = await snap(page);
    await page.locator('.pst-landing button', { hasText: 'Run' }).click();
    if (path === 'skip') {
      await stage(page, 'q-phase');
      await page.locator('.hd-skip').click();
    }
    await idle(page);
    await page.waitForTimeout(300);
    if (path === 'complete') {
      await setSlider(page, 40);
      await page.waitForTimeout(500);
    }
    const s = await snap(page);
    const t = await page.evaluate(() => window.c2c.demo.timing);
    if (path === 'complete') check('reduced motion: Quick completes on the poster; Try-it works', s.view === 'poster' && s.params.steer === 40 && s.reason === 'complete', `${brief(s)} planned=${(t.plannedPlaybackMs / 1000).toFixed(1)} s`);
    else check('reduced motion: Skip restores the landing', s.view === 'landing' && s.level === 'satellite' && sameParams(s, before), brief(s));
    await ctx.close();
  });
}

// ======================================================================= captures (?demoHold for settled frames — not timing)
if (want('captures')) {
  for (const [name, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]]) await guard(async () => {
    const { ctx, page } = await open('?quality=auto&demoHold=4', vp);
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${out}/cap-${name}-landing.png` });
    await page.locator('.pst-landing button', { hasText: 'Run' }).click();
    for (const s of ['q-phase', 'q-beam', 'q-footprint', 'q-poster']) {
      await page.waitForFunction((x) => document.body.dataset.demoReady === x, s, { timeout: T });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${out}/cap-${name}-${s}.png` });
    }
    await idle(page);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/cap-${name}-poster-final.png` });
    const dpr = await page.evaluate(() => ({ input: devicePixelRatio, render: window.c2c.renderer.getPixelRatio(), tier: window.c2c.config().tier ?? null }));
    results.timing.push({ capture: name, dpr });
    for (const steer of [0, 25, 50]) {
      await setSlider(page, steer);
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${out}/cap-${name}-poster-${steer}.png` });
      if (name === 'mobile') {
        const f = await fitInfo(page);
        console.log(`  mobile poster ${steer}°: contour ${f.w}×${f.h}px, all-in=${f.all}`);
        results.timing.push({ legibility: `mobile-${steer}`, contourPx: [f.w, f.h] });
      }
    }
    await ctx.close();
  });
}

// ======================================================================= timing (no demoHold; desktop and mobile run one after the other)
if (want('timing')) {
  for (const [name, vp] of [['desktop', DESKTOP], ['mobile', MOBILE]]) await guard(async () => {
    const { ctx, page } = await open('?quality=balanced', vp);
    await page.waitForTimeout(1500);
    for (const run of ['cold', 'warm']) {
      const t0 = Date.now();
      if (run === 'cold') await page.locator('.pst-landing button', { hasText: 'Run' }).click();
      else await posterBtn(page, 'Replay').click();
      await running(page);
      await idle(page);
      const harness = (Date.now() - t0) / 1000;
      const t = await page.evaluate(() => window.c2c.demo.timing);
      const row = { viewport: name, run, ...Object.fromEntries(Object.entries(t).map(([k, v]) => [k, typeof v === 'number' ? +(v / 1000).toFixed(2) : v])), harnessSeconds: +harness.toFixed(2) };
      results.timing.push(row);
      console.log('  timing', JSON.stringify(row));
      await page.waitForTimeout(1500);
    }
    await ctx.close();
  });
}

await browser.close();
writeFileSync(`${out}/demo-flows.json`, JSON.stringify(results, null, 2));
const passed = results.checks.filter((c) => c.ok).length;
console.log(`\n${passed}/${results.checks.length} checks passed · page errors ${results.errors.length}`);
for (const e of results.errors.slice(0, 10)) console.log('  error:', e);
process.exitCode = passed === results.checks.length ? 0 : 1;
