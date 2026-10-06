// Durability is STATE, not a log line — Phase 0 F5.
//
// The write-side refusal (F1) trades one silent failure for another unless
// somebody sees it: a hub that refuses to write is protecting a peer's history
// and none of its own. `scheduleBackups` deliberately catches, logs and keeps
// the interval running — its own docstring names the failure mode it is
// avoiding ("we had backups until March") — so the refusal recurs every six
// hours into a stream nobody tails.
//
// These tests pin the two properties that make the trade safe: the state
// reaches a caller, and it does NOT reach `/health`.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { fileTarget, scheduleBackups } from '../src/backup.mjs';
import { ensureWorkspaceId } from '../src/workspace-identity.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const dirs = [];
function freshDir() {
  const d = mkdtempSync(join(tmpdir(), 'maude-durability-'));
  dirs.push(d);
  return d;
}
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function seedDataDir(dir) {
  const db = new Database(join(dir, 'hub.db'));
  db.exec('CREATE TABLE IF NOT EXISTS documents (name TEXT PRIMARY KEY, data BLOB)');
  db.prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)').run('c', Buffer.from('x'));
  db.close();
  return dir;
}

/**
 * Wait for `onStatus` to fire once, then stop the schedule.
 *
 * KEEP THE EVENT LOOP ALIVE WHILE WAITING. `scheduleBackups` ends with
 * `timer.unref()` — correct in production, where a backup interval must never
 * be the reason a hub process refuses to exit — but it means the only thing
 * this promise is waiting on does NOT hold the loop open. With nothing else
 * pending, node drains the loop inside the 15 ms window and the test dies as
 * `cancelledByParent` / "Promise resolution is still pending but the event loop
 * has already resolved". That race was won on macOS/Node 24 and lost on
 * Linux/Node 22 — three green runs locally, three reds in CI, same commit.
 *
 * So the wait holds its own REF'd timer. The fix belongs here and not in
 * `backup.mjs`: a test must not depend on ambient loop activity it did not ask
 * for, and un-unref'ing the production timer to make a test pass would trade a
 * flaky test for a hub that will not shut down.
 */
function awaitStatuses({ dataDir, target, count = 1 }) {
  return new Promise((resolve, reject) => {
    const seen = [];
    // Ref'd on purpose (no .unref()) — this is the handle that keeps us alive.
    const keepAlive = setInterval(() => {}, 1000);
    const done = (fn, v) => {
      clearInterval(keepAlive);
      fn(v);
    };
    const bail = setTimeout(
      () => done(reject, new Error(`awaitStatuses: got ${seen.length} of ${count}`)),
      10_000
    );
    const stop = scheduleBackups({
      dataDir,
      target,
      intervalMs: 15,
      log: { log() {}, error() {} },
      onStatus: (s) => {
        seen.push(s);
        if (seen.length < count) return;
        stop();
        clearTimeout(bail);
        done(resolve, seen);
      },
    });
  });
}

/** Wait for `onStatus` to fire once, then stop the schedule. */
async function firstStatus({ dataDir, target }) {
  return (await awaitStatuses({ dataDir, target, count: 1 }))[0];
}

test('/health never carries durability — degradation is not a liveness signal', () => {
  // The obvious move is to flip `/health` unhealthy: the HEALTHCHECK is already
  // in the Dockerfile and needs no UI. It is wrong twice over. Under compose
  // restart policies or ECS health-based replacement it kills or cycles a hub
  // that is up and serving correctly, trading no-durability for an outage; and
  // `/health` is unauthenticated, so naming the conflicting workspace there
  // would leak it to anyone who can reach the port.
  //
  // A source-level pin, because this is a trap a later edit walks into while
  // trying to be helpful.
  const src = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const at = src.indexOf("url === '/health'");
  assert.ok(at > 0, 'the /health handler moved — re-point this pin');
  // The handler is short; a generous window still ends well before /admin.
  const body = src.slice(at, at + 2000);
  assert.ok(
    !/durability/.test(body),
    'durability reached /health: degradation is a report, not a liveness signal'
  );
});

