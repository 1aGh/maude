import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  proposal as contractProposal,
  eventFixtures,
  operationFixtures,
  resultFixtures,
} from '../../contracts/fixtures.mjs';
import { invalidFixtures } from '../../contracts/invalid-fixtures.mjs';
import { proposal } from '../object-journal/fixture-proposal.mjs';
import { REMOTE_PROJECTS, remoteCases } from './remote-cases.mjs';
import { start } from './runtime.mjs';

const own = fileURLToPath(new URL('.', import.meta.url));
const directory =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-cloud-r2-'));
mkdirSync(directory, { recursive: true });
const kills = [],
  cases = [];
const sha = (value) => createHash('sha256').update(value).digest('hex');
after(() => {
  const require = createRequire(process.env.MAUDE_MINIFLARE_ENTRY);
  writeFileSync(
    join(directory, 'evidence.json'),
    JSON.stringify(
      {
        node: process.version,
        miniflare: require('../../package.json').version,
        workerd: require('workerd/package.json').version,
        scope: 'Local workerd SQLite DO and persisted R2 binding; not deployed Cloudflare',
        kills,
        cases,
        hashes: Object.fromEntries(
          [...readdirSync(own).filter((n) => n.endsWith('.mjs')), 'dist/worker.mjs'].map((n) => [
            n,
            sha(readFileSync(join(own, n))),
          ])
        ),
      },
      null,
      2
    )
  );
  console.log(`Cloud R2 evidence: ${directory}`);
});
async function setup(t, name) {
  const path = join(directory, name);
  const runtime = await start(path, kills);
  t.after(() => runtime.kill());
  return { runtime, path };
}
function command(raw, fields = {}) {
  return { kind: 'append', raw, ...fields };
}
const bodyKey = (project, value) => `probe/${project}/documents/${sha(JSON.stringify(value))}`;

test('actual Worker validates the shared contract corpus with no dynamic code generation or host prevalidation', async (t) => {
  const { runtime } = await setup(t, 'wire');
  const valid = [
    ...operationFixtures.map((value) => ({ schema: 'operation', value })),
    ...operationFixtures.map((value) => ({ schema: 'proposal', value: contractProposal(value) })),
    ...resultFixtures.map((value) => ({ schema: 'result', value })),
    ...eventFixtures.map((value) => ({ schema: 'event', value })),
  ];
  for (const item of valid)
    assert.deepEqual(
      await runtime.call({
        kind: 'validate',
        schema: item.schema,
        raw: JSON.stringify(item.value),
      }),
      { ok: true }
    );
  for (const item of invalidFixtures)
    assert.deepEqual(
      await runtime.call({ kind: 'validate', schema: item.kind, raw: JSON.stringify(item.value) }),
      { ok: false, code: item.code },
      item.name
    );
  const raw = proposal('test');
  assert.equal(
    (await runtime.call(command(raw.replace('"protocol":1', '"protocol":1,"protocol":1')))).status,
    'invalid'
  );
  assert.equal((await runtime.call(command(raw), { authenticated: false })).status, 403);
  assert.equal((await runtime.r2('list')).length, 0);
  cases.push({
    name: 'worker-wire',
    valid: valid.length,
    invalid: invalidFixtures.length,
    unauthorized: 403,
  });
});

test('durable metadata, R2 source bytes, exact retries and project/member isolation agree', async (t) => {
  const { runtime } = await setup(t, 'ordinary');
  const value = 'Žluťoučký 🦎' + String.fromCharCode(0xd800);
  const raw = proposal('test', 'tx-first', { value });
  const accepted = await runtime.call(command(raw));
  assert.equal(accepted.revision, 1);
  assert.equal((await runtime.call({ kind: 'document', document: '["doc-1",1]' })).value, value);
  assert.deepEqual(await runtime.call(command(raw)), accepted);
  assert.equal((await runtime.call(command(raw + '\n'))).code, 'transaction-id-reused');
  const stale = proposal('test', 'old-base');
  const rejected = await runtime.call(command(stale));
  assert.equal(rejected.code, 'base-conflict');
  assert.deepEqual(await runtime.call(command(stale)), rejected);
  assert.equal((await runtime.call(command(raw, { project: 'other' }))).status, 'forbidden');
  assert.equal((await runtime.call({ kind: 'head', project: 'other' })).revision, 0);
  await runtime.call({ kind: 'member', actor: 'actor', allowed: false });
  assert.equal((await runtime.call(command(raw))).status, 'forbidden');
  assert.equal((await runtime.call({ kind: 'result', tx: 'tx-first' })).status, 'forbidden');
  await runtime.call({ kind: 'member', actor: 'actor', allowed: true });
  assert.deepEqual((await runtime.call({ kind: 'inventory' })).counts, {
    actions: 1,
    results: 2,
    documents: 1,
  });
  cases.push({
    name: 'exact-retention-and-isolation',
    revision: 1,
    valueHash: sha(JSON.stringify(value)),
  });
});

