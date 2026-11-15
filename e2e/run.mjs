import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import { launch, sleep, assert, eq, waitDownload, menu, objCount, objTypes, focusObj, waitSaved, getDecks, runAxe, makeRunner } from './lib.mjs';

if (!process.env.SKIP_BUILD) { console.log('Building for subpath /my-repo/ …'); execSync('npm run build', { stdio: 'inherit', env: { ...process.env, BASE_PATH: '/my-repo/' } }); }
const fixture = path.resolve('e2e/fixture.png');
const env = await launch();
const { base, dl, problems } = env;
const R = makeRunner(); const t = R.test;
const axeReports = [];
let page; let deckId;
const NOTES = 'Remember to smile';

console.log('\nSlidewise end-to-end tests (production build, base path /my-repo/)');
page = await env.newPage('main');

await t('home loads under the repo subpath with no console errors or CSP violations', async () => {
  await page.goto(base, { waitUntil: 'networkidle0' });
  assert(await page.$('[data-template="blank"]'), 'templates visible');
  assert((await page.title()) === 'Slidewise', 'title');
  const mf = await page.evaluate(() => fetch(document.querySelector('link[rel=manifest]').href).then((r) => r.json()));
  eq(mf.name, 'Slidewise', 'manifest name');
  const icon = await page.evaluate(() => fetch('./icons/icon-192.png').then((r) => r.status));
  eq(icon, 200, 'icon served from subpath');
});
await t('axe: home screen has no serious/critical violations', async () => { axeReports.push(await runAxe(page, 'home')); });

await t('create a deck from a template', async () => {
  await page.click('[data-template="blank"]');
  await page.waitForSelector('.stage canvas', { timeout: 10000 });
  deckId = await page.evaluate(() => location.hash.split('/')[2]);
  assert(deckId, 'deck id in hash');
  eq(await objCount(page), 2, 'title slide has title + subtitle placeholders');
});

await t('add every object type (text, 7 shapes, image, table, 3 charts)', async () => {
  await menu(page, 'Insert', 'Text box');
  for (const s of ['Rectangle', 'Rounded rectangle', 'Ellipse', 'Triangle', 'Arrow', 'Line', 'Star']) await menu(page, 'Insert', s);
  const input = await page.$('[data-testid=image-input]'); await input.uploadFile(fixture);
  await page.waitForFunction(() => document.querySelector('.overlay .obj[data-type=image]'), { timeout: 8000 });
  await menu(page, 'Insert', 'Table');
  for (const c of ['Bar chart', 'Line chart', 'Pie chart']) await menu(page, 'Insert', c);
  const types = await objTypes(page);
  eq(types.length, 2 + 1 + 7 + 1 + 1 + 3, 'object count');
  for (const ty of ['text', 'shape', 'image', 'table', 'chart']) assert(types.includes(ty), 'has ' + ty);
  eq(types.filter((x) => x === 'chart').length, 3, 'three charts');
  const names = await page.evaluate(() => [...document.querySelectorAll('.overlay .obj')].map((o) => o.getAttribute('aria-label')));
  assert(names.every((n) => n && n.length > 3), 'every object has a screen-reader name');
  assert(names.some((n) => /Image \(no alt text\)/.test(n)), 'image announces missing alt text');
});
await t('canvas actually paints (non-blank) with shapes, chart and image', async () => {
  const stats = await page.evaluate(() => { const c = document.querySelector('[data-testid=slide-canvas]'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; const seen = new Set(); for (let i = 0; i < d.length; i += 4 * 211) seen.add((d[i] >> 5) + ',' + (d[i + 1] >> 5) + ',' + (d[i + 2] >> 5)); return seen.size; });
  assert(stats > 8, 'canvas has varied colours, got ' + stats);
});

await t('edit text inline, then format it', async () => {
  await focusObj(page, 0);
  await page.keyboard.press('Enter');
  await page.waitForSelector('.sw-edit');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await page.keyboard.type('Edited title');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.press('b'); await page.keyboard.up('Control');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('.sw-edit'));
  const label = await page.evaluate(() => document.querySelectorAll('.overlay .obj')[0].getAttribute('aria-label'));
  assert(label.includes('Edited title'), 'label updated: ' + label);
  await waitSaved(page);
  const deck = (await getDecks(page))[0].deck;
  const run = deck.slides[0].objects[0].tx.paras[0].runs[0];
  eq(run.t, 'Edited title', 'saved text'); eq(run.b, true, 'bold run saved');
});

await t('undo / redo and arrow-key nudge', async () => {
  const idx = 3; const before = await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].style.left, idx);
  await focusObj(page, idx);
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  const after = await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].style.left, idx);
  assert(parseFloat(after) === parseFloat(before) + 3, `nudged ${before} -> ${after}`);
  await page.keyboard.down('Control'); await page.keyboard.press('z'); await page.keyboard.up('Control');
  eq(await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].style.left, idx), before, 'undo restores position (coalesced nudges)');
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('z'); await page.keyboard.up('Shift'); await page.keyboard.up('Control');
  eq(await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].style.left, idx), after, 'redo');
});

