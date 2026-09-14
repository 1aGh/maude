// Explicit, bounded, disposable S3-prefix probe. Does not deploy or touch project data.
import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { proposal } from './fixture-proposal.mjs';
import { ObjectJournal, sha } from './journal.mjs';
import { snapshotAwsCases } from './snapshot-aws-cases.mjs';

const [flag, profile, bucket, region, account, mode] = process.argv.slice(2);
if (mode !== undefined && mode !== 'snapshots') throw new Error('Unknown probe mode');
if (flag !== '--scratch-write' || !profile || !bucket || !region || !/^\d{12}$/.test(account || ''))
  throw new Error(
    'Usage: aws-probe.mjs --scratch-write <profile> <bucket> <region> <expected-account>'
  );
const own = dirname(fileURLToPath(import.meta.url));
const output =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-aws-journal-'));
mkdirSync(output, { recursive: true });
const prefix = `maude-sync-conformance/${randomUUID()}`;
const aws = (args) =>
  JSON.parse(
    execFileSync('aws', [...args, '--profile', profile, '--region', region, '--output', 'json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    }) || '{}'
  );
assert.equal(aws(['sts', 'get-caller-identity']).Account, account);
aws(['s3api', 'head-bucket', '--bucket', bucket, '--expected-bucket-owner', account]);
const inventory = () =>
  aws([
    's3api',
    'list-object-versions',
    '--bucket',
    bucket,
    '--prefix',
    `${prefix}/`,
    '--expected-bucket-owner',
    account,
  ]);
const versions = (result) => [...(result.Versions || []), ...(result.DeleteMarkers || [])];
assert.equal(versions(inventory()).length, 0, 'fresh prefix must be empty before any write');
// Credentials stay in parent/isolated child memory; no config, log, argv or evidence copy.
const credential = JSON.parse(
  execFileSync(
    'aws',
    ['configure', 'export-credentials', '--profile', profile, '--format', 'process'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 }
  )
);
const cfg = {
  endpoint: `https://s3.${region}.amazonaws.com`,
  bucket,
  region,
  accessKeyId: credential.AccessKeyId,
  secretAccessKey: credential.SecretAccessKey,
  sessionToken: credential.SessionToken,
};
const children = new Set();
const report = {
  status: 'running',
  account,
  bucket,
  region,
  prefix,
  node: process.version,
  started: new Date().toISOString(),
  cases: [],
  cleanup: null,
  limitations:
    'Real S3, synthetic ProposalV1/text receipts and optional document snapshots; no production source semantics, DO/R2, native renderer or whole-host-loss claim.',
};
const save = () => writeFileSync(join(output, 'evidence.json'), JSON.stringify(report, null, 2));
save();
const config = (project, ownerEpoch = 1) => ({ cfg, prefix, project, ownerEpoch, maxEntries: 16 });
const journal = (project, ownerEpoch) => new ObjectJournal(config(project, ownerEpoch));
async function message(child) {
  const [result] = await once(child, 'message', { signal: AbortSignal.timeout(15000) });
  assert.equal(result.error, undefined, result.error);
  return result;
}
async function owner(name) {
  const cwd = join(output, name);
  mkdirSync(cwd);
  const child = fork(join(own, 'owner-child.mjs'), [], {
    cwd,
    env: {},
    execArgv: [],
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  children.add(child);
  child.once('exit', () => children.delete(child));
  assert.equal((await message(child)).ready, true);
  return { child, cwd };
}
async function kill(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  const [code, signal] = await exited;
  assert.equal(code, null);
  assert.equal(signal, 'SIGKILL');
}
try {
  if (mode === 'snapshots') {
    await snapshotAwsCases({ journal, config, owner, message, kill, report, output, save });
  } else {
    const core = journal('s3-core');
    await core.initialize();
    const owners = await Promise.all(['race-a', 'race-b'].map(owner));
    const bytes = [proposal('s3-core', 'a'), proposal('s3-core', 'b', { value: 'B' })];
    const staged = owners.map(({ child }) => message(child));
    owners.forEach(({ child }, index) =>
      child.send({
        ...config('s3-core'),
        actor: 'actor',
        raw: bytes[index],
        stopAt: 'after-payload',
      })
    );
    for (const stagedResult of await Promise.all(staged))
      assert.equal(stagedResult.stage, 'after-payload');
    const completed = owners.map(({ child }) => message(child));
    owners.forEach(({ child }) => child.send({ resume: true }));
    const results = (await Promise.all(completed)).map((m) => m.result);
    assert.equal(results.filter((r) => r.status === 'accepted').length, 1);
    const loser = results.findIndex((r) => r.code === 'head-unresolved');
    assert.notEqual(loser, -1);
    const rejected = await core.append('actor', bytes[loser]);
    assert.equal(rejected.code, 'base-conflict');
    const state = await core.read();
    assert.equal(state.actions.length, 1);
    assert.equal(state.results.size, 2);
    const winner = results.findIndex((r) => r.status === 'accepted');
    assert.deepEqual(await core.append('actor', bytes[winner]), results[winner]);
    assert.equal((await core.append('actor', `${bytes[winner]}\n`)).code, 'transaction-id-reused');
    report.cases.push({
      name: 'two-process-CAS-and-retry',
      pids: owners.map(({ child }) => child.pid),
      results,
      rejected,
      head: state.head,
    });
    await Promise.all(owners.map(({ child }) => kill(child)));
    save();

    const held = await owner('old-epoch');
    const pending = proposal('s3-core', 'old-owner', {
      revision: 1,
      manifest: state.head.manifest,
    });
    const paused = message(held.child);
    held.child.send({
      ...config('s3-core'),
      actor: 'actor',
      raw: pending,
      stopAt: 'after-payload',
    });
    assert.equal((await paused).stage, 'after-payload');
    assert.equal((await core.advanceEpoch()).epoch, 2);
    const resumed = message(held.child);
    held.child.send({ resume: true });
    const fenced = (await resumed).result;
    assert.equal(fenced.code, 'head-unresolved');
    assert.equal((await core.append('actor', pending)).code, 'owner-fenced');
    const current = journal('s3-core', 2);
    const stale = await current.append('actor', pending);
    assert.equal(stale.code, 'epoch-stale');
    assert.deepEqual(await current.append('actor', bytes[winner]), results[winner]);
    const next = await current.append(
      'actor',
      proposal('s3-core', 'fresh', {
        revision: 1,
        manifest: state.head.manifest,
        epoch: 2,
        value: 'Current owner',
      })
    );
    assert.equal(next.revision, 2);
    report.cases.push({ name: 'live-epoch-handoff', oldPid: held.child.pid, fenced, stale, next });
    await kill(held.child);
    save();

    const crashStore = journal('s3-crash');
    await crashStore.initialize();
    const crash = await owner('crashed-owner');
    const raw = proposal('s3-crash', 'lost-ack');
    const committed = message(crash.child);
    crash.child.send({ ...config('s3-crash'), actor: 'actor', raw, stopAt: 'after-head' });
    assert.equal((await committed).stage, 'after-head');
    assert.equal(existsSync(join(crash.cwd, 'ack.json')), false);
    await kill(crash.child);
    rmSync(crash.cwd, { recursive: true });
    const restored = journal('s3-crash');
    const ack = await restored.append('actor', raw);
    assert.equal(ack.revision, 1);
    assert.deepEqual(await restored.append('actor', raw), ack);
    const recovered = await restored.read();
    assert.equal(recovered.actions.length, 1);
    assert.equal(recovered.results.size, 1);
    const fresh = join(output, 'fresh-renderer');
    mkdirSync(fresh);
    writeFileSync(
      join(fresh, 'doc-1.txt'),
      JSON.parse(recovered.actions[0].raw).action.operations[0].value
    );
    assert.equal(readFileSync(join(fresh, 'doc-1.txt'), 'utf8'), 'Hello');
    report.cases.push({
      name: 'SIGKILL-after-real-S3-head-before-ACK',
      pid: crash.child.pid,
      signal: 'SIGKILL',
      oldDiskRemoved: !existsSync(crash.cwd),
      ack,
      recoveredHead: recovered.head,
    });
  }
  report.status = 'passed';
} catch (error) {
  report.status = 'failed';
  report.failure = String(error);
  throw error;
} finally {
  await Promise.all([...children].map(kill));
  try {
    const created = versions(inventory());
    // The bounded snapshot mode now also writes sixteen distinct document bodies and pages.
    const cleanupLimit = mode === 'snapshots' ? 256 : 64;
    assert.ok(
      created.length <= cleanupLimit,
      'unexpected scratch object count; refuse bulk deletion'
    );
    for (const item of created) {
      assert.ok(item.Key.startsWith(`${prefix}/`));
      assert.ok(item.VersionId, 'version identity required for exact scratch cleanup');
    }
    if (created.length) {
      const deleted = aws([
        's3api',
        'delete-objects',
        '--bucket',
        bucket,
        '--delete',
        JSON.stringify({ Objects: created.map(({ Key, VersionId }) => ({ Key, VersionId })) }),
        '--expected-bucket-owner',
        account,
      ]);
      assert.equal((deleted.Errors || []).length, 0);
    }
    const remaining = versions(inventory());
    assert.equal(remaining.length, 0);
    report.cleanup = {
      status: 'passed',
      deletedVersions: created.length,
      remaining: remaining.length,
    };
  } catch (error) {
    report.cleanup = { status: 'failed', error: String(error) };
    report.status = 'failed';
    process.exitCode = 1;
  }
  report.sourceHashes = Object.fromEntries(
    [
      'journal.mjs',
      'aws-probe.mjs',
      'owner-child.mjs',
      'fixture-proposal.mjs',
      'hash.mjs',
      'snapshot-index.mjs',
      'document-index.mjs',
      'snapshot-aws-cases.mjs',
    ].map((name) => [name, sha(readFileSync(join(own, name)))])
  );
  report.finished = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({
      status: report.status,
      cases: report.cases.length,
      cleanup: report.cleanup,
      evidence: output,
    })
  );
}
