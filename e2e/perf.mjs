// 200-slide performance check against the production build under /my-repo/.
// Budgets are deliberately generous (CI machines vary); the numbers are printed so regressions are visible.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { launch, sleep } from './lib.mjs';
import { createDeck, createSlide, createTextBox, createShape, createChart, createTable } from '../src/model/factory.js';
import { SIZE_PRESETS } from '../src/model/constants.js';

if (!process.env.SKIP_BUILD) execSync('npm run build', { stdio: 'inherit', env: { ...process.env, BASE_PATH: '/my-repo/' } });
const N = 200;
const size = SIZE_PRESETS['16:9'];
const slides = [];
for (let i = 0; i < N; i++) {
  const s = createSlide(size, 'titleContent', { title: 'Slide ' + (i + 1) });
  s.objects.push(createTextBox({ x: 80, y: 60 + (i % 5) * 10, w: 700, h: 80 }));
  s.objects.push(createShape(['rect', 'ellipse', 'star', 'arrow'][i % 4], { x: 900, y: 120, w: 240, h: 240 }));
  if (i % 4 === 0) s.objects.push(createChart(['bar', 'line', 'pie'][(i / 4) % 3], { x: 80, y: 300, w: 640, h: 360 }));
  if (i % 7 === 0) s.objects.push(createTable(4, 4, { x: 760, y: 420, w: 480, h: 240 }));
  slides.push(s);
}
const deck = createDeck({ name: 'Perf 200', slides });
const backup = { format: 'slidewise-backup', version: 1, exportedAt: new Date().toISOString(), folders: [], decks: [deck] };
const file = path.join(fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'sw-perf-')), 'perf.json');
fs.writeFileSync(file, JSON.stringify(backup));

const env = await launch(); const page = await env.newPage('perf');
const out = {}; let fail = 0;
const check = (name, v, max, unit) => { const ok = v <= max; if (!ok) fail++; console.log(`${ok ? '✓' : '✗'} ${name}: ${Math.round(v)}${unit} (budget ${max}${unit})`); };
try {
  await page.goto(env.base, { waitUntil: 'networkidle0' });
  await (await page.$('[data-testid=backup-input]')).uploadFile(file);
  await page.waitForSelector('.card', { timeout: 15000 }).catch(async () => { throw new Error('import failed: ' + (await page.evaluate(() => document.querySelector('.banner')?.textContent))); });
  let t0 = Date.now();
  await page.evaluate(() => document.querySelector('.card-open').click());
  await page.waitForSelector('.stage canvas'); await page.waitForFunction((n) => document.querySelectorAll('.sorter-item').length >= 1 && /\b200\b/.test(document.body.innerText) || document.querySelectorAll('.sorter-item').length === n, {}, N);
  out.open = Date.now() - t0;
  const count = await page.evaluate(() => document.querySelectorAll('.sorter-item').length);
  console.log(`sorter DOM items rendered: ${count} of ${N} (list is windowed if < ${N})`);
  // slide-switch latency: click through 30 slides via keyboard in the sorter
  await page.evaluate(() => document.querySelector('.sorter-item').focus());
  const lat = [];
  for (let i = 0; i < 30; i++) { const a = Date.now(); await page.keyboard.press('ArrowDown'); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))); lat.push(Date.now() - a); }
  lat.sort((a, b) => a - b); out.p50 = lat[15]; out.p95 = lat[28];
  // scroll the whole sorter end to end
  t0 = Date.now(); await page.evaluate(async () => { const l = document.querySelector('.sorter-list'); for (let y = 0; y <= l.scrollHeight; y += 400) { l.scrollTop = y; await new Promise((r) => requestAnimationFrame(r)); } });
  out.scroll = Date.now() - t0;
  const heap = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : 0);
  check('open 200-slide deck to interactive', out.open, 8000, 'ms');
  check('slide switch p50', out.p50, 250, 'ms');
  check('slide switch p95', out.p95, 600, 'ms');
  check('scroll sorter through all slides', out.scroll, 8000, 'ms');
  if (heap) check('JS heap', heap, 600, 'MB');
  // present from the middle
  t0 = Date.now(); await page.keyboard.press('F5'); await page.waitForSelector('[data-testid=present-canvas]'); const pres = Date.now() - t0; check('start presenting', pres, 3000, 'ms');
  console.log('page errors:', env.problems.length ? env.problems : 'none'); if (env.problems.length) fail++;
} catch (e) { console.log('✗ perf run crashed:', e.message); fail++; }
await env.close(); fs.rmSync(path.dirname(file), { recursive: true, force: true });
console.log(fail ? `\n${fail} performance check(s) failed` : '\nAll performance checks passed'); process.exit(fail ? 1 : 0);
