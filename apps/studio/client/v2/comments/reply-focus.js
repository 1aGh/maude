// client/v2/comments/reply-focus.js — S6.11b: a thread landing (an invite or a mention, shell://navigate)
// opens the thread with its reply field focused.
//
// The shell tells the canvas over `comment-focus {id, reply: true}` (bridge/dgn-protocol.ts). A landing
// often opens a NEW tab, whose frame is not up when `jumpToComment` first sends — the frame's `loaded`
// handler re-sends the focus, so the request is remembered here for a short while and that re-send
// carries it too. A plain jump (a click in the Comments panel) clears it.

export const REPLY_FOCUS_TTL_MS = 10_000;
let pending = null;

/** Remember (id) or clear (null) the thread whose reply field should take the focus. */
export function wantReplyFocus(id, now = Date.now()) {
  pending = typeof id === 'string' && id ? { id, at: now } : null;
}

/** Is a reply-field focus asked for thread `id` right now? */
export function replyFocusFor(id, now = Date.now()) {
  return (
    !!pending &&
    typeof id === 'string' &&
    pending.id === id &&
    now - pending.at <= REPLY_FOCUS_TTL_MS
  );
}

/** The `comment-focus` message; `reply` only when asked (an older canvas ignores the field). */
export function commentFocusMessage(id, reply = false) {
  return reply === true ? { dgn: 'comment-focus', id, reply: true } : { dgn: 'comment-focus', id };
}
