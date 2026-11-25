// "Changes" on the owner's dashboard (canvas 16, cl-account — the canvas says
// Edits; what a cell counts is changes, so that is the word).
//
// The figure comes from the cell's own tenant stats, which the hourly sweep
// already reads from `/health`: `changesByDay: [{ day, count }]` (30 UTC days,
// oldest first) and `changesWeek`. Both are ABSENT on a cell that predates
// them. Two rules carry this file:
//   - UNKNOWN IS NOT ZERO: no project reports → no tile and no chart at all;
//   - THE CELL IS UNTRUSTED: what it reports is validated and clamped before
//     it is stored, and nothing it says reaches the page as markup.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  bind,
  DAY,
  freshEnv,
  get,
  installNetwork,
  makeOperator,
  project,
  seedProject,
  signUp,
  text,
} from './admin-test-kit.mjs';
import { CHANGES_DAY_CAP, changesFromStats, changesView } from './changes.mjs';
import { MIGRATIONS } from './migrate.mjs';
import { reconcileSweep } from './worker.mjs';

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const NOW = Date.UTC(2026, 10, 25, 12);
const series = (fn) =>
  Array.from({ length: 30 }, (_, i) => ({ day: dayOf(NOW - (29 - i) * DAY), count: fn(i) }));

async function world(t) {
  const net = installNetwork(t);
  const { env, sqlite } = await freshEnv();
  const op = await makeOperator(env, sqlite);
  const jan = await signUp(env, sqlite, 'jan@kolar.studio');
  bind(env, op, jan);
  seedProject(sqlite, {
    id: 'kolar-web',
    owner: jan.id,
    name: 'Kolář web',
    trialEndsAt: Date.now() + 9 * DAY,
  });
  seedProject(sqlite, {
    id: 'plakaty',
    owner: jan.id,
    name: 'Plakáty',
    trialEndsAt: Date.now() + 9 * DAY,
  });
  return { net, env, sqlite, op, jan };
}

/** Each cell's `/health`, by project id. */
const cells = (net, byProject) =>
  net.routes.unshift([
    '/health',
    async (url) => {
      const id = /\/\/([a-z0-9-]+)\./.exec(url)?.[1];
      return Response.json({ ok: true, ...(byProject[id] ? { stats: byProject[id] } : {}) });
    },
  ]);

