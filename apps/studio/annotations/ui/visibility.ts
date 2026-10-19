/**
 * @file       annotations/ui/visibility.ts — S4.9: what the layer is told to leave out of view
 * @scope      apps/studio/annotations/ui/visibility.ts
 * @purpose    Pure helpers behind the shell → canvas messages the Preview annotation list sends
 *             (`annotation-filter {authors}`, `annotation-select {ids}`) and the per-person "Hide resolved
 *             stickies" switch (C29, ⌘K `annotations.hide-resolved`).
 *
 *             The filter HIDES; it never removes (S4.17: "The filter hides; it does not remove"): the layer
 *             draws the filtered list, the board and the file keep every element. Person keys are the list's
 *             own (`personOf` in client/v2/annotations/annotation-list-model.js): 'you' | 'ai' | 'h:<name>'
 *             | 'unknown'; an empty list is Everyone.
 */

import type { Stroke } from '../../annotations-model.ts';

export const PERSON_YOU = 'you';
export const PERSON_AI = 'ai';
export const PERSON_UNKNOWN = 'unknown';

/** Who drew a stroke, as the list's chip key. `me` is the signed-in person's name, when known. */
export function personKeyOf(s: { author?: 'ai'; authorName?: string }, me?: string | null): string {
  if (s.author === 'ai') return PERSON_AI;
  const name = typeof s.authorName === 'string' ? s.authorName : '';
  if (!name) return PERSON_UNKNOWN;
  if (me && name === me) return PERSON_YOU;
  return `h:${name}`;
}

/** The strokes by these people (everyone when `authors` is empty). Order and identity are kept. */
export function filterByAuthors(
  strokes: readonly Stroke[],
  authors: readonly string[],
  me?: string | null
): readonly Stroke[] {
  if (authors.length === 0) return strokes;
  const want = new Set(authors);
  return strokes.filter((s) => want.has(personKeyOf(s, me)));
}

/** A sticky someone resolved (the v2 element's `resolved: {by, at}`, or a stroke carrying the same field). */
export function isResolvedSticky(s: unknown): boolean {
  const r = s as { tool?: unknown; type?: unknown; resolved?: unknown } | null;
  if (!r || (r.tool !== 'sticky' && r.type !== 'sticky')) return false;
  return !!r.resolved && typeof r.resolved === 'object';
}

/** C29 — resolved stickies drop out of the drawing for the person who asked; the file is untouched. */
export function withoutResolved(strokes: readonly Stroke[], hide: boolean): readonly Stroke[] {
  if (!hide) return strokes;
  return strokes.some(isResolvedSticky) ? strokes.filter((s) => !isResolvedSticky(s)) : strokes;
}

/** Words for the toast that follows ⇧P (the shell shows it with a Show button; canvas 15, frame 3). */
export const ANNOTATIONS_HIDDEN_TOAST = Object.freeze({
  title: 'Annotations hidden. Press ⇧P to bring them back.',
  action: 'Show',
});

/** ids that exist, in the order asked, no repeats. */
export function knownIds(ids: readonly string[], strokes: readonly Stroke[]): string[] {
  const have = new Set(strokes.map((s) => s.id));
  return [...new Set(ids)].filter((id) => have.has(id));
}
