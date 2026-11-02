/**
 * Vote (contract S4 Q5, Gate 0 A18) — a formal dot vote over a set of targets.
 * A format-2 element TYPE (V2-1.12 R4); a format-1 peer keeps it verbatim.
 *
 * Locally the board carries the `vote` element plus one `ballot` element per
 * voter (ballot.model.ts) — never one shared `ballots` field, which would be a
 * single merge unit that concurrent voters overwrite. In the cloud the hub holds
 * the ballots and the timer; the board then carries only this element (targets,
 * `endsAt`, `votersDone`) and, once ended, the `tallies`.
 *
 * The element is box-less: the vote's surface is the shell's vote bar, and its
 * result is an ordinary section written under `voteResultId`.
 */

import { num, str, stringList } from '../fields.ts';
import type { ElementDef } from '../types.ts';
import {
  countMapField,
  deterministicId,
  isoTimeField,
  personField,
  targetField,
  wordField,
} from './_shared.ts';

export const MAX_VOTE_TARGETS = 32;

/** Known `state` words. `state` is an open word so a later state never reshapes it (R3). */
export const VOTE_STATES = ['open', 'ended'] as const;

const FIELDS = {
  /** What is being voted on: annotation ids or `ab:` / `el:` refs. */
  targets: { ...stringList(MAX_VOTE_TARGETS, targetField()), def: undefined, required: true },
  title: str({ max: 200, plain: true, def: '', allowEmpty: true }),
  /** Dots each voter may place (A18: 3). */
  perVoter: num({ min: 1, max: 99, dp: 0, def: 3 }),
  state: { ...wordField(), def: 'open' },
  startedBy: personField(),
  startedAt: isoTimeField(),
  endsAt: isoTimeField(),
  endedAt: isoTimeField(),
  /** How many voters have cast (cloud: the hub's count; locally derived). */
  votersDone: num({ min: 0, max: 9999, dp: 0, def: 0 }),
  /** Dots per target, written when the vote ends. */
  tallies: countMapField(MAX_VOTE_TARGETS),
};

/** The idempotent id of a vote's result section (whoever writes it first wins nothing). */
export function voteResultId(voteId: string): string {
  return deterministicId('vote', [voteId, 'result']);
}

export const vote: ElementDef = {
  type: 'vote',
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
  meaningful: (el) => Array.isArray(el.targets) && el.targets.length > 0,
};
