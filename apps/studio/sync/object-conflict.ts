// Object-level conflicts — S9.24, decision `maude/v2-S9-object-conflict-per-element-id` (S9 Q10).
//
// The conflict unit is one element id (V2-1.4; on an annotations board, one sticky / shape / …).
// It is detected where a proposal made on an OLDER base is replayed onto the project's head — the
// kernel's stale-base lane merge (`apps/hub/src/project-transactions/lanes.mjs`, shared by the hub
// and the studio's local kernel), which is the DDR-116 / DDR-241 path, now per element:
//
//   • an element BOTH sides changed, in the same field, to different values, is a conflict —
//     except geometry and stacking (a drag race keeps acceptance order, DDR-242 §4), and the text
//     field when the character merge can keep both people's words (it then is no conflict);
//   • an element one side deleted while the other changed it is a conflict too (nothing lost).
//
// Held, not guessed: the head keeps THEIR version of a conflicted element (it was accepted first
// and others may already have seen it — no silent overwrite), every other change of the proposal
// still lands, and the proposal's own board is recorded as a kept-aside version (`@aside`, V2-1.9
// §4.9) in the same action, so the loser's body is never lost. The card on the loser's Mac then
// offers Keep yours / Keep theirs / Keep both; each is ONE ordinary lane edit (one undo step).
//
// Pure: no Bun, no fs — the hub image imports this file (apps/hub/Dockerfile copies it).

import { compareOrder, keyBetween } from '../annotations/fractional-index.ts';
import { applyOps, diffToOps } from '../annotations/ops.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { mergeSource } from './source-merge.ts';

type Board = ReadonlyMap<string, AnnotationElement>;

/** Fields whose race keeps acceptance order: where a thing sits is not what it says. */
export const ACCEPTANCE_ORDER_FIELDS: ReadonlySet<string> = new Set([
  'x',
  'y',
  'w',
  'h',
  'rot',
  'index',
  'parent',
]);

/** Fields a person writes words into (merged character-wise when the edits do not touch). */
const TEXT_FIELDS: ReadonlySet<string> = new Set(['text', 'label']);

export interface ObjectConflict {
  /** The element id both sides changed. */
  id: string;
  type: string;
  /** The fields both changed to different values; `['deleted']` when one side deleted it. */
  fields: string[];
  /** The proposal's version (null: the proposal deleted it). */
  mine: AnnotationElement | null;
  /** The head's version (null: the head deleted it). */
  theirs: AnnotationElement | null;
}

export type ConflictChoice = 'mine' | 'theirs' | 'both';

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function textOf(v: unknown): string | null {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { text?: unknown }).text === 'string')
    return (v as { text: string }).text;
  return null;
}

/** Same-field race on `key`: true when it cannot keep both people's change. */
function fieldConflicts(key: string, base: unknown, mine: unknown, theirs: unknown): boolean {
  if (eq(mine, base) || eq(theirs, base) || eq(mine, theirs)) return false;
  if (ACCEPTANCE_ORDER_FIELDS.has(key)) return false;
  if (TEXT_FIELDS.has(key)) {
    const [b, m, t] = [textOf(base), textOf(mine), textOf(theirs)];
    if (b !== null && m !== null && t !== null) return !mergeSource(b, m, t).ok;
  }
  return true;
}

/**
 * Every element both `mine` (the proposal) and `theirs` (the head) changed from `base` in a way
 * that cannot keep both. Ordered by the head's stacking, then id — deterministic for the card.
 */
