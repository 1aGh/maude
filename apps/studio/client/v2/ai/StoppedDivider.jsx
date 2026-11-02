// StoppedDivider.jsx — S5.14: "Stopped when the app quit · 6 Oct, 18:12" + Keep going at the
// end of a chat whose last run was stopped or cut off (03 `ai-quit` right, V2-1.15 §5.8, R10/R11).
//
// Reads YOUR runs (`GET /_api/ai/runs` → `mine`, this Mac's registry) for this chat. Keep going
// is a new ask in the same chat (`POST /_api/ai/runs/:id/keep-going` → `resumeOf`): it waits in
// line like any ask and is never automatic. The server refuses it for a view-only role
// (`readOnly: 'refused'`), so hiding is not the gate.

import { useCallback, useEffect, useState } from 'react';

import { stoppedLine, stoppedRunFor } from './stopped.js';

async function fetchMine() {
  try {
    const r = await fetch('/_api/ai/runs', { cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j?.mine) ? j.mine : null;
  } catch {
    return null;
  }
}

export function StoppedDivider({ chatId, hidden = false }) {
  const [run, setRun] = useState(null);
  const [state, setState] = useState('idle'); // idle | sending | failed

  const refresh = useCallback(async () => {
    const mine = await fetchMine();
    if (mine) setRun(stoppedRunFor(mine, chatId));
  }, [chatId]);

  // On mount (a relaunch lands here), on a chat switch, and when the thread is shown again.
  useEffect(() => {
    if (!hidden) void refresh();
  }, [hidden, refresh]);

  const keepGoing = useCallback(async () => {
    if (!run || state === 'sending') return;
    setState('sending');
    try {
      const r = await fetch(`/_api/ai/runs/${encodeURIComponent(run.runId)}/keep-going`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (!r.ok) throw new Error(String(r.status));
      setState('idle');
      setRun(null);
      void refresh();
    } catch {
      setState('failed');
    }
  }, [run, state, refresh]);

  const line = stoppedLine(run);
  if (!run || !line) return null;
  return (
    <div className="ai-stopped" data-testid="ai-stopped-divider" data-run={run.runId}>
      <p className="ai-stopped-rule">
        <span className="ai-stopped-line">{line}</span>
      </p>
      <div className="ai-stopped-actions">
        <button
          type="button"
          className="btn btn--sm"
          data-testid="ai-keep-going"
          data-action="ai.keep-going"
          disabled={state === 'sending'}
          onClick={keepGoing}
        >
          Keep going
        </button>
        {state === 'failed' ? (
          <span className="ai-stopped-note" role="status">
            Couldn't carry on. Try again.
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default StoppedDivider;
