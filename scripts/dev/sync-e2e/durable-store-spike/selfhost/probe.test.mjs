import assert from 'node:assert/strict';
import { fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dependencyVersion, MAX_PAYLOAD_BYTES, Store } from './sqlite-store.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const artifacts =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-sqlite-proof-'));
mkdirSync(artifacts, { recursive: true });
const evidence = {
  node: process.version,
  betterSqlite3: dependencyVersion,
  cases: [],
  benchmarks: [],
};
const payload = (content = 'accepted source') =>
  Buffer.from(JSON.stringify({ files: [{ path: 'ui/a.tsx', content }] }));
const operation = (extra = {}) => ({
  project: 'project-a',
  actor: 'actor-a',
  owner: 'coordinator-a',
  epoch: 1,
  txid: 'action-1',
  base: 0,
  payload: payload(),
  ...extra,
});
function seeded(name, options) {
  const directory = join(artifacts, name, 'durable');
  const store = new Store(directory, options);
  store.acquire('project-a', 'coordinator-a');
  return { directory, store };
}
async function killAt(directory, stage, op) {
  const child = spawn(
    process.execPath,
    [
      join(root, 'crash-child.mjs'),
      directory,
      stage,
      JSON.stringify({ ...op, payload: op.payload.toString() }),
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'ignore', 'pipe'] }
  );
  const exited = once(child, 'exit');
  let stdout = '',
    stderr = '',
    markers = '';
  child.stdout.on('data', (bytes) => (stdout += bytes));
  child.stderr.on('data', (bytes) => (stderr += bytes));
  const reached = new Promise((resolve, reject) => {
    child.stdio[4].on('data', (bytes) => {
      markers += bytes;
      if (markers.includes(`"checkpoint":"${stage}"`)) resolve();
    });
    child.on('exit', (code, signal) =>
      reject(new Error(`Exited before marker: ${code}/${signal}: ${stderr}`))
    );
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 10000);
  try {
    await reached;
    child.kill('SIGKILL');
    const [code, signal] = await exited;
    assert.equal(signal, 'SIGKILL');
    return {
      stage,
      pid: child.pid,
      code,
      signal,
      markers: markers.trim().split('\n').map(JSON.parse),
      stdout,
      stderr,
    };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
  }
}
for (const stage of [
  'after-action',
  'after-result',
  'before-commit',
  'after-commit',
  'after-ack',
]) {
  test(`SIGKILL at ${stage}: action/result/head are atomic and retry produces one revision`, async () => {
    const { directory, store } = seeded(`kill-${stage}`);
    store.close();
    const killed = await killAt(directory, stage, operation());
    const reopened = new Store(directory);
    try {
      const expected = ['after-commit', 'after-ack'].includes(stage) ? 1 : 0;
      assert.equal(reopened.head('project-a').head, expected);
      assert.equal(reopened.replay('project-a').records.length, expected);
      assert.equal(reopened.result('project-a', 'actor-a', 'action-1') === null, expected === 0);
      assert.equal(reopened.db.prepare('SELECT count(*) n FROM results').get().n, expected);
      assert.equal(reopened.db.pragma('integrity_check', { simple: true }), 'ok');
      const retained = reopened.result('project-a', 'actor-a', 'action-1');
      const ack = reopened.append(operation());
      if (retained) assert.deepEqual(ack, retained);
      assert.deepEqual(reopened.append(operation()), ack);
      assert.equal(reopened.head('project-a').head, 1);
      assert.equal(reopened.replay('project-a').records.length, 1);
      if (stage === 'after-ack') assert.deepEqual(killed.markers[0].ack, ack);
      evidence.cases.push({
        ...killed,
        preRetryHead: expected,
        recoveredHead: 1,
        exactRetry: true,
      });
    } finally {
      reopened.close();
    }
  });
}
test('a coordinator alive before epoch handoff is fenced by a second process', async () => {
  const { directory, store } = seeded('fence');
  const child = fork(join(root, 'coordinator-child.mjs'), [directory], {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const exit = once(child, 'exit');
  try {
    const [ready] = await once(child, 'message');
    assert.equal(ready.ready, true);
    const epoch2 = store.acquire('project-a', 'coordinator-b');
    assert.equal(epoch2.epoch, 2);
    const received = once(child, 'message');
    child.send({ ...operation(), payload: payload().toString() });
    const [response] = await received;
    assert.equal(response.error, 'epoch-stale');
    assert.equal(store.head('project-a').head, 0);
    const accepted = store.append(operation({ owner: 'coordinator-b', epoch: 2 }));
    assert.equal(accepted.revision, 1);
    evidence.cases.push({
      case: 'live-process-fence',
      stalePid: child.pid,
      oldEpoch: 1,
      newEpoch: 2,
      response,
      accepted,
    });
  } finally {
    child.kill('SIGKILL');
    await exit;
    store.close();
  }
});
test('same transaction ID with changed bytes is rejected without changing head or result', () => {
  const { store } = seeded('id-reuse');
  try {
    const result = store.append(operation());
    assert.throws(
      () => store.append(operation({ payload: payload('changed') })),
      /transaction-id-reused/
    );
    assert.deepEqual(store.result('project-a', 'actor-a', 'action-1'), result);
    assert.equal(store.head('project-a').head, 1);
    evidence.cases.push({ case: 'changed-id-bytes', result, head: 1 });
  } finally {
    store.close();
  }
});
test('transaction identity is scoped by authenticated actor within each project', () => {
  const { store } = seeded('actor-scope');
  try {
    const first = store.append(operation());
    const second = store.append(
      operation({ actor: 'actor-b', base: 1, payload: payload('actor b content') })
    );
    assert.equal(first.revision, 1);
    assert.equal(second.revision, 2);
    assert.equal(first.txid, second.txid);
    assert.deepEqual(store.result('project-a', 'actor-a', 'action-1'), first);
    assert.deepEqual(store.result('project-a', 'actor-b', 'action-1'), second);
    assert.deepEqual(store.append(operation()), first);
    assert.deepEqual(
      store.append(operation({ actor: 'actor-b', base: 1, payload: payload('actor b content') })),
      second
    );
    assert.throws(
      () => store.append(operation({ actor: 'actor-b', base: 1 })),
      /transaction-id-reused/
    );
    assert.equal(store.head('project-a').head, 2);
    evidence.cases.push({ case: 'actor-scoped-id', first, second, head: 2 });
  } finally {
    store.close();
  }
});
test('independent durable directory reconstructs all accepted files into a truly new empty checkout', () => {
  const { directory, store } = seeded('empty-checkout');
  const old = join(artifacts, 'empty-checkout', 'old-renderer');
  const fresh = join(artifacts, 'empty-checkout', 'new-renderer');
  try {
    store.append(operation());
    store.projectEmpty('project-a', old);
    store.append(
      operation({
        txid: 'action-2',
        base: 1,
        payload: Buffer.from(
          JSON.stringify({
            files: [
              { path: 'ui/a.tsx', content: 'latest' },
              { path: 'ui/sub/b.tsx', content: 'second canvas' },
            ],
          })
        ),
      })
    );
  } finally {
    store.close();
  }
  rmSync(old, { recursive: true, force: true });
  mkdirSync(fresh, { recursive: true });
  const reopened = new Store(directory);
  try {
    const head = reopened.projectEmpty('project-a', fresh);
    assert.equal(head.head, 2);
    assert.equal(readFileSync(join(fresh, 'ui/a.tsx'), 'utf8'), 'latest');
    assert.equal(readFileSync(join(fresh, 'ui/sub/b.tsx'), 'utf8'), 'second canvas');
    evidence.cases.push({
      case: 'empty-checkout-replay',
      directory,
      deletedCheckout: old,
      freshCheckout: fresh,
      head: 2,
    });
  } finally {
    reopened.close();
  }
});
test('lock timeout returns unresolved storage error and an exact retry succeeds after rollback', () => {
  const { directory, store } = seeded('busy');
  const contender = new Store(directory, { timeout: 30 });
  try {
    store.db.exec('BEGIN IMMEDIATE');
    assert.throws(
      () => contender.append(operation()),
      (error) => error.code === 'SQLITE_BUSY'
    );
    store.db.exec('ROLLBACK');
    assert.equal(contender.result('project-a', 'actor-a', 'action-1'), null);
    assert.equal(contender.append(operation()).revision, 1);
    evidence.cases.push({
      case: 'lock-timeout',
      error: 'SQLITE_BUSY',
      timeoutMs: 30,
      retryHead: 1,
    });
  } finally {
    contender.close();
    store.close();
  }
});
test('real SQLite quota failure rolls back action/result/head together', () => {
  const { store } = seeded('quota');
  try {
    store.db.pragma('wal_checkpoint(TRUNCATE)');
    const pages = store.db.pragma('page_count', { simple: true });
    store.db.pragma(`max_page_count = ${pages}`);
    assert.throws(
      () => store.append(operation({ payload: payload('a'.repeat(512 * 1024)) })),
      (error) => error.code === 'SQLITE_FULL'
    );
    assert.equal(store.head('project-a').head, 0);
    assert.equal(store.result('project-a', 'actor-a', 'action-1'), null);
    assert.equal(store.replay('project-a').records.length, 0);
    evidence.cases.push({ case: 'sqlite-quota', maxPages: pages, error: 'SQLITE_FULL', head: 0 });
  } finally {
    store.close();
  }
});
test('payload cap rejects before transaction; replay detects payload corruption', () => {
  const { store } = seeded('bounds-integrity');
  try {
    assert.throws(
      () => store.append(operation({ payload: payload('x'.repeat(MAX_PAYLOAD_BYTES)) })),
      /capacity/
    );
    assert.equal(store.head('project-a').head, 0);
    store.append(operation());
    store.db.prepare('UPDATE actions SET payload = ?').run(payload('corrupt'));
    assert.throws(() => store.replay('project-a'), /replay-integrity/);
    evidence.cases.push({
      case: 'bounds-integrity',
      payloadCap: MAX_PAYLOAD_BYTES,
      corruption: 'detected; no silent restore',
    });
  } finally {
    store.close();
  }
});
test('local append ACK latency samples include real FULL/WAL commit cost', () => {
  const { store } = seeded('timing');
  evidence.sqliteVersion = store.db.prepare('SELECT sqlite_version() v').get().v;
  evidence.pragmas = {
    journal: store.db.pragma('journal_mode', { simple: true }),
    synchronous: store.db.pragma('synchronous', { simple: true }),
  };
  let head = 0;
  try {
    for (const size of [1024, 65536, 1048576]) {
      const durations = [];
      for (let i = 0; i < 30; i++) {
        const start = performance.now();
        store.append(
          operation({
            txid: `timing-${size}-${i}`,
            base: head++,
            payload: payload('x'.repeat(size)),
          })
        );
        durations.push(performance.now() - start);
      }
      durations.sort((a, b) => a - b);
      evidence.benchmarks.push({
        contentBytes: size,
        samples: 30,
        p50: durations[14],
        p95: durations[28],
        max: durations[29],
        durations,
      });
    }
  } finally {
    store.close();
  }
});
after(() => {
  writeFileSync(join(artifacts, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log('Evidence: ' + artifacts);
  console.log(`Evidence: ${artifacts}`);
});
