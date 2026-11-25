// "Changes" — a truthful number for the Cloud dashboard and the team-server
// Overview (change-stats.mjs). The contract another package reads:
//
//   stats.changesByDay  [{ day: 'YYYY-MM-DD' (UTC), count }] — the last 30 UTC
//                       days, oldest first, zero days included
//   stats.changesWeek   the last 7 of those, summed
//
// One file-journal row = one change, by the row's own timestamp: a person's
// accepted write to a canvas, its board or its meta file. Never the server's
// own housekeeping. Absent — not zero — when there is no journal.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { after, test } from 'node:test';

import { buildOverview } from '../src/admin-people.mjs';
import { closeAudit, recordAudit } from '../src/audit-log.mjs';
import {
  _resetChangeStats,
  CHANGE_DAYS,
  CHANGE_STATS_TTL_MS,
  changeStats,
  withChangeStats,
} from '../src/change-stats.mjs';
import { closeJournal, journalDbPath, openJournal } from '../src/journal.mjs';
import { closeUsers } from '../src/users.mjs';
import { rm, tmpDir } from './_acl-docs-fixture.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const DAY = 86_400_000;
// A fixed "now": 2026-11-25 15:30 UTC.
const NOW = Date.UTC(2026, 10, 25, 15, 30);

const dirs = [];
after(() => {
  for (const d of dirs) {
    closeJournal(d);
    closeAudit(d);
    closeUsers(d);
    rm(d);
  }
});

/** A journal with rows written straight into its table: [path, source, at_ms, deleted?]. */
function journalWith(rows) {
  const dataDir = tmpDir('maude-changes-');
  dirs.push(dataDir);
  const journal = openJournal(dataDir);
  const db = new Database(journalDbPath(dataDir));
  const ins = db.prepare(
    'INSERT INTO file_journal (path, sha256, size, mtime_ms, class, deleted, source, at_ms) VALUES (?, ?, 1, ?, ?, ?, ?, ?)'
  );
  for (const [path, source, at, deleted = 0] of rows) {
    ins.run(path, deleted ? null : 'ab', at, 'canvas-owned', deleted, source, at);
  }
  db.close();
  _resetChangeStats();
  return { journal, dataDir };
}

test('thirty UTC days, oldest first, zero days included; the week is the last seven', () => {
  const { journal } = journalWith([
    ['ui/Home.tsx', 'peer-put', NOW],
    ['ui/Home.tsx', 'studio-report', NOW - 60_000],
    ['ui/Home.meta.json', 'peer-put', NOW - 1 * DAY],
    ['ui-home.annotations.json', 'studio-report', NOW - 6 * DAY],
    ['ui/Old.tsx', 'peer-put', NOW - 7 * DAY],
    ['ui/Older.tsx', 'peer-put', NOW - 29 * DAY],
    ['ui/Ancient.tsx', 'peer-put', NOW - 30 * DAY],
    ['ui/Tomorrow.tsx', 'peer-put', NOW + DAY],
  ]);
  const s = changeStats(journal, { now: NOW });
  assert.equal(CHANGE_DAYS, 30);
  assert.equal(s.changesByDay.length, 30);
  assert.deepEqual(Object.keys(s.changesByDay[0]), ['day', 'count']);
  assert.equal(s.changesByDay[0].day, '2026-10-27');
  assert.equal(s.changesByDay[29].day, '2026-11-25');
  assert.deepEqual(s.changesByDay[29], { day: '2026-11-25', count: 2 });
  assert.deepEqual(s.changesByDay[28], { day: '2026-11-24', count: 1 });
  assert.deepEqual(
    s.changesByDay[27],
    { day: '2026-11-23', count: 0 },
    'a quiet day is a zero, not a gap'
  );
  assert.equal(s.changesByDay[23].count, 1);
  assert.equal(s.changesByDay[22].count, 1, 'seven days ago: in the month, not in the week');
  assert.equal(s.changesByDay[0].count, 1);
  assert.equal(s.changesWeek, 4);
  assert.equal(
    s.changesByDay.reduce((n, d) => n + d.count, 0),
    6,
    'nothing older than thirty days, nothing from the future'
  );
  assert.ok(
    s.changesByDay.every((d) => Number.isInteger(d.count) && /^\d{4}-\d\d-\d\d$/.test(d.day))
  );
});

test("a UTC day, not the server's local one: 23:59 and 00:00 fall on different days", () => {
  const midnight = Date.UTC(2026, 10, 25);
  const { journal } = journalWith([
    ['ui/A.tsx', 'peer-put', midnight - 1],
    ['ui/A.tsx', 'peer-put', midnight],
  ]);
  const s = changeStats(journal, { now: NOW });
  assert.equal(s.changesByDay[28].count, 1);
  assert.equal(s.changesByDay[29].count, 1);
});