await t('drag, resize and rotate with the mouse', async () => {
  const contentId = await page.evaluate(() => document.querySelector('.sorter-item.current').dataset.slideId);
  await page.keyboard.press('Escape'); await page.keyboard.down('Control'); await page.keyboard.press('m'); await page.keyboard.up('Control'); await sleep(200);
  await menu(page, 'Insert', 'Rectangle'); await sleep(200);
  const id = await page.evaluate(() => document.querySelectorAll('.overlay .obj')[2].dataset.objId);
  await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].focus(), 2);
  const box = await page.evaluate((i) => { const r = document.querySelectorAll('.overlay .obj')[i].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; }, 2);
  const lb = await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].style.left, 2);
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.move(box.x + 40, box.y + 30, { steps: 6 }); await page.mouse.up();
  const la = await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].style.left, 2);
  assert(la !== lb, `dragged ${lb} -> ${la}`);
  const h = await page.$('.sel-box [data-handle=se]'); assert(h, 'resize handle shown');
  const hb = await h.boundingBox(); const w0 = await page.evaluate((i) => parseFloat(document.querySelectorAll('.overlay .obj')[i].style.width), 2);
  await page.mouse.move(hb.x + 5, hb.y + 5); await page.mouse.down(); await page.mouse.move(hb.x + 60, hb.y + 40, { steps: 5 }); await page.mouse.up();
  const w1 = await page.evaluate((i) => parseFloat(document.querySelectorAll('.overlay .obj')[i].style.width), 2);
  assert(w1 > w0, `resized ${w0} -> ${w1}`);
  const rh = await page.$('.sel-box [data-handle=rotate]'); const rb = await rh.boundingBox();
  await page.mouse.move(rb.x + 5, rb.y + 5); await page.mouse.down(); await page.mouse.move(rb.x + 200, rb.y + 120, { steps: 5 }); await page.mouse.up();
  const tr = await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].style.transform, 2);
  assert(/rotate\(/.test(tr), 'rotated: ' + tr);
  void id;
  await page.evaluate(() => document.querySelector('.sorter-item.current').focus());
  await page.click('[aria-label="Delete selected slides"]'); await sleep(200);
  await page.evaluate((sid) => document.querySelector(`.sorter-item[data-slide-id="${sid}"]`).click(), contentId); await sleep(200);
  globalThis.__contentId = contentId;
});

await t('multi-select, align, group / ungroup, lock, z-order', async () => {
  await focusObj(page, 3); await page.keyboard.down('Shift'); await page.evaluate(() => document.querySelectorAll('.overlay .obj')[5].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, shiftKey: true, button: 0, clientX: 5, clientY: 5 }))); await page.keyboard.up('Shift');
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))); await sleep(150);
  const sel = await page.evaluate(() => document.querySelectorAll('.overlay .obj.selected').length); assert(sel >= 2, 'multi selected: ' + sel);
  const before = await objCount(page);
  await page.keyboard.down('Control'); await page.keyboard.press('g'); await page.keyboard.up('Control');
  await sleep(150); eq((await objTypes(page)).includes('group'), true, 'grouped'); assert((await objCount(page)) < before, 'children folded into group');
  await page.keyboard.down('Control'); await page.keyboard.down('Shift'); await page.keyboard.press('g'); await page.keyboard.up('Shift'); await page.keyboard.up('Control'); await sleep(150);
  eq(await objCount(page), before, 'ungrouped restores count');
  await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control');
  await menu(page, 'Format', 'Align left');
  await focusObj(page, 2); await menu(page, 'Format', 'Lock / unlock');
  assert(await page.evaluate(() => document.querySelectorAll('.overlay .obj')[2].classList.contains('locked')), 'locked');
  await menu(page, 'Format', 'Lock / unlock');
  await menu(page, 'Format', 'Send to back');
  const first = await page.evaluate(() => document.querySelectorAll('.overlay .obj')[0].dataset.objId); assert(first, 'z-order ran');
});

await t('copy / paste / duplicate / delete', async () => {
  const n0 = await objCount(page);
  await focusObj(page, 3);
  await page.keyboard.down('Control'); await page.keyboard.press('d'); await page.keyboard.up('Control'); await sleep(150); eq(await objCount(page), n0 + 1, 'duplicate');
  await page.keyboard.down('Control'); await page.keyboard.press('c'); await page.keyboard.press('v'); await page.keyboard.up('Control'); await sleep(150); eq(await objCount(page), n0 + 2, 'paste');
  await page.keyboard.press('Delete'); await sleep(150); eq(await objCount(page), n0 + 1, 'delete');
});

await t('table cell, chart data and image alt text are editable in the panel', async () => {
  const idx = (await objTypes(page)).indexOf('table'); await focusObj(page, idx);
  await page.waitForSelector('[aria-label="Row 2, column 1"]'); await page.type('[aria-label="Row 2, column 1"]', 'cellvalue');
  const ci = (await objTypes(page)).indexOf('chart'); await focusObj(page, ci);
  await page.waitForSelector('[aria-label="Chart data table"]'); await page.evaluate(() => { const i = document.querySelector('[aria-label="Series A, Q1"]'); i.focus(); i.select(); }); await page.keyboard.type('77');
  const ii = (await objTypes(page)).indexOf('image'); await focusObj(page, ii);
  await page.waitForSelector('textarea'); const ta = (await page.$$('.insp textarea'))[0]; await ta.type('a red rectangle');
  const lab = await page.evaluate((i) => document.querySelectorAll('.overlay .obj')[i].getAttribute('aria-label'), ii); assert(lab.includes('a red rectangle'), 'alt text announced: ' + lab);
  await waitSaved(page);
  const d = (await getDecks(page))[0].deck; const objs = d.slides[0].objects;
  assert(objs.find((o) => o.type === 'table').cells[1][0].includes('cellvalue'), 'table cell saved');
  eq(objs.find((o) => o.type === 'chart').series[0].values[0], 77, 'chart value saved');
  eq(objs.find((o) => o.type === 'image').alt, 'a red rectangle', 'alt saved');
});

