// editing/clipped-grab.ts — r1 #12 (Michal, rc.1: "once I move an object off the artboard I have no way to move it
// back"). An artboard clips its content (Clip content, on for a fixed-size artboard), so an object dragged past its
// edge paints nothing out there and the browser's hit-test never reaches it: a press on its selection box landed on
// empty canvas, where the canvas marquee cleared the selection, and no drag began.
//
// The rule (Figma's): a press inside the SELECTED object's box grabs that object, even where the artboard clips it.
// Only a press that lands outside every artboard body counts — inside an artboard the ordinary hit-test already
// answers, so nothing else changes. An object that is clipped and NOT selected stays reachable through Layers (a row
// selects it, and its box can then be dragged back).

import { resolveSelectionEl } from '../dom-selection.ts';
import type { Selection } from '../use-selection-set.tsx';

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;

/**
 * The selected object a press at (x, y) grabs although the browser's hit-test missed it (it is clipped by its
 * artboard), or null. `target` is the press's own target.
 */
export function clippedGrab(
  doc: Document,
  x: number,
  y: number,
  target: EventTarget | null,
  selected: readonly Selection[]
): HTMLElement | null {
  if (selected.length !== 1) return null;
  const t = target as Element | null;
  // inside an artboard body the ordinary hit-test is the truth; on chrome (a toolbar, a menu) nothing is grabbed
  if (!t?.closest || t.closest('.dc-artboard-body')) return null;
  if (!t.closest('.dc-canvas')) return null;
  const one = selected[0] as Selection;
  if (typeof one.id !== 'string') return null;
  const el = resolveSelectionEl(doc, one) as HTMLElement | null;
  if (!el?.closest('.dc-artboard-body')) return null;
  return inside(el.getBoundingClientRect(), x, y) ? el : null;
}
