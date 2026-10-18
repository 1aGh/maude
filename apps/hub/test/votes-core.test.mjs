// S4.6 — hub-held ballots in the store core (Gate 0 A18, contract
// S4-S9-votes-comments.md §2.2, §2.5). A real store core over better-sqlite3
// and a clock the test owns: the store's clock is the only clock, so "the
// container slept through the end" is the clock moving with nobody calling.
//
// The oracle is the store's own tables (which ballots exist), never a method's
// return value alone.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { STORE_METHODS } from '../../cells/project-store.mjs';
import { targetField } from '../../studio/annotations/elements/_shared.ts';
import { ballotId, tallyBallots } from '../../studio/annotations/elements/ballot.model.ts';
import { createStoreCore } from '../src/project-transactions/store-core.mjs';
import { METHODS as REMOTE_METHODS } from '../src/project-transactions/store-remote.mjs';
import {
  betterSqliteAdapter,
  openSqliteProjectStore,
} from '../src/project-transactions/store-sqlite.mjs';
import {
  asPicks,
  ENDED_RETAIN_MS,
  isVoteTarget,
  MAX_OPEN_PER_PROJECT,
  VOTE_ID,
} from '../src/votes.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const P = 'proj-1';
const A = 'ui/Alpha.tsx';
const B = 'ui/Beta.tsx';
const TARGETS = ['ab:dir-a', 'ab:dir-b', 'ab:dir-c'];

function rig() {
  const clock = { t: 1_000_000 };
  const db = new Database(':memory:');
  const core = createStoreCore(betterSqliteAdapter(db), { now: () => clock.t });
  core.migrate();
  const sql = betterSqliteAdapter(db);
  const ballots = (voteId) =>
    sql
      .exec(`SELECT voter FROM ballots WHERE vote_id = ? ORDER BY voter`, voteId)
      .map((r) => r.voter);
  const allBallots = () => Number(sql.exec(`SELECT COUNT(*) AS n FROM ballots`)[0].n);
  const start = (extra = {}) =>
    core.votesStart({ project: P, canvas: A, targets: TARGETS, actor: 'olga@x.test', ...extra });
  return { core, clock, sql, ballots, allBallots, start };
}

describe('mounted in BOTH homes (store-core, store-remote, the cell DO)', () => {
  test('the five methods are store API, RPC methods, and cell methods', () => {
    const core = createStoreCore(betterSqliteAdapter(new Database(':memory:')));
    for (const m of ['votesStart', 'votesCast', 'votesEnd', 'votesGet', 'votesList']) {
      assert.equal(typeof core[m], 'function', `store-core ${m}`);
      assert.ok(REMOTE_METHODS.includes(m), `store-remote ${m}`);
      assert.ok(STORE_METHODS.includes(m), `cells ${m}`);
    }
  });
});

describe('votesStart', () => {
  test('a vote: id, hub-clock end, defaults, nobody done, no counts', () => {
    const { start, clock } = rig();
    const r = start({ title: 'Which direction?', expected: 5 });
    assert.ok(r.vote, JSON.stringify(r));
    assert.match(r.vote.id, VOTE_ID);
    assert.equal(r.vote.state, 'open');
    assert.equal(r.vote.perVoter, 3);
    assert.equal(r.vote.endsAt, clock.t + 120_000);
    assert.equal(r.vote.startedBy, 'olga@x.test');
    assert.equal(r.vote.expected, 5);
    assert.deepEqual(r.vote.done, []);
    assert.equal('tallies' in r.vote, false);
    assert.equal('voters' in r.vote, false);
    assert.ok(r.seq > 0);
    assert.deepEqual(r.touched, [A]);
  });

  test('refusals are data: invalid shapes, one open vote per canvas, capacity', () => {
    const { start, core } = rig();
    const bad = [
      { targets: [] },
      { targets: Array.from({ length: 33 }, (_, i) => `t${i}`) },
      { targets: ['ok', 'not a target'] },
      { targets: ['__proto__'] },
      { perVoter: 0 },
      { perVoter: 11 },
      { perVoter: 2.5 },
      { durationS: 29 },
      { durationS: 3601 },
      { expected: 0 },
      { expected: 100 },
      { title: 'x'.repeat(201) },
      { title: 7 },
      { canvas: '../escape.tsx' },
      { canvas: '/abs.tsx' },
      { canvas: '' },
      { actor: '' },
    ];
    for (const extra of bad) assert.equal(start(extra).refused, 'invalid', JSON.stringify(extra));
    assert.ok(start().vote);
    assert.equal(start().refused, 'vote-open');
    for (let i = 1; i < MAX_OPEN_PER_PROJECT; i++) {
      assert.ok(start({ canvas: `ui/c${i}.tsx` }).vote, `vote ${i}`);
    }
    assert.equal(start({ canvas: 'ui/one-too-many.tsx' }).refused, 'capacity');
    // Another project is its own scope.
    assert.ok(
      core.votesStart({ project: 'other', canvas: A, targets: TARGETS, actor: 'olga@x.test' }).vote
    );
  });
});

