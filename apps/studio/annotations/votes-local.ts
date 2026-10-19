// annotations/votes-local.ts — formal votes over the BOARD (S4.14, Gate 0 A18, contract
// S4-S9-votes-comments §1, §2.5). Pure: every function reads board elements and answers ops for
// `api.applyAnnotationOps`, which serializes writes per canvas file (onAnnotationChain).
//
// Two homes write through here:
//   - LOCAL (no hub): the `vote` element plus one `ballot` element per voter, `ballotId(vote, voter)`
//     — so two voters never write the same element and a second cast is an upsert of your own
//     ballot. Other people's ballots are hidden in the UI until the vote has ended (the sheet says
//     anyone who can open the project's files can see them).
//   - HUB (`votes-v1`): the board gets the `vote` element only (`cloudVoteElement`), and at the end
//     its counts (`endPatch`) and the result section. A ballot never enters the board.
//
// The picks rule is the hub's own (`asPicks`, apps/hub/src/votes.mjs): keys ⊆ targets, whole
// numbers ≥ 1, sum ≤ perVoter; anything else is refused `invalid`, never clamped.
//
// The result section (`voteResultId(id)`, deterministic, so whoever writes it first wins nothing)
// is an ordinary `section` titled "Vote · <title> · 1 Oct" with one `text` member listing the
// counts — what AI and a format-1 peer read.

import { asPicks, isVoteTarget } from '../../hub/src/votes.mjs';
import { ballotId, tallyBallots } from './elements/ballot.model.ts';
import { voteResultId } from './elements/vote.model.ts';
import { keyBetween } from './fractional-index.ts';
import type { Op } from './ops.ts';
import type { AnnotationElement } from './types.ts';

export type Picks = Record<string, number>;

/** One vote as every surface sees it (the hub's VoteRow; times in ms). */
export interface VoteRow {
  id: string;
  canvas: string;
  targets: string[];
  title: string;
  perVoter: number;
  state: 'open' | 'ended';
  startedBy: string;
  startedAt: number;
  endsAt: number;
  endedAt?: number;
  /** WHO holds a non-empty ballot — never what they picked. */
  done: string[];
  expected?: number;
  /** Only once ended. */
  tallies?: Record<string, number>;
  voters?: number;
}

export const VOTE_ID_RE = /^vote-[a-z0-9]{10}$/;
export const MAX_TARGETS = 32;
export const DEFAULT_PER_VOTER = 3;
export const DEFAULT_DURATION_S = 120;
export const RESULT_PREFIX = 'Vote';
export const RESULT_TONE = '#3f9e5c'; // section tone Green (section-fold.ts SECTION_TONES)

export function newVoteId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let s = 'vote-';
  for (const b of bytes) s += (b % 36).toString(36);
  return s;
}

export function checkPicks(
  raw: unknown,
  targets: readonly string[],
  perVoter: number
): Picks | null {
  return asPicks(raw, targets, perVoter) as Picks | null;
}

const isControl = (c: string) => {
  const n = c.charCodeAt(0);
  return n < 32 || n === 127;
};
const hasControl = (s: string) => [...s].some(isControl);
const iso = (ms: number) => new Date(ms).toISOString();
const ms = (v: unknown): number => {
  const t = typeof v === 'string' ? Date.parse(v) : Number.NaN;
  return Number.isFinite(t) ? t : 0;
};
const isVote = (e: AnnotationElement | undefined): e is AnnotationElement =>
  !!e && e.type === 'vote' && typeof e.id === 'string';

function genuineBallots(elements: readonly AnnotationElement[], voteId: string) {
  return elements.filter(
    (b) =>
      b.type === 'ballot' &&
      b.vote === voteId &&
      typeof b.voter === 'string' &&
      b.id === ballotId(voteId, b.voter)
  );
}

const spent = (p: unknown) =>
  p && typeof p === 'object' ? Object.values(p as Picks).reduce((s, n) => s + (n as number), 0) : 0;

/** The board's vote as a row. `done` = the voters of genuine non-empty ballots. */
export function boardVoteRow(
  elements: readonly AnnotationElement[],
  v: AnnotationElement,
  canvas: string
): VoteRow {
  const ended = v.state === 'ended';
  const done = genuineBallots(elements, v.id)
    .filter((b) => spent(b.picks) > 0)
    .map((b) => b.voter as string)
    .sort();
  const row: VoteRow = {
    id: v.id,
    canvas,
    targets: Array.isArray(v.targets) ? (v.targets as string[]) : [],
    title: typeof v.title === 'string' ? v.title : '',
    perVoter: typeof v.perVoter === 'number' ? v.perVoter : DEFAULT_PER_VOTER,
    state: ended ? 'ended' : 'open',
    startedBy: typeof v.startedBy === 'string' ? v.startedBy : '',
    startedAt: ms(v.startedAt),
    endsAt: ms(v.endsAt),
    done,
  };
  if (typeof v.expected === 'number') row.expected = v.expected;
  if (ended) {
    row.endedAt = ms(v.endedAt);
    // sec-a C1(a) — the counts are RECOUNTED from the genuine ballots on every read; the stored
    // `tallies` / `votersDone` fields are a projection for format-1 peers, never trusted here.
    const recount = tallyBallots(elements, v.id);
    row.tallies = recount.tallies;
    row.voters = recount.voters;
  }
  return row;
}

