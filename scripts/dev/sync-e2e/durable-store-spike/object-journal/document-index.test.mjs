import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { proposal } from './fixture-proposal.mjs';
import { objectFixture } from './http-fixture.mjs';
import { ObjectJournal, sha } from './journal.mjs';
import { bucketFor } from './snapshot-index.mjs';

async function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'maude-document-index-'));
  const fixture = await objectFixture(join(directory, 'objects'));
  const config = {
    cfg: fixture.cfg,
    prefix: 'document-proof',
    project: 'large',
    maxEntries: 16,
    cacheBytes: 131072,
  };
  const journal = new ObjectJournal(config);
  await journal.initialize();
  t.after(async () => {
    await fixture.close();
    assert.deepEqual(fixture.violations, []);
  });
  return { directory, fixture, journal, config };
}
async function assign(journal, tx, doc, text) {
  const { head } = await journal.headRecord();
  const body = JSON.parse(
    proposal(journal.project, tx, {
      revision: head.revision,
      manifest: head.manifest,
      value: text,
    })
  );
  body.action.operations[0].documentId = doc;
  body.writes[0].documentId = doc;
  const raw = JSON.stringify(body);
  const result = await journal.append('actor', raw);
  assert.equal(result.status, 'accepted');
  return { raw, result };
}

test('10 MiB project restores progressively through bounded metadata and keeps exact receipts', async (t) => {
  const { directory, fixture, journal, config } = await setup(t);
  const expected = new Map();
  let first;
  for (let i = 0; i < 160; i++) {
    const value = `${i}:` + 'x'.repeat(65536 - `${i}:`.length);
    expected.set(`["doc-${i}",1]`, value);
    const record = await assign(journal, `tx-${i}`, `doc-${i}`, value);
    first ||= record;
    if (i % 16 === 15) assert.equal((await journal.snapshot()).status, 'snapshot');
  }
  assert.equal((await new ObjectJournal(config).initialize()).head.revision, 160);
  const cold = new ObjectJournal(config);
  let start = fixture.requests.length;
  const state = await cold.read({ materialize: false });
  assert.equal(fixture.requests.length - start, 2);
  assert.equal(state.snapshot.documentCount, 160);
  assert.equal(state.documents.size, 0);
  start = fixture.requests.length;
  assert.equal(await cold.documentValue(state, '["doc-159",1]'), expected.get('["doc-159",1]'));
  assert.equal(fixture.requests.length - start, 2, 'only one document page and one body');
  await assert.rejects(new ObjectJournal(config).read(), /materialization capacity/);
  const restored = new Map();
  for (const bucket of Object.keys(state.documentIndex.pages)) {
    const page = await state.documentIndex.page(bucket);
    assert.ok(page.size <= 512);
    for (const [key, ref] of page) restored.set(key, await state.documentIndex.decode(ref));
    assert.ok(cold.cacheSize <= config.cacheBytes);
  }
  assert.deepEqual(restored, expected);
  assert.deepEqual(await cold.append('actor', first.raw), first.result);
  const replacement = await assign(cold, 'new-value', 'doc-159', 'Updated independently');
  assert.equal((await cold.snapshot()).status, 'snapshot');
  // A captured read view remains consistent after a later head publication.
  assert.equal(await cold.documentValue(state, '["doc-159",1]'), expected.get('["doc-159",1]'));
  const current = await cold.read({ materialize: false });
  assert.equal(current.snapshot.documentCount, 160);
  assert.equal(await cold.documentValue(current, '["doc-159",1]'), 'Updated independently');
  assert.equal(await cold.documentValue(current, '["doc-0",1]'), expected.get('["doc-0",1]'));
  assert.ok(fixture.requests.filter((r) => r.method === 'PUT').every((r) => r.bytes <= 1048576));
  writeFileSync(
    join(directory, 'evidence.json'),
    JSON.stringify(
      {
        node: process.version,
        documents: 160,
        bytes: 10485760,
        metadataGets: 2,
        activeDocumentAdditionalGets: 2,
        restoredHash: sha(JSON.stringify([...restored].sort())),
        revision: replacement.result.revision,
        cacheBytes: cold.cacheSize,
        checks: [
          'progressive-byte-parity',
          'bounded-eager-read',
          'retained-receipt',
          'pinned-read-view',
          'independent-edit',
        ],
      },
      null,
      2
    )
  );
  console.log(`Document index evidence: ${directory}`);
});

test('missing or corrupt document objects and pages fail on cold access without publishing partial snapshots', async (t) => {
  const { directory, fixture, journal, config } = await setup(t);
  const first = await assign(journal, 'first', 'doc-1', 'Original');
  const before = (await journal.headRecord()).head;
  fixture.faults.push({
    method: 'PUT',
    suffix: sha(JSON.stringify('Original')),
    phase: 'before',
    effect: 507,
  });
  await assert.rejects(journal.snapshot(), (e) => e.httpStatus === 507);
  assert.deepEqual((await journal.headRecord()).head, before);
  fixture.faults.push({
    method: 'PUT',
    suffix: sha(JSON.stringify('Original')),
    phase: 'after',
    effect: 'drop',
  });
  assert.equal((await journal.snapshot()).status, 'snapshot');
  const state = await journal.read({ materialize: false });
  const pageHash = state.documentIndex.pages[bucketFor('["doc-1",1]')];
  for (const [kind, hash] of [
    ['documents', sha(JSON.stringify('Original'))],
    ['document-indexes', pageHash],
  ]) {
    const key = journal.immutableKey(kind, hash);
    const original = fixture.read(key).body;
    fixture.write(key, Buffer.from('broken'));
    let cold = new ObjectJournal(config);
    await assert.rejects(
      cold.documentValue(await cold.read({ materialize: false }), '["doc-1",1]'),
      /digest mismatch/
    );
    rmSync(join(directory, 'objects', sha(key)));
    cold = new ObjectJournal(config);
    await assert.rejects(
      cold.documentValue(await cold.read({ materialize: false }), '["doc-1",1]'),
      /referenced entry missing/
    );
    fixture.write(key, original);
  }
  assert.deepEqual(await new ObjectJournal(config).append('actor', first.raw), first.result);
  assert.equal((await new ObjectJournal(config).read()).documents.get('["doc-1",1]'), 'Original');
});

test('snapshot string encoding preserves escaped code units and Unicode exactly', async (t) => {
  const { journal, config } = await setup(t);
  const value = 'Příliš žluťoučký 🦎\n\0' + String.fromCharCode(0xd800) + 'literal\\ud800';
  await assign(journal, 'unicode', 'doc-1', value);
  assert.equal((await journal.snapshot()).status, 'snapshot');
  const restored = await new ObjectJournal(config).read();
  assert.equal(restored.documents.get('["doc-1",1]'), value);
});
