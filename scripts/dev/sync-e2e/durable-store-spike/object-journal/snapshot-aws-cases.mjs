// Synthetic cases called only by the explicit bounded AWS scratch runner.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { proposal } from './fixture-proposal.mjs';
import { sha } from './hash.mjs';

function instrument(journal) {
  const requests = [];
  for (const method of ['get', 'put']) {
    const call = journal[method].bind(journal);
    journal[method] = async (...args) => {
      const start = performance.now();
      try {
        return await call(...args);
      } finally {
        requests.push({
          method: method.toUpperCase(),
          key: args[0],
          ms: performance.now() - start,
        });
      }
    };
  }
  return requests;
}
export async function snapshotAwsCases({
  journal,
  config,
  owner,
  message,
  kill,
  report,
  output,
  save,
}) {
  const project = 's3-snapshots';
  const active = journal(project);
  await active.initialize();
  let state = await active.read();
  const records = [];
  async function next(tx, target = active) {
    const raw = proposal(project, tx, {
      revision: state.head.revision,
      manifest: state.head.manifest,
      value: tx,
    });
    const result = await target.append('actor', raw);
    assert.equal(result.status, 'accepted', JSON.stringify(result));
    state = { head: { ...state.head, revision: result.revision, manifest: result.manifestHash } };
    return { raw, result };
  }
  for (let i = 0; i < 4; i++) {
    records.push(await next(`base-${i}`));
    if (i % 2 === 1) assert.equal((await active.snapshot()).status, 'snapshot');
  }
  const cold = journal(project),
    coldRequests = instrument(cold);
  const coldStarted = performance.now();
  const restored = await cold.read({ materialize: false });
  const coldMs = performance.now() - coldStarted;
  assert.equal(coldRequests.length, 2);
  assert.equal(restored.head.revision, 4);
  assert.equal(await cold.documentValue(restored, '["doc-1",1]'), 'base-3');
  cold.clearCache();
  coldRequests.length = 0;
  assert.deepEqual(await cold.result('actor', 'base-0'), records[0].result);
  assert.equal(coldRequests.length, 3);
  report.cases.push({
    name: 'real-S3-cold-snapshot-and-index',
    coldGetCount: 2,
    coldMs,
    receiptRequests: [...coldRequests],
  });
  save();
  const timings = [];
  for (let i = 0; i < 5; i++) {
    coldRequests.length = 0;
    const start = performance.now();
    const record = await next(`warm-${i}`, cold);
    const ms = performance.now() - start;
    assert.equal(coldRequests.filter((r) => r.method === 'PUT').length, 2);
    assert.ok(
      coldRequests.filter((r) => r.method === 'GET').length <= 2,
      'at most head plus one previously cold receipt page'
    );
    timings.push({ ms, requests: [...coldRequests], revision: record.result.revision });
  }
  report.cases.push({
    name: 'real-S3-warm-append-samples',
    samples: timings,
    scope:
      'Five synthetic source-text actions; coordinator append includes HTTP/parse/index/CAS, excludes editor, source parser, publication and peer render. Not p95/p99.',
  });
  save();

  const pausedOwner = await owner('snapshot-race');
  const paused = message(pausedOwner.child);
  pausedOwner.child.send({ ...config(project), operation: 'snapshot', stopAt: 'after-snapshot' });
  assert.equal((await paused).stage, 'after-snapshot');
  const racing = await next('concurrent-change', cold);
  const completed = message(pausedOwner.child);
  pausedOwner.child.send({ resume: true });
  assert.equal((await completed).result.code, 'snapshot-unresolved');
  await kill(pausedOwner.child);
  const published = await cold.snapshot();
  assert.equal(published.status, 'snapshot');
  assert.deepEqual(await journal(project).result('actor', 'concurrent-change'), racing.result);
  report.cases.push({
    name: 'real-S3-snapshot-CAS-vs-action',
    pid: pausedOwner.child.pid,
    published,
    accepted: racing.result,
  });
  save();

  for (const stage of ['before-snapshot', 'after-snapshot', 'after-snapshot-head']) {
    const record = await next(stage, cold);
    const worker = await owner(`crash-${stage}`);
    const stopped = message(worker.child);
    worker.child.send({ ...config(project), operation: 'snapshot', stopAt: stage });
    assert.equal((await stopped).stage, stage);
    assert.equal(existsSync(join(worker.cwd, 'ack.json')), false);
    await kill(worker.child);
    rmSync(worker.cwd, { recursive: true });
    const fresh = journal(project);
    assert.deepEqual(await fresh.append('actor', record.raw), record.result);
    const result = await fresh.snapshot();
    assert.equal(result.status, 'snapshot');
    const recovered = await journal(project).read();
    assert.equal(recovered.head.revision, state.head.revision);
    assert.equal(recovered.documents.get('["doc-1",1]'), stage);
    const dir = join(output, `fresh-${stage}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'doc-1.txt'), recovered.documents.get('["doc-1",1]'));
    assert.equal(readFileSync(join(dir, 'doc-1.txt'), 'utf8'), stage);
    report.cases.push({
      name: 'real-S3-SIGKILL-snapshot',
      stage,
      pid: worker.child.pid,
      signal: 'SIGKILL',
      oldDiskRemoved: !existsSync(worker.cwd),
      snapshot: result,
      head: recovered.head,
    });
    save();
  }
  const historyOwner = journal(project);
  let cursor = null;
  const entries = [];
  do {
    const page = await historyOwner.historyPage({ cursor, limit: 4 });
    entries.push(...page.entries);
    cursor = page.next;
  } while (cursor);
  assert.equal(entries.length, 13);
  assert.equal(new Set(entries.map((e) => e.value.result.transactionId)).size, 13);
  assert.deepEqual(await historyOwner.append('actor', records[0].raw), records[0].result);
  report.cases.push({
    name: 'real-S3-complete-history-after-snapshots',
    entries: entries.length,
    oldestReceipt: records[0].result,
  });
  save();

  const large = journal('s3-document-pages');
  let largeHead = (await large.initialize()).head;
  const expected = new Map();
  let first;
  for (let i = 0; i < 16; i++) {
    const text = `${i}:` + 'x'.repeat(65536 - `${i}:`.length);
    const body = JSON.parse(
      proposal(large.project, `doc-${i}`, {
        revision: largeHead.revision,
        manifest: largeHead.manifest,
        value: text,
      })
    );
    body.action.operations[0].documentId = `doc-${i}`;
    body.writes[0].documentId = `doc-${i}`;
    const raw = JSON.stringify(body);
    const result = await large.append('actor', raw);
    assert.equal(result.status, 'accepted');
    first ||= { raw, result };
    largeHead = { ...largeHead, revision: result.revision, manifest: result.manifestHash };
    expected.set(`["doc-${i}",1]`, text);
  }
  assert.equal((await large.snapshot()).status, 'snapshot');
  const fresh = journal(large.project),
    requests = instrument(fresh);
  const metadata = await fresh.read({ materialize: false });
  assert.equal(requests.length, 2);
  assert.equal(metadata.snapshot.documentCount, 16);
  requests.length = 0;
  assert.equal(await fresh.documentValue(metadata, '["doc-15",1]'), expected.get('["doc-15",1]'));
  assert.equal(requests.length, 2);
  const complete = await fresh.read();
  assert.deepEqual(complete.documents, expected);
  assert.deepEqual(await fresh.append('actor', first.raw), first.result);
  report.cases.push({
    name: 'real-S3-document-pages-beyond-inline-cap',
    documents: 16,
    textBytes: 1048576,
    metadataGets: 2,
    activeDocumentAdditionalGets: 2,
    documentHash: sha(JSON.stringify([...complete.documents].sort())),
    head: complete.head,
    oldestReceipt: first.result,
  });
  save();
}
