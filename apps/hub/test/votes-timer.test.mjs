// S9.13 — the vote's timer (contract S4-S9-votes-comments.md §2.5). The hub
// clock decides; a best-effort in-process timer only makes the poke prompt, and
// correctness never depends on it: a container that slept through the end ends
// the vote on its next request.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

import { createStoreCore } from '../src/project-transactions/store-core.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';
import { createVotesRoutes } from '../src/routes-v2/votes.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const A = 'ui/Alpha.tsx';

function rig({ timers = true } = {}) {
  const clock = { t: 5_000_000 };
  const core = createStoreCore(betterSqliteAdapter(new Database(':memory:')), {
    now: () => clock.t,
  });
  core.migrate();
  const store = {};
  for (const [k, fn] of Object.entries(core)) store[k] = async (...a) => fn(...a);
  const pending = [];
  const pokes = [];
  const routes = createVotesRoutes({
    store,
    projectId: 'local',
    auth: () => ({ actor: 'olga@x.test', readOnly: false }),
    poke: { schedule: (seq, canvases) => pokes.push({ seq, canvases }) },
    now: () => clock.t,
    setTimeoutImpl: timers
      ? (fn, ms) => {
          const h = { fn, at: clock.t + ms };
          pending.push(h);
          return h;
        }
      : () => null,
    clearTimeoutImpl: (h) => {
      const i = pending.indexOf(h);
      if (i >= 0) pending.splice(i, 1);
    },
  });
  /** One request through the real handler. */
  async function call(method, path, body) {
    const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
    const request = {
      url: path,
      headers: {},
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
  return { clock, pending, pokes, call, routes };
}

describe('the vote ends on the hub clock', () => {
  test('the timer fires at endsAt: the vote ends and a poke goes out', async () => {
    const { clock, pending, pokes, call } = rig();
    const s = await call('POST', '/api/projects/local/v1/votes', {
      canvas: A,
      targets: ['ab:x', 'ab:y'],
      durationS: 30,
    });
    assert.equal(s.status, 201);
    await call('POST', `/api/projects/local/v1/votes/${s.body.vote.id}/ballot`, {
      picks: { 'ab:x': 2 },
    });
    assert.equal(pending.length, 1);
    assert.ok(pending[0].at >= s.body.vote.endsAt, 'armed at the end time');
    const before = pokes.length;
    clock.t = pending[0].at;
    await pending.shift().fn();
    assert.ok(pokes.length > before, 'the end was poked');
    assert.deepEqual(pokes.at(-1).canvases, [A]);
    const got = await call('GET', `/api/projects/local/v1/votes/${s.body.vote.id}`);
    assert.equal(got.body.vote.state, 'ended');
    assert.deepEqual(got.body.vote.tallies, { 'ab:x': 2 });
  });

  test('no timer at all (a sleeping container): the next request ends it', async () => {
    const { clock, call } = rig({ timers: false });
    const s = await call('POST', '/api/projects/local/v1/votes', {
      canvas: A,
      targets: ['ab:x'],
      durationS: 30,
    });
    await call('POST', `/api/projects/local/v1/votes/${s.body.vote.id}/ballot`, {
      picks: { 'ab:x': 1 },
    });
    clock.t += 31_000;
    const list = await call('GET', '/api/projects/local/v1/votes');
    assert.equal(list.body.votes[0].state, 'ended');
    assert.deepEqual(list.body.votes[0].tallies, { 'ab:x': 1 });
    const late = await call('POST', `/api/projects/local/v1/votes/${s.body.vote.id}/ballot`, {
      picks: { 'ab:x': 1 },
    });
    assert.equal(late.status, 409);
    assert.equal(late.body.code, 'ended');
  });

  test('it never ends early, and never on its own when everyone is done', async () => {
    const { clock, call } = rig({ timers: false });
    const s = await call('POST', '/api/projects/local/v1/votes', {
      canvas: A,
      targets: ['ab:x'],
      durationS: 60,
      expected: 1,
    });
    await call('POST', `/api/projects/local/v1/votes/${s.body.vote.id}/ballot`, {
      picks: { 'ab:x': 1 },
    });
    clock.t += 59_999;
    const got = await call('GET', `/api/projects/local/v1/votes/${s.body.vote.id}`);
    assert.equal(got.body.vote.state, 'open');
    assert.equal('tallies' in got.body.vote, false);
  });

  test('close() clears the timer', async () => {
    const { pending, call, routes } = rig();
    await call('POST', '/api/projects/local/v1/votes', { canvas: A, targets: ['ab:x'] });
    assert.equal(pending.length, 1);
    routes.close();
    assert.equal(pending.length, 0);
  });
});
