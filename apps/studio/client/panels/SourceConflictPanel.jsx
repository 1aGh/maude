// SourceConflictPanel — plan T28 (feature-reliable-project-multiplayer).
//
// A change the project could not merge stays on this device as the person's
// candidate; the project's version is what everyone else sees. This panel
// shows both, line by line, and turns the decision into an action:
//
//   • Keep mine   — proposes the local version ON TOP of the project's (a new
//                   accepted action; nothing is rewound, history keeps both);
//   • Use theirs  — the project's version returns to disk; the local one stays
//                   in the recovery slots;
//   • or close and keep editing — the next save is the resolution.
//
// No hashes, epochs or lane names: "Your version" / "The project's version".

import { useEffect, useMemo, useRef, useState } from 'react';

/** Line diff by longest common subsequence — bounded, for a canvas source. */
export function lineDiff(a, b, max = 2000) {
  const x = String(a ?? '').split('\n').slice(0, max);
  const y = String(b ?? '').split('\n').slice(0, max);
  const n = x.length;
  const m = y.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ kind: 'same', text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: 'mine', text: x[i++] });
    } else {
      out.push({ kind: 'theirs', text: y[j++] });
    }
  }
  while (i < n) out.push({ kind: 'mine', text: x[i++] });
  while (j < m) out.push({ kind: 'theirs', text: y[j++] });
  return out;
}

/** Collapse long runs of unchanged lines to a count, keeping 2 lines of context. */
function withContext(rows, ctx = 2) {
  const keep = rows.map((r, idx) => r.kind !== 'same' || rows.slice(Math.max(0, idx - ctx), idx + ctx + 1).some((q) => q.kind !== 'same'));
  const out = [];
  let skipped = 0;
  rows.forEach((r, idx) => {
    if (keep[idx]) {
      if (skipped) out.push({ kind: 'skip', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
      skipped = 0;
      out.push(r);
    } else skipped++;
  });
  if (skipped) out.push({ kind: 'skip', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
  return out;
}

export default function SourceConflictPanel({ slug, onClose }) {
  const [sides, setSides] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    fetch(`/_api/project/conflict?file=${encodeURIComponent(slug)}`)
      .then((r) => r.json().catch(() => ({})))
      .then((j) => {
        if (!alive) return;
        if (j.ok) setSides(j);
        else setError(j.error || 'This conflict is already resolved.');
      })
      .catch(() => alive && setError('Maude isn’t reachable right now.'));
    return () => {
      alive = false;
    };
  }, [slug]);

  useEffect(() => {
    const prev = document.activeElement;
    ref.current?.querySelector('button')?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);

  const rows = useMemo(() => (sides ? withContext(lineDiff(sides.mine ?? '', sides.theirs ?? '')) : []), [sides]);

  async function choose(choice) {
    setBusy(choice);
    setError('');
    try {
      const r = await fetch('/_api/project/conflict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: slug, choice }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) onClose(choice);
      else setError(j.code === 'base-conflict' ? 'Someone changed it again just now — look at the new version and choose again.' : j.error || 'That did not work.');
    } catch {
      setError('Maude isn’t reachable right now.');
    } finally {
      setBusy('');
    }
  }

  return (
    <div className="gi-modal" role="dialog" aria-modal="true" aria-labelledby="scp-title">
      <div className="gi-scrim" aria-hidden="true" onClick={() => onClose()} />
      <div className="gi-dialog scp-dialog" ref={ref} data-testid="source-conflict-panel">
        <div className="tp-dialog-head">
          <div>
            <h2 id="scp-title">Two versions of {slug}</h2>
            <p>Your change and a teammate’s touched the same lines. Nothing is lost — choose which one the project keeps.</p>
          </div>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onClose()} aria-label="Close" data-testid="source-conflict-close">
            ×
          </button>
        </div>
        {sides && (
          <>
            <div className="scp-legend" aria-hidden="true">
              <span className="scp-key scp-key--mine">Your version</span>
              <span className="scp-key scp-key--theirs">The project’s version</span>
            </div>
            <div className="scp-diff" role="region" aria-label="Differences" tabIndex={0} data-testid="source-conflict-diff">
              {rows.map((r, idx) => (
                <div key={idx} className={`scp-line scp-line--${r.kind}`}>
                  <span className="scp-mark" aria-hidden="true">
                    {r.kind === 'mine' ? '−' : r.kind === 'theirs' ? '+' : r.kind === 'skip' ? '⋯' : ' '}
                  </span>
                  <span className="sr-only">{r.kind === 'mine' ? 'Yours: ' : r.kind === 'theirs' ? 'Project: ' : ''}</span>
                  <code>{r.text || ' '}</code>
                </div>
              ))}
            </div>
          </>
        )}
        {error && (
          <p className="scp-error" role="alert" data-testid="source-conflict-error">
            {error}
          </p>
        )}
        <div className="scp-actions">
          <button type="button" className="btn btn--primary" disabled={!sides || !!busy} onClick={() => choose('mine')} data-testid="source-conflict-keep-mine">
            {busy === 'mine' ? 'Saving…' : 'Keep my version'}
          </button>
          <button type="button" className="btn" disabled={!sides || !!busy} onClick={() => choose('theirs')} data-testid="source-conflict-use-theirs">
            {busy === 'theirs' ? 'Updating…' : 'Use the project’s version'}
          </button>
          <span className="scp-hint">Or close this and edit the canvas — your next save resolves it.</span>
        </div>
      </div>
    </div>
  );
}
