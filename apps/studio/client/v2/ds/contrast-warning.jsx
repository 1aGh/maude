// client/v2/ds/contrast-warning.jsx — S10.17: a change that breaks contrast (13 · ds-edge-contrast, canvas 26).
//
// A quiet warning with the fix as the action. The token inspector already says "3.1:1 on Pole and Hover in Dark" and
// blocks nothing; this adds the button that fixes it in one step — "Lighten to 4.5:1" moves only the colour's
// lightness (ds/contrast.ts `fixContrast`, the server judges it again) and the result waits as ONE edit, like any
// other — and a second quiet line, "Falls short in 3 canvases · Show", that walks the canvases that use it.
//
// Draws only. `onFix()` resolves to `{ ok: true }` or `{ ok: false, message }`; `onShow()` opens the reach view.

import { useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { Quiet } from '../inspector/sections/row.jsx';
import { EDGE_WORDS, shortWords } from './edge-model.js';

export function ContrastWarning({ line, offer, used, onFix, onShow }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  if (!line || line.ok) return null;
  const short = shortWords(used);
  const fix = async () => {
    if (busy || !onFix) return;
    setBusy(true);
    setNote('');
    const r = await onFix();
    setBusy(false);
    if (!r?.ok) setNote(r?.message ?? EDGE_WORDS.failed);
  };
  return (
    <>
      <div className="ds-edge-line">
        <p
          className="insp-quiet ds-tk-line ds-edge-warn"
          data-testid="ds-token-contrast"
          data-tone="warn"
        >
          <StIcon name="problem" size={12} /> {line.line}
        </p>
        {offer && onFix ? (
          <button
            type="button"
            className="ds-edge-act"
            disabled={busy}
            data-testid="ds-contrast-fix"
            onClick={fix}
          >
            {offer.label}
          </button>
        ) : null}
      </div>
      {short ? (
        <Quiet testid="ds-contrast-short">
          <StIcon name="layers" size={12} /> {short}
          {onShow ? (
            <>
              {' · '}
              <button
                type="button"
                className="ds-tk-show"
                data-testid="ds-contrast-show"
                onClick={onShow}
              >
                {EDGE_WORDS.show}
              </button>
            </>
          ) : null}
        </Quiet>
      ) : null}
      {note ? (
        <p
          className="insp-quiet ds-tk-note"
          role="status"
          data-testid="ds-contrast-note"
          data-tone="warn"
        >
          {note}
        </p>
      ) : null}
    </>
  );
}