test('a healthy tick reports ok with the generation it wrote', async () => {
  const target = fileTarget(`file://${freshDir()}`);
  const s = await firstStatus({ dataDir: seedDataDir(freshDir()), target });
  assert.equal(s.state, 'ok');
  assert.match(s.generation, /^backups\//);
});

test('an identity conflict is reported as STATE, naming the other workspace', async () => {
  // The assertion that makes the F1 refusal safe to ship. Without it the hub
  // silently stops having backups.
  const bucket = freshDir();
  const target = fileTarget(`file://${bucket}`);
  const hubA = seedDataDir(freshDir());
  await firstStatus({ dataDir: hubA, target });

  const s = await firstStatus({ dataDir: seedDataDir(freshDir()), target });
  assert.equal(s.state, 'identity-conflict');
  assert.equal(s.conflictWith, ensureWorkspaceId(hubA));
  assert.match(s.message, /another workspace/);
});

test('the schedule keeps running after a refusal rather than wedging', async () => {
  // `scheduleBackups` catches by design: "a network error must not silently end
  // all future backups". A refusal must not become the exception to that, or a
  // transient conflict would permanently disable durability.
  const bucket = freshDir();
  const target = fileTarget(`file://${bucket}`);
  await firstStatus({ dataDir: seedDataDir(freshDir()), target });

  // Through the shared helper. This wait was hand-rolled and carried the SAME
  // unref'd-timer bug — which is exactly why fixing only `firstStatus` left this
  // one test red for a second CI round. Two copies of a wait is two chances to
  // get it wrong; there is one now.
  const seen = (await awaitStatuses({ dataDir: seedDataDir(freshDir()), target, count: 2 })).map(
    (s) => s.state
  );
  assert.deepEqual(seen, ['identity-conflict', 'identity-conflict']);
});

// F3 S17 on the cloud cell (2026-09-24): a cell's disk goes with the container,
// and a graceful stop (platform migration, sleep after inactivity) came back
// from the previous generation — everything written since was gone.
test('the final generation on shutdown carries what was written after the last tick', async () => {
  const bucket = freshDir();
  const target = fileTarget(`file://${bucket}`);
  const dataDir = seedDataDir(freshDir());
  // A schedule whose interval never fires within the test.
  const stop = scheduleBackups({
    dataDir,
    target,
    intervalMs: 3_600_000,
    log: { log() {}, error() {} },
  });
  const db = new Database(join(dataDir, 'hub.db'));
  db.prepare('INSERT OR REPLACE INTO documents VALUES (?, ?)').run(
    'late',
    Buffer.from('written late')
  );
  db.close();
  const r = await stop.final();
  assert.ok(r, 'a final generation was written');
  const { restoreLatest } = await import('../src/backup.mjs');
  const dest = freshDir();
  await restoreLatest({ target, destDir: dest });
  const restored = new Database(join(dest, 'hub.db'), { readonly: true });
  const row = restored.prepare('SELECT data FROM documents WHERE name = ?').get('late');
  restored.close();
  assert.equal(row?.data?.toString(), 'written late');
});

test('the final generation waits for a tick already running, and a schedule without a target has none', async () => {
  const target = fileTarget(`file://${freshDir()}`);
  const statuses = [];
  const stop = scheduleBackups({
    dataDir: seedDataDir(freshDir()),
    target,
    intervalMs: 5,
    log: { log() {}, error() {} },
    onStatus: (s) => statuses.push(s),
  });
  await new Promise((r) => setTimeout(r, 30));
  const r = await stop.final();
  assert.ok(r?.prefix, 'the final generation ran after the one in flight');
  assert.ok(statuses.every((s) => s.state === 'ok'));
  const none = scheduleBackups({ dataDir: freshDir(), target: null, intervalMs: 0 });
  assert.equal(await none.final(), null);
});
