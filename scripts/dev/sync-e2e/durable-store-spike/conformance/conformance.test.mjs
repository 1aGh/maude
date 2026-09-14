import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { cloudAdapter, sha, sqliteAdapter, validator } from './adapters.mjs';
import { INITIAL_HASH } from './storage-policy.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const run =
  process.env.MAUDE_SPIKE_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), 'maude-storage-conformance-'));
mkdirSync(run, { recursive: true });
const evidence = {
  node: process.version,
  adapters: {},
  sourceHashes: Object.fromEntries(
    readdirSync(root)
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => [name, sha(readFileSync(join(root, name)))])
  ),
  bundleHash: sha(readFileSync(join(root, 'dist/cloud-worker.mjs'))),
};
function proposal(
  project,
  id = 'tx-1',
  { base = 0, manifest = INITIAL_HASH, epoch = 1, value = 'Hello' } = {}
) {
  return {
    protocol: 1,
    projectId: project,
    epoch,
    transactionId: id,
    origin: { deviceId: 'device-1', sessionId: 'session-1' },
    base: { revision: base, manifestHash: manifest },
    dependsOn: [],
    action: {
      kind: 'edit',
      label: 'Edit heading',
      operations: [
        {
          kind: 'source.text.assign',
          documentId: 'doc-1',
          generation: 1,
          elementId: 'el-1',
          value,
        },
      ],
    },
    reads: [],
    writes: [{ documentId: 'doc-1', generation: 1, target: { lane: 'source' } }],
    blobs: [],
  };
}
const raw = (p) => JSON.stringify(p);
for (const [name, factory] of [
  ['sqlite', sqliteAdapter],
  ['workerd', cloudAdapter],
]) {
  test(`${name}: shared exact-byte append/head/result/replay/epoch corpus`, async (t) => {
    const directory = join(run, name, 'durable');
    let adapter = await factory(directory);
    const report = { versions: adapter.versions, cases: [] };
    evidence.adapters[name] = report;
    const submit = async (project, actor, bytes, options) => {
      const result = await adapter.append(project, actor, bytes, options);
      if (['accepted', 'rejected'].includes(result.status))
        assert.equal(validator.validate('result', raw(result)).ok, true, raw(result));
      return result;
    };
    const record = (id, data) => report.cases.push({ id, ...data });
    try {
      await t.test(
        'exact whole bytes are retained and hashed; exact retry is one action',
        async () => {
          const p = proposal('exact');
          const bytes = raw(p);
          const ack = await submit('exact', 'actor-a', bytes);
          assert.equal(ack.status, 'accepted');
          assert.equal(ack.proposalHash, sha(bytes));
          assert.deepEqual(await submit('exact', 'actor-a', bytes), ack);
          const state = await adapter.state('exact');
          assert.equal(state.actions.length, 1);
          assert.equal(state.results.length, 1);
          assert.equal(state.actions[0].bytes, bytes);
          assert.deepEqual(await adapter.result('exact', 'actor-a', 'tx-1'), ack);
          record('exact', { ack, state });
        }
      );
      await t.test(
        'same ID with changed base, epoch, action, label, or whitespace is reused conflict',
        async () => {
          const p = proposal('changed');
          const ack = await submit('changed', 'actor-a', raw(p));
          const variants = [
            { ...p, base: { ...p.base, revision: 1 } },
            { ...p, epoch: 2 },
            proposal('changed', 'tx-1', { value: 'different' }),
            { ...p, action: { ...p.action, label: 'Different label' } },
          ];
          const outcomes = [];
          for (const bytes of [...variants.map(raw), JSON.stringify(p, null, 2)]) {
            const result = await submit('changed', 'actor-a', bytes);
            assert.equal(result.code, 'transaction-id-reused');
            outcomes.push(result);
          }
          assert.deepEqual(await adapter.result('changed', 'actor-a', 'tx-1'), ack);
          assert.equal((await adapter.head('changed')).revision, 1);
          record('changed', { outcomes });
        }
      );
      await t.test(
        'project and authenticated actor scope independent identical transaction IDs',
        async () => {
          const a = await submit('actors', 'actor-a', raw(proposal('actors')));
          const b = await submit(
            'actors',
            'actor-b',
            raw(proposal('actors', 'tx-1', { base: 1, manifest: a.manifestHash, value: 'B' }))
          );
          assert.equal(b.revision, 2);
          assert.equal(b.actorId, 'actor-b');
          const c = await submit('other-project', 'actor-a', raw(proposal('other-project')));
          assert.equal(c.revision, 1);
          assert.deepEqual(await adapter.result('actors', 'actor-a', 'tx-1'), a);
          assert.deepEqual(await adapter.result('actors', 'actor-b', 'tx-1'), b);
          assert.equal(await adapter.result('actors', 'actor-c', 'tx-1'), null);
          record('scope', { a, b, c });
        }
      );
      await t.test('current authorization precedes retained outcome lookup', async () => {
        const bytes = raw(proposal('auth'));
        await submit('auth', 'actor-a', bytes);
        assert.deepEqual(await submit('auth', 'actor-a', bytes, { authorized: false }), {
          status: 'forbidden',
        });
        assert.deepEqual(await adapter.result('auth', 'actor-a', 'tx-1', false), {
          status: 'forbidden',
        });
        assert.deepEqual(await submit('other', 'actor-a', bytes), { status: 'forbidden' });
        record('auth', { checked: true, scope: 'trusted fixture boundary; no production auth' });
      });
      await t.test(
        'retained outcome survives epoch advance without reapplying; new stale proposal is durably rejected',
        async () => {
          const bytes = raw(proposal('epoch'));
          const ack = await submit('epoch', 'actor-a', bytes);
          assert.equal((await adapter.epoch('epoch')).epoch, 2);
          assert.deepEqual(await submit('epoch', 'actor-a', bytes), ack);
          const changed = await submit(
            'epoch',
            'actor-a',
            raw(proposal('epoch', 'tx-1', { epoch: 2 }))
          );
          assert.equal(changed.code, 'transaction-id-reused');
          const staleBytes = raw(
            proposal('epoch', 'stale', { base: 1, manifest: ack.manifestHash })
          );
          const stale = await submit('epoch', 'actor-a', staleBytes);
          assert.equal(stale.code, 'epoch-stale');
          assert.deepEqual(await adapter.result('epoch', 'actor-a', 'stale'), stale);
          assert.deepEqual(await submit('epoch', 'actor-a', staleBytes), stale);
          const repair = await submit(
            'epoch',
            'actor-a',
            raw(proposal('epoch', 'repair', { base: 1, manifest: ack.manifestHash, epoch: 2 }))
          );
          assert.equal(repair.revision, 2);
          record('epoch', { ack, changed, stale, repair });
        }
      );
      await t.test(
        'base revision/hash rejection is retained; rebase requires a new transaction ID',
        async () => {
          const bytes = raw(proposal('rebase', 'invalid-base', { base: 1 }));
          const rejected = await submit('rebase', 'actor-a', bytes);
          assert.equal(rejected.code, 'base-conflict');
          assert.deepEqual(await adapter.result('rebase', 'actor-a', 'invalid-base'), rejected);
          assert.equal(
            (await submit('rebase', 'actor-a', raw(proposal('rebase', 'invalid-base')))).code,
            'transaction-id-reused'
          );
          assert.equal(
            (
              await submit(
                'rebase',
                'actor-a',
                raw(proposal('rebase', 'wrong-hash', { manifest: 'b'.repeat(64) }))
              )
            ).code,
            'base-conflict'
          );
          const accepted = await submit('rebase', 'actor-a', raw(proposal('rebase', 'new-id')));
          assert.equal(accepted.revision, 1);
          assert.deepEqual(await submit('rebase', 'actor-a', bytes), rejected);
          record('rebase', { rejected, accepted });
        }
      );
      await t.test(
        'head/action/result rollback at every partial write and retry has no retained transient failure',
        async () => {
          const observations = [];
          for (const fault of ['after-action', 'after-head', 'after-result']) {
            const project = `rollback-${fault}`;
            const initial = await adapter.state(project);
            const bytes = raw(proposal(project));
            assert.equal((await submit(project, 'actor-a', bytes, { fault })).status, 'retryable');
            assert.deepEqual(await adapter.state(project), initial);
            assert.equal(await adapter.result(project, 'actor-a', 'tx-1'), null);
            const ack = await submit(project, 'actor-a', bytes);
            assert.equal(ack.revision, 1);
            observations.push({ fault, ack });
          }
          record('rollback', { observations });
        }
      );
      await t.test(
        'concurrent base claims accept one winner and retain the other rejection',
        async () => {
          const responses = await Promise.all(
            ['a', 'b'].map((id) => submit('race', 'actor-a', raw(proposal('race', id))))
          );
          assert.equal(responses.filter((r) => r.status === 'accepted').length, 1);
          assert.equal(responses.filter((r) => r.code === 'base-conflict').length, 1);
          const state = await adapter.state('race');
          assert.equal(state.head.revision, 1);
          assert.equal(state.actions.length, 1);
          assert.equal(state.results.length, 2);
          record('race', { responses, state });
        }
      );
      await t.test(
        'strict T6 rejects duplicate keys and unknown envelope fields before storage',
        async () => {
          const p = proposal('schema');
          const unknown = await submit('schema', 'actor-a', raw({ ...p, actorId: 'spoofed' }));
          assert.equal(unknown.status, 'invalid');
          const duplicate = await submit(
            'schema',
            'actor-a',
            raw(p).replace('"epoch":1', '"epoch":1,"epoch":2')
          );
          assert.equal(duplicate.code, 'duplicate-object-key');
          assert.equal((await adapter.state('schema')).results.length, 0);
          record('schema', { unknown, duplicate });
        }
      );
      await t.test(
        'restart preserves accepted and rejected outcomes and replay reconstructs a new directory from exact bytes',
        async () => {
          const before = await adapter.state('rebase');
          await adapter.close();
          adapter = await factory(directory);
          assert.deepEqual(await adapter.state('rebase'), before);
          const old = join(run, name, 'old-checkout'),
            fresh = join(run, name, 'fresh-checkout');
          mkdirSync(old, { recursive: true });
          writeFileSync(join(old, 'unaccepted.txt'), 'must disappear');
          rmSync(old, { recursive: true });
          mkdirSync(fresh, { recursive: true });
          const replay = await adapter.state('epoch');
          assert.equal(replay.actions.length, replay.head.revision);
          for (let i = 0; i < replay.actions.length; i++) {
            const action = replay.actions[i];
            assert.equal(action.revision, i + 1);
            assert.equal(sha(action.bytes), action.hash);
            const p = JSON.parse(action.bytes);
            writeFileSync(
              join(fresh, `${p.action.operations[0].documentId}.txt`),
              p.action.operations[0].value
            );
          }
          assert.equal(readFileSync(join(fresh, 'doc-1.txt'), 'utf8'), 'Hello');
          record('restart-replay', {
            rebase: before,
            epoch: replay,
            projection: 'fixture text only, not TSX/native rendering',
          });
        }
      );
    } finally {
      await adapter.close();
    }
  });
}
after(() => {
  writeFileSync(join(run, 'evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`Evidence: ${run}`);
});
