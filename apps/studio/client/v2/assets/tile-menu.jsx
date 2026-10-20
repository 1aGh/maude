// client/v2/assets/tile-menu.jsx — the menu a right-click on a tile opens (S8.12; 12 · ia-assets-keys).
//
// "Place in MVP zápasu ↵" and "Show details ⌘I" — the same two actions the keys run (`assets.place`, `assets.details`,
// through assets-bus.js), so the menu, ↵ and ⌘I are one code path. A viewer is offered Show details only; sound and video
// are not placed from here (a clip goes on a video artboard's timeline). Reached by the right-click, the keyboard
// (↑ ↓ walk, esc closes). Move to trash is not here yet: an asset in the Trash is S8.13's.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Kbd } from '../../shell/icons.jsx';
import { placeMenu } from '../../tree-row-menu.jsx';

/**
 * The rows for `asset`.
 * @param {{ kind: string }} asset
 * @param {{ readOnly?: boolean, placeLabel?: string | null }} o `placeLabel` is the selected artboard's name
 */
export function tileMenuItems(asset, { readOnly = false, placeLabel = null } = {}) {
  const items = [];
  if (!readOnly && asset?.kind === 'image')
    items.push({
      id: 'place',
      label: placeLabel ? `Place in ${placeLabel}` : 'Place',
      keys: '↵',
    });
  items.push({ id: 'details', label: 'Show details', keys: '⌘I' });
  return items;
}

export function AssetTileMenu({ state, items, onSelect, onClose }) {
  const ref = useRef(null);
  const [placed, setPlaced] = useState(null);
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
  }, [state]);
  useEffect(() => {
    if (!state) return undefined;
    const el = ref.current;
    el?.querySelector('button:not([disabled])')?.focus();
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
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
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
  }, [state, onClose]);

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
  return (
    <div
      ref={ref}
      className="st-dropdown cv-rowmenu"
      role="menu"
      aria-label={`Actions for ${state.asset.name}`}
      data-testid="assets-tile-menu"
      style={style}
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          className="st-dd-item"
          data-testid={`assets-menu-${it.id}`}
          onClick={() => onSelect(it.id)}
        >
          <span className="st-dd-lead">{it.label}</span>
          {it.keys ? <Kbd>{it.keys}</Kbd> : null}
        </button>
      ))}
    </div>
  );
}
