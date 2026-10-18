// client/v2/comments/comment-client.js — S9.22: the shell's two calls for comments.
//
//   postCommentOp(op)   `POST /_api/comments/op` (S9.7b) — add, reply, resolve, reopen, edit-own,
//                        delete-own, as the session. Main origin only: the canvas iframe cannot reach it,
//                        so the iframe's overlay asks the shell (comment-bridge.js) and the shell asks here.
//                        This is what lets a canvas-only session REPLY: the route finds the thread's canvas
//                        itself (the old `/_api/comments/<id>/reply` named none, so the local gate had no
//                        canvas to judge a grant on).
//   fetchMentionPeople  `GET /api/access/people?canvas=` through the studio's proxy (S9.19's route). The
//                        hub answers only with people who can open THAT canvas; `mentionRows` drops the
//                        rest (addresses, pending invitations, yourself). Null = no source (a local
//                        project, or a build without the proxy): the overlay falls back to git committers.
//
// Neither call throws: a refusal comes back as data the UI can say in a sentence.

import { mentionRows } from '../../../comments/people.ts';

export const OP_URL = '/_api/comments/op';
export const PEOPLE_URL = '/_api/access/people';

/**
 * @param {object} op `{ op: 'add' | 'reply' | …, … }` — comments/ops.ts `parseCommentOp`
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<{ ok: true, comment: object | null } | { ok: false, status: number, code: string, error: string }>}
 */
export async function postCommentOp(op, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(OP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    });
    let body = null;
    try {
      body = await r.json();
    } catch {
      body = null;
    }
    if (r.ok) return { ok: true, comment: body?.comment ?? null };
    return {
      ok: false,
      status: r.status,
      code: typeof body?.code === 'string' ? body.code : 'refused',
      error: typeof body?.error === 'string' ? body.error : 'That did not go through.',
    };
  } catch {
    return { ok: false, status: 0, code: 'offline', error: 'That did not go through.' };
  }
}

/**
 * S9.22b — the Comments panel's Resolve / Reopen / Delete for whoever holds `comment`.
 *   can edit (not read-only)   today's socket lane (`ws` — comments-patch / comments-delete)
 *   Can comment, read-only     the op door (`resolve` / `reopen` / `delete-own`): the socket refuses a
 *                              read-only session, the door judges the op as the session
 *   neither                    no actions — and the door would refuse them anyway (hidden ≠ refused)
 * `canComment` is `/_config.canComment`, the server's answer. A refusal is said in a sentence (`notify`).
 */
export function commentPanelActions({
  viewerMode,
  canComment,
  ws,
  notify,
  post = postCommentOp,
}) {
  if (!viewerMode) return { onResolve: ws.resolve, onReopen: ws.reopen, onDelete: ws.remove };
  if (!canComment) return { onResolve: undefined, onReopen: undefined, onDelete: undefined };
  const door = (op) => (id) =>
    void Promise.resolve(post({ op, id })).then((r) => {
      if (r && !r.ok) notify?.(r.error || 'That did not go through.');
    });
  return { onResolve: door('resolve'), onReopen: door('reopen'), onDelete: door('delete-own') };
}

/**
 * @param {string} canvas designRoot-relative canvas path (`ui/a.tsx`), or '' for the whole project
 * @param {string | null} me the viewer's display name (left out of the list)
 * @returns {Promise<import('../../../comments/people.ts').MentionRow[] | null>}
 */
export async function fetchMentionPeople(canvas, me, fetchImpl = globalThis.fetch) {
  try {
    const qs = canvas ? `?canvas=${encodeURIComponent(canvas)}` : '';
    const r = await fetchImpl(PEOPLE_URL + qs);
    if (!r.ok) return null;
    const body = await r.json();
    return Array.isArray(body?.people) ? mentionRows(body.people, me) : null;
  } catch {
    return null;
  }
}
