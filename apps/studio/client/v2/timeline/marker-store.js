// client/v2/timeline/marker-store.js — S7.16: a video's ruler markers, read and written (`timeline.marker.add/jump/remove`).
//
// They live in the versioned canvas meta as `artboardMeta[id].markers` ([{ frame, name }], ≤ 200): part of the cut, so a
// collaborator and the agent see them. Reading is `GET /_api/canvas-meta?file=` (the agent's door too); writing is the
// one meta route, `PATCH /_api/present-meta { file, markers: { [id]: [...] | null } }` — Can edit and up, refused below
// that by the server whatever the UI shows. A small store (like poster.js) so the ruler's flags and the ⌘K rows read one
// answer; the playhead an action works AT is read through `bindMarkerSource`, which the Timeline keeps current.

import { useSyncExternalStore } from 'react';
import { jumpTarget, MARKER_WORDS, sortedMarkers, withMarker, withoutMarker } from './markers.js';

const entries = new Map(); // `${file}\u0000${id}` → [{ frame, name }]
const subs = new Set();
let version = 0;
const keyOf = (file, id) => `${file}\u0000${id}`;
const notify = () => {
  version++;
  for (const fn of subs) fn();
};
const NONE = Object.freeze([]);

/** The markers of one video, in frame order. */
export const markersOf = (file, id) => entries.get(keyOf(file, id)) ?? NONE;

/** Read what the canvas's meta says about this video's markers. */
export async function loadMarkers(file, id, fetchImpl = globalThis.fetch) {
  if (!file || !id) return;
  try {
    const r = await fetchImpl(`/_api/canvas-meta?file=${encodeURIComponent(file)}`);
    if (!r.ok) throw new Error(String(r.status));
    const meta = await r.json();
    entries.set(keyOf(file, id), sortedMarkers(meta?.artboardMeta?.[id]?.markers));
  } catch {
    // what is on screen stays
  }
  notify();
}

/** Store the whole list (`[]` = none). Resolves `{ ok, message? }`; the flags move at once and go back if the server says no. */
export async function saveMarkers(file, id, list, fetchImpl = globalThis.fetch) {
  const before = markersOf(file, id);
  const next = sortedMarkers(list);
  entries.set(keyOf(file, id), next);
  notify();
  try {
    const r = await fetchImpl('/_api/present-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, markers: { [id]: next.length ? next : null } }),
    });
    if (!r.ok) throw new Error(String(r.status));
    const body = await r.json();
    entries.set(keyOf(file, id), sortedMarkers(body?.markers?.[id]));
    notify();
    return { ok: true };
  } catch (e) {
    entries.set(keyOf(file, id), before);
    notify();
    return {
      ok: false,
      message: /403/.test(String(e?.message)) ? MARKER_WORDS.readOnly : MARKER_WORDS.failed,
    };
  }
}

// ── the playhead the actions read ───────────────────────────────────────────────────────────────────
let source = () => null;
/** The Timeline says where the playhead is: `() => ({ file, artboardId, frame, seek(frame) } | null)`. */
export function bindMarkerSource(fn) {
  source = typeof fn === 'function' ? fn : () => null;
}

/** `timeline.marker.add`: a marker at the playhead of the followed video (a marker already there is renamed). Resolves the toast's words. */
export async function addMarkerAtPlayhead(name, fetchImpl = globalThis.fetch) {
  const at = source();
  if (!at?.file || !at.artboardId) return MARKER_WORDS.none;
  const put = withMarker(markersOf(at.file, at.artboardId), at.frame, name);
  if (put.refused) return MARKER_WORDS.full;
  const done = await saveMarkers(at.file, at.artboardId, put.list, fetchImpl);
  return done.ok ? MARKER_WORDS.added(put.added.name) : done.message;
}

/** `timeline.marker.remove`: the marker on the playhead's frame goes. */
export async function removeMarkerAtPlayhead(fetchImpl = globalThis.fetch) {
  const at = source();
  if (!at?.file || !at.artboardId) return MARKER_WORDS.none;
  const frame = Math.max(0, Math.round(at.frame));
  const mine = markersOf(at.file, at.artboardId);
  const gone = mine.find((m) => m.frame === frame);
  if (!gone) return MARKER_WORDS.noneHere;
  const done = await saveMarkers(at.file, at.artboardId, withoutMarker(mine, frame), fetchImpl);
  return done.ok ? MARKER_WORDS.removed(gone.name) : done.message;
}

/** `timeline.marker.jump`: the playhead goes to the next (`dir: 1`) or the previous (`dir: -1`) marker. Resolves the toast's words. */
export function jumpMarkerFromPlayhead(dir = 1) {
  const at = source();
  if (!at?.file || !at.artboardId) return MARKER_WORDS.none;
  const mine = markersOf(at.file, at.artboardId);
  if (!mine.length) return MARKER_WORDS.noMarkers;
  const to = jumpTarget(mine, at.frame, dir < 0 ? -1 : 1);
  if (!to) return dir < 0 ? MARKER_WORDS.noPrev : MARKER_WORDS.noNext;
  at.seek?.(to.frame);
  return MARKER_WORDS.at(to);
}

/** Re-renders when any video's markers change. */
export function useMarkersVersion() {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => version,
    () => version
  );
}
