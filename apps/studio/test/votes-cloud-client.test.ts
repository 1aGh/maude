// S4.14 — formal votes in a project linked to a `votes-v1` hub: routes/votes.ts is a PROXY to the
// hub's `/api/projects/:p/v1/votes*` (contract S4-S9-votes-comments §2.4–§2.6). The fake hub here is
// the hub's OWN votes core (apps/hub/src/votes.mjs) over an in-memory bun:sqlite store, with the
// bearer token naming the person.
//
// Pins (§2.6 lanes the studio owns): no ballot and no pick ever reaches the BOARD (the replica a
// cloud project syncs) before the end — the board gets the `vote` element only, its counts only once
// ended; no answer to one person carries another's picks; the voter is the hub session, never a
// body field; a vote on another canvas answers as missing (U1); the vote-state the canvas hears is
// the projection (bridge parser, dgn-protocol.ts).

import { Database } from 'bun:sqlite';
import { describe, expect, test } from 'bun:test';
import { createVotesCore, VOTES_DDL } from '../../hub/src/votes.mjs';
import { voteResultId } from '../annotations/elements/vote.model.ts';
import { applyOps as applyPure, type Op } from '../annotations/ops.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createVoteHomeResolver, createVoteRoutes } from '../routes/votes.ts';

const FILE = '.design/ui/jerseys.tsx';
const T = ['ab:a', 'ab:b', 'ab:c'];

function fakeHub(clock: () => number) {
  const db = new Database(':memory:');
  for (const ddl of VOTES_DDL as string[]) db.exec(ddl);
  const sql = {
    exec(query: string, ...params: unknown[]) {
      const s = db.query(query);
      // biome-ignore lint/suspicious/noExplicitAny: bun:sqlite binds positional params
      const p = params as any[];
      return s.columnNames.length ? (s.all(...p) as Record<string, unknown>[]) : (s.run(...p), []);
    },
    transaction<T>(fn: () => T): T {
      return db.transaction(fn)();
    },
  };
  // biome-ignore lint/suspicious/noExplicitAny: the hub core is plain JS
  const core = createVotesCore(sql, { now: clock }) as any;
  const project = 'p1';
  const out = (status: number, body: unknown) => Response.json(body, { status });
  const STATUS: Record<string, number> = {
    invalid: 400,
    'vote-open': 409,
    capacity: 429,
    ended: 409,
    'not-found': 404,
  };
  const answer = (r: Record<string, unknown>, ok = 200) =>
    r.refused ? out(STATUS[r.refused as string] ?? 409, { code: r.refused }) : out(ok, r);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const actor = String(new Headers(init?.headers).get('authorization')).replace(/^Bearer /, '');
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const now = clock();
    const m = url.pathname.match(
      /^\/api\/projects\/[^/]+\/v1\/votes(?:\/([^/]+))?(?:\/(ballot|end))?$/
    );
    if (!m) return out(404, { code: 'not-found' });
    const [, id, verb] = m;
    if (!id && init?.method === 'GET')
      return answer(
        core.votesList({ project, canvases: [url.searchParams.get('canvas')], actor, now })
      );
    if (!id) return answer(core.votesStart({ project, ...body, actor, now }), 201);
    if (!verb) return answer(core.votesGet({ project, voteId: id, actor, now }));
    if (verb === 'ballot')
      return answer(core.votesCast({ project, voteId: id, actor, picks: body.picks, now }));
    return answer(core.votesEnd({ project, voteId: id, actor, now }));
  }) as typeof fetch;
  return { fetchImpl, core, project };
}

