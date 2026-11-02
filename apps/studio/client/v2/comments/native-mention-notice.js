// client/v2/comments/native-mention-notice.js — S9.17: this project's unread mentions, told to the
// desktop shell (notify.rs `mention_notice`).
//
// The page already knows them (S9.22 `useMentionNotices`: the unread set derived from the comments,
// the toasts for the ones that arrived after this page loaded). The shell needs two things from it:
//   count   threads with an unread mention (the Share cluster's number) — joins the Dock badge
//   latest  the newest FRESH mention (a toast) — one OS notice when this tab is not in front,
//           whose click opens the thread here
// Rust takes the project from the calling tab, cuts the name to a first word and the place to a few
// words, drops anything address-like and rate-limits; nothing else of the comment is sent.
//
// Mounted by the shell beside `<MentionCallouts/>` (patch request, S9.17 hand-back), desktop only.

import { useEffect, useRef } from 'react';

/**
 * Pure: the `mention_notice` arguments for `notices` (a `useMentionNotices` result).
 * `whereOf(u)` = "A4 · plakát" for an unread entry (the same words the toast uses).
 * @returns {{ count: number, latest: null | { key: string, from: string, where: string | null,
 *            canvas: string, thread: string } }}
 */
export function mentionNoticeArgs(notices, whereOf) {
  const n = Number(notices?.unreadCount);
  const count = Number.isInteger(n) && n > 0 ? n : 0;
  const toasts = Array.isArray(notices?.toasts) ? notices.toasts : [];
  const last = toasts[toasts.length - 1];
  if (!last || typeof last.key !== 'string' || typeof last.file !== 'string') {
    return { count, latest: null };
  }
  const where = whereOf?.(last);
  return {
    count,
    latest: {
      key: last.key,
      from: typeof last.from === 'string' ? last.from : 'Someone',
      where: typeof where === 'string' && where ? where : null,
      canvas: last.file,
      thread: String(last.threadId ?? ''),
    },
  };
}

/**
 * Pure: what to send after `prev` (the last sent `{count, key}`): nothing when neither the count nor
 * the newest fresh mention changed; a mention is sent once, a count change alone carries `latest: null`.
 * @returns {{ send: boolean, payload: object, next: { count: number, key: string | null } }}
 */
export function nextMentionNotice(prev, args) {
  const key = args.latest?.key ?? null;
  const next = { count: args.count, key };
  const fresh = key !== null && key !== prev?.key;
  const send = fresh || args.count !== prev?.count;
  return { send, payload: { count: args.count, latest: fresh ? args.latest : null }, next };
}

/** Tell the shell (desktop only: `invoke` is the Tauri one, absent in a browser). */
export function useNativeMentionNotice(notices, { invoke, whereOf } = {}) {
  const sent = useRef({ count: -1, key: null });
  const unreadCount = notices?.unreadCount;
  const toasts = notices?.toasts;
  useEffect(() => {
    if (typeof invoke !== 'function') return;
    const step = nextMentionNotice(
      sent.current,
      mentionNoticeArgs({ unreadCount, toasts }, whereOf)
    );
    sent.current = step.next;
    if (!step.send) return;
    Promise.resolve()
      .then(() => invoke('mention_notice', step.payload))
      .catch(() => {});
  }, [unreadCount, toasts, invoke, whereOf]);
}
