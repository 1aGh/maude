// client/v2/ai/run-api.js — S5.9: the panel's doors to the run registry (S5.3) and to Undo (S5.5).
// Plain functions over an injected `fetchImpl`, no React.
//
//   stopRun(id)               POST /_api/ai/runs/:id/stop         (the working line's Stop)
//   keepGoingRun(id)          POST /_api/ai/runs/:id/keep-going   (a cut-short run carries on)
//   fetchChatRuns(chatId)     GET  /_api/ai/runs                  → this chat's `mine`
//   undoRun(run, { designRel })   GET undo-stack → the run's action(s) → POST /_api/project/undo
//   redoRun(run, { designRel })   the same, the other way
//
// Undo is the run's own action: "one AI run = one version = one step" (V2-1.5). The stack is read
// for the entry carrying this `runId`, so a person's later edits never get undone with it.

const JSON_HEADERS = { 'content-type': 'application/json' };

async function json(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

const post = (url, body, fetchImpl) =>
  fetchImpl(url, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body ?? {}),
  });

/** Stop a live run. `{ ok }` — false when it was already over (409 `state`) or unknown. */
export async function stopRun(runId, fetchImpl = globalThis.fetch) {
  try {
    const res = await post(`/_api/ai/runs/${encodeURIComponent(runId)}/stop`, {}, fetchImpl);
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** Carry a cut-short run on: a new ask `resumeOf` it. */
export async function keepGoingRun(runId, fetchImpl = globalThis.fetch) {
  try {
    const res = await post(`/_api/ai/runs/${encodeURIComponent(runId)}/keep-going`, {}, fetchImpl);
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** This chat's runs (YOURS), for the panel that opened after they started. [] when unreachable. */
export async function fetchChatRuns(chatId, fetchImpl = globalThis.fetch) {
  try {
    const res = await fetchImpl('/_api/ai/runs');
    if (!res.ok) return [];
    const body = await json(res);
    const mine = Array.isArray(body?.mine) ? body.mine : [];
    return mine.filter((r) => r && r.chatId === chatId && r.origin === 'maude-chat');
  } catch {
    return [];
  }
}

const trim = (p) => String(p ?? '').replace(/^\/+|\/+$/g, '');
const canvasPath = (designRel, canvas) => `${trim(designRel)}/${trim(canvas)}`.replace(/^\//, '');

async function stackFor(run, designRel, fetchImpl) {
  const canvas = run?.scope?.canvas;
  if (!canvas) return { ok: false, reason: 'not-found' };
  let res;
  try {
    res = await fetchImpl(
      `/_api/project/undo-stack?canvas=${encodeURIComponent(canvasPath(designRel, canvas))}`
    );
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  const body = await json(res);
  if (!body?.ok) return { ok: false, reason: body?.reason || 'unreachable' };
  return { ok: true, entries: body.entries || [], redo: body.redo || [] };
}

async function turn({ run, designRel, redo }, fetchImpl) {
  const stack = await stackFor(run, designRel, fetchImpl);
  if (!stack.ok) return stack;
  // Undo reads the entries that are done; Redo reads the ones that were undone.
  const pool = redo ? stack.redo : stack.entries;
  const ids = pool
    .filter((e) => e && e.runId === run.runId && e.actionId && (redo || e.state === 'done'))
    .map((e) => e.actionId);
  if (!ids.length) return { ok: false, reason: 'not-found' };
  const target = ids.length === 1 ? { actionId: ids[0] } : { actionIds: ids };
  let res;
  try {
    res = await post(
      '/_api/project/undo',
      { ...target, ...(redo ? { redo: true } : {}), via: 'panel' },
      fetchImpl
    );
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
  const body = await json(res);
  if (res.ok && body?.ok) return { ok: true, actionId: body.actionId, skipped: body.skipped };
  if (res.status === 409) {
    return {
      ok: false,
      reason: body?.reason === 'needs-hub-update' ? 'needs-hub-update' : 'conflict',
      line: body?.line,
      skipped: body?.skipped,
    };
  }
  return { ok: false, reason: body?.reason || 'unreachable' };
}

/** Take the run's whole change back. `{ ok }` or `{ ok:false, reason }` (see `undoNote`). */
export const undoRun = (run, { designRel = '.design' } = {}, fetchImpl = globalThis.fetch) =>
  turn({ run, designRel, redo: false }, fetchImpl);

/** Put it back. */
export const redoRun = (run, { designRel = '.design' } = {}, fetchImpl = globalThis.fetch) =>
  turn({ run, designRel, redo: true }, fetchImpl);

/** The one line under the result when Undo / Redo did not happen. */
export function undoNote(reason, line) {
  switch (reason) {
    case 'conflict':
      return 'Someone changed this since, so nothing was undone.';
    case 'needs-hub-update':
      return line || 'Undo needs the team server to be updated.';
    case 'legacy':
      return "Undo isn't available in this project yet.";
    case 'not-found':
      return "That change isn't in the history any more.";
    default:
      return "Couldn't reach the project. Try again in a moment.";
  }
}