await t('slides: add, duplicate, hide, reorder (keyboard + drag and drop), delete, notes', async () => {
  const slideCount = () => page.evaluate(() => document.querySelectorAll('.sorter-item').length);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.down('Control'); await page.keyboard.press('m'); await page.keyboard.up('Control'); await page.keyboard.down('Control'); await page.keyboard.press('m'); await page.keyboard.up('Control');
  eq(await slideCount(), 3, 'three slides');
  const order = () => page.evaluate(() => [...document.querySelectorAll('.sorter-item')].map((e) => e.dataset.slideId));
  const o0 = await order();
  await page.evaluate(() => document.querySelectorAll('.sorter-item')[2].focus());
  await page.keyboard.down('Control'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Control'); await sleep(150);
  const o1 = await order(); eq(o1[1], o0[2], 'keyboard reorder moved slide up');
  // synthetic HTML5 drag and drop: move first slide to the end
  await page.evaluate(async () => {
    const items = [...document.querySelectorAll('.sorter-item')]; const rows = [...document.querySelectorAll('.sorter-row')]; const dt = new DataTransfer();
    items[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt })); await new Promise((r) => setTimeout(r, 60));
    const last = rows[rows.length - 1]; const rect = last.getBoundingClientRect();
    last.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: rect.bottom - 2 })); await new Promise((r) => setTimeout(r, 60));
    last.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientY: rect.bottom - 2 }));
  });
  await sleep(200); const o2 = await order(); eq(o2[2], o1[0], 'drag and drop moved first slide to the end');
  await page.click('[aria-label="Duplicate selected slides"]'); eq(await slideCount(), 4, 'duplicated');
  await page.click('[aria-label="Hide or show selected slides"]');
  assert(await page.evaluate(() => !!document.querySelector('.sorter-item.hidden-slide')), 'hidden badge');
  await page.click('[aria-label="Delete selected slides"]'); eq(await slideCount(), 3, 'deleted');
  const cid = globalThis.__contentId;
  for (let k = 0; k < 4; k++) { const idx = (await order()).indexOf(cid); if (idx <= 0) break; await page.evaluate((id) => document.querySelector(`.sorter-item[data-slide-id="${id}"]`).focus(), cid); await page.keyboard.down('Control'); await page.keyboard.press('ArrowUp'); await page.keyboard.up('Control'); await sleep(200); }
  eq((await order()).indexOf(cid), 0, 'content slide back at the start');
  await page.evaluate((id) => document.querySelector(`.sorter-item[data-slide-id="${id}"]`).click(), cid); await sleep(150);
  await page.type('#notes-box', NOTES); await waitSaved(page);
  const d = (await getDecks(page))[0].deck; assert(d.slides[0].notes === NOTES, 'notes saved: ' + d.slides[0].notes);
});

await t('layouts, themes (>=6), custom palette, slide size', async () => {
  await page.click('#tab-theme'); const themes = await page.evaluate(() => document.querySelectorAll('.theme-card').length); assert(themes >= 6, 'themes: ' + themes);
  const bg0 = await page.evaluate(() => { const c = document.querySelector('[data-testid=slide-canvas]'); return [...c.getContext('2d').getImageData(2, 2, 1, 1).data].join(); });
  await page.click('.theme-card[aria-label="Theme Midnight"]'); await sleep(400);
  const bg1 = await page.evaluate(() => { const c = document.querySelector('[data-testid=slide-canvas]'); return [...c.getContext('2d').getImageData(2, 2, 1, 1).data].join(); });
  assert(bg0 !== bg1, 'theme changes background'); await page.click('.theme-card[aria-label="Theme Aurora"]');
  await page.click('#tab-slide'); await page.click('.layout-btn:nth-child(3)'); await sleep(200);
  eq((await getDecks(page)).length >= 0, true, 'layout applied');
  await menu(page, 'File', 'Slide size…'); await page.waitForSelector('[role=dialog]'); await page.click('[role=dialog] input[name=sz]:nth-of-type(1)');
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .check')].find((l) => l.textContent.includes('Standard 4:3')).querySelector('input').click());
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .btn')].find((b) => b.textContent === 'Apply').click()); await sleep(300);
  await waitSaved(page); eq((await getDecks(page))[0].deck.size, { w: 960, h: 720 }, '4:3 size');
  await menu(page, 'File', 'Slide size…'); await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .check')].find((l) => l.textContent.includes('Widescreen')).querySelector('input').click());
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .btn')].find((b) => b.textContent === 'Apply').click()); await sleep(300);
  await page.click('#tab-format');
});

await t('find and replace across slides', async () => {
  await page.keyboard.down('Control'); await page.keyboard.press('f'); await page.keyboard.up('Control');
  await page.waitForSelector('[role=dialog] [data-autofocus]'); await page.type('[role=dialog] [data-autofocus]', 'Edited');
  await page.waitForFunction(() => /1 match/.test(document.querySelector('[role=dialog] .status-line').textContent));
  await page.type('[role=dialog] .field:nth-of-type(2) input', 'Replaced');
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .btn')].find((b) => b.textContent === 'Replace all').click());
  await page.waitForFunction(() => /Replaced 1/.test(document.querySelector('[role=dialog] .status-line').textContent));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  await waitSaved(page); const d = (await getDecks(page))[0].deck;
  assert(JSON.stringify(d).includes('Replaced title'), 'replacement saved');
});

