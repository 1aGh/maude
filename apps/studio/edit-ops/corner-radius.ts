// edit-ops/corner-radius.ts — `object.set-corner-radius` (S2.13, ed-shape: "drag the dot inside a corner").
//
// A corner dot dragged on the canvas rounds a corner: one value for all four while they are linked, or just that
// corner when they differ (⌥ also rounds one alone). The drag ends in this op, so a whole drag is one write and one
// undo step. It writes `border-radius` in the object's inline style exactly as the inspector's Corners row does
// (`words-paint.ts` `cornersToCss`, the same function): one value while the four are equal, four in CSS order
// (↖ ↗ ↘ ↙) when they differ, and the per-corner longhands taken out again — so the dot and the row can never
// disagree, and a v1 peer reads plain CSS.
//
// params: `corner` — 'all' | 'tl' | 'tr' | 'br' | 'bl';  `radius` — `{ token: '--radius-md' }` (a system stop) or
// `{ px: n }` (any number, ⌘ held). A raw CSS string is not accepted.
//
// Refused (nothing written): no target, a value that is not a radius token or a length of 0–10 000 px, a radius the
// file computes. The other three corners keep what they had, token or number.

import { readAttributeState } from '../canvas-edit.ts';
import { refuse, writeStyle } from './constraints.ts';
import type { EditOp, ElementRef, ResolvedEditOp } from './types.ts';
import { type Length, lengthToCss } from './words-css.ts';
import {
  CORNERS,
  type Corner,
  type CornerWords,
  cornersFromCss,
  cornersToCss,
} from './words-paint.ts';

const MAX_RADIUS_PX = 10_000;
const RADIUS_TOKEN = /^--radius-[a-z0-9-]{1,48}$/;
const LONGHANDS = [
  'border-radius',
  'border-top-left-radius',
  'border-top-right-radius',
  'border-bottom-right-radius',
  'border-bottom-left-radius',
] as const;

function radiusOf(req: ResolvedEditOp): Length {
  const raw = req.params.radius;
  const o =
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  if (typeof o.token === 'string') {
    if (!RADIUS_TOKEN.test(o.token)) refuse(req, 'That is not a corner radius of the system.');
    return { token: o.token, px: null };
  }
  if (typeof o.px === 'number' && Number.isFinite(o.px) && o.px >= 0 && o.px <= MAX_RADIUS_PX)
    return { px: Math.round(o.px * 100) / 100 };
  return refuse(req, 'Pick a radius: a corner stop of the system or a number of pixels.');
}

function cornerOf(req: ResolvedEditOp): Corner | 'all' {
  const c = req.params.corner;
  if (c === 'all' || (typeof c === 'string' && (CORNERS as readonly string[]).includes(c)))
    return c as Corner | 'all';
  return refuse(req, 'Pick a corner.');
}

/** What the file says about this object's corners today (literal declarations only). */
function authoredCorners(source: string, req: ResolvedEditOp, t: ElementRef): CornerWords {
  const css: Record<string, string> = {};
  for (const prop of LONGHANDS) {
    const s = readAttributeState(req.file, source, t.element, `style.${prop}`, t.occurrence);
    if (s.kind === 'expression')
      refuse(req, `${t.element} is rounded by a computed value; change it in the code.`, t.element);
    if (s.kind === 'literal') css[prop] = s.value.trim();
  }
  return cornersFromCss(css);
}

export const objectSetCornerRadius: EditOp = {
  id: 'object.set-corner-radius',
  apply(source, req) {
    const t = req.targets[0];
    if (!t) return refuse(req, 'Select a shape or a frame first.');
    const radius = radiusOf(req);
    const corner = cornerOf(req);
    const now = authoredCorners(source, req, t);
    const next: CornerWords =
      corner === 'all'
        ? { tl: radius, tr: radius, br: radius, bl: radius }
        : { tl: now.tl, tr: now.tr, br: now.br, bl: now.bl, [corner]: radius };
    // nothing to say: the same four values already
    if (CORNERS.every((k) => lengthToCss(next[k]) === lengthToCss(now[k]))) return { source };
    return { source: writeStyle(source, req, t, cornersToCss(next)) };
  },
};
