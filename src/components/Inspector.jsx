import React, { useState } from 'react';
import { FONTS, FONT_KEYS, SHAPES, SHAPE_LABELS, LAYOUTS, LAYOUT_LABELS, TRANSITIONS, ANIM_TYPES, ANIM_DIRS, CHART_KINDS } from '../model/constants.js';
import { THEMES } from '../model/themes.js';
import { resolveColor } from '../render/theme.js';
import { safeLink } from '../model/text.js';
import { assetFromFile } from '../model/imageImport.js';
import { mergeRect, unmergeAt, normalizeMerges } from '../model/tableMerge.js';

export const COLOR_CHOICES = ['@text', '@bg', '@surface', '@muted', '@accent1', '@accent2', '@accent3', '@accent4', '@accent5', '@accent6'];
const toHex = (theme, v) => { const c = resolveColor(theme, v, '#000000'); return /^#[0-9a-f]{6}$/i.test(c) ? c : /^#[0-9a-f]{3}$/i.test(c) ? '#' + c.slice(1).split('').map((x) => x + x).join('') : '#000000'; };

export function ColorPicker({ label, value, theme, onChange, allowNone }) {
  const id = React.useId();
  return (
    <div className="field color-field" role="group" aria-label={label}>
      <span className="field-label">{label}</span>
      <div className="swatches">
        {allowNone && <button type="button" className={'swatch none' + (value === 'none' ? ' on' : '')} aria-label={`${label}: none`} aria-pressed={value === 'none'} onClick={() => onChange('none')} />}
        {COLOR_CHOICES.map((c) => <button type="button" key={c} className={'swatch' + (value === c ? ' on' : '')} style={{ background: resolveColor(theme, c) }} aria-label={`${label}: ${c.slice(1)}`} aria-pressed={value === c} onClick={() => onChange(c)} />)}
        <input id={id} type="color" className="swatch-custom" aria-label={`${label}: custom colour`} value={toHex(theme, value === 'none' ? '#ffffff' : value)} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
const Num = ({ label, value, onChange, min, max, step = 1, unit }) => (
  <label className="field"><span className="field-label">{label}</span><input type="number" value={Number.isFinite(value) ? Math.round(value * 100) / 100 : 0} min={min} max={max} step={step} onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))); }} />{unit && <span className="unit">{unit}</span>}</label>
);
const Range = ({ label, value, onChange, min, max, step = 1, fmt = (v) => v }) => (
  <label className="field"><span className="field-label">{label}</span><input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} aria-valuetext={String(fmt(value))} /><output>{fmt(value)}</output></label>
);
const Section = ({ title, children, defaultOpen = true }) => { const [o, setO] = useState(defaultOpen); return (<section className="insp-section"><button type="button" className="insp-head" aria-expanded={o} onClick={() => setO(!o)}>{title}<span aria-hidden="true">{o ? '▾' : '▸'}</span></button>{o && <div className="insp-body">{children}</div>}</section>); };