function harness() {
  let text: string | null = null;
  let clock = Date.UTC(2026, 9, 1, 10, 0, 0);
  const writes: Op[][] = [];
  const hub = fakeHub(() => clock);
  // the bearer is the person: one route table per session, as each desktop holds its own token
  const tableFor = (person: string) =>
    createVoteRoutes({
      designRel: '.design',
      home: () => ({ kind: 'hub', hubUrl: 'http://hub.test', token: () => person }),
      person: async () => person,
      readBoard: async () => ({ ok: true, text }),
      applyOps: async (_file, ops) => {
        const before = text ? parseBoard(text).elements : [];
        text = serializeBoard([
          ...applyPure(new Map(before.map((e) => [e.id, e])), ops).state.values(),
        ]);
        writes.push(ops);
        return { ok: true };
      },
      fetchImpl: hub.fetchImpl,
      now: () => clock,
    });
  const call = async (
    who: string,
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    file = FILE
  ) => {
    const spec = tableFor(who).find((s) => s.method === method && s.path === path) as RouteSpec;
    const url = `http://127.0.0.1${path}`;
    const req = new Request(method === 'GET' ? `${url}?file=${encodeURIComponent(file)}` : url, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const res = await spec.handle(req, {});
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  return { call, writes, board: () => text ?? '', advance: (ms: number) => (clock += ms), hub };
}

describe('cloud votes (hub-held ballots)', () => {
  test('no ballot or pick reaches the board before the end; counts arrive at once after', async () => {
    const h = harness();
    const start = await h.call('You', 'POST', '/_api/votes/start', {
      file: FILE,
      targets: T,
      title: 'Helmy',
      expected: 3,
    });
    expect(start.status).toBe(201);
    const id = start.body.vote.id as string;
    await h.call('Jonas', 'POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:c': 3 } });
    await h.call('Tereza', 'POST', '/_api/votes/ballot', {
      file: FILE,
      id,
      picks: { 'ab:a': 2, 'ab:b': 1 },
    });
    // every write the studio made to the board during the vote
    const during = JSON.stringify(h.writes);
    expect(during).not.toContain('"ballot"');
    expect(during).not.toContain('picks');
    expect(during).not.toContain('tallies');
    expect(h.board()).not.toContain('ballot');
    const v = parseBoard(h.board()).elements.find((e) => e.id === id);
    expect(v?.type).toBe('vote');
    expect(v?.state ?? 'open').toBe('open'); // the default word is omitted from the record
    expect(v?.tallies).toBeUndefined();

    const end = await h.call('You', 'POST', '/_api/votes/end', {
      file: FILE,
      id,
      labels: { 'ab:c': 'Se pruhem' },
    });
    expect(end.status).toBe(200);
    const els = parseBoard(h.board()).elements;
    expect(els.find((e) => e.id === id)?.tallies).toEqual({ 'ab:a': 2, 'ab:b': 1, 'ab:c': 3 });
    expect(els.find((e) => e.id === voteResultId(id))?.label).toBe('Vote · Helmy · 1 Oct');
    expect(h.board()).not.toContain('"ballot"');
  });

  test('one person’s answers never carry another’s picks; the voter is the session', async () => {
    const h = harness();
    const id = (await h.call('You', 'POST', '/_api/votes/start', { file: FILE, targets: T })).body
      .vote.id;
    await h.call('Jonas', 'POST', '/_api/votes/ballot', {
      file: FILE,
      id,
      picks: { 'ab:c': 3 },
      voter: 'Tereza',
    });
    const tereza = await h.call('Tereza', 'GET', '/_api/votes');
    expect(tereza.body.mode).toBe('hub');
    expect(tereza.body.mine[id]).toBeUndefined(); // Jonas's forged `voter` landed as Jonas's
    expect(JSON.stringify(tereza.body)).not.toContain('"ab:c":3');
    expect(tereza.body.votes[0].tallies).toBeUndefined();
    expect(tereza.body.votes[0].done).toEqual(['Jonas']);
    const jonas = await h.call('Jonas', 'GET', '/_api/votes');
    expect(jonas.body.mine[id]).toEqual({ 'ab:c': 3 });
  });

  test('a vote on another canvas answers as missing (U1)', async () => {
    const h = harness();
    const id = (await h.call('You', 'POST', '/_api/votes/start', { file: FILE, targets: T })).body
      .vote.id;
    const other = '.design/ui/other.tsx';
    const cast = await h.call(
      'Jonas',
      'POST',
      '/_api/votes/ballot',
      { file: other, id, picks: { 'ab:a': 1 } },
      other
    );
    expect(cast.status).toBe(404);
    const end = await h.call('You', 'POST', '/_api/votes/end', { file: other, id }, other);
    expect(end.status).toBe(404);
    const missing = await h.call(
      'Jonas',
      'POST',
      '/_api/votes/ballot',
      { file: other, id: 'vote-zzzzzzzzzz', picks: {} },
      other
    );
    expect(missing.status).toBe(cast.status);
    expect(missing.body).toEqual(cast.body);
  });

  test('the hub timer ends it: End after the time mirrors the counts once', async () => {
    const h = harness();
    const id = (
      await h.call('You', 'POST', '/_api/votes/start', { file: FILE, targets: T, durationS: 30 })
    ).body.vote.id;
    await h.call('Jonas', 'POST', '/_api/votes/ballot', { file: FILE, id, picks: { 'ab:a': 1 } });
    h.advance(31_000);
    const r = await h.call('Jonas', 'GET', '/_api/votes');
    expect(r.body.votes[0].state).toBe('ended');
    expect(r.body.votes[0].tallies).toEqual({ 'ab:a': 1 });
    const end = await h.call('You', 'POST', '/_api/votes/end', { file: FILE, id });
    expect(end.status).toBe(200);
    expect(parseBoard(h.board()).elements.find((e) => e.id === id)?.state).toBe('ended');
  });
});

describe('where votes live (fail closed)', () => {
  const link = { hubUrl: 'http://hub.test', token: () => 't' };
  const make = (linked: typeof link | null, workspace: boolean, caps: string[] | null) =>
    createVoteHomeResolver({
      linked: () => linked,
      workspace: () => workspace,
      health: async () => ({ capabilities: caps }),
    });
  test('local only when not linked; a cell is off; an old hub is off; an unreachable hub is never local', async () => {
    expect((await make(null, false, null)()).kind).toBe('local');
    expect((await make(null, true, null)()).kind).toBe('off');
    expect((await make(link, false, ['runs-v1', 'votes-v1'])()).kind).toBe('hub');
    expect((await make(link, false, ['runs-v1'])()).kind).toBe('off');
    expect((await make(link, false, null)()).kind).toBe('hub');
  });
});
