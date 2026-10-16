// shell/dock.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useState } from 'react';

import { StIcon } from './icons.jsx';

// feature-configurable-panel-docking — the dockable shell panels. Each can live
// in the LEFT or RIGHT slot (persisted in UiPrefs.panelSides). Order here = the
// order of the left panel's tab strip. `assistant` is native-only.
export const DOCK_PANELS = [
  // V2-4.4a — the left slot reads Canvases · Layers · Assets (CONTRACT §7). The id stays `tree`
  // (`panel-tab-tree`, panelSides, the e2e hooks); only the word changed.
  { id: 'tree', label: 'Canvases' },
  { id: 'layers', label: 'Layers' },
  { id: 'assets', label: 'Assets' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'comments', label: 'Comments' },
  { id: 'changes', label: 'Changes' },
  { id: 'sync', label: 'Sync' }, // feature-sync-progress-modal — linked projects only
  { id: 'assistant', label: 'Assistant' },
];

export const PANEL_SIDES_DEFAULTS = {
  tree: 'left',
  layers: 'left',
  assets: 'left',
  inspector: 'right',
  comments: 'right',
  changes: 'right',
  sync: 'right',
  assistant: 'right',
};

/** The panels that must close when `id` opens: its same-side siblings, one main panel per side. The AI chat
 *  is its own island (V2-4.4b): opening it closes nothing, and nothing closes it. */
export function siblingsToClose(id, sideOf) {
  if (id === 'assistant') return [];
  return DOCK_PANELS.filter(
    (p) => p.id !== id && p.id !== 'assistant' && sideOf(p.id) === sideOf(id)
  ).map((p) => p.id);
}

// V2-4.4b — the panels that make up the LEFT panel's tab strip (Canvases · Layers · Assets, CONTRACT §7).
// A strip exists for a side only when it hosts one of these AND more than one panel; every other panel
// (Inspector, Comments, Changes, Sync) is its own island with its own opener, not a tab.
export const LEFT_PANEL_TABS = ['tree', 'layers', 'assets'];

/** Whether a side's panels get the tab strip in their header. */
export function hasPanelTabs(ids) {
  return ids.length > 1 && ids.some((id) => LEFT_PANEL_TABS.includes(id));
}

// V2-4.4b — the left panel's OWN header (kit `CanvasesPanel` `.k-cp-hd`): the segmented strip over the panels
// assigned to the side, then the Hide icon. Replaces the old dock tab strip (`dock-tab-<id>` / `.st-docktabs`).
export function PanelTabs({ side, ids, activeId, onPick, onFold, labels = null }) {
  const label = (id) => labels?.[id] || (DOCK_PANELS.find((p) => p.id === id) || {}).label || id;
  return (
    <div className="lp-head" data-testid={`panel-head-${side}`}>
      <div className="lp-tabs" role="tablist" aria-label={side + ' panels'}>
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-testid={`panel-tab-${id}`}
            aria-selected={activeId === id}
            className={'lp-tab' + (activeId === id ? ' is-active' : '')}
            onClick={() => onPick(id)}
          >
            {label(id)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="st-iconbtn lp-fold"
        data-testid={`panel-fold-${side}`}
        aria-label={`Hide ${label(activeId)}`}
        title={`Hide ${label(activeId)}`}
        onClick={onFold}
      >
        <StIcon name={side === 'right' ? 'panel-right' : 'panel-left'} size={15} />
      </button>
    </div>
  );
}

// feature-configurable-panel-docking — one dock slot (left or right). Owns the resizable width and holds up
// to TWO islands: the main panel (the open one of the side's panels, passed as children) and, separately,
// the AI chat island (`ai`).
//
// V2-4.4b — the right side is separate islands, not one tabbed column: Inspector / Comments / Changes / Sync
// share the main island (opening one replaces another, as before) and the AI chat is its own island under
// it, shown or hidden independently. The slot is a transparent frame; `.has-ai` says both are showing.
//
// V2-4.1 — the DOM is the same in both layouts, so pinning / unpinning never remounts the panels (the AI
// chat keeps its stream, DDR-123): `.st-dockslot` is the positioned slot, `.st-dockslot-inner` an island's
// surface. Pinned (today's docked column) the inner is `display: contents`; floating it is the `.island`
// and carries `data-occludes` (V2-1.2 §5.6) so the shell can tell the canvas what it covers. `hidden`
// (⌘\) takes the slot out of the layout but leaves it mounted.
export function DockSlot({
  side,
  width,
  open,
  ids,
  activeId,
  onPick,
  onFold,
  children,
  labels = null,
  floating = false,
  hidden = false,
  ai = null,
  aiShown = false,
}) {
  const tabs = open && hasPanelTabs(ids);
  const shown = open || aiShown;
  return (
    <div
      className={
        'st-dockslot st-dockslot--' +
        side +
        (shown ? '' : ' is-collapsed') +
        (open && aiShown ? ' has-ai' : '') +
        (hidden ? ' is-hidden' : '')
      }
      style={{ width: shown ? width : 0, flexBasis: shown ? width : 0 }}
    >
      {open && (
        <div
          className={'st-dockslot-inner' + (floating ? ' island' : '')}
          data-testid={`dock-slot-${side}`}
          data-occludes={floating && !hidden ? side : undefined}
        >
          {tabs && (
            <PanelTabs
              side={side}
              ids={ids}
              activeId={activeId}
              onPick={onPick}
              onFold={onFold}
              labels={labels}
            />
          )}
          {children}
        </div>
      )}
      {ai && (
        <div
          className={'st-dockslot-inner st-dockslot-ai' + (floating ? ' island' : '')}
          data-testid={`dock-ai-${side}`}
          data-occludes={floating && aiShown && !hidden ? side : undefined}
          hidden={!aiShown}
        >
          {ai}
        </div>
      )}
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
      className={
        'st-grip' + (dir === 'rtl' ? ' st-grip--r' : ' st-grip--l') + (active ? ' is-active' : '')
      }
      role="separator"
      data-testid={dir === 'rtl' ? 'panel-grip-right' : 'panel-grip-left'}
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
