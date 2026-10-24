// client/v2/kinds/ConvertDialog.jsx — S7.25: "Make “Oznámení události” an A6 print?" (08 ak-convert, ak-convert-after).
//
// Picking a paper in a fixed size's Size select asks first: what converts, where the extra height goes, what to check, and that the
// post stays as it was — the A6 is made from a COPY (the switch). One primary ("Make A6 print"), Cancel (or esc) changes nothing.
// The plan's words are computed from `planConvert` (kinds/convert.ts — the server's module, so what is said here is what is written);
// only the "Check after" list waits for a render of the post, and a render that cannot run says so in one quiet line.
//
// After it: a toast — "The A6 copy is beside the post. The post is unchanged." + Undo (one ⌘Z step: the write is one request) —
// and the new artboard carries its warnings in the same style as every other (Replace… · Show).

import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check } from 'lucide-react';

import { notify } from '../../../notifications.tsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { fetchCheck, runConvert } from './convert-api.js';

export const CONVERT_WORDS = Object.freeze({
  checkAfter: 'Check after',
  checking: 'Checking the pictures and the cut…',
  nothing: 'Nothing to check.',
  unmeasured: 'The pictures and the cut can’t be checked right now.',
  keep: (paper) => `Keep the post; make the ${paper} from a copy`,
  cancel: 'Cancel',
  failed: 'Not changed; try again.',
  toastCopy: (paper, word) => `The ${paper} copy is beside the ${word}. The ${word} is unchanged.`,
  undo: 'Undo',
});

/** The toast after a conversion: one line, one action. */
export function notifyConverted({ plan, copy, onUndo, sourceWord = 'artboard' }) {
  notify({
    id: 'convert-kind',
    kind: 'undo',
    // 08: the toast wears the copy glyph, not the undo/reload one — it says a copy was made
    icon: copy ? 'duplicate' : undefined,
    title: copy
      ? CONVERT_WORDS.toastCopy(plan.paperName, sourceWord)
      : `Now ${/^[AEIOU8]/i.test(plan.paperName) ? 'an' : 'a'} ${plan.paperName} print.`,
    action: { label: CONVERT_WORDS.undo, onClick: onUndo },
  });
}

/**
 * @param {{ plan: any, canvas: string, artboardId: string, paper: string, orientation?: string,
 *   onClose: () => void, onDone?: (r: any) => void, onUndo?: () => void }} props
 */
export default function ConvertDialog({
  plan,
  canvas,
  artboardId,
  paper,
  orientation,
  sourceWord,
  onClose,
  onDone,
  onUndo,
}) {
  const [keep, setKeep] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [check, setCheck] = useState(null); // null = still looking
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });

  useEffect(() => {
    let live = true;
    fetchCheck({ canvas, artboard: artboardId, paper, orientation }).then((r) => {
      if (live) setCheck(r);
    });
    return () => {
      live = false;
    };
  }, [canvas, artboardId, paper, orientation]);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await runConvert({
      canvas,
      artboard: artboardId,
      paper,
      orientation,
      keepOriginal: keep,
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.message || CONVERT_WORDS.failed);
      return;
    }
    notifyConverted({ plan, copy: !!r.copy, sourceWord, onUndo: onUndo ?? (() => {}) });
    onDone?.(r);
    onClose();
  };

  return (
    <div className="kcv-scrim" data-testid="convert-scrim">
      <div
        ref={ref}
        className="island kcv-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="convert-title"
        tabIndex={-1}
        data-testid="convert-dialog"
      >
        <h2 id="convert-title" className="kcv-title" data-testid="convert-title">
          {plan.title}
        </h2>
        <div className="kcv-body">
          <p className="kcv-p" data-testid="convert-lead">
            {plan.lead}
          </p>
          <p className="kcv-h">{CONVERT_WORDS.checkAfter}</p>
          <div className="kcv-checks" data-testid="convert-check" aria-live="polite">
            {check === null ? (
              <p className="kcv-quiet">{CONVERT_WORDS.checking}</p>
            ) : check.check.length ? (
              check.check.map((w) => (
                <p
                  key={w.id}
                  className="kcv-line"
                  data-testid="convert-check-line"
                  data-code={w.code}
                >
                  <AlertTriangle size={13} aria-hidden="true" />
                  {w.text}
                </p>
              ))
            ) : (
              <p className="kcv-quiet">
                {check.measured ? CONVERT_WORDS.nothing : CONVERT_WORDS.unmeasured}
              </p>
            )}
          </div>
          {plan.note ? (
            <p className="kcv-note" data-testid="convert-note">
              <Check size={13} aria-hidden="true" />
              {plan.note}
            </p>
          ) : null}
          <label className="kcv-switch">
            <input
              type="checkbox"
              className="st-cp-switch"
              checked={keep}
              data-testid="convert-keep"
              onChange={(e) => setKeep(e.target.checked)}
            />
            <span>{CONVERT_WORDS.keep(plan.paperName)}</span>
          </label>
          {error ? (
            <p className="kcv-err" role="alert" data-testid="convert-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="kcv-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="convert-cancel"
            onClick={onClose}
          >
            {CONVERT_WORDS.cancel}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-testid="convert-go"
            onClick={go}
          >
            {plan.primary}
          </button>
        </div>
      </div>
    </div>
  );
}
