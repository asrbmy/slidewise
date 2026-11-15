import React, { useEffect, useRef } from 'react';
import { buildEditorDom, domToParas, sanitizePastedHtml } from '../editor/richtext.js';
import { layoutText } from '../render/textLayout.js';
import { measurer } from '../render/canvasRender.js';
import { resolveColor, fontStack } from '../render/theme.js';
import { FONTS } from '../model/constants.js';
import { safeLink } from '../model/text.js';

// Inline rich-text editor over a text-bearing object. The DOM is built imperatively (uncontrolled) and parsed back to model runs on exit.
export default function TextEditor({ obj, deck, bridge, onDone }) {
  const rootRef = useRef(null);
  const scaleRef = useRef(1);
  const rangeRef = useRef(null);
  const tx = obj.tx, theme = deck.theme;

  useEffect(() => {
    const root = rootRef.current;
    const res = layoutText(tx, obj.w, obj.h, theme, measurer());
    scaleRef.current = tx.autofit ? res.scale : 1;
    buildEditorDom(root, tx, theme, scaleRef.current);
    root.focus();
    const sel = window.getSelection(); const range = document.createRange(); range.selectNodeContents(root); range.collapse(false); sel.removeAllRanges(); sel.addRange(range);
    const save = () => { const s = window.getSelection(); if (s.rangeCount && root.contains(s.anchorNode)) rangeRef.current = s.getRangeAt(0).cloneRange(); };
    document.addEventListener('selectionchange', save);
    // Only restore the remembered selection when focus/selection has moved out of the editor (e.g. after a toolbar click);
    // while the user is typing, the live selection is authoritative and a stale copy would clobber it.
    const restore = () => {
      const s = window.getSelection();
      if (s.rangeCount && root.contains(s.anchorNode) && document.activeElement === root) return;
      root.focus();
      if (rangeRef.current) { s.removeAllRanges(); s.addRange(rangeRef.current); }
    };
    const blocksInSelection = () => {
      const kids = Array.from(root.children);
      const s = window.getSelection(); if (!s.rangeCount) return kids.slice(0, 1);
      const r = s.getRangeAt(0);
      const hit = kids.filter((k) => r.intersectsNode(k));
      return hit.length ? hit : kids.slice(0, 1);
    };
    const fixSizes = () => {
      root.querySelectorAll('font[size="7"], [style*="xxx-large"]').forEach((el) => { el.removeAttribute('size'); el.style.fontSize = (bridge.current._pendingSize * scaleRef.current) + 'px'; });
      root.querySelectorAll('[style*="sw-"]').forEach((el) => { const m = /sw-(\w+)/.exec(el.style.fontFamily || ''); if (m && FONTS[m[1]]) { el.dataset.f = m[1]; el.style.fontFamily = FONTS[m[1]].stack; } });
    };
    const exec = (cmd, val) => { restore(); document.execCommand('styleWithCSS', false, true); const ok = document.execCommand(cmd, false, val); fixSizes(); return ok; };
    bridge.current = {
      editing: true, objId: obj.id, _pendingSize: 28,
      apply(fmt) {
        restore();
        for (const [k, cmd] of [['b', 'bold'], ['i', 'italic'], ['u', 'underline'], ['s', 'strikeThrough']]) if (k in fmt) exec(cmd);
        if ('color' in fmt) exec('foreColor', resolveColor(theme, fmt.color));
        if ('hl' in fmt) { if (fmt.hl) exec('hiliteColor', resolveColor(theme, fmt.hl)); else exec('hiliteColor', 'transparent'); }
        if ('size' in fmt) { bridge.current._pendingSize = fmt.size; exec('fontSize', '7'); }
        if ('font' in fmt && FONTS[fmt.font]) exec('fontName', 'sw-' + fmt.font);
        if ('link' in fmt) { if (fmt.link) { const l = safeLink(fmt.link); if (l) exec('createLink', l); } else exec('unlink'); }
        if ('align' in fmt) blocksInSelection().forEach((b) => { b.dataset.align = fmt.align; });
        if ('list' in fmt) blocksInSelection().forEach((b) => { if (fmt.list === 'none') delete b.dataset.list; else b.dataset.list = fmt.list === 'toggle-bullet' ? (b.dataset.list === 'bullet' ? 'none' : 'bullet') : fmt.list === 'toggle-number' ? (b.dataset.list === 'number' ? 'none' : 'number') : fmt.list; if (b.dataset.list === 'none') delete b.dataset.list; });
        if ('indent' in fmt) blocksInSelection().forEach((b) => { const v = Math.max(0, Math.min(8, (parseInt(b.dataset.indent, 10) || 0) + fmt.indent)); if (v) b.dataset.indent = String(v); else delete b.dataset.indent; });
        window.dispatchEvent(new Event('sw-format-changed'));
      },
      state(cmd) { try { return document.queryCommandState(cmd); } catch { return false; } },
      commit() { return domToParas(root, scaleRef.current); },
    };
    return () => { document.removeEventListener('selectionchange', save); bridge.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj.id]);

  const finish = (cancel) => {
    const root = rootRef.current;
    onDone(cancel ? null : domToParas(root, scaleRef.current));
  };
  const onBlur = (e) => {
    const next = e.relatedTarget;
    if (next && next.closest && next.closest('[data-keep-edit]')) return;
    // clicking a toolbar button without focus change: relatedTarget is null but the active element is inside the keep-edit zone
    setTimeout(() => { const ae = document.activeElement; if (ae && ae.closest && ae.closest('[data-keep-edit]')) return; if (rootRef.current && document.activeElement !== rootRef.current) finish(false); }, 0);
  };
  const onKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); finish(false); return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === 'b' || k === 'i' || k === 'u') { e.preventDefault(); bridge.current.apply({ [k]: true }); }
    }
  };
  const onPaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData.getData('text/html'), plain = e.clipboardData.getData('text/plain');
    if (html) { const clean = sanitizePastedHtml(html); document.execCommand('insertHTML', false, clean); }
    else if (plain) document.execCommand('insertText', false, plain);
  };
  const size = tx.size * scaleRef.current;
  const justify = tx.valign === 'middle' ? 'center' : tx.valign === 'bottom' ? 'flex-end' : 'flex-start';
  return (
    <div className="sw-edit-frame" style={{ justifyContent: justify, padding: tx.padding }}>
      <div
        ref={rootRef}
        className="sw-edit"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={`Editing ${obj.name || 'text'}`}
        spellCheck
        onBlur={onBlur}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{ fontFamily: fontStack(theme, tx.font), fontSize: size, color: resolveColor(theme, tx.color), lineHeight: tx.lineSpacing, textAlign: tx.align }}
      />
    </div>
  );
}
