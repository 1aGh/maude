// edit-ops/constraints.ts — `object.constrain` (S2.11, ed-lay-free) and the style writer the layout
// ops share.
//
// A constraint says which edges of its frame a freely placed object keeps: Datum pinned Right and
// Top keeps 64 from the corner in every size of the frame — the story made with Duplicate at
// another width still shows it there. It is plain CSS: `right: 64px` carries the distance, `left`
// is taken out (`words-css.ts` `constraintsToCss`, the same function the Position row's pins use,
// so the pins and this op can never disagree). One request writes all four declarations.
//
// params: `h` (left · right · both · center · scale), `v` (top · bottom · both · center · scale)
// and `geometry` — the object's box inside its frame in world px, which the canvas measures
// (`{ x, y, w, h, parentW, parentH }`). Only an object placed freely can be pinned; one that sits in
// a layout is told how to place it first.

import { applyEdit, applyRemove, CanvasEditError, readAttributeState } from '../canvas-edit.ts';
import type { EditOp, ElementRef, ResolvedEditOp } from './types.ts';
import {
  type CssPatch,
  constraintsToCss,
  type Geometry,
  type PinH,
  type PinV,
} from './words-css.ts';

const LIMIT = 1_000_000;
const PIN_H: readonly string[] = ['left', 'right', 'both', 'center', 'scale'];
const PIN_V: readonly string[] = ['top', 'bottom', 'both', 'center', 'scale'];
export const PLACED_FREELY = /^(absolute|fixed)$/;

export function refuse(req: ResolvedEditOp, message: string, id?: string): never {
  throw new CanvasEditError(message, { canvas: req.file, id: id ?? req.targets[0]?.element ?? '' });
}

/** A finite number within sane bounds, or a refusal in the canvas's words. */
export function finiteParam(req: ResolvedEditOp, key: string): number {
  const v = (req.params as Record<string, unknown>)[key];
  if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LIMIT)
    refuse(req, 'The canvas did not say where the object is; try again.');
  return v as number;
}

/**
 * Write a CSS patch ({ prop: value | null }) onto one target's inline style: a string sets, null
 * takes out. A style the file computes (`style={styles.card}`) is refused — "the same result by
 * hand" is an edit of the object in the code.
 */
export function writeStyle(
  source: string,
  req: ResolvedEditOp,
  target: ElementRef,
  patch: CssPatch
): string {
  let out = source;
  for (const [prop, value] of Object.entries(patch)) {
    const state = readAttributeState(
      req.file,
      out,
      target.element,
      `style.${prop}`,
      target.occurrence
    );
    if (state.kind === 'expression')
      refuse(
        req,
        `${target.element} is placed by a computed value; change it in the code.`,
        target.element
      );
    if (value === null) {
      if (state.kind === 'absent') continue;
      out = applyRemove(req.file, out, target.element, `style.${prop}`, target.occurrence).source;
    } else if (!(state.kind === 'literal' && state.value === value)) {
      out = applyEdit(
        req.file,
        out,
        target.element,
        `style.${prop}`,
        JSON.stringify(value),
        target.occurrence
      ).source;
    }
  }
  return out;
}

/** `position` as the inline style says it: the literal, or null when the style does not say. */
export function inlinePosition(source: string, req: ResolvedEditOp, t: ElementRef): string | null {
  const state = readAttributeState(req.file, source, t.element, 'style.position', t.occurrence);
  if (state.kind === 'expression')
    refuse(req, `${t.element} is placed by a computed value; change it in the code.`, t.element);
  return state.kind === 'literal' ? state.value.trim() : null;
}

function geometryOf(req: ResolvedEditOp): Geometry {
  const raw = (req.params as Record<string, unknown>).geometry;
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = (k: string): number => {
    const v = o[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > LIMIT)
      refuse(req, 'The canvas did not say where the object is; try again.');
    return v as number;
  };
  return {
    x: n('x'),
    y: n('y'),
    w: n('w'),
    h: n('h'),
    parentW: n('parentW'),
    parentH: n('parentH'),
  };
}

export const objectConstrain: EditOp = {
  id: 'object.constrain',
  apply(source, req) {
    const p = req.params as Record<string, unknown>;
    if (
      typeof p.h !== 'string' ||
      !PIN_H.includes(p.h) ||
      typeof p.v !== 'string' ||
      !PIN_V.includes(p.v)
    )
      refuse(req, 'Pick which edges it keeps: Left, Right, Top, Bottom, Center or Scale.');
    const geometry = geometryOf(req);
    const pins = { h: p.h as PinH, v: p.v as PinV };
    let out = source;
    for (const t of req.targets) {
      const position = inlinePosition(out, req, t);
      // `placed: true` — the canvas saw it is placed freely by a class, not by this file's style
      if (!(position && PLACED_FREELY.test(position)) && p.placed !== true)
        refuse(
          req,
          'Constraints work on an object placed freely. Place it freely first.',
          t.element
        );
      out = writeStyle(out, req, t, constraintsToCss(pins, geometry));
    }
    return { source: out };
  },
};