test('all inline payload and metadata writes roll back together; corrupt archive cannot break live data', async (t) => {
  const { runtime } = await setup(t, 'faults');
  for (const fault of ['after-payload', 'after-action', 'after-head', 'after-result']) {
    assert.equal(
      (await runtime.call(command(proposal('test', fault), { fault }))).code,
      'injected-rollback'
    );
    const state = await runtime.call({ kind: 'inventory' });
    assert.deepEqual(state.counts, { actions: 0, results: 0, documents: 0 });
    assert.deepEqual(state.payloads, { count: 0, bytes: 0 });
  }
  assert.equal((await runtime.r2('list')).length, 0, 'no R2 objects from rejected SQL writes');
  const accepted = await runtime.call(command(proposal('test', 'recovered')));
  assert.equal(accepted.revision, 1);
  assert.equal((await runtime.r2('list')).length, 0, 'accepted operation has no R2 dependency');
  assert.equal((await runtime.call({ kind: 'snapshot' })).status, 'snapshot');
  for (const effect of ['put', 'delete']) {
    await runtime.r2(effect, { key: bodyKey('test', 'Hello'), body: 'corrupt' });
    assert.equal(
      (await runtime.call({ kind: 'snapshot-read', page: 0, document: '["doc-1",1]' })).code,
      effect === 'delete' ? 'missing-or-oversized-object' : 'object-digest-mismatch'
    );
    assert.equal(
      (await runtime.call({ kind: 'document', document: '["doc-1",1]' })).value,
      'Hello'
    );
    assert.equal((await runtime.call({ kind: 'head' })).revision, 1);
  }
  cases.push({ name: 'atomic-inline-and-independent-archive', sqlFaults: 4, archiveFaults: 2 });
});

test('asynchronous preparation does not hold the coordinator lock and must recheck base, owner epoch and membership', async (t) => {
  const { runtime } = await setup(t, 'races');
  for (const race of ['base', 'epoch', 'member']) {
    const project = `race-${race}`;
    const first = proposal(project, 'paused');
    const ready = runtime.stage('before-commit');
    const pending = runtime.call(command(first, { project, pause: 'before-commit' }));
    const stage = await ready;
    let winner;
    if (race === 'base')
      winner = await runtime.call(
        command(proposal(project, 'peer-write', { value: 'Peer' }), { project, actor: 'peer' })
      );
    if (race === 'epoch')
      assert.equal((await runtime.call({ kind: 'epoch', project, actor: 'peer' })).epoch, 2);
    if (race === 'member')
      await runtime.call({ kind: 'member', project, actor: 'actor', allowed: false });
    runtime.resume(stage.id);
    const result = await pending;
    assert.equal(
      result.code || result.status,
      { base: 'base-conflict', epoch: 'owner-fenced', member: 'forbidden' }[race]
    );
    const state = await runtime.call({ kind: 'inventory', project, actor: 'peer' });
    assert.equal(state.counts.actions, race === 'base' ? 1 : 0);
    if (winner) assert.equal(winner.revision, 1);
  }
  cases.push({ name: 'external-io-fences', races: ['base', 'epoch', 'member'] });
});

