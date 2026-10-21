// client/v2/photo/apply-every-use-sheet.jsx — S8.15: "Apply … to every use?" (12 Import and Assets, ia-photo-steps).
//
// The explicit choice next to "Only this use changes": it names each canvas it would change, from the server's own
// answer (`GET /_api/photo-every-use?asset` → `{ uses, canApply, reason }`, read by the Photo section and handed in
// as `answer`), so the list is what the write would touch. Apply is `POST /_api/photo-every-use {asset, edit}`: the
// every-use file becomes this edit and every use that carried its own edit goes back to it (one undo step per canvas,
// server side). When the session may not change every canvas that shows the picture (G2) the server says so in
// `canApply: false` + `reason`; Apply is then disabled and the reason is the line under the list. Hidden ≠ refused:
// the POST is refused by the server either way.

import { useRef, useState } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';
import { sameCanvas } from './canvas-rel.js';
import { cutOutOn, LOOKS, lookOf } from './looks.js';

export const SHEET_WORDS = Object.freeze({
  cancel: 'Cancel',
  close: 'Close',
  apply: 'Apply to every use',
  applying: 'Applying…',
  fine: 'Each use can still be changed on its own afterwards. Undo works as anywhere.',
  failed: 'Not changed; try again.',
});

/** "Apply Punchy and the cut-out to every use?" */
export function sheetTitle(edit) {
  const id = lookOf(edit);
  const parts = [];
  if (id === null) parts.push('this edit');
  else if (id !== 'original') parts.push(LOOKS.find((l) => l.id === id)?.label ?? 'this edit');
  if (cutOutOn(edit)) parts.push('the cut-out');
  return `Apply ${parts.length ? parts.join(' and ') : 'the original'} to every use?`;
}

/** The rows the sheet names: the other canvases, or this one when it is the only one. */
export function sheetRows(answer, canvas, designRel) {
  const uses = Array.isArray(answer?.uses) ? answer.uses : [];
  const others = uses.filter((u) => !sameCanvas(u.canvas, canvas, designRel));
  return others.length ? others : uses;
}

export function sheetLead(name, more) {
  return more > 0
    ? `${name} is in ${more} more ${more === 1 ? 'canvas' : 'canvases'}. They change too:`
    : `Every use of ${name} changes:`;
}

const prune = (edit) => JSON.parse(JSON.stringify(edit ?? {}));

/**
 * @param {object} p
 * @param {string} p.asset
 * @param {string} p.name           the picture's file name
 * @param {string} [p.canvas]       the open canvas (repo- or design-root-relative)
 * @param {string} [p.designRel]    the design root (default `.design`)
 * @param {object} p.edit           the edit every use would get
 * @param {{ uses: Array<{canvas: string, name: string, artboards: string[], own: number}>, canApply: boolean, reason?: string }} p.answer
 * @param {Function} p.onClose
 * @param {Function} p.onApplied    (result) => void
 */
export function ApplyEveryUseSheet({
  asset,
  name,
  canvas,
  designRel,
  edit,
  answer,
  onClose,
  onApplied,
  fetchImpl = globalThis.fetch,
}) {
  const primaryRef = useRef(null);
  const cancelRef = useRef(null);
  const ref = useModalFocus({
    onClose,
    initialRef: answer?.canApply ? primaryRef : cancelRef,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const rows = sheetRows(answer, canvas, designRel);
  const more = (answer?.uses ?? []).filter((u) => !sameCanvas(u.canvas, canvas, designRel)).length;
  const refused = answer?.canApply ? '' : answer?.reason || SHEET_WORDS.failed;

  const apply = async () => {
    if (busy || refused || done) return;
    setBusy(true);
    setError('');
    let res = null;
    let j = null;
    try {
      res = await fetchImpl('/_api/photo-every-use', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ asset, edit: prune(edit) }),
      });
      j = await res.json().catch(() => null);
    } catch {
      j = null;
    }
    setBusy(false);
    if (!res?.ok || !j?.ok) {
      setError(j?.message || SHEET_WORDS.failed);
      return;
    }
    const missed = (j.canvases ?? []).filter((c) => !c.ok);
    if (missed.length) {
      const names = missed.map((c) =>
        String(c.canvas)
          .replace(/\.tsx$/i, '')
          .split('/')
          .pop()
      );
      setError(
        `Every use has it now except in ${names.join(', ')}: ${missed[0].message || SHEET_WORDS.failed}`
      );
      setDone(true);
      return;
    }
    onApplied?.(j);
  };

  return (
    <div className="dsr-scrim" data-testid="photo-every-use-scrim">
      <div
        ref={ref}
        className="island dsr-dialog ph-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-every-use-title"
        tabIndex={-1}
        data-testid="photo-every-use-sheet"
      >
        <h2 id="photo-every-use-title" className="dsr-title" data-testid="photo-every-use-title">
          {sheetTitle(edit)}
        </h2>
        <div className="dsr-body">
          <p className="dsr-head">{sheetLead(name, more)}</p>
          <ul className="ph-uselist">
            {rows.map((r) => (
              <li
                key={r.canvas}
                className="ph-use"
                data-testid="photo-every-use-row"
                data-canvas={r.canvas}
              >
                <strong>{r.name}</strong>
                {r.artboards?.length ? <span>{r.artboards.join(' · ')}</span> : null}
              </li>
            ))}
          </ul>
          {refused ? (
            <p
              className="ph-refused"
              data-tone="warn"
              role="note"
              data-testid="photo-every-use-refused"
            >
              {refused}
            </p>
          ) : null}
          <p className="dsr-fine">{SHEET_WORDS.fine}</p>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="photo-every-use-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            ref={cancelRef}
            type="button"
            className="btn"
            disabled={busy}
            data-testid="photo-every-use-cancel"
            onClick={onClose}
          >
            {done ? SHEET_WORDS.close : SHEET_WORDS.cancel}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn--primary"
            disabled={busy || !!refused || done}
            data-testid="photo-every-use-apply"
            onClick={() => void apply()}
          >
            {busy ? SHEET_WORDS.applying : SHEET_WORDS.apply}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ApplyEveryUseSheet;
