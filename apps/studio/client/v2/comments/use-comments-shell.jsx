// client/v2/comments/use-comments-shell.jsx — S9.22b: the shell's comment wiring S9.22 left open.
//
//   useCommentsShell(…)       one per shell (ShellState): the unread-mention notices (`useMentionNotices`
//                             over the ui-prefs `seen` map), the Share cluster's count (`unreadCount`), the
//                             `comments.filter-*` / `comments.open-thread` runners, and the timeline's
//                             comment flags (`marksFor`, S7.17's hand-off — S7.17 is not in this base yet).
//   ShellMentionCallouts      the "Jonas mentioned you on … · Open" toast, mounted beside <ShellCallouts/>.
//   useMentionSeen()          the `seen` map of GET/POST /_api/ui-prefs (read marks only; S9.22 decision
//                             v2-s9-22-mentions-derived-unread — no new runtime path).
//
// No new state lives here: the comments are the shell's `commentsByFile`, the filter is `commentsFilter`,
// opening a thread is the panel's own `jumpToComment`.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { basename, displayName } from '../../shell/util.js';
import { useShellStore } from '../../stores/shell-store.jsx';
import { humanize } from '../ai/runs-model.js';
import { commentMarks, onLabel } from './comments-model.js';
import { invoke, isNativeApp } from '../../github.js';
import { MentionCallouts, useMentionNotices } from './mention-callouts.jsx';
import { useNativeMentionNotice } from './native-mention-notice.js';

const PREFS = '/_api/ui-prefs';
export const COMMENT_FILTERS = Object.freeze(['open', 'mine', 'resolved', 'all']);

/** The read marks: `{ seen, markSeen }`. Unreachable store → nothing is remembered, nothing breaks. */
export function useMentionSeen({ fetchImpl } = {}) {
  const [seen, setSeen] = useState({});
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(() => fetchRef.current(PREFS))
      .then((r) => (r?.ok ? r.json() : null))
      .then((p) => {
        const s = p?.seen;
        if (live && s && typeof s === 'object' && !Array.isArray(s))
          setSeen((cur) => ({ ...s, ...cur }));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const markSeen = useCallback((patch) => {
    if (!patch || !Object.keys(patch).length) return;
    setSeen((cur) => ({ ...cur, ...patch }));
    Promise.resolve()
      .then(() =>
        fetchRef.current(PREFS, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ seen: patch }),
        })
      )
      .catch(() => {});
  }, []);
  return { seen, markSeen };
}

/** Which file holds thread `id` (a deep link may name only the thread). */
export function fileOfThread(commentsByFile, id) {
  for (const [file, list] of Object.entries(commentsByFile || {}))
    if ((list || []).some((c) => c && c.id === id)) return file;
  return null;
}

/**
 * @param {{ commentsByFile: object, me: string | null, activePath: string | null,
 *           jumpToComment: (file: string, id: string | null) => void,
 *           setCommentsFilter: (f: string) => void, openRightPanel: (id: string) => void,
 *           fetchImpl?: typeof fetch }} p
 */
export function useCommentsShell({
  commentsByFile,
  me,
  activePath,
  jumpToComment,
  setCommentsFilter,
  openRightPanel,
  fetchImpl,
}) {
  const { seen, markSeen } = useMentionSeen({ fetchImpl });
  const notices = useMentionNotices({ commentsByFile, me: me || null, seen, markSeen });
  const live = useRef(null);
  live.current = { commentsByFile, jumpToComment, setCommentsFilter, openRightPanel, notices };

  /** The Comments panel on `filter` (`comments.filter-*`). */
  const showFilter = useCallback((filter) => {
    const { setCommentsFilter: set, openRightPanel: open } = live.current;
    set?.(COMMENT_FILTERS.includes(filter) ? filter : 'open');
    open?.('comments');
  }, []);

  /**
   * `comments.open-thread`: open the thread's canvas, focus its pin, show it in the panel, mark its
   * mentions read. No id = the oldest unread mention's thread, else just the panel.
   */
  const openThread = useCallback((file, id, { markRead = true } = {}) => {
    const cur = live.current;
    let threadId = typeof id === 'string' && id ? id : null;
    let where = typeof file === 'string' && file ? file : null;
    if (!threadId) {
      const first = cur.notices.unread[0];
      if (first) {
        threadId = first.threadId;
        where = first.file;
      }
    }
    if (threadId && !where) where = fileOfThread(cur.commentsByFile, threadId);
    cur.openRightPanel?.('comments');
    if (!threadId || !where) return false;
    cur.jumpToComment?.(where, threadId);
    if (markRead) cur.notices.read(threadId);
    return true;
  }, []);

  /** S7.17's hand-off: the video timeline's comment flags for `artboard` ({id, fps}) on the open canvas. */
  const marksFor = useCallback(
    (artboard) => commentMarks((commentsByFile || {})[activePath] || [], artboard),
    [commentsByFile, activePath]
  );

  return useMemo(
    () => ({
      notices,
      unreadCount: notices.unreadCount,
      showFilter,
      openThread,
      marksFor,
    }),
    [notices, showFilter, openThread, marksFor]
  );
}

/** "A4 · plakát" — where the mentioning thread sits (artboard, or the canvas when it has none). */
export function mentionWhere(commentsByFile, u) {
  const c = ((commentsByFile || {})[u?.file] || []).find((x) => x && x.id === u.threadId);
  const canvasLabel = u?.file ? displayName(basename(u.file)) : '';
  if (!c) return canvasLabel;
  return onLabel({ ...c, file: u.file }, { artboardLabel: (_f, id) => humanize(id), canvasLabel });
}

/**
 * The mention toast, beside <ShellCallouts/>. Reads the shell store's `comments` (useCommentsShell).
 * S9.17 — desktop only, the same notices also go to the Rust shell (`mention_notice`: the Dock badge and
 * one OS notice for a fresh mention while this tab is behind); a browser tab has no `invoke`.
 */
export function ShellMentionCallouts({ native = isNativeApp(), invokeImpl = invoke } = {}) {
  const { comments, shellCore } = useShellStore();
  const byFile = shellCore?.commentsByFile;
  const whereOf = useCallback((u) => mentionWhere(byFile, u), [byFile]);
  useNativeMentionNotice(comments?.notices, { invoke: native ? invokeImpl : undefined, whereOf });
  if (!comments?.notices) return null;
  return (
    <MentionCallouts
      notices={comments.notices}
      // MentionCallouts marks the thread read itself after onOpen
      onOpen={(file, id) => comments.openThread(file, id, { markRead: false })}
      whereOf={whereOf}
    />
  );
}