test('SIGKILL before preparation, before SQL commit and after durable SQL commit recovers exact outcomes and a fresh renderer', async (t) => {
  for (const stage of ['before-prepare', 'before-commit', 'after-commit']) {
    await t.test(stage, async (sub) => {
      const path = join(directory, stage);
      let runtime = await start(path, kills);
      sub.after(() => runtime.kill());
      const raw = proposal('test', 'survivor', { value: 'Recovered 🦎' });
      const paused = runtime.stage(stage);
      const pending = runtime.call(command(raw, { pause: stage })).catch(() => null);
      await paused;
      await runtime.kill(stage);
      await pending;
      runtime = await start(path, kills);
      const state = await runtime.call({ kind: 'inventory' });
      assert.equal(state.head.revision, stage === 'after-commit' ? 1 : 0);
      const accepted = await runtime.call(command(raw));
      assert.equal(accepted.revision, 1);
      assert.deepEqual(await runtime.call(command(raw)), accepted);
      const document = await runtime.call({ kind: 'document', document: '["doc-1",1]' });
      const fresh = join(directory, `renderer-${stage}`);
      mkdirSync(fresh);
      writeFileSync(join(fresh, 'source.txt'), document.value);
      assert.equal(readFileSync(join(fresh, 'source.txt'), 'utf8'), 'Recovered 🦎');
      assert.deepEqual((await runtime.call({ kind: 'inventory' })).counts, {
        actions: 1,
        results: 1,
        documents: 1,
      });
      cases.push({ name: 'SIGKILL', stage, revision: 1, restoredHash: sha(document.value) });
    });
  }
});

test('paged snapshot restores 80 documents and 5 MiB of exact source from cold storage while new edits remain independent', async (t) => {
  const path = join(directory, 'large-snapshot');
  let runtime = await start(path, kills);
  t.after(() => runtime.kill());
  const expected = new Map();
  let head = await runtime.call({ kind: 'head' });
  let first;
  for (let i = 0; i < 80; i++) {
    const value = `${i}:` + 'x'.repeat(65536 - `${i}:`.length);
    expected.set(`["doc-${i}",1]`, value);
    const p = JSON.parse(
      proposal('test', `item-${i}`, { revision: head.revision, manifest: head.manifest, value })
    );
    p.action.operations[0].documentId = `doc-${i}`;
    p.writes[0].documentId = `doc-${i}`;
    const raw = JSON.stringify(p);
    const result = await runtime.call(command(raw));
    assert.equal(result.status, 'accepted');
    first ||= { raw, result };
    head = { ...head, revision: result.revision, manifest: result.manifestHash };
  }
  const snapshot = await runtime.call({ kind: 'snapshot' });
  assert.equal(snapshot.status, 'snapshot');
  await runtime.kill('cold-snapshot-restart');
  runtime = await start(path, kills);
  const restoredRoot = await runtime.call({ kind: 'snapshot-read' });
  assert.equal(restoredRoot.root.count, 80);
  assert.equal(restoredRoot.root.pages.length, 2);
  assert.equal(restoredRoot.hash, snapshot.hash);
  const edit = await runtime.call(
    command(
      proposal('test', 'later-edit', {
        revision: head.revision,
        manifest: head.manifest,
        value: 'Live after snapshot',
      })
    )
  );
  assert.equal(edit.revision, 81);
  const restored = new Map();
  for (let page = 0; page < restoredRoot.root.pages.length; page++) {
    const part = await runtime.call({ kind: 'snapshot-read', hash: snapshot.hash, page });
    assert.ok(part.rows.length <= 64);
    for (const ref of part.rows) {
      const doc = await runtime.call({
        kind: 'snapshot-read',
        hash: snapshot.hash,
        page,
        document: ref.id,
      });
      assert.equal(doc.value, expected.get(ref.id));
      restored.set(ref.id, doc.value);
    }
  }
  assert.deepEqual(restored, expected);
  assert.deepEqual(await runtime.call(command(first.raw)), first.result);
  assert.equal(
    (await runtime.call({ kind: 'document', document: '["doc-1",1]' })).value,
    'Live after snapshot'
  );
  const next = await runtime.call({ kind: 'snapshot' });
  assert.equal(next.revision, 81);
  assert.equal(
    (await runtime.call({ kind: 'snapshot-read', hash: snapshot.hash, page: 0 })).code,
    'snapshot-changed'
  );
  cases.push({
    name: 'paged-cold-recovery',
    documents: 80,
    bytes: 5242880,
    pages: 2,
    snapshotRevision: 80,
    nextRevision: 81,
    restoredHash: sha(JSON.stringify([...restored].sort())),
  });
});

