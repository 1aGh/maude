import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { proposal } from './fixture-proposal.mjs';
import { objectFixture } from './http-fixture.mjs';
import { ObjectJournal, sha } from './journal.mjs';
import { bucketFor } from './snapshot-index.mjs';

const own = dirname(fileURLToPath(import.meta.url));
const run =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-snapshot-proof-'));
mkdirSync(run, { recursive: true });
const evidence = { node: process.version, cases: [] };
async function setup(t, project, options = {}) {
  const fixture = await objectFixture(join(run, project, 'objects'));
  const config = { cfg: fixture.cfg, prefix: 'snapshot-proof', project, ...options };
  const journal = new ObjectJournal(config);
  await journal.initialize();
  t.after(async () => {
    await fixture.close();
    assert.deepEqual(fixture.violations, []);
  });
  return { fixture, config, journal };
}
async function append(journal, tx, value = tx) {
  const state = await journal.read();
  const raw = proposal(journal.project, tx, {
    revision: state.head.revision,
    manifest: state.head.manifest,
    epoch: state.head.epoch,
    value,
  });
  const result = await journal.append('actor', raw);
  assert.equal(result.status, 'accepted', JSON.stringify(result));
  return { raw, result };
}
after(() => {
  evidence.sourceHashes = Object.fromEntries(
    readdirSync(own)
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => [name, sha(readFileSync(join(own, name)))])
  );
  writeFileSync(join(run, 'snapshot-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`Snapshot evidence: ${run}`);
});

test('multiple snapshots preserve old receipts/history while cold and warm reads stay bounded', async (t) => {
  const { journal, config, fixture } = await setup(t, 'bounded', { maxEntries: 4 });
  const records = [];
  for (let i = 0; i < 12; i++) {
    records.push(await append(journal, `tx-${i}`, `Value ${i}`));
    if (i % 3 === 2) assert.equal((await journal.snapshot()).status, 'snapshot');
  }
  const rejectedRaw = proposal('bounded', 'rejected');
  const rejected = await journal.append('actor', rejectedRaw);
  assert.equal(rejected.code, 'base-conflict');
  assert.equal((await journal.snapshot()).sequence, 13);
  const cold = new ObjectJournal(config);
  let start = fixture.requests.length;
  const state = await cold.read({ materialize: false });
  const coldGets = fixture.requests.slice(start);
  assert.equal(coldGets.length, 2, 'only mutable head and snapshot metadata');
  assert.equal(state.head.sequence, 13);
  assert.equal(state.head.revision, 12);
  assert.equal(state.entries.length, 0);
  assert.equal(state.snapshot.resultCount, 13);
  assert.equal(await cold.documentValue(state, '["doc-1",1]'), 'Value 11');
  cold.clearCache();
  start = fixture.requests.length;
  assert.deepEqual(await cold.result('actor', 'tx-0'), records[0].result);
  const receiptGets = fixture.requests.slice(start);
  assert.equal(receiptGets.length, 3, 'cold result lookup adds exactly its one receipt page');
  assert.deepEqual(await cold.append('actor', records[0].raw), records[0].result);
  assert.equal((await cold.append('actor', `${records[0].raw}\n`)).code, 'transaction-id-reused');
  assert.deepEqual(await cold.append('actor', rejectedRaw), rejected);
  // Warm the specific receipt bucket without manufacturing an accepted action.
  await cold.result('actor', 'warm-next');
  const raw = proposal('bounded', 'warm-next', {
    revision: 12,
    manifest: state.head.manifest,
    value: 'Warm value',
  });
  start = fixture.requests.length;
  const accepted = await cold.append('actor', raw);
  const warmRequests = fixture.requests.slice(start);
  assert.equal(accepted.revision, 13);
  assert.deepEqual(
    warmRequests.map((r) => r.method),
    ['GET', 'PUT', 'PUT']
  );
  assert.ok(cold.cacheSize <= cold.cacheLimit);
  let cursor = null;
  const history = [];
  do {
    const page = await cold.historyPage({ cursor, limit: 3 });
    assert.ok(page.entries.length <= 3);
    history.push(...page.entries);
    cursor = page.next;
    if (cursor) {
      const beforeBad = fixture.requests.length;
      await assert.rejects(
        cold.historyPage({ cursor: `${cursor.slice(0, -1)}${cursor.endsWith('a') ? 'b' : 'a'}` }),
        /cursor/
      );
      assert.equal(fixture.requests.length, beforeBad, 'forged cursor cannot read orphan objects');
      await assert.rejects(
        new ObjectJournal(config).historyPage({ cursor }),
        /expired history cursor/
      );
    }
  } while (cursor);
  assert.equal(history.length, 14);
  assert.deepEqual(
    history.map((entry) => entry.sequence),
    Array.from({ length: 14 }, (_, i) => 14 - i)
  );
  assert.equal(history.filter((entry) => entry.value.result.status === 'accepted').length, 13);
  evidence.cases.push({
    name: 'bounded',
    totalEntries: 14,
    coldGets,
    receiptGets,
    warmRequests,
    snapshotResultCount: state.snapshot.resultCount,
    cacheBytes: cold.cacheSize,
    historyEntries: history.length,
  });
});

test('stale snapshot cannot overwrite concurrent action; later snapshot preserves both', async (t) => {
  const { journal, config } = await setup(t, 'race');
  await append(journal, 'first');
  let reached, release;
  const paused = new Promise((resolve) => {
    reached = resolve;
  });
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const compactor = new ObjectJournal({
    ...config,
    checkpoint: async (stage) => {
      if (stage === 'after-snapshot') {
        reached();
        await waiting;
      }
    },
  });
  const pending = compactor.snapshot();
  await paused;
  const second = await append(journal, 'second');
  release();
  assert.equal((await pending).code, 'snapshot-unresolved');
  const prior = await journal.read();
  assert.equal(prior.head.revision, 2);
  assert.equal(prior.head.snapshot, null);
  const published = await journal.snapshot();
  const cold = new ObjectJournal(config);
  assert.deepEqual(await cold.result('actor', 'second'), second.result);
  assert.equal((await cold.read()).documents.get('["doc-1",1]'), 'second');
  evidence.cases.push({ name: 'concurrent-snapshot', published, head: (await cold.read()).head });
});

test('snapshot quota, missing/corrupt snapshot or receipt page and lost pointer ACK fail safely', async (t) => {
  const { journal, config, fixture } = await setup(t, 'faults');
  const first = await append(journal, 'first');
  fixture.faults.push({ method: 'PUT', suffix: '', phase: 'before', effect: 507 });
  await assert.rejects(journal.snapshot(), (error) => error.httpStatus === 507);
  assert.equal((await journal.read()).head.snapshot, null);
  fixture.faults.push({ method: 'PUT', suffix: '/head', phase: 'after', effect: 'drop' });
  const published = await journal.snapshot();
  assert.equal(published.status, 'snapshot');
  const key = journal.immutableKey('snapshots', published.hash),
    original = fixture.read(key).body;
  fixture.write(key, Buffer.from('corrupt'));
  await assert.rejects(new ObjectJournal(config).read(), /digest mismatch/);
  fixture.write(key, original);
  const snapshot = JSON.parse(original);
  const bucket = bucketFor('["actor","first"]');
  const pageKey = journal.immutableKey('indexes', snapshot.pages[bucket]);
  const page = fixture.read(pageKey).body;
  fixture.write(pageKey, Buffer.from('corrupt'));
  await assert.rejects(new ObjectJournal(config).append('actor', first.raw), /digest mismatch/);
  fixture.write(pageKey, page);
  rmSync(join(run, 'faults', 'objects', sha(key)));
  await assert.rejects(new ObjectJournal(config).read(), /referenced entry missing/);
  fixture.write(key, original);
  rmSync(join(run, 'faults', 'objects', sha(pageKey)));
  await assert.rejects(
    new ObjectJournal(config).result('actor', 'first'),
    /referenced entry missing/
  );
  fixture.write(pageKey, page);
  assert.deepEqual(await new ObjectJournal(config).append('actor', first.raw), first.result);
  evidence.cases.push({
    name: 'snapshot-integrity',
    published,
    checks: [
      '507',
      'lost-pointer-ACK',
      'corrupt-snapshot',
      'corrupt-index',
      'missing-snapshot',
      'missing-index',
    ],
  });
});

test('bounded LRU eviction changes I/O, not receipts, and an old owner cannot publish a snapshot', async (t) => {
  const { journal, config } = await setup(t, 'cache', { cacheBytes: 2048, maxEntries: 4 });
  const records = [];
  for (let i = 0; i < 6; i++) {
    records.push(await append(journal, `item-${i}`, 'x'.repeat(1000)));
    assert.ok(journal.cacheSize <= 2048);
    if (i % 2 === 1) assert.equal((await journal.snapshot()).status, 'snapshot');
  }
  for (const record of records) {
    assert.deepEqual(await journal.append('actor', record.raw), record.result);
    assert.ok(journal.cacheSize <= 2048);
  }
  await journal.advanceEpoch();
  assert.equal((await journal.snapshot()).code, 'owner-fenced');
  const current = new ObjectJournal({ ...config, ownerEpoch: 2 });
  assert.equal((await current.snapshot()).status, 'snapshot');
  assert.deepEqual(await current.append('actor', records[0].raw), records[0].result);
  evidence.cases.push({
    name: 'cache-and-epoch',
    cacheBytes: journal.cacheSize,
    head: (await current.read()).head,
  });
});

async function message(child) {
  const [result] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  assert.equal(result.error, undefined, result.error);
  return result;
}
test('source bytes exceeding the old inline snapshot cap publish through immutable document pages', async (t) => {
  const { journal, fixture } = await setup(t, 'large-snapshot');
  for (let i = 0; i < 16; i++) {
    const { head } = await journal.read();
    const value = JSON.parse(
      proposal('large-snapshot', `document-${i}`, {
        revision: head.revision,
        manifest: head.manifest,
        value: 'z'.repeat(65536),
      })
    );
    value.action.operations[0].documentId = `doc-${i}`;
    value.writes[0].documentId = `doc-${i}`;
    assert.equal((await journal.append('actor', JSON.stringify(value))).status, 'accepted');
  }
  const before = await journal.read();
  const count = fixture.requests.length;
  assert.equal((await journal.snapshot()).status, 'snapshot');
  const writes = fixture.requests.slice(count).filter((r) => r.method === 'PUT');
  assert.ok(writes.every((r) => r.bytes <= 1024 * 1024));
  assert.equal(
    writes.filter((r) => r.key.includes('/documents/')).length,
    1,
    'equal bodies share one immutable object within this project'
  );
  const after = await journal.read();
  assert.deepEqual({ ...after.head, snapshot: before.head.snapshot }, before.head);
  assert.equal(after.documents.size, 16);
  assert.equal(after.snapshot.documentCount, 16);
  evidence.cases.push({
    name: 'snapshot-size-bound',
    documents: 16,
    textBytesEach: 65536,
    snapshotPublished: true,
    revisionPreserved: after.head.revision,
  });
});
test('real SIGKILL before/after snapshot objects and after pointer publication restores exact state', async (t) => {
  for (const stage of ['before-snapshot', 'after-snapshot', 'after-snapshot-head']) {
    await t.test(stage, async (sub) => {
      const project = `kill-${stage}`;
      const { journal, config } = await setup(sub, project);
      const records = [await append(journal, 'one'), await append(journal, 'two')];
      const old = join(run, project, 'old-owner');
      mkdirSync(old);
      const child = fork(join(own, 'owner-child.mjs'), [], {
        cwd: old,
        env: {},
        execArgv: [],
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      sub.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      assert.equal((await message(child)).ready, true);
      const stopped = message(child);
      child.send({ ...config, operation: 'snapshot', stopAt: stage });
      assert.equal((await stopped).stage, stage);
      assert.equal(existsSync(join(old, 'ack.json')), false);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      const [code, signal] = await exited;
      assert.equal(code, null);
      assert.equal(signal, 'SIGKILL');
      rmSync(old, { recursive: true });
      const cold = new ObjectJournal(config);
      const state = await cold.read();
      assert.equal(state.head.revision, 2);
      assert.equal(state.head.sequence, 2);
      assert.equal(!!state.head.snapshot, stage === 'after-snapshot-head');
      assert.equal(state.documents.get('["doc-1",1]'), 'two');
      for (const record of records)
        assert.deepEqual(await cold.append('actor', record.raw), record.result);
      const published = await cold.snapshot();
      assert.equal(published.status, 'snapshot');
      const fresh = join(run, project, 'new-renderer');
      mkdirSync(fresh);
      writeFileSync(
        join(fresh, 'doc-1.txt'),
        (await new ObjectJournal(config).read()).documents.get('["doc-1",1]')
      );
      assert.equal(readFileSync(join(fresh, 'doc-1.txt'), 'utf8'), 'two');
      evidence.cases.push({
        name: 'SIGKILL-snapshot',
        stage,
        pid: child.pid,
        signal,
        oldDiskRemoved: !existsSync(old),
        published,
      });
    });
  }
});
