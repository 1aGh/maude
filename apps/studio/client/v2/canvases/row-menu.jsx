// client/v2/canvases/row-menu.jsx — S1.2: a canvas row's menu (11 · pn-trash inset, "Right-click “ahoj”").
//
// Open · Pin · Rename · Duplicate · Move to… › · Copy link, a rule, then Move to trash. Reached by the row's
// ⋯ (`tree-row-menu-<slug>`), a right-click and the keyboard (⋯ is a tab stop, ↑ ↓ walk, esc closes and gives
// the focus back). A viewer sees what they can do — Open, Pin (pins are per person), Copy link. "Move to…"
// drills into the folder list (`MoveSheet`).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { placeMenu } from '../../tree-row-menu.jsx';
import { MoveSheet } from './move-sheet.jsx';

/**
 * The rows of the menu for `row`. `edit` false (a viewer) leaves Open · Pin · Copy link.
 * `extra` (S11.9) is the Advanced group — Reveal in Finder … Rename file… — drawn after Copy link, before
 * Move to trash; left-panel/canvas-file-menu.js builds it, and only while Canvases › Advanced is open.
 */
export function canvasMenuItems(row, { edit = true, extra = [] } = {}) {
  const items = [{ id: 'open', label: 'Open' }];
  if (row.pinnable) items.push({ id: 'pin', label: row.pinned ? 'Unpin' : 'Pin' });
  if (edit) {
    items.push({ id: 'rename', label: 'Rename' });
    items.push({ id: 'duplicate', label: 'Duplicate' });
    items.push({ id: 'move', label: 'Move to…', sub: true });
  }
  items.push({ id: 'copy-link', label: 'Copy link' });
  items.push(...extra);
  if (edit) items.push({ id: 'trash', label: 'Move to trash', danger: true, sepBefore: true });
  return items;
}

export function CanvasRowMenu({ state, items, targets, onSelect, onPick, onClose, onView }) {
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);
  const view = state?.view;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!state || !el) {
      setPlaced(null);
      return;
    }
    setPlaced(
      placeMenu(
        state.anchor,
        { width: el.offsetWidth, height: el.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
    // re-place when the view switches (the folder list is another height)
  }, [state, view]);
  useEffect(() => {
    if (!state) return undefined;
    const el = ref.current;
    if (view === 'root') el?.querySelector('button:not([disabled])')?.focus();
    const onPointer = (e) => {
      if (el && !el.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (view !== 'root' || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      const btns = Array.from(el.querySelectorAll('button:not([disabled])'));
      if (!btns.length) return;
      const i = btns.indexOf(document.activeElement);
      const n = e.key === 'ArrowDown' ? (i + 1) % btns.length : (i - 1 + btns.length) % btns.length;
      btns[n]?.focus();
    };
    document.addEventListener('pointerdown', onPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [state, view, onClose]);

  if (!state) return null;
  const style = placed
    ? {
        position: 'fixed',
        left: placed.left,
        top: placed.top,
        maxHeight: placed.maxHeight,
        overflowY: 'auto',
      }
    : { position: 'fixed', left: state.anchor.left, top: state.anchor.bottom + 4 };

  if (view === 'move') {
    return (
      <div
        ref={ref}
        className="st-dropdown cv-rowmenu"
        role="dialog"
        aria-label="Move to…"
        style={style}
      >
        <MoveSheet
          name={state.row.name}
          targets={targets}
          onPick={onPick}
          onBack={() => onView('root')}
        />
      </div>
    );
  }
  return (
    <div
      ref={ref}
      className="st-dropdown cv-rowmenu"
      role="menu"
      aria-label={`Actions for ${state.row.name}`}
      data-testid="canvas-row-menu"
      style={style}
    >
      {items.map((it) => (
        <div key={it.id} role="none">
          {it.sepBefore ? <hr className="cv-menu-sep" /> : null}
          <button
            type="button"
            role="menuitem"
            className="st-dd-item"
            data-testid={`canvas-menu-${it.id}`}
            aria-haspopup={it.sub ? 'dialog' : undefined}
            style={it.danger ? { color: 'var(--status-error)' } : undefined}
            onClick={() => onSelect(it.id)}
          >
            <span className="st-dd-lead">{it.label}</span>
            {it.sub ? <StIcon name="chevron-right" size={12} /> : null}
          </button>
        </div>
      ))}
    </div>
  );
}
