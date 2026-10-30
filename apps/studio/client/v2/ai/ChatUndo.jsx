// client/v2/ai/ChatUndo.jsx — S5.15: "Undo this chat" (V2-1.5 §5.3 `chat.undo`), from the chat row ⋯ menu and
// from Version history's AI row.
//
// Every action YOUR AI made in that chat — on any canvas, from any session, in any order with your own edits,
// another chat's and a teammate's — is taken back as ONE new version (the kernel's multi-target undo rebases
// it through everything that came after). It is an entry, so ⌘Z takes it back again.
//
// An older team server cannot do it in one version (no `undoTargets`): the action is then DISABLED with one
// line before anyone clicks (U22) — never replayed as a row of single undos. The server says which
// (`chatUndo` on `GET /_api/project/history`), and judges the POST again: hiding is presentation.

import { useCallback, useEffect, useState } from 'react';
import { shellToast } from '../../shell/util.js';

export const UNDO_ROUTE = '/_api/project/undo';
export const PROBE_ROUTE = '/_api/project/history?limit=1';

/** The words (CONTRACT §3–§4: what happened · what is safe · one verb; no "we" / "I"). */
export const CHAT_UNDO_WORDS = {
  action: 'Undo this chat',
  working: 'Undoing…',
  done: 'Undid this chat — one new version. ⌘Z brings it back.',
  skipped: (n) =>
    `Undid this chat — ${n} ${n === 1 ? 'part was' : 'parts were'} changed since, kept`,
  nothing: 'Nothing to undo — this chat has not changed a canvas',
  tooMany: 'This chat made too many changes to undo in one step — use Version history',
  conflict: "Can't undo this chat — everything it changed was changed since",
  failed: "Couldn't undo this chat. Nothing changed. Try again.",
};

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * POST `{ chatId, via: 'panel' }`. Answers `{ ok, words, actionId?, disabled? }` — `disabled` carries the
 * update line from an old team server.
 */
export async function undoChat(chatId, { fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(UNDO_ROUTE, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatId, via: 'panel' }),
    });
  } catch {
    return { ok: false, words: CHAT_UNDO_WORDS.failed };
  }
  const body = await readJson(res);
  if (res.ok && body?.ok) {
    const n = Array.isArray(body.skipped) ? body.skipped.length : 0;
    return {
      ok: true,
      actionId: body.actionId ?? null,
      words: n ? CHAT_UNDO_WORDS.skipped(n) : CHAT_UNDO_WORDS.done,
    };
  }
  const code = body?.reason ?? body?.code ?? null;
  if (code === 'needs-hub-update')
    return { ok: false, disabled: body.line, words: body.line ?? CHAT_UNDO_WORDS.failed };
  if (code === 'nothing-to-undo') return { ok: false, words: CHAT_UNDO_WORDS.nothing };
  if (code === 'too-many') return { ok: false, words: CHAT_UNDO_WORDS.tooMany };
  if (code === 'undo-conflict') return { ok: false, words: CHAT_UNDO_WORDS.conflict };
  return { ok: false, words: CHAT_UNDO_WORDS.failed };
}

/** `{ ok: true }` · `{ ok: false, line }` (an old team server) · null while unknown or not answered. */
export async function probeChatUndo({ fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(PROBE_ROUTE, { cache: 'no-store' });
    const body = await readJson(res);
    const c = body?.chatUndo;
    if (c && typeof c.ok === 'boolean') return c.ok ? { ok: true } : { ok: false, line: c.line };
  } catch {
    /* unknown: the action stays enabled and the server judges the POST */
  }
  return null;
}

/** The probe, read once per mount (and again when `key` changes). */
export function useChatUndoReady({ fetchImpl, key = 0, enabled = true } = {}) {
  const [ready, setReady] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    let live = true;
    probeChatUndo({ fetchImpl }).then((r) => {
      if (live) setReady(r);
    });
    return () => {
      live = false;
    };
    // biome-ignore lint/correctness/useExhaustiveDependencies: key is the re-read trigger
  }, [fetchImpl, key, enabled]);
  return ready;
}

/** The row-menu item for `chat-list-model.js` `rowMenu`: disabled with the line on an old team server. */
export function chatUndoItem(ready) {
  const off = ready && ready.ok === false;
  return {
    id: 'chat.undo',
    label: CHAT_UNDO_WORDS.action,
    ...(off ? { disabled: true, hint: ready.line } : {}),
  };
}

/** Run it and say what happened (one toast, no action on it — ⌘Z is the way back). */
export function useUndoChat({ fetchImpl, toast = shellToast, onDone } = {}) {
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async (chatId) => {
      if (!chatId || busy) return null;
      setBusy(true);
      const r = await undoChat(chatId, { fetchImpl });
      setBusy(false);
      toast?.(r.words, r.ok);
      if (r.ok) onDone?.(r);
      return r;
    },
    [busy, fetchImpl, toast, onDone]
  );
  return { busy, run };
}

/**
 * Version history's AI row action: shown for YOUR AI's rows that name their chat, when the session may edit.
 * @param {{ row: any, canEdit: boolean, fetchImpl?: typeof fetch, toast?: Function, onDone?: Function }} p
 */
export function ChatUndoButton({ row, canEdit, fetchImpl, toast, onDone }) {
  const show = !!(canEdit && row?.kind === 'ai' && row?.chatId && row?.who?.you);
  const ready = useChatUndoReady({ fetchImpl, enabled: show });
  const { busy, run } = useUndoChat({ fetchImpl, toast, onDone });
  if (!show) return null;
  const off = ready?.ok === false;
  return (
    <span className="vh-undo-chat">
      <button
        type="button"
        className="btn btn--sm"
        data-testid="vh-undo-chat"
        disabled={busy || off}
        title={off ? ready.line : undefined}
        aria-describedby={off ? `vh-undo-chat-line-${row.id}` : undefined}
        onClick={() => run(row.chatId)}
      >
        {busy ? CHAT_UNDO_WORDS.working : CHAT_UNDO_WORDS.action}
      </button>
      {off ? (
        <span
          id={`vh-undo-chat-line-${row.id}`}
          className="vh-undo-chat-line"
          data-testid="vh-undo-chat-line"
        >
          {ready.line}
        </span>
      ) : null}
    </span>
  );
}
