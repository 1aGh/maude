// client/v2/empty/select-new-artboard.js — P8 C5 (05 es-artboard-new): "New artboard" leaves the new board SELECTED.
//
// The add is a source write; the canvas reloads on the file watcher and only then has the board. A single
// post right after the write lands before it exists, so the select rides a short ladder (the same shape the
// shell's other post-reload restores use): `select-by-id { artboardId }` is idempotent in the canvas — it
// reveals only when the selection actually changes — so a repeat after the first success costs nothing.
// What this buys: the empty-artboard hint ("Empty artboard." + Ask AI to fill) and the compact Inspector
// appear on the board the person just made, instead of on nothing.

/** ms after the write answered. The reload usually lands inside the first two. */
export const NEW_ARTBOARD_RUNGS = Object.freeze([300, 800, 1600, 3000]);

/**
 * @param {{ artboardId: string, post: (msg: object) => void,
 *   schedule?: (fn: () => void, ms: number) => unknown, clear?: (h: unknown) => void,
 *   rungs?: readonly number[] }} o
 * @returns {() => void} cancel (a canvas switch, or the person selecting something else first)
 */
export function selectNewArtboard({
  artboardId,
  post,
  schedule = (fn, ms) => setTimeout(fn, ms),
  clear = (h) => clearTimeout(h),
  rungs = NEW_ARTBOARD_RUNGS,
}) {
  const handles = rungs.map((ms) =>
    schedule(() => post({ dgn: 'select-by-id', artboardId, index: 0 }), ms)
  );
  return () => {
    for (const h of handles) clear(h);
  };
}
