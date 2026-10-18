// client/v2/diagnostics/resync-run.js — S11.11: Resync now, from the first click to the sentence.
//
//   "Resyncing…"  →  "Resyncing… 1 204 of 1 318"  →  "Resync done — 3 files sent, nothing else differed."
//
// One notice (id `sync.resync`) is updated in place, so a person sees one line change, not a stack of
// toasts. The numbers come from the server's trace (`resync` on GET /_sync-status; sync/resync-trace.ts),
// so a Resync started from the old Sync panel's button, ⌘K, the menu or `maude design sync resync` all
// read the same. Leaf-ish module: it only imports the model and `requestResync`.

import { requestResync } from './sync-actions.js';
import { resyncNeedsYou, resyncProgressText, resyncResultText } from './resync-model.js';

export const RESYNC_NOTICE_ID = 'sync.resync';
const WAIT_MS = 15 * 60 * 1000;
/** No trace after the route said "restarted": give up looking after this many polls. */
const MISSING_POLLS = 15;

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `GET /_sync-status` → its `resync` view (or null). */
export async function readResyncView(fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn('/_sync-status', { cache: 'no-store' });
    const j = await r.json();
    return j && typeof j === 'object' && j.resync ? j.resync : null;
  } catch {
    return null;
  }
}

/**
 * Start a resync and follow it to its end.
 * @param o.notify  `(notice) => void` — notifications.tsx `notify`
 * @param o.fetchFn / o.sleep / o.pollMs  test seams
 * @returns `{ ok, view? }`
 */
export async function runResync({
  notify,
  fetchFn = globalThis.fetch,
  sleep = defaultSleep,
  pollMs = 1000,
  maxMs = WAIT_MS,
  now = Date.now,
} = {}) {
  const say = (title, kind, timerKey, duration) =>
    notify?.({ id: RESYNC_NOTICE_ID, title, kind, timerKey, ...(duration ? { duration } : {}) });
  say('Resyncing…', 'info', 'run', Infinity);
  const started = await requestResync(fetchFn);
  if (!started.ok) {
    say(started.note, 'error', 'failed');
    return { ok: false };
  }
  // A restart that declined (not linked, asleep…) is the only thing worth saying
  if (started.note) {
    say(started.note, 'info', 'declined');
    return { ok: false };
  }
  const end = now() + maxMs;
  let missing = 0;
  while (now() < end) {
    await sleep(pollMs);
    const view = await readResyncView(fetchFn);
    if (!view) {
      if (++missing >= MISSING_POLLS) {
        say('Resync started — Diagnostics › Sync shows how it is going.', 'info', 'started');
        return { ok: true };
      }
      continue;
    }
    if (view.state === 'running') {
      say(resyncProgressText(view), 'info', 'run', Infinity);
      continue;
    }
    say(resyncResultText(view), resyncNeedsYou(view) ? 'warning' : 'success', 'done');
    return { ok: true, view };
  }
  say('Still resyncing — Diagnostics › Sync shows how far it got.', 'info', 'still');
  return { ok: true };
}