describe('the picks rule ≡ tallyBallots (a local and a hub tally agree)', () => {
  test('targets: the hub accepts exactly what the studio targetField parses (minus prototype keys)', () => {
    const studio = targetField(true);
    for (const t of [
      'sticky-1',
      'A_b-9',
      'ab:hero',
      'ab:Hero.v2:1',
      'el:hero/cta-button',
      'el:hero/cta#3',
      'el:hero/Bad',
      'el:/x',
      'ab:',
      'ab:-x',
      'x'.repeat(64),
      'x'.repeat(65),
      'has space',
      'el:hero/cta#01',
    ]) {
      assert.equal(isVoteTarget(t), studio.parse(t) !== undefined, t);
    }
    for (const k of ['__proto__', 'constructor', 'prototype']) assert.equal(isVoteTarget(k), false);
  });

  test('on one fixture: valid ballots tally the same; the rest are refused, never clamped', () => {
    const { start, core } = rig();
    const v = start().vote;
    const fixture = [
      { voter: 'a@x', picks: { 'ab:dir-a': 3 }, valid: true },
      { voter: 'b@x', picks: { 'ab:dir-a': 1, 'ab:dir-b': 2 }, valid: true },
      { voter: 'c@x', picks: { 'ab:dir-c': 1 }, valid: true },
      { voter: 'd@x', picks: { 'ab:dir-a': 4 }, valid: false }, // over perVoter
      { voter: 'e@x', picks: { 'ab:dir-a': 2, 'ab:dir-b': 2 }, valid: false }, // sum over
      { voter: 'f@x', picks: { 'ab:dir-a': 0 }, valid: false },
      { voter: 'g@x', picks: { 'ab:dir-a': 1.5 }, valid: false },
      { voter: 'h@x', picks: { 'ab:elsewhere': 1 }, valid: false },
      { voter: 'i@x', picks: ['ab:dir-a'], valid: false },
      { voter: 'j@x', picks: { 'ab:dir-a': -1 }, valid: false },
    ];
    for (const f of fixture) {
      const r = core.votesCast({ project: P, voteId: v.id, actor: f.voter, picks: f.picks });
      if (f.valid) assert.deepEqual(r.mine, f.picks, f.voter);
      else assert.equal(r.refused, 'invalid', f.voter);
    }
    // The board-side tally of the very same accepted ballots.
    const elements = [
      { id: v.id, type: 'vote', targets: TARGETS, perVoter: 3, state: 'ended' },
      ...fixture
        .filter((f) => f.valid)
        .map((f) => ({
          id: ballotId(v.id, f.voter),
          type: 'ballot',
          vote: v.id,
          voter: f.voter,
          picks: f.picks,
        })),
    ];
    const local = tallyBallots(elements, v.id);
    const ended = core.votesEnd({ project: P, voteId: v.id, actor: 'olga@x.test' }).vote;
    assert.deepEqual(ended.tallies, local.tallies);
    assert.equal(ended.voters, local.voters);
    // Every refused ballot counts nothing in the local tally either (over-spent / non-integer).
    for (const f of fixture.filter((x) => !x.valid && !Array.isArray(x.picks))) {
      assert.equal(asPicks(f.picks, TARGETS, 3), null, f.voter);
    }
  });
});