/** Every vote on the board, as rows, plus `viewer`'s own picks per vote (never anyone else's). */
export function boardVotes(
  elements: readonly AnnotationElement[],
  canvas: string,
  viewer: string
): { votes: VoteRow[]; mine: Record<string, Picks> } {
  const votes: VoteRow[] = [];
  const mine: Record<string, Picks> = {};
  for (const v of elements) {
    if (!isVote(v)) continue;
    votes.push(boardVoteRow(elements, v, canvas));
    const own = elements.find((b) => b.id === ballotId(v.id, viewer) && b.type === 'ballot');
    if (own && v.state !== 'ended') mine[v.id] = { ...((own.picks as Picks) ?? {}) };
  }
  votes.sort((a, b) => b.startedAt - a.startedAt);
  return { votes, mine };
}

const topIndex = (elements: readonly AnnotationElement[]) =>
  elements.reduce<string | null>(
    (top, e) => (typeof e.index === 'string' && (top === null || e.index > top) ? e.index : top),
    null
  );

export interface StartInput {
  targets?: unknown;
  title?: unknown;
  perVoter?: unknown;
  durationS?: unknown;
  expected?: unknown;
}

export type Refusal = { refused: 'invalid' | 'vote-open' | 'ended' | 'not-found'; why?: string };

const intIn = (v: unknown, min: number, max: number, def: number): number | undefined => {
  if (v === undefined || v === null) return def;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= min && v <= max ? v : undefined;
};

/** Validated start fields (the hub's caps: 1–32 targets, 1–10 votes each, 30–3600 s). */
export function parseStart(
  b: StartInput
):
  | { targets: string[]; title: string; perVoter: number; durationS: number; expected?: number }
  | Refusal {
  const t = b.targets;
  if (!Array.isArray(t) || t.length < 1 || t.length > MAX_TARGETS)
    return { refused: 'invalid', why: 'targets' };
  if (!t.every(isVoteTarget) || new Set(t).size !== t.length)
    return { refused: 'invalid', why: 'targets' };
  const title = b.title === undefined ? '' : b.title;
  if (typeof title !== 'string' || title.length > 200 || hasControl(title))
    return { refused: 'invalid', why: 'title' };
  const perVoter = intIn(b.perVoter, 1, 10, DEFAULT_PER_VOTER);
  const durationS = intIn(b.durationS, 30, 3600, DEFAULT_DURATION_S);
  if (perVoter === undefined || durationS === undefined) return { refused: 'invalid' };
  const expected = b.expected === undefined ? undefined : intIn(b.expected, 1, 99, 1);
  if (b.expected !== undefined && expected === undefined) return { refused: 'invalid' };
  return { targets: t as string[], title: title.trim(), perVoter, durationS, expected };
}

/** LOCAL start: one `vote` element. One open vote per canvas (`vote-open`), as the hub. */
export function startOps(
  elements: readonly AnnotationElement[],
  input: StartInput,
  actor: string,
  now: number,
  id = newVoteId()
): { ops: Op[]; vote: AnnotationElement } | Refusal {
  const p = parseStart(input);
  if ('refused' in p) return p;
  if (elements.some((e) => isVote(e) && e.state !== 'ended' && ms(e.endsAt) > now))
    return { refused: 'vote-open' };
  const vote: AnnotationElement = {
    id,
    type: 'vote',
    index: keyBetween(topIndex(elements), null),
    targets: p.targets,
    title: p.title,
    perVoter: p.perVoter,
    state: 'open',
    startedBy: actor.slice(0, 64),
    startedAt: iso(now),
    endsAt: iso(now + p.durationS * 1000),
    votersDone: 0,
    ...(p.expected ? { expected: p.expected } : {}),
  };
  return { ops: [{ op: 'put', el: vote }], vote };
}

