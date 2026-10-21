// client/v2/ds/review-sheet.jsx — S10.8: "Update N canvases" (13 · ds-edit-review, ds-edit-master).
//
// Edits to the design system wait as pending; this sheet is the one place they reach the canvases. Every canvas
// has a tick: a canvas that follows the system is ticked, one left out earlier is not, a pinned one cannot be
// ticked and says why. The primary button counts what is ticked ("Update 4 canvases"); the title asks with the
// same verb. Cancel puts the swatch back — it drops what waited, and no canvas changes. Esc only closes the
// sheet: what waits keeps waiting, so closing by habit never throws an edit away.
//
// The sheet draws what it is given and asks the host for two things: `onUpdate(rows)` and `onCancel()`. Both
// resolve to `{ ok: true }` or `{ ok: false, message }`; a refusal is printed under the list, in words.
// Sheet only: the host (review-host.jsx) fetches the review, the usage counts and does the writes.

import { useMemo, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  defaultTicks,
  FOLDER_VIEW_FROM,
  finePrint,
  fineInBoth,
  folderNote,
  groupByFolder,
  headWords,
  keepsWords,
  nameOf,
  noteFor,
  primaryWords,
  REVIEW_WORDS,
  reviewTitle,
  rowsOf,
  tickState,
  themeValue,
  withTicks,
} from './review-model.js';

// A value that is safe to paint as a chip: a plain colour, never a `url()` or anything that can load.
const COLOUR =
  /^(?:#[0-9a-f]{3,8}|(?:oklch|oklab|rgb|rgba|hsl|hsla|lab|lch|color|color-mix)\([^;{}]*\)|[a-z]{3,20})$/i;
export const safeColour = (v) =>
  typeof v === 'string' && !/url\s*\(/i.test(v) && COLOUR.test(v.trim()) ? v.trim() : null;

export function Tick({ state, disabled, label, testid, onToggle, path, folder }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'mixed' ? 'mixed' : state === 'all' || state === true}
      aria-label={label}
      disabled={disabled}
      className="dsr-tick"
      data-state={state === true ? 'all' : state === false ? 'none' : state}
      data-testid={testid}
      data-path={path}
      data-folder={folder}
      onClick={onToggle}
    >
      <StIcon name="check" size={12} />
    </button>
  );
}

/** One changed value, before → after. A colour draws as a chip; anything else as its words. */
function Delta({ change, view }) {
  const b = themeValue(change.before);
  const a = themeValue(change.after);
  const cb = safeColour(b);
  const ca = safeColour(a);
  const shown = view === 'before' ? { v: b, c: cb } : { v: a, c: ca };
  return (
    <span className="dsr-sw-pair" data-view={view}>
      {cb || ca ? (
        <>
          <span
            className="dsr-chip"
            style={cb ? { background: cb } : undefined}
            data-testid="ds-review-chip-before"
          />
          <StIcon name="chevron-right" size={12} />
          <span
            className="dsr-chip"
            style={ca ? { background: ca } : undefined}
            data-testid="ds-review-chip-after"
          />
        </>
      ) : (
        <em data-testid="ds-review-value">{`${b ?? '—'} → ${a ?? 'removed'}`}</em>
      )}
      <span className="dsr-shown" hidden data-testid="ds-review-shown">
        {shown.v ?? ''}
      </span>
    </span>
  );
}

export function RowView({ row, keeps, onToggle, cover }) {
  const off = !row.ticked;
  return (
    <span
      className="dsr-row"
      data-off={off ? 'true' : undefined}
      data-locked={row.locked ? 'true' : undefined}
      data-state={row.state}
      data-testid="ds-review-row"
      data-path={row.path}
    >
      <Tick
        state={row.ticked}
        disabled={row.locked}
        label={`Update ${row.name}`}
        testid="ds-review-tick"
        path={row.path}
        onToggle={() => onToggle(row.path)}
      />
      <span className="dsr-thumb" aria-hidden="true">
        {cover ? <img src={cover} alt="" /> : null}
      </span>
      <span className="dsr-name">
        <b>{row.name}</b>
        <em data-testid="ds-review-note">{noteFor(row, { keeps })}</em>
      </span>
    </span>
  );
}

/**
 * @param {{
 *   review: { system: string, expectHead: string | null, changes: any[], canvases: any[] },
 *   components?: string[], places?: Record<string, number>, scope?: string,
 *   openBy?: { name: string, canvas: string } | null,
 *   coverOf?: (path: string) => string | null,
 *   onUpdate: (rows: any[]) => Promise<{ ok: boolean, message?: string }>,
 *   onCancel: () => Promise<{ ok: boolean, message?: string }>,
 *   onClose: () => void,
 * }} props
 */