test('snapshot publication makes progress across edits and refuses a missing page', async (t) => {
  const { runtime } = await setup(t, 'snapshot-race');
  const first = await runtime.call(command(proposal('test', 'one')));
  const ready = runtime.stage('snapshot-after-r2');
  const pending = runtime.call({ kind: 'snapshot', pause: 'snapshot-after-r2' });
  const stage = await ready;
  const second = await runtime.call(
    command(
      proposal('test', 'two', {
        revision: 1,
        manifest: first.manifestHash,
        value: 'Newer',
      })
    )
  );
  runtime.resume(stage.id);
  assert.equal((await pending).revision, 1);
  assert.equal(
    (await runtime.call({ kind: 'snapshot-read', page: 0, document: '["doc-1",1]' })).value,
    'Hello'
  );
  assert.equal((await runtime.call({ kind: 'snapshot' })).revision, second.revision);
  const root = await runtime.call({ kind: 'snapshot-read' });
  await runtime.r2('delete', { key: `probe/test/snapshot-pages/${root.root.pages[0]}` });
  assert.equal(
    (await runtime.call({ kind: 'snapshot-read', hash: root.hash, page: 0 })).code,
    'missing-or-oversized-object'
  );
  assert.equal((await runtime.call({ kind: 'head' })).revision, 2);
  cases.push({ name: 'snapshot-progress-and-missing-page', revision: 2 });
});

test('snapshot SIGKILL before objects, after objects and after pointer preserves canonical document state', async (t) => {
  for (const stage of ['snapshot-before-r2', 'snapshot-after-r2', 'snapshot-after-commit']) {
    await t.test(stage, async (sub) => {
      const path = join(directory, stage);
      let runtime = await start(path, kills);
      sub.after(() => runtime.kill());
      const raw = proposal('test', 'one');
      const accepted = await runtime.call(command(raw));
      const ready = runtime.stage(stage);
      const pending = runtime.call({ kind: 'snapshot', pause: stage }).catch(() => null);
      await ready;
      await runtime.kill(stage);
      await pending;
      runtime = await start(path, kills);
      const saved = await runtime.call({ kind: 'snapshot-read' });
      assert.equal(saved !== null, stage === 'snapshot-after-commit');
      assert.equal((await runtime.call({ kind: 'head' })).revision, 1);
      assert.deepEqual(await runtime.call(command(raw)), accepted);
      assert.equal((await runtime.call({ kind: 'snapshot' })).status, 'snapshot');
      const doc = await runtime.call({ kind: 'snapshot-read', page: 0, document: '["doc-1",1]' });
      assert.equal(doc.value, 'Hello');
      cases.push({ name: 'snapshot-SIGKILL', stage, revision: 1 });
    });
  }
});

test('the exact remote runner and cleanup operate only on their disposable project prefixes', async (t) => {
  const runtime = await start(join(directory, 'remote-runner'), kills, { disposable: true });
  t.after(() => runtime.kill());
  const results = await remoteCases(runtime.call, 2);
  assert.equal(results.length, 3);
  assert.equal((await runtime.call(command(proposal('kept'), { project: 'kept' }))).revision, 1);
  const cleaned = [];
  for (const project of REMOTE_PROJECTS) {
    const result = await runtime.call({ kind: 'cleanup', project });
    assert.equal(result.status, 'cleaned');
    assert.equal(result.remaining, 0);
    assert.equal((await runtime.call({ kind: 'head', project })).code, 'draining');
    cleaned.push({ project, ...result });
  }
  assert.equal(
    (await runtime.call({ kind: 'document', project: 'kept', document: '["doc-1",1]' })).value,
    'Hello'
  );
  assert.equal((await runtime.call({ kind: 'cleanup', project: 'kept' })).remaining, 0);
  assert.equal((await runtime.r2('list', { prefix: runtime.prefix + '/' })).length, 0);
  cases.push({ name: 'remote-runner-and-exact-cleanup', results, cleaned });
});

