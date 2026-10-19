/**
 * @file       annotations/ui/template-place.ts — a template where you click (S4.13, canvas 15 `an-templates`)
 * @scope      apps/studio/annotations/ui/template-place.ts
 * @purpose    The Templates panel's pick (`insert-template {id, follow}`) expands to the SAME elements
 *             `maude design annotate <canvas> --board <id>` writes (rule 14): both feed the template's board
 *             spec to `boardToOps` + `applyOriginOffset` and run the resulting `create` / `connect` ops through
 *             `AiBatch`. This module is the person's half of that: the origin is the click, the author is
 *             the person (the batch stamps `ai`, which a click is not), and the result is the layer's strokes.
 *             Pure — no DOM, no React.
 */

import { type Stroke, strokeBBox } from '../../annotations-model.ts';
import { AiBatch } from '../ai-write.ts';
import { applyOriginOffset, type BoardOp, boardToOps } from '../board-ops.ts';
import { templateBoard } from '../templates.ts';
import type { AnnotationElement, Box } from '../types.ts';
import { elementsToStrokes } from '../v1-adapter.ts';

export interface TemplatePlacement {
  /** The strokes to add, in paint order. */
  strokes: Stroke[];
  /** Ids of the top-level pieces (what to select afterwards): the sections, or every loose card. */
  selectIds: string[];
  /** World box of everything, for the ghost and for "place where clicked". */
  box: Box;
  /** How many elements the template made (a labelled shape or arrow is two strokes, one element). */
  count: number;
}

const PLACEMENT_KEYS = new Set(['op', 'type', 'in', 'near', 'pin', 'pointer', 'to', 'from']);

function run(batch: AiBatch, ops: BoardOp[]): void {
  for (const op of ops) {
    if (op.op === 'create' && typeof op.type === 'string') {
      const fields = Object.fromEntries(Object.entries(op).filter(([k]) => !PLACEMENT_KEYS.has(k)));
      batch.create(op.type, fields);
    } else if (op.op === 'connect') {
      batch.connect(op);
    }
  }
}

/** The world box of everything but the arrows (a child's own x / y are relative to its section). */
function boxOf(strokes: readonly Stroke[]): Box {
  let x0 = Number.POSITIVE_INFINITY;
  let y0 = Number.POSITIVE_INFINITY;
  let x1 = Number.NEGATIVE_INFINITY;
  let y1 = Number.NEGATIVE_INFINITY;
  for (const s of strokes) {
    if (s.tool === 'arrow') continue;
    const b = strokeBBox(s);
    if (!b) continue;
    x0 = Math.min(x0, b.x);
    y0 = Math.min(y0, b.y);
    x1 = Math.max(x1, b.x + b.w);
    y1 = Math.max(y1, b.y + b.h);
  }
  return Number.isFinite(x0)
    ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    : { x: 0, y: 0, w: 0, h: 0 };
}

/**
 * Template `id` with its top-left corner at `origin` (world), made by `who` (omit for no name). Null when
 * the id is not a template. Elements are ordered children-after-parents so paint order is right.
 */
export function expandTemplate(
  id: string,
  origin: { x: number; y: number },
  who?: string | null
): TemplatePlacement | null {
  const spec = templateBoard(id);
  return spec ? expandBoard(spec as Record<string, unknown>, origin, who) : null;
}

/**
 * Any `--board` spec (a template's, or the one "describe it" asks AI for: the same shape, any language) with
 * its top-left corner at `origin`. Throws `BoardSpecError` for a spec the layout engine refuses.
 */
export function expandBoard(
  spec: Record<string, unknown>,
  origin: { x: number; y: number },
  who?: string | null
): TemplatePlacement {
  const batch = new AiBatch([]);
  run(batch, applyOriginOffset(boardToOps(spec), origin));
  const els = batch.elements.map((e) => {
    const { author: _ai, ...rest } = e;
    return who ? ({ ...rest, author: { kind: 'human', name: who } } as AnnotationElement) : e;
  });
  const strokes = elementsToStrokes(els).map((s) =>
    who && !s.authorName ? { ...s, authorName: who } : s
  );
  const parented = new Set(els.filter((e) => e.parent).map((e) => e.id));
  const top = els.filter((e) => !parented.has(e.id) && e.type !== 'arrow');
  return {
    strokes,
    selectIds: (top.length ? top : els).map((e) => e.id),
    box: boxOf(strokes),
    count: els.length,
  };
}

/** The size of a template (its ghost), without making anything. */
export function templateExtent(id: string): { w: number; h: number } | null {
  const p = expandTemplate(id, { x: 0, y: 0 });
  return p ? { w: p.box.w, h: p.box.h } : null;
}
