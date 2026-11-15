import { parasToPlain } from '../model/text.js';
import { SHAPE_LABELS } from '../model/constants.js';
const clip = (s, n = 60) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
export function describeObject(o) {
  switch (o.type) {
    case 'text': { const t = parasToPlain(o.tx.paras).replace(/\s+/g, ' ').trim(); return `${o.role ? o.role[0].toUpperCase() + o.role.slice(1) + ' placeholder' : 'Text box'}${t ? ': ' + clip(t) : ', empty'}`; }
    case 'shape': { const t = parasToPlain(o.tx.paras).trim(); return `${SHAPE_LABELS[o.shape] || 'Shape'}${t ? ' with text: ' + clip(t) : ''}`; }
    case 'image': return `Image${o.alt ? ': ' + clip(o.alt) : ' (no alt text)'}`;
    case 'table': return `Table, ${o.rows} rows by ${o.cols} columns`;
    case 'chart': return `${o.kind[0].toUpperCase() + o.kind.slice(1)} chart${o.title ? ': ' + clip(o.title) : ''}`;
    case 'group': return `Group of ${o.children.length} objects`;
    default: return 'Object';
  }
}
export function slideTitle(slide) {
  const t = slide.objects.find((o) => o.role === 'title');
  const txt = t ? parasToPlain(t.tx.paras).trim() : '';
  if (txt) return clip(txt, 50);
  const any = slide.objects.find((o) => o.tx && parasToPlain(o.tx.paras).trim());
  return any ? clip(parasToPlain(any.tx.paras).trim(), 50) : 'Untitled slide';
}