function TextSection({ o, ed, api, deck }) {
  const tx = o.tx; const t = deck.theme;
  const fmt = (f, key) => (ed.current && ed.current.editing ? ed.current.apply(f) : api.format(f, key));
  const [link, setLink] = useState('');
  const toggle = (k) => fmt({ [k]: 'toggle' });
  return (
    <Section title="Text">
      <div className="row">
        <label className="field grow"><span className="field-label">Font</span>
          <select value={tx.font} onChange={(e) => fmt({ font: e.target.value })} aria-label="Font family">
            <option value="@heading">Theme heading ({FONTS[t.fonts.heading].label})</option><option value="@body">Theme body ({FONTS[t.fonts.body].label})</option>
            {FONT_KEYS.map((k) => <option key={k} value={k}>{FONTS[k].label}</option>)}
          </select></label>
        <Num label="Size" value={tx.size} min={6} max={400} onChange={(v) => fmt({ size: v }, 'size')} />
      </div>
      <div className="row tool-row" role="group" aria-label="Character formatting">
        {[['b', 'B', 'Bold'], ['i', 'I', 'Italic'], ['u', 'U', 'Underline'], ['s', 'S', 'Strikethrough']].map(([k, l, n]) => <button key={k} type="button" data-keep-edit className={'btn icon fmt-' + k} aria-label={n} title={n} onMouseDown={(e) => e.preventDefault()} onClick={() => toggle(k)}>{l}</button>)}
      </div>
      <ColorPicker label="Text colour" value={tx.color} theme={t} onChange={(c) => fmt({ color: c })} />
      <ColorPicker label="Highlight" value="none" theme={t} allowNone onChange={(c) => fmt({ hl: c === 'none' ? null : c })} />
      <div className="row tool-row" role="group" aria-label="Paragraph">
        {[['left', '⯇', 'Align left'], ['center', '≡', 'Align centre'], ['right', '⯈', 'Align right'], ['justify', '☰', 'Justify']].map(([a, s, n]) => <button key={a} type="button" data-keep-edit className="btn icon" aria-label={n} title={n} aria-pressed={tx.align === a} onMouseDown={(e) => e.preventDefault()} onClick={() => fmt({ align: a })}>{s}</button>)}
        <button type="button" data-keep-edit className="btn icon" aria-label="Bulleted list" title="Bulleted list" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt({ list: ed.current?.editing ? 'toggle-bullet' : (tx.paras.every((p) => p.list === 'bullet') ? 'none' : 'bullet') })}>•</button>
        <button type="button" data-keep-edit className="btn icon" aria-label="Numbered list" title="Numbered list" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt({ list: ed.current?.editing ? 'toggle-number' : (tx.paras.every((p) => p.list === 'number') ? 'none' : 'number') })}>1.</button>
        {ed.current?.editing && <><button type="button" data-keep-edit className="btn icon" aria-label="Increase indent" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt({ indent: 1 })}>⇥</button><button type="button" data-keep-edit className="btn icon" aria-label="Decrease indent" onMouseDown={(e) => e.preventDefault()} onClick={() => fmt({ indent: -1 })}>⇤</button></>}
      </div>
      <div className="row">
        <label className="field grow"><span className="field-label">Vertical</span><select value={tx.valign} onChange={(e) => api.format({ valign: e.target.value })}><option value="top">Top</option><option value="middle">Middle</option><option value="bottom">Bottom</option></select></label>
        <Num label="Line spacing" value={tx.lineSpacing} min={0.8} max={3} step={0.1} onChange={(v) => api.format({ lineSpacing: v }, 'ls')} />
      </div>
      <label className="check"><input type="checkbox" checked={!!tx.autofit} onChange={(e) => api.format({ autofit: e.target.checked })} /> Shrink text on overflow (autofit)</label>
      <div className="row"><label className="field grow"><span className="field-label">Link (https:// or mailto:)</span><input type="url" data-keep-edit value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://example.com" /></label>
        <button type="button" className="btn" data-keep-edit onMouseDown={(e) => e.preventDefault()} onClick={() => { const l = safeLink(link); if (l) fmt({ link: l }); }} disabled={!safeLink(link)}>Apply</button>
        <button type="button" className="btn" data-keep-edit onMouseDown={(e) => e.preventDefault()} onClick={() => fmt({ link: null })}>Remove</button></div>
    </Section>
  );
}

