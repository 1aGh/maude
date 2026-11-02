/**
 * @file       annotations/vote-guard.ts — votes and ballots change only through the vote door
 * @scope      apps/studio/annotations/vote-guard.ts
 * @purpose    sec-a M1 (wave-A defender) / C1 (attacker). A `vote` and its `ballot`s are a
 *             formal vote: they are written ONLY by `routes/votes.ts`, which calls
 *             `api.applyAnnotationOps` in-process (no HTTP path, no guard). Every HTTP board
 *             write — the op batch (`/_api/annotations/ops`, main AND canvas listener) and the
 *             whole-board PUT (`/_api/annotations`) — runs this guard: a batch that adds,
 *             changes or removes any vote or ballot element is refused whole (never half-applied).
 *
 *             Stamps are NOT in this set: a person places them through the canvas's own op path
 *             (S4.13), and their author id is forgeable by design (stamp.model.ts) — formal votes
 *             are the secure path. The agent verb still refuses stamps (ai-write PEOPLE_ONLY_TYPES).
 *
 *             The check compares the board BEFORE and AFTER the batch, so a cascade (a deleted
 *             parent), a type swap (`put` over a ballot id) or a reparent cannot slip past it.
 */

import { jsonEq } from './fields.ts';
import type { AnnotationElement } from './types.ts';

/** The element types only the vote door writes. */
export const VOTE_DOOR_TYPES: ReadonlySet<string> = new Set(['vote', 'ballot']);

/** A board guard: the id of the first refused change, or null when the batch may land. */
export type BoardGuard = (
  before: ReadonlyMap<string, AnnotationElement>,
  after: ReadonlyMap<string, AnnotationElement>
) => string | null;

const isVoteDoor = (el: AnnotationElement | undefined) => !!el && VOTE_DOOR_TYPES.has(el.type);

/** The id of the first vote / ballot the batch added, changed or removed; null when none. */
export const voteDoorOnly: BoardGuard = (before, after) => {
  for (const [id, el] of before) {
    if (!isVoteDoor(el)) continue;
    const next = after.get(id);
    if (!next || !jsonEq(el, next)) return id;
  }
  for (const [id, el] of after) {
    if (isVoteDoor(el) && !before.has(id)) return id;
  }
  return null;
};

/** The words an HTTP writer gets back (403). */
export const VOTE_DOOR_REFUSAL =
  'votes and ballots change only through the vote (Start a vote / Cast / End) — this write was refused';
