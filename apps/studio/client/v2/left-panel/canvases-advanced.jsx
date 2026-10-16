// client/v2/left-panel/canvases-advanced.jsx — V2-4.4a: Canvases › Advanced, the one quiet row at the foot
// of the panel (kit `CanvasesPanel advanced`, 06 · ad-left). A plain disclosure — the shared, remembered
// Fold component is V2-4.10.
//
// It holds what the default view no longer shows: the Hidden files switch (no key — CONTRACT §2), the
// design system's files (the Design system canvas is the default view; its CSS and specimens are the
// Advanced layer — §7 A9), Trash (also the panel's last row), and Refresh tree (⇧⌘R).

import { useCallback, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { TrashIcon } from './canvases-pinned.jsx';
import { trashRowCount } from './left-panel-model.js';

const STORE = 'maude-canvases-advanced';

/** Open / closed, remembered per Mac (a quiet convenience: storage may be blocked). */
export function useAdvancedOpen() {
  const [open, setOpenRaw] = useState(() => {
    try {
      return localStorage.getItem(STORE) === '1';
    } catch {
      return false;
    }
  });
  const setOpen = useCallback((v) => {
    setOpenRaw((prev) => {
      const next = typeof v === 'function' ? v(prev) : v;
      try {
        localStorage.setItem(STORE, next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);
  return [open, setOpen];
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
  children,
}) {
  const count = trashRowCount(trash);
  return (
    <div
      className="lp-adv"
      data-open={open ? 'true' : undefined}
      data-testid="canvases-advanced-fold"
    >
      <button
        type="button"
        className="lp-adv-btn"
        data-testid="canvases-advanced"
        aria-expanded={open}
        onClick={onToggle}
      >
        <span className="lp-adv-ch">
          <StIcon name="chevron-right" size={12} />
        </span>
        Advanced
      </button>
      {open ? (
        <div className="lp-adv-body">
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
          <div className="lp-adv-row lp-adv-foot">
            <span
              className="lp-adv-k"
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
        </div>
      ) : null}
    </div>
  );
}
