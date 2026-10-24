// client/v2/empty/free-centre.js — P8 C5 (05 es-canvas-ai, es-offline-uncached): where the middle of the free
// canvas is. The empty block centres on what the panels leave, not on the window — a left panel pushes it
// right (the board draws it at ~0.59 of the window width), a right panel pushes it left.

import { visibleRect } from '../../../bridge/occlusion.ts';

/** x (px from the window's left edge) of the middle of the canvas the islands leave free. */
export function freeCentre(insets, width, height) {
  const v = visibleRect(width, height, insets);
  return Math.round(v.x + v.w / 2);
}