/** LOCAL cast: upsert `voter`'s own ballot; `{}` withdraws (the ballot is removed). */
export function castOps(
  elements: readonly AnnotationElement[],
  voteId: string,
  voter: string,
  picks: unknown,
  now: number
): { ops: Op[]; mine: Picks } | Refusal {
  const v = elements.find((e) => isVote(e) && e.id === voteId);
  if (!v) return { refused: 'not-found' };
  if (v.state === 'ended' || ms(v.endsAt) <= now) return { refused: 'ended' };
  const targets = Array.isArray(v.targets) ? (v.targets as string[]) : [];
  const perVoter = typeof v.perVoter === 'number' ? v.perVoter : DEFAULT_PER_VOTER;
  const mine = checkPicks(picks, targets, perVoter);
  if (!mine) return { refused: 'invalid' };
  const who = voter.slice(0, 64);
  const id = ballotId(voteId, who);
  const had = elements.some((e) => e.id === id);
  if (Object.keys(mine).length === 0) return { ops: had ? [{ op: 'delete', id }] : [], mine };
  const ballot: AnnotationElement = {
    id,
    type: 'ballot',
    index: keyBetween(topIndex(elements), null),
    vote: voteId,
    voter: who,
    picks: mine,
    castAt: iso(now),
  };
  return { ops: [{ op: 'put', el: ballot }], mine };
}

export interface ResultHints {
  /** Target → the name it is shown under (artboard label); else the ref itself. */
  labels?: Record<string, string>;
  /** World point for the result section's top-left. */
  place?: { x: number; y: number };
  /** The day it ended, for the title ("1 Oct"); default: the end time. */
  locale?: string;
}

const RESULT_W = 460;

const person = (n: number) => (n === 1 ? '1 person' : `${n} people`);
const votesEach = (n: number) => (n === 1 ? '1 vote each' : `${n} votes each`);
function lasted(s: number): string {
  if (s >= 60 && s % 60 === 0) return `${s / 60} min`;
  if (s >= 60) return `${Math.round(s / 60)} min`;
  return `${s} s`;
}
const day = (t: number) =>
  new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const cleanLabel = (s: unknown) =>
  typeof s === 'string'
    ? [...s]
        .map((c) => (isControl(c) ? ' ' : c))
        .join('')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120)
    : '';

/** "Vote · Helmy · 1 Oct". */
export function resultTitle(title: string, endedAt: number): string {
  return [RESULT_PREFIX, title.trim() || null, day(endedAt)].filter(Boolean).join(' · ');
}

/** The result text: one "<name> · <count>" line per target (most dots first), then the summary line. */
export function resultText(row: VoteRow, labels: Record<string, string> = {}): string {
  const tallies = row.tallies ?? {};
  const lines = [...row.targets]
    .map((t) => ({ t, n: tallies[t] ?? 0 }))
    .sort((a, b) => b.n - a.n || row.targets.indexOf(a.t) - row.targets.indexOf(b.t))
    .map(({ t, n }) => `${cleanLabel(labels[t]) || t.replace(/^ab:/, '')} · ${n}`);
  const secs = Math.max(1, Math.round((row.endsAt - row.startedAt) / 1000));
  lines.push(`${person(row.voters ?? 0)} · ${votesEach(row.perVoter)} · ${lasted(secs)}`);
  return lines.join('\n');
}

/** Where the result goes when the shell gave no point: below everything on the board. */
function defaultPlace(elements: readonly AnnotationElement[]): { x: number; y: number } {
  let x = 0;
  let bottom = 0;
  let any = false;
  for (const e of elements) {
    if (typeof e.x !== 'number' || typeof e.y !== 'number') continue;
    const h = typeof e.h === 'number' ? e.h : 0;
    if (!any || e.y + h > bottom) bottom = e.y + h;
    if (!any || e.x < x) x = e.x;
    any = true;
  }
  return { x, y: any ? bottom + 80 : 0 };
}

const finite = (p: unknown): p is { x: number; y: number } =>
  !!p &&
  typeof p === 'object' &&
  Number.isFinite((p as { x: unknown }).x) &&
  Number.isFinite((p as { y: unknown }).y) &&
  Math.abs((p as { x: number }).x) < 1e7 &&
  Math.abs((p as { y: number }).y) < 1e7;

/**
 * The result section + its text member. sec-a C1(b): an existing section under the result id is
 * OVERWRITTEN (a planted one must not stand as the outcome): its place is kept, anything else
 * parented in it leaves, and its text is the recount's. Equal elements are no-op puts.
 */
