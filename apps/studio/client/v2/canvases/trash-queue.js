// client/v2/canvases/trash-queue.js — #194 (2.0.4): Move to trash answers at once, and several in a row all land.
//
// The report: "nothing happens for a while when I click the trash can … moving several canvases one after
// another doesn't do anything". Before, the row stayed as it was until `DELETE /_api/canvas` answered AND a
// whole fresh project index (`/_index-data`) had been read — and every new delete's tree refresh threw the
// read in flight away (`index-loader.ts`: a newer request wins), so three quick deletes showed nothing until
// the last read settled. On a Maude Cloud project each of those is a trip to the cell.
//
// Now every door (the row menu, ⌘K, the File menu) goes through ONE queue:
//   1. the row says "Moving to trash…" and fades the moment it is asked (a `trash` row slot, row-slots.js);
//   2. the moves go out one at a time, in the order asked — none is dropped, a second ask for the same canvas
//      while it is waiting is the same move;
//   3. the server's yes takes the row out of the list at once (`gone`, the panel hides it) and the toast with
//      Undo shows; the list then re-reads, and the row stays out once the index agrees;
//   4. a refusal brings the row back as it was, and the toast says why (TRASH_WORDS.failed).
// Undo is unchanged (trash-canvas.js).

import { useSyncExternalStore } from 'react';

import { registerRowSlot } from './row-slots.js';
import { trashCanvas } from './trash-canvas.js';

export const TRASH_QUEUE_WORDS = Object.freeze({
  moving: 'Moving to trash…',
});

/** How long a confirmed move keeps its row hidden after the list re-read, so the fresh list lands first. */
export const GONE_SETTLE_MS = 400;

/**
 * A queue of canvas moves to the trash, with its own small store: which canvases are on their way
 * (`moving`) and which the server has taken (`gone`).
 * @param {{ settleMs?: number, slot?: typeof registerRowSlot }} [opts]
 */
export function createTrashQueue({ settleMs = GONE_SETTLE_MS, slot = registerRowSlot } = {}) {
  /** path → { state: 'moving' | 'gone', dispose?: () => void } */
  const items = new Map();
  const listeners = new Set();
  let gone = Object.freeze(new Set());
  let chain = Promise.resolve();

  const publish = () => {
    gone = Object.freeze(
      new Set([...items].filter(([, it]) => it.state === 'gone').map(([p]) => p))
    );
    for (const fn of [...listeners]) fn();
  };
  const forget = (path) => {
    const it = items.get(path);
    if (!it) return;
    it.dispose?.();
    items.delete(path);
    publish();
  };

  /**
   * Ask for one move. `run({ path, label, removed })` does the move and calls `removed()` the moment the
   * server has taken it; it resolves `{ ok }` when it is completely done (list re-read included).
   * @returns {Promise<{ ok: boolean, error?: string, queued?: boolean }>}
   */
  function enqueue({ path, label, rel }, run) {
    if (typeof path !== 'string' || !path) return Promise.resolve({ ok: false });
    if (items.has(path)) return Promise.resolve({ ok: true, queued: true });
    const dispose = slot(
      'trash',
      rel || path,
      Object.freeze({ sub: { text: TRASH_QUEUE_WORDS.moving, icon: 'trash' }, dim: true })
    );
    items.set(path, { state: 'moving', dispose });
    publish();
    let finish;
    const result = new Promise((resolve) => {
      finish = resolve;
    });
    // The queue moves on once the SERVER has answered this move — it never waits on the list re-read.
    chain = chain.then(
      () =>
        new Promise((answered) => {
          const removed = () => {
            const it = items.get(path);
            if (it && it.state === 'moving') {
              it.dispose?.();
              items.set(path, { state: 'gone' });
              publish();
            }
            answered();
          };
          Promise.resolve()
            .then(() => run({ path, label, removed }))
            .catch(() => ({ ok: false }))
            .then((res) => {
              answered();
              if (res?.ok) setTimeout(() => forget(path), settleMs);
              else forget(path); // the row comes back as it was
              finish(res ?? { ok: false });
            });
        })
    );
    return result;
  }

  return {
    enqueue,
    /** Canvases the server has taken whose row is still listed until the list re-reads. */
    gone: () => gone,
    stateOf: (path) => items.get(path)?.state ?? null,
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Forget everything (tests, a project switch). */
    reset() {
      for (const it of items.values()) it.dispose?.();
      items.clear();
      chain = Promise.resolve();
      publish();
    },
  };
}

/** The window's one queue. */
export const trashQueue = createTrashQueue();

/** The panel's hook: the set of repo paths to leave out of the list until the index agrees. */
export function useTrashGone(queue = trashQueue) {
  return useSyncExternalStore(queue.subscribe, queue.gone, queue.gone);
}

/**
 * `groups` (the `/_index-data` groups) without the canvases the server has taken: the canvas and its
 * same-name sidecars (`<name>.meta.json` …) leave every group's `paths`, so folder counts follow.
 */
export function withoutGone(groups, gone) {
  if (!gone?.size || !Array.isArray(groups)) return groups;
  const prefixes = [...gone].map((p) => p.replace(/\.tsx$/i, '.'));
  const hidden = (p) => gone.has(p) || prefixes.some((pre) => p.startsWith(pre));
  return groups.map((g) =>
    Array.isArray(g.paths) && g.paths.some(hidden)
      ? { ...g, paths: g.paths.filter((p) => !hidden(p)) }
      : g
  );
}

/**
 * Move one canvas to the trash through the queue: the shell's `deleteBoard`. Same arguments as
 * `trashCanvas`, plus `rel` (the designRoot-relative path the row slots are keyed by) and `queue`.
 */
export function queueTrashCanvas({ queue = trashQueue, path, label, rel, ...rest }) {
  return queue.enqueue({ path, label, rel }, ({ removed }) =>
    trashCanvas({ ...rest, path, label, onRemoved: removed })
  );
}
