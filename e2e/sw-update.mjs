// Real service-worker update flow: load version A, replace the served files with version B (different sw.js),
// trigger an update check, and expect (1) the new worker to take over and (2) the "new version" banner to appear,
// (3) the app to keep working offline afterwards.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launch, sleep } from './lib.mjs';

const live = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-live-'));
fs.cpSync('dist', live, { recursive: true });
const env = await launch({ distDir: live }); const page = await env.newPage('sw');
let ok = true; const check = (c, m) => { console.log((c ? '✓ ' : '✗ ') + m); if (!c) ok = false; };
try {
  await page.goto(env.base, { waitUntil: 'networkidle0' });
  await page.evaluate(() => navigator.serviceWorker.ready); await sleep(500);
  await page.reload({ waitUntil: 'networkidle0' });                       // now controlled by version A
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page is controlled by the first service worker');
  const swPath = path.join(live, 'sw.js'); const a = fs.readFileSync(swPath, 'utf8');
  const m = a.match(/const VERSION = '([^']+)'/); check(!!m, 'sw.js has a VERSION');
  fs.writeFileSync(swPath, a.replace(m[1], m[1] + '-next'));                // "deploy" version B
  await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });
  await page.waitForSelector('.update-banner', { timeout: 15000 }).then(() => check(true, 'update banner shown after the new worker took over'), () => check(false, 'update banner shown after the new worker took over'));
  await sleep(1500); const caches = await page.evaluate(() => caches.keys()); check(caches.length === 1 && caches[0].endsWith('-next'), 'old cache deleted, new cache present: ' + caches.join(','));
  await env.browser.defaultBrowserContext().overridePermissions?.(env.base, []).catch(() => {});
  await page.setOfflineMode(true); await page.reload({ waitUntil: 'load' });
  check(!!(await page.$('[data-template="blank"]')), 'still loads offline after the update');
} catch (e) { console.log('✗ crashed:', e.message); ok = false; }
await env.close(); fs.rmSync(live, { recursive: true, force: true });
console.log(ok ? '\nService-worker update check passed' : '\nService-worker update check FAILED'); process.exit(ok ? 0 : 1);
