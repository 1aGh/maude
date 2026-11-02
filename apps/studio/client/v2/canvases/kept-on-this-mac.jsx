// client/v2/canvases/kept-on-this-mac.jsx — S1.8: "Kept on this Mac", the per-Mac list (S1 Q5).
//
// Conflict losers, sync's quarantined copies and migration copies are parked under <designRoot>/_trash/ on
// THIS Mac — not shared state, so they are not in the shared Trash (L18: "reflects only that Mac's own
// copy"). Nothing is deleted: this is the pre-S1.8 Trash list moved, with its Restore and its ≥ 1-day
// "Clear out…" (POST /_api/sync/trash restore / prune) unchanged and its test ids kept.
//
// Two homes, one list:
//   - Canvases › Advanced › "Kept on this Mac" (`KeptOnThisMac mode="fold"`), when the shared Trash answers;
//   - the Trash view itself (`mode="view"`), when it does not (`legacy: true` — an older team server, a
//     legacy-mode project): then this list IS the Trash, exactly as it was.
// A viewer (read-only) sees neither Restore nor Clear out.

import { useState } from 'react';
import { TRASH_REASON_WORD, trashSummary } from '../left-panel/left-panel-model.js';
import { postTrash } from '../left-panel/use-trash.js';
import { whenLabel } from '../left-panel/trash-model.js';

/** The days "Clear out" keeps: anything parked for fewer days stays. */
export const CLEAR_OUT_KEEPS_DAYS = 30;

function nameOf(e) {
  const rel = e.sourceRel ?? String(e.trashRel || '').replace(/^_trash\//, '');
  return rel.split('/').pop() || '(unnamed)';
}

function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return whenLabel(at, now);
}

export function KeptOnThisMac({ kept, readOnly = false, onChanged, mode = 'view' }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const entries = kept?.entries ?? [];

  const run = async (body, done) => {
    setBusy(true);
    setNote('');
    const res = await postTrash(body);
    setBusy(false);
    setNote(res.ok ? done(res) : res.error);
    await onChanged?.();
  };

  return (
    <div className={`lp-kept lp-kept--${mode}`}>
      <div className="lp-trash-list">
        {entries.length === 0 ? (
          mode === 'view' ? (
            <div className="lp-empty" data-testid="canvases-trash-empty">
              <p className="lp-empty-t">Trash is empty.</p>
              <p className="lp-empty-b">
                Canvases and artboards you move to the trash wait here until you clear them out.
              </p>
            </div>
          ) : null
        ) : (
          <ul className="lp-ul">
            {entries.slice(0, 200).map((e) => (
              <li
                key={e.trashRel}
                className="lp-row lp-trash-item"
                data-testid="canvases-trash-item"
              >
                <span className="lp-two">
                  <span className="lp-name" title={e.trashRel}>
                    {nameOf(e)}
                  </span>
                  <span className="lp-sub">
                    {TRASH_REASON_WORD[e.reason] || e.reason} · {ago(e.at)}
                  </span>
                </span>
                {e.sourceRel && !readOnly ? (
                  <button
                    type="button"
                    className="btn btn--sm lp-restore"
                    data-testid="canvases-trash-restore"
                    disabled={busy}
                    onClick={() =>
                      run({ action: 'restore', trashRel: e.trashRel }, (j) =>
                        j.restoredTo ? `Restored to ${j.restoredTo}.` : 'Restored.'
                      )
                    }
                  >
                    Restore
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {kept && kept.total > 200 ? (
          <p className="lp-more">…and {kept.total - 200} more in _trash/</p>
        ) : null}
      </div>
      {asking ? (
        <div
          className="lp-ask"
          role="alertdialog"
          aria-label="Clear out the trash?"
          data-testid="canvases-trash-ask"
        >
          <p className="lp-ask-t">Clear out the trash?</p>
          <p className="lp-ask-b">
            Everything that has been in the trash for {CLEAR_OUT_KEEPS_DAYS} days or more goes for
            good. Newer things stay — Restore still brings them back.
          </p>
          <div className="lp-ask-actions">
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setAsking(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              data-testid="canvases-trash-clear-yes"
              disabled={busy}
              onClick={async () => {
                setAsking(false);
                await run(
                  { action: 'prune', olderThanDays: CLEAR_OUT_KEEPS_DAYS },
                  (j) => `Cleared out ${j.pruned ?? 0}; ${j.kept ?? 0} kept.`
                );
              }}
            >
              Clear out
            </button>
          </div>
        </div>
      ) : null}
      {note ? (
        <p className="lp-note" role="status">
          {note}
        </p>
      ) : null}
      <div className="lp-trash-foot">
        <span>{entries.length ? trashSummary(kept) : 'Kept until you clear it out.'}</span>
        {!readOnly && entries.length ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="canvases-trash-clear"
            disabled={busy}
            onClick={() => setAsking(true)}
          >
            Clear out…
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The Advanced row: "Kept on this Mac · N", Open shows the list in place. Only drawn when this Mac has
 * something parked (an empty list is not worth a row), and never for a viewer.
 */
export function KeptRow({ kept, readOnly = false, onChanged }) {
  const [open, setOpen] = useState(false);
  const n = kept?.total ?? 0;
  if (readOnly || n === 0) return null;
  return (
    <div className="lp-adv-kept" data-testid="canvases-kept">
      <div className="lp-adv-row">
        <span className="lp-adv-k">Kept on this Mac</span>
        <span className="lp-adv-v">
          {n} {n === 1 ? 'thing' : 'things'}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="canvases-kept-toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? 'Hide' : 'Open'}
          </button>
        </span>
      </div>
      {open ? (
        <KeptOnThisMac kept={kept} readOnly={readOnly} onChanged={onChanged} mode="fold" />
      ) : null}
    </div>
  );
}
