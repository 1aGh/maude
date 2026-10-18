// client/v2/ai/Working.jsx — S5.9 (03 AI Chat `ai-working`): progress is ONE line, on the panel and on the
// canvas. The artboard wears a dashed spark and a tag (S5.11); the panel shows the same words here, with
// Stop. You keep working anywhere else.
//
//   <WorkingLine>     spark · "AI is making it greener" · the step under it · Stop
//   <RunLiveRegion>   the polite live region: each state of a run is announced once
//
// Presentational: RunSurface.jsx feeds it. The line is NOT itself a live region (a ticking clock inside
// one would be read every second); the sibling region says the words once.

import { useEffect, useState } from 'react';
import { Spark } from './icons.jsx';
import { clock } from './run-model.js';
import { StopGlyph } from './run-icons.jsx';

/** Live m:ss since the run started — a quiet sign that a long, output-quiet stretch is not stuck. */
export function useRunClock(startedAt, active) {
  const [, tick] = useState(0);
  const [local] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
  if (!active) return null;
  const since = typeof startedAt === 'number' && startedAt > 0 ? startedAt : local;
  const ms = Date.now() - since;
  return ms >= 1000 ? clock(ms) : null;
}

export function WorkingLine({ text, step, elapsed, onStop, stopping = false }) {
  return (
    <div className="ai-working" data-testid="ai-working">
      <span className="ai-working-spark" aria-hidden="true">
        <Spark size={14} />
      </span>
      <span className="ai-working-txt">
        <span className="ai-working-main" data-testid="ai-working-text">
          {text}
        </span>
        {step || elapsed ? (
          <span className="ai-step">
            {step}
            {step && elapsed ? ' · ' : ''}
            {elapsed ? <span className="ai-working-clock">{elapsed}</span> : null}
          </span>
        ) : null}
      </span>
      <button
        type="button"
        className="btn btn--ghost btn--sm ai-stop"
        data-testid="ai-stop"
        aria-label="Stop"
        disabled={stopping}
        onClick={onStop}
      >
        <StopGlyph size={12} />
        Stop
      </button>
    </div>
  );
}

/**
 * One polite region for the whole panel. `message` is `{ id, text }` — a new `id` re-mounts the node, so
 * the same words for a second run are read again; the same `id` renders the same node and is not.
 */
export function RunLiveRegion({ message }) {
  return (
    <div className="ai-sr-only" role="status" aria-live="polite" data-testid="ai-live">
      {message?.text ? <span key={message.id}>{message.text}</span> : null}
    </div>
  );
}
