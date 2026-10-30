// client/v2/present/order-notes-sheet.jsx — S3.5: "Order and notes…" (Present ⌄, CONTRACT §6 [C31];
// not drawn — the order map and the Notes box of 04 md-presenter are what it feeds). Edit role only
// (`present.order-notes`, minRole edit); the server refuses everyone else the same way.
//
// One list, in the order Present plays it: a number per presented artboard, ↑ ↓ to move one (or ⌥↑ ⌥↓
// on the focused row), Skip to leave one out of the run (it stays on the canvas). The selected row's
// speaker notes sit under the list. Save sends only what changed, with the ETag it read, through
// `PATCH /_api/present-meta` — one save is one project action. esc / Cancel closes without saving.
//
// The caller passes the canvas's artboards in CANVAS order (order-notes-model.js says why).

import { useEffect, useMemo, useRef, useState } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  countsLine,
  initialModel,
  patchBody,
  runNumbers,
  setNote,
  stepRow,
  toCanvasOrder,
  toggleSkip,
} from './order-notes-model.js';

/** The one route this sheet talks to. `body` without changes = a read. */
export async function presentMetaRequest(body) {
  let res;
  try {
    res = await fetch('/_api/present-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { status: 0, data: null };
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/** What a failed save says. */
export function saveError(status) {
  if (status === 409)
    return 'These changed somewhere else while the sheet was open. Close it and open it again to see them.';
  if (status === 403) return 'Your role in this project can’t change the presentation.';
  if (status === 422)
    return 'An artboard here is no longer on the canvas. Close the sheet and open it again.';
  return 'Couldn’t save. Try again.';
}

export function OrderNotesSheet({
  file,
  canvasName,
  artboards,
  onClose,
  onSaved,
  request = presentMetaRequest,
}) {
  const [phase, setPhase] = useState('loading'); // loading | ready | failed | saving
  const [start, setStart] = useState(null);
  const [model, setModel] = useState(null);
  const [etag, setEtag] = useState(undefined);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState(null);
  const ref = useModalFocus({ onClose });
  const live = useRef(true);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the sheet reads once per open (per file)
  useEffect(() => {
    live.current = true;
    void request({ file }).then(({ status, data }) => {
      if (!live.current) return;
      if (status !== 200 || !data) {
        setPhase('failed');
        return;
      }
      const m = initialModel(artboards, data);
      setStart(m);
      setModel(m);
      setEtag(data.etag);
      setSelected(m.rows[0]?.id ?? null);
      setPhase('ready');
    });
    return () => {
      live.current = false;
    };
  }, [file]);

  const numbers = useMemo(() => (model ? runNumbers(model) : new Map()), [model]);
  const runTotal = model ? model.rows.filter((r) => !r.skipped).length : 0;
  const body = start && model ? patchBody(start, model) : null;
  const current = model?.rows.find((r) => r.id === selected) ?? null;

  const save = async () => {
    if (!body || phase !== 'ready') return;
    setPhase('saving');
    setError(null);
    const { status, data } = await request({ file, ...body, expected: etag });
    if (!live.current) return;
    if (status === 200) {
      onSaved?.(data);
      onClose?.();
      return;
    }
    setError(saveError(status));
    setPhase('ready');
  };

  const onRowKey = (e, id) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    e.stopPropagation();
    setModel((m) => stepRow(m, id, e.key === 'ArrowUp' ? -1 : 1));
  };

  return (
    <section
      ref={ref}
      tabIndex={-1}
      className="pon-sheet island"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pon-title"
      data-testid="present-order-notes"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void save();
        }
      }}
    >
      <header className="pon-top">
        <strong id="pon-title" className="pon-title">
          Order and notes
        </strong>
        {canvasName ? <span className="pon-canvas">{canvasName}</span> : null}
      </header>
      {phase === 'loading' ? <p className="pon-quiet">Loading…</p> : null}
      {phase === 'failed' ? (
        <p className="pon-quiet" role="alert" data-testid="present-order-error">
          Couldn’t read this canvas’s presentation. Close the sheet and try again.
        </p>
      ) : null}
      {model ? (
        <>
          <p className="pon-quiet">
            Present plays the artboards in this order. A skipped one stays on the canvas, out of the
            run.
          </p>
          <ol className="pon-list" aria-label="Present order">
            {model.rows.map((r, i) => {
              const n = numbers.get(r.id);
              return (
                <li
                  key={r.id}
                  className={`pon-row${r.id === selected ? ' is-selected' : ''}${r.skipped ? ' is-skipped' : ''}`}
                  data-testid={`present-order-row-${r.id}`}
                  aria-current={r.id === selected ? 'true' : undefined}
                >
                  <button
                    type="button"
                    className="pon-pick"
                    onClick={() => setSelected(r.id)}
                    onKeyDown={(e) => onRowKey(e, r.id)}
                    aria-current={r.id === selected ? 'true' : undefined}
                    aria-label={`${r.label}${r.skipped ? ', skipped' : `, ${n} of ${runTotal}`}${r.notes ? ', has notes' : ''}`}
                  >
                    <span className="pon-n" aria-hidden="true">
                      {r.skipped ? '–' : n}
                    </span>
                    <span className="pon-label">{r.label}</span>
                    {r.notes ? (
                      <span className="pon-has-notes" aria-hidden="true">
                        Notes
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost pon-step"
                    aria-label={`Move “${r.label}” up`}
                    data-testid={`present-order-up-${r.id}`}
                    disabled={i === 0 || phase === 'saving'}
                    onClick={() => setModel((m) => stepRow(m, r.id, -1))}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--ghost pon-step"
                    aria-label={`Move “${r.label}” down`}
                    data-testid={`present-order-down-${r.id}`}
                    disabled={i === model.rows.length - 1 || phase === 'saving'}
                    onClick={() => setModel((m) => stepRow(m, r.id, 1))}
                  >
                    ↓
                  </button>
                  {/* an artboard whose id cannot be stored cannot keep a skip: no Skip for it */}
                  {r.storable ? (
                    <button
                      type="button"
                      className="btn btn--sm btn--ghost pon-skip"
                      aria-pressed={r.skipped}
                      aria-label={`Skip “${r.label}”`}
                      data-testid={`present-order-skip-${r.id}`}
                      disabled={phase === 'saving'}
                      onClick={() => setModel((m) => toggleSkip(m, r.id))}
                    >
                      {r.skipped ? 'Skipped' : 'Skip'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ol>
          {current ? (
            <label className="pon-notes">
              <span className="pon-notes-hd">Notes · {current.label}</span>
              <textarea
                className="pon-notes-field"
                data-testid="present-order-notes-field"
                rows={4}
                placeholder="What to say here. Only presenter view shows it."
                value={current.notes}
                disabled={!current.storable || phase === 'saving'}
                onChange={(e) => {
                  const text = e.target.value;
                  setModel((m) => setNote(m, current.id, text));
                }}
              />
            </label>
          ) : null}
          {error ? (
            <p className="pon-error" role="alert" data-testid="present-order-error">
              {error}
            </p>
          ) : null}
          <footer className="pon-foot">
            <span className="pon-quiet" data-testid="present-order-counts">
              {countsLine(model)}
            </span>
            {model.custom ? (
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                data-testid="present-order-reset"
                disabled={phase === 'saving'}
                onClick={() => setModel((m) => toCanvasOrder(m))}
              >
                Use canvas order
              </button>
            ) : null}
            <span className="pon-gap" />
            <button
              type="button"
              className="btn btn--sm"
              data-testid="present-order-cancel"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--sm btn--primary"
              data-testid="present-order-save"
              disabled={!body || phase === 'saving'}
              onClick={() => void save()}
            >
              {phase === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </footer>
        </>
      ) : (
        <footer className="pon-foot">
          <span className="pon-gap" />
          <button
            type="button"
            className="btn btn--sm"
            data-testid="present-order-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        </footer>
      )}
    </section>
  );
}
