// Headless smoke test: loads every scale level, fails on page errors and saves screenshots.
//
// Usage (requires a Chromium and playwright-core, which are NOT project dependencies):
//   npm run build && npx vite preview --port 4173 &
//   npm i --no-save playwright-core
//   node scripts/smoke.mjs [http://localhost:4173] [out-dir]
// Set CHROMIUM_PATH to use a specific browser binary.
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:4173';
const out = process.argv[3] ?? 'screenshots';
mkdirSync(out, { recursive: true });
const levels = ['cosmos', 'satellite', 'array', 'payload', 'pcb', 'package', 'die', 'mosfet', 'silicon', 'energy'];

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${url}/?nointro`);
await page.waitForFunction(() => document.body.classList.contains('ready'), null, { timeout: 60000 });
for (const id of levels) {
  await page.evaluate((l) => window.c2c.mgr.jumpTo(l), id);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${id}.png` });
  console.log(`✓ ${id}`);
}
// one real zoom transition chain
await page.evaluate(() => window.c2c.mgr.jumpTo('satellite'));
await page.evaluate(() => window.c2c.mgr.goTo('die'));
const level = await page.evaluate(() => window.c2c.store.get().level);
if (level !== 'die') errors.push(`transition ended at ${level}, expected die`);
await browser.close();
if (errors.length) {
  console.error('Page errors:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('Smoke test passed.');
