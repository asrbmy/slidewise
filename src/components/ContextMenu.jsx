import React, { useEffect, useRef } from 'react';

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    el.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    el.querySelector('button:not([disabled])')?.focus();
    const away = (e) => { if (!el.contains(e.target)) onClose(); };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [x, y, onClose]);
  const buttons = () => Array.from(ref.current.querySelectorAll('button:not([disabled])'));
  const key = (e) => {
    const bs = buttons(); const i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i + bs.length - 1) % bs.length].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); onClose(); }
  };
  return (
    <div className="menu context-menu" role="menu" aria-label="Context menu" ref={ref} style={{ left: x, top: y }} onKeyDown={key}>
      {items.map((it, i) => it.separator ? <div key={i} className="menu-sep" role="separator" /> : (
        <button key={i} type="button" role="menuitem" className="menu-item" disabled={it.disabled} onClick={() => { onClose(); setTimeout(it.onSelect, 0); }}>
          <span className="menu-check" aria-hidden="true" /><span className="menu-label">{it.label}</span>{it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
        </button>
      ))}
    </div>
  );
}
