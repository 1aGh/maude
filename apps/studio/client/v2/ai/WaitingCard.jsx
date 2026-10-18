// client/v2/ai/WaitingCard.jsx — S5.11 (03 `ai-same-artboard`, `ai-queue-rule`): the second ask on a busy artboard.
//
//   Waiting for “Make it greener” to finish on Post 1:1.
//   Starts by itself, on top of its result.                         [ Run on a copy ]   ×
//
// One AI per artboard: the ask waits its turn and starts by itself when the holder finishes (the card turns into
// the working line then — it simply stops being a waiting run). "Run on a copy" skips the line: a duplicate
// lands beside the artboard and the ask runs on it. × cancels the ask — no turn ran. An estimate ("about a
// minute") is shown only when it was computed from the holder's elapsed time and your chat's median turn.

import { useEffect, useState } from 'react';
import { Clock, Duplicate, useBoardLabels } from './RunList.jsx';
import { estimateFor, waitingCopy, waitingOfChat } from './runs-model.js';
import { useAiRuns } from './runs-store.js';

/**
 * Run on a copy needs the server half (`POST /_api/ai/runs/:id/copy`: duplicate the accepted artboard beside
 * the original, re-scope the ask — V2-1.15 §5.7). It lands with its own slice; until then the button is not
 * drawn, because a button that answers 404 is worse than none. The store method and this card are ready.
 */
export const RUN_ON_COPY_LIVE = false;

export function WaitingCard({
  run,
  designRel,
  labels,
  estimate = null,
  copyLive = RUN_ON_COPY_LIVE,
  note = null,
  busy = false,
  onCancel,
  onCopy,
}) {
  const { title, detail } = waitingCopy(run, { designRel, labels, estimate });
  return (
    <div className="ai-wait" data-testid="ai-waiting-card" data-run={run.runId} role="status">
      <p className="ai-wait-t">
        <span className="ai-wait-ic" aria-hidden="true">
          <Clock size={14} />
        </span>
        <span className="ai-wait-tt">{title}</span>
        <button
          type="button"
          className="ai-wait-x"
          data-testid="ai-waiting-cancel"
          aria-label="Cancel this ask"
          title="Cancel this ask"
          disabled={busy}
          onClick={onCancel}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </p>
      <p className="ai-wait-d">{detail}</p>
      {note ? (
        <p className="ai-wait-note" data-testid="ai-waiting-note">
          {note}
        </p>
      ) : null}
      {copyLive ? (
        <span className="ai-wait-a">
          <button
            type="button"
            className="btn btn--sm"
            data-testid="ai-waiting-copy"
            disabled={busy}
            onClick={onCopy}
          >
            <Duplicate size={12} />
            Run on a copy
          </button>
        </span>
      ) : null}
    </div>
  );
}

// what happened · what is safe (CONTRACT §4): the ask is never lost by a refused click
const NOTES = {
  cancel: 'This ask already started. Nothing was lost.',
  copy: "Couldn't make a copy. The ask is still waiting.",
};

/** This chat's waiting asks, as cards. Renders nothing when none wait (the common case). */
export function WaitingCards({ chatId, designRel, store }) {
  const { view, store: s } = useAiRuns(store);
  const waiting = waitingOfChat(view, chatId);
  if (waiting.length === 0) return null;
  return <WaitingCardsOpen waiting={waiting} view={view} store={s} designRel={designRel} />;
}

function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function WaitingCardsOpen({ waiting, view, store, designRel }) {
  const labels = useBoardLabels(designRel, view.seq);
  const now = useNow(30_000);
  const [state, setState] = useState({}); // runId → {busy, note}
  const act = async (run, verb) => {
    setState((p) => ({ ...p, [run.runId]: { busy: true, note: null } }));
    const res = await store[verb](run.runId);
    setState((p) => ({ ...p, [run.runId]: { busy: false, note: res.ok ? null : NOTES[verb] } }));
  };
  return (
    <div className="ai-wait-stack" data-testid="ai-waiting-stack">
      {waiting.map((run) => (
        <WaitingCard
          key={run.runId}
          run={run}
          designRel={designRel}
          labels={labels}
          estimate={estimateFor(view, run, now)}
          busy={!!state[run.runId]?.busy}
          note={state[run.runId]?.note ?? null}
          onCancel={() => act(run, 'cancel')}
          onCopy={() => act(run, 'copy')}
        />
      ))}
    </div>
  );
}
