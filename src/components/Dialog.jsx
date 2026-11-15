import React, { useEffect, useRef, useState } from 'react';

// Accessible modal: role=dialog, aria-modal, focus trap, Escape to close, focus returns to the opener.
export default function Dialog({ title, onClose, children, wide, footer }) {
  const ref = useRef(null);
  const opener = useRef(document.activeElement);
  const idRef = useRef('dlg-' + Math.random().toString(36).slice(2, 8));
  const bodyRef = useRef(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => { const b = bodyRef.current; if (!b) return undefined; const chk = () => setScrollable(b.scrollHeight > b.clientHeight + 1); chk(); const ro = new ResizeObserver(chk); ro.observe(b); return () => ro.disconnect(); }, []);
  useEffect(() => {
    const el = ref.current;
    const focusables = () => Array.from(el.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')).filter((n) => n.offsetParent !== null || n === document.activeElement);
    (el.querySelector('[data-autofocus]') || focusables()[0] || el).focus();
    const key = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      else if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    el.addEventListener('keydown', key);
    const op = opener.current;
    return () => { el.removeEventListener('keydown', key); if (op && op.focus && document.contains(op)) op.focus(); };
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={idRef.current} ref={ref} tabIndex={-1}>
        <div className="dialog-head"><h2 id={idRef.current}>{title}</h2><button type="button" className="btn icon" onClick={onClose} aria-label="Close dialog">✕</button></div>
        <div className="dialog-body" ref={bodyRef} tabIndex={scrollable ? 0 : undefined} role={scrollable ? 'region' : undefined} aria-labelledby={scrollable ? idRef.current : undefined}>{children}</div>
        {footer && <div className="dialog-foot">{footer}</div>}
      </div>
    </div>
  );
}
