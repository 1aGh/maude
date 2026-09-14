import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { evidenceDir, own, repo } from './paths.mjs';
import { hash, ValidationPool } from './pool.mjs';

const corpus = JSON.parse(
  readFileSync(join(repo, 'scripts/dev/sync-e2e/validation-runtime-spike/dist/corpus.json'), 'utf8')
);
const evidence = [];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
async function closedPid(pid) {
  for (let i = 0; i < 100; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await delay(5);
  }
  return false;
}
test('warm parser health, complete production corpus, reused workers and bounded admission', async () => {
  const pool = new ValidationPool();
  const initially = pool.health();
  assert.equal(initially.ready, false);
  assert.equal(initially.warmed, 0);
  try {
    const start = performance.now();
    await pool.waitReady();
    const ready = pool.health();
    const warmupMs = performance.now() - start;
    assert.equal(ready.ready, true);
    assert.equal(ready.warmed, 2);
    assert.equal(new Set(ready.slots.map((s) => s.pid)).size, 2);
    const results = [];
    for (const fixture of corpus) {
      const result = await pool.validate(fixture.source);
      assert.equal(result.valid, fixture.valid);
      assert.equal(result.hash, hash(fixture.source));
      assert.equal(result.executed, false);
      assert.equal(result.validatorHash, ready.validatorHash);
      results.push({
        name: fixture.name,
        valid: result.valid,
        parseMs: result.parseMs,
        roundtripMs: result.roundtripMs,
        pid: result.pid,
      });
    }
    assert.deepEqual(
      pool.health().slots.map((s) => s.starts),
      [1, 1]
    );
    const large = 'export const data="' + 'x'.repeat(1024 * 1024) + '";';
    const a = pool.validate(large);
    const b = pool.validate(large.replace('data', 'other'));
    const busy = await pool.validate('export default 3');
    assert.equal(busy.code, 'capacity');
    assert.equal(busy.valid, false);
    const both = await Promise.all([a, b]);
    assert.equal(
      both.every((r) => r.valid),
      true
    );
    assert.equal(new Set(both.map((r) => r.pid)).size, 2);
    assert.equal((await pool.validate('x'.repeat(4 * 1024 * 1024 + 1))).code, 'source-too-large');
    assert.equal((await pool.validate('export default 1', 'bad')).code, 'hash-mismatch');
    evidence.push({
      kind: 'corpus',
      warmupMs,
      ready,
      results,
      busy,
      concurrent: both.map((r) => ({ pid: r.pid, hash: r.hash, roundtripMs: r.roundtripMs })),
    });
  } finally {
    const pids = pool
      .health()
      .slots.map((s) => s.pid)
      .filter(Boolean);
    await pool.drain();
    for (const pid of pids) assert.equal(await closedPid(pid), true);
    assert.equal(existsSync(pool.cwd), false);
  }
});
test('timeout kills/replaces only stuck slot while healthy slot serves, then crash/correlation failures recover', async () => {
  const pool = new ValidationPool({ timeoutMs: 150, workerScript: join(own, 'fault-worker.mjs') });
  try {
    await pool.waitReady();
    const initial = pool.health();
    const stuckPid = initial.slots[0].pid;
    const survivor = initial.slots[1].pid;
    const hung = pool.validate('/*__SPIKE_HANG__*/ export default 1');
    const good = await pool.validate('export default 2');
    assert.equal(good.valid, true);
    assert.equal(good.pid, survivor);
    const timeout = await hung;
    assert.equal(timeout.valid, false);
    assert.equal(timeout.code, 'validation-timeout');
    assert.equal(pool.health().ready, false);
    const stillGood = await pool.validate('export default 3');
    assert.equal(stillGood.pid, survivor);
    assert.equal(stillGood.valid, true);
    await pool.waitReady();
    assert.equal(await closedPid(stuckPid), true);
    assert.equal(pool.health().slots[1].pid, survivor);
    assert.notEqual(pool.health().slots[0].pid, stuckPid);
    const failures = [];
    for (const [marker, code] of [
      ['__SPIKE_CRASH__', 'worker-crashed'],
      ['__SPIKE_WRONG_ID__', 'invalid-worker-result'],
      ['__SPIKE_WRONG_HASH__', 'invalid-worker-result'],
    ]) {
      const before = pool.health();
      const result = await pool.validate('/*' + marker + '*/ export default 1');
      assert.equal(result.valid, false);
      assert.equal(result.code, code);
      await pool.waitReady();
      assert.notEqual(pool.health().slots[0].pid, before.slots[0].pid);
      assert.equal(pool.health().slots[1].pid, survivor);
      assert.equal((await pool.validate('export default 1')).valid, true);
      failures.push({ marker, result });
    }
    evidence.push({
      kind: 'recovery',
      initial,
      timeout,
      failures,
      final: pool.health(),
      events: pool.events,
    });
  } finally {
    await pool.drain();
  }
});
test('failed parser warmup stays unhealthy, finite retries; drain rejects active work and closes all children', async () => {
  const bad = join(own, 'bad-start-child.mjs');
  const broken = new ValidationPool({ workerScript: bad, size: 1, maxStartFailures: 2 });
  try {
    await assert.rejects(() => broken.waitReady());
    const h = broken.health();
    assert.equal(h.ready, false);
    assert.equal(h.warmed, 0);
    assert.equal(h.slots[0].state, 'failed');
    assert.equal(h.slots[0].starts, 2);
    assert.equal((await broken.validate('export default 1')).valid, false);
    evidence.push({ kind: 'bad-warmup', health: h });
  } finally {
    await broken.drain();
  }
  const pool = new ValidationPool({ workerScript: join(own, 'fault-worker.mjs') });
  await pool.waitReady();
  const pids = pool.health().slots.map((s) => s.pid);
  const pending = pool.validate('/*__SPIKE_HANG__*/ export default 1');
  await pool.drain();
  const result = await pending;
  assert.equal(result.valid, false);
  assert.equal(result.code, 'draining');
  assert.equal((await pool.validate('export default 2')).code, 'draining');
  for (const pid of pids) assert.equal(await closedPid(pid), true);
  assert.equal(pool.health().warmed, 0);
  assert.equal(existsSync(pool.cwd), false);
  evidence.push({ kind: 'drain', result, health: pool.health() });
  writeFileSync(
    join(evidenceDir, 'pool-evidence.json'),
    JSON.stringify({ node: process.version, evidence }, null, 2)
  );
});
