// S9.13 — the votes routes' rate limit and DDR-053 machine scope (contract
// S4-S9-votes-comments.md §2.4; V2-1.16 U1).
//
//   - Vote writes (start, ballot, end) are budgeted per PERSON per minute; past
//     the budget the answer is 429 `rate-limited`, before the body is read or
//     the store is called. Reads are never budgeted; another person is not
//     affected; the window slides.
//   - A project session keeps its machine scope: a vote on a canvas outside the
//     token's scope answers exactly as a missing vote, and the list omits it.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, before, describe, test } from 'node:test';

import { createStoreCore } from '../src/project-transactions/store-core.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';
import { createVotesRoutes, createWriteLimiter } from '../src/routes-v2/votes.mjs';
import { addToken } from '../src/tokens.mjs';
import { A, B, http, rm, seedTokens, startHub, tmpDir } from './_acl-docs-fixture.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const V = '/api/projects/local/v1/votes';
const TARGETS = ['ab:dir-a', 'ab:dir-b'];

function rig({ writeLimit }) {
  const clock = { t: 9_000_000 };
  const core = createStoreCore(betterSqliteAdapter(new Database(':memory:')), {
    now: () => clock.t,
  });
  core.migrate();
  const store = {};
  const calls = { n: 0 };
  for (const [k, fn] of Object.entries(core)) {
    store[k] = async (...a) => {
      calls.n += 1;
      return fn(...a);
    };
  }
  const routes = createVotesRoutes({
    store,
    projectId: 'local',
    auth: (req) => ({ actor: req.headers['x-who'], readOnly: false }),
    now: () => clock.t,
    writeLimit,
    setTimeoutImpl: () => null,
    clearTimeoutImpl: () => {},
  });
  async function call(who, method, path, body) {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const request = {
      url: path,
      headers: { 'x-who': who },
      async *[Symbol.asyncIterator]() {
        yield* chunks;
      },
    };
    let out = null;
    await routes.handle({
      path: path.split('?')[0],
      method,
      request,
      respondJson: (status, json) => {
        out = { status, body: json };
      },
    });
    return out;
  }
  return { clock, calls, call, routes };
}

describe('the write budget (per person, sliding)', () => {
  test('past the budget: 429 rate-limited, the store untouched; reads and other people go on', async () => {
    const { clock, calls, call, routes } = rig({ writeLimit: { max: 3, windowMs: 60_000 } });
    const v = (await call('olga@x.test', 'POST', V, { canvas: A, targets: TARGETS })).body.vote;
    assert.equal(
      (await call('olga@x.test', 'POST', `${V}/${v.id}/ballot`, { picks: { 'ab:dir-a': 1 } }))
        .status,
      200
    );
    assert.equal(
      (await call('olga@x.test', 'POST', `${V}/${v.id}/ballot`, { picks: { 'ab:dir-b': 1 } }))
        .status,
      200
    );
    const before = calls.n;
    const over = await call('olga@x.test', 'POST', `${V}/${v.id}/ballot`, {
      picks: { 'ab:dir-a': 1 },
    });
    assert.equal(over.status, 429, JSON.stringify(over.body));
    assert.equal(over.body.code, 'rate-limited');
    assert.equal(calls.n, before, 'a refused write never reaches the store');
    // Reads are not budgeted.
    assert.equal((await call('olga@x.test', 'GET', `${V}/${v.id}`)).status, 200);
    assert.equal((await call('olga@x.test', 'GET', V)).status, 200);
    // Another person has their own budget.
    assert.equal(
      (await call('max@x.test', 'POST', `${V}/${v.id}/ballot`, { picks: { 'ab:dir-a': 1 } }))
        .status,
      200
    );
    // The window slides: a minute later Olga may write again, and her last
    // accepted ballot is the one that counts.
    clock.t += 60_001;
    const end = await call('olga@x.test', 'POST', `${V}/${v.id}/end`, {});
    assert.equal(end.status, 200, JSON.stringify(end.body));
    assert.deepEqual(end.body.vote.tallies, { 'ab:dir-a': 1, 'ab:dir-b': 1 });
    routes.close();
  });

  test('writeLimit null turns it off (the hub’s rateLimit: false)', async () => {
    const { call, routes } = rig({ writeLimit: null });
    const v = (await call('olga@x.test', 'POST', V, { canvas: A, targets: TARGETS })).body.vote;
    for (let i = 0; i < 20; i++) {
      const r = await call('olga@x.test', 'POST', `${V}/${v.id}/ballot`, {
        picks: { 'ab:dir-a': 1 },
      });
      assert.equal(r.status, 200);
    }
    routes.close();
  });

  test('the limiter: max per window per key, bounded memory', () => {
    const l = createWriteLimiter({ max: 2, windowMs: 1000 });
    assert.equal(l.check('a', 0), true);
    assert.equal(l.check('a', 10), true);
    assert.equal(l.check('a', 20), false);
    assert.equal(l.check('b', 20), true);
    assert.equal(l.check('a', 1001), true);
  });
});

describe('a machine-scoped project token (DDR-053)', () => {
  let dataDir;
  let hub;
  let owner;
  let scoped;
  before(async () => {
    dataDir = tmpDir('maude-votes-scope-');
    const t = seedTokens(dataDir);
    const s = addToken(dataDir, {
      label: 'scoped-mac',
      scope: A,
      role: 'member',
      owner: 'sam@x.test',
    }).value;
    hub = await startHub(dataDir, { rateLimit: false });
    owner = http(hub.http, t.owner);
    scoped = http(hub.http, s);
  });
  after(async () => {
    await hub?.close();
    rm(dataDir);
  });

  test('a vote outside the scope answers exactly as a missing one; the list omits it', async () => {
    const onA = (await owner.post(V, { canvas: A, targets: TARGETS, title: 'alpha' })).body.vote;
    const onB = (await owner.post(V, { canvas: B, targets: TARGETS, title: 'canary-b vote' })).body
      .vote;
    const missing = 'vote-zzzzzzzzzz';
    for (const [method, suffix, body] of [
      ['GET', '', undefined],
      ['POST', '/ballot', { picks: { 'ab:dir-a': 1 } }],
      ['POST', '/end', {}],
    ]) {
      const b = await scoped.send(method, `${V}/${onB.id}${suffix}`, body);
      const n = await scoped.send(method, `${V}/${missing}${suffix}`, body);
      assert.equal(b.status, 404, `${method} ${suffix}: ${b.text}`);
      assert.equal(b.text, n.text, `${method} ${suffix}`);
    }
    const list = await scoped.get(V);
    assert.equal(list.status, 200);
    assert.deepEqual(
      list.body.votes.map((v) => v.id),
      [onA.id]
    );
    assert.equal(list.text.toLowerCase().includes('canary'), false);
    // Inside its scope it is a member: it votes and ends there.
    assert.equal(
      (await scoped.post(`${V}/${onA.id}/ballot`, { picks: { 'ab:dir-b': 1 } })).status,
      200
    );
    assert.equal((await scoped.post(`${V}/${onA.id}/end`, {})).status, 200);
    await owner.post(`${V}/${onB.id}/end`, {});
  });
});
