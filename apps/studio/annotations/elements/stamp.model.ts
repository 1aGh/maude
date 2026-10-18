/**
 * Stamp (contract S4 Q7, Gate 0 A18) — a small reaction glyph (+1, heart, ✓ …)
 * dropped on a spot. A format-2 element TYPE (V2-1.12 R4): a format-1 peer keeps
 * it verbatim as an unknown type.
 *
 * "One stamp per person per kind per spot" is enforced by the id, not by a
 * server: `stampId({spot, author, kind})` is pure, so a second stamp of the
 * same kind by the same person on the same spot is an upsert of the same
 * element on every peer. `spot` is the target's id (an annotation id or an
 * `ab:` / `el:` ref) or, on bare board, the 40 px world cell under the drop.
 * Clusters and counts are derived. A local author id can be forged; formal
 * votes (`vote` / `ballot`) are the secure path.
 */

import type { AnnotationElement, ElementDef } from '../types.ts';
import {
  BOX_FIELDS,
  boxOf,
  catalogIdField,
  deterministicId,
  resizeBox,
  solidBoxHit,
  targetField,
  translateBox,
  wordField,
} from './_shared.ts';

/** World cell size a free stamp's spot is quantized to. */
export const STAMP_CELL = 40;

const FIELDS = {
  ...BOX_FIELDS,
  /** The glyph: `plus-one`, `heart`, `check`, … (open vocabulary). */
  kind: wordField(true),
  /** The stamps pack the glyph came from, when not the built-in row. */
  pack: catalogIdField(),
  /** What it was dropped on — absent on bare board. */
  target: targetField(),
};

const cellPart = (n: number) => (n < 0 ? `n${-n}` : String(n));

/** The spot a stamp at world (x, y) occupies when it has no target. */
export function stampCell(x: number, y: number): string {
  return `c${cellPart(Math.floor(x / STAMP_CELL))}_${cellPart(Math.floor(y / STAMP_CELL))}`;
}

/**
 * The deterministic id of "this person's `kind` stamp on this spot".
 * `spot` = the target id / ref, or `stampCell(x, y)`.
 */
export function stampId(o: { spot: string; author: string; kind: string }): string {
  return deterministicId('stamp', [o.spot, o.author, o.kind]);
}

/** The spot a stamp element occupies (its target, else its cell). */
export function stampSpotOf(el: AnnotationElement): string {
  if (typeof el.target === 'string') return el.target;
  const b = boxOf(el);
  return stampCell(b.x + b.w / 2, b.y + b.h / 2);
}

export const stamp: ElementDef = {
  type: 'stamp',
  fields: FIELDS,
  sortedKeys: true, // a format-2 type (R5: a format-1 reader sorts an unknown type's keys)
  caps: {
    box: true,
    rotatable: false,
    resizable: false,
    bindable: false,
    container: false,
    textSlot: null,
  },
  bounds: (el) => boxOf(el),
  hitTest: (el, px, py, tol) => solidBoxHit(el, px, py, tol),
  translate: translateBox,
  resize: resizeBox,
  meaningful: (el) => {
    const b = boxOf(el);
    return b.w > 0 && b.h > 0;
  },
};
