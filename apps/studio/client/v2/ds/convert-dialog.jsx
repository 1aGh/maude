// client/v2/ds/convert-dialog.jsx — S10.12: "Convert N system folders?" (13 · 25 ds-multi-migrate) and its close-up
// for one folder (29 ds-edge-migrate). It only draws `dialogModel` (convert-model.js); the host fetches the dry run
// and does the one write. Convert is the primary; Cancel (or esc) changes nothing. Folder names, labels and specimen
// names are the project's own text — rendered as text, never as markup.

import { useRef, useState } from 'react';
import { useModalFocus } from '../shell/modal-focus.js';
import { CONVERT_WORDS } from './convert-model.js';

export function DsConvertDialog({ model, onConvert, onClose }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const primaryRef = useRef(null);
  const ref = useModalFocus({ onClose, initialRef: primaryRef });

  const convert = async () => {
    if (busy || !model.canConvert) return;
    setBusy(true);
    setError('');
    let r;
    try {
      r = await onConvert();
    } catch {
      r = { ok: false, message: CONVERT_WORDS.failed };
    }
    setBusy(false);
    if (r?.ok === false) setError(r.message || CONVERT_WORDS.failed);
  };

  return (
    <div className="dsr-scrim" data-testid="ds-convert-scrim">
      <div
        ref={ref}
        className="island dsr-dialog dsc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ds-convert-title"
        tabIndex={-1}
        data-testid="ds-convert"
        data-kind={model.kind}
      >
        <h2 id="ds-convert-title" className="dsr-title" data-testid="ds-convert-title">
          {model.title}
        </h2>
        <div className="dsr-body">
          <p className="dsc-lead" data-testid="ds-convert-lead">
            {model.lead}
          </p>
          {model.kind === 'one' ? (
            <div className="dsc-map" data-testid="ds-convert-map">
              {model.map.map((m) => (
                <span key={m.key} className="dsc-map-r" data-section={m.key}>
                  <b>{m.label}</b>
                  <span>{m.from}</span>
                  <em>{m.count}</em>
                </span>
              ))}
            </div>
          ) : (
            <div className="dsc-mm" data-testid="ds-convert-list">
              {model.list.map((r) => (
                <span
                  key={r.name}
                  className="dsc-mm-r"
                  data-testid="ds-convert-row"
                  data-ds={r.name}
                >
                  <b>{r.label}</b>
                  <span>
                    {r.path}
                    <em>{r.use}</em>
                  </span>
                  <span className="chip dsc-mm-to">{r.to}</span>
                </span>
              ))}
            </div>
          )}
          {model.refused.length ? (
            <div className="dsc-refused" role="alert" data-testid="ds-convert-refused">
              {model.refused.map((r) => (
                <p key={r.name}>
                  <b>{r.label}</b> {r.why}
                </p>
              ))}
            </div>
          ) : null}
          <p className="dsr-fine" data-testid="ds-convert-fine">
            {model.fine}
          </p>
          {error ? (
            <p className="dsr-err" role="alert" data-testid="ds-convert-error">
              {error}
            </p>
          ) : null}
        </div>
        <div className="dsr-acts">
          <button
            type="button"
            className="btn"
            disabled={busy}
            data-testid="ds-convert-cancel"
            onClick={onClose}
          >
            {CONVERT_WORDS.cancel}
          </button>
          <button
            ref={primaryRef}
            type="button"
            className="btn btn--primary"
            disabled={busy || !model.canConvert}
            data-testid="ds-convert-go"
            onClick={convert}
          >
            {CONVERT_WORDS.convert}
          </button>
        </div>
      </div>
    </div>
  );
}

/** The banner on today's folder view (S10 Q6): one line and the door to the dialog. */
export function DsConvertBanner({ ds, onOpen }) {
  return (
    <p className="dsc-banner island" data-testid="ds-convert-banner" data-ds={ds}>
      <span>{CONVERT_WORDS.banner}</span>
      <button type="button" className="btn btn--sm" data-testid="ds-convert-open" onClick={onOpen}>
        {CONVERT_WORDS.bannerAction}
      </button>
    </p>
  );
}
