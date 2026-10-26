// client/v2/sync-states/row-words.js — Round 11 (10 co-sync-offline / co-sync-back): what the outbox holds,
// said where the person looks.
//
//   the Canvases panel's rows   "not sent" (offline) / "sending" (back online)   → S1's row-slots store, `sync` source
//   a comment's thread card     "Queued — sends when this Mac is online."        → the shell marks `queued` on the
//                                                                                   comments it pushes to the canvas
//
// Both are READ off the one outbox view `SyncStatesHost` already polls (`GET /_api/outbox` content.byDoc /
// content.comments) — there is no second queue and no per-row state of its own. The Mac is offline ⇒ a
// comment waits; online it is about to be accepted, so no word flashes (model: `queuedCommentIds`).

import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { setRowSlots } from '../canvases/row-slots.js';
import { markQueued, queuedCommentIds, rowSyncSlots } from './sync-states-model.js';

const EMPTY = new Set();
let ids = EMPTY;
const listeners = new Set();

/** Publish the unsent comment ids (the held Set changes only when the ids really changed). */
export function setQueuedComments(next) {
  const n = next instanceof Set ? next : EMPTY;
  if (n.size === ids.size && [...n].every((x) => ids.has(x))) return;
  ids = n.size ? n : EMPTY;
  for (const fn of [...listeners]) fn();
}

const subscribe = (fn) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** The ids of the comments and replies that wait on this Mac (offline only). */
export const useQueuedCommentIds = () =>
  useSyncExternalStore(
    subscribe,
    () => ids,
    () => EMPTY
  );

/** `list` with `queued: true` on the comments that wait — memoised, so a quiet outbox re-renders nothing. */
export function useQueuedMarked(list) {
  const waiting = useQueuedCommentIds();
  return useMemo(() => markQueued(list, waiting), [list, waiting]);
}

/** `commentsByFile` (path → comments) with the queued comments marked — the same object when nothing waits. */
export function useQueuedMarkedByFile(byFile) {
  const waiting = useQueuedCommentIds();
  return useMemo(() => {
    if (!waiting.size || !byFile || typeof byFile !== 'object') return byFile;
    let changed = false;
    const out = {};
    for (const [file, list] of Object.entries(byFile)) {
      const marked = markQueued(list, waiting);
      if (marked !== list) changed = true;
      out[file] = marked;
    }
    return changed ? out : byFile;
  }, [byFile, waiting]);
}

const publishRows = (m) => setRowSlots('sync', m?.size ? m : null);

/**
 * Mount once (SyncStatesHost). `kind` is the Share cluster's status kind, `view` the last
 * `GET /_api/outbox` answer, `canvases` the project index's rows.
 */
export function useOutboxWords({ kind, view, canvases }) {
  useEffect(() => {
    publishRows(rowSyncSlots({ kind, view, canvases }));
    setQueuedComments(queuedCommentIds({ kind, view }));
  }, [kind, view, canvases]);
  useEffect(
    () => () => {
      publishRows(null);
      setQueuedComments(EMPTY);
    },
    []
  );
}
