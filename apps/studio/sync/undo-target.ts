// What an undo names (V2-1.5 §5.3, S5-kernel-foundation §5) — shared by the
// hub runtime (sync/index.ts) and the local home (sync/local-kernel.ts), so the
// one route never learns which home answered.
//
//   { actionId }   one of your actions (⌘Z, the result card's Undo)
//   { actionIds }  several as ONE new action (Undo history "undo to here")
//   { chatId }     every published run of one of your chats ("Undo this chat")
//
// `chatId` resolves HERE, on the studio, to this person's own `ai` actions of
// that chat through the store's indexed `chat` filter, then goes out as one
// `actionIds` proposal. A chat with more than 50 runs is refused rather than
// half undone (V2-1.5 Q2 — a half-applied chat undo is worse than none).

export type UndoTarget = { actionId: string } | { actionIds: string[] } | { chatId: string };

export const ACTION_ID = /^[A-Za-z0-9_-]{1,128}$/;
export const CHAT_ID = /^[A-Za-z0-9_-]{1,64}$/;
export const MAX_UNDO_TARGETS = 50;

/** The route body → a target, or the reason it is not one. */
export function parseUndoTarget(
  body: unknown
): { ok: true; target: UndoTarget; redo: boolean } | { ok: false; reason: string } {
  if (!body || typeof body !== 'object') return { ok: false, reason: 'body must be an object' };
  const b = body as Record<string, unknown>;
  const named = ['actionId', 'actionIds', 'chatId'].filter((k) => b[k] !== undefined);
  if (named.length !== 1)
    return {
      ok: false,
      reason: 'body must include exactly one of { actionId, actionIds, chatId }',
    };
  const redo = b.redo === true;
  if (b.actionId !== undefined) {
    if (typeof b.actionId !== 'string' || !ACTION_ID.test(b.actionId))
      return { ok: false, reason: 'bad actionId' };
    return { ok: true, target: { actionId: b.actionId }, redo };
  }
  if (b.actionIds !== undefined) {
    const ids = b.actionIds;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > MAX_UNDO_TARGETS ||
      ids.some((id) => typeof id !== 'string' || !ACTION_ID.test(id)) ||
      new Set(ids).size !== ids.length
    )
      return { ok: false, reason: `actionIds takes 1–${MAX_UNDO_TARGETS} distinct ids` };
    return { ok: true, target: { actionIds: ids as string[] }, redo };
  }
  if (typeof b.chatId !== 'string' || !CHAT_ID.test(b.chatId))
    return { ok: false, reason: 'bad chatId' };
  if (redo) return { ok: false, reason: 'redo takes an actionId (the undo to redo)' };
  return { ok: true, target: { chatId: b.chatId }, redo };
}

/** The V2-1.5 §5.1 origin keys of a stored action, as a history row carries them. */
export function originFields(origin: unknown): {
  runId?: string;
  chatId?: string;
  madeAt?: number;
  partial?: true;
} {
  if (!origin || typeof origin !== 'object') return {};
  const o = origin as Record<string, unknown>;
  const id = (v: unknown) => (typeof v === 'string' && CHAT_ID.test(v) ? v : undefined);
  const runId = id(o.runId);
  const chatId = id(o.chatId);
  return {
    ...(runId ? { runId } : {}),
    ...(chatId ? { chatId } : {}),
    ...(Number.isSafeInteger(o.madeAt) ? { madeAt: o.madeAt as number } : {}),
    ...(o.partial === true ? { partial: true as const } : {}),
  };
}

export const asTarget = (t: string | UndoTarget): UndoTarget =>
  typeof t === 'string' ? { actionId: t } : t;

/**
 * The actions "Undo this chat" undoes: the person's own `ai` actions of that
 * chat, oldest first. Rows come from a store filtered by chat + actor; they
 * are re-checked here so an older hub that ignores the filters cannot widen it.
 */
export function chatActionIds(
  rows: Array<{ actionId: string; kind: string; mine: boolean; chatId?: string }>,
  chatId: string
): { ok: true; actionIds: string[] } | { ok: false; code: 'nothing-to-undo' | 'too-many' } {
  const ids = rows
    .filter((r) => r.mine && r.kind === 'ai' && r.chatId === chatId)
    .map((r) => r.actionId)
    .reverse();
  if (ids.length === 0) return { ok: false, code: 'nothing-to-undo' };
  if (ids.length > MAX_UNDO_TARGETS) return { ok: false, code: 'too-many' };
  return { ok: true, actionIds: ids };
}

/**
 * The action's label. ⌘Z / ⇧⌘Z (`via: 'keys'`) are exactly "Undo" / "Redo" —
 * the ⌘Z projection reads those as a flip of the target, not an entry
 * (client/v2/undo/projection.js `KEY_LABELS`); a panel's undo is labelled by
 * what it undid, and IS an entry ⌘Z can take back.
 */
export function undoLabel(t: UndoTarget, redo: boolean, via?: 'keys' | 'panel'): string {
  if ('chatId' in t) return 'Undo this chat';
  // p8-hub-drafts — ⌘Z of a folded text session names several ids and is still a flip ("Undo").
  if ('actionIds' in t && t.actionIds.length > 1 && via !== 'keys')
    return `Undo ${t.actionIds.length} changes`;
  if (via === 'panel') return redo ? 'Redo one change' : 'Undo one change';
  return redo ? 'Redo' : 'Undo';
}
