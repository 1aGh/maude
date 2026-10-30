// client/v2/sync-states/offline-foot.jsx — S9.24: the Canvases panel foot of a day offline and of the way
// back (10 · co-sync-offline "14 changes since yesterday 18:20 — kept on this Mac", co-sync-back "Sending
// 14 changes · 9 sent").
//
// The provider half: it publishes into S1's row-slots store as the `sync` foot (the store's order is
// sync > arriving > jump > access > default, row-slots.js) and never draws anything itself. "since" is
// when this Mac first held a change it could not send — remembered per Mac across a restart (a day
// offline survives a relaunch); "peak" is how many waited when sending began, so the count goes UP
// ("9 sent") instead of only down.

import { useEffect, useRef } from 'react';
import { setFootSlot } from '../canvases/row-slots.js';
import { syncFoot } from './sync-states-model.js';

const SINCE_KEY = 'maude-offline-since';
/** how long a relaunch waits for the outbox to be read before an empty queue means "all sent" */
const SETTLE_MS = 20_000;

const readSince = () => {
  try {
    const v = Number(localStorage.getItem(SINCE_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
const writeSince = (v) => {
  try {
    if (v) localStorage.setItem(SINCE_KEY, String(v));
    else localStorage.removeItem(SINCE_KEY);
  } catch {
    /* a private window: the foot just omits "since" after a relaunch */
  }
};

/**
 * Mount once (SyncStatesHost). `kind` is the Share cluster's status kind; `pending` the changes still on
 * this Mac (hub queuedOps + the outbox's content lane).
 * @param {{ kind: string, pending: number, now?: () => number }} o
 */
export function useOfflineFoot({ kind, pending, now = Date.now }) {
  const s = useRef({ since: null, peak: 0, saw: false });
  if (s.current.since === null) s.current.since = readSince();

  useEffect(() => {
    const st = s.current;
    const waiting = Number(pending) > 0 ? Number(pending) : 0;
    if (kind === 'offline' && waiting > 0 && !st.since) {
      st.since = now();
      writeSince(st.since);
    }
    if (kind === 'offline') st.peak = 0;
    else if (kind === 'syncing') st.peak = Math.max(st.peak, waiting);
    // this run has seen the queue hold something (or the Mac offline) — a later empty one is real
    if (waiting > 0 || kind === 'offline' || kind === 'syncing') st.saw = true;
    let settle = null;
    if (!waiting && kind !== 'offline') {
      // everything left this Mac: the next day offline starts its own "since". The first paint after a
      // relaunch looks the same (kind not known yet, queue not read, pending 0) and must NOT forget a day
      // offline (10 co-sync-offline: "since yesterday 18:20" read "since 01:36") — a stored "since" waits
      // for the queue to be read before an empty one counts as drained.
      const forget = () => {
        st.since = null;
        st.peak = 0;
        writeSince(null);
        setFootSlot('sync', null);
      };
      if (st.saw || !st.since) forget();
      else settle = setTimeout(forget, SETTLE_MS);
    }
    setFootSlot(
      'sync',
      syncFoot({ kind, pending: waiting, since: st.since, peak: st.peak, now: now() })
    );
    return () => clearTimeout(settle);
  }, [kind, pending, now]);

  useEffect(() => () => setFootSlot('sync', null), []);
}
