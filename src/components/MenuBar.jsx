import React, { useEffect, useRef, useState } from 'react';

// ARIA menubar. items: [{ label, items: [{ label, onSelect, shortcut, disabled, checked, separator, submenu }] }]
export default function MenuBar({ menus }) {
  const [open, setOpen] = useState(-1);
  const [active, setActive] = useState(0);
  const barRef = useRef(null);

  useEffect(() => {
    if (open < 0) return undefined;
    const off = (e) => { if (barRef.current && !barRef.current.contains(e.target)) setOpen(-1); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);

  const enabled = (m) => m.items.map((it, i) => (it.separator || it.disabled ? -1 : i)).filter((i) => i >= 0);
  const focusItem = (mi, ii) => setTimeout(() => barRef.current?.querySelector(`[data-mi="${mi}"][data-ii="${ii}"]`)?.focus(), 0);
  const openMenu = (mi, focusFirst) => { setOpen(mi); setActive(mi); if (focusFirst) focusItem(mi, enabled(menus[mi])[0]); };
  const topKey = (e, mi) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); const n = (mi + 1) % menus.length; setActive(n); barRef.current.querySelector(`[data-top="${n}"]`).focus(); if (open >= 0) openMenu(n, true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); const n = (mi + menus.length - 1) % menus.length; setActive(n); barRef.current.querySelector(`[data-top="${n}"]`).focus(); if (open >= 0) openMenu(n, true); }
    else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(mi, true); }
    else if (e.key === 'Escape') setOpen(-1);
  };
  const itemKey = (e, mi, ii) => {
    const list = enabled(menus[mi]); const pos = list.indexOf(ii);
    if (e.key === 'ArrowDown') { e.preventDefault(); focusItem(mi, list[(pos + 1) % list.length]); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusItem(mi, list[(pos + list.length - 1) % list.length]); }
    else if (e.key === 'Home') { e.preventDefault(); focusItem(mi, list[0]); }
    else if (e.key === 'End') { e.preventDefault(); focusItem(mi, list[list.length - 1]); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(-1); barRef.current.querySelector(`[data-top="${mi}"]`).focus(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const n = (mi + (e.key === 'ArrowRight' ? 1 : menus.length - 1)) % menus.length; openMenu(n, true); }
    else if (e.key === 'Tab') setOpen(-1);
  };
  const select = (it) => { setOpen(-1); setTimeout(() => it.onSelect && it.onSelect(), 0); };

  return (
    <div className="menubar" role="menubar" aria-label="Main menu" ref={barRef}>
      {menus.map((m, mi) => (
        <div className="menu-wrap" key={m.label}>
          <button type="button" role="menuitem" aria-haspopup="menu" aria-expanded={open === mi} className={'menu-top' + (open === mi ? ' open' : '')} data-top={mi} tabIndex={active === mi ? 0 : -1}
            onClick={() => (open === mi ? setOpen(-1) : openMenu(mi, false))} onMouseEnter={() => open >= 0 && openMenu(mi, false)} onKeyDown={(e) => topKey(e, mi)}>{m.label}</button>
          {open === mi && (
            <div className="menu" role="menu" aria-label={m.label}>
              {m.items.map((it, ii) => it.separator ? <div key={ii} role="separator" className="menu-sep" /> : (
                <button key={ii} type="button" role={it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} aria-disabled={it.disabled || undefined} disabled={it.disabled}
                  className="menu-item" data-mi={mi} data-ii={ii} tabIndex={-1} onClick={() => select(it)} onKeyDown={(e) => itemKey(e, mi, ii)}>
                  <span className="menu-check" aria-hidden="true">{it.checked ? '✓' : ''}</span>
                  <span className="menu-label">{it.label}</span>
                  {it.shortcut && <span className="menu-shortcut">{it.shortcut}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
