// client/v2/handoff/edges.jsx — S8.10 (09 ex-handoff-edges): say what's in the way, keep the one verb.
//   ReviewHint    the last review: no blockers (info) · N blockers (warn, Show on canvas) — blockers
//                 inform, they never hold the handoff back; they travel with the code as notes.
//   HandoffConnect  AI isn't connected yet: the ONE connect sheet, then the handoff you asked for runs.
//   QueuedLine    offline / waiting: "Queued — starts when this Mac is online", it starts by itself.

import { ConnectSheet } from '../ai/ConnectSheet.jsx';
import { Hint } from '../export/parts.jsx';
import {
  BLOCKERS_NOTE,
  blockersLine,
  CONNECT_FINE,
  CONNECT_LEAD,
  CONNECT_TITLE,
  NO_BLOCKERS,
  NOT_REVIEWED,
  QUEUED_CAP,
  SHOW_ON_CANVAS,
} from './targets.js';

export function ReviewHint({ review, onShowOnCanvas }) {
  const blockers = review?.blockers ?? [];
  if (blockers.length) {
    return (
      <div className="ho-review" data-testid="handoff-review" data-tone="warn" role="status">
        <p className="ho-review-t">{blockersLine(blockers)}</p>
        <p className="ho-review-s">{BLOCKERS_NOTE}</p>
        {onShowOnCanvas ? (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="handoff-show-on-canvas"
            onClick={onShowOnCanvas}
          >
            {SHOW_ON_CANVAS}
          </button>
        ) : null}
      </div>
    );
  }
  return (
    // 09 ex-handoff: the review line is the sheet's own hint pill — a done glyph, then the words
    <Hint icon="done" testid="handoff-review" tone="info">
      {review?.reviewed ? NO_BLOCKERS : NOT_REVIEWED}
    </Hint>
  );
}

export function HandoffConnect({ phase, error, onConnect, onCancel }) {
  return (
    <div className="ho-connect" data-testid="handoff-connect">
      <ConnectSheet
        inline
        option={false}
        title={CONNECT_TITLE}
        lead={CONNECT_LEAD}
        phase={phase}
        error={error}
        fine={CONNECT_FINE}
        onConnect={onConnect}
        onCancel={onCancel}
      />
    </div>
  );
}

export function QueuedLine({ words }) {
  return (
    <div className="ho-queued" data-testid="handoff-queued" role="status">
      <p className="ho-queued-t">{words || 'Queued — starts when this Mac is online'}</p>
      <p className="ho-queued-s">{QUEUED_CAP}</p>
    </div>
  );
}