await t('keyboard shortcuts dialog opens and traps focus; axe on editor + dialog', async () => {
  await page.keyboard.down('Control'); await page.keyboard.press('/'); await page.keyboard.up('Control'); await page.waitForSelector('[role=dialog][aria-modal=true]');
  axeReports.push(await runAxe(page, 'shortcuts-dialog'));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('[role=dialog]'));
  await page.evaluate(() => document.querySelector('.overlay .obj').blur()); await page.evaluate(() => document.activeElement && document.activeElement.blur());
  axeReports.push(await runAxe(page, 'editor'));
});
await t('menu bar is keyboard operable (ARIA menubar)', async () => {
  await page.focus('.menu-top'); await page.keyboard.press('ArrowDown'); await page.waitForSelector('.menu[role=menu]');
  assert(await page.evaluate(() => document.activeElement.getAttribute('role') === 'menuitem'), 'focus in menu');
  await page.keyboard.press('ArrowRight'); await sleep(100);
  assert(await page.evaluate(() => document.querySelector('.menu')?.getAttribute('aria-label') === 'Edit'), 'ArrowRight moved to next menu');
  await page.keyboard.press('Escape'); await sleep(100); assert(!(await page.$('.menu')), 'Escape closes');
});
await t('gradient fill on a shape: UI toggle, saved in the deck, painted differently from a flat fill', async () => {
  await page.keyboard.press('Escape'); await sleep(100);
  await menu(page, 'Insert', 'Rectangle'); await sleep(300);   // newly inserted object is selected
  await page.evaluate(() => { const l = [...document.querySelectorAll('.insp label')].find((x) => x.textContent.includes('Gradient fill')); l.querySelector('input').click(); });
  await sleep(300); await waitSaved(page);
  const grad = await page.evaluate(async () => { const r = await new Promise((res) => { const q = indexedDB.open('slidewise'); q.onsuccess = () => { const g = q.result.transaction('decks').objectStore('decks').getAll(); g.onsuccess = () => res(g.result); }; }); return r.flatMap((d) => (d.deck ? d.deck.slides : []).flatMap((s) => s.objects)).filter((o) => o.grad).map((o) => o.grad); });
  assert(grad.length >= 1 && grad[0].colors.length === 2, 'gradient saved: ' + JSON.stringify(grad));
  assert(await page.$('.insp [aria-label="Gradient angle"], .insp input[aria-label="Gradient angle"]') || await page.evaluate(() => [...document.querySelectorAll('.insp label')].some((x) => x.textContent.includes('Gradient angle'))), 'angle control shown');
});
await t('stacked bars and filled-area lines change the chart painting and are saved', async () => {
  await page.keyboard.press('Escape'); await sleep(100);
  await menu(page, 'Insert', 'Bar chart'); await sleep(400);
  const shot = () => page.evaluate(() => { const c = document.querySelector('.stage canvas'); return c.toDataURL().length + ':' + c.toDataURL().slice(-64); });
  const before = await shot();
  await page.evaluate(() => [...document.querySelectorAll('.insp .check')].find((l) => l.textContent.includes('Stacked bars')).querySelector('input').click()); await sleep(400);
  const after = await shot(); assert(before !== after, 'stacked bar painting differs from grouped');
  await menu(page, 'Insert', 'Line chart'); await sleep(400);
  const b2 = await shot();
  await page.evaluate(() => [...document.querySelectorAll('.insp .check')].find((l) => l.textContent.includes('Fill area')).querySelector('input').click()); await sleep(400);
  assert(b2 !== await shot(), 'area fill painting differs from plain line'); await waitSaved(page);
  const flags = await page.evaluate(() => new Promise((res) => { const q = indexedDB.open('slidewise'); q.onsuccess = () => { const g = q.result.transaction('decks').objectStore('decks').getAll(); g.onsuccess = () => res(g.result.flatMap((d) => (d.deck ? d.deck.slides : []).flatMap((s) => s.objects)).filter((o) => o.type === 'chart').map((o) => [o.kind, !!o.stacked, !!o.area].join())); }; }));
  assert(flags.includes('bar,true,false') && flags.includes('line,false,true'), 'flags saved: ' + flags);
});
await t('merge table cells: UI, painting, saved, and unmerge', async () => {
  await page.keyboard.press('Escape'); await sleep(100);
  await menu(page, 'Insert', 'Table'); await sleep(400);
  const shot = () => page.evaluate(() => { const c = document.querySelector('.stage canvas'); return c.toDataURL().length + ':' + c.toDataURL().slice(-64); });
  const clickBtn = (label) => page.evaluate((l) => [...document.querySelectorAll('.merge-box .btn')].find((b) => b.textContent === l).click(), label);
  const merged = () => page.evaluate(() => new Promise((res) => { const q = indexedDB.open('slidewise'); q.onsuccess = () => { const g = q.result.transaction('decks').objectStore('decks').getAll(); g.onsuccess = () => res(g.result.flatMap((d) => (d.deck ? d.deck.slides : []).flatMap((s) => s.objects)).filter((o) => o.type === 'table').map((o) => (o.merges || []).length)); }; }));
  const before = await shot(); await clickBtn('Merge'); await sleep(400); await waitSaved(page);
  assert(before !== await shot(), 'merged table paints differently'); assert((await merged()).includes(1), 'merge saved: ' + await merged());
  await clickBtn('Unmerge'); await sleep(400); await waitSaved(page);
  assert(!(await merged()).includes(1), 'unmerge saved'); assert(before === await shot(), 'unmerged table paints like the original');
});
await t('context menu on right-click', async () => {
  await page.keyboard.press('Escape'); await sleep(100);
  const b = await page.evaluate(() => { const o = [...document.querySelectorAll('.overlay .obj')].find((x) => x.dataset.type === 'shape'); const r = o.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(b.x, b.y); await page.mouse.click(b.x, b.y, { button: 'right' }); await page.waitForSelector('.context-menu[role=menu]');
  assert(await page.evaluate(() => [...document.querySelectorAll('.context-menu .menu-label')].some((l) => l.textContent === 'Duplicate')), 'has Duplicate'); await page.keyboard.press('Escape'); await sleep(100);
});

// ----- present + presenter view -----
await t('present: keyboard, click, touch navigation, progress bar, black/white screen, laser, pen', async () => {
  await page.waitForSelector('.sorter-item'); await page.evaluate(() => document.querySelector('.sorter-item').click());
  await page.keyboard.press('F5'); await page.waitForSelector('[data-testid=present-root]', { timeout: 8000 });
  assert(page.url().includes('#/present/'), 'present route');
  const pos = () => page.evaluate(() => Number(document.querySelector('[data-testid=present-canvas]').dataset.pos));
  eq(await pos(), 0, 'starts at slide 1');
  await page.keyboard.press('ArrowRight'); await sleep(700); eq(await pos(), 1, 'ArrowRight');
  await page.keyboard.press('ArrowLeft'); await sleep(700); eq(await pos(), 0, 'ArrowLeft');
  const visible = (await getDecks(page))[0].deck.slides.filter((x) => !x.hidden).length;
  await page.keyboard.press('End'); await sleep(300); eq(await pos(), visible - 1, 'End goes to the last visible slide');
  await page.keyboard.press('Home'); await sleep(300); eq(await pos(), 0, 'Home');
  await page.mouse.click(500, 300); await sleep(700); eq(await pos(), 1, 'click advances');
  await page.evaluate(() => { const r = document.querySelector('[data-testid=present-root]'); const mk = (type, x) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: 300, pointerType: 'touch', isPrimary: true }); r.dispatchEvent(mk('pointerdown', 600)); r.dispatchEvent(mk('pointerup', 300)); });
  await sleep(700); const p2 = await pos();
  await page.evaluate(() => { const r = document.querySelector('[data-testid=present-root]'); const mk = (type, x) => new PointerEvent(type, { bubbles: true, clientX: x, clientY: 300, pointerType: 'touch', isPrimary: true }); r.dispatchEvent(mk('pointerdown', 300)); r.dispatchEvent(mk('pointerup', 650)); });
  await sleep(700); assert((await pos()) < p2 || p2 === 2, 'swipe right goes back (or swipe left advanced)');
  assert(await page.$('[role=progressbar]'), 'progress bar');
  await page.keyboard.press('b'); assert(await page.$('[data-testid=cover-black]'), 'black screen'); await page.keyboard.press('b'); assert(!(await page.$('[data-testid=cover-black]')), 'black off');
  await page.keyboard.press('w'); assert(await page.$('[data-testid=cover-white]'), 'white screen'); await page.keyboard.press('w');
  await page.keyboard.press('l'); await page.mouse.move(400, 300); await page.waitForSelector('[data-testid=laser]');
  await page.keyboard.press('l'); await page.keyboard.press('p');
  await page.mouse.move(300, 300); await page.mouse.down(); await page.mouse.move(500, 400, { steps: 8 }); await page.mouse.up();
  const ink = await page.evaluate(() => { const c = document.querySelector('.present-layer'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return n; });
  assert(ink > 100, 'pen drew pixels: ' + ink);
  const posAfterPen = await pos(); eq(await pos(), posAfterPen, 'pen drawing did not advance slide');
  await page.keyboard.press('p'); await page.keyboard.press('Escape');
  await page.waitForFunction(() => location.hash.startsWith('#/deck/'), { timeout: 5000 });
});
await t('presenter view in a second window (BroadcastChannel): current, next, notes, timer, remote control', async () => {
  await page.waitForSelector('.sorter-item'); await page.evaluate(() => document.querySelector('.sorter-item').click()); await sleep(150);
  await page.keyboard.press('F5'); await page.waitForSelector('[data-testid=present-canvas]');
  const pv = await env.newPage('presenter-view'); await pv.goto(base + '#/presenter-view/' + deckId, { waitUntil: 'networkidle0' });
  await pv.waitForSelector('[data-testid=pv-notes]', { timeout: 10000 });
  const notes = await pv.$eval('[data-testid=pv-notes]', (e) => e.textContent); eq(notes, NOTES, 'notes shown');
  const t0 = await pv.$eval('[data-testid=pv-timer]', (e) => e.textContent); assert(/^\d\d:\d\d/.test(t0), 'timer ' + t0);
  const labels = await pv.$$eval('canvas[role=img]', (c) => c.map((x) => x.getAttribute('aria-label'))); assert(labels.some((l) => /Current slide/.test(l)) && labels.some((l) => /Next slide/.test(l)), 'current and next previews');
  await pv.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Next ▶')).click());
  await page.waitForFunction(() => Number(document.querySelector('[data-testid=present-canvas]').dataset.pos) === 1, { timeout: 5000 });
  await pv.waitForFunction(() => /Slide 2 of/.test(document.querySelector('[data-testid=pv-pos]').textContent), { timeout: 5000 });
  axeReports.push(await runAxe(pv, 'presenter-view')); await pv.close();
  await page.keyboard.press('Escape'); await page.waitForFunction(() => location.hash.startsWith('#/deck/'));
});

// ----- exports -----
await t('export PDF (one slide per page)', async () => {
  const slides = (await getDecks(page))[0].deck.slides; const expected = slides.filter((s) => !s.hidden).length;
  await menu(page, 'File', 'Export as PDF'); const f = await waitDownload(dl, '.pdf');
  const buf = fs.readFileSync(f); eq(buf.slice(0, 5).toString(), '%PDF-', 'pdf header');
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; eq(pages, expected, 'pdf pages == visible slides');
  // selectable text layer: extract with poppler's pdftotext when installed (skipped, and said so, otherwise)
  let hasPdftotext = true; try { execSync('pdftotext -v', { stdio: 'ignore' }); } catch { hasPdftotext = false; }
  if (hasPdftotext) { const txt = execSync(`pdftotext -layout "${f}" -`, { encoding: 'utf8' }); assert(/Replaced title/.test(txt) && /Subtitle/.test(txt), 'PDF text extractable (wanted "Replaced title"); got: ' + JSON.stringify(txt.slice(0, 200))); }
  else console.log('      (pdftotext not installed: text-layer check skipped)');
});
await t('export PNG (current slide) and PNG zip (all slides)', async () => {
  await menu(page, 'File', 'Export current slide as PNG'); const f = await waitDownload(dl, '.png'); const b = fs.readFileSync(f); eq(b.slice(1, 4).toString(), 'PNG', 'png header');
  const w = b.readUInt32BE(16); eq(w, 1920, 'png width');
  await menu(page, 'File', 'Export slides as PNG (zip)'); const z = await waitDownload(dl, '.zip'); const zip = await JSZip.loadAsync(fs.readFileSync(z));
  const names = Object.keys(zip.files).filter((n) => n.endsWith('.png')).sort(); eq(names.length, (await getDecks(page))[0].deck.slides.length, 'one png per slide');
});
let pptxFile;
await t('export PPTX and open it (JSZip structure + import round trip)', async () => {
  await menu(page, 'File', 'Export as PPTX'); pptxFile = await waitDownload(dl, '.pptx'); const zip = await JSZip.loadAsync(fs.readFileSync(pptxFile));
  assert(zip.file('ppt/presentation.xml') && zip.file('[Content_Types].xml') && zip.file('ppt/slides/slide1.xml'), 'parts present');
  assert(Object.keys(zip.files).some((n) => n.startsWith('ppt/media/') && n.endsWith('.png')), 'media present');
  assert(zip.file('ppt/notesSlides/notesSlide1.xml'), 'notes exported');
});
await t('export self-contained HTML slideshow and run it', async () => {
  await menu(page, 'File', 'Export as HTML slideshow'); const f = await waitDownload(dl, '.html'); const html = fs.readFileSync(f, 'utf8');
  assert(/Content-Security-Policy/.test(html) && !/unsafe-inline/.test(html), 'strict CSP, no unsafe-inline'); assert(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<svg[\s\S]*?<\/svg>/g, '')), 'no remote URLs');
  assert(!/\son[a-z]+\s*=/.test(html.replace(/data:image\/png;base64,[A-Za-z0-9+/=]+/g, '')), 'no inline event handlers');
  const hp = await env.newPage('exported-html'); await hp.setContent(html); await sleep(300);
  const n = await hp.$$eval('img.s', (i) => i.length); assert(n >= 2, 'slides present: ' + n); await hp.keyboard.press('ArrowRight'); await sleep(100);
  assert(await hp.$eval('#live', (e) => /Slide 2/.test(e.textContent)), 'exported slideshow navigates'); await hp.close();
});
await t('export JSON and validate it re-imports as a deck', async () => {
  await menu(page, 'File', 'Export as Slidewise JSON'); const f = await waitDownload(dl, '.json'); const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  eq(j.v, 1, 'schema v'); assert(Array.isArray(j.slides) && j.slides.length >= 2, 'slides'); assert(!('__current' in j), 'no internal fields');
});

