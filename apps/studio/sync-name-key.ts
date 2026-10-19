// S1.23b — names that collide in sync.
//
// S1.23 let a canvas or folder be named with any filename-safe text. The sync document id a canvas
// gets on the wire is NOT that name: it is `canvasSlugFromRel(rel)` (percent-decode, `/`→`-`,
// whitespace→`_`, lowercase) and then, in a namespaced project, `sanitizeComponent` (every character
// outside `[a-z0-9._-]` becomes `-`, runs collapse, ends are trimmed, 64 characters at most). So an
// em dash and a hyphen, `a%20b` and `a b`, `Poster` and `poster`, `ui/a/b` and `ui/a-b`, all land on
// ONE document — and one canvas overwrites the other on every peer.
//
// This module is the guard's whole vocabulary: the key, and the words said when two names are
// too close. It reuses both real functions and never re-types them, so the guard cannot drift from
// the algorithm — a v1 peer must keep the same document ids, so the algorithm itself is not touched
// (`test/canvas-sync-name-collision.test.ts` pins that this key IS the last component of
// `buildDocName`).
//
// The key is the namespaced one, which is the more collapsing of the two shapes (a flat project
// keeps the raw slug, whose collisions are a subset), so one guard is right for both.

import path from 'node:path';

import { canvasSlugFromRel } from './canvas-slug.ts';
import { sanitizeComponent } from './sync/doc-name.ts';

/** The sync key of a canvas or folder, from its design-root-relative path. */
export function syncKeyOf(rel: string): string {
  return sanitizeComponent(canvasSlugFromRel(rel, ''));
}

const display = (rel: string): string => rel.replace(/\.(tsx|html)$/i, '');

/** CONTRACT §4 voice — what happened · what is safe · one verb. `fromDir` is the folder the name is
 *  going into: a name in the same folder is said bare, one elsewhere with its path. */
export function tooCloseText(name: string, otherRel: string, fromDir: string): string {
  const dir = path.posix.dirname(otherRel);
  const sameFolder = (dir === '.' ? '' : dir) === fromDir;
  const other = sameFolder ? path.posix.basename(display(otherRel)) : display(otherRel);
  return `“${name}” is too close to “${other}”, which is already here. Try another name.`;
}

/**
 * The first of `existing` (design-root-relative paths) that would share a sync document with `toRel`
 * though it is a different path. Case is part of "different": on a case-insensitive volume
 * `Poster.tsx` and `poster.tsx` are one file, but the caller only ever meets that as the SAME canvas
 * (it passes it in `except`); a different canvas with a case-only name is exactly what this refuses.
 * A path with no key at all (nothing survives the sanitiser) is not comparable and is let through.
 */
export function findCloseName(
  toRel: string,
  existing: Iterable<string>,
  except: (rel: string) => boolean = () => false
): string | null {
  const key = syncKeyOf(toRel);
  if (!key) return null;
  for (const rel of existing) {
    if (rel === toRel || except(rel)) continue;
    if (syncKeyOf(rel) === key) return rel;
  }
  return null;
}
