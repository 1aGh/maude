// client/v2/timeline/markers.js — S7.16: the pure half of ruler markers (07 · ve-long: "Výkop · TD 1 · Poločas · TD 2").
//
// A marker is `{ frame, name }` — a comp frame with a short plain-text name, kept in the video's meta as
// `artboardMeta[id].markers` (marker-store.js) so collaborators and the agent see the same cut. `timeline.marker.jump`
// goes to the next or the previous one from the playhead; `timeline.marker.add` puts one at the playhead. The limits are
// the server's (present/meta-schema.ts): at most 200 per video, one per frame, a name up to 60 characters.
//
// PURE: numbers and words in, numbers and words out.

import { MAX_MARKER_NAME, MAX_MARKERS } from '../../../present/meta-schema.ts';

export { MAX_MARKER_NAME, MAX_MARKERS };

const cleanName = (n) => {
  let out = '';
  for (const ch of String(n ?? '')) {
    const c = ch.charCodeAt(0);
    if (c >= 32 && c !== 127 && c !== 60 && c !== 62) out += ch; // no control characters, no < >
  }
  return out.trim().slice(0, MAX_MARKER_NAME);
};
const clean = (m) =>
  m && Number.isInteger(m.frame) && m.frame >= 0
    ? { frame: m.frame, name: cleanName(m.name) }
    : null;

/** Markers in frame order, bad ones dropped, two on one frame kept once (the later one wins), at most 200. */
export function sortedMarkers(list) {
  const byFrame = new Map();
  for (const m of Array.isArray(list) ? list : []) {
    const c = clean(m);
    if (c) byFrame.set(c.frame, c);
  }
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame).slice(0, MAX_MARKERS);
}

/**
 * The marker to jump to from `frame`: the next one after it (`dir: 1`) or the previous one before it (`dir: -1`).
 * Standing ON a marker jumps past it. null = there is none that way.
 */
export function jumpTarget(list, frame, dir = 1) {
  const all = sortedMarkers(list);
  if (dir < 0) return [...all].reverse().find((m) => m.frame < frame) ?? null;
  return all.find((m) => m.frame > frame) ?? null;
}

/** A name for a marker added with none given: "Marker 3" (the count it makes). */
export const defaultName = (list) => `Marker ${sortedMarkers(list).length + 1}`;

/**
 * The list with a marker put at `frame`. A marker already on that frame is renamed (never a second one).
 * @returns {{ list: object[], added: object } | { refused: 'full' }}
 */
export function withMarker(list, frame, name) {
  const all = sortedMarkers(list);
  const f = Math.max(0, Math.round(frame));
  const taken = all.some((m) => m.frame === f);
  if (!taken && all.length >= MAX_MARKERS) return { refused: 'full' };
  const added = { frame: f, name: cleanName(name) || defaultName(all) };
  return { list: sortedMarkers([...all.filter((m) => m.frame !== f), added]), added };
}

/** The list without the marker on `frame` (nothing there: the same list). */
export const withoutMarker = (list, frame) => sortedMarkers(list).filter((m) => m.frame !== frame);

/** The words for adding, jumping and the refusals. */
export const MARKER_WORDS = Object.freeze({
  none: 'Select a video first.',
  noMarkers: 'This video has no markers yet.',
  noneHere: 'No marker on this frame.',
  noNext: 'No marker after this.',
  noPrev: 'No marker before this.',
  at: (m) => (m.name ? `Marker: ${m.name}` : 'Marker'),
  added: (name) => `Marker “${name}” added.`,
  removed: (name) => `Marker “${name}” removed.`,
  full: `A video keeps up to ${MAX_MARKERS} markers.`,
  readOnly: 'Your role can’t change markers.',
  failed: 'Not saved — the markers stay as they were.',
});