test('live edits and restart recovery work with the R2 binding entirely absent', async (t) => {
  const path = join(directory, 'without-r2');
  let runtime = await start(path, kills, { noR2: true });
  t.after(() => runtime.kill());
  const raw = proposal('test', 'without-archive', { value: 'Durable without R2' });
  const accepted = await runtime.call(command(raw));
  assert.equal(accepted.revision, 1);
  assert.equal((await runtime.call({ kind: 'snapshot' })).status, 'retryable');
  await runtime.kill('restart-without-r2');
  runtime = await start(path, kills, { noR2: true });
  assert.deepEqual(await runtime.call(command(raw)), accepted);
  assert.equal(
    (await runtime.call({ kind: 'document', document: '["doc-1",1]' })).value,
    'Durable without R2'
  );
  const next = await runtime.call(
    command(
      proposal('test', 'next', {
        revision: 1,
        manifest: accepted.manifestHash,
        value: 'Still editable',
      })
    )
  );
  assert.equal(next.revision, 2);
  cases.push({ name: 'R2-binding-absent', revision: 2, restart: true });
});

test('inline storage capacity fails without accepting or partially retaining the new proposal', async (t) => {
  const runtime = await start(join(directory, 'inline-capacity'), kills, {
    inlineLimitBytes: 4096,
  });
  t.after(() => runtime.kill());
  const first = proposal('test', 'first');
  const accepted = await runtime.call(command(first));
  assert.equal(accepted.revision, 1);
  const before = await runtime.call({ kind: 'inventory' });
  const large = proposal('test', 'over-capacity', {
    revision: 1,
    manifest: accepted.manifestHash,
    value: 'x'.repeat(3000),
  });
  assert.equal((await runtime.call(command(large))).code, 'inline-capacity');
  assert.deepEqual(await runtime.call({ kind: 'inventory' }), before);
  assert.equal(await runtime.call({ kind: 'result', tx: 'over-capacity' }), null);
  assert.deepEqual(await runtime.call(command(first)), accepted);
  cases.push({ name: 'inline-capacity', limit: 4096, revision: 1 });
});

test('bounded archive releases obsolete bytes while preserving every history record and exact receipt after restart', async (t) => {
  const path = join(directory, 'archive-history');
  let runtime = await start(path, kills, { inlineLimitBytes: 8192 });
  t.after(() => runtime.kill());
  let head = await runtime.call({ kind: 'head' });
  const records = [];
  for (let i = 0; i < 24; i++) {
    const value = `${i}:` + 'x'.repeat(1000);
    const raw = proposal('test', `arch-${i}`, {
      revision: head.revision,
      manifest: head.manifest,
      value,
    });
    const result = await runtime.call(command(raw));
    assert.equal(result.status, 'accepted');
    records.push({ raw, result, value });
    head = { revision: result.revision, manifest: result.manifestHash };
    if (i % 2 === 1) {
      const archived = await runtime.call({ kind: 'archive' });
      assert.equal(archived.status, 'archived');
      assert.ok(archived.selected <= 16 && archived.bytes <= 1048576);
      assert.ok(archived.removed > 0);
      assert.equal((await runtime.call({ kind: 'inventory' })).payloads.count, 1);
    }
  }
  await runtime.kill('archive-history-restart');
  runtime = await start(path, kills, { inlineLimitBytes: 8192 });
  for (const [i, record] of records.entries()) {
    const history = await runtime.call({ kind: 'history', revision: i + 1 });
    assert.equal(history.proposal, record.raw);
    assert.equal(history.value, record.value);
    assert.deepEqual(await runtime.call(command(record.raw)), record.result);
  }
  assert.equal(
    (await runtime.call({ kind: 'document', document: '["doc-1",1]' })).value,
    records.at(-1).value
  );
  assert.equal((await runtime.call({ kind: 'archive' })).selected, 0);
  cases.push({
    name: 'bounded-archive-history',
    revisions: 24,
    inlineLimit: 8192,
    coldExactHistory: true,
  });
});

