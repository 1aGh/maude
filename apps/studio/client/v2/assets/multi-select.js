// client/v2/assets/multi-select.js — which tiles are picked in the wide Browse view (S8.13; 12 · ia-assets-browse).
//
//   click          picks that one tile (and makes it the anchor)
//   ⌘ / ctrl click adds it to the picked ones, or takes it off
//   ⇧ click        picks everything from the anchor to that tile, in the order the tiles are drawn
//
// Pure functions over the ids in DRAW ORDER: the view hands in the ids as it draws them (after sort and search), so a
// range is what the eye sees. The picked set is read back in that same order (`inOrder`), which is the order ↵ fills
// the frames: reading order, never the order the clicks came in.

/** @typedef {{ selected: ReadonlySet<string>, anchor: string | null }} Picked */

export const NOTHING_PICKED = Object.freeze({ selected: new Set(), anchor: null });

/**
 * The picked set after a click on `id`.
 * @param {string[]} ids every tile, in draw order
 * @param {Picked} state
 * @param {string} id
 * @param {{ shift?: boolean, meta?: boolean }} [mods]
 * @returns {Picked}
 */
export function pick(ids, state, id, { shift = false, meta = false } = {}) {
  if (!ids.includes(id)) return state;
  if (shift && state.anchor && ids.includes(state.anchor)) {
    const a = ids.indexOf(state.anchor);
    const b = ids.indexOf(id);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const range = ids.slice(lo, hi + 1);
    // ⌘⇧ keeps what was picked; a plain ⇧ makes the range the whole pick (the anchor stays)
    const base = meta ? state.selected : new Set();
    return { selected: new Set([...base, ...range]), anchor: state.anchor };
  }
  if (meta) {
    const next = new Set(state.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return { selected: next, anchor: id };
  }
  return { selected: new Set([id]), anchor: id };
}

/** The picked ids in draw order; a picked id that is no longer drawn (filtered out, trashed) is dropped. */
export function inOrder(ids, selected) {
  return ids.filter((id) => selected.has(id));
}

/** Select every drawn tile. */
export function pickAll(ids) {
  return { selected: new Set(ids), anchor: ids[0] ?? null };
}

/** Total bytes of the picked rows. */
export function bytesOf(rows, selected) {
  let n = 0;
  for (const r of rows) if (selected.has(r.path)) n += Number(r.size) || 0;
  return n;
}