export function resultOps(
  elements: readonly AnnotationElement[],
  row: VoteRow,
  hints: ResultHints = {}
): Op[] {
  const sid = voteResultId(row.id);
  const tid = `${sid}-t`.slice(0, 64);
  const had = elements.find((e) => e.id === sid);
  const kept =
    had && typeof had.x === 'number' && typeof had.y === 'number' ? { x: had.x, y: had.y } : null;
  const at = kept ?? (finite(hints.place) ? hints.place : defaultPlace(elements));
  const text = resultText(row, hints.labels ?? {});
  const lines = text.split('\n').length;
  const h = Math.max(150, 56 + lines * 26);
  const top = topIndex(elements);
  const i1 = typeof had?.index === 'string' ? had.index : keyBetween(top, null);
  const oldText = elements.find((e) => e.id === tid);
  const i2 =
    typeof oldText?.index === 'string'
      ? oldText.index
      : keyBetween(top !== null && top > i1 ? top : i1, null);
  const planted: Op[] = elements
    .filter((e) => e.parent === sid && e.id !== tid)
    .map((e) => ({ op: 'delete', id: e.id }));
  const ops: Op[] = [
    ...planted,
    {
      op: 'put',
      el: {
        id: sid,
        type: 'section',
        index: i1,
        x: Math.round(at.x),
        y: Math.round(at.y),
        w: RESULT_W,
        h,
        label: resultTitle(row.title, row.endedAt ?? row.endsAt).slice(0, 200),
        color: RESULT_TONE,
      },
    },
    {
      op: 'put',
      el: {
        id: tid,
        type: 'text',
        parent: sid,
        index: i2,
        x: Math.round(at.x) + 16,
        y: Math.round(at.y) + 24,
        w: RESULT_W - 32,
        h: h - 40,
        text,
      },
    },
  ];
  // An unchanged section is a no-op put (applyOps skips an equal element), so a second End writes nothing.
  return ops;
}

/** The vote element's end fields (local and hub): counts revealed at once. */
export function endPatch(
  tallies: Record<string, number>,
  voters: number,
  endedAt: number
): Record<string, unknown> {
  return { state: 'ended', endedAt: iso(endedAt), tallies, votersDone: voters };
}

/** LOCAL end: tallies from the genuine ballots, then the result section — one batch. */
export function endOps(
  elements: readonly AnnotationElement[],
  voteId: string,
  canvas: string,
  now: number,
  hints: ResultHints = {}
): { ops: Op[]; row: VoteRow } | Refusal {
  const v = elements.find((e) => isVote(e) && e.id === voteId);
  if (!v) return { refused: 'not-found' };
  if (v.state === 'ended') return { refused: 'ended' };
  const { tallies, voters } = tallyBallots(elements, voteId);
  const endedAt = Math.min(now, ms(v.endsAt) || now);
  const ended = { ...v, ...endPatch(tallies, voters, endedAt) } as AnnotationElement;
  const row = boardVoteRow(elements, ended, canvas);
  return {
    ops: [
      { op: 'patch', id: voteId, set: endPatch(tallies, voters, endedAt) },
      ...resultOps(elements, row, hints),
    ],
    row,
  };
}

/** LOCAL lazy end: every open vote whose time is up (a read or a write ends it, like the hub). */
export function lapsedOps(
  elements: readonly AnnotationElement[],
  canvas: string,
  now: number,
  hints: ResultHints = {}
): Op[] {
  const ops: Op[] = [];
  for (const v of elements) {
    if (!isVote(v) || v.state === 'ended' || ms(v.endsAt) > now) continue;
    const r = endOps(elements, v.id, canvas, ms(v.endsAt), hints);
    if (!('refused' in r)) ops.push(...r.ops);
  }
  return ops;
}

// ── the hub home ─────────────────────────────────────────────────────────────────────────────

/** The board's `vote` element for a hub vote: the row's public fields, NEVER a ballot or a pick. */
export function cloudVoteElement(
  row: VoteRow,
  elements: readonly AnnotationElement[]
): AnnotationElement {
  return {
    id: row.id,
    type: 'vote',
    index: keyBetween(topIndex(elements), null),
    targets: row.targets,
    title: row.title,
    perVoter: row.perVoter,
    state: 'open',
    startedBy: row.startedBy.slice(0, 64),
    startedAt: iso(row.startedAt),
    endsAt: iso(row.endsAt),
    votersDone: 0,
  };
}

/**
 * HUB end mirrored onto the board: the vote element's counts + the result section, once.
 * `row` must be an ENDED hub row (tallies present); an open row writes nothing.
 */
export function cloudEndOps(
  elements: readonly AnnotationElement[],
  row: VoteRow,
  hints: ResultHints = {}
): Op[] {
  if (row.state !== 'ended' || !row.tallies) return [];
  const ops: Op[] = [];
  const v = elements.find((e) => isVote(e) && e.id === row.id);
  if (!v) ops.push({ op: 'put', el: cloudVoteElement(row, elements) });
  if (!v || v.state !== 'ended')
    ops.push({
      op: 'patch',
      id: row.id,
      set: endPatch(row.tallies, row.voters ?? 0, row.endedAt ?? row.endsAt),
    });
  ops.push(...resultOps(elements, row, hints));
  return ops;
}
