// shell/dock.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useState } from 'react';

// feature-configurable-panel-docking — the dockable shell panels. Each can live
// in the LEFT or RIGHT slot (persisted in UiPrefs.panelSides); each slot is a
// single-panel-at-a-time surface with a tab strip over the panels assigned to
// it. Order here = tab order within a slot. `assistant` is native-only.
export const DOCK_PANELS = [
  { id: 'tree', label: 'Files' },
  { id: 'layers', label: 'Layers' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'comments', label: 'Comments' },
  { id: 'changes', label: 'Changes' },
  { id: 'sync', label: 'Sync' }, // feature-sync-progress-modal — linked projects only
  { id: 'assistant', label: 'Assistant' },
];

export const PANEL_SIDES_DEFAULTS = {
  tree: 'left',
  layers: 'left',
  inspector: 'right',
  comments: 'right',
  changes: 'right',
  sync: 'right',
  assistant: 'right',
};

// feature-configurable-panel-docking — one dock slot (left or right). Owns the
// resizable width + a tab strip over the panels assigned to the slot; renders
// the active panel (passed as children). Collapses to 0 width when nothing is
// visibly open (it may still host an always-mounted hidden ChatPanel).
export function DockSlot({ side, width, open, ids, activeId, onPick, children, labels = null }) {
  return (
    <div
      className={'st-dockslot st-dockslot--' + side + (open ? '' : ' is-collapsed')}
      style={{ width: open ? width : 0, flexBasis: open ? width : 0 }}
    >
      {open && ids.length > 1 && (
        <div className="st-docktabs" role="tablist" aria-label={side + ' panels'}>
          {ids.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-testid={`dock-tab-${id}`}
              aria-selected={activeId === id}
              className={'st-docktab' + (activeId === id ? ' is-active' : '')}
              onClick={() => onPick(id)}
            >
              {labels?.[id] || (DOCK_PANELS.find((p) => p.id === id) || {}).label || id}
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

// ───────── Resizable panel grip (DS components-resize-panels contract) ─────────
//
// 8px hit area on a 1px seam; grip dots + accent surface on hover/focus/drag;
// pointer drag (with capture, so moves keep arriving over the iframe), arrow-key
// nudge (8px, ⇧=24px), Home/End to min/max, double-click resets to default.
// Width persists per panel in localStorage.

export function usePanelSize(storeKey, { min, max, def }) {
  const clamp = useCallback((v) => Math.min(max, Math.max(min, v)), [min, max]);
  const [w, setWRaw] = useState(() => {
    try {
      const v = parseInt(localStorage.getItem(storeKey) || '', 10);
      return Number.isFinite(v) ? clamp(v) : def;
    } catch {
      return def;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(storeKey, String(w));
    } catch {}
  }, [storeKey, w]);
  const setW = useCallback(
    (next) => setWRaw((prev) => clamp(typeof next === 'function' ? next(prev) : next)),
    [clamp]
  );
  return { w, setW, min, max, def };
}

export function PanelGrip({ label, size, onPointerDown, active, dir = 'ltr' }) {
  const { w, setW, min, max, def } = size;
  // `dir` is grip-relative: 'ltr' (left panel) → ArrowRight widens; 'rtl'
  // (right dock) → ArrowRight narrows, since the seam moves toward the panel.
  const grow = dir === 'rtl' ? -1 : 1;
  return (
    <div
      className={'st-grip' + (active ? ' is-active' : '')}
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(w)}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setW(def)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 24 : 8;
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          setW((v) => v + step * grow);
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          setW((v) => v - step * grow);
        } else if (e.key === 'Home') {
          e.preventDefault();
          setW(min);
        } else if (e.key === 'End') {
          e.preventDefault();
          setW(max);
        }
      }}
    >
      <svg className="st-grip-dots" viewBox="0 0 6 18" aria-hidden="true">
        <circle cx="3" cy="3" r="1.1" fill="currentColor" />
        <circle cx="3" cy="9" r="1.1" fill="currentColor" />
        <circle cx="3" cy="15" r="1.1" fill="currentColor" />
      </svg>
    </div>
  );
}
