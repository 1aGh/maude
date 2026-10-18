// client/v2/left-panel/canvases-advanced.jsx — V2-4.4a: Canvases › Advanced, the one quiet row at the foot
// of the panel (kit `CanvasesPanel advanced`, 06 · ad-left). Since V2-4.10 the row is the shared, remembered
// <AdvancedFold panel="left.canvases"> (client/v2/fold/) — this file only keeps the Canvases classes and body.
//
// It holds what the default view no longer shows: the Hidden files switch (no key — CONTRACT §2), the
// design system's files (the Design system canvas is the default view; its CSS and specimens are the
// Advanced layer — §7 A9), Trash (also the panel's last row), and Refresh tree (⇧⌘R).

import { StIcon } from '../../shell/icons.jsx';
import { KeptRow } from '../canvases/kept-on-this-mac.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useFold } from '../fold/use-fold.js';
import { TrashIcon } from './canvases-pinned.jsx';
import { trashRowCount } from './left-panel-model.js';

/** This panel's fold key in prefs.json `fold` (the same on every project of this Mac). */
export const CANVASES_FOLD = 'left.canvases';

/** The Canvases panel's classes (left-panel.css): the fold's markup, the panel's look. */
const LP_CLASSES = Object.freeze({
  root: 'lp-adv',
  btn: 'lp-adv-btn',
  ch: 'lp-adv-ch',
  body: 'lp-adv-body',
});

/** Open / closed, remembered per Mac (the shared fold store). */
export function useAdvancedOpen() {
  return useFold(CANVASES_FOLD);
}

export function CanvasesAdvanced({
  open,
  onToggle,
  showHidden,
  onToggleHidden,
  onRefresh,
  refreshing = false,
  shown,
  total,
  wsConnected = true,
  trash,
  onOpenTrash,
  showTrash = true,
  kept = null,
  onKeptChanged,
  activePath = null,
  isSystem = false,
  children,
}) {
  const count = trashRowCount(trash);
  return (
    <AdvancedFold
      panel={CANVASES_FOLD}
      classes={LP_CLASSES}
      testid="canvases-advanced-fold"
      buttonTestid="canvases-advanced"
      open={open}
      onToggle={onToggle}
    >
      <div className="lp-adv-row">
        <span className="lp-adv-k" id="lp-hidden-k">
          Show hidden files
        </span>
        <button
          type="button"
          role="switch"
          className="lp-switch"
          data-testid="canvases-hidden-files"
          aria-checked={!!showHidden}
          aria-labelledby="lp-hidden-k"
          onClick={onToggleHidden}
        />
      </div>
      {/* V2-4.8b — where the open canvas lives (was the status bar's "active" slot). */}
      <div className="lp-adv-row">
        <span className="lp-adv-k">Open canvas</span>
        <span
          className="lp-adv-v lp-adv-path"
          data-testid="canvases-active-path"
          title={activePath || undefined}
        >
          {isSystem ? 'Design system' : activePath || 'Nothing open'}
        </span>
      </div>
      {children}
      {showTrash ? (
        <div className="lp-adv-row">
          <span className="lp-adv-k">
            <TrashIcon size={13} /> Trash
          </span>
          <span className="lp-adv-v">
            {count ? `${count} ${trash.total === 1 ? 'thing' : 'things'}` : 'Empty'}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="canvases-advanced-trash"
              onClick={onOpenTrash}
            >
              Open
            </button>
          </span>
        </div>
      ) : null}
      {/* S1.8 (Q5) — the per-Mac list (conflict losers, sync's quarantined copies) lives here, not in the shared Trash. */}
      {showTrash ? <KeptRow kept={kept} onChanged={onKeptChanged} /> : null}
      <div className="lp-adv-row lp-adv-foot">
        <span
          className="lp-adv-k"
          data-testid="canvases-count"
          data-tip={wsConnected ? 'live · file index synced' : 'reconnecting…'}
        >
          <span className={`lp-live${wsConnected ? ' is-connected' : ''}`} aria-hidden="true" />
          {shown} of {total} shown
        </span>
        {onRefresh ? (
          <button
            type="button"
            className={`btn btn--ghost btn--sm lp-refresh${refreshing ? ' is-spinning' : ''}`}
            data-testid="canvases-refresh"
            data-tip="Refresh tree · ⇧⌘R"
            aria-label="Refresh tree"
            aria-busy={refreshing || undefined}
            disabled={refreshing}
            onClick={() => onRefresh()}
          >
            <StIcon name="reload" size={13} />
            Refresh
          </button>
        ) : null}
      </div>
    </AdvancedFold>
  );
}
