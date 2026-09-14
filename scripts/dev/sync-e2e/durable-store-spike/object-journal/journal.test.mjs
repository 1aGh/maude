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

const own = dirname(fileURLToPath(import.meta.url));
const run =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-object-journal-'));
mkdirSync(run, { recursive: true });
const evidence = {
  node: process.version,
  kind: 'loopback S3-shaped HTTP fixture; not AWS/R2',
  cases: [],
};

async function setup(t, name, options = {}) {
  const fixture = await objectFixture(join(run, name, 'object-store'));
  const config = { cfg: fixture.cfg, prefix: 'isolated-journal', project: name, ...options };
  const journal = new ObjectJournal(config);
  await journal.initialize();
  t.after(async () => {
    await fixture.close();
    assert.deepEqual(fixture.violations, []);
  });
  return { fixture, config, journal };
}
after(() => {
  const files = readdirSync(own)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => join(own, name));
  files.push(
    fileURLToPath(new URL('../conformance/storage-policy.mjs', import.meta.url)),
    fileURLToPath(new URL('../../../../../apps/hub/src/s3.mjs', import.meta.url))
  );
  evidence.sourceHashes = Object.fromEntries(files.map((path) => [path, sha(readFileSync(path))]));
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${run}`);
});

test('exact proposal/result retention, rejected bytes, authorization and separate projects', async (t) => {
  const { journal, fixture, config } = await setup(t, 'retention');
  const raw = proposal('retention');
  const ack = await journal.append('actor-a', raw);
  assert.equal(ack.status, 'accepted');
  assert.equal(ack.proposalHash, sha(raw));
  const writes = () => fixture.requests.filter((r) => r.method === 'PUT').length;
  const count = writes();
  assert.deepEqual(await journal.append('actor-a', raw), ack);
  assert.equal(writes(), count);
  assert.equal((await journal.append('actor-a', `${raw}\n`)).code, 'transaction-id-reused');
  const rejectedRaw = proposal('retention', 'bad-base');
  const rejected = await journal.append('actor-a', rejectedRaw);
  assert.equal(rejected.code, 'base-conflict');
  assert.deepEqual(await journal.result('actor-a', 'bad-base'), rejected);
  const otherActor = await journal.append(
    'actor-b',
    proposal('retention', 'tx-1', { revision: 1, manifest: ack.manifestHash, value: 'B' })
  );
  assert.equal(otherActor.revision, 2);
  const before = fixture.requests.length;
  assert.deepEqual(await journal.append('actor-a', raw, { authorized: false }), {
    status: 'forbidden',
  });
  assert.deepEqual(await journal.result('actor-a', 'tx-1', false), { status: 'forbidden' });
  assert.equal(fixture.requests.length, before, 'revoked read/write never reaches storage');
  const foreign = new ObjectJournal({ ...config, project: 'other' });
  await foreign.initialize();
  assert.equal((await foreign.append('actor-a', proposal('other'))).revision, 1);
  assert.equal((await journal.read()).head.revision, 2);
  assert.equal((await journal.append('actor-a', proposal('wrong-project'))).code, 'forbidden');
  assert.equal(
    (await journal.append('actor-a', raw.replace('"epoch":1', '"epoch":1,"epoch":2'))).code,
    'duplicate-object-key'
  );
  evidence.cases.push({ name: 'retention', ack, rejected, otherActor, requests: fixture.requests });
});

test('two coordinators race on a real HTTP CAS; loser retries without overwriting the winner', async (t) => {
  const { journal, config, fixture } = await setup(t, 'race');
  const other = new ObjectJournal(config);
  const owners = await Promise.all(
    ['a', 'b'].map((name) => startOwner(t, join(run, 'race', `owner-${name}`)))
  );
  assert.notEqual(owners[0].pid, owners[1].pid);
  fixture.barrier(2);
  const bytes = [proposal('race', 'a'), proposal('race', 'b', { value: 'B' })];
  const pending = owners.map((owner) => message(owner));
  owners.forEach((owner, i) => owner.send({ ...config, actor: 'actor', raw: bytes[i] }));
  const results = (await Promise.all(pending)).map((response) => response.result);
  assert.equal(results.filter((r) => r.status === 'accepted').length, 1);
  const loser = results.findIndex((r) => r.code === 'head-unresolved');
  assert.notEqual(loser, -1);
  const retry = await other.append('actor', bytes[loser]);
  assert.equal(retry.code, 'base-conflict');
  const state = await journal.read();
  assert.equal(state.head.revision, 1);
  assert.equal(state.head.sequence, 2);
  assert.equal(state.actions.length, 1);
  assert.equal(state.results.size, 2);
  const entriesWritten = fixture.requests.filter(
    (r) => r.method === 'PUT' && r.key.includes('/entries/')
  );
  assert.equal(
    entriesWritten.length,
    3,
    'losing immutable branch is harmless, not part of accepted replay'
  );
  evidence.cases.push({
    name: 'race',
    pids: owners.map((owner) => owner.pid),
    results,
    retry,
    head: state.head,
    requests: fixture.requests,
  });
});

test('lost payload/head ACKs resolve from authoritative bytes; unavailable outcome never claims acceptance', async (t) => {
  const { journal, fixture } = await setup(t, 'lost-ack');
  // Exact suffix obtained from the callback-free first request fixture calculation.
  fixture.faults.push({ method: 'PUT', suffix: '', phase: 'after', effect: 'drop' });
  const a = await journal.append('actor', proposal('lost-ack'));
  assert.equal(
    a.revision,
    1,
    'lost immutable payload response can be resolved before head advance'
  );
  fixture.faults.push({ method: 'PUT', suffix: '/head', phase: 'after', effect: 'drop' });
  const bytes = proposal('lost-ack', 'second', { revision: 1, manifest: a.manifestHash });
  const b = await journal.append('actor', bytes);
  assert.equal(b.revision, 2);
  assert.deepEqual(await journal.append('actor', bytes), b);
  fixture.faults.push({ method: 'PUT', suffix: '/head', phase: 'after', effect: 'drop' });
  // Arrange read failure only after the initial head read, while preparing the entry.
  const guarded = new ObjectJournal({
    cfg: fixture.cfg,
    prefix: 'isolated-journal',
    project: 'lost-ack',
    checkpoint: async (stage) => {
      if (stage === 'after-payload')
        fixture.faults.push({ method: 'GET', suffix: '/head', phase: 'before', effect: 503 });
    },
  });
  const unresolved = proposal('lost-ack', 'third', { revision: 2, manifest: b.manifestHash });
  await assert.rejects(guarded.append('actor', unresolved), /503/);
  const c = await journal.append('actor', unresolved);
  assert.equal(c.revision, 3, 'fresh owner resolves stored result after failed resolution');
  assert.equal((await journal.read()).actions.length, 3);
  evidence.cases.push({ name: 'lost-ack', a, b, c, requests: fixture.requests });
});

test('live old owner on another disk cannot commit after durable epoch advance', async (t) => {
  const { journal, config } = await setup(t, 'fencing');
  const ack = await journal.append('actor', proposal('fencing'));
  const owner = await startOwner(t, join(run, 'fencing', 'old-owner'));
  const old = new ObjectJournal(config);
  const raw = proposal('fencing', 'delayed', { revision: 1, manifest: ack.manifestHash });
  const paused = message(owner);
  owner.send({ ...config, actor: 'actor', raw, stopAt: 'after-payload' });
  assert.equal((await paused).stage, 'after-payload');
  assert.deepEqual(await journal.advanceEpoch(), { status: 'advanced', epoch: 2 });
  const completed = message(owner);
  owner.send({ resume: true });
  assert.equal((await completed).result.code, 'head-unresolved');
  assert.equal((await old.append('actor', raw)).code, 'owner-fenced');
  assert.deepEqual(
    await old.append('actor', proposal('fencing')),
    ack,
    'retained result is read-only'
  );
  const current = new ObjectJournal({ ...config, ownerEpoch: 2 });
  const rejected = await current.append('actor', raw);
  assert.equal(rejected.code, 'epoch-stale');
  const fresh = proposal('fencing', 'fresh', { revision: 1, manifest: ack.manifestHash, epoch: 2 });
  assert.equal((await current.append('actor', fresh)).revision, 2);
  const state = await current.read();
  assert.equal(state.actions.length, 2);
  assert.equal(state.head.epoch, 2);
  evidence.cases.push({
    name: 'fencing',
    oldPid: owner.pid,
    currentPid: process.pid,
    rejected,
    head: state.head,
  });
});

test('storage refusal leaves no accepted head and an explicit later retry has one result', async (t) => {
  for (const status of [503, 507]) {
    const project = `refused-${status}`;
    const { journal, fixture } = await setup(t, project);
    const raw = proposal(project);
    fixture.faults.push({ method: 'PUT', suffix: '', phase: 'before', effect: status });
    await assert.rejects(journal.append('actor', raw), (error) => error.httpStatus === status);
    assert.equal((await journal.read()).head.sequence, 0);
    assert.equal(
      fixture.requests.filter((r) => r.method === 'PUT' && r.key.endsWith('/head')).length,
      1
    );
    fixture.faults.push({ method: 'PUT', suffix: '/head', phase: 'before', effect: 409 });
    assert.equal((await journal.append('actor', raw)).code, 'head-unresolved');
    assert.equal((await journal.read()).head.sequence, 0);
    const ack = await journal.append('actor', raw);
    assert.equal(ack.revision, 1);
    assert.deepEqual(await journal.result('actor', 'tx-1'), ack);
    evidence.cases.push({ name: 'storage-refusal', status, ack, requests: fixture.requests });
  }
});

test('missing/corrupt entries, capacity and a hanging storage response fail closed', async (t) => {
  const { journal, fixture, config } = await setup(t, 'integrity', { maxEntries: 2 });
  const a = await journal.append('actor', proposal('integrity'));
  const b = await journal.append(
    'actor',
    proposal('integrity', 'b', { revision: 1, manifest: a.manifestHash })
  );
  assert.equal(b.revision, 2);
  const head = (await journal.read()).head;
  const before = fixture.requests.length;
  assert.equal((await journal.append('actor', proposal('integrity', 'c'))).code, 'capacity');
  assert.equal(
    fixture.requests.slice(before).some((r) => r.method === 'PUT'),
    false
  );
  const key = journal.entryKey(head.tail),
    original = fixture.read(key).body;
  fixture.write(key, Buffer.from('corrupt'));
  journal.clearCache(); // Cold recovery must detect storage corruption; immutable cache assumes retention.
  await assert.rejects(journal.read(), /digest mismatch/);
  await assert.rejects(
    journal.append('actor', proposal('integrity', 'corrupt-attempt')),
    /digest mismatch/
  );
  fixture.write(key, original);
  const timeout = new ObjectJournal({ ...config, ioTimeoutMs: 150 });
  fixture.faults.push({ method: 'GET', suffix: '/head', phase: 'before', effect: 'hang' });
  await assert.rejects(timeout.read(), (error) => error.name === 'TimeoutError');
  assert.deepEqual((await journal.read()).head, head);
  const missingKey = journal.entryKey(head.tail);
  // Remove the physical object file independently of coordinator code.
  rmSync(join(run, 'integrity', 'object-store', sha(missingKey)));
  journal.clearCache();
  await assert.rejects(journal.read(), /referenced entry missing/);
  evidence.cases.push({
    name: 'integrity',
    head,
    verified: ['capacity', 'corruption', 'timeout', 'missing-entry'],
  });
});

async function message(child) {
  const [value] = await once(child, 'message', { signal: AbortSignal.timeout(10000) });
  assert.equal(value.error, undefined, value.error);
  return value;
}
async function startOwner(t, directory) {
  mkdirSync(directory, { recursive: true });
  const child = fork(join(own, 'owner-child.mjs'), [], {
    cwd: directory,
    env: {},
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    execArgv: [],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  assert.equal((await message(child)).ready, true);
  return child;
}
test('real SIGKILL at four commit boundaries and recovery from empty owner/renderer disks', async (t) => {
  for (const stage of ['before-payload', 'after-payload', 'after-head', 'before-ack']) {
    await t.test(stage, async (sub) => {
      const { journal, fixture, config } = await setup(sub, `crash-${stage}`);
      const root = join(run, `crash-${stage}`),
        oldDisk = join(root, 'old-owner');
      mkdirSync(oldDisk);
      writeFileSync(join(oldDisk, 'private-unaccepted.txt'), 'must not become accepted');
      const child = fork(join(own, 'owner-child.mjs'), [], {
        cwd: oldDisk,
        env: {},
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        execArgv: [],
      });
      let stderr = '';
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk).slice(0, 2048);
      });
      sub.after(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      });
      assert.equal((await message(child)).ready, true, stderr);
      const bytes = proposal(config.project, 'crashed-action');
      const checkpoint = message(child);
      child.send({ ...config, actor: 'actor', raw: bytes, stopAt: stage });
      assert.equal((await checkpoint).stage, stage, stderr);
      assert.equal(existsSync(join(oldDisk, 'ack.json')), false);
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      const [code, signal] = await exited;
      assert.equal(code, null);
      assert.equal(signal, 'SIGKILL');
      rmSync(oldDisk, { recursive: true });
      const freshDisk = join(root, 'new-renderer');
      mkdirSync(freshDisk);
      const recovered = new ObjectJournal(config);
      const beforeRetry = await recovered.read();
      const committedBeforeDeath = ['after-head', 'before-ack'].includes(stage);
      assert.equal(beforeRetry.head.revision, committedBeforeDeath ? 1 : 0);
      const result = await recovered.append('actor', bytes);
      assert.equal(result.revision, 1);
      assert.deepEqual(await recovered.append('actor', bytes), result);
      const state = await recovered.read();
      assert.equal(state.actions.length, 1);
      assert.equal(state.results.size, 1);
      for (const action of state.actions)
        writeFileSync(
          join(freshDisk, 'doc-1.txt'),
          JSON.parse(action.raw).action.operations[0].value
        );
      assert.equal(readFileSync(join(freshDisk, 'doc-1.txt'), 'utf8'), 'Hello');
      assert.equal(existsSync(join(freshDisk, 'private-unaccepted.txt')), false);
      assert.equal((await journal.read()).head.revision, 1);
      evidence.cases.push({
        name: 'SIGKILL',
        stage,
        pid: child.pid,
        code,
        signal,
        committedBeforeDeath,
        result,
        oldDiskRemoved: !existsSync(oldDisk),
        freshDisk,
        requests: fixture.requests,
      });
    });
  }
});
