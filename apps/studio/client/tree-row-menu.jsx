// tree-row-menu.jsx — feature-file-tree-drag-drop-folders (Task 9).
//
// The KEYBOARD path for tree operations that Task 8's drag & drop can't
// reach on its own — WCAG 2.1.1 (keyboard operability) makes this a hard-stop
// for the a11y gate, not optional polish. A focusable "⋯" button + Enter/click
// opens a small menu; Move to… drills into a flat destination-folder list.
// Reuses the existing menubar dropdown visual language (`.st-dropdown` /
// `.st-dd-item` from 3-shell-maude.css) rather than inventing new chrome —
// only `position` is overridden inline since this menu anchors to an
// arbitrary row, not the menubar's fixed offset.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

const EDGE = 8;

/**
 * Where a menu of `size` goes so it stays on screen: below the anchor when it
 * fits, else above it, else pinned to the viewport edge (scrolling inside).
 * A row near the bottom of a long tree used to open its menu off-screen.
 */
export function placeMenu(anchor, size, viewport) {
  let top = anchor.bottom + 4;
  if (top + size.height > viewport.height - EDGE) {
    const above = anchor.top - 4 - size.height;
    top = above >= EDGE ? above : Math.max(EDGE, viewport.height - EDGE - size.height);
  }
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - EDGE - size.width));
  return { top, left, maxHeight: viewport.height - 2 * EDGE };
}

/**
 * One shared menu instance per tree (mirrors useTreeDrag — only one row's
 * menu is ever open at a time). `extra` is caller-defined data identifying
 * WHICH row this is for (e.g. `{ kind: 'file', path }` / `{ kind: 'dir',
 * dirPath }`), read back by the caller when rendering <TreeRowMenu> so
 * rootItems/destinations can be computed per-row without the hook needing to
 * know about canvases or folders at all.
 */
export function useRowMenu() {
  const [state, setState] = useState(null); // { x, y, anchorEl, view, extra }
  const openAt = (e, extra) => {
    e.preventDefault();
    e.stopPropagation();
    const anchorEl = e.currentTarget;
    const r = anchorEl.getBoundingClientRect();
    setState({
      x: r.left,
      y: r.bottom + 4,
      anchor: { top: r.top, bottom: r.bottom, left: r.left },
      anchorEl,
      view: 'root',
      extra,
    });
  };
  const close = () => {
    setState((s) => {
      s?.anchorEl?.focus();
      return null;
    });
  };
  const showMoveTo = () => setState((s) => (s ? { ...s, view: 'move-to' } : s));
  return { state, openAt, close, showMoveTo };
}

/**
 * `rootItems` — [{ id, label, onSelect, disabled?, destructive? }] for the
 * top-level menu. `destinations` — [{ path, label }] shown when the user
 * picks the item with `id === 'move-to'`; `onPickDestination(path)` fires
 * the actual move.
 */
export function TreeRowMenu({ state, onClose, rootItems, destinations, onPickDestination }) {
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);
  const view = state?.view;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!state || !el) {
      setPlaced(null);
      return;
    }
    const anchor = state.anchor ?? { top: state.y - 4, bottom: state.y - 4, left: state.x };
    setPlaced(
      placeMenu(
        anchor,
        { width: el.offsetWidth, height: el.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
    );
    // Re-place when the view switches (Move to… is a different height).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.anchorEl, view]);
  useEffect(() => {
    if (!state) return;
    const el = ref.current;
    const focusFirst = () => el?.querySelector('button:not([disabled])')?.focus();
    focusFirst();
    const onDocPointer = (e) => {
      if (!el.contains(e.target)) onClose();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = Array.from(el.querySelectorAll('button:not([disabled])'));
        if (items.length === 0) return;
        const idx = items.indexOf(document.activeElement);
        const next =
          e.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
        items[next]?.focus();
      }
    };
    document.addEventListener('pointerdown', onDocPointer, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDocPointer, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [state, onClose]);

  if (!state) return null;
  const style = placed
    ? { position: 'fixed', left: placed.left, top: placed.top, maxHeight: placed.maxHeight, overflowY: 'auto' }
    : { position: 'fixed', left: state.x, top: state.y };

  if (state.view === 'move-to') {
    return (
      <div ref={ref} className="st-dropdown" role="menu" aria-label="Move to…" style={style}>
        <div className="st-dd-hd">Move to…</div>
        {destinations.length === 0 ? (
          <div className="st-dd-item" aria-disabled="true">
            No other folders
          </div>
        ) : (
          destinations.map((d) => (
            <button
              key={d.path}
              type="button"
              role="menuitem"
              className="st-dd-item"
              onClick={() => {
                onPickDestination(d.path);
                onClose();
              }}
            >
              <span className="st-dd-lead">{d.label}</span>
            </button>
          ))
        )}
      </div>
    );
  }

  return (
    <div ref={ref} className="st-dropdown" role="menu" style={style}>
      {rootItems.map((item) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          className="st-dd-item"
          style={item.destructive ? { color: 'var(--status-error)' } : undefined}
          onClick={() => {
            if (item.disabled) return;
            item.onSelect();
          }}
        >
          <span className="st-dd-lead">{item.label}</span>
        </button>
      ))}
    </div>
  );
}
