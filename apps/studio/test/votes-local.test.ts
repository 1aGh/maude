// S4.14 — formal votes in a LOCAL project (no hub): the `vote` element + one `ballot` element per
// voter on the board, through routes/votes.ts (contract S4-S9-votes-comments §1, §2.5).
//
// Pins: two voters casting at the same time both survive (a ballot is per person — never one shared
// field); another person's picks are in NO answer until the vote has ended; the picks rule refuses
// (never clamps); a lapsed vote reads ended; End writes the result section AI reads.

import { describe, expect, test } from 'bun:test';
import { ballotId } from '../annotations/elements/ballot.model.ts';
import { voteResultId } from '../annotations/elements/vote.model.ts';
import { applyOps as applyPure, type Op } from '../annotations/ops.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createVoteRoutes, LOCAL_SECRECY_LINE, type VoteHome } from '../routes/votes.ts';

const FILE = '.design/ui/jerseys.tsx';
const T = ['ab:a', 'ab:b', 'ab:c'];
const tick = () => new Promise((r) => setTimeout(r, 1));

function harness(home: VoteHome = { kind: 'local' }) {
  let text: string | null = null;
  let clock = Date.UTC(2026, 9, 1, 10, 0, 0);
  const writes: Op[][] = [];
  const specs = createVoteRoutes({
    designRel: '.design',
    home: () => home,
    person: async (req) => req.headers.get('x-test-person') ?? 'You',
    readBoard: async () => {
      await tick(); // let concurrent requests interleave between read and write
      return { ok: true, text };
    },
    applyOps: async (_file, ops) => {
      await tick();
      const before = text ? parseBoard(text).elements : [];
      const r = applyPure(new Map(before.map((e) => [e.id, e])), ops);
      text = serializeBoard([...r.state.values()]);
      writes.push(ops);
      return { ok: true };
    },
    now: () => clock,
    // sec-a C1(c) — the names come from the server's read of the canvas, not the request body
    labels: async () => ({
      'ab:a': 'Helma: matná zelená',
      'ab:b': 'Helma: lesklá',
      'ab:c': 'Helma: se pruhem',
    }),
  });
  const find = (method: string, path: string) =>
    specs.find((s) => s.method === method && s.path === path) as RouteSpec;
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown, who = 'You') => {
    const url = `http://127.0.0.1/${path.replace(/^\//, '')}`;
    const req = new Request(method === 'GET' ? `${url}?file=${encodeURIComponent(FILE)}` : url, {
      method,
      headers: { 'content-type': 'application/json', 'x-test-person': who },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const res = await find(method, path).handle(req, {});
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const board = (): AnnotationElement[] => (text ? parseBoard(text).elements : []);
  return {
    call,
    board,
    writes,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

async function started(h: ReturnType<typeof harness>, extra: Record<string, unknown> = {}) {
  const r = await h.call('POST', '/_api/votes/start', {
    file: FILE,
    targets: T,
    title: 'Helmy',
    ...extra,
  });
  expect(r.status).toBe(201);
  return r.body.vote.id as string;
}

describe('local votes (board ballots)', () => {
  test('the sheet line is the local secrecy line', async () => {
    const h = harness();
    const r = await h.call('GET', '/_api/votes');
    expect(r.body.mode).toBe('local');
    expect(r.body.line).toBe(LOCAL_SECRECY_LINE);
  });

  test('two voters casting at once both survive — one ballot element each', async () => {
    const h = harness();
    const id = await started(h);
    const [a, b] = await Promise.all([
      h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:a': 2 } }, 'Tereza'),
      h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:b': 3 } }, 'Jonas'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const ballots = h.board().filter((e) => e.type === 'ballot');
    expect(ballots.map((e) => e.id).sort()).toEqual(
      [ballotId(id, 'Jonas'), ballotId(id, 'Tereza')].sort()
    );
    // 30 rounds of the race: never one overwriting the other
    for (let i = 0; i < 30; i++) {
      await Promise.all([
        h.call(
          'POST',
          '/_api/votes/ballot',
          { file: FILE, id, picks: { 'ab:a': 1 + (i % 3) } },
          'Tereza'
        ),
        h.call(
          'POST',
          '/_api/votes/ballot',
          { file: FILE, id, picks: { 'ab:c': 1 + (i % 2) } },
          'Jonas'
        ),
      ]);
      expect(h.board().filter((e) => e.type === 'ballot').length).toBe(2);
    }
  });

  test('another person’s picks are in no answer until the end; then counts show at once', async () => {
    const h = harness();
    const id = await started(h);
    const cast = await h.call(
      'POST',
      '/_api/votes/ballot',
      { file: FILE, id, picks: { 'ab:c': 3 } },
      'Jonas'
    );
    expect(cast.body.mine).toEqual({ 'ab:c': 3 });
    await h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:a': 1 } }, 'Tereza');
    const seen = await h.call('GET', '/_api/votes', undefined, 'Tereza');
    const raw = JSON.stringify(seen.body);
    expect(seen.body.mine[id]).toEqual({ 'ab:a': 1 });
    expect(raw).not.toContain('"ab:c":3'); // Jonas's pick
    expect(seen.body.votes[0].tallies).toBeUndefined();
    expect(seen.body.votes[0].done).toEqual(['Jonas', 'Tereza']); // WHO voted, never what
    // the voter of a cast answer is the session, never the body
    await h.call(
      'POST',
      '/_api/votes/ballot',
      { file: FILE, id, picks: { 'ab:b': 1 }, voter: 'Jonas' },
      'Petra'
    );
    expect(h.board().find((e) => e.id === ballotId(id, 'Petra'))).toBeTruthy();
    expect(h.board().find((e) => e.id === ballotId(id, 'Jonas'))?.picks).toEqual({ 'ab:c': 3 });

    const end = await h.call('POST', '/_api/votes/end', {
      file: FILE,
      id,
      labels: {
        'ab:a': 'Helma: matná zelená',
        'ab:b': 'Helma: lesklá',
        'ab:c': 'Helma: se pruhem',
      },
      place: { x: 140, y: 500 },
    });
    expect(end.status).toBe(200);
    expect(end.body.vote.tallies).toEqual({ 'ab:a': 1, 'ab:b': 1, 'ab:c': 3 });
    const after = await h.call('GET', '/_api/votes', undefined, 'Tereza');
    expect(after.body.votes[0].state).toBe('ended');
    expect(after.body.votes[0].voters).toBe(3);
    expect(after.body.mine[id]).toBeUndefined();
  });

  test('the result section persists and reads as words (what AI reads)', async () => {
    const h = harness();
    const id = await started(h);
    await h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:a': 3 } }, 'Jonas');
    await h.call('POST', '/_api/votes/end', {
      file: FILE,
      id,
      labels: { 'ab:a': 'Helma: matná zelená' },
    });
    const sec = h.board().find((e) => e.id === voteResultId(id));
    expect(sec?.type).toBe('section');
    expect(sec?.label).toBe('Vote · Helmy · 1 Oct');
    const txt = h.board().find((e) => e.parent === voteResultId(id));
    expect(String(txt?.text).split('\n')[0]).toBe('Helma: matná zelená · 3');
    expect(String(txt?.text)).toContain('1 person · 3 votes each · 2 min');
    // a second End writes nothing twice
    const n = h.board().length;
    const again = await h.call('POST', '/_api/votes/end', { file: FILE, id });
    expect(again.status).toBe(200);
    expect(h.board().length).toBe(n);
  });

  test('the picks rule refuses, never clamps; one open vote per canvas', async () => {
    const h = harness();
    const id = await started(h);
    const over = await h.call('POST', '/_api/votes/ballot', {
      file: FILE,
      id,
      picks: { 'ab:a': 4 },
    });
    expect(over.status).toBe(400);
    const stray = await h.call('POST', '/_api/votes/ballot', {
      file: FILE,
      id,
      picks: { 'ab:zz': 1 },
    });
    expect(stray.status).toBe(400);
    expect(h.board().some((e) => e.type === 'ballot')).toBe(false);
    const second = await h.call('POST', '/_api/votes/start', { file: FILE, targets: T });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('vote-open');
  });

  test('a lapsed vote reads ended (counts revealed) and takes no ballot', async () => {
    const h = harness();
    const id = await started(h, { durationS: 30 });
    await h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:b': 2 } }, 'Jonas');
    h.advance(31_000);
    const late = await h.call('POST', '/_api/votes/ballot', {
      file: FILE,
      id,
      picks: { 'ab:a': 1 },
    });
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('ended');
    const r = await h.call('GET', '/_api/votes');
    expect(r.body.votes[0].state).toBe('ended');
    expect(r.body.votes[0].tallies).toEqual({ 'ab:b': 2 });
    // a new vote may start: the lapsed one is written ended in the same batch
    await started(h);
    expect(h.board().find((e) => e.id === id)?.state).toBe('ended');
  });

  test('a hub without votes-v1: votes are off, with the line', async () => {
    const h = harness({ kind: 'off' });
    const r = await h.call('POST', '/_api/votes/start', { file: FILE, targets: T });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe('votes-off');
    expect(r.body.line).toBe(
      "This team server can't keep votes secret yet — ask whoever runs it to update."
    );
    expect(h.writes.length).toBe(0);
  });
});
