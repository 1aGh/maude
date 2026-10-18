// client/v2/ai/ask-frame.js — S5.13 (S5.6's client patch): what the panel sends with a prompt and how it
// reads the frames the server answers with. Pure — acp-runtime.js (the socket) calls these, the tests pin them.
//
//   newAskId()                    the id of one send: `a_` + 20 hex (the server's ASK_ID_RE). One typed ask = one
//                                 askId, so a retry of the same frame folds into the run it already made.
//   runScopeOf({canvas, scope})   `{canvas, artboards}` (ids, or '*' for the whole canvas) for the server's lease
//                                 registry; undefined when the ask has no canvas scope.
//   promptFrame({...})            `{t:'prompt', text, chat, model, effort, mode, askId, scope}` — the text still
//                                 carries the `[maude-scope …]` line, which is what an older server reads.
//   reduceQueued(list, frame)     the chat's waiting prompts, from `{t:'queued'}` (add) and `{t:'run'}` (the drain
//                                 released one into a run: its `askId` matches, so it leaves the list).
//   mergeOutbox(list, fromOutbox) after a reload: the same list, from `GET /_api/outbox`.

const ASK_ID_RE = /^a_[A-Za-z0-9_-]{6,64}$/;
const ARTBOARD_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

export function newAskId() {
  const bytes = new Uint8Array(10);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `a_${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export const isAskId = (v) => typeof v === 'string' && ASK_ID_RE.test(v);

export function runScopeOf({ canvas, scope } = {}) {
  if (!canvas || typeof canvas !== 'string' || !scope) return undefined;
  if (scope.kind === 'whole') return { canvas, artboards: '*' };
  if (scope.kind === 'artboards' && Array.isArray(scope.ids)) {
    const ids = [
      ...new Set(scope.ids.filter((id) => typeof id === 'string' && ARTBOARD_ID_RE.test(id))),
    ];
    if (ids.length) return { canvas, artboards: ids.slice(0, 64) };
  }
  return undefined;
}

export function promptFrame({ text, chat, model, effort, mode, askId, scope }) {
  return {
    t: 'prompt',
    text,
    chat: chat || undefined,
    model: model || undefined,
    effort: effort || undefined,
    mode: mode || undefined,
    askId: isAskId(askId) ? askId : undefined,
    scope: scope || undefined,
  };
}

/** The panel's list of this chat's waiting prompts. */
export function reduceQueued(list, frame) {
  if (!frame || typeof frame !== 'object') return list;
  if (frame.t === 'queued') {
    const item = {
      askId: frame.askId ?? null,
      intentId: frame.intentId ?? null,
      gates: Array.isArray(frame.gates) ? frame.gates : [],
      words: typeof frame.words === 'string' ? frame.words : null,
      presentation: frame.presentation === 'field' ? 'field' : 'sent',
      allowanceResetsAt: null,
    };
    const without = list.filter((q) => !(item.intentId && q.intentId === item.intentId));
    return [...without, item];
  }
  if (frame.t === 'run' && frame.run?.askId) {
    const next = list.filter((q) => q.askId !== frame.run.askId);
    return next.length === list.length ? list : next;
  }
  return list;
}

/** A reload (or a poll) brought the outbox's records: keep the frames' richer items, add the rest, drop the finished. */
export function mergeOutbox(list, fromOutbox) {
  const live = new Map(fromOutbox.map((q) => [q.intentId, q]));
  const kept = list.filter((q) => !q.intentId || live.has(q.intentId));
  const have = new Set(kept.map((q) => q.intentId).filter(Boolean));
  const merged = kept.map((q) => {
    const rec = q.intentId ? live.get(q.intentId) : null;
    if (!rec) return q;
    const same =
      q.allowanceResetsAt === rec.allowanceResetsAt &&
      q.gates.length === rec.gates.length &&
      q.gates.every((g, i) => g === rec.gates[i]);
    return same ? q : { ...q, gates: rec.gates, allowanceResetsAt: rec.allowanceResetsAt };
  });
  for (const q of fromOutbox) if (!have.has(q.intentId)) merged.push(q);
  return merged.length === list.length && merged.every((q, i) => q === list[i]) ? list : merged;
}
