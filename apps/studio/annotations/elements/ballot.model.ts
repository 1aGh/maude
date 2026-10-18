/**
 * Ballot (contract S4 Q5, Gate 0 A18) — one voter's dots in one local vote.
 * A format-2 element TYPE (V2-1.12 R4); a format-1 peer keeps it verbatim.
 *
 * The id is `ballotId(vote, voter)`, so concurrent voters never write the same
 * element and a voter's second cast is an upsert of their own ballot. Other
 * people's ballots are hidden until the vote has `state: 'ended'`
 * (`visibleBallots`) — a UI rule over local files: anyone who can read the
 * board file can read the ballots, which the vote sheet says. Cloud votes keep
 * ballots on the hub and never put them in the board.
 */

import { id } from '../fields.ts';
import type { AnnotationElement, ElementDef } from '../types.ts';
import { countMapField, deterministicId, isoTimeField, personField } from './_shared.ts';
import { MAX_VOTE_TARGETS } from './vote.model.ts';

const FIELDS = {
  /** The `vote` element this ballot belongs to. */
  vote: id(true),
  /** The voter (account id, or the local person id). */
  voter: personField(true),
  /** Dots per target. */
  picks: countMapField(MAX_VOTE_TARGETS),
  castAt: isoTimeField(),
};

/** The deterministic id of `voter`'s ballot in `voteId`. */
export function ballotId(voteId: string, voter: string): string {
  return deterministicId('ballot', [voteId, voter]);
}

const isVote = (el: AnnotationElement | undefined, voteId: string) =>
  !!el && el.type === 'vote' && el.id === voteId;

/** A ballot that is what it claims: its id is the one its (vote, voter) derive. */
function genuine(b: AnnotationElement): boolean {
  return (
    b.type === 'ballot' &&
    typeof b.vote === 'string' &&
    typeof b.voter === 'string' &&
    b.id === ballotId(b.vote, b.voter)
  );
}

/**
 * The ballots of `voteId` that `viewer` may see: their own while the vote is
 * open, everyone's once it has ended.
 */
export function visibleBallots(
  elements: Iterable<AnnotationElement>,
  voteId: string,
  viewer: string
): AnnotationElement[] {
  const all = [...elements];
  const v = all.find((e) => isVote(e, voteId));
  if (!v) return [];
  const ended = v.state === 'ended';
  return all.filter((e) => genuine(e) && e.vote === voteId && (ended || e.voter === viewer));
}

/**
 * Dots per target from the genuine ballots of a vote. A ballot that spends more
 * than `perVoter` dots, or picks something that is not a target, counts nothing
 * for that pick / ballot — a hand-edited file can't stuff the box.
 */
export function tallyBallots(
  elements: Iterable<AnnotationElement>,
  voteId: string
): { tallies: Record<string, number>; voters: number } {
  const all = [...elements];
  const v = all.find((e) => isVote(e, voteId));
  if (!v) return { tallies: {}, voters: 0 };
  const targets = new Set(Array.isArray(v.targets) ? (v.targets as string[]) : []);
  const perVoter = typeof v.perVoter === 'number' ? v.perVoter : 3;
  const tallies: Record<string, number> = {};
  let voters = 0;
  for (const b of all) {
    if (!genuine(b) || b.vote !== voteId) continue;
    const picks = (b.picks ?? {}) as Record<string, number>;
    const spent = Object.values(picks).reduce((s, n) => s + n, 0);
    if (spent === 0 || spent > perVoter) continue;
    voters++;
    for (const [t, n] of Object.entries(picks))
      if (targets.has(t)) tallies[t] = (tallies[t] ?? 0) + n;
  }
  const sorted: Record<string, number> = {};
  for (const k of Object.keys(tallies).sort()) sorted[k] = tallies[k] as number;
  return { tallies: sorted, voters };
}

export const ballot: ElementDef = {
  type: 'ballot',
  fields: FIELDS,
  sortedKeys: true, // a format-2 type (R5: a format-1 reader sorts an unknown type's keys)
  caps: {
    box: false,
    rotatable: false,
    resizable: false,
    bindable: false,
    container: false,
    textSlot: null,
    metadata: true,
  },
  bounds: () => null,
  hitTest: () => false,
  translate: () => ({}),
  resize: () => ({}),
  meaningful: () => true,
};