function ChartData({ o, api }) {
  const set = (patch) => api.patch(patch);
  const setCell = (si, ci, v) => set({ series: o.series.map((s, i) => (i === si ? { ...s, values: s.values.map((x, j) => (j === ci ? (Number.isFinite(parseFloat(v)) ? parseFloat(v) : 0) : x)) } : s)) });
  return (
    <Section title="Chart data">
      <label className="field"><span className="field-label">Type</span><select value={o.kind} onChange={(e) => set({ kind: e.target.value, name: e.target.value + ' chart' })}>{CHART_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select></label>
      <label className="field"><span className="field-label">Title</span><input value={o.title} onChange={(e) => set({ title: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={o.legend} onChange={(e) => set({ legend: e.target.checked })} /> Show legend</label>
      {o.kind === 'bar' && <label className="check"><input type="checkbox" checked={!!o.stacked} onChange={(e) => set({ stacked: e.target.checked })} /> Stacked bars</label>}
      {o.kind === 'line' && <label className="check"><input type="checkbox" checked={!!o.area} onChange={(e) => set({ area: e.target.checked })} /> Fill area under lines</label>}
      <div className="table-scroll"><table className="data-table" aria-label="Chart data table">
        <thead><tr><th scope="col">Category</th>{o.series.map((s, si) => <th scope="col" key={si}><input aria-label={`Series ${si + 1} name`} value={s.name} onChange={(e) => set({ series: o.series.map((x, i) => (i === si ? { ...x, name: e.target.value } : x)) })} /></th>)}</tr></thead>
        <tbody>{o.categories.map((c, ci) => <tr key={ci}><th scope="row"><input aria-label={`Category ${ci + 1}`} value={c} onChange={(e) => set({ categories: o.categories.map((x, i) => (i === ci ? e.target.value : x)) })} /></th>{o.series.map((s, si) => <td key={si}><input type="number" aria-label={`${s.name}, ${c}`} value={s.values[ci]} onChange={(e) => setCell(si, ci, e.target.value)} /></td>)}</tr>)}</tbody>
      </table></div>
      <div className="row">
        <button type="button" className="btn" onClick={() => o.categories.length < 40 && set({ categories: [...o.categories, 'New'], series: o.series.map((s) => ({ ...s, values: [...s.values, 0] })) })}>+ Row</button>
        <button type="button" className="btn" disabled={o.categories.length <= 1} onClick={() => set({ categories: o.categories.slice(0, -1), series: o.series.map((s) => ({ ...s, values: s.values.slice(0, -1) })) })}>− Row</button>
        <button type="button" className="btn" onClick={() => o.series.length < 8 && set({ series: [...o.series, { name: 'Series ' + (o.series.length + 1), values: o.categories.map(() => 0) }] })}>+ Series</button>
        <button type="button" className="btn" disabled={o.series.length <= 1} onClick={() => set({ series: o.series.slice(0, -1) })}>− Series</button>
      </div>
    </Section>
  );
}
function TableSection({ o, api, theme }) {
  const set = (patch) => api.patch(patch);
  const resize = (rows, cols) => {
    rows = Math.max(1, Math.min(30, rows)); cols = Math.max(1, Math.min(12, cols));
    const cells = Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => (o.cells[r] && o.cells[r][c]) || ''));
    set({ rows, cols, cells, merges: normalizeMerges(o.merges, rows, cols), colW: Array(cols).fill(1 / cols), h: o.h / o.rows * rows });
  };
  const [mg, setMg] = useState({ r: 1, c: 1, rs: 1, cs: 2 });
  const mset = (k) => (v) => setMg((x) => ({ ...x, [k]: Math.max(1, Math.round(v) || 1) }));
  return (
    <Section title="Table">
      <div className="row"><Num label="Rows" value={o.rows} min={1} max={30} onChange={(v) => resize(Math.round(v), o.cols)} /><Num label="Columns" value={o.cols} min={1} max={12} onChange={(v) => resize(o.rows, Math.round(v))} /></div>
      <fieldset className="merge-box"><legend>Merge cells</legend>
        <div className="row"><Num label="Start row" value={mg.r} min={1} max={o.rows} onChange={mset('r')} /><Num label="Start column" value={mg.c} min={1} max={o.cols} onChange={mset('c')} /></div>
        <div className="row"><Num label="Rows to span" value={mg.rs} min={1} max={o.rows} onChange={mset('rs')} /><Num label="Columns to span" value={mg.cs} min={1} max={o.cols} onChange={mset('cs')} /></div>
        <div className="row"><button type="button" className="btn" onClick={() => set({ merges: mergeRect(o, mg.r - 1, mg.c - 1, mg.rs, mg.cs) })}>Merge</button>
          <button type="button" className="btn" onClick={() => set({ merges: unmergeAt(o, mg.r - 1, mg.c - 1) })}>Unmerge</button></div>
        {(o.merges || []).length > 0 && <p className="muted small">{o.merges.length} merged area{o.merges.length === 1 ? '' : 's'}. Text in covered cells is hidden, not deleted.</p>}
      </fieldset>
      <label className="check"><input type="checkbox" checked={o.tstyle.headerRow} onChange={(e) => set({ tstyle: { ...o.tstyle, headerRow: e.target.checked } })} /> Header row</label>
      <label className="check"><input type="checkbox" checked={o.tstyle.zebra} onChange={(e) => set({ tstyle: { ...o.tstyle, zebra: e.target.checked } })} /> Banded rows</label>
      <Num label="Text size" value={o.tstyle.size} min={8} max={100} onChange={(v) => set({ tstyle: { ...o.tstyle, size: v } })} />
      <ColorPicker label="Header colour" value={o.tstyle.headerFill} theme={theme} onChange={(c) => set({ tstyle: { ...o.tstyle, headerFill: c } })} />
      <div className="table-scroll"><table className="data-table" aria-label="Table contents"><tbody>{o.cells.map((row, r) => <tr key={r}>{row.map((c, ci) => <td key={ci}><input aria-label={`Row ${r + 1}, column ${ci + 1}`} value={c} onChange={(e) => set({ cells: o.cells.map((rr, i) => (i === r ? rr.map((x, j) => (j === ci ? e.target.value : x)) : rr)) })} /></td>)}</tr>)}</tbody></table></div>
    </Section>
  );
}
function ImageSection({ o, api, deck }) {
  const c = o.crop, a = o.adjust;
  const setCrop = (p) => { const n = { ...c, ...p }; n.x = Math.min(0.95, Math.max(0, n.x)); n.y = Math.min(0.95, Math.max(0, n.y)); n.w = Math.min(1 - n.x, Math.max(0.05, n.w)); n.h = Math.min(1 - n.y, Math.max(0.05, n.h)); const asset = deck.assets[o.assetId]; const ar = asset ? (asset.w * n.w) / (asset.h * n.h) : o.w / o.h; api.patch({ crop: n, h: o.w / ar }, 'crop'); };
  const pc = (v) => Math.round(v * 100);
  return (<>
    <Section title="Image">
      <label className="field"><span className="field-label">Alt text (describes the image for screen readers)</span><textarea rows={3} value={o.alt} onChange={(e) => api.patch({ alt: e.target.value }, 'alt')} /></label>
      <label className="field"><span className="field-label">Replace image</span><input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async (e) => { const f = e.target.files[0]; if (!f) return; try { const { id, asset } = await assetFromFile(f); api.replaceDeck({ ...deck, assets: { ...deck.assets, [id]: asset }, slides: deck.slides.map((s) => ({ ...s, objects: s.objects.map((x) => (x.id === o.id ? { ...x, assetId: id } : x)) })) }); } catch (er) { alert(er.message); } e.target.value = ''; }} /></label>
    </Section>
    <Section title="Crop and adjust">
      <Range label="Crop left" value={c.x} min={0} max={0.9} step={0.01} fmt={pc} onChange={(v) => setCrop({ x: v, w: Math.min(c.w, 1 - v) })} />
      <Range label="Crop top" value={c.y} min={0} max={0.9} step={0.01} fmt={pc} onChange={(v) => setCrop({ y: v, h: Math.min(c.h, 1 - v) })} />
      <Range label="Crop width" value={c.w} min={0.05} max={1 - c.x} step={0.01} fmt={pc} onChange={(v) => setCrop({ w: v })} />
      <Range label="Crop height" value={c.h} min={0.05} max={1 - c.y} step={0.01} fmt={pc} onChange={(v) => setCrop({ h: v })} />
      <Range label="Brightness" value={a.brightness} min={20} max={200} onChange={(v) => api.patch({ adjust: { ...a, brightness: v } }, 'adj')} fmt={(v) => v + '%'} />
      <Range label="Contrast" value={a.contrast} min={20} max={200} onChange={(v) => api.patch({ adjust: { ...a, contrast: v } }, 'adj')} fmt={(v) => v + '%'} />
      <Range label="Saturation" value={a.saturation} min={0} max={200} onChange={(v) => api.patch({ adjust: { ...a, saturation: v } }, 'adj')} fmt={(v) => v + '%'} />
      <Range label="Grayscale" value={a.grayscale} min={0} max={100} onChange={(v) => api.patch({ adjust: { ...a, grayscale: v } }, 'adj')} fmt={(v) => v + '%'} />
      <button type="button" className="btn" onClick={() => api.patch({ crop: { x: 0, y: 0, w: 1, h: 1 }, adjust: { brightness: 100, contrast: 100, saturation: 100, grayscale: 0 } })}>Reset crop and adjustments</button>
    </Section>
  </>);
}

export function FormatPanel({ deck, slide, selObjs, api, ed }) {
  const t = deck.theme;
  if (!selObjs.length) return <p className="hint">Select an object to format it. Double-click a text box, or press Enter, to edit its text.</p>;
  const o = selObjs[0]; const multi = selObjs.length > 1;
  const same = (k) => selObjs.every((x) => JSON.stringify(x[k]) === JSON.stringify(o[k]));
  const textual = selObjs.every((x) => x.tx);
  const styled = selObjs.every((x) => x.type === 'shape' || x.type === 'text');
  return (
    <div className="insp">
      <Section title={multi ? `${selObjs.length} objects` : (o.name || o.type)} defaultOpen>
        {!multi && <label className="field"><span className="field-label">Name (read by screen readers)</span><input value={o.name || ''} onChange={(e) => api.patch({ name: e.target.value }, 'name')} /></label>}
        {!multi && o.type === 'shape' && <label className="field"><span className="field-label">Shape</span><select value={o.shape} onChange={(e) => api.patch({ shape: e.target.value, ...(e.target.value === 'line' ? { h: 0, fill: 'none', stroke: { ...o.stroke, width: Math.max(2, o.stroke.width) } } : o.shape === 'line' ? { h: 140, fill: '@accent1' } : {}) })}>{SHAPES.map((s) => <option key={s} value={s}>{SHAPE_LABELS[s]}</option>)}</select></label>}
        {!multi && <div className="grid2"><Num label="X" value={o.x} onChange={(v) => api.patch({ x: v }, 'pos')} /><Num label="Y" value={o.y} onChange={(v) => api.patch({ y: v }, 'pos')} /><Num label="Width" value={o.w} min={1} onChange={(v) => api.patch({ w: v }, 'size')} /><Num label="Height" value={o.h} min={0} onChange={(v) => api.patch({ h: v }, 'size')} /></div>}
        {!multi && <Num label="Rotation" value={o.rot || 0} min={-360} max={360} unit="°" onChange={(v) => api.patch({ rot: v }, 'rot')} />}
        <Range label="Opacity" value={o.opacity ?? 1} min={0} max={1} step={0.05} fmt={(v) => Math.round(v * 100) + '%'} onChange={(v) => api.patch({ opacity: v }, 'opacity')} />
        <label className="check"><input type="checkbox" checked={selObjs.every((x) => x.locked)} onChange={() => api.toggleLock()} /> Lock position and size</label>
      </Section>
      {!multi && o.type === 'text' && o.role && null}
      {textual && <TextSection o={o} ed={ed} api={api} deck={deck} />}
      {styled && (
        <Section title="Fill, border, shadow">
          <ColorPicker label="Fill" value={same('fill') ? o.fill : ''} theme={t} allowNone onChange={(c) => api.patch((x) => ({ fill: c, ...(x.grad ? { grad: { ...x.grad, colors: [c, x.grad.colors[1]] } } : {}) }), 'fill')} />
          {!multi && o.type === 'shape' && o.shape !== 'line' && (
            <div className="row">
              <label className="field"><input type="checkbox" checked={!!o.grad} onChange={(e) => api.patch(e.target.checked ? { grad: { colors: [o.fill && o.fill !== 'none' ? o.fill : '@accent1', '@accent2'], angle: 90 } } : { grad: null }, 'grad')} /> <span className="field-label">Gradient fill</span></label>
              {o.grad && <><ColorPicker label="Gradient end colour" value={o.grad.colors[1]} theme={t} onChange={(c) => api.patch((x) => ({ grad: { ...x.grad, colors: [x.grad.colors[0], c] } }), 'grad')} />
                <Num label="Gradient angle" value={o.grad.angle} min={-360} max={360} onChange={(v) => api.patch((x) => ({ grad: { ...x.grad, angle: v } }), 'gradangle')} /></>}
            </div>)}
          <ColorPicker label="Border colour" value={o.stroke.color} theme={t} onChange={(c) => api.patch((x) => ({ stroke: { ...x.stroke, color: c } }), 'stroke')} />
          <div className="row"><Num label="Border width" value={o.stroke.width} min={0} max={60} onChange={(v) => api.patch((x) => ({ stroke: { ...x.stroke, width: v } }), 'sw')} />
            <label className="field grow"><span className="field-label">Style</span><select value={o.stroke.dash} onChange={(e) => api.patch((x) => ({ stroke: { ...x.stroke, dash: e.target.value } }))}><option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option></select></label></div>
          {(o.shape === 'rect' || o.shape === 'roundRect' || o.type === 'text') && <Num label="Corner radius" value={o.radius || 0} min={0} max={400} onChange={(v) => api.patch((x) => (x.shape === 'rect' && v > 0 ? { radius: v, shape: 'roundRect' } : { radius: v }), 'radius')} />}
          <label className="check"><input type="checkbox" checked={o.shadow.on} onChange={(e) => api.patch((x) => ({ shadow: { ...x.shadow, on: e.target.checked } }))} /> Drop shadow</label>
          {o.shadow.on && <div className="grid2"><Num label="Offset X" value={o.shadow.x} min={-100} max={100} onChange={(v) => api.patch((x) => ({ shadow: { ...x.shadow, x: v } }), 'shx')} /><Num label="Offset Y" value={o.shadow.y} min={-100} max={100} onChange={(v) => api.patch((x) => ({ shadow: { ...x.shadow, y: v } }), 'shy')} /><Num label="Blur" value={o.shadow.blur} min={0} max={100} onChange={(v) => api.patch((x) => ({ shadow: { ...x.shadow, blur: v } }), 'shb')} /></div>}
        </Section>
      )}
      {!multi && o.type === 'image' && <ImageSection o={o} api={api} deck={deck} />}
      {!multi && o.type === 'image' && <Section title="Border and shadow"><Num label="Corner radius" value={o.radius || 0} min={0} max={800} onChange={(v) => api.patch({ radius: v }, 'radius')} /><Num label="Border width" value={o.stroke.width} min={0} max={40} onChange={(v) => api.patch((x) => ({ stroke: { ...x.stroke, width: v } }), 'sw')} /><ColorPicker label="Border colour" value={o.stroke.color} theme={t} onChange={(c) => api.patch((x) => ({ stroke: { ...x.stroke, color: c } }))} /><label className="check"><input type="checkbox" checked={o.shadow.on} onChange={(e) => api.patch((x) => ({ shadow: { ...x.shadow, on: e.target.checked } }))} /> Drop shadow</label></Section>}
      {!multi && o.type === 'table' && <TableSection o={o} api={api} theme={t} />}
      {!multi && o.type === 'chart' && <ChartData o={o} api={api} />}
      <Section title="Animation" defaultOpen={false}>
        <label className="field"><span className="field-label">Entrance</span><select value={o.anim.type} onChange={(e) => api.patch((x) => ({ anim: { ...x.anim, type: e.target.value, order: x.anim.order || Math.max(0, ...slide.objects.map((y) => y.anim.order || 0)) + 1 } }))}>{ANIM_TYPES.map((a) => <option key={a} value={a}>{a === 'none' ? 'None' : a[0].toUpperCase() + a.slice(1)}</option>)}</select></label>
        {o.anim.type === 'slide' && <label className="field"><span className="field-label">Direction</span><select value={o.anim.dir} onChange={(e) => api.patch((x) => ({ anim: { ...x.anim, dir: e.target.value } }))}>{ANIM_DIRS.map((a) => <option key={a} value={a}>From {a}</option>)}</select></label>}
        {o.anim.type !== 'none' && <><Num label="Order (1 = first click)" value={o.anim.order} min={1} max={500} onChange={(v) => api.patch((x) => ({ anim: { ...x.anim, order: Math.round(v) } }), 'order')} /><Num label="Duration (ms)" value={o.anim.duration} min={50} max={5000} step={50} onChange={(v) => api.patch((x) => ({ anim: { ...x.anim, duration: v } }), 'dur')} /></>}
        <p className="hint">Objects with the same order appear together on the same click.</p>
      </Section>
    </div>
  );
}

export function SlidePanel({ deck, slide, api }) {
  const t = deck.theme;
  const ordered = slide.objects.filter((o) => o.anim.type !== 'none').sort((a, b) => a.anim.order - b.anim.order);
  return (
    <div className="insp">
      <Section title="Layout">
        <div className="layout-grid">{LAYOUTS.map((l) => <button type="button" key={l} className={'btn layout-btn' + (slide.layout === l ? ' on' : '')} aria-pressed={slide.layout === l} onClick={() => api.applyLayout(l)}>{LAYOUT_LABELS[l]}</button>)}</div>
        <p className="hint">Applying a layout keeps your text and moves it into the new placeholders.</p>
      </Section>
      <Section title="Background">
        <label className="check"><input type="checkbox" checked={!!slide.background} onChange={(e) => api.setSlideProps({ background: e.target.checked ? { color: '@surface' } : null })} /> Override the theme background on this slide</label>
        {slide.background && <ColorPicker label="Slide background" value={slide.background.color} theme={t} onChange={(c) => api.setSlideProps({ background: { color: c } })} />}
      </Section>
      <Section title="Transition">
        <label className="field"><span className="field-label">Transition to this slide</span><select value={slide.transition.type} onChange={(e) => api.setSlideProps({ transition: { ...slide.transition, type: e.target.value } })}>{TRANSITIONS.map((a) => <option key={a} value={a}>{a === 'none' ? 'None' : a[0].toUpperCase() + a.slice(1)}</option>)}</select></label>
        {slide.transition.type !== 'none' && <Num label="Duration (ms)" value={slide.transition.duration} min={100} max={3000} step={50} onChange={(v) => api.setSlideProps({ transition: { ...slide.transition, duration: v } })} />}
        <button type="button" className="btn" onClick={() => api.replaceDeck({ ...deck, slides: deck.slides.map((s) => ({ ...s, transition: { ...slide.transition } })) })}>Apply to all slides</button>
      </Section>
      <Section title="Animation order">
        {ordered.length ? <ol className="anim-list">{ordered.map((o) => <li key={o.id}><button type="button" className="link-btn" onClick={() => api.setSel([o.id])}>{o.anim.order}. {o.name || o.type}</button> <span className="muted">{o.anim.type}</span></li>)}</ol> : <p className="hint">No animations on this slide. Select an object and choose an entrance effect.</p>}
      </Section>
      <label className="check"><input type="checkbox" checked={slide.hidden} onChange={() => api.toggleHidden([slide.id])} /> Hide this slide in the slideshow</label>
    </div>
  );
}

export function ThemePanel({ deck, api }) {
  const t = deck.theme;
  const keys = ['bg', 'surface', 'text', 'muted', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  const labels = { bg: 'Background', surface: 'Surface', text: 'Text', muted: 'Muted text', accent1: 'Accent 1', accent2: 'Accent 2', accent3: 'Accent 3', accent4: 'Accent 4', accent5: 'Accent 5', accent6: 'Accent 6' };
  return (
    <div className="insp">
      <Section title="Theme (slide master)">
        <div className="theme-grid">{THEMES.map((th) => (
          <button type="button" key={th.id} className={'theme-card' + (t.id === th.id ? ' on' : '')} aria-pressed={t.id === th.id} onClick={() => api.setTheme(th.id)} aria-label={`Theme ${th.name}`}>
            <span className="theme-swatch" style={{ background: th.background.type === 'gradient' ? `linear-gradient(135deg, ${th.background.colors[0]}, ${th.background.colors[1]})` : th.colors.bg }}>
              <span style={{ background: th.colors.accent1 }} /><span style={{ background: th.colors.accent2 }} /><span style={{ background: th.colors.accent3 }} />
            </span><span className="theme-name">{th.name}</span>
          </button>))}
        </div>
        <p className="hint">The master defines fonts, colours and the background once; every slide follows it.</p>
      </Section>
      <Section title="Fonts">
        <label className="field"><span className="field-label">Heading font</span><select value={t.fonts.heading} onChange={(e) => api.setThemePart({ fonts: { ...t.fonts, heading: e.target.value } })}>{FONT_KEYS.map((k) => <option key={k} value={k}>{FONTS[k].label}</option>)}</select></label>
        <label className="field"><span className="field-label">Body font</span><select value={t.fonts.body} onChange={(e) => api.setThemePart({ fonts: { ...t.fonts, body: e.target.value } })}>{FONT_KEYS.map((k) => <option key={k} value={k}>{FONTS[k].label}</option>)}</select></label>
      </Section>
      <Section title="Custom colour palette">
        <div className="palette">{keys.map((k) => <label key={k} className="palette-item"><input type="color" value={toHex(t, t.colors[k])} onChange={(e) => api.setPalette(k, e.target.value)} aria-label={labels[k]} /><span>{labels[k]}</span></label>)}</div>
        <label className="field"><span className="field-label">Background style</span><select value={t.background.type} onChange={(e) => api.setThemePart({ background: e.target.value === 'solid' ? { type: 'solid', color: '@bg' } : { type: 'gradient', colors: [t.colors.bg, t.colors.surface], angle: 135 } })}><option value="solid">Solid (background colour)</option><option value="gradient">Gradient (background → surface)</option></select></label>
      </Section>
    </div>
  );
}
