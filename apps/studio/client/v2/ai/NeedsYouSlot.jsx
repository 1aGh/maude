// client/v2/ai/NeedsYouSlot.jsx — S5.13: the place between the chat feed and the field where AI's questions,
// failures and "can't run yet" lines live (03 `ai-permission`, `ai-choice-fail`, `ai-not-ready`). ChatPanel's
// ChatThread renders this in the slot PermissionPrompt / ElicitationPrompt / ErrorCard used to fill.
//
// Order: the open question (a permission, else a choice, else the v1 form) · a failure · the kept prompt's line.
// A permission waits here, inline — nothing about it is modal, and the rest of the app stays usable.
//
// Also owns what the panel does ABOUT a waiting question when you are not looking: the Needs-you count the
// folded spark reads (needs-you-store) and the in-app toast with Open.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dismissNotice, notify } from '../../../notifications.tsx';
import ElicitationPrompt from '../../panels/ElicitationPrompt.jsx';
import ChoiceCard from './ChoiceCard.jsx';
import ConnectSheet from './ConnectSheet.jsx';
import { connectClaude } from './connect-flow.js';
import { ErrorCard } from './Feed.jsx';
import { queuedForChat } from './gate-lines.js';
import { choiceModel, needsYouLine, permissionModel } from './needs-you.js';
import { setLocalNeedsYou } from './needs-you-store.js';
import { needsYouNotice, openAiChat } from './needs-you-toast.js';
import { QueuedState } from './NotReady.jsx';
import PermissionCard from './PermissionCard.jsx';
import ProblemCard from './ProblemCard.jsx';
import { changedSomething } from './run-model.js';
import { useChatRuns } from './use-chat-runs.js';

/** This chat's waiting prompts: frames now, the outbox after a reload, kept honest while any is waiting. */
export function useQueuedPrompts(conn, chatId) {
  const [queued, setQueued] = useState([]);
  useEffect(() => conn.onQueued(setQueued), [conn]);
  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/_api/outbox');
      if (!res.ok) return;
      const body = await res.json();
      conn.syncQueued(queuedForChat(body?.intents, chatId));
    } catch {
      /* offline, or not a v2 server: the frames' list stands */
    }
  }, [conn, chatId]);
  useEffect(() => {
    refresh();
  }, [refresh]);
  const waiting = queued.length > 0;
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(refresh, 5000);
    window.addEventListener('online', refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', refresh);
    };
  }, [waiting, refresh]);
  return { queued, refresh };
}

/** The Needs-you count + the toast for a question that arrives while you are not looking at this chat. */
function useWaitingQuestions({ conn, chatId, away, requests }) {
  const total = requests.length;
  useEffect(() => {
    setLocalNeedsYou(chatId, total);
    return () => setLocalNeedsYou(chatId, 0);
  }, [chatId, total]);

  const toasted = useRef(new Map()); // request id -> notice id
  useEffect(() => {
    const live = new Set(requests.map((r) => r.id));
    for (const [rid, nid] of toasted.current) {
      if (!live.has(rid)) {
        dismissNotice(nid); // answered (or settled by the bridge): the toast goes with it
        toasted.current.delete(rid);
      }
    }
    if (!away) return;
    for (const r of requests) {
      if (toasted.current.has(r.id)) continue;
      const nid = `ai-needs-${chatId}-${r.id}`;
      toasted.current.set(r.id, nid);
      notify(
        needsYouNotice({
          id: nid,
          canvas: conn.askCanvas,
          line: r.line,
          onOpen: () => openAiChat(chatId, { canvas: conn.askCanvas }),
        })
      );
    }
  }, [requests, away, chatId, conn]);
  useEffect(
    () => () => {
      for (const nid of toasted.current.values()) dismissNotice(nid);
      toasted.current.clear();
    },
    []
  );
}

