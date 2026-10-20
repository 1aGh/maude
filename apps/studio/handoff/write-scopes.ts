// handoff/write-scopes.ts — S8.10: a chat's own write scope (decision v2-S8.10-run-write-scope).
//
// A Handoff to production run writes its target file and nothing else. The handoff route names the
// run's chat (`handoff-<id>`) and its absolute target path(s) here BEFORE the turn is sent; every
// bridge of that chat reads it live on each write-shaped permission request (acp/bridge.ts
// `writeOnlyRoots` → acp/write-scope `outside-run-scope`). A write anywhere else is never
// auto-approved: it goes to the ordinary prompt card, without `allow_always`.
//
// In memory on purpose: a handoff chat exists only on the Mac that started it, and after a restart
// the outbox replays the intent, which names the scope again before its turn is sent.

import { isAbsolute } from 'node:path';

const MAX = 200;
const scopes = new Map<string, readonly string[]>();

export const HANDOFF_CHAT_RE = /^handoff-[a-z0-9]{6,40}$/;

/** Name the paths `chatId` may write. Absolute paths only; anything else is dropped. */
export function setRunWriteScope(chatId: string, paths: readonly string[]): void {
  const list = paths.filter((p) => typeof p === 'string' && isAbsolute(p));
  scopes.delete(chatId);
  scopes.set(chatId, Object.freeze([...list]));
  while (scopes.size > MAX) {
    const first = scopes.keys().next().value;
    if (first === undefined) break;
    scopes.delete(first);
  }
}

/**
 * The paths `chatId` may write, or null when the chat has no scope of its own. A handoff chat id
 * that lost its entry (evicted) gets `[]`: it may write nothing, never the whole project.
 */
export function runWriteScope(chatId: string): readonly string[] | null {
  const s = scopes.get(chatId);
  if (s) return s;
  return HANDOFF_CHAT_RE.test(chatId) ? [] : null;
}

export function clearRunWriteScopes(): void {
  scopes.clear();
}