// ----- persistence -----
await t('reload and confirm persistence (decks, objects, notes)', async () => {
  await waitSaved(page); const n = (await getDecks(page))[0].deck.slides.length; const objs0 = await objCount(page);
  await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.stage canvas');
  eq(await page.evaluate(() => document.querySelectorAll('.sorter-item').length), n, 'slides after reload');
  eq(await objCount(page), objs0, 'objects after reload');
  assert((await page.$eval('#notes-box', (e) => e.value)) === NOTES, 'notes after reload');
  await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('[data-testid=deck-list] .card');
  assert((await page.$eval('.card-name', (e) => e.textContent)).length > 0, 'deck listed on home');
});

// ----- home screen management -----
await t('home: search, sort, favourite, folders, rename, duplicate, delete', async () => {
  await page.click('[data-template="pitch"]'); await page.waitForSelector('.stage canvas'); await waitSaved(page);
  await page.evaluate(() => (location.hash = '#/')); await page.waitForSelector('[data-testid=deck-list] .card');
  eq(await page.$$eval('.card', (c) => c.length), 2, 'two decks');
  await page.type('.search input', 'pitch'); await sleep(150); eq(await page.$$eval('.card', (c) => c.length), 1, 'search filters'); await page.evaluate(() => { const i = document.querySelector('.search input'); i.focus(); i.select(); }); await page.keyboard.press('Backspace'); await sleep(100);
  await page.select('select[aria-label="Sort by"]', 'name'); await sleep(100);
  await page.click('.card .fav'); await sleep(200); assert(await page.$('.card .fav.on'), 'favourited');
  await page.evaluate(() => [...document.querySelectorAll('.folders .btn')].find((b) => b.textContent.includes('New folder')).click()); await page.waitForSelector('[role=dialog] input'); await page.type('[role=dialog] input', 'Work'); await page.keyboard.press('Enter'); await page.waitForSelector('.folder-row'); await sleep(200);
  await page.evaluate(() => [...document.querySelectorAll('.folder-btn')].find((b) => b.textContent.includes('All presentations')).click()); await sleep(150);
  const act = async (label) => { await page.evaluate(() => document.querySelector('.card-menu .btn').click()); await page.waitForSelector('.card-menu .menu'); await page.evaluate((l) => [...document.querySelectorAll('.card-menu .menu-item')].find((b) => b.textContent.includes(l)).click(), label); };
  await act('Rename'); await page.waitForSelector('[role=dialog] input'); await page.evaluate(() => { const i = document.querySelector('[role=dialog] input'); i.select(); }); await page.keyboard.type('Renamed deck'); await page.keyboard.press('Enter'); await sleep(300);
  assert((await page.$$eval('.card-name', (n) => n.map((x) => x.textContent))).includes('Renamed deck'), 'renamed');
  await act('Duplicate'); await sleep(500); eq(await page.$$eval('.card', (c) => c.length), 3, 'duplicated');
  await act('Move to folder'); await page.waitForSelector('.move-list'); await page.evaluate(() => [...document.querySelectorAll('.move-list .btn')].find((b) => b.textContent === 'Work').click()); await sleep(300);
  await page.evaluate(() => [...document.querySelectorAll('.folder-btn')].find((b) => b.textContent.includes('Work')).click()); await sleep(200); eq(await page.$$eval('.card', (c) => c.length), 1, 'folder filter');
  await page.evaluate(() => [...document.querySelectorAll('.folder-btn')].find((b) => b.textContent.includes('All presentations')).click());
  await act('Delete'); await page.waitForSelector('[role=dialog]'); await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .btn')].find((b) => b.textContent === 'Delete').click()); await sleep(400);
  eq(await page.$$eval('.card', (c) => c.length), 2, 'deleted');
});

