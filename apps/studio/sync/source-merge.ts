// Three-way merge of a canvas body — audit 2026-09-13 P0 #1 (plan T2).
//
// A local save authored on an older base used to be imported by diffing the
// file against the CURRENT doc, which turned every stale byte into an edit: a
// peer's newer title was "reverted" by a save that only changed a colour. The
// base is the body disk and doc last agreed on; the merge applies each side's
// edits relative to it and refuses the moment two edits touch.
//
// Character-level on purpose: canvases put many attributes on one line, and a
// line merge would call the audit's title/colour race a conflict. The price is
// that "independent" means "non-touching spans", not "semantically unrelated"
// — which is why the caller validates the merged source before importing it,
// and why anything ambiguous is preserved for a person rather than guessed at.

import { diffChars } from 'diff';

export type MergeResult =
  | { ok: true; merged: string }
  /** `overlap` — the edits touch; `budget` — too large to diff safely. */
  | { ok: false; reason: 'overlap' | 'budget' };

/** One replacement of `base[start, end)` by `text`. `start === end` inserts. */
interface Edit {
  start: number;
  end: number;
  text: string;
}

/** Same bounds the text lane uses for its import diff (codec applyTextLane). */
const DIFF_BUDGET = { maxEditLength: 4096, timeout: 50 };

function editsOf(base: string, next: string): Edit[] | null {
  let prefix = 0;
  const maxPrefix = Math.min(base.length, next.length);
  while (prefix < maxPrefix && base.charCodeAt(prefix) === next.charCodeAt(prefix)) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(base.length - prefix, next.length - prefix);
  while (
    suffix < maxSuffix &&
    base.charCodeAt(base.length - 1 - suffix) === next.charCodeAt(next.length - 1 - suffix)
  ) {
    suffix++;
  }
  // Never split a surrogate pair across an edit boundary.
  if (prefix > 0 && /[\uD800-\uDBFF]/.test(base[prefix - 1] ?? '')) prefix--;
  if (suffix > 0 && /[\uDC00-\uDFFF]/.test(base[base.length - suffix] ?? '')) suffix--;
  const from = base.slice(prefix, base.length - suffix);
  const to = next.slice(prefix, next.length - suffix);
  if (!from && !to) return [];
  if (!from || !to) return [{ start: prefix, end: prefix + from.length, text: to }];
  const changes = diffChars(from, to, DIFF_BUDGET);
  if (changes === undefined) return null;
  const edits: Edit[] = [];
  let offset = prefix;
  let open: Edit | null = null;
  for (const change of changes) {
    if (change.removed || change.added) {
      open ??= { start: offset, end: offset, text: '' };
      if (change.removed) {
        open.end += change.value.length;
        offset += change.value.length;
      } else open.text += change.value;
    } else {
      if (open) edits.push(open);
      open = null;
      offset += change.value.length;
    }
  }
  if (open) edits.push(open);
  return edits;
}

const same = (a: Edit, b: Edit) => a.start === b.start && a.end === b.end && a.text === b.text;

/**
 * Merge `ours` and `theirs`, both derived from `base`. Edits that touch —
 * overlapping, adjacent, or two insertions at one point — are an `overlap`
 * unless they are the identical edit, which is applied once.
 */
export function mergeSource(base: string, ours: string, theirs: string): MergeResult {
  if (ours === theirs || theirs === base) return { ok: true, merged: ours };
  if (ours === base) return { ok: true, merged: theirs };
  const a = editsOf(base, ours);
  const b = editsOf(base, theirs);
  if (!a || !b) return { ok: false, reason: 'budget' };
  const all: Edit[] = [];
  for (const edit of [...a, ...b].sort((x, y) => x.start - y.start || x.end - y.end)) {
    const prev = all[all.length - 1];
    if (prev && same(prev, edit)) continue;
    if (prev && edit.start <= prev.end) return { ok: false, reason: 'overlap' };
    all.push(edit);
  }
  let merged = '';
  let cursor = 0;
  for (const edit of all) {
    merged += base.slice(cursor, edit.start) + edit.text;
    cursor = edit.end;
  }
  return { ok: true, merged: merged + base.slice(cursor) };
}
