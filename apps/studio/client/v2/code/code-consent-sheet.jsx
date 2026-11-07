// client/v2/code/code-consent-sheet.jsx — fix/207: the confirm sheet for shared code from the
// project's hub. `mode` 'allow' → "Allow shared code from <host>?" · Allow shared code / Cancel;
// 'stop' → "Stop allowing shared code from <host>?" · Stop allowing / Cancel. The primary runs
// `sync.allow-code` / `sync.stop-code` (POST /_api/sync/code-consent/set); `onDone(consent)` gets
// the server's new answer. Same dialog frame as the design-system sheets (`dsr-*`, review.css).

import { useRef, useState } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';
import { CONSENT_FAILED, consentWords, requestCodeConsent } from './code-consent.js';

export function CodeConsentSheet({
  mode = 'allow',
  host = '',
  onClose,
  onDone,
  fetchImpl = fetch,
}) {
  const words = consentWords(mode, host);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cancelRef = useRef(null);
  // Focus starts on Cancel: a yes to running code is pressed on purpose, never by a stray Return.
  const ref = useModalFocus({ onClose, initialRef: cancelRef });
  const go = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    const r = await requestCodeConsent(mode !== 'stop', fetchImpl);
    if (!r.ok) {
      setBusy(false);
      setError(r.message || CONSENT_FAILED);
      return;
    }
    onDone?.(r.consent);
  };
  return (
    <div className="dsr-scrim" data-testid="code-consent-scrim">
      <div
        ref={ref}
        className="island dsr-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="code-consent-title"
        tabIndex={-1}
        data-testid="code-consent-sheet"
        data-mode={mode}
      >
        <h2 id="code-consent-title" className="dsr-title" data-testid="code-consent-title">
          {words.title}
        </h2>
        <div className="dsr-body">
          {words.lines.map((l) => (
            <p key={l}>{l}</p>
          ))}
          {words.fine ? <p className="dsr-fine">{words.fine}</p> : null}
          {error ? (
            <p className="dsr-err" role="alert" data-testid="code-consent-error">
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
            data-testid="code-consent-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-action={mode === 'stop' ? 'sync.stop-code' : 'sync.allow-code'}
            data-testid="code-consent-go"
            onClick={go}
          >
            {words.go}
          </button>
        </div>
      </div>
    </div>
  );
}
