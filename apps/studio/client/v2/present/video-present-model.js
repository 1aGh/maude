// client/v2/present/video-present-model.js — S7.19: the pure half of the full-screen video preview (07 ve-fullscreen).
//
// Present · Artboards with `only: 'formats'` plays one video and the formats that share its cut. This file says what the
// chrome shows for it: the name of each format in the top-left switch, where a click on the scrub seeks to, where the
// cut's loop ticks sit, and which messages the transport sends the canvas. DOM-free, so a test drives it directly.

/** The aspects the format switch names (07 ve-fullscreen: "Reels 9:16 · 16:9 · 1:1"). */
const NAMED = [
  [9 / 16, 'Reels 9:16'],
  [16 / 9, '16:9'],
  [1, '1:1'],
  [4 / 5, '4:5'],
];

const finite = (n) => typeof n === 'number' && Number.isFinite(n);

/** "Reels 9:16" / "16:9" / "1:1" for a cell of the Present run; the artboard's own label when its shape is none of those. */
export function formatName(cell) {
  if (!cell) return '';
  if (finite(cell.w) && finite(cell.h) && cell.w > 0 && cell.h > 0) {
    const r = cell.w / cell.h;
    const hit = NAMED.find(([a]) => Math.abs(a - r) < 0.02);
    if (hit) return hit[1];
  }
  return String(cell.label || cell.id || '');
}

/**
 * The format switch's entries, in the run's order: `{ id, name, current }`. Fewer than two formats = no switch at all
 * (hidden, never greyed): a video with no other format is a deck of one.
 */
export function formatSwitch(cells, artboardId) {
  const list = Array.isArray(cells) ? cells.filter((c) => c && typeof c.id === 'string') : [];
  if (list.length < 2) return [];
  return list.map((c) => ({ id: c.id, name: formatName(c), current: c.id === artboardId }));
}

/** The index of artboard `id` in the run — what `present-step { to }` takes. */
export const stepIndexOf = (cells, id) =>
  Array.isArray(cells) ? cells.findIndex((c) => c?.id === id) : -1;

/**
 * Where the cut's picture clips begin, as fractions of the scrub (0..1) — the "loop ticks" the bar draws, so a loop
 * point can be picked out by eye. `clips` and `fps` are `GET /_api/comp-media`'s; the first clip (at 0) is the scrub's own
 * start and gets no tick.
 */
export function loopTicks(clips, fps, durationSec) {
  if (!Array.isArray(clips) || !finite(fps) || fps <= 0 || !finite(durationSec) || durationSec <= 0)
    return [];
  const out = new Set();
  for (const c of clips) {
    if (!c || (c.track !== 'video' && c.track !== 'video2') || !finite(c.from)) continue;
    const at = c.from / fps / durationSec;
    if (at > 0.005 && at < 0.995) out.add(Math.round(at * 1000) / 1000);
  }
  return [...out].sort((a, b) => a - b).slice(0, 64);
}

/** A click or drag at fraction `p` of the scrub → seconds into the clip (clamped; null when there is no clip). */
export function seekSeconds(p, duration) {
  if (!finite(p) || !finite(duration) || duration <= 0) return null;
  return Math.round(Math.min(1, Math.max(0, p)) * duration * 100) / 100;
}

/** The comp (of the canvas's announced comps) the presented artboard mounts, and its fps. */
export function compOf(comps, artboardId) {
  const c = Array.isArray(comps) ? comps.find((x) => x?.artboardId === artboardId) : null;
  if (!c || typeof c.id !== 'string') return null;
  return { id: c.id, fps: finite(c.fps) && c.fps > 0 ? c.fps : 30 };
}

/**
 * The messages that make a format switch carry the loop and the volume over: the new artboard's comp is told, before it
 * plays, what the last one had (07 ve-fullscreen: "switch format without leaving, the loop comes along").
 */
export function carryOver(comp, { loop, volume }) {
  if (!comp) return [];
  return [
    { dgn: 'timeline-loop', loop: !!loop, id: comp.id },
    {
      dgn: 'timeline-volume',
      volume: finite(volume) ? Math.min(1, Math.max(0, volume)) : 1,
      id: comp.id,
    },
  ];
}

/** The `timeline-seek` for a place in seconds; `playing` says whether the transport must start the clip again. */
export function seekMessage(comp, seconds) {
  if (!comp || !finite(seconds) || seconds < 0) return null;
  return { dgn: 'timeline-seek', frame: Math.round(seconds * comp.fps), id: comp.id };
}
