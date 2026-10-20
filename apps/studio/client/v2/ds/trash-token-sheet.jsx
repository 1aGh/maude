// client/v2/ds/trash-token-sheet.jsx — S10.17: a colour that canvases use, moved to the trash (13 · ds-edge-trash,
// canvas 27).
//
// Moving a token to the trash never breaks a canvas: the canvases that use it switch to the closest colour still in
// the system (OKLab distance in every mode), and Restore from the Trash puts it back everywhere it was. The sheet says
// both in a sentence, shows the two chips, and has one primary — "Move to trash". A colour that cannot go (a main
// role of the system, a locked brand colour) or that has nothing to stand in for it is said so, with no primary.
//
// Draws only. `question` is the server's answer (`GET /_api/ds/nearest?css=`); `onConfirm(replacement)` resolves to
// `{ ok: true }` or `{ ok: false, message }`.

import { useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import { EDGE_WORDS, trashWords } from './edge-model.js';

const Chip = ({ value, testid }) => (
  <i
    className="ds-edge-chip"
    aria-hidden="true"
    data-testid={testid}
    style={{ background: value }}
  />
);

export function TrashTokenSheet({ question, swatch, onConfirm, onClose }) {
  const words = trashWords(question);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });
  const r = words.replacement;
  const go = async () => {
    if (busy || !words.canGo) return;
    setBusy(true);
    setError('');
    const res = await onConfirm(r.css);
    if (!res?.ok) {
      setBusy(false);
      setError(res?.message ?? EDGE_WORDS.failed);
    }
  };
  return (
    <div className="dsr-scrim" data-testid="ds-trash-scrim">
      <div
        ref={ref}
        className="island dsr-dialog ds-edge-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-trash-title"
        tabIndex={-1}
        data-testid="ds-trash"
        data-css={question?.css}
      >
        <h2 id="ds-trash-title" className="dsr-title" data-testid="ds-trash-title">
          {words.title}
        </h2>
        <div className="dsr-body">
          {words.blocked ? (
            <p data-testid="ds-trash-blocked">{words.blocked}</p>
          ) : (
            <>
              {words.lines.map((l) => (
                <p key={l} data-testid="ds-trash-line">
                  {l}
                </p>
              ))}
              <p className="ds-edge-pair" data-testid="ds-trash-pair">
                <Chip value={swatch ?? 'transparent'} testid="ds-trash-chip-from" />
                {question.label}
                <StIcon name="submenu" size={12} />
                <Chip value={r.value} testid="ds-trash-chip-to" />
                {r.label}
              </p>
              <p className="dsr-fine" data-testid="ds-trash-back">
                {words.back}
              </p>
            </>
          )}
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-trash-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="ds-trash-cancel"
            onClick={onClose}
          >
            {words.canGo ? EDGE_WORDS.cancel : EDGE_WORDS.close}
          </button>
          {words.canGo ? (
            <button
              ref={primaryRef}
              type="button"
              className="btn btn--primary"
              disabled={busy}
              data-testid="ds-trash-go"
              onClick={go}
            >
              {EDGE_WORDS.trash}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