describe('votesCast', () => {
  test('upsert: a second cast replaces your ballot, never adds one', () => {
    const { start, core, ballots } = rig();
    const v = start().vote;
    core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-a': 1 } });
    const r = core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-b': 3 } });
    assert.deepEqual(r.mine, { 'ab:dir-b': 3 });
    assert.deepEqual(ballots(v.id), ['a@x']);
    assert.deepEqual(r.vote.done, ['a@x']);
  });

  test('{} withdraws: the row goes and you are no longer done', () => {
    const { start, core, ballots } = rig();
    const v = start().vote;
    core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-a': 1 } });
    const r = core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: {} });
    assert.deepEqual(r.mine, {});
    assert.deepEqual(r.vote.done, []);
    assert.deepEqual(ballots(v.id), []);
  });

  test('seq moves when WHO voted changes, never when a dot moves', () => {
    const { start, core } = rig();
    const v = start().vote;
    const s1 = core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-a': 1 } });
    const s2 = core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-b': 1 } });
    assert.equal(s2.seq, s1.seq);
    assert.deepEqual(s2.touched, []);
    const s3 = core.votesCast({ project: P, voteId: v.id, actor: 'b@x', picks: { 'ab:dir-b': 1 } });
    assert.ok(s3.seq > s2.seq);
    assert.deepEqual(s3.touched, [A]);
  });

  test('missing, malformed and ended votes', () => {
    const { start, core } = rig();
    assert.equal(
      core.votesCast({ project: P, voteId: 'vote-zzzzzzzzzz', actor: 'a@x', picks: {} }).refused,
      'not-found'
    );
    assert.equal(
      core.votesCast({ project: P, voteId: '../x', actor: 'a@x', picks: {} }).refused,
      'not-found'
    );
    const v = start().vote;
    // Another project's vote is not this project's.
    assert.equal(
      core.votesCast({ project: 'other', voteId: v.id, actor: 'a@x', picks: {} }).refused,
      'not-found'
    );
    core.votesEnd({ project: P, voteId: v.id, actor: 'olga@x.test' });
    assert.equal(
      core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-a': 1 } }).refused,
      'ended'
    );
  });
});

describe('secrecy before the end', () => {
  test('another reader sees who voted, never what — no partial count anywhere', () => {
    const { start, core } = rig();
    const v = start().vote;
    core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-c': 3 } });
    const asBob = core.votesGet({ project: P, voteId: v.id, actor: 'b@x' });
    assert.equal('mine' in asBob, false);
    assert.deepEqual(asBob.vote.done, ['a@x']);
    const list = core.votesList({ project: P });
    for (const text of [JSON.stringify(asBob), JSON.stringify(list)]) {
      assert.equal(/tallies|voters|picks|mine/.test(text), false, text);
      assert.equal(text.includes('"ab:dir-c":'), false, text);
    }
    // Your own picks come back to you only.
    assert.deepEqual(core.votesGet({ project: P, voteId: v.id, actor: 'a@x' }).mine, {
      'ab:dir-c': 3,
    });
  });
});

describe('votesEnd — reveal atomically, delete the ballots', () => {
  test('tallies + voters + done, and NO ballot row survives (yours included)', () => {
    const { start, core, ballots, allBallots } = rig();
    const v = start().vote;
    const w = start({ canvas: B }).vote;
    core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-a': 2 } });
    core.votesCast({
      project: P,
      voteId: v.id,
      actor: 'b@x',
      picks: { 'ab:dir-a': 1, 'ab:dir-b': 1 },
    });
    core.votesCast({ project: P, voteId: w.id, actor: 'a@x', picks: { 'ab:dir-c': 1 } });
    const r = core.votesEnd({ project: P, voteId: v.id, actor: 'olga@x.test' });
    assert.equal(r.vote.state, 'ended');
    assert.deepEqual(r.vote.tallies, { 'ab:dir-a': 3, 'ab:dir-b': 1 });
    assert.equal(r.vote.voters, 2);
    assert.deepEqual(r.vote.done, ['a@x', 'b@x']);
    assert.equal(typeof r.vote.endedAt, 'number');
    assert.deepEqual(ballots(v.id), []);
    // The other, still open vote keeps its ballot.
    assert.equal(allBallots(), 1);
    const got = core.votesGet({ project: P, voteId: v.id, actor: 'a@x' });
    assert.equal('mine' in got, false);
    assert.deepEqual(got.vote.tallies, r.vote.tallies);
    assert.equal(
      core.votesEnd({ project: P, voteId: v.id, actor: 'olga@x.test' }).refused,
      'ended'
    );
  });
});

