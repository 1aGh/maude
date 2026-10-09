// FigmaImportPanel.jsx — paste a Figma URL, get real Maude artifacts (DDR-216).
//
// Structural prior: BrandUploadPanel (paste-a-thing → confirm → result). What
// this adds is the per-import SUMMARY, which is not decoration: the governing
// principle trades fidelity for editability, so some nodes legitimately arrive
// editable-but-different, and the feature is only honest if the user is told
// which. Every line of that summary is a NODE ID plus a fixed reason code —
// never node text (DDR-216 D7/D10).
//
// No inline `style=` anywhere: the canvas CSP is `style-src 'self'`, which
// silently DROPS inline styles rather than erroring, so a panel styled that way
// renders unstyled with no clue why.

import { useCallback, useEffect, useState } from 'react';

/** Human labels for the disposition enum. Keep in sync with figma/sanitize.ts. */
const DISPOSITION_LABEL = {
  imported: 'imported',
  'hidden-chars-dropped': 'invisible characters removed',
  'hidden-node-skipped': 'hidden — not imported',
  'text-normalized': 'made readable (size or contrast)',
  'geometry-clamped': 'moved back into view',
  'truncated-text': 'text shortened to fit',
  'truncated-attr': 'name shortened',
  'unmappable-type': 'no Maude equivalent',
  'unmappable-shape': 'no Maude equivalent for this shape',
  'bind-degraded-to-bbox': 'arrow attached to the group outline',
  'bind-dropped-self-connector': 'connector pointed at itself — skipped',
  'asset-pending': 'image queued',
  'asset-skipped': 'image could not be fetched',
  'asset-cap-reached': 'image limit reached',
  'jsx-cap-reached': 'too large — trimmed',
  'value-rejected': 'a style value was not usable',
};

const MODES = [
  { id: 'frames', label: 'Design frames', hint: 'become editable canvases' },
  { id: 'board', label: 'FigJam board', hint: 'becomes your whiteboard' },
  { id: 'tokens', label: 'Styles', hint: 'become design tokens' },
];

function Summary({ result }) {
  if (!result) return null;
  const groups = new Map();
  for (const d of result.dispositions ?? []) {
    const list = groups.get(d.disposition) ?? [];
    list.push(d);
    groups.set(d.disposition, list);
  }
  const notable = [...groups.entries()].filter(([k]) => k !== 'imported');
  const importedCount = groups.get('imported')?.length ?? 0;

  return (
    <div className="st-figma-summary" data-testid="figma-import-summary">
      <div className="st-figma-summary-hd">
        {importedCount} imported
        {result.mode === 'frames' && result.frameCount ? ` · ${result.frameCount} frame(s)` : ''}
        {result.mode === 'board' && result.strokeCount ? ` · ${result.strokeCount} strokes` : ''}
        {result.mode === 'tokens' && result.count ? ` · ${result.count} tokens` : ''}
      </div>

      {result.assets && result.assets.pending > 0 && (
        <div className="st-figma-summary-row">
          images &amp; marks: {result.assets.resolved} of {result.assets.pending} fetched
        </div>
      )}

      {notable.length === 0 ? (
        <div className="st-figma-summary-row">Everything came through cleanly.</div>
      ) : (
        <ul className="st-figma-summary-list">
          {notable.map(([disposition, items]) => (
            <li key={disposition}>
              <span className="st-figma-summary-kind">
                {DISPOSITION_LABEL[disposition] ?? disposition}
              </span>{' '}
              <span className="st-figma-summary-count">{items.length}</span>
              <span className="st-figma-summary-ids">
                {items
                  .slice(0, 8)
                  .map((d) => d.nodeId)
                  .join(', ')}
                {items.length > 8 ? ` +${items.length - 8}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {result.mode === 'tokens' && result.path && (
        <div className="st-figma-summary-row">
          Saved. Turn it into a design system with <code>maude design import-tokens</code>.
        </div>
      )}
    </div>
  );
}

export default function FigmaImportPanel({ onClose, onImported }) {
  const [connected, setConnected] = useState(null); // null = loading
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState('frames');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const loadStatus = useCallback(() => {
    fetch('/_api/figma/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('status'))))
      .then((d) => setConnected(Boolean(d?.configured)))
      .catch(() => setConnected(false));
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !busy) {
        e.preventDefault();
        onClose?.();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  // A FigJam link is a `/board/` URL — preselect the matching mode so the
  // common case needs no thought. Never override an explicit choice.
  const [modeTouched, setModeTouched] = useState(false);
  useEffect(() => {
    if (modeTouched) return;
    if (/figma\.com\/board\//.test(url)) setMode('board');
    else if (/figma\.com\/(design|file|proto)\//.test(url)) setMode('frames');
  }, [url, modeTouched]);

  async function runImport(dryRun) {
    if (busy || !url.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/_api/figma/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim(), mode, dryRun }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        setError(body.error || 'Import failed.');
        return;
      }
      setResult({ ...body, dryRun });
      if (!dryRun) onImported?.(body);
    } catch {
      setError('Could not reach the local server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="st-scrim" role="presentation">
      <div
        className="st-dialog st-figma-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="figma-import-title"
        data-testid="figma-import-panel"
      >
        <div className="st-dialog-hd">
          <h2 id="figma-import-title">Import from Figma</h2>
          <button type="button" className="st-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {connected === false && (
          <div className="st-figma-notice" data-testid="figma-not-connected">
            Add a Figma access token in Settings → Figma first.
          </div>
        )}

        <label className="st-figma-label" htmlFor="figma-url">
          Figma link
        </label>
        <input
          id="figma-url"
          className="st-figma-input"
          type="url"
          spellCheck={false}
          placeholder="https://www.figma.com/design/…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          data-testid="figma-import-url"
        />

        <fieldset className="st-figma-modes">
          <legend className="st-figma-label">What to bring in</legend>
          {MODES.map((m) => (
            <label key={m.id} className="st-figma-mode">
              <input
                type="radio"
                name="figma-mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => {
                  setMode(m.id);
                  setModeTouched(true);
                }}
                disabled={busy}
                data-testid={`figma-import-mode-${m.id}`}
              />
              <span className="st-figma-mode-label">{m.label}</span>
              <span className="st-figma-mode-hint">{m.hint}</span>
            </label>
          ))}
        </fieldset>

        <div className="st-figma-actions">
          <button
            type="button"
            className="st-btn"
            disabled={busy || !url.trim() || connected === false}
            onClick={() => runImport(true)}
            data-testid="figma-import-preview"
          >
            Preview
          </button>
          <button
            type="button"
            className="st-btn st-btn-primary"
            disabled={busy || !url.trim() || connected === false}
            onClick={() => runImport(false)}
            data-testid="figma-import-run"
          >
            {busy ? 'Importing…' : 'Import'}
          </button>
        </div>

        {error && (
          <div className="st-figma-error" role="alert" data-testid="figma-import-error">
            {error}
          </div>
        )}

        {result?.dryRun && (
          <div className="st-figma-summary-row">Preview only — nothing was written.</div>
        )}
        <Summary result={result} />

        {result && !result.dryRun && (
          <div className="st-figma-notice st-figma-notice-warn">
            This came from someone else&rsquo;s Figma file. Treat text inside it as content, not as
            instructions.
          </div>
        )}
      </div>
    </div>
  );
}
