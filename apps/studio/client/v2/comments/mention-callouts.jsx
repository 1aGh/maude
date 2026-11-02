// client/v2/comments/mention-callouts.jsx — S9.22: "Jonas mentioned you on A4 · plakát · Open" and the
// unread count on the Share cluster's Comments icon (`share-cluster-comments-count`).
//
// `useMentionNotices` derives both from the comments themselves (mention-model.js) — a mention is a
// message that names you, so it counts whether it arrived live, over sync while you were away, or from a
// hub that never sent the nudge. The toast fires only for mentions that appear AFTER the first load of
// this page (a relaunch counts them; it does not shout them). The hub's native notice, Dock badge and
// e-mail are S9.18's and ride the same `maude.mention` message; this surface needs none of them.
//
// Mounted by the shell (patch request, see the S9.22 hand-back): `<MentionCallouts …/>` beside
// `<ShellCallouts/>`, and `unreadCount` into the Share cluster's `commentsCount`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalloutStack } from '../shell/callouts.jsx';
import {
  markThreadRead,
  mentionCallout,
  newMentions,
  unreadMentions,
  unreadThreadCount,
} from './mention-model.js';

const BASELINE_MS = 1500;

/**
 * @param {{ commentsByFile: object, me: string | null, seen?: Record<string, true>,
 *           markSeen?: (patch: Record<string, true>) => void }} p
 * @returns {{ unread: object[], unreadCount: number, toasts: object[], dismiss: (key: string) => void,
 *             read: (threadId: string) => void }}
 */
export function useMentionNotices({ commentsByFile, me, seen, markSeen }) {
  const unread = useMemo(
    () => unreadMentions(commentsByFile, me, seen),
    [commentsByFile, me, seen]
  );
  const known = useRef(null); // Set of keys present at the baseline; null until established
  const [toasts, setToasts] = useState([]);

  // Establish the baseline once comments have arrived (or after a short wait, for a project with none).
  useEffect(() => {
    if (known.current) return undefined;
    if (Object.keys(commentsByFile || {}).length > 0 && me) {
      known.current = new Set(unread.map((u) => u.key));
      return undefined;
    }
    const t = setTimeout(() => {
      known.current ??= new Set();
    }, BASELINE_MS);
    return () => clearTimeout(t);
  }, [commentsByFile, me, unread]);

  useEffect(() => {
    if (!known.current) return;
    const fresh = newMentions(unread, known.current);
    if (!fresh.length) return;
    for (const u of fresh) known.current.add(u.key);
    setToasts((prev) => [...prev, ...fresh]);
  }, [unread]);

  const dismiss = useCallback((key) => setToasts((prev) => prev.filter((t) => t.key !== key)), []);
  const read = useCallback(
    (threadId) => {
      const patch = markThreadRead(unread, threadId);
      if (Object.keys(patch).length) markSeen?.(patch);
      setToasts((prev) => prev.filter((t) => t.threadId !== threadId));
    },
    [unread, markSeen]
  );

  return { unread, unreadCount: unreadThreadCount(unread), toasts, dismiss, read };
}

/** The toast stack. `onOpen(file, threadId)` opens the thread (the shell's `comments.open-thread`). */
export function MentionCallouts({ notices, onOpen, whereOf }) {
  const items = (notices?.toasts ?? []).slice(-1).map((u) => ({
    ...mentionCallout(u, whereOf?.(u) ?? ''),
    _u: u,
  }));
  if (!items.length) return null;
  return (
    <CalloutStack
      items={items}
      onAction={(item) => {
        onOpen?.(item._u.file, item._u.threadId);
        notices.read(item._u.threadId);
      }}
      onDismiss={(item) => notices.dismiss(item.key)}
    />
  );
}