describe('what a cell reports is validated before anything keeps it', () => {
  test('a well-formed report is kept as it is', () => {
    const out = changesFromStats(
      { changesByDay: series((i) => i), changesWeek: 161 },
      { now: NOW }
    );
    assert.equal(out.byDay.length, 30);
    assert.deepEqual(out.byDay.at(-1), { day: dayOf(NOW), count: 29 });
    assert.equal(out.week, 161);
  });

  test('absent stays absent: no field, no object', () => {
    assert.equal(changesFromStats({ canvases: 3 }, { now: NOW }), null);
    assert.equal(changesFromStats(null, { now: NOW }), null);
    assert.equal(changesFromStats({ changesByDay: [], changesWeek: null }, { now: NOW }), null);
  });

  test('a hostile payload: everything that is not a real day with a sane count is dropped', () => {
    const hostile = {
      changesByDay: [
        { day: dayOf(NOW), count: 5 },
        { day: dayOf(NOW - DAY), count: -3 },
        { day: dayOf(NOW - 2 * DAY), count: 1e12 },
        { day: dayOf(NOW - 3 * DAY), count: 2.5 },
        { day: dayOf(NOW - 4 * DAY), count: '7' },
        { day: '<script>alert(1)</script>', count: 1 },
        { day: '2026-13-45', count: 1 },
        { day: dayOf(NOW + 3 * DAY), count: 9 },
        { day: dayOf(NOW - 400 * DAY), count: 9 },
        { day: dayOf(NOW), count: 99 },
        null,
        'x',
        { count: 4 },
        { day: dayOf(NOW - 5 * DAY), count: CHANGES_DAY_CAP },
      ],
      changesWeek: Number.MAX_SAFE_INTEGER,
    };
    const out = changesFromStats(hostile, { now: NOW });
    assert.deepEqual(out.byDay, [
      { day: dayOf(NOW - 5 * DAY), count: CHANGES_DAY_CAP },
      { day: dayOf(NOW), count: 5 },
    ]);
    assert.equal(out.week, null, 'an absurd week figure is not a figure');
    // Too long to be the contract's array at all: nothing of it is believed.
    const long = Array.from({ length: 5000 }, (_, i) => ({
      day: dayOf(NOW - (i % 30) * DAY),
      count: 1,
    }));
    assert.equal(changesFromStats({ changesByDay: long }, { now: NOW }), null);
    for (const junk of ['x', 7, { length: 3 }, [[1, 2]]]) {
      assert.equal(changesFromStats({ changesByDay: junk }, { now: NOW }), null);
    }
  });

  test('changesView: thirty days ending today, summed over projects; a stale report ages out', () => {
    const a = JSON.stringify({
      at: NOW,
      week: 10,
      byDay: [
        { day: dayOf(NOW), count: 4 },
        { day: dayOf(NOW - DAY), count: 6 },
      ],
    });
    const b = JSON.stringify({ at: NOW, week: 3, byDay: [{ day: dayOf(NOW), count: 3 }] });
    const v = changesView(
      [
        { id: 'a', name: 'A', changes: a },
        { id: 'b', name: 'B', changes: b },
        { id: 'c', name: 'C', changes: null },
      ],
      { now: NOW }
    );
    assert.equal(v.days.length, 30);
    assert.deepEqual(v.days.at(-1), { day: dayOf(NOW), count: 7 });
    assert.equal(v.days.at(-2).count, 6);
    assert.equal(v.week, 13);
    assert.deepEqual(
      v.perProject.map((p) => [p.id, p.week]),
      [
        ['a', 10],
        ['b', 3],
      ]
    );
    assert.equal(v.reporting, 2);
    assert.equal(
      changesView([{ id: 'c', changes: null }], { now: NOW }),
      null,
      'nobody reports → nothing'
    );
    assert.equal(changesView([{ id: 'x', changes: '{not json' }], { now: NOW }), null);
    // A report from long ago: its week is not "this week" any more.
    const old = changesView([{ id: 'a', name: 'A', changes: a }], { now: NOW + 40 * DAY });
    assert.equal(old, null);
  });
});

describe('the sweep stores it next to the capabilities', () => {
  test('migration v24 adds the column, and the list is still gap-free', () => {
    assert.ok(MIGRATIONS.find((m) => m.version === 24));
    assert.deepEqual(
      MIGRATIONS.map((m) => m.version),
      MIGRATIONS.map((_, i) => i + 2)
    );
  });

  test('reported → stored (sanitized); absent → the row is not touched; a silent cell keeps the last report', async (t) => {
    const { net, env, sqlite } = await world(t);
    const today = Date.now();
    cells(net, {
      'kolar-web': {
        canvases: 4,
        changesByDay: [
          { day: dayOf(today), count: 12 },
          { day: 'nope', count: 1 },
        ],
        changesWeek: 40,
      },
      plakaty: { canvases: 2 },
    });
    await reconcileSweep(env);
    const stored = JSON.parse(project(sqlite, 'kolar-web').changes);
    assert.deepEqual(stored.byDay, [{ day: dayOf(today), count: 12 }]);
    assert.equal(stored.week, 40);
    assert.ok(stored.at > 0);
    assert.equal(
      project(sqlite, 'plakaty').changes,
      null,
      'a cell that predates the field stores nothing'
    );
    net.routes.shift();
    net.routes.unshift(['/health', async () => Response.json({ state: 'asleep' })]);
    await reconcileSweep(env);
    assert.equal(JSON.parse(project(sqlite, 'kolar-web').changes).week, 40);
  });
});

