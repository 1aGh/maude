// tour-model.js — pure step arithmetic for the tour engine (overlay.jsx). No React, no DOM.
//
// A step marked `optional: true` is SKIPPED when its target cannot be found (a role or shell state
// that has no such element: a read-only person has no Share button, the web studio has no AI chat
// panel, a hidden panel has no tab strip). A skipped step is remembered in `skipped` (a list of
// indices) so Back and the "n / total" counter step over it; a step without `optional` is never
// skipped — it shows centred when its target is missing, as before.

/** The nearest index from `from` in direction `dir` (+1 / -1) that is not skipped; `steps.length`
 *  past the end, `-1` before the start. */
export function stepFrom(from, dir, len, skipped) {
  let j = from + dir;
  while (j >= 0 && j < len && skipped.includes(j)) j += dir;
  return j < 0 ? -1 : j;
}

/** True when no step after `i` is left to show (the primary button reads Done). */
export function isLastVisible(i, len, skipped) {
  return stepFrom(i, 1, len, skipped) >= len;
}

/** "n / total" with the skipped steps taken out of both numbers. */
export function position(i, len, skipped) {
  const before = skipped.filter((s) => s < i).length;
  return { n: i - before + 1, total: Math.max(1, len - skipped.length) };
}

/** Where to go when step `i` turned out to be skipped, travelling in `dir`: the next unskipped step
 *  that way; past the end → `len` (the caller finishes the tour); before the start → the first step
 *  after `i` that is still showable (the tour cannot go back from the beginning). */
export function afterSkip(i, dir, len, skipped) {
  const all = skipped.includes(i) ? skipped : [...skipped, i];
  if (dir >= 0) return stepFrom(i, 1, len, all);
  const back = stepFrom(i, -1, len, all);
  return back >= 0 ? back : stepFrom(i, 1, len, all);
}