export default function NeedsYouSlot({
  conn,
  chatId,
  away = false,
  pendingPermissions = [],
  pendingElicitations = [],
  onRespondPermission,
  onRespondElicitation,
  turnError,
  onRetry,
  onConnected,
}) {
  const { queued, refresh } = useQueuedPrompts(conn, chatId);
  // S5.17b G7 — the failure card says "Nothing changed" only when this chat's run touched nothing; no run seen = not claimed
  const { run: chatRun } = useChatRuns(conn, chatId);
  const changed = chatRun ? changedSomething(chatRun) : null;

  const requests = useMemo(
    () => [
      ...pendingPermissions.map((p) => ({ id: p.id, line: needsYouLine(permissionModel(p)) })),
      ...pendingElicitations.map((e) => ({
        id: e.id,
        line: choiceModel(e)?.question ?? e.message ?? 'Claude is asking',
      })),
    ],
    [pendingPermissions, pendingElicitations]
  );
  useWaitingQuestions({ conn, chatId, away, requests });

  // ── Connect (the one sheet, only for the `ai-connected` gate) ──
  const [phase, setPhase] = useState('idle');
  const [connectError, setConnectError] = useState(null);
  const abortRef = useRef(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const connect = useCallback(async () => {
    const ctl = new AbortController();
    abortRef.current = ctl;
    setConnectError(null);
    setPhase('waiting'); // the browser sign-in is the common case; the flow says 'installing' when it must
    const r = await connectClaude({ signal: ctl.signal, onPhase: setPhase });
    abortRef.current = null;
    setPhase('idle');
    if (r.ok) {
      onConnected?.();
      // The drain sends the kept prompt by itself once the gate opens; look again so the line goes with it.
      setTimeout(refresh, 1500);
    } else if (r.reason !== 'cancelled') setConnectError(r.reason);
  }, [onConnected, refresh]);
  const cancelConnect = useCallback(async () => {
    if (abortRef.current) {
      abortRef.current.abort();
      return;
    }
    // Cancel with nothing in flight: the kept prompt is dropped (the outbox's own cancel), the text is gone
    // from the queue but stays in the chat above.
    await Promise.all(
      queued
        .filter((q) => q.intentId)
        .map((q) =>
          fetch(`/_api/outbox/${encodeURIComponent(q.intentId)}/cancel`, { method: 'POST' }).catch(
            () => null
          )
        )
    );
    refresh();
  }, [queued, refresh]);

  const activePermission = pendingPermissions[0] ?? null;
  const activeElicitation = activePermission ? null : (pendingElicitations[0] ?? null);
  const choice = activeElicitation ? choiceModel(activeElicitation) : null;

  // S5.18 G6 (03 `picked`): an answered question stays as a settled card with the picked row marked — until a
  // new question replaces it, or the chat is asked something new (a turn that starts after the run went idle).
  const [settled, setSettled] = useState(null); // { model, picked }
  const respondChoice = useCallback(
    (answer, meta) => {
      if (choice && answer?.action === 'accept' && meta?.picked) {
        setSettled({ model: choice, picked: meta.picked });
      }
      onRespondElicitation?.(answer);
    },
    [choice, onRespondElicitation]
  );
  useEffect(() => {
    let idleSeen = false;
    return conn.onBusy?.((busy) => {
      if (!busy) idleSeen = true;
      else if (idleSeen) setSettled(null);
    });
  }, [conn]);
  useEffect(() => {
    if (activeElicitation || activePermission) setSettled(null);
  }, [activeElicitation, activePermission]);

  return (
    <div className="ai-nc-slot" data-testid="ai-needs-slot">
      {activePermission ? (
        <PermissionCard
          request={activePermission}
          onRespond={onRespondPermission}
          queueLength={pendingPermissions.length}
        />
      ) : activeElicitation ? (
        choice ? (
          <ChoiceCard request={activeElicitation} model={choice} onRespond={respondChoice} />
        ) : (
          <ElicitationPrompt request={activeElicitation} onRespond={onRespondElicitation} />
        )
      ) : settled ? (
        <ChoiceCard settled model={settled.model} picked={settled.picked} />
      ) : turnError?.code ? (
        // A refusal the server coded (S5.6: view only, prompt not kept) says plainly what happened.
        <ProblemCard error={turnError} />
      ) : (
        <ErrorCard error={turnError} onRetry={onRetry} changed={changed} />
      )}
      {queued.length > 0 ? (
        <QueuedState queued={queued[0]} count={queued.length}>
          <ConnectSheet
            inline
            phase={phase}
            error={connectError}
            onConnect={connect}
            onCancel={cancelConnect}
          />
        </QueuedState>
      ) : null}
    </div>
  );
}
