// client/v2/access/ask-to-edit.jsx — S9.21 (10 co-ask-edit): view access meets an edit — one request, one answer.
//
//   · `ViewOnlyTip` — the one dark tip Petra sees when her drag does nothing: "You can look at Combine-kampan, not
//     change it." / "Ask to edit, top right, sends a request to its owner." The mode switch reads Viewing and there
//     is no toolbar (S3.12); the tip only says why.
//   · `RequestBlocks` — what waits at the top of the owner's Share: one block per open request, "Petra asks to edit
//     Combine-kampan" · "2 min ago · can view it now" · Not now / Let Petra edit. The rows come from
//     `GET /_api/share/requests`, rebuilt key by key on the server; a requester's name is rendered as TEXT and
//     nothing a requester typed exists to render (an ask carries no note).

import { useCallback, useEffect, useState } from 'react';

import { commentTime } from '../comments/comments-model.js';
import { answerAccessRequest, canvasName, fetchAccessRequests, WORDS } from './access-client.js';

export function ViewOnlyTip({ canvas, style }) {
  return (
    <div className="v2ac-tip" role="status" data-testid="access-view-tip" style={style}>
      <span className="v2ac-tip-t">{WORDS.tipTitle(canvasName(canvas))}</span>
      <span className="v2ac-tip-s">{WORDS.tipLine}</span>
    </div>
  );
}

function RequestBlock({ request, busy, now, onAnswer }) {
  const name = request.from?.name || request.from?.email || '';
  const what = request.canvas ? canvasName(request.canvas) : '';
  const at =
    typeof request.at === 'number' ? commentTime(new Date(request.at).toISOString(), now) : '';
  return (
    <div className="v2ac-req" data-testid={`share-request-${request.id}`}>
      <span className="v2ac-req-t">{WORDS.asksToEdit(name, what)}</span>
      <span className="v2ac-req-s">{[at, WORDS.canViewNow].filter(Boolean).join(' · ')}</span>
      <span className="v2ac-req-a">
        <button
          type="button"
          className="btn btn--sm"
          disabled={busy}
          data-testid={`share-request-decline-${request.id}`}
          onClick={() => onAnswer(request, 'decline')}
        >
          {WORDS.notNow}
        </button>
        <button
          type="button"
          className="btn btn--sm btn--primary"
          disabled={busy}
          data-testid={`share-request-approve-${request.id}`}
          onClick={() => onAnswer(request, 'approve')}
        >
          {WORDS.letEdit(name)}
        </button>
      </span>
    </div>
  );
}

/**
 * The owner's open requests (the sheet mounts this only when the hub reports `requests` and the session may
 * invite; the server refuses everybody else anyway). `onAnswered` re-reads the people list after a yes.
 */
export function RequestBlocks({ fetchImpl, now, onAnswered, onError }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setRows(await fetchAccessRequests(fetchImpl));
  }, [fetchImpl]);
  useEffect(() => {
    void load();
  }, [load]);
  const answer = async (request, verb) => {
    setBusy(true);
    try {
      const r = await answerAccessRequest(request.id, verb, fetchImpl);
      if (!r.ok) onError?.(r.words);
      await load();
      if (r.ok && verb === 'approve') onAnswered?.(request);
    } finally {
      setBusy(false);
    }
  };
  if (!rows.length) return null;
  return (
    <div className="v2ac-reqs" data-testid="share-requests">
      {rows.map((r) => (
        <RequestBlock key={r.id} request={r} busy={busy} now={now} onAnswer={answer} />
      ))}
    </div>
  );
}
