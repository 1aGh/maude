// S4.14 — the studio → canvas lane of a vote (contract S4-S9-votes-comments §2.6, last row): the
// untrusted canvas iframe (DDR-054) hears `vote-state` with the projection only — the vote's targets,
// state, YOUR own dots and the counts once ended. Never a name, never another person's picks.
// Two walls: the shell builds the message field by field (vote-store.js voteStateMessage), and the
// dgn table's parser keeps nothing it does not name (bridge/dgn-protocol.ts). Plus the canvas asks.

import { describe, expect, test } from 'bun:test';
import { chipFor, readVoteState } from '../annotations/ui/vote-dots.tsx';
import { c2sSpec, s2cSpec } from '../bridge/dgn-protocol.ts';
import { barModel, nextPicks, voteStateMessage } from '../client/v2/annotations/vote-store.js';

const ROW = {
  id: 'vote-abcdefghij',
  canvas: 'ui/jerseys.tsx',
  targets: ['ab:a', 'ab:b', 'ab:c'],
  title: 'Helmy',
  perVoter: 3,
  state: 'open' as const,
  startedBy: 'You',
  startedAt: 0,
  endsAt: 102_000,
  done: ['Jonas', 'Tereza', 'Petra', 'You'],
  expected: 5,
};

describe('vote-state is the projection', () => {
  test('the shell sends only targets, state, perVoter, your dots — no names, no other picks', () => {
    const leaky = { ...ROW, ballots: [{ voter: 'Jonas', picks: { 'ab:c': 3 } }], voters: 4 };
    const m = voteStateMessage(leaky, { 'ab:a': 2, 'ab:zz': 9 });
    expect(m).toEqual({
      dgn: 'vote-state',
      vote: { id: ROW.id, targets: ROW.targets, state: 'open', perVoter: 3 },
      mine: { 'ab:a': 2 },
    });
    const raw = JSON.stringify(m);
    for (const word of ['Jonas', 'Tereza', 'ballots', 'done', 'startedBy', 'voters'])
      expect(raw).not.toContain(word);
  });

  test('counts appear only once ended; your dots are gone then', () => {
    const m = voteStateMessage(
      { ...ROW, state: 'ended', tallies: { 'ab:a': 9, 'ab:c': 2 } },
      { 'ab:a': 1 }
    );
    expect(m.vote?.tallies).toEqual({ 'ab:a': 9, 'ab:b': 0, 'ab:c': 2 });
    expect(m.mine).toEqual({});
    expect(voteStateMessage({ ...ROW, tallies: { 'ab:a': 1 } }, {}).vote).not.toHaveProperty(
      'tallies'
    );
  });

  test('the dgn parser keeps nothing it does not name', () => {
    const spec = s2cSpec('vote-state');
    expect(spec?.gate).toBe('parent');
    const parsed = spec?.parse({
      dgn: 'vote-state',
      vote: { ...ROW, picks: { Jonas: { 'ab:c': 3 } } },
      mine: { 'ab:a': 1 },
      others: { Jonas: { 'ab:c': 3 } },
    } as Record<string, unknown>) as Record<string, unknown>;
    expect(parsed).toEqual({
      vote: { id: ROW.id, targets: ROW.targets, state: 'open', perVoter: 3 },
      mine: { 'ab:a': 1 },
    });
    // a prototype key is refused whole
    expect(spec?.parse(JSON.parse('{"vote":null,"mine":{"__proto__":1}}'))).toBeFalsy();
  });

  test('the canvas reads it defensively and draws only your dots / the counts', () => {
    const s = readVoteState({
      dgn: 'vote-state',
      vote: { ...ROW, state: 'open' },
      mine: { 'ab:b': 2, 'ab:x': 1 },
    });
    expect(s?.mine).toEqual({ 'ab:b': 2 });
    expect(chipFor(s!.vote!, s!.mine, 'ab:b')).toEqual({ kind: 'yours', dots: 2, canAdd: true });
    expect(chipFor(s!.vote!, s!.mine, 'ab:zz')).toBeNull();
    const e = readVoteState({
      dgn: 'vote-state',
      vote: { ...ROW, state: 'ended', tallies: { 'ab:a': 9, 'ab:b': 4 } },
      mine: { 'ab:a': 1 },
    });
    expect(e?.mine).toEqual({});
    expect(chipFor(e!.vote!, e!.mine, 'ab:a')).toEqual({ kind: 'count', n: 9, win: true });
    expect(chipFor(e!.vote!, e!.mine, 'ab:c')).toEqual({ kind: 'count', n: 0, win: false });
  });

  test('the canvas asks: vote-cast {artboard, remove?} and vote-board are active-only and clamped', () => {
    expect(c2sSpec('vote-cast')?.gate).toBe('active');
    expect(
      c2sSpec('vote-cast')?.parse({ artboard: 'a', remove: true, picks: { x: 1 } } as never)
    ).toEqual({ artboard: 'a', remove: true });
    expect(c2sSpec('vote-cast')?.parse({ artboard: '../x' } as never)).toBeFalsy();
    expect(c2sSpec('vote-board')?.gate).toBe('active');
    expect(
      c2sSpec('vote-board')?.parse({
        artboards: [{ id: 'a', label: 'Helma', x: 0, y: 0, w: 10, h: 10, html: '<b>' }],
        open: true,
      } as never)
    ).toEqual({ artboards: [{ id: 'a', label: 'Helma', x: 0, y: 0, w: 10, h: 10 }], open: true });
  });
});

describe('the bar and the dots', () => {
  test('"Vote Helmy · 1 left of your 3 · 1:42 · 4 of 5 done"', () => {
    expect(barModel(ROW, { 'ab:a': 2 }, 0)).toEqual({
      what: 'Helmy',
      left: 1,
      of: 3,
      time: '1:42',
      done: '4 of 5 done',
      faces: ROW.done,
      pending: false, // sec-a M2: nothing moved on the canvas waits for Cast
    });
    expect(barModel({ ...ROW, title: '', expected: undefined }, {}, 0)?.what).toBe('3 artboards');
    expect(barModel({ ...ROW, state: 'ended' }, {}, 0)).toBeNull();
  });

  test('a dot more stops at perVoter; a dot back only where you have one', () => {
    expect(nextPicks({ 'ab:a': 3 }, 'ab:b', 1, 3, ROW.targets)).toBeNull();
    expect(nextPicks({ 'ab:a': 2 }, 'ab:b', 1, 3, ROW.targets)).toEqual({ 'ab:a': 2, 'ab:b': 1 });
    expect(nextPicks({ 'ab:a': 1 }, 'ab:a', -1, 3, ROW.targets)).toEqual({});
    expect(nextPicks({}, 'ab:a', -1, 3, ROW.targets)).toBeNull();
    expect(nextPicks({}, 'ab:zz', 1, 3, ROW.targets)).toBeNull();
  });
});
