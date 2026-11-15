import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import puppeteer from 'puppeteer-core';
import { serve } from './server.mjs';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const assert = (c, m) => { if (!c) throw new Error('Assertion failed: ' + m); };
export const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };

export async function launch({ distDir = 'dist', prefix = '/my-repo/' } = {}) {
  const { server, port } = await serve(path.resolve(distDir), prefix);
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
  const dl = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-dl-'));
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  const base = `http://127.0.0.1:${port}${prefix}`;
  const problems = [];
  const track = (page, label) => {
    page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' || /Content Security Policy|Refused to/.test(t)) problems.push(`[${label}] console ${m.type()}: ${t}`); });
    page.on('pageerror', (e) => problems.push(`[${label}] pageerror: ${e.message}`));
  };
  const newPage = async (label = 'page', vp = { width: 1400, height: 900 }) => { const p = await browser.newPage(); await p.setViewport(vp); track(p, label); return p; };
  const close = async () => { await browser.close(); server.close(); fs.rmSync(dl, { recursive: true, force: true }); };
  return { browser, base, dl, problems, newPage, close };
}

export async function waitDownload(dl, ext, timeout = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const f = fs.readdirSync(dl).filter((n) => n.endsWith(ext) && !n.endsWith('.crdownload') && !n.startsWith('done-'));
    if (f.length) { const p = path.join(dl, f[0]); const s1 = fs.statSync(p).size; await sleep(150); if (fs.statSync(p).size === s1 && s1 > 0) { const out = path.join(dl, 'done-' + Date.now() + '-' + f[0]); fs.renameSync(p, out); return out; } }
    await sleep(150);
  }
  throw new Error('Download of ' + ext + ' did not complete');
}
export async function menu(page, top, label) {
  await page.evaluate((t) => { [...document.querySelectorAll('.menu-top')].find((b) => b.textContent === t).click(); }, top);
  await page.waitForSelector('.menu[role=menu] .menu-item');
  const ok = await page.evaluate((l) => { const b = [...document.querySelectorAll('.menu .menu-item')].find((x) => x.querySelector('.menu-label').textContent === l); if (!b || b.disabled) return false; b.click(); return true; }, label);
  if (!ok) throw new Error(`Menu item not found/disabled: ${top} > ${label}`);
  await sleep(120);
}
export const objCount = (page) => page.evaluate(() => document.querySelectorAll('.overlay .obj').length);
export const objTypes = (page) => page.evaluate(() => [...document.querySelectorAll('.overlay .obj')].map((o) => o.dataset.type));
export const focusObj = async (page, i) => { await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.keyboard.press('Escape'); return page.evaluate((n) => { const o = document.querySelectorAll('.overlay .obj')[n]; o.focus(); return o.dataset.objId; }, i); };
export const waitSaved = async (page) => { await page.waitForFunction(() => document.querySelector('[data-testid=save-state]')?.textContent.includes('Saved'), { timeout: 15000 }); await sleep(100); };
export const getDecks = (page) => page.evaluate(() => new Promise((res, rej) => { const r = indexedDB.open('slidewise'); r.onerror = () => rej(r.error); r.onsuccess = () => { const q = r.result.transaction('decks').objectStore('decks').getAll(); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); }; }));
export async function runAxe(page, label) {
  const src = fs.readFileSync(path.resolve('node_modules/axe-core/axe.min.js'), 'utf8');
  await page.evaluate(src);
  const res = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } }); return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ') + ' :: ' + (n.failureSummary || '').split('\n').slice(1, 3).join(' ')) })); });
  return { label, violations: res };
}
export function makeRunner() {
  const results = [];
  return {
    results,
    async test(name, fn) { const t0 = Date.now(); try { await fn(); results.push({ name, ok: true, ms: Date.now() - t0 }); console.log(`  ✓ ${name} (${Date.now() - t0} ms)`); } catch (e) { const where = (e.stack || '').split('\n').find((l) => /run\.mjs:\d+/.test(l)); results.push({ name, ok: false, err: e.message }); console.log(`  ✗ ${name}\n      ${e.message.split('\n')[0]}\n      ${where ? where.trim().replace(/.*\(?file:\/\/\/.*\/(run\.mjs:\d+).*/, '$1') : ''}`); } },
  };
}
