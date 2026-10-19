// sec-a (wave-A security fixes) — votes and ballots are the vote door's alone.
//
//   M1    the board guard: no HTTP writer adds, changes or removes a `vote` / `ballot` (stamps stay
//         the person's own canvas write, forgeable by design — stamp.model.ts)
//   C1(a) an ended vote's counts are RECOUNTED from the genuine ballots; a stored `tallies` lies in vain
//   C1(b) End overwrites a section already planted under the result id
//   C1(c) the result's names are the server's read of the canvas, never the request's `labels`
//   C1(d) a ballot change is a line in the history (its picks stay secret)

import { describe, expect, test } from 'bun:test';
import { ballotId } from '../annotations/elements/ballot.model.ts';
import { voteResultId } from '../annotations/elements/vote.model.ts';
import { applyOps as applyPure, type Op } from '../annotations/ops.ts';
import { canonical, parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { voteDoorOnly } from '../annotations/vote-guard.ts';
import { describeChanges } from '../history/describe';
import { annotationsLane } from '../history/describe-annotations';
import type { RouteSpec } from '../routes/table.ts';
import { createVoteRoutes } from '../routes/votes.ts';

const FILE = '.design/ui/jerseys.tsx';
const T = ['ab:a', 'ab:b', 'ab:c'];

function harness(labels: Record<string, string> = {}) {
  let text: string | null = null;
  const clock = Date.UTC(2026, 9, 1, 10, 0, 0);
  const specs = createVoteRoutes({
    designRel: '.design',
    home: () => ({ kind: 'local' }),
    person: async (req) => req.headers.get('x-test-person') ?? 'You',
    readBoard: async () => ({ ok: true, text }),
    applyOps: async (_file, ops) => {
      const before = text ? parseBoard(text).elements : [];
      const r = applyPure(new Map(before.map((e) => [e.id, e])), ops);
      text = serializeBoard([...r.state.values()]);
      return { ok: true };
    },
    now: () => clock,
    labels: async () => labels,
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
  /** A write OFF the vote door (what a forged board write would leave). */
  const plant = (ops: Op[]) => {
    const r = applyPure(new Map(board().map((e) => [e.id, e])), ops);
    expect(r.rejected).toEqual([]);
    text = serializeBoard([...r.state.values()]);
  };
  return { call, board, plant };
}

async function started(h: ReturnType<typeof harness>) {
  const r = await h.call('POST', '/_api/votes/start', { file: FILE, targets: T, title: 'Helmy' });
  expect(r.status).toBe(201);
  return r.body.vote.id as string;
}

const byId = (els: AnnotationElement[]) => new Map(els.map((e) => [e.id, e]));
const sticky = (id: string, extra: Record<string, unknown> = {}) =>
  canonical({ id, type: 'sticky', index: 'a5', x: 0, y: 0, w: 120, h: 120, text: 'hi', ...extra });

describe('M1 — the board guard (voteDoorOnly)', () => {
  test('refuses every way a batch could add, change or remove a vote or a ballot', async () => {
    const h = harness();
    const id = await started(h);
    await h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:a': 2 } }, 'Jonas');
    const before = byId(h.board());
    const ballot = ballotId(id, 'Jonas');
    const forged = canonical({
      id: ballotId(id, 'Petra'),
      type: 'ballot',
      index: 'a9',
      vote: id,
      voter: 'Petra',
      picks: { 'ab:c': 3 },
    });
    const tries: Op[][] = [
      [{ op: 'put', el: forged }],
      [{ op: 'patch', id: ballot, set: { picks: { 'ab:c': 3 } } }],
      [{ op: 'delete', id: ballot }],
      [{ op: 'patch', id, set: { state: 'ended', tallies: { 'ab:c': 99 } } }],
      [{ op: 'delete', id }],
      [{ op: 'put', el: sticky(ballot) }], // a type swap over the ballot's id
    ];
    for (const ops of tries) {
      const after = applyPure(before, ops).state;
      expect(voteDoorOnly(before, after)).not.toBeNull();
    }
  });

  test('lets a sticky and a stamp through (the person draws them on the canvas)', async () => {
    const h = harness();
    const id = await started(h);
    const before = byId(h.board());
    const stamp = canonical({
      id: 'stamp-ab-a-you-heart',
      type: 'stamp',
      index: 'a7',
      x: 0,
      y: 0,
      w: 28,
      h: 28,
      kind: 'heart',
      target: 'ab:a',
    });
    const after = applyPure(before, [
      { op: 'put', el: sticky('s1') },
      { op: 'put', el: stamp },
    ]);
    expect(after.rejected).toEqual([]);
    expect(voteDoorOnly(before, after.state)).toBeNull();
    expect(after.state.get(id)).toEqual(before.get(id));
  });
});

describe('C1 — the vote door reads and writes only what is true', () => {
  test('(a) an ended vote is recounted from the genuine ballots; the stored tallies are ignored', async () => {
    const h = harness();
    const id = await started(h);
    await h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:b': 1 } }, 'Jonas');
    await h.call('POST', '/_api/votes/end', { file: FILE, id });
    // a forged end: the counts and the voter number rewritten off the door
    h.plant([{ op: 'patch', id, set: { tallies: { 'ab:a': 99 }, votersDone: 40 } }]);
    const r = await h.call('GET', '/_api/votes');
    expect(r.body.votes[0].tallies).toEqual({ 'ab:b': 1 });
    expect(r.body.votes[0].voters).toBe(1);
  });

  test('(b) End overwrites a section planted under the result id, and its planted children leave', async () => {
    const h = harness();
    const id = await started(h);
    await h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:b': 2 } }, 'Jonas');
    const sid = voteResultId(id);
    h.plant([
      {
        op: 'put',
        el: canonical({
          id: sid,
          type: 'section',
          index: 'a8',
          x: 40,
          y: 40,
          w: 300,
          h: 200,
          label: 'Vote · Helmy · winner A',
        }),
      },
      {
        op: 'put',
        el: canonical({
          id: `${sid}-t`.slice(0, 64),
          type: 'text',
          parent: sid,
          index: 'a9',
          x: 50,
          y: 60,
          w: 200,
          h: 40,
          text: 'a · 99',
        }),
      },
      { op: 'put', el: sticky('planted', { parent: sid, x: 60, y: 120, index: 'b0' }) },
    ]);
    expect((await h.call('POST', '/_api/votes/end', { file: FILE, id })).status).toBe(200);
    const sec = h.board().find((e) => e.id === sid);
    expect(sec?.label).toBe('Vote · Helmy · 1 Oct');
    const txt = h.board().find((e) => e.parent === sid && e.type === 'text');
    expect(String(txt?.text).split('\n')[0]).toBe('b · 2');
    expect(h.board().some((e) => e.id === 'planted')).toBe(false);
  });

  test('(c) the result names are the server labels; a label in the request is ignored', async () => {
    const h = harness({ 'ab:b': 'Lesklá' });
    const id = await started(h);
    await h.call('POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:b': 1 } }, 'Jonas');
    await h.call('POST', '/_api/votes/end', {
      file: FILE,
      id,
      labels: { 'ab:a': 'WINNER — pick me', 'ab:b': 'loser' },
    });
    const txt = String(h.board().find((e) => e.parent === voteResultId(id))?.text);
    expect(txt).not.toContain('WINNER');
    expect(txt).not.toContain('loser');
    expect(txt.split('\n')[0]).toBe('Lesklá · 1');
  });

  test('(d) a ballot cast, changed or taken back is a history line, without its picks', () => {
    const vote = canonical({
      id: 'v_1',
      type: 'vote',
      index: 'a0',
      targets: T,
      title: 'Helmy',
      perVoter: 3,
    });
    const ballot = (picks: Record<string, number>) =>
      canonical({
        id: ballotId('v_1', 'Jonas'),
        type: 'ballot',
        index: 'a1',
        vote: 'v_1',
        voter: 'Jonas',
        picks,
      });
    const run = (a: AnnotationElement[], b: AnnotationElement[]) =>
      describeChanges(
        'fixture.tsx',
        { tsx: '', annotations: serializeBoard(a) },
        { tsx: '', annotations: serializeBoard(b) },
        { lanes: [annotationsLane] }
      ).changes.map((c) => c.words);
    expect(run([vote], [vote, ballot({ 'ab:a': 2 })])).toEqual(['Ballot cast']);
    const changed = run([vote, ballot({ 'ab:a': 2 })], [vote, ballot({ 'ab:c': 3 })]);
    expect(changed).toEqual(['Ballot changed']);
    expect(changed.join(' ')).not.toMatch(/\d/);
    expect(run([vote, ballot({ 'ab:a': 2 })], [vote])).toEqual(['Ballot taken back']);
  });
});
