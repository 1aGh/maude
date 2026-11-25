// "Changes" on a project that saves through accepted revisions (DDR-241).
//
// Found end to end (cloud harness C6, 2026-11-25): two desktops edited a canvas,
// the edits synced both ways and landed in the cell — and the cell reported
// changesWeek 0. In accepted revisions a canvas edit is an ACTION in the
// project store (project-store.sqlite, or the cell's Durable Object), not a row
// in the file journal, so a count that reads only the journal counts nothing
// for the normal way a canvas is edited.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  CHANGE_STATS_TTL_MS,
  createAcceptedChanges,
  mergeChangeStats,
} from '../src/change-stats.mjs';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 25, 15, 30);

/** A store with just the three methods the counter may call — and a call log. */
function fakeStore(actions, { mode = 'transactions' } = {}) {
  const calls = [];
  const list = () => actions.slice().sort((a, b) => a.revision - b.revision);
  return {
    calls,
    actions,
    async state() {
      calls.push('state');
      return { mode, revision: list().at(-1)?.revision ?? 0 };
    },
    async history({ before = null, limit = 50 } = {}) {
      calls.push(`history:${before ?? ''}`);
      return list()
        .filter((a) => !before || a.revision < before)
        .reverse()
        .slice(0, Math.min(limit, 200));
    },
    async revisions({ after = 0, limit = 200 } = {}) {
      calls.push(`revisions:${after}`);
      return list()
        .filter((a) => a.revision > after)
        .slice(0, Math.min(limit, 1000));
    },
  };
}
let rev = 0;
const act = (at, over = {}) => ({
  revision: ++rev,
  actor: 'marek@example.test',
  kind: 'edit',
  origin: { deviceId: 'd1', client: 'desktop' },
  committedAt: at,
  effects: [{ entry: 'ui/welcome.tsx', lane: 'body', op: 'put' }],
  ...over,
});

test('an accepted canvas edit is a change, on the day it was committed', async () => {
  const store = fakeStore([
    act(NOW - 20 * DAY),
    act(NOW - 6 * DAY),
    act(NOW - DAY),
    act(NOW),
    act(NOW),
  ]);
  const s = await createAcceptedChanges(store).stats({ now: NOW });
  assert.equal(s.changesByDay.length, 30);
  assert.deepEqual(s.changesByDay[29], { day: '2026-11-25', count: 2 });
  assert.equal(s.changesByDay[28].count, 1);
  assert.equal(s.changesByDay[9].count, 1);
  assert.equal(s.changesWeek, 4);
});

test('the server’s own actions, names and comments are not changes; undo and AI edits are', async () => {
  const store = fakeStore([
    act(NOW),
    act(NOW, { kind: 'undo' }),
    act(NOW, { origin: { client: 'desktop', runId: 'run_1' } }),
    act(NOW, { kind: 'trash' }),
    // not people's changes to a canvas
    act(NOW, { actor: 'maude-migration', kind: 'migration.import', origin: { client: 'hub' } }),
    act(NOW, { origin: { deviceId: 'hub', sessionId: 'migration', client: 'hub' } }),
    act(NOW, { kind: 'name', effects: [] }),
    act(NOW, { kind: 'comment' }),
    act(NOW, { effects: [] }),
    act(NOW - 31 * DAY),
    act(NOW + 2 * DAY),
  ]);
  assert.equal((await createAcceptedChanges(store).stats({ now: NOW })).changesWeek, 4);
});

test('a project that does not save through accepted revisions contributes nothing — absent, not zero', async () => {
  const store = fakeStore([], { mode: 'legacy' });
  assert.equal(await createAcceptedChanges(store).stats({ now: NOW }), null);
  assert.equal(await createAcceptedChanges(null).stats({ now: NOW }), null);
  const broken = { state: async () => Promise.reject(new Error('store unreachable')) };
  assert.equal(await createAcceptedChanges(broken).stats({ now: NOW }), null, 'cannot tell ≠ zero');
});

test('cheap: one fill, then a minute of nothing, then only what is new', async () => {
  const store = fakeStore([act(NOW - DAY), act(NOW)]);
  const counter = createAcceptedChanges(store);
  await counter.stats({ now: NOW });
  const afterFill = store.calls.length;
  assert.ok(store.calls.some((c) => c.startsWith('history:')));
  await counter.stats({ now: NOW + 1000 });
  await counter.stats({ now: NOW + CHANGE_STATS_TTL_MS - 1 });
  assert.equal(store.calls.length, afterFill, 'cached for a minute');

  // nothing new: one cheap state() and no page
  await counter.stats({ now: NOW + CHANGE_STATS_TTL_MS + 1 });
  assert.deepEqual(store.calls.slice(afterFill), ['state']);

  store.actions.push(act(NOW + 2 * CHANGE_STATS_TTL_MS));
  const head = store.actions.at(-2).revision;
  const s = await counter.stats({ now: NOW + 2 * CHANGE_STATS_TTL_MS + 2 });
  assert.equal(s.changesWeek, 3);
  assert.deepEqual(store.calls.slice(-2), ['state', `revisions:${head}`], 'only the new revisions');
});

test('bounded: the first fill stops at the window, and at a page cap on a huge history', async () => {
  const old = Array.from({ length: 450 }, () => act(NOW - 40 * DAY));
  const store = fakeStore([...old, act(NOW)]);
  await createAcceptedChanges(store).stats({ now: NOW });
  assert.equal(
    store.calls.filter((c) => c.startsWith('history:')).length,
    1,
    'stopped at the window'
  );

  const busy = fakeStore(Array.from({ length: 2000 }, () => act(NOW)));
  const s = await createAcceptedChanges(busy, { maxPages: 3 }).stats({ now: NOW });
  assert.equal(busy.calls.filter((c) => c.startsWith('history:')).length, 3);
  assert.equal(s.changesWeek, 600, 'what it read, never an invented number');
});

test('two concurrent readers share one fill', async () => {
  const store = fakeStore([act(NOW)]);
  const counter = createAcceptedChanges(store);
  const [a, b] = await Promise.all([counter.stats({ now: NOW }), counter.stats({ now: NOW })]);
  assert.equal(a, b);
  assert.equal(store.calls.filter((c) => c === 'state').length, 1);
});

test('journal and accepted counts add up per day; either alone stands; neither is absent', () => {
  const days = (n) =>
    Array.from({ length: 30 }, (_, i) => ({ day: `d${i}`, count: i === 29 ? n : 0 }));
  const j = { changesByDay: days(2), changesWeek: 2 };
  const a = { changesByDay: days(5), changesWeek: 5 };
  const both = mergeChangeStats(j, a);
  assert.equal(both.changesWeek, 7);
  assert.equal(both.changesByDay[29].count, 7);
  assert.equal(both.changesByDay.length, 30);
  assert.equal(mergeChangeStats(j, null), j);
  assert.equal(mergeChangeStats(null, a), a);
  assert.equal(mergeChangeStats(null, null), null);
});