export function DsReviewSheet({
  review,
  components = [],
  places = {},
  scope = '',
  openBy = null,
  coverOf,
  onUpdate,
  onCancel,
  onClose,
}) {
  const base = useMemo(() => rowsOf(review.canvases, places), [review.canvases, places]);
  const [ticks, setTicks] = useState(() => defaultTicks(base));
  const [view, setView] = useState('after');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });

  const rows = useMemo(() => withTicks(base, ticks), [base, ticks]);
  const n = rows.filter((r) => r.ticked).length;
  const state = tickState(rows);
  const grouped = rows.length > FOLDER_VIEW_FROM;
  const groups = useMemo(() => (grouped ? groupByFolder(rows) : []), [grouped, rows]);
  const keeps = keepsWords(review.changes);
  const title = reviewTitle({ changes: review.changes, components });
  const shown = review.changes.slice(0, 3);
  const fine = review.changes.length > 0 && review.changes.every(fineInBoth);

  const flip = (paths, to) =>
    setTicks((t) => {
      const next = { ...t };
      for (const p of paths) next[p] = to;
      return next;
    });
  const toggle = (path) => flip([path], !ticks[path]);
  const toggleGroup = (g) => {
    const free = g.rows.filter((r) => !r.locked).map((r) => r.path);
    flip(free, g.state !== 'all');
  };
  const toggleAll = () =>
    flip(
      rows.filter((r) => !r.locked).map((r) => r.path),
      state !== 'all'
    );

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    setError('');
    let res;
    try {
      res = await fn();
    } catch {
      res = { ok: false, message: REVIEW_WORDS.failed };
    }
    setBusy(false);
    if (res?.ok === false) setError(res.message || REVIEW_WORDS.failed);
  };

  const list = (items) =>
    items.map((r) => (
      <RowView
        key={r.path}
        row={r}
        keeps={keeps}
        onToggle={toggle}
        cover={coverOf ? coverOf(r.path) : null}
      />
    ));

  return (
    <div className="dsr-scrim" data-testid="ds-review-scrim">
      <div
        ref={ref}
        className="island dsr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-review-title"
        tabIndex={-1}
        data-testid="ds-review"
        data-view={view}
      >
        <h2 id="ds-review-title" className="dsr-title" data-testid="ds-review-title">
          {title}
        </h2>
        <div className="dsr-body">
          <div className="dsr-sw" data-testid="ds-review-swatch">
            {shown.map((c) => (
              <p key={c.css} className="dsr-sw-line" data-css={c.css}>
                <Delta change={c} view={view} />
                <b>{nameOf(c)}</b>
                {fineInBoth(c) && shown.length === 1 ? (
                  <span className="dsr-ok" data-testid="ds-review-ok">
                    <StIcon name="check" size={12} />
                    {REVIEW_WORDS.fine}
                  </span>
                ) : null}
              </p>
            ))}
            {components.map((c) => (
              <p key={`c-${c}`} className="dsr-sw-line" data-component={c}>
                <b>{c}</b>
              </p>
            ))}
            {review.changes.length > shown.length ? (
              <p className="dsr-more">{`and ${review.changes.length - shown.length} more`}</p>
            ) : null}
            {fine && shown.length > 1 ? (
              <span className="dsr-ok" data-testid="ds-review-ok">
                <StIcon name="check" size={12} />
                {REVIEW_WORDS.fine}
              </span>
            ) : null}
          </div>

          <p className="dsr-head">
            <Tick
              state={state}
              disabled={rows.every((r) => r.locked)}
              label="Update every canvas"
              testid="ds-review-head-tick"
              onToggle={toggleAll}
            />
            <b data-testid="ds-review-head">{headWords(rows, scope)}</b>
            {grouped ? (
              <span className="dsr-by">{REVIEW_WORDS.byFolder}</span>
            ) : (
              <span className="seg dsr-seg" role="group" aria-label="Show the canvases">
                {['before', 'after'].map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="k-seg-b"
                    aria-pressed={view === v}
                    data-testid={`ds-review-seg-${v}`}
                    onClick={() => setView(v)}
                  >
                    {REVIEW_WORDS[v]}
                  </button>
                ))}
              </span>
            )}
          </p>

          <div
            className="dsr-list"
            data-testid="ds-review-list"
            data-grouped={grouped || undefined}
          >
            {grouped
              ? groups.map((g) => (
                  <div key={g.folder || '.'} className="dsr-group" data-folder={g.folder}>
                    <span
                      className="dsr-row dsr-folder"
                      data-off={g.state === 'none' ? 'true' : undefined}
                      data-testid="ds-review-folder"
                      data-folder={g.folder}
                    >
                      <Tick
                        state={g.state}
                        disabled={g.rows.every((r) => r.locked)}
                        label={`Update ${g.folder || 'the top level'}`}
                        testid="ds-review-folder-tick"
                        folder={g.folder}
                        onToggle={() => toggleGroup(g)}
                      />
                      <StIcon name="folder" size={14} />
                      <span className="dsr-name">
                        <b>{g.folder || 'Top level'}</b>
                      </span>
                      <em className="dsr-count">{folderNote(g)}</em>
                    </span>
                    {g.state !== 'all' ? <div className="dsr-in">{list(g.rows)}</div> : null}
                  </div>
                ))
              : list(rows)}
          </div>

          <p className="dsr-fine" data-testid="ds-review-fine">
            {finePrint({ changes: review.changes, openBy })}
          </p>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-review-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="ds-review-cancel"
            onClick={() => run(onCancel)}
          >
            {REVIEW_WORDS.cancel}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-testid="ds-review-update"
            onClick={() => run(() => onUpdate(rows))}
          >
            {primaryWords(n)}
          </button>
        </div>
      </div>
    </div>
  );
}
