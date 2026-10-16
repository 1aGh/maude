// client/v2/left-panel/trash-view.jsx — V2-4.4a: the Trash list, opened from the Canvases tab's last row
// (kit 11 · pn-trash, 05 · es-panels-make "Trash — empty").
//
// It is TODAY's list: GET /_api/sync/trash (use-trash.js) with Restore per entry. "Clear out…" asks first;
// today the server can only prune what has been parked for a while (POST prune, ≥ 1 day), so that is
// what the dialog says it does — a clear-out of everything, owner-only, is S1's `/api/trash/clear`
// (V2-1.7 §5.4). A viewer (read-only) sees neither Restore nor Clear out.

import { useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { TRASH_REASON_WORD, trashSummary } from './left-panel-model.js';
import { postTrash } from './use-trash.js';

/** The days "Clear out" keeps: anything parked for fewer days stays. */
export const CLEAR_OUT_KEEPS_DAYS = 30;

function ago(at, now = Date.now()) {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function nameOf(e) {
  const rel = e.sourceRel ?? String(e.trashRel || '').replace(/^_trash\//, '');
  return rel.split('/').pop() || '(unnamed)';
}

export function TrashView({ trash, readOnly = false, onBack, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [asking, setAsking] = useState(false);
  const entries = trash?.entries ?? [];

  const run = async (body, done) => {
    setBusy(true);
    setNote('');
    const res = await postTrash(body);
    setBusy(false);
    setNote(res.ok ? done(res) : res.error);
    await onChanged?.();
  };

  return (
    <div className="lp-trash" data-testid="canvases-trash">
      <div className="lp-trash-hd">
        <button
          type="button"
          className="st-iconbtn lp-back"
          data-testid="canvases-trash-back"
          aria-label="Back to Canvases"
          onClick={onBack}
        >
          <StIcon name="chevron-right" size={13} className="lp-back-ch" />
        </button>
        <strong className="lp-trash-title">Trash</strong>
        {entries.length ? <span className="lp-count">{trash.total}</span> : null}
      </div>
      <div className="lp-trash-list">
        {entries.length === 0 ? (
          <div className="lp-empty" data-testid="canvases-trash-empty">
            <p className="lp-empty-t">Trash is empty.</p>
            <p className="lp-empty-b">
              Canvases and artboards you move to the trash wait here until you clear them out.
            </p>
          </div>
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
        {trash && trash.total > 200 ? (
          <p className="lp-more">…and {trash.total - 200} more in _trash/</p>
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
        <span>{entries.length ? trashSummary(trash) : 'Kept until you clear it out.'}</span>
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
