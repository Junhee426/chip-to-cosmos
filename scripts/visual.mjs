// Visual regression capture: the 12 representative views (section Y of the V2 brief).
//
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core
//   CHROMIUM_PATH=/path/to/chrome node scripts/visual.mjs [url] [out-dir]
//
// Runs under SwiftShader by default; images are for before/after comparison of
// layout and look, not for performance claims.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const url = pos[0] ?? 'http://localhost:4173';
const out = pos[1] ?? 'visual-out';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const errors = [];

async function session(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${url}/?nointro&quality=balanced`);
  await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 120000 });
  return { ctx, page };
}
const jump = (page, id) => page.evaluate((l) => window.c2c.mgr.jumpTo(l), id);
const settle = (page, ms = 2500) => page.waitForTimeout(ms);

const { ctx, page } = await session({ width: 1440, height: 900 });
const desktop = [
  ['01-cosmos', 'cosmos'],
  ['02-satellite', 'satellite'],
  ['03-satellite-exploded', 'satellite', async () => page.evaluate(() => window.c2c.store.set({ explode: 1 }))],
  ['04-payload', 'payload'],
  ['05-pcb', 'pcb'],
  ['06-package', 'package'],
  ['07-die', 'die'],
  ['08-mosfet', 'mosfet'],
  ['09-beam-lab', 'array'],
];
for (const [name, level, after] of desktop) {
  await page.evaluate(() => window.c2c.store.set({ explode: 0 }));
  await jump(page, level);
  await settle(page);
  if (after) {
    await after();
    await settle(page, 3000);
  }
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log(`✓ ${name}`);
}
await ctx.close();

const phone = { deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const m = await session({ width: 390, height: 844 }, phone);
await settle(m.page, 3000);
await m.page.screenshot({ path: `${out}/10-mobile.png` });
console.log('✓ 10-mobile');
await m.page.tap('.sheet-summary [data-act="experiment"]');
await settle(m.page, 1500);
await m.page.screenshot({ path: `${out}/11-mobile-expanded.png` });
console.log('✓ 11-mobile-expanded');
await m.ctx.close();

const l = await session({ width: 844, height: 390 }, phone);
await settle(l.page, 3000);
await l.page.screenshot({ path: `${out}/12-mobile-landscape.png` });
console.log('✓ 12-mobile-landscape');
await l.ctx.close();
await browser.close();
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
