// client/v2/comments/comment-bridge.js — S9.22: the shell's half of the overlay's two new messages.
//
// The overlay lives in the canvas iframe (canvas origin, untrusted — DDR-054) and cannot reach the
// privileged comment door. It posts `comment-op` / `comment-people-request` to the shell; the shell
// calls `handleCommentBridgeMessage(m, ctx)` from the SAME gate every other `dgn` branch sits behind
// (use-canvas-bridge.jsx: `e.source === activeWin`), so a background canvas can neither write comments
// nor read the people list.
//
//   comment-op { reqId, op }          → POST /_api/comments/op → comment-op-result { reqId, ok, comment?, error? }
//   comment-people-request { reqId }  → GET /api/access/people → comment-people { reqId, people | null }
//
// What the iframe may ask is narrowed here, not trusted: an `add` is PINNED to the open canvas (the
// iframe's `file` is ignored — the same rule as `comment-submit`), and only the six op names pass.

import { COMMENT_CONVERT_OPS, COMMENT_OPS, c2sSpec } from '../../../bridge/dgn-protocol.ts';
import {
  conversionOf,
  turnBackIntoSticky,
  undoConversion,
} from '../annotations/annotation-asks.js';
import { postCommentOp, fetchMentionPeople } from './comment-client.js';

const OPS = new Set(COMMENT_OPS);
const CONVERT_OPS = new Set(COMMENT_CONVERT_OPS);

/**
 * S4.V4 G5 — the thread's conversion asks, answered by the shell (S4-S9 §3.4): `to-sticky` runs the S4.7
 * route as the session; `convert-undo` undoes THIS session's conversion of that comment (its action id or
 * token never reaches the canvas); `convert-undoable` says whether the header may offer Undo.
 */
async function convertOp(op, ctx) {
  if (op.op === 'convert-undoable') return { ok: !!conversionOf(op.commentId) };
  if (op.op === 'convert-undo') {
    const undo = conversionOf(op.commentId);
    if (!undo) return { ok: false, error: 'Couldn’t undo that. The comment is still there.' };
    const r = await undoConversion(undo, { fetchImpl: ctx.fetchImpl ?? globalThis.fetch });
    return r.ok ? { ok: true } : { ok: false, error: r.line };
  }
  const r = await turnBackIntoSticky({
    commentId: op.commentId,
    fetchImpl: ctx.fetchImpl ?? globalThis.fetch,
  });
  return r.ok ? { ok: true } : { ok: false, error: r.line };
}

/** The thread an op names, or null for an op that names none of an existing thread's (an add,
 *  an undo of this session's own conversion, the "may I offer Undo" read). */
function namedThread(op) {
  if (op.op === 'add' || op.op === 'convert-undo' || op.op === 'convert-undoable') return null;
  if (op.op === 'to-sticky') return typeof op.commentId === 'string' ? op.commentId : '';
  return typeof op.id === 'string' ? op.id : '';
}

/** Is `m` one of this bridge's messages? (The caller checks the source window first.) */
export const isCommentBridgeMessage = (m) =>
  !!m && (m.dgn === 'comment-op' || m.dgn === 'comment-people-request');

/**
 * S9.22b — the shell's gate for this bridge, in one place: the message came from the ACTIVE canvas's own
 * window (never `null === null`: no active canvas, or a discarded source) and its payload passes the dgn
 * table's parser (bridge/dgn-protocol.ts — unknown keys stripped, caps applied). Every canvas iframe shares
 * the canvas origin (DDR-054), so the origin check before this proves only "a canvas said it"; a
 * background canvas must neither write comments as the session nor read who can open this canvas.
 * @returns the cleaned message, or null to drop it
 */
export function acceptCommentBridge(e, activeWin) {
  const m = e?.data;
  if (!isCommentBridgeMessage(m)) return null;
  if (!activeWin || e.source !== activeWin) return null;
  const parsed = c2sSpec(m.dgn)?.parse(m);
  if (!parsed) return null;
  // assigned, not a `{ dgn }` literal: this is no send site (the bridge inventory reads literals)
  const out = { ...parsed };
  out.dgn = m.dgn;
  return out;
}

/** designRoot-relative path of a repo-relative canvas file (`.design/ui/a.tsx` → `ui/a.tsx`). */
export function canvasRel(activePath, designRel = '.design') {
  const root = `${String(designRel).replace(/^\/+|\/+$/g, '')}/`;
  const p = String(activePath ?? '');
  return p.startsWith(root) ? p.slice(root.length) : p;
}

/**
 * @param {object} m the message
 * @param {{
 *   activePath: string | null,       the open canvas, as the shell knows it
 *   designRel?: string,
 *   me?: string | null,
 *   reply: (message: object) => void, posts back to the iframe that asked
 *   fetchImpl?: typeof fetch,
 * }} ctx
 * @returns {Promise<boolean>} whether the message was handled
 */
export async function handleCommentBridgeMessage(m, ctx) {
  if (!isCommentBridgeMessage(m)) return false;
  const reqId = typeof m.reqId === 'string' || typeof m.reqId === 'number' ? m.reqId : null;
  if (m.dgn === 'comment-people-request') {
    const people = ctx.activePath
      ? await fetchMentionPeople(
          canvasRel(ctx.activePath, ctx.designRel),
          ctx.me ?? null,
          ctx.fetchImpl
        )
      : null;
    ctx.reply({ dgn: 'comment-people', reqId, people });
    return true;
  }
  // Receipt first: the overlay falls back to the v1 message when nobody acks (an older shell), so an
  // ack must mean "this shell owns the op" — before any await, whatever the door later says.
  ctx.reply({ dgn: 'comment-op-ack', reqId });
  const op = m.op;
  // gate-b-c4 — the active frame's own canvas only: an op naming a thread (by `id`, or the
  // conversion's `commentId`) must name one of the ACTIVE canvas's threads. The server resolves
  // the thread's canvas from the id alone and asks the opener's rights there, so canvas code in A
  // could otherwise resolve, reply to, edit or convert the opener's threads on B. (`add` is pinned
  // to `activePath` below; `convert-undo` / `convert-undoable` act on this session's own record.)
  const named = op && typeof op === 'object' ? namedThread(op) : null;
  if (named !== null && !(typeof ctx.ownsComment === 'function' && ctx.ownsComment(named))) {
    ctx.reply({ dgn: 'comment-op-result', reqId, ok: false, error: 'That did not go through.' });
    return true;
  }
  if (op && typeof op === 'object' && CONVERT_OPS.has(op.op)) {
    const r = await convertOp(op, ctx);
    ctx.reply(
      r.ok
        ? { dgn: 'comment-op-result', reqId, ok: true, comment: null }
        : { dgn: 'comment-op-result', reqId, ok: false, error: r.error }
    );
    return true;
  }
  if (!op || typeof op !== 'object' || !OPS.has(op.op)) {
    ctx.reply({ dgn: 'comment-op-result', reqId, ok: false, error: 'That did not go through.' });
    return true;
  }
  let body = op;
  if (op.op === 'add') {
    if (!ctx.activePath) {
      ctx.reply({ dgn: 'comment-op-result', reqId, ok: false, error: 'That did not go through.' });
      return true;
    }
    body = { ...op, file: ctx.activePath };
  }
  const r = await postCommentOp(body, ctx.fetchImpl);
  ctx.reply(
    r.ok
      ? { dgn: 'comment-op-result', reqId, ok: true, comment: r.comment }
      : { dgn: 'comment-op-result', reqId, ok: false, status: r.status, error: r.error }
  );
  return true;
}
