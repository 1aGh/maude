// client/v2/left-panel/canvases-advanced.jsx — V2-4.4a: Canvases › Advanced, the one quiet row at the foot
// of the panel (kit `CanvasesPanel advanced`, 06 · ad-left). Since V2-4.10 the row is the shared, remembered
// <AdvancedFold panel="left.canvases"> (client/v2/fold/) — this file only keeps the Canvases classes and body.
//
// It holds what the default view no longer shows: the Hidden files switch (no key — CONTRACT §2), the
// design system's files (the Design system canvas is the default view; its CSS and specimens are the
// Advanced layer — §7 A9), Trash (also the panel's last row), and Refresh tree (⇧⌘R).
//
// S11.9 (06 · ad-left) adds, above and around those: Show file names (a second mono line under each canvas),
// the project Folder (mono, with Copy — absent where there is none, i.e. in the cloud), the Design system's
// folder with Open, and "updated just now" after the count. The row menu's Advanced group (Reveal in Finder …
// Rename file…) is canvas-file-menu.js, drawn by the panel while this fold is open.

import { useEffect, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { KeptRow } from '../canvases/kept-on-this-mac.jsx';
import { AdvancedFold } from '../fold/advanced-fold.jsx';
import { useFold } from '../fold/use-fold.js';
import { diagnosticsFacts, setDiagnosticsFacts } from '../diagnostics/diagnostics-bus.js';
import { diagnosticsInfo } from '../diagnostics/diagnostics-model.js';
import { dsFolderLabel, folderOf, updatedWord } from './advanced-model.js';
import { CANVASES_FOLD, copyText } from './canvas-file-menu.js';
import { TrashIcon } from './canvases-pinned.jsx';
import { useViewPref, VIEW_PREF_KEYS } from './view-prefs.js';
import { trashRowCount } from './left-panel-model.js';

/** This panel's fold key in prefs.json `fold` (the same on every project of this Mac). */
export { CANVASES_FOLD };

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

/**
 * The project folder, read once from the guarded diagnostics answer when the fold opens (the same place the
 * project menu's Advanced › Project folder reads). '' = not known / none here (a cloud tab).
 */
export function useProjectFolder(enabled, fetchImpl) {
  const [folder, setFolder] = useState(() => folderOf(diagnosticsFacts()));
  useEffect(() => {
    if (!enabled || folder) return undefined;
    let live = true;
    const f = fetchImpl ?? globalThis.fetch;
    Promise.resolve()
      .then(() => f('/_api/diagnostics'))
      .then((r) => r.json())
      .then((j) => {
        const next = diagnosticsInfo(j, { host: globalThis.location?.host ?? '' });
        if (next.folder) setDiagnosticsFacts(next);
        if (live) setFolder(next.folder);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [enabled, folder, fetchImpl]);
  return folder;
}

/** "updated just now" — re-worded every 30 s while the fold is open, restarted by a refresh or a new count. */
function useUpdatedWord(open, ...restart) {
  const [at, setAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  // biome-ignore lint/correctness/useExhaustiveDependencies: a changed count or a finished refresh is the restart
  useEffect(() => {
    const t = Date.now();
    setAt(t);
    setNow(t);
  }, restart);
  useEffect(() => {
    if (!open) return undefined;
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [open]);
  return updatedWord(now, at);
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
  dsName = null,
  onOpenDs,
  makeDs = null, // { label } | null — a project with no system and a person who can make one
  onMakeDs,
  fetchImpl,
  children,
}) {
  const count = trashRowCount(trash);
  const [showFileNames, setShowFileNames] = useViewPref(VIEW_PREF_KEYS.fileNames);
  const folder = useProjectFolder(open !== undefined ? !!open : true, fetchImpl);
  const updated = useUpdatedWord(open !== undefined ? !!open : true, shown, total, refreshing);
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
        <span className="lp-adv-k" id="lp-names-k">
          Show file names
        </span>
        <button
          type="button"
          role="switch"
          className="lp-switch"
          data-testid="canvases-show-file-names"
          aria-checked={!!showFileNames}
          aria-labelledby="lp-names-k"
          onClick={() => setShowFileNames((v) => !v)}
        />
      </div>
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
      {folder ? (
        <div className="lp-adv-row">
          <span className="lp-adv-k">Folder</span>
          <span className="lp-adv-v lp-adv-copyable">
            <span className="lp-adv-mono" data-testid="canvases-folder" title={folder}>
              {folder}
            </span>
            <button
              type="button"
              className="icon-btn k-icon-sm lp-adv-copy"
              data-testid="canvases-folder-copy"
              aria-label="Copy the project folder"
              title="Copy the project folder"
              onClick={() => copyText(folder)}
            >
              <StIcon name="duplicate" size={14} />
            </button>
          </span>
        </div>
      ) : null}
      {dsName ? (
        <div className="lp-adv-row">
          <span className="lp-adv-k">Design system</span>
          <span className="lp-adv-v">
            <span className="lp-adv-mono" data-testid="canvases-ds-folder">
              {dsFolderLabel(dsName)}
            </span>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="canvases-ds-open"
              onClick={() => onOpenDs?.(dsName)}
            >
              Open
            </button>
          </span>
        </div>
      ) : makeDs ? (
        // P8 C5: a project with no design system draws no accent row above its canvases (boards 01 / 02 / 05);
        // the door is this one row (the same hook, the same ds.make) and Home's starter / ⌘K.
        <div className="lp-adv-row">
          <span className="lp-adv-k">Design system</span>
          <span className="lp-adv-v">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              data-testid="canvases-ds-make"
              onClick={() => onMakeDs?.()}
            >
              {makeDs.label}
            </button>
          </span>
        </div>
      ) : null}
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
        <span className="lp-adv-k lp-adv-footl">
          <span
            className="lp-adv-k"
            data-testid="canvases-count"
            data-tip={wsConnected ? 'live · file index synced' : 'reconnecting…'}
          >
            <span className={`lp-live${wsConnected ? ' is-connected' : ''}`} aria-hidden="true" />
            {shown} of {total} shown
          </span>
          <span className="lp-adv-updated" data-testid="canvases-updated">
            · {updated}
          </span>
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