describe('lazy end — the clock is the store’s', () => {
  test('a lapsed vote ends on the NEXT call, whichever method it is', () => {
    for (const call of ['get', 'list', 'cast', 'start']) {
      const { start, core, clock, ballots } = rig();
      const v = start({ durationS: 30 }).vote;
      core.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-a': 1 } });
      const before = core.votesGet({ project: P, voteId: v.id, actor: 'a@x' }).seq;
      clock.t += 30_000;
      const r =
        call === 'get'
          ? core.votesGet({ project: P, voteId: v.id, actor: 'x@x' })
          : call === 'list'
            ? core.votesList({ project: P })
            : call === 'cast'
              ? core.votesCast({ project: P, voteId: v.id, actor: 'b@x', picks: { 'ab:dir-a': 1 } })
              : start({ canvas: B });
      assert.deepEqual(ballots(v.id), [], call);
      assert.ok(r.seq > before, call);
      assert.ok(r.touched.includes(A), call);
      if (call === 'cast') assert.equal(r.refused, 'ended');
      const ended = core.votesGet({ project: P, voteId: v.id, actor: 'x@x' }).vote;
      assert.equal(ended.state, 'ended', call);
      assert.deepEqual(ended.tallies, { 'ab:dir-a': 1 }, call);
      assert.equal(ended.endedAt, clock.t, call);
    }
  });

  test('one second before the end it is still open', () => {
    const { start, core, clock } = rig();
    const v = start({ durationS: 30 }).vote;
    clock.t += 29_999;
    assert.equal(core.votesGet({ project: P, voteId: v.id, actor: 'x' }).vote.state, 'open');
  });

  test('an ended vote is kept 30 days after its end time, then dropped', () => {
    const { start, core, clock } = rig();
    const v = start({ durationS: 30 }).vote;
    clock.t += 30_000 + ENDED_RETAIN_MS - 1;
    assert.equal(core.votesGet({ project: P, voteId: v.id, actor: 'x' }).vote.state, 'ended');
    clock.t += 2;
    assert.equal(core.votesGet({ project: P, voteId: v.id, actor: 'x' }).refused, 'not-found');
  });
});

describe('votesList', () => {
  test('after=<seq> returns only what changed; canvases filters', () => {
    const { start, core } = rig();
    const a = start().vote;
    const mid = core.votesList({ project: P }).seq;
    const b = start({ canvas: B }).vote;
    const all = core.votesList({ project: P });
    assert.deepEqual(
      all.votes.map((x) => x.id),
      [a.id, b.id]
    );
    assert.deepEqual(
      core.votesList({ project: P, after: mid }).votes.map((x) => x.id),
      [b.id]
    );
    assert.deepEqual(core.votesList({ project: P, after: all.seq }).votes, []);
    assert.deepEqual(
      core.votesList({ project: P, canvases: [B] }).votes.map((x) => x.id),
      [b.id]
    );
    assert.deepEqual(core.votesList({ project: P, canvases: [] }).votes, []);
  });
});

describe('the concurrent-cast race (two voters, never one overwriting the other)', () => {
  test('300 rounds through the async store: both ballots survive, both are counted', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'maude-votes-race-'));
    dirs.push(dir);
    const store = openSqliteProjectStore(dir);
    try {
      for (let round = 0; round < 300; round++) {
        const canvas = `ui/race-${round % 5}.tsx`;
        const v = (await store.votesStart({ project: P, canvas, targets: TARGETS, actor: 'o@x' }))
          .vote;
        assert.ok(v, `round ${round}`);
        const [x, y] = await Promise.all([
          store.votesCast({ project: P, voteId: v.id, actor: 'a@x', picks: { 'ab:dir-a': 1 } }),
          store.votesCast({ project: P, voteId: v.id, actor: 'b@x', picks: { 'ab:dir-b': 2 } }),
        ]);
        assert.deepEqual(x.mine, { 'ab:dir-a': 1 });
        assert.deepEqual(y.mine, { 'ab:dir-b': 2 });
        const ended = (await store.votesEnd({ project: P, voteId: v.id, actor: 'o@x' })).vote;
        assert.deepEqual(ended.done, ['a@x', 'b@x'], `round ${round}`);
        assert.deepEqual(ended.tallies, { 'ab:dir-a': 1, 'ab:dir-b': 2 }, `round ${round}`);
      }
    } finally {
      store.close();
    }
  });
});
