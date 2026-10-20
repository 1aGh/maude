// client/v2/ds/off-system.jsx — S10.17: an off-system colour gets one quiet question (13 · ds-edge-suggest, canvas 28).
//
// A hand-picked colour on a changed line of a canvas that follows a design system: the system offers its closest
// colour — "Use Accent" — or to grow with the colour — "Add it to the system". A rule, not a judgement (S10 Q12): the
// server finds it (S1 literal finding on the changed lines) and names the closest colour by OKLab distance. One
// question at a time, quiet (role="status"), and "Not now" puts it away for the session.
//
// Draws only. `onUse()` / `onAdd()` resolve to `{ ok: true }` or `{ ok: false, message }`.

import { useState } from 'react';
import { EDGE_WORDS, offSystemWords } from './edge-model.js';

export function OffSystemQuestion({ finding, systemLabel, onUse, onAdd, onDismiss }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!finding) return null;
  const words = offSystemWords(finding, systemLabel);
  const run = (fn) => async () => {
    if (busy || !fn) return;
    setBusy(true);
    setError('');
    const r = await fn();
    setBusy(false);
    if (!r?.ok) setError(r?.message ?? EDGE_WORDS.failed);
  };
  return (
    <div
      className="island ds-edge-ask"
      role="status"
      aria-live="polite"
      data-testid="ds-off-system"
      data-literal={finding.literal}
    >
      <p className="ds-edge-ask-t" data-testid="ds-off-system-text">
        <i
          className="ds-edge-chip"
          aria-hidden="true"
          data-testid="ds-off-system-chip"
          style={{ background: finding.literal }}
        />
        {words.text}
      </p>
      <div className="ds-edge-ask-b">
        {words.canUse && finding.target ? (
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            data-testid="ds-off-system-use"
            onClick={run(onUse)}
          >
            {words.use}
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-testid="ds-off-system-add"
          onClick={run(onAdd)}
        >
          {EDGE_WORDS.add}
        </button>
        <button
          type="button"
          className="btn btn--quiet"
          disabled={busy}
          data-testid="ds-off-system-dismiss"
          onClick={onDismiss}
        >
          {EDGE_WORDS.dismiss}
        </button>
      </div>
      {error ? (
        <p className="dsr-err" role="alert" data-testid="ds-off-system-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