test("only what people did to a canvas, its board or its meta — never the server's housekeeping", () => {
  const { journal } = journalWith([
    // people
    ['ui/Home.tsx', 'peer-put', NOW],
    ['ui/Home.tsx', 'studio-report', NOW],
    ['ui/Home.meta.json', 'peer-put', NOW],
    ['ui-home.annotations.json', 'peer-put', NOW],
    ['ui-home.annotations.svg', 'peer-put', NOW],
    ['ui/Gone.tsx', 'owner-delete', NOW, 1],
    ['ui/Purged.tsx', 'owner-purge', NOW, 1],
    ['ui/Adopted.tsx', 'owner-adopt', NOW],
    // the server
    ['ui/Home.tsx', 'walk-import', NOW],
    ['ui/Home.tsx', 'boot-scan', NOW],
    ['ui/Home.tsx', 'hydrate', NOW],
    ['ui/Home.tsx', 'tail-replay', NOW],
    ['ui/Home.tsx', 'disk-lost', NOW],
    ['ui/Home.tsx', 'flat-twin-quarantine', NOW],
    ['ui/Home.tsx', 'something-new', NOW],
    // not a canvas, board or meta file
    ['assets/photo.png', 'peer-put', NOW],
    ['config.json', 'peer-put', NOW],
    ['system/brand/tokens.css', 'peer-put', NOW],
  ]);
  assert.equal(changeStats(journal, { now: NOW }).changesWeek, 8);
});

test('no journal: the fields are ABSENT, never zeros', () => {
  assert.equal(changeStats(null, { now: NOW }), null);
  assert.deepEqual(withChangeStats({ canvases: 3 }, null), { canvases: 3 });
  assert.equal(withChangeStats(null, null), null);
  const { journal } = journalWith([]);
  const merged = withChangeStats({ canvases: 3 }, journal, { now: NOW });
  assert.equal(merged.canvases, 3);
  assert.equal(merged.changesWeek, 0, 'a journal with nothing in it IS a zero');
  assert.equal(merged.changesByDay.length, 30);
});

test('cached for a minute, and nothing in it names a person, a path or a source', () => {
  const { journal, dataDir } = journalWith([['ui/Home.tsx', 'peer-put', NOW]]);
  const first = changeStats(journal, { now: NOW });
  const db = new Database(journalDbPath(dataDir));
  db.prepare(
    "INSERT INTO file_journal (path, deleted, source, at_ms) VALUES ('ui/Secret Client.tsx', 0, 'peer-put', ?)"
  ).run(NOW);
  db.close();
  assert.equal(
    changeStats(journal, { now: NOW + CHANGE_STATS_TTL_MS - 1 }),
    first,
    'the same answer'
  );
  const later = changeStats(journal, { now: NOW + CHANGE_STATS_TTL_MS + 1 });
  assert.equal(later.changesWeek, 2);
  assert.equal(CHANGE_STATS_TTL_MS, 60_000);
  assert.doesNotMatch(JSON.stringify(later), /Secret|peer-put|\.tsx|@/);
  assert.deepEqual(Object.keys(later).sort(), ['changesByDay', 'changesWeek']);
});

test('the team-server Overview uses the same number — and says nothing when there is no journal', () => {
  const { journal, dataDir } = journalWith([
    ['ui/Home.tsx', 'peer-put', NOW],
    ['ui/Home.tsx', 'peer-put', NOW - 2 * DAY],
    ['ui/Home.tsx', 'peer-put', NOW - 20 * DAY],
  ]);
  // Sign-ins and invites are activity, not changes: they must not move the tile.
  for (let i = 0; i < 5; i++) recordAudit(dataDir, { kind: 'login', actor: 'a@x.test', at: NOW });
  const ctx = { peers: new Map(), now: NOW, version: '0.0.0', env: {} };
  const o = buildOverview(dataDir, { ...ctx, changes: changeStats(journal, { now: NOW }) });
  assert.equal(o.counts.changesThisWeek, 2);
  assert.equal(o.changesByDay.length, 30);
  assert.equal(o.counts.eventsThisWeek, 5);

  const none = buildOverview(dataDir, { ...ctx, changes: null });
  assert.equal('changesThisWeek' in none.counts, false);
  assert.equal('changesByDay' in none, false);
  assert.equal(none.counts.eventsThisWeek, 5);
});
