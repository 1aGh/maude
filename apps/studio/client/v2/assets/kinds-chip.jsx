// client/v2/assets/kinds-chip.jsx — "All kinds ▾", the kind filter in the Assets chip row (12 · ia-assets-panel `chip ia-ap-kinds`).
//
// A chip that opens a small menu: All kinds · Photos · Video · Sound. ↑ ↓ walk, ↵ picks, esc closes and gives the focus back.

import { useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { KINDS, kindLabel } from './library-foot.js';

export function KindsChip({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const btn = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const el = root.current;
    el?.querySelector('[role="menuitemradio"][aria-checked="true"]')?.focus();
    const onPointer = (e) => {
      if (el && !el.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const items = Array.from(el.querySelectorAll('[role="menuitemradio"]'));
      const i = items.indexOf(document.activeElement);
      const n =
        e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[n]?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);
  return (
    <span className="lp-kinds" ref={root}>
      <button
        ref={btn}
        type="button"
        className="chip lp-kinds-b"
        data-testid="assets-kinds"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {kindLabel(value)}
        <StIcon name="chevron" size={11} />
      </button>
      {open ? (
        <div className="lp-kinds-menu sh-dropdown" role="menu" aria-label="Kinds">
          {KINDS.map((k) => (
            <button
              key={k.id}
              type="button"
              role="menuitemradio"
              aria-checked={value === k.id}
              className="sh-dd-item"
              data-testid={`assets-kinds-${k.id}`}
              onClick={() => {
                onChange(k.id);
                setOpen(false);
                btn.current?.focus();
              }}
            >
              <span className="sh-dd-lead">{k.label}</span>
              {value === k.id ? <StIcon name="check" size={12} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
