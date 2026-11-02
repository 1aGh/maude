// client/v2/empty/arriving.jsx — S11.4: "arriving is not empty" in the Canvases panel (05 · es-arriving,
// es-offline-uncached).
//
// The provider half. It reads `GET /_api/sync/availability` (a read over the sync runtime's memory — it never
// asks the hub, routes/availability.ts) and publishes into S1's row-slots store:
//   - one GHOST row per canvas the hub lists that is not on this Mac (`setGhostRows('sync', …)`): dimmed and
//     pulsing while it is on its way (`{ dim, arriving }`, drawn with the kit's ArrivingRow), dimmed with a
//     cloud while offline (`{ dim, notLocal }`);
//   - the foot "Getting <project> · 41 of 93 canvases" (`setFootSlot('arriving', …)`), copy from the 05 table.
//
// THE ONE RACE IT OWNS. The server calls a canvas present the moment the index lists it; the panel's own
// index (`groups`) can be a beat behind. So a row that was arriving and has left `pending` stays an arriving
// ghost until the panel's index lists its path — arriving → present, never a frame of "missing" (and never
// two rows: a ghost whose path the index lists is not drawn). Pure: `arrivingSlots`, pinned by the tests.
//
// Polling is bounded, not a storm: one request in flight, at most one per MIN_GAP_MS, slow when nothing is
// coming (the hub's own remote poll is 20 s), stopped while the panel is unmounted.

import { useEffect, useRef } from 'react';
import { setFootSlot, setGhostRows } from '../canvases/row-slots.js';
import { copy } from './empty-copy.js';

export const MIN_GAP_MS = 1000;
/** How soon to ask again, by phase. `complete`/`solo`: a canvas made elsewhere arrives on the 20 s poll. */
export const NEXT_MS = Object.freeze({
  waiting: 2000,
  arriving: 3000,
  offline: 10000,
  complete: 20000,
  solo: 30000,
});

// "Show canvases on this Mac" (es-offline-uncached): the panel drops the rows that are not here.
let localOnly = false;
const localOnlyListeners = new Set();
export function setShowLocalOnly(on) {
  if (localOnly === !!on) return;
  localOnly = !!on;
  for (const fn of [...localOnlyListeners]) fn(localOnly);
}
export const showLocalOnly = () => localOnly;

const designRelative = (p, designRel) => {
  const prefix = `${String(designRel || '').replace(/^\/+|\/+$/g, '')}/`;
  return prefix !== '/' && p.startsWith(prefix) ? p.slice(prefix.length) : p;
};

/** The designRoot-relative canvas paths the panel's index lists (`groups` from /_index-data). */
export function indexedPaths(groups, designRel) {
  const out = new Set();
  for (const g of groups || []) {
    if (g?.kind && g.kind !== 'canvas') continue;
    for (const p of g?.paths || [])
      if (typeof p === 'string') out.add(designRelative(p, designRel));
  }
  return out;
}

/**
 * The ghosts and the foot for one availability answer.
 * @param {object|null} model  the route's body (`{ phase, done, total, pending, project }`), or null
 * @param {{ indexed: Set<string>, carried?: Map<string, string>, localOnly?: boolean }} o
 *   `carried`: path → name of rows that were arriving in the previous answer (the race above)
 * @returns {{ ghosts: object[], foot: { text: string } | null, carried: Map<string, string> }}
 */
export function arrivingSlots(model, { indexed, carried = new Map(), localOnly: only = false }) {
  const ghosts = [];
  const nextCarried = new Map();
  const drawn = new Set();
  const pending = Array.isArray(model?.pending) ? model.pending : [];
  for (const row of pending) {
    if (!row?.path || indexed.has(row.path) || drawn.has(row.path)) continue;
    drawn.add(row.path);
    if (row.state === 'not-local') {
      if (only) continue;
      ghosts.push({ path: row.path, name: row.name, slot: { dim: true, notLocal: true } });
      continue;
    }
    nextCarried.set(row.path, row.name);
    ghosts.push({ path: row.path, name: row.name, slot: { dim: true, arriving: true } });
  }
  // Arrived on the server's side, not yet in the panel's index: still arriving here, until it is.
  for (const [path, name] of carried) {
    if (drawn.has(path) || indexed.has(path)) continue;
    drawn.add(path);
    nextCarried.set(path, name);
    ghosts.push({ path, name, slot: { dim: true, arriving: true } });
  }
  let foot = null;
  if (model?.phase === 'arriving' && model.project && model.total > 0) {
    foot = {
      text: copy('es-arriving.arriving', {
        count: 0,
        project: model.project,
        done: model.done,
        total: model.total,
      }).foot,
      // 05 es-arriving: the foot carries the board's 4 px bar ("41 of 93" as a share)
      progress: Math.max(0, Math.min(1, Number(model.done) / Number(model.total) || 0)),
    };
  }
  return { ghosts, foot, carried: nextCarried };
}

async function readAvailability(fetchImpl) {
  try {
    const res = await (fetchImpl || fetch)('/_api/sync/availability', {
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * Mount once in the Canvases panel. `groups` is the panel's index (its change re-asks, throttled).
 * @param {{ groups: object[], designRel: string, fetchImpl?: typeof fetch }} o
 */
export function useArrivingRows({ groups, designRel, fetchImpl }) {
  const state = useRef({ model: null, carried: new Map(), inFlight: false, last: 0, timer: null });
  const indexed = useRef(new Set());
  indexed.current = indexedPaths(groups, designRel);

  useEffect(() => {
    const s = state.current;
    let alive = true;
    const publish = () => {
      const out = arrivingSlots(s.model, {
        indexed: indexed.current,
        carried: s.carried,
        localOnly,
      });
      s.carried = out.carried;
      setGhostRows('sync', out.ghosts);
      setFootSlot('arriving', out.foot);
    };
    const schedule = (ms) => {
      clearTimeout(s.timer);
      s.timer = setTimeout(ask, Math.max(ms, MIN_GAP_MS));
    };
    async function ask() {
      if (!alive || s.inFlight) return;
      const since = Date.now() - s.last;
      if (since < MIN_GAP_MS) return schedule(MIN_GAP_MS - since);
      s.inFlight = true;
      s.last = Date.now();
      const model = await readAvailability(fetchImpl);
      s.inFlight = false;
      if (!alive) return;
      // A failed read keeps the last answer (never "nothing is coming" because one request failed).
      if (model) s.model = model;
      publish();
      schedule(NEXT_MS[s.model?.phase] ?? NEXT_MS.complete);
    }
    s.ask = ask;
    s.publish = publish;
    const onLocalOnly = () => publish();
    localOnlyListeners.add(onLocalOnly);
    void ask();
    return () => {
      alive = false;
      clearTimeout(s.timer);
      localOnlyListeners.delete(onLocalOnly);
      s.ask = null;
      s.publish = null;
      setGhostRows('sync', []);
      setFootSlot('arriving', null);
    };
  }, [fetchImpl]);

  // The index moved (a canvas landed, or left): re-draw from the last answer now, and ask again (throttled).
  // biome-ignore lint/correctness/useExhaustiveDependencies: groups/designRel are the trigger, read via `indexed`
  useEffect(() => {
    const s = state.current;
    s.publish?.();
    void s.ask?.();
  }, [groups, designRel]);
}