export function findObjectConflicts(base: Board, mine: Board, theirs: Board): ObjectConflict[] {
  const out: ObjectConflict[] = [];
  for (const id of new Set([...base.keys(), ...mine.keys(), ...theirs.keys()])) {
    const b = base.get(id);
    const m = mine.get(id);
    const t = theirs.get(id);
    if (eq(m, b) || eq(t, b) || eq(m, t)) continue; // one side untouched, or the same result
    if (!m || !t) {
      out.push({
        id,
        type: (m ?? t ?? b)?.type ?? '',
        fields: ['deleted'],
        mine: m ?? null,
        theirs: t ?? null,
      });
      continue;
    }
    if (!b) {
      // Both made an element under one id (only a replayed copy can): different bodies conflict.
      out.push({ id, type: m.type, fields: ['created'], mine: m, theirs: t });
      continue;
    }
    if (m.type !== t.type) {
      out.push({ id, type: t.type, fields: ['type'], mine: m, theirs: t });
      continue;
    }
    const fields: string[] = [];
    for (const k of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
      if (k === 'id' || k === 'type') continue;
      if (fieldConflicts(k, b[k], m[k], t[k])) fields.push(k);
    }
    if (fields.length) out.push({ id, type: t.type, fields, mine: m, theirs: t });
  }
  return out.sort((a, b) => {
    const ia = a.theirs?.index ?? a.mine?.index ?? '';
    const ib = b.theirs?.index ?? b.mine?.index ?? '';
    return ia === ib ? (a.id < b.id ? -1 : 1) : ia < ib ? -1 : 1;
  });
}

/**
 * Replay what `mine` changed from `base` onto `theirs`, HOLDING every conflicted element at the
 * head's version. Everything else merges by the usual DDR-242 rule (applyOps). Returns the merged
 * board and the conflicts (empty: an ordinary merge).
 */
export function mergeHoldingObjects(
  base: Board,
  mine: Board,
  theirs: Board
): { elements: AnnotationElement[]; conflicts: ObjectConflict[] } {
  const conflicts = findObjectConflicts(base, mine, theirs);
  const held = new Map(mine);
  for (const c of conflicts) {
    const b = base.get(c.id);
    // Undo the proposal's own change to the element: no op touches it, the head's version stays.
    if (b) held.set(c.id, b);
    else held.delete(c.id);
  }
  const r = applyOps(theirs, diffToOps(base, held));
  return { elements: [...r.state.values()], conflicts };
}

/** A fresh element id no board element uses (V2-1.4 §4.3: a copy always gets a new id). */
export function freshElementId(
  taken: (id: string) => boolean,
  prefix = 's',
  rand: () => number = Math.random
): string {
  for (let i = 0; i < 64; i++) {
    const id = `${prefix}_${rand().toString(36).slice(2, 10).padEnd(8, '0')}`;
    if (!taken(id)) return id;
  }
  throw new Error('object-conflict: no free element id');
}

const GAP = 24;

/**
 * The person's pick on the card, applied to the CURRENT head (an ordinary lane edit — one action,
 * one undo step). `mine`: the element becomes the proposal's version (or goes, when the proposal
 * deleted it). `theirs`: nothing changes. `both`: the proposal's version is added as a copy with a
 * fresh id, beside the head's (to its right), stacked just above it — nothing silently overwritten.
 */
export function resolveObjectConflict(
  head: Board,
  conflict: Pick<ObjectConflict, 'id' | 'mine'>,
  choice: ConflictChoice,
  o: { rand?: () => number } = {}
): { elements: AnnotationElement[]; copyId: string | null } {
  const next = new Map(head);
  const winner = head.get(conflict.id) ?? null;
  const mine = conflict.mine;
  let copyId: string | null = null;
  if (choice === 'mine') {
    if (!mine) next.delete(conflict.id);
    else next.set(conflict.id, { ...mine, id: conflict.id, index: winner?.index ?? mine.index });
  } else if (choice === 'both' && mine) {
    if (!winner) {
      // The head deleted it: keeping both is keeping yours, under its own id.
      next.set(conflict.id, mine);
    } else {
      copyId = freshElementId((id) => next.has(id), mine.type === 'sticky' ? 's' : 'e', o.rand);
      const above = [...head.values()]
        .map((e) => e.index)
        .filter((ix) => ix > winner.index)
        .sort()[0];
      const copy: AnnotationElement = {
        ...mine,
        id: copyId,
        index: keyBetween(winner.index, above ?? null),
      };
      if (typeof winner.x === 'number' && typeof winner.w === 'number') {
        copy.x = winner.x + winner.w + GAP;
        if (typeof winner.y === 'number') copy.y = winner.y;
      }
      next.set(copyId, copy);
    }
  }
  return { elements: [...next.values()].sort(compareOrder), copyId };
}
