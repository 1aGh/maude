// client/v2/annotations/annotation-asks.js — S4.12: what the shell does when the annotation layer asks.
//
// The canvas is untrusted (DDR-054): it cannot call a privileged route nor show a toast with a button. It
// posts a word from the dgn table (bridge/dgn-protocol.ts) and the shell does the rest:
//   · `annotation-to-comment {id}`  → POST /_api/annotations/to-comment (S4.7, main origin, CSRF) with the
//                                     active canvas as `file`, then a toast "Turned into a comment" + Undo;
//   · `annotation-toast {message, undo}` → a toast the shell owns (Undo = the top of the person's stack);
//   · `annotation-selection {ids, kinds, artboards}` → kept here for the AI chat's scope chip (S4.15).
// No React, no DOM: every function takes its `fetchImpl`, so it is unit-tested without a browser.

/** The words (CONTRACT §3–§4: no "we", no "I"; one verb per toast). */
export const ASK_WORDS = {
  converted: 'Turned into a comment.',
  empty: 'This sticky has no words to turn into a comment.',
  forbidden: 'Your role in this project can’t turn a sticky into a comment.',
  gone: 'That sticky is already gone.',
  notSticky: 'Only a sticky can turn into a comment.',
  failed: 'Couldn’t turn it into a comment.',
  undoFailed: 'Couldn’t undo that. The comment is still there.',
  undone: 'Brought the sticky back.',
};

async function postJson(fetchImpl, url, body) {
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await r.json().catch(() => null);
    return { status: r.status, data };
  } catch {
    return { status: 0, data: null };
  }
}

/** The line for a refused conversion (S4-S9 §3.3: 403 read-only · 404 gone · 409 not-a-sticky | empty). */
export function refusalLine(status, data) {
  if (status === 403) return ASK_WORDS.forbidden;
  if (status === 404) return ASK_WORDS.gone;
  if (status === 409 && data?.reason === 'empty') return ASK_WORDS.empty;
  if (status === 409 && data?.reason === 'not-a-sticky') return ASK_WORDS.notSticky;
  return ASK_WORDS.failed;
}

/**
 * Turn a sticky into a comment. `file` is the active canvas's repo path (the shell's, never the canvas's).
 * @returns {Promise<{ ok: boolean, line: string, commentId?: string, undo?: { actionId?: string, token?: string } }>}
 */
export async function turnIntoComment({ file, id, fetchImpl = globalThis.fetch }) {
  if (!file || typeof id !== 'string' || !id) return { ok: false, line: ASK_WORDS.failed };
  const { status, data } = await postJson(fetchImpl, '/_api/annotations/to-comment', { file, id });
  if (status < 200 || status >= 300 || data?.ok === false) {
    return { ok: false, line: refusalLine(status, data) };
  }
  const undo = data?.actionId
    ? { actionId: String(data.actionId) }
    : data?.undoToken
      ? { token: String(data.undoToken) }
      : undefined;
  return {
    ok: true,
    line: ASK_WORDS.converted,
    ...(typeof data?.commentId === 'string' ? { commentId: data.commentId } : {}),
    ...(undo ? { undo } : {}),
  };
}

/** Undo one conversion: the op-log action (both lanes together) or, on a legacy link, the in-memory token. */
export async function undoConversion(undo, { fetchImpl = globalThis.fetch } = {}) {
  if (!undo) return { ok: false, line: ASK_WORDS.undoFailed };
  const { status, data } = undo.actionId
    ? await postJson(fetchImpl, '/_api/project/undo', { actionId: undo.actionId })
    : await postJson(fetchImpl, '/_api/annotations/convert-undo', { token: undo.token });
  if (status >= 200 && status < 300 && data?.ok !== false)
    return { ok: true, line: ASK_WORDS.undone };
  // 409 has-replies carries its own line ("Tereza replied — resolve the thread instead.")
  const line = typeof data?.line === 'string' && data.line ? data.line : ASK_WORDS.undoFailed;
  return { ok: false, line };
}

/**
 * The most recent `annotation-selection` of each canvas, for the AI chat's scope chip (S4.15): the composer
 * follows it through `subscribeAnnotationSelection` (a snapshot per change, so `useSyncExternalStore` sees it).
 */
const scopes = new Map();
const listeners = new Set();
let version = 0;
const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export function noteAnnotationSelection(file, scope) {
  if (!file) return;
  if (!scope || !Array.isArray(scope.ids) || scope.ids.length === 0) {
    if (!scopes.delete(file)) return;
  } else {
    const next = {
      file,
      ids: scope.ids,
      kinds: scope.kinds ?? {},
      artboards: scope.artboards ?? [],
    };
    const before = scopes.get(file);
    // the same selection announced again is not news (the chip's own choice lives until it changes)
    if (
      before &&
      sameList(before.ids, next.ids) &&
      sameList(before.artboards, next.artboards) &&
      JSON.stringify(before.kinds) === JSON.stringify(next.kinds)
    )
      return;
    scopes.set(file, next);
  }
  version += 1;
  for (const fn of listeners) fn();
}
export function annotationScopeOf(file) {
  return scopes.get(file) ?? null;
}
export function subscribeAnnotationSelection(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
/** A cheap snapshot for `useSyncExternalStore`. */
export const annotationSelectionVersion = () => version;