test('archive corruption, absence and transactional failure never retire the only inline copy', async (t) => {
  const { runtime } = await setup(t, 'archive-faults');
  const raw = proposal('test', 'first');
  await runtime.call(command(raw));
  const before = await runtime.call({ kind: 'inventory' });
  await runtime.r2('put', { key: bodyKey('test', 'Hello'), body: 'corrupt' });
  assert.equal((await runtime.call({ kind: 'archive' })).code, 'object-digest-mismatch');
  assert.deepEqual(await runtime.call({ kind: 'inventory' }), before);
  await runtime.r2('delete', { key: bodyKey('test', 'Hello') });
  assert.equal(
    (await runtime.call({ kind: 'archive', fault: 'archive-after-prune' })).code,
    'injected-rollback'
  );
  assert.deepEqual(await runtime.call({ kind: 'inventory' }), before);
  assert.equal((await runtime.call({ kind: 'history', revision: 1 })).proposal, raw);
  assert.equal((await runtime.call({ kind: 'archive' })).status, 'archived');
  // An unavailable archive must fail explicitly, never fabricate history or touch live source.
  await runtime.r2('delete', { key: `probe/test/proposals/${sha(raw)}` });
  assert.equal(
    (await runtime.call({ kind: 'history', revision: 1 })).code,
    'missing-or-oversized-object'
  );
  assert.equal((await runtime.call({ kind: 'document', document: '["doc-1",1]' })).value, 'Hello');
  const noR2 = await start(join(directory, 'archive-no-r2'), kills, { noR2: true });
  t.after(() => noR2.kill());
  await noR2.call(command(raw));
  const absentBefore = await noR2.call({ kind: 'inventory' });
  assert.equal((await noR2.call({ kind: 'archive' })).status, 'retryable');
  assert.deepEqual(await noR2.call({ kind: 'inventory' }), absentBefore);
  cases.push({ name: 'archive-fail-closed', corrupt: true, unavailable: true, rollback: true });
});

test('archive rechecks current references, membership and owner after external IO', async (t) => {
  const { runtime } = await setup(t, 'archive-races');
  for (const race of ['edit', 'epoch', 'member']) {
    const project = `archive-${race}`;
    const first = await runtime.call(command(proposal(project), { project }));
    const before = await runtime.call({ kind: 'inventory', project });
    const ready = runtime.stage('archive-after-r2');
    const pending = runtime.call({ kind: 'archive', project, pause: 'archive-after-r2' });
    const stage = await ready;
    if (race === 'edit')
      await runtime.call(
        command(
          proposal(project, 'later', { revision: 1, manifest: first.manifestHash, value: 'New' }),
          { project }
        )
      );
    if (race === 'epoch') await runtime.call({ kind: 'epoch', project });
    if (race === 'member')
      await runtime.call({ kind: 'member', project, allowed: false, actor: 'actor' });
    runtime.resume(stage.id);
    const result = await pending;
    assert.equal(
      result.code || result.status,
      { edit: 'archived', epoch: 'owner-fenced', member: 'forbidden' }[race]
    );
    const state = await runtime.call({ kind: 'inventory', project, actor: 'peer' });
    if (race !== 'edit') assert.deepEqual(state.payloads, before.payloads);
    assert.equal(
      (await runtime.call({ kind: 'document', project, actor: 'peer', document: '["doc-1",1]' }))
        .value,
      race === 'edit' ? 'New' : 'Hello'
    );
    assert.equal(
      (await runtime.call({ kind: 'history', project, actor: 'peer', revision: 1 })).value,
      'Hello'
    );
  }
  cases.push({ name: 'archive-fences', races: ['edit', 'epoch', 'member'] });
});

test('archive SIGKILL before R2, after R2 and after retirement preserves exact history', async (t) => {
  for (const stage of ['archive-before-r2', 'archive-after-r2', 'archive-after-commit']) {
    await t.test(stage, async (sub) => {
      const path = join(directory, stage);
      let runtime = await start(path, kills);
      sub.after(() => runtime.kill());
      const raw = proposal('test');
      const accepted = await runtime.call(command(raw));
      const before = await runtime.call({ kind: 'inventory' });
      const ready = runtime.stage(stage);
      const pending = runtime.call({ kind: 'archive', pause: stage }).catch(() => null);
      await ready;
      await runtime.kill(stage);
      await pending;
      runtime = await start(path, kills);
      const state = await runtime.call({ kind: 'inventory' });
      assert.equal(
        state.payloads.count,
        stage === 'archive-after-commit' ? 1 : before.payloads.count
      );
      assert.equal((await runtime.call({ kind: 'history', revision: 1 })).proposal, raw);
      assert.deepEqual(await runtime.call(command(raw)), accepted);
      assert.equal((await runtime.call({ kind: 'archive' })).status, 'archived');
      cases.push({ name: 'archive-SIGKILL', stage, exactReceiptAndHistory: true });
    });
  }
});