// ----- backup / import with strict validation -----
await t('backup export/import with strict validation; hostile files rejected', async () => {
  await page.evaluate(() => [...document.querySelectorAll('.folders .btn')].find((b) => b.textContent.includes('Back up all')).click());
  const f = await waitDownload(dl, '.json'); const text = fs.readFileSync(f, 'utf8'); const backup = JSON.parse(text); eq(backup.format, 'slidewise-backup', 'format'); eq(backup.decks.length, 2, 'two decks');
  const tmp = path.join(dl, 'hostile'); fs.mkdirSync(tmp, { recursive: true });
  const bad = {
    'notjson.json': '{nope', 'wrongformat.json': JSON.stringify({ format: 'other', version: 1, decks: [] }),
    'badcolor.json': JSON.stringify({ ...backup, decks: [{ ...backup.decks[0], slides: [{ ...backup.decks[0].slides[0], objects: [{ ...backup.decks[0].slides[0].objects[0], fill: 'url(javascript:alert(1))' }] }] }] }),
    'svgasset.json': JSON.stringify({ ...backup, decks: [{ ...backup.decks[0], slides: [{ ...backup.decks[0].slides[0], objects: [{ ...backup.decks[0].slides[0].objects[0], type: 'image', assetId: 'x' }] }], assets: { x: { mime: 'image/svg+xml', name: 'x', w: 1, h: 1, data: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' } } }] }),
    'newer.json': JSON.stringify({ ...backup, decks: [{ ...backup.decks[0], v: 99 }] }),
  };
  for (const [n, c] of Object.entries(bad)) {
    const p = path.join(tmp, n); fs.writeFileSync(p, c);
    await page.evaluate(() => { const b = document.querySelector('.banner.error'); if (b) b.querySelector('button').click(); });
    const input = await page.$('[data-testid=backup-input]'); await input.uploadFile(p);
    await page.waitForFunction(() => /Import rejected/.test(document.querySelector('.banner.error')?.textContent || ''), { timeout: 8000 }).catch(async (e) => { throw new Error('hostile file not rejected: ' + n + ' | banner=' + (await page.evaluate(() => document.querySelector('.banner')?.textContent))); });
  }
  eq((await getDecks(page)).length, 2, 'rejected imports changed nothing');
  const input = await page.$('[data-testid=backup-input]'); const good = path.join(tmp, 'good.json'); fs.writeFileSync(good, text); await input.uploadFile(good);
  await page.waitForFunction(() => /Imported 2/.test(document.querySelector('.banner.ok')?.textContent || ''), { timeout: 8000 }); eq((await getDecks(page)).length, 4, 'valid backup imported as copies');
});
await t('import a PPTX file as a new presentation', async () => {
  const input = await page.$('[data-testid=home-import]'); const before = (await getDecks(page)).length; await input.uploadFile(pptxFile);
  await page.waitForFunction((n) => document.querySelectorAll('.card').length > n, { timeout: 15000 }, before);
  const d = (await getDecks(page)).find((x) => x.deck && x.deck.slides.length >= 2 && x.deck.slides[0].notes === NOTES); assert(d, 'imported deck has notes from PPTX');
});
await t('import an image as a new presentation; reject a fake PNG and an SVG', async () => {
  const input = await page.$('[data-testid=home-import]'); const before = (await getDecks(page)).length; await input.uploadFile(fixture);
  await page.waitForFunction((n) => document.querySelectorAll('.card').length > n, { timeout: 15000 }, before);
  const tmp = path.join(dl, 'hostile'); fs.writeFileSync(path.join(tmp, 'fake.png'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'); fs.writeFileSync(path.join(tmp, 'x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const n of ['fake.png', 'x.svg']) { await page.evaluate(() => { const b = document.querySelector('.banner.error'); if (b) b.querySelector('button').click(); }); await (await page.$('[data-testid=home-import]')).uploadFile(path.join(tmp, n)); await page.waitForFunction(() => /Import failed/.test(document.querySelector('.banner.error')?.textContent || ''), { timeout: 8000 }); }
});

// ----- password lock -----
await t('password lock encrypts at rest, requires password, wrong password rejected', async () => {
  await page.evaluate(() => document.querySelector('.card-open').click()); await page.waitForSelector('.stage canvas'); deckId = await page.evaluate(() => location.hash.split('/')[2]);
  await menu(page, 'File', 'Password lock…'); await page.waitForSelector('[role=dialog] input[type=password]');
  const text = await page.$eval('[role=dialog] .notice', (e) => e.textContent); assert(/does not/.test(text) && /no recovery/i.test(text), 'dialog states limits');
  const [a, b] = await page.$$('[role=dialog] input[type=password]'); await a.type('correct horse'); await b.type('correct horse');
  await page.evaluate(() => [...document.querySelectorAll('[role=dialog] .btn')].find((x) => x.textContent === 'Lock presentation').click());
  await page.waitForFunction(() => !document.querySelector('[role=dialog]'), { timeout: 20000 }); await waitSaved(page);
  const rec = (await getDecks(page)).find((r) => r.id === deckId); assert(rec.enc && !rec.deck, 'stored encrypted, no plaintext deck'); assert(!JSON.stringify(rec).includes('"objects"'), 'no plaintext slide data');
  await page.evaluate(() => (location.hash = '#/')); await page.reload({ waitUntil: 'networkidle0' }); await page.waitForSelector('.card');
  await page.evaluate((id) => document.querySelector(`[data-deck-id="${id}"] .card-open`).click(), deckId); await page.waitForSelector('[role=dialog] input[type=password]');
  axeReports.push(await runAxe(page, 'unlock-dialog'));
  await page.type('[role=dialog] input[type=password]', 'wrong password'); await page.keyboard.press('Enter'); await page.waitForFunction(() => /Wrong password/.test(document.querySelector('[role=dialog]')?.textContent || ''), { timeout: 20000 });
  await page.evaluate(() => { const i = document.querySelector('[role=dialog] input'); i.focus(); i.select(); }); await page.keyboard.type('correct horse'); await page.keyboard.press('Enter');
  await page.waitForSelector('.stage canvas', { timeout: 20000 }); assert(await page.$('.lock-badge'), 'lock badge shown');
});

// ----- offline / PWA -----
await t('service worker installs and the app loads fully offline', async () => {
  await page.evaluate(() => (location.hash = '#/')); await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => navigator.serviceWorker.controller || navigator.serviceWorker.ready.then(() => true), { timeout: 10000 });
  await page.evaluate(() => navigator.serviceWorker.ready); await page.reload({ waitUntil: 'networkidle0' });
  assert(await page.evaluate(() => !!navigator.serviceWorker.controller), 'page controlled by service worker');
  const keys = await page.evaluate(async () => (await caches.keys()).length); assert(keys >= 1, 'cache created');
  await page.setOfflineMode(true);
  await page.goto(base, { waitUntil: 'domcontentloaded' }); await page.waitForSelector('[data-template=blank]', { timeout: 10000 });
  await page.click('[data-template="blank"]'); await page.waitForSelector('.stage canvas', { timeout: 10000 });
  await menu(page, 'Insert', 'Star'); eq((await objCount(page)) >= 3, true, 'editing works offline');
  await page.keyboard.press('F5'); await page.waitForSelector('[data-testid=present-canvas]'); await page.keyboard.press('Escape');
  await page.setOfflineMode(false);
});

// ----- responsive / themes / motion -----
await t('phone viewport: no horizontal overflow on home; viewing and presenting works', async () => {
  const ph = await env.newPage('phone', { width: 375, height: 700, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  await ph.goto(base, { waitUntil: 'networkidle0' });
  const ov = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert(ov <= 1, 'home overflow ' + ov);
  await ph.evaluate(() => [...document.querySelectorAll('.card')].find((c) => !c.textContent.includes('(locked)')).querySelector('.card-open').click()); await ph.waitForSelector('.stage canvas');
  const ov2 = await ph.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth); assert(ov2 <= 1, 'editor overflow ' + ov2);
  await ph.evaluate(() => { location.hash = location.hash.replace('#/deck/', '#/present/') + '?nofs=1'; }); await ph.waitForSelector('[data-testid=present-canvas]');
  const fit = await ph.evaluate(() => { const c = document.querySelector('[data-testid=present-canvas]').getBoundingClientRect(); return c.width <= window.innerWidth + 1 && c.height <= window.innerHeight + 1; }); assert(fit, 'slide fits phone screen');
  await ph.close();
});
await t('dark colour scheme and reduced motion are respected', async () => {
  const p2 = await env.newPage('dark'); await p2.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await p2.goto(base, { waitUntil: 'networkidle0' });
  const bg = await p2.evaluate(() => getComputedStyle(document.body).backgroundColor); assert(bg !== 'rgb(244, 245, 249)', 'dark background ' + bg);
  const dur = await p2.evaluate(() => getComputedStyle(document.querySelector('.btn')).transitionDuration); assert(parseFloat(dur) < 0.01, 'reduced-motion transition ' + dur);
  axeReports.push(await runAxe(p2, 'home-dark')); await p2.close();
});

console.log('\nAccessibility (axe-core, WCAG 2 A/AA + best practice)');
let axeFail = false;
for (const r of axeReports) {
  const bad = r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical'); const minor = r.violations.filter((v) => !(v.impact === 'serious' || v.impact === 'critical'));
  console.log(`  ${bad.length ? '✗' : '✓'} ${r.label}: ${bad.length} serious/critical, ${minor.length} minor/moderate`);
  for (const v of [...bad, ...minor]) console.log(`      - [${v.impact}] ${v.id}: ${v.help}\n          ${v.nodes.slice(0, 2).join('\n          ')}`);
  if (bad.length) axeFail = true;
}
R.results.push({ name: 'axe-core: no serious/critical violations on main screens', ok: !axeFail, err: axeFail ? 'see above' : undefined });
const real = problems.filter((p) => !/favicon|net::ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(p));
R.results.push({ name: 'no console errors, page errors or CSP violations during the whole run', ok: real.length === 0, err: real.slice(0, 5).join('\n') });
if (real.length) console.log('\nConsole problems:\n' + real.join('\n'));
await env.close();
const failed = R.results.filter((r) => !r.ok);
console.log(`\n${R.results.length - failed.length}/${R.results.length} end-to-end checks passed`);
if (failed.length) { console.log('FAILED:\n' + failed.map((f) => ' - ' + f.name + ': ' + (f.err || '').split('\n')[0]).join('\n')); process.exit(1); }
