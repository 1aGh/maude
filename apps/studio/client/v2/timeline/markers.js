// client/v2/timeline/markers.js — S7.16: the pure half of ruler markers (07 · ve-long: "Výkop · TD 1 · Poločas · TD 2").
//
// A marker is `{ t, label }` — a moment of the video (seconds) with a short name. `timeline.marker.jump` goes to the
// next or the previous one from the playhead; `timeline.marker.add` puts one at the playhead. Where markers are KEPT
// (the video's meta, shared and visible to an agent — or this viewer's own view) is an open question handed back to
// the lead; this file decides neither: it only orders, jumps and names.
//
// PURE: numbers and words in, numbers and words out.

/** The most markers a video keeps — a runaway paste must not draw a thousand flags. */
export const MAX_MARKERS = 200;
const MAX_LABEL = 40;

const clean = (m) =>
  m && Number.isFinite(m.t) && m.t >= 0
    ? { t: Math.round(m.t * 100) / 100, label: String(m.label ?? '').slice(0, MAX_LABEL) }
    : null;

/** Markers in time order, bad ones dropped, two at the same moment kept once (the later write wins). */
export function sortedMarkers(list) {
  const byT = new Map();
  for (const m of Array.isArray(list) ? list : []) {
    const c = clean(m);
    if (c) byT.set(c.t, c);
  }
  return [...byT.values()].sort((a, b) => a.t - b.t).slice(0, MAX_MARKERS);
}

/**
 * The marker to jump to from `seconds`: the next one after it (`dir: 1`) or the previous one before it (`dir: -1`).
 * A hair of tolerance (`eps`) so standing ON a marker jumps past it. null = there is none that way.
 */
export function jumpTarget(list, seconds, dir = 1, eps = 0.02) {
  const all = sortedMarkers(list);
  if (dir < 0) return [...all].reverse().find((m) => m.t < seconds - eps) ?? null;
  return all.find((m) => m.t > seconds + eps) ?? null;
}

/** The words for a jump: where it went, or why it did not. */
export const MARKER_WORDS = Object.freeze({
  none: 'This video has no markers yet.',
  noNext: 'No marker after this.',
  noPrev: 'No marker before this.',
  at: (m) => (m.label ? `Marker: ${m.label}` : 'Marker'),
  added: (label) => (label ? `Marker “${label}” added.` : 'Marker added.'),
});

/** A name for a marker added with none given: "Marker 3" (the count it makes). */
export const defaultLabel = (list) => `Marker ${sortedMarkers(list).length + 1}`;