describe('the dashboard', () => {
  const put = (sqlite, id, week, byDay) =>
    sqlite
      .prepare('UPDATE projects SET changes = ? WHERE id = ?')
      .run(JSON.stringify({ at: Date.now(), week, byDay }), id);

  test('no project reports → no Changes tile and no chart, at all', async (t) => {
    const { jan } = await world(t);
    const html = await (await get('/', jan)).text();
    assert.doesNotMatch(text(html), /Changes/);
    assert.doesNotMatch(html, /class="ad-bars"/);
  });

  test('the tile (this week, most in …) and the 30-day chart, summed across the owner’s projects', async (t) => {
    const { env, sqlite, jan } = await world(t);
    const eva = await signUp(env, sqlite, 'eva@other.cz');
    seedProject(sqlite, { id: 'evas', owner: eva.id, name: 'Eva’s project' });
    const today = Date.now();
    put(sqlite, 'kolar-web', 30, [
      { day: dayOf(today), count: 20 },
      { day: dayOf(today - DAY), count: 5 },
    ]);
    put(sqlite, 'plakaty', 12, [{ day: dayOf(today), count: 7 }]);
    put(sqlite, 'evas', 999, [{ day: dayOf(today), count: 999 }]);
    const res = await get('/', jan);
    const html = await res.text();
    const page = text(html);
    assert.match(page, /Changes\s+42\s+this week · most in Kolář web/);
    assert.match(page, /Changes per day/);
    assert.doesNotMatch(page, /999/, 'another owner’s project is not in the sum');
    assert.doesNotMatch(page, /\bEdits\b/);
    // Thirty bars, the last one today's 27; a text summary for a screen reader.
    const bars = [
      ...html.matchAll(/<i style="height:100%"><b style="height:([\d.]+)%"><\/b><\/i>/g),
    ];
    assert.equal(bars.length, 30);
    assert.equal(Number(bars.at(-1)[1]), 100, 'today is the tallest');
    assert.match(html, /role="img" aria-label="Changes per day over 30 days:[^"]*highest 27[^"]*"/);
    // No script, and the page's own CSP is unchanged.
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
    assert.match(res.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  });

  test('one project reports, the other does not: the figure is shown and says how many reported', async (t) => {
    const { sqlite, jan } = await world(t);
    put(sqlite, 'plakaty', 3, [{ day: dayOf(Date.now()), count: 3 }]);
    const page = text(await (await get('/', jan)).text());
    assert.match(page, /Changes\s+3\s+this week/);
    assert.match(page, /1 of 2 projects report/);
  });

  test('a cell cannot write markup onto the page through what it reports', async (t) => {
    const { net, env, jan } = await world(t);
    cells(net, {
      'kolar-web': {
        changesByDay: [
          { day: '"><img src=x onerror=alert(1)>', count: 3 },
          { day: dayOf(Date.now()), count: 2 },
        ],
        changesWeek: '<b>9</b>',
      },
    });
    await reconcileSweep(env);
    const html = await (await get('/', jan)).text();
    assert.doesNotMatch(html, /<img|onerror|<b>9/);
    assert.match(
      text(html),
      /Changes\s+2\s+this week/,
      'the week falls back to the days that were valid'
    );
  });

  test('the operator’s account page shows the same number per project', async (t) => {
    const { sqlite, op, jan } = await world(t);
    put(sqlite, 'kolar-web', 30, [{ day: dayOf(Date.now()), count: 20 }]);
    const html = await (await get(`/operator/accounts/${jan.id}`, op)).text();
    // Each project row says its week (canvas 16, cl-op-account: under the name).
    const row = /<tr[^>]*>(?:(?!<\/tr>)[\s\S])*kolar-web[\s\S]*?<\/tr>/.exec(html)[0];
    assert.match(text(row), /\b30 changes this week\b/);
    const other = /<tr[^>]*>(?:(?!<\/tr>)[\s\S])*plakaty[\s\S]*?<\/tr>/.exec(html)[0];
    assert.match(text(other), /changes not reported/, 'not reported is said, never a zero');
  });
});
