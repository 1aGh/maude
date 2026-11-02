// edit-ops/ds-use-nearest.ts — S10.17: `ds.use-nearest` (13 · ds-edge-suggest: "Use Accent").
//
// A colour somebody picked by hand sits on a canvas as a literal (`#3b6fe0`). "Use Accent" writes the system colour in
// its place — `var(--accent)` — and nothing else on the canvas moves. The place is the one the question named: the
// finding's `line` / `col` (from `GET /_api/ds/off-system`) and the literal it found; the op refuses unless the source
// at that place still says exactly that literal, inside the target element, so a stale question can never rewrite a
// different colour. The element is the one that carries the literal (its authored id), which is what the AI holds and
// locks are judged on.
//
// targets[0]  the element that carries the literal
// params      { literal: string, css: string (a token name), line: number, col: number }

import { CanvasEditError } from '../canvas-edit.ts';
import { walkIdElements } from '../element-ids.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

const CSS_RE = /^--[A-Za-z0-9_-]{1,128}$/;
/** a plain colour literal: hex, or a colour function with no var() inside, or a name */
const LITERAL_RE = /^(#[0-9a-fA-F]{3,8}|(?!var\()[a-zA-Z]+\([^()]*\)|[a-zA-Z]{3,20})$/;

const fail = (req: ResolvedEditOp, message: string): never => {
  throw new CanvasEditError(message, { canvas: req.file, id: req.targets[0]?.element ?? '' });
};

function offsetOf(source: string, line: number, col: number): number {
  let at = 0;
  for (let i = 1; i < line; i++) {
    const nl = source.indexOf('\n', at);
    if (nl < 0) return -1;
    at = nl + 1;
  }
  return at + col - 1;
}

export const dsUseNearest: EditOp = {
  id: 'ds.use-nearest',
  apply(source, req) {
    const target = req.targets[0];
    if (!target || req.targets.length !== 1)
      return fail(req, 'Select the element that has the colour.');
    const { literal, css, line, col } = req.params as Record<string, unknown>;
    if (typeof css !== 'string' || !CSS_RE.test(css))
      return fail(req, 'That is not a colour of the system.');
    if (typeof literal !== 'string' || !LITERAL_RE.test(literal))
      return fail(req, 'That is not a colour written on the canvas.');
    if (
      !Number.isInteger(line) ||
      !Number.isInteger(col) ||
      (line as number) < 1 ||
      (col as number) < 1
    )
      return fail(req, 'Say where the colour is.');

    const walk = walkIdElements(source, req.file);
    if (!walk.ok) return fail(req, 'This canvas does not parse; fix it before editing.');
    const el = walk.elements.find((e) => e.id === target.element);
    if (!el) return fail(req, 'That element is not on this canvas.');

    const at = offsetOf(source, line as number, col as number);
    // the colour has to be where the question said it was, and inside the element it names
    if (
      at < el.start ||
      at + literal.length > el.end ||
      source.slice(at, at + literal.length) !== literal
    )
      return fail(req, 'The colour is no longer there. Ask again.');
    // not already a token: `var(--x, #fff)` keeps its fallback, it is not a hand-picked colour
    if (/var\(\s*--[A-Za-z0-9_-]+\s*,\s*$/.test(source.slice(Math.max(0, at - 80), at)))
      return fail(req, 'That colour is the fallback of a token already.');
    return { source: `${source.slice(0, at)}var(${css})${source.slice(at + literal.length)}` };
  },
};
