// annotations/artboard-members.ts — S2.10c: which annotations belong to an artboard as a whole.
//
// One answer for the two places an artboard leaves or comes back with its annotations:
//   - ⌫ Move to trash (edit-ops/artboard-trash.ts, routes/edit.ts `land`): the members leave in the
//     SAME `kind: 'trash'` action (S1-trash.md §2: "the annotations whose `parentArtboard` is it"),
//   - "Restore only <artboard>" and the Trash's Restore (history/restore-artboard.ts, S1.13 splice):
//     the members come back with it.
//
// A member is
//   1. a top-level element whose `parentArtboard` is the artboard (S4 Q3 membership);
//   2. an element inside a section (`parent`): it goes where its top-level section goes ("a section owns
//      its members", S2-S4-artboard-motion-ids.md §1) — its own `parentArtboard` is not asked;
//   3. a top-level arrow with NO `parentArtboard` whose every bound end is the artboard's: an annotation
//      end bound to a member (`start.el` / `end.el`), or a canvas end (`startHost` / `endHost`) on the
//      artboard or one of its elements — with at least one bound end. An arrow with a `parentArtboard`
//      is that artboard's, wherever its ends point; one that also reaches another artboard stays
//      (deleting the member it was bound to leaves its end a free point — the board's own fix-up).
//
// Pure over plain records (a board's parsed elements or raw JSON), so both callers share it. Unknown
// types and unknown fields are never read beyond the keys above.

import { parseHostRef } from './elements/_shared.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
/** Deeper than any board nests (MAX_NESTING_DEPTH is far below); a cycle stops here too. */
const MAX_CHAIN = 64;

/** The ids of the elements that belong to `artboards` as a whole (header). */
export function artboardMembers(
  elements: readonly unknown[],
  artboards: Iterable<string>
): Set<string> {
  const boards = new Set(artboards);
  const members = new Set<string>();
  if (!boards.size) return members;
  const list = elements.filter((e): e is Rec => isRec(e) && typeof e.id === 'string');
  const byId = new Map(list.map((e) => [e.id as string, e]));
  /** The top-level element `e` sits in (itself when it has no parent); null = a dangling chain. */
  const topOf = (e: Rec): Rec | null => {
    let cur = e;
    for (let i = 0; i < MAX_CHAIN; i++) {
      if (typeof cur.parent !== 'string') return cur;
      const up = byId.get(cur.parent);
      if (!up) return null;
      cur = up;
    }
    return null;
  };
  /** true / false for a bound end, undefined for a free one. */
  const endIsOurs = (end: unknown): boolean | undefined =>
    isRec(end) && typeof end.el === 'string' ? members.has(end.el) : undefined;
  const hostIsOurs = (host: unknown): boolean | undefined => {
    if (!isRec(host)) return undefined;
    const parsed = parseHostRef(host.ref);
    return parsed ? boards.has(parsed.artboard) : undefined;
  };
  const looseArrowIsOurs = (e: Rec): boolean => {
    const ends = [
      endIsOurs(e.start),
      endIsOurs(e.end),
      hostIsOurs(e.startHost),
      hostIsOurs(e.endHost),
    ].filter((v): v is boolean => v !== undefined);
    return ends.length > 0 && ends.every(Boolean);
  };
  // A fixpoint: an arrow bound to a sticky joins once the sticky has; nested items once their section has.
  for (let changed = true, pass = 0; changed && pass <= list.length; pass++) {
    changed = false;
    for (const e of list) {
      const id = e.id as string;
      if (members.has(id)) continue;
      const top = topOf(e);
      if (!top) continue;
      let ours: boolean;
      if (top !== e) ours = members.has(top.id as string);
      else if (typeof e.parentArtboard === 'string') ours = boards.has(e.parentArtboard);
      else ours = e.type === 'arrow' && looseArrowIsOurs(e);
      if (ours) {
        members.add(id);
        changed = true;
      }
    }
  }
  return members;
}
