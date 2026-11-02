// client/v2/left-panel/trash-view.jsx — the Trash view (kit 11 · pn-trash, 05 · es-panels-make "Trash — empty").
//
// S1.8: the SHARED Trash — canvases and artboards moved to the trash, with who and when, grouped Today /
// Earlier (GET /_api/trash, use-trash.js). Restore is on every row (it is the primary button, shown on
// hover / focus); "Clear out…" is in the foot and only an owner sees it (`canClear` — a hint: hidden is not
// refused, the server still answers 403 and the view says so). Clear out asks first, in the contract's
// words. An artboard's Restore is the splice of S1.13: until it lands the server answers 501 `not-yet` and
// the view shows that line quietly.
//
// `legacy` (an older team server, a legacy-mode project) falls back to today's per-Mac list — the very
// same component Canvases › Advanced › "Kept on this Mac" shows (canvases/kept-on-this-mac.jsx).
//
// S10.21b: `tokens` are the design-system tokens moved to the trash (door-write.js `trashedTokenItems`, from
// GET /_api/ds/state). They are rows like the others (`data-kind="token"`): Restore is `ds.restore-token`, and an
// owner's Clear out… clears them too (`ds.clear-token`, one per token).

import { useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { KeptOnThisMac } from '../canvases/kept-on-this-mac.jsx';
import { Empty } from '../empty/index.js';
import { clearTokenNow, restoreTokenNow } from '../ds/door-write.js';
import { clearOut, restoreItem } from './use-trash.js';
import {
  clearOutcome,
  clearOutDialog,
  groupTrash,
  itemName,
  itemSub,
  restoreOutcome,
  TRASH_FOOT,
  trashHeadCount,
} from './trash-model.js';

export { CLEAR_OUT_KEEPS_DAYS } from '../canvases/kept-on-this-mac.jsx';

/**
 * `trash` is useTrash()'s state. `projectName` is the team's name for a shared project (the confirm says
 * "for everyone on …"); `people` maps an actor id to a name when the server sent no `who`; `roots` are the
 * project's canvas groups (design-root-relative) — a row names its folder without them ("legacy", not "ui/legacy").
 */
const tokenOutcome = (r) => ({ ok: r.ok, tone: r.ok ? 'quiet' : 'warn', line: r.message });

/**
 * Clear out: the shared Trash (`trash.clear`) when it holds anything, then each token (`ds.clear-token`). Without
 * tokens the answer is the shared one, word for word.
 */
async function clearAll(items) {
  const toks = items.filter((it) => it.kind === 'token');
  const shared = items.length > toks.length;
  const res = shared ? await clearOut() : null;
  const said = res ? clearOutcome(res) : null;
  if (!toks.length || (said && (!said.ok || res.body?.queued))) return said;
  let n = res && Array.isArray(res.body?.cleared) ? res.body.cleared.length : 0;
  const left = res && Array.isArray(res.body?.skipped) ? res.body.skipped.length : 0;
  for (const t of toks) {
    const r = await clearTokenNow(t);
    if (!r.ok) return tokenOutcome(r);
    n += 1;
  }
  return {
    ok: true,
    tone: 'quiet',
    line: `Cleared out ${n}.${left ? ` ${left} left as ${left === 1 ? 'it was' : 'they were'}.` : ''}`,
  };
}

export function TrashView({
  trash,
  readOnly = false,
  projectName = '',
  people,
  roots,
  onBack,
  onChanged,
  now,
  tokens = [],
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [asking, setAsking] = useState(false);
  const legacy = trash?.legacy === true;
  const time = (it) => (typeof it.at === 'number' ? it.at : Date.parse(it.at) || 0);
  const items = tokens.length
    ? [...(trash?.items ?? []), ...tokens].sort((a, b) => time(b) - time(a))
    : (trash?.items ?? []);
  const groups = groupTrash(items, now);
  const head = legacy ? '' : trashHeadCount(items);
  const dialog = clearOutDialog(items, projectName);

  const restore = async (item) => {
    setBusy(true);
    setNote(null);
    const out =
      item.kind === 'token'
        ? tokenOutcome(await restoreTokenNow(item))
        : restoreOutcome(item, await restoreItem(item.id));
    setBusy(false);
    setNote(out);
    await onChanged?.();
  };

  const clear = async () => {
    setAsking(false);
    setBusy(true);
    setNote(null);
    const out = await clearAll(items);
    setBusy(false);
    setNote(out);
    await onChanged?.();
  };

  return (
    <div className="lp-trash" data-testid="canvases-trash" data-mode={legacy ? 'legacy' : 'shared'}>
      <div className="lp-trash-hd">
        <button
          type="button"
          className="sh-iconbtn lp-back"
          data-testid="canvases-trash-back"
          aria-label="Back to Canvases"
          onClick={onBack}
        >
          <StIcon name="chevron-right" size={13} className="lp-back-ch" />
        </button>
        <strong className="lp-trash-title">Trash</strong>
        {legacy ? (
          trash?.entries?.length ? (
            <span className="lp-count">{trash.total}</span>
          ) : null
        ) : head ? (
          <span className="lp-count" data-testid="canvases-trash-count">
            {head}
          </span>
        ) : null}
      </div>
      {legacy ? (
        <KeptOnThisMac kept={trash?.kept ?? null} readOnly={readOnly} onChanged={onChanged} />
      ) : (
        <>
          <div className="lp-trash-list">
            {items.length === 0 ? (
              // 05 es-panels-make: the kit's block (glyph tile, Rounded situation line), not a left-aligned note
              <Empty
                copyId="es-panels-make.trash-empty"
                glyph="trash"
                testid="canvases-trash-empty"
              />
            ) : (
              groups.map((g) => (
                <section
                  key={g.key}
                  className="lp-trash-group"
                  data-testid={`canvases-trash-group-${g.key}`}
                  aria-label={g.title}
                >
                  <h3 className="lp-trash-grp">{g.title}</h3>
                  <ul className="lp-ul">
                    {g.items.map((it) => (
                      <li
                        key={it.id}
                        className="lp-row lp-trash-item"
                        data-testid="canvases-trash-item"
                        data-kind={it.kind}
                        data-id={it.id}
                      >
                        <span className="cv-thumb lp-trash-thumb" aria-hidden="true" />
                        <span className="lp-two">
                          <span className="lp-name" title={it.path ?? it.css}>
                            {itemName(it)}
                          </span>
                          <span className="lp-sub" data-testid="canvases-trash-sub">
                            {itemSub(it, { people, now, roots })}
                          </span>
                        </span>
                        {!readOnly ? (
                          <button
                            type="button"
                            className="btn btn--sm btn--primary lp-restore"
                            data-testid="canvases-trash-restore"
                            disabled={busy}
                            onClick={() => restore(it)}
                          >
                            Restore
                          </button>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
          {asking ? (
            <div
              className="lp-ask"
              role="alertdialog"
              aria-label={dialog.title}
              data-testid="canvases-trash-ask"
            >
              <p className="lp-ask-t">{dialog.title}</p>
              <p className="lp-ask-b" data-testid="canvases-trash-ask-body">
                {dialog.body}
              </p>
              <div className="lp-ask-actions">
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  data-testid="canvases-trash-clear-cancel"
                  onClick={() => setAsking(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn--danger btn--sm"
                  data-testid="canvases-trash-clear-yes"
                  disabled={busy}
                  onClick={clear}
                >
                  {dialog.primary}
                </button>
              </div>
            </div>
          ) : null}
          {note ? (
            <p
              className={`lp-note${note.tone === 'warn' ? ' lp-note--err' : ''}`}
              role="status"
              data-testid="canvases-trash-note"
              data-outcome={note.notYet ? 'not-yet' : note.ok ? 'ok' : 'refused'}
            >
              {note.line}
            </p>
          ) : null}
          {trash?.unreachable ? (
            <p className="lp-note" role="status" data-testid="canvases-trash-unreachable">
              The team server did not answer. This is the list from a moment ago.
            </p>
          ) : null}
          <div className="lp-trash-foot" data-testid="canvases-trash-foot">
            <span>{TRASH_FOOT}</span>
            {trash?.canClear && !readOnly && items.length ? (
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
        </>
      )}
    </div>
  );
}
