// client/v2/ai/chat-store-api.js — S5.7: the shell's door to the chat store (acp/transcript.ts,
// routes/chat.ts) and to Open in terminal. Plain functions, no React: the chat list (S5.12) calls
// these and renders the answer.
//
//   fetchChats({ group, trashed })    GET /_api/acp/chats[?group=canvas][&trashed=1]
//   searchChats(q)                    GET /_api/acp/chats/search?q=   -> { hits }, ranges for highlights
//   trashChat / restoreChat / clearTrash   POST /_api/acp/chats/{trash,restore,clear}
//   openChatInTerminal(...)           Tauri `chat_open_in_terminal` -> `claude --resume <session>`
//
// Open in terminal is the desktop app's ONLY (decision v2-S5-open-in-terminal-native): the row is
// absent in a browser tab (the registry's `visible`), and this call REFUSES there by the same
// predicate — hidden is not refused (rule 12), so the refusal is checked here and again in Rust
// (the command checks its caller). No studio HTTP route spawns anything.

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { isVisible } from '../../../actions/resolve.ts';

const JSON_HEADERS = { 'content-type': 'application/json' };

async function readJson(res) {
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an empty or non-JSON body */
  }
  return { ok: res.ok, status: res.status, body };
}

/** The chat list. `group: 'canvas'` -> `{ groups: [{ canvas, chats }] }`; otherwise the flat array. */
export async function fetchChats({ group, trashed, fetchImpl = fetch } = {}) {
  const q = new URLSearchParams();
  if (group) q.set('group', group);
  if (trashed) q.set('trashed', '1');
  const res = await fetchImpl(`/_api/acp/chats${q.size ? `?${q}` : ''}`);
  if (!res.ok) return trashed || !group ? [] : { groups: [] };
  return res.json();
}

/** Full-text search. Hits carry `titleRanges` and `snippet: { text, ranges }` to highlight. */
export async function searchChats(query, { fetchImpl = fetch } = {}) {
  const res = await fetchImpl(`/_api/acp/chats/search?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body?.hits) ? body.hits : [];
}

const post = (path, body, fetchImpl) =>
  fetchImpl(path, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) }).then(
    readJson
  );

/** Move to trash. `{ ok, status, body: { droppedPrompts } }`; 409 `running` = stop the chat first. */
export const trashChat = (id, { fetchImpl = fetch } = {}) =>
  post('/_api/acp/chats/trash', { id }, fetchImpl);
export const restoreChat = (id, { fetchImpl = fetch } = {}) =>
  post('/_api/acp/chats/restore', { id }, fetchImpl);
/** Clear out: delete trashed chats (all of them, or just `ids`). */
export const clearTrash = (ids, { fetchImpl = fetch } = {}) =>
  post('/_api/acp/chats/clear', ids ? { ids } : {}, fetchImpl);

/** Would the shell offer Open in terminal here? The registry's own predicate. */
export function canOpenInTerminal(ctx) {
  const def = ACTIONS_BY_ID.get('chat.open-in-terminal');
  return !!def && isVisible(def, ctx);
}

/**
 * Open the chat's Claude Code session in Terminal. Resolves `{ ok: true }`, or
 * `{ ok: false, reason }` — `desktop-only` (a browser / cloud / viewer shell, or no Tauri),
 * `no-session` (the chat never reached Claude, so there is nothing to resume), or `failed`.
 *
 * `ctx` is the shell's KeyCtx (`menuCtx(...)` / `shellKeyCtx(...)`); `tauri` is
 * `window.__TAURI__` (injected so a test needs no window).
 */
export async function openChatInTerminal({
  ctx,
  chatId,
  fetchImpl = fetch,
  tauri = typeof window !== 'undefined' ? window.__TAURI__ : null,
}) {
  if (!canOpenInTerminal(ctx) || !tauri?.core?.invoke) return { ok: false, reason: 'desktop-only' };
  const res = await fetchImpl(`/_api/acp/chat/session?id=${encodeURIComponent(chatId)}`);
  const body = res.ok ? await res.json().catch(() => null) : null;
  const sessionId = body?.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) return { ok: false, reason: 'no-session' };
  try {
    await tauri.core.invoke('chat_open_in_terminal', { sessionId });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'failed', error: String(e) };
  }
}
