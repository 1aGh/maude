// client/v2/ds/row-dots.js — S10.8: the quiet "update" word on a Canvases row whose canvas was left out of a
// design-system update (13 · ds-edit-instance: "A quiet dot, not a nag"). It is S1's row slot `ds`
// (canvases/row-slots.js): one short word at the row's right, quiet tone, title "Update available".
//
// The index already says which canvases are left out (`canvasDsRevs`) and where each system's head is
// (`systemHeads`, `dsConverted`); a canvas is left out when its revision differs from head (V2-1.6 §5.10). Nothing
// here asks the server for anything. `useDsRowDots(cfg)` is the one hook; the DS review host mounts it.

import { useEffect } from 'react';
import { setRowSlots } from '../canvases/row-slots.js';
import { leftOutMap } from './update-model.js';

export const DS_ROW_SLOT = Object.freeze({
  meta: Object.freeze({ word: 'update', tone: 'quiet', title: 'Update available' }),
});

/** `Map<designRoot-relative path, slot>` for every left-out canvas. */
export function dsRowSlots(cfg) {
  const out = new Map();
  for (const rel of Object.keys(leftOutMap(cfg))) out.set(rel, DS_ROW_SLOT);
  return out;
}

/** Publish the words into S1's store (an empty set clears the source). */
export function publishDsRowDots(cfg) {
  setRowSlots('ds', dsRowSlots(cfg));
}

export function useDsRowDots(cfg) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the index maps are the inputs
  useEffect(() => {
    publishDsRowDots(cfg);
    return () => setRowSlots('ds', null);
  }, [
    cfg?.canvasDsRevs,
    cfg?.systemHeads,
    cfg?.dsConverted,
    cfg?.designSystems,
    cfg?.canvasDesignSystems,
  ]);
}
