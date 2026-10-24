// shell/dock.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { useViewing } from '../v2/history/history-host.jsx';
import { spawnFoldGhost } from '../v2/shell/fold-ghost.js';
import { rovingTabKey } from '../v2/shell/modal-focus.js';
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
  { id: 'changes', label: 'Version history' }, // CONTRACT §3 (was "Changes"); the id stays `changes`
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
// assigned to the side, then the Hide icon. Replaces the old dock tab strip (the `dock-tab-<id>` hooks).
export function PanelTabs({ side, ids, activeId, onPick, onFold, labels = null }) {
  const label = (id) => labels?.[id] || (DOCK_PANELS.find((p) => p.id === id) || {}).label || id;
  return (
    <div className="lp-head" data-testid={`panel-head-${side}`}>
      {/* V2-4 gate (a11y W4): WAI-ARIA tabs — one tab stop, ←/→ Home / End move and pick. */}
      <div
        className="lp-tabs"
        role="tablist"
        aria-label={side + ' panels'}
        tabIndex={-1}
        onKeyDown={(e) => rovingTabKey(e, ids, ids.includes(activeId) ? activeId : ids[0], onPick)}
      >
        {ids.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            data-testid={`panel-tab-${id}`}
            aria-selected={activeId === id}
            tabIndex={activeId === id || (!ids.includes(activeId) && id === ids[0]) ? 0 : -1}
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
  const viewing = !!useViewing();

  // S3.14 (G4, 04 md-motion) — a floating panel that stops showing FOLDS toward its corner icon instead of
  // cutting: just before the island leaves the DOM, a picture of it shrinks into the corner (fold-ghost.js).
  // The refs below read their props through `live`, so a layout switch never looks like a detach.
  const live = useRef({ floating, side, hidden });
  live.current = { floating, side, hidden };
  const mainNode = useRef(null);
  const foldMain = useCallback((node) => {
    if (node) {
      mainNode.current = node;
      return;
    }
    const gone = mainNode.current;
    mainNode.current = null;
    const { floating: fl, side: sd, hidden: hid } = live.current;
    if (gone?.isConnected && fl && !hid)
      spawnFoldGhost(gone, gone.closest('.st-body'), sd === 'left' ? 'top-left' : 'top-right');
  }, []);
  // The islands that stay MOUNTED when they stop showing - the whole slot folded away (`hidden`: Preview folds
  // the panels, and ⌘\), or the chat island (`hidden` attribute; its stream survives) - fold from the rect they
  // last had: the slot is already out of layout when the commit lands, so every commit while visible keeps the
  // rects, and the fold reads them.
  const aiNode = useRef(null);
  const mainBox = useRef(null);
  const aiBox = useRef(null);
  const aiWas = useRef(aiShown);
  const hiddenWas = useRef(hidden);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every commit, by design
  useLayoutEffect(() => {
    const main = mainNode.current;
    const ai = aiNode.current;
    const host = (main ?? ai)?.closest('.st-body');
    const foldAi = () =>
      ai &&
      aiBox.current &&
      spawnFoldGhost(ai, host, side === 'left' ? 'bottom-left' : 'bottom-right', aiBox.current);
    if (hidden) {
      if (!hiddenWas.current && floating) {
        if (main && mainBox.current)
          spawnFoldGhost(main, host, side === 'left' ? 'top-left' : 'top-right', mainBox.current);
        if (aiWas.current) foldAi();
      }
    } else {
      mainBox.current = main?.getBoundingClientRect?.() ?? null;
      if (aiShown) aiBox.current = ai?.getBoundingClientRect?.() ?? null;
      else if (aiWas.current && floating) foldAi();
    }
    hiddenWas.current = hidden;
    aiWas.current = aiShown;
  });
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
          ref={foldMain}
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
          ref={aiNode}
          className={'st-dockslot-inner st-dockslot-ai' + (floating ? ' island' : '')}
          data-testid={`dock-ai-${side}`}
          data-occludes={floating && aiShown && !hidden ? side : undefined}
          hidden={!aiShown}
          // S1.14 — looking at a past version is read-only: no AI runs against it (inert = no focus, no clicks)
          inert={viewing}
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

/** The chip beside a panel handle while it is dragged or focused (06 ad-pinned). */
export const GRIP_TIP = 'Drag · double-click resets · ← → move 8';

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
      {/* P8 C3 (06 ad-pinned `.ad-handle-tip`) — what the handle does, beside it while it is held or focused */}
      <span className="st-grip-tip" aria-hidden="true">
        {GRIP_TIP}
      </span>
    </div>
  );
}
