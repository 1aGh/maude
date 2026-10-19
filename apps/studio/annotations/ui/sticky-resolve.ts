/**
 * @file       annotations/ui/sticky-resolve.ts — Resolve, and clearing up what is resolved (S4.12)
 * @scope      apps/studio/annotations/ui/sticky-resolve.ts
 * @purpose    Canvas 15 `an-sticky` / `an-convert` / the ⌘K "resolved" frame. "Resolve" is one word for comments
 *             AND stickies: a resolved sticky is struck through in place, ticked and KEPT (C29). Pure and
 *             React-free: each function takes the strokes and returns the next ones, so the layer commits
 *             one undo record and the tests pin the rule.
 *
 *             The word is a toggle on the selection: Resolve when any selected sticky is open, Reopen when
 *             every one of them is already resolved. Locked stickies resolve too (a lock guards against
 *             dragging, not against saying "done"). Only stickies resolve; everything else is left alone.
 */

import type { StickyStroke, Stroke } from '../../annotations-model.ts';
import { isResolvedSticky } from './visibility.ts';

export { isResolvedSticky };

const isSticky = (s: Stroke): s is StickyStroke => s.tool === 'sticky';

/** The stickies among `ids`, in board order. */
export function stickiesIn(strokes: readonly Stroke[], ids: readonly string[]): StickyStroke[] {
  const want = new Set(ids);
  return strokes.filter((s): s is StickyStroke => isSticky(s) && want.has(s.id));
}

/** What the menu / toolbar word for this selection should say: nothing to do, Resolve, or Reopen. */
export function resolveVerb(
  strokes: readonly Stroke[],
  ids: readonly string[]
): 'resolve' | 'reopen' | null {
  const st = stickiesIn(strokes, ids);
  if (st.length === 0) return null;
  return st.every(isResolvedSticky) ? 'reopen' : 'resolve';
}

/**
 * Resolve (or reopen) the stickies among `ids`. `by` is the person's name, `at` an ISO UTC time. Resolving
 * keeps an already-resolved sticky's original `by` / `at` (the first answer stands); reopening drops them.
 */
export function toggleResolved(
  strokes: readonly Stroke[],
  ids: readonly string[],
  by: string,
  at: string
): Stroke[] {
  const verb = resolveVerb(strokes, ids);
  if (!verb) return strokes as Stroke[];
  const want = new Set(ids);
  return strokes.map((s) => {
    if (!isSticky(s) || !want.has(s.id)) return s;
    if (verb === 'resolve') return s.resolved ? s : { ...s, resolved: { by, at } };
    const { resolved: _drop, ...rest } = s;
    return rest as Stroke;
  });
}

/** Resolve exactly these stickies (the AI's answered ones, S4.15) — never a toggle. */
export function markResolved(
  strokes: readonly Stroke[],
  ids: readonly string[],
  by: string,
  at: string
): Stroke[] {
  const want = new Set(ids);
  return strokes.map((s) =>
    isSticky(s) && want.has(s.id) && !s.resolved ? { ...s, resolved: { by, at } } : s
  );
}

/** Every resolved sticky on the canvas, in board order. */
export function resolvedStickies(strokes: readonly Stroke[]): StickyStroke[] {
  return strokes.filter((s): s is StickyStroke => isSticky(s) && isResolvedSticky(s));
}

/** ⌘K "Select resolved stickies". */
export function selectResolvedIds(strokes: readonly Stroke[]): string[] {
  return resolvedStickies(strokes).map((s) => s.id);
}

/**
 * ⌘K "Move resolved stickies to the trash": the resolved stickies leave the canvas and the Trash keeps
 * them (the board's removal is the same delete ⌫ does, so ⌘Z brings them back). Arrows that were bound to
 * a removed sticky keep their end as a point, as they do for any delete (`deleteStrokes` in the layer).
 */
export function withoutResolvedStickies(strokes: readonly Stroke[]): {
  next: Stroke[];
  ids: string[];
} {
  const ids = selectResolvedIds(strokes);
  if (ids.length === 0) return { next: strokes as Stroke[], ids };
  const gone = new Set(ids);
  return { next: strokes.filter((s) => !gone.has(s.id)), ids };
}

/** "6 stickies moved to the trash" (canvas 15, the ⌘K frame). */
export function trashedLine(n: number): string {
  return `${n} ${n === 1 ? 'sticky' : 'stickies'} moved to the trash`;
}

/** The ⌘K row's meta: "6 on this canvas". */
export function resolvedCountMeta(n: number): string {
  return `${n} on this canvas`;
}

export const NO_RESOLVED_LINE = 'No resolved stickies on this canvas.';
