// client/v2/timeline/edit/ripple.js — S7.9: the numbers behind a gesture's tip. The video is as long as its
// clips (07 · ve-trim-split), so a trim that closes a gap shortens it, and a layer reaching further than the beats
// holds it where it is. This mirrors what the writer does (`clip.retime` ends in `applyFitTotalToContent`), but only
// to SAY it: the file is never written from here, and a mismatch changes a tip, not a cut.

/**
 * The video's length in frames after clip `index` is trimmed to `newDuration` (and, for a layer, started at
 * `newFrom`). Series beats close up: every later beat moves by the change. Layers do not ripple.
 * @param {{ sequences: Array<{ from: number, duration: number, series?: boolean }>, index: number,
 *           newDuration: number, newFrom?: number | null }} p
 */
export function totalAfterRetime({ sequences, index, newDuration, newFrom = null }) {
  const edited = sequences[index];
  if (!edited) return 0;
  const delta = newDuration - edited.duration;
  let end = 0;
  sequences.forEach((s, i) => {
    let from = s.from;
    let duration = s.duration;
    if (i === index) {
      duration = newDuration;
      if (newFrom != null && !s.series) from = newFrom;
    } else if (edited.series && s.series && s.from > edited.from) {
      from += delta;
    }
    end = Math.max(end, from + duration);
  });
  return Math.max(0, end);
}

/**
 * Where a lifted beat will land, from the drag's own slots.
 * `slot` is where it started among `count` beats; `targetSlot` is its place among the OTHER beats (0 = first,
 * `count − 1` = last). Returns the beat it goes before / after — an index into the beats as they stood before the
 * lift — or null when it would land where it started.
 * @returns {{ position: 'before' | 'after', refSlot: number } | null}
 */
export function moveLanding({ count, slot, targetSlot }) {
  if (count < 2 || targetSlot === slot) return null;
  const others = Array.from({ length: count }, (_, i) => i).filter((i) => i !== slot);
  if (targetSlot >= others.length) return { position: 'after', refSlot: others[others.length - 1] };
  return { position: 'before', refSlot: others[Math.max(0, targetSlot)] };
}
