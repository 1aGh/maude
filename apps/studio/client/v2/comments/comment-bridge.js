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

import { COMMENT_OPS, c2sSpec } from '../../../bridge/dgn-protocol.ts';
import { postCommentOp, fetchMentionPeople } from './comment-client.js';

const OPS = new Set(COMMENT_OPS);

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