test('snapshot can archive a captured old revision after inline retirement but cannot replace a newer snapshot', async (t) => {
  const { runtime } = await setup(t, 'snapshot-archive-progress');
  const first = await runtime.call(command(proposal('test')));
  const ready = runtime.stage('snapshot-before-r2');
  const pending = runtime.call({ kind: 'snapshot', pause: 'snapshot-before-r2' });
  const stage = await ready;
  await runtime.call(
    command(
      proposal('test', 'next', { revision: 1, manifest: first.manifestHash, value: 'Second' })
    )
  );
  assert.equal((await runtime.call({ kind: 'archive' })).status, 'archived');
  runtime.resume(stage.id);
  assert.equal((await pending).revision, 1);
  assert.equal(
    (await runtime.call({ kind: 'snapshot-read', page: 0, document: '["doc-1",1]' })).value,
    'Hello'
  );
  const ready2 = runtime.stage('snapshot-after-r2');
  const pending2 = runtime.call({ kind: 'snapshot', pause: 'snapshot-after-r2' });
  const stage2 = await ready2;
  const head = await runtime.call({ kind: 'head' });
  await runtime.call(
    command(
      proposal('test', 'third', {
        revision: head.revision,
        manifest: head.manifest,
        value: 'Third',
      })
    )
  );
  assert.equal((await runtime.call({ kind: 'snapshot' })).revision, 3);
  runtime.resume(stage2.id);
  assert.equal((await pending2).code, 'snapshot-superseded');
  assert.equal((await runtime.call({ kind: 'snapshot-read' })).revision, 3);
  cases.push({ name: 'snapshot-progress-through-retirement', oldCapture: 1, monotonicSnapshot: 3 });
});

test('archive batches cap source bytes and concurrent retirement never decrements usage twice', async (t) => {
  const { runtime } = await setup(t, 'archive-bounds');
  let head = await runtime.call({ kind: 'head' });
  const records = [];
  for (let i = 0; i < 20; i++) {
    const value = `${i}:` + 'ž'.repeat(45000);
    const p = JSON.parse(
      proposal('test', `large-${i}`, { revision: head.revision, manifest: head.manifest, value })
    );
    p.action.operations[0].documentId = `doc-${i}`;
    p.writes[0].documentId = `doc-${i}`;
    const raw = JSON.stringify(p);
    const result = await runtime.call(command(raw));
    assert.equal(result.status, 'accepted');
    records.push({ raw, value });
    head = { revision: result.revision, manifest: result.manifestHash };
  }
  const before = await runtime.call({ kind: 'inventory' });
  assert.ok(before.payloads.bytes > 3 * 1048576);
  let removed = 0,
    batches = 0;
  for (;;) {
    const result = await runtime.call({ kind: 'archive' });
    assert.equal(result.status, 'archived');
    assert.ok(result.selected <= 16 && result.bytes <= 1048576);
    if (!result.selected) break;
    assert.ok(++batches <= 5, 'finite payload set must make bounded progress');
    removed += result.removed;
  }
  assert.ok(batches >= 3);
  const after = await runtime.call({ kind: 'inventory' });
  assert.equal(after.payloads.count, 20, 'all current documents stay inline');
  assert.equal(after.payloads.bytes, before.payloads.bytes - removed);
  for (const [i, record] of records.entries()) {
    const history = await runtime.call({ kind: 'history', revision: i + 1 });
    assert.equal(history.proposal, record.raw);
    assert.equal(history.value, record.value);
  }
  const raw = proposal('overlap', 'one');
  await runtime.call(command(raw, { project: 'overlap' }));
  const ready = runtime.stage('archive-after-r2');
  const pending = runtime.call({ kind: 'archive', project: 'overlap', pause: 'archive-after-r2' });
  const stage = await ready;
  assert.ok((await runtime.call({ kind: 'archive', project: 'overlap' })).removed > 0);
  const once = await runtime.call({ kind: 'inventory', project: 'overlap' });
  runtime.resume(stage.id);
  assert.equal((await pending).removed, 0);
  assert.deepEqual(await runtime.call({ kind: 'inventory', project: 'overlap' }), once);
  assert.equal(
    (await runtime.call({ kind: 'history', project: 'overlap', revision: 1 })).proposal,
    raw
  );
  cases.push({
    name: 'archive-batch-and-overlap-bounds',
    documents: 20,
    batches,
    maxBytes: 1048576,
    exactUsage: true,
  });
});
