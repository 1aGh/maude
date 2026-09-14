import assert from 'node:assert/strict';
import { proposal } from '../object-journal/fixture-proposal.mjs';

const command = (project, raw, fields = {}) => ({ kind: 'append', project, raw, ...fields });
export const REMOTE_PROJECTS = ['remote-1024', 'remote-65536', 'remote-race'];
export async function remoteCases(call, samples = 20) {
  assert.ok(Number.isInteger(samples) && samples >= 2 && samples <= 20);
  const results = [];
  for (const size of [1024, 65536]) {
    const project = `remote-${size}`;
    let head = await call({ kind: 'head', project });
    assert.equal(head.revision, 0, 'disposable namespace must start empty');
    const records = [];
    for (let i = 0; i < samples; i++) {
      const raw = proposal(project, `tx-${i}`, {
        revision: head.revision,
        manifest: head.manifest,
        value: 'x'.repeat(size),
      });
      const result = await call(command(project, raw));
      assert.equal(result.revision, i + 1);
      records.push({ raw, result });
      head = { ...head, revision: result.revision, manifest: result.manifestHash };
      if (i % 5 === 4 || i === samples - 1)
        assert.equal((await call({ kind: 'snapshot', project })).status, 'snapshot');
    }
    assert.deepEqual(await call(command(project, records[0].raw)), records[0].result);
    assert.equal(
      (await call(command(project, records[0].raw + '\n'))).code,
      'transaction-id-reused'
    );
    const root = await call({ kind: 'snapshot-read', project });
    assert.equal(root.root.revision, samples);
    const restored = await call({
      kind: 'snapshot-read',
      project,
      hash: root.hash,
      page: 0,
      document: '["doc-1",1]',
    });
    assert.equal(restored.value, 'x'.repeat(size));
    assert.equal((await call({ kind: 'epoch', project })).epoch, 2);
    const stale = proposal(project, 'stale', { revision: head.revision, manifest: head.manifest });
    assert.equal((await call(command(project, stale))).code, 'owner-fenced');
    assert.deepEqual(await call(command(project, records[0].raw)), records[0].result);
    assert.equal((await call(command(project, stale, { ownerEpoch: 2 }))).code, 'epoch-stale');
    await call({ kind: 'member', project, actor: 'actor', allowed: false });
    assert.equal((await call(command(project, records[0].raw))).status, 'forbidden');
    await call({ kind: 'member', project, actor: 'actor', allowed: true });
    results.push({ project, size, accepted: samples, restored: true, epoch: 2 });
  }
  const project = 'remote-race';
  const raced = await Promise.all(
    ['first', 'second'].map((tx) => call(command(project, proposal(project, tx))))
  );
  assert.equal(raced.filter((r) => r.status === 'accepted').length, 1);
  assert.equal(raced.filter((r) => r.code === 'base-conflict').length, 1);
  for (const fault of ['after-action', 'after-head', 'after-result']) {
    const head = await call({ kind: 'head', project });
    const raw = proposal(project, fault, { revision: head.revision, manifest: head.manifest });
    assert.equal((await call(command(project, raw, { fault }))).code, 'injected-rollback');
    assert.equal((await call({ kind: 'head', project })).revision, 1);
  }
  assert.equal((await call(command('remote-1024', proposal('foreign')))).status, 'forbidden');
  results.push({ project, concurrentAccepted: 1, sqlRollbacks: 3 });
  return results;
}
