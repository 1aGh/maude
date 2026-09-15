// The cloud project store on REAL workerd — DDR-241 §2, plan T10/T8.
//
// The hub's acceptance kernel, unchanged, drives the store through the remote
// client (`store-remote.mjs`) → the cell's outbound route
// (`projectStoreOutbound`) → the Durable Object's RPC → `store-core` on the
// DO's own SQLite, in local workerd via Miniflare. What is proved here:
//
//   • the same kernel scenarios hold on this home as on better-sqlite3;
//   • an acknowledged commit survives SIGKILL of the whole runtime;
//   • one cell cannot see another cell's store.
//
// It is NOT a deployed-Cloudflare run (T32 owns that) and it does not run the
// container's outbound interception, which only exists on the platform.

import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { createKernel } from '../hub/src/project-transactions/kernel.mjs';
import { laneHash } from '../hub/src/project-transactions/lanes.mjs';
import { openRemoteProjectStore } from '../hub/src/project-transactions/store-remote.mjs';

function findMiniflare() {
  if (process.env.MAUDE_MINIFLARE_ENTRY) return process.env.MAUDE_MINIFLARE_ENTRY;
  const npx = join(homedir(), '.npm', '_npx');
  if (!existsSync(npx)) return null;
  for (const d of readdirSync(npx)) {
    const entry = join(npx, d, 'node_modules', 'miniflare', 'dist', 'src', 'index.js');
    if (existsSync(entry)) return entry;
  }
  return null;
}
const MINIFLARE = findMiniflare();
let BUN = null;
try {
  BUN = execFileSync('which', ['bun']).toString().trim() || null;
} catch {
  BUN = null;
}
const READY = !!MINIFLARE && !!BUN;
if (!READY) {
  console.warn(
    '[project-store] SKIPPED — needs Miniflare (MAUDE_MINIFLARE_ENTRY or an npx wrangler cache) and bun to bundle the fixture.'
  );
}

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function bundle() {
  const out = mkdtempSync(join(tmpdir(), 'cell-store-bundle-'));
  dirs.push(out);
  execFileSync(BUN, [
    'build',
    new URL('./test-fixtures/project-store-worker.mjs', import.meta.url).pathname,
    '--outfile',
    join(out, 'worker.mjs'),
    '--format',
    'esm',
    '--target',
    'browser',
    '--external',
    'cloudflare:workers',
  ]);
  return join(out, 'worker.mjs');
}

async function startWorkerd(script, persist) {
  const child = fork(
    new URL('./test-fixtures/miniflare-host.mjs', import.meta.url).pathname,
    [script, persist],
    {
      env: { ...process.env, MAUDE_MINIFLARE_ENTRY: MINIFLARE },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    }
  );
  const [msg] = await once(child, 'message');
  return { child, url: msg.url };
}

const src = (t, c = 'black') => `export default () => <h1 title="${t}" color="${c}">x</h1>;\n`;

function remote(url, tenant) {
  return openRemoteProjectStore({
    url,
    fetchImpl: (u, init) => fetch(u, { ...init, headers: { ...init.headers, 'x-tenant': tenant } }),
  });
}

function propose(kernel, epochRef, actor, operations, extra = {}) {
  const bytes = JSON.stringify({
    protocol: 1,
    projectId: 'p1',
    epoch: epochRef.epoch,
    transactionId: extra.transactionId ?? `tx_${Math.random().toString(36).slice(2)}_${Date.now()}`,
    action: { kind: 'edit', label: 'test', operations },
  });
  return kernel.submit(bytes, { actor, readOnly: false });
}

/** The kernel scenario set, run identically against any store home. */
async function scenario(store) {
  const kernel = createKernel({ store, projectId: 'p1' });
  const epoch = { epoch: 0 };
  const off = await propose(kernel, epoch, 'a', [{ op: 'dir.create', path: 'ui/X' }]);
  assert.equal(off.body.code, 'mode-off');
  epoch.epoch = (await store.setMode({ mode: 'transactions', expectEpoch: 0 })).epoch;

  const doc = 'ws/p1/main/ui-home';
  const c = await propose(kernel, epoch, 'a', [
    { op: 'doc.create', doc, path: 'ui/home.tsx', lanes: { html: src('A') } },
  ]);
  assert.equal(c.status, 200, JSON.stringify(c.body));
  // Two authors from the same base: independent attributes merge, the same one conflicts.
  const base = laneHash(src('A'));
  assert.equal(
    (
      await propose(kernel, epoch, 'a', [
        { op: 'lane.replace', doc, lane: 'html', base, content: src('B') },
      ])
    ).status,
    200
  );
  const merged = await propose(kernel, epoch, 'b', [
    { op: 'lane.replace', doc, lane: 'html', base, content: src('A', 'red') },
  ]);
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  const head = (await store.manifest()).docs.find((d) => d.doc === doc).lanes.html.hash;
  assert.equal(await store.blob(head), src('B', 'red'));
  const clash = await propose(kernel, epoch, 'b', [
    { op: 'lane.replace', doc, lane: 'html', base, content: src('C') },
  ]);
  assert.equal(clash.body.code, 'base-conflict');
  // Exact replay answers the same result; a reused id with other bytes is refused.
  const tx = 'tx_replay_same_bytes_1';
  const first = await propose(kernel, epoch, 'a', [{ op: 'dir.create', path: 'ui/Empty' }], {
    transactionId: tx,
  });
  const again = await propose(kernel, epoch, 'a', [{ op: 'dir.create', path: 'ui/Empty' }], {
    transactionId: tx,
  });
  // As a client receives them (JSON on the wire).
  assert.deepEqual(JSON.parse(JSON.stringify(again.body)), JSON.parse(JSON.stringify(first.body)));
  const reused = await propose(kernel, epoch, 'a', [{ op: 'dir.create', path: 'ui/Other' }], {
    transactionId: tx,
  });
  assert.equal(reused.body.code, 'transaction-id-reused');
  // Personal undo of b's color keeps a's title.
  const undo = await propose(kernel, epoch, 'b', [
    { op: 'history.undo', actionId: merged.body.actionId },
  ]);
  assert.equal(undo.status, 200, JSON.stringify(undo.body));
  const after = (await store.manifest()).docs.find((d) => d.doc === doc).lanes.html.hash;
  assert.equal(await store.blob(after), src('B'));
  const m = await store.manifest();
  assert.deepEqual(m.dirs, ['ui/Empty']);
  return {
    revision: (await store.state()).revision,
    history: (await store.history({ limit: 50 })).length,
  };
}

describe('the cloud project store (DO SQLite on local workerd)', { skip: !READY }, () => {
  test('the kernel scenarios hold exactly as on the self-host store', {
    timeout: 60_000,
  }, async () => {
    const script = bundle();
    const persist = mkdtempSync(join(tmpdir(), 'cell-store-persist-'));
    dirs.push(persist);
    const w = await startWorkerd(script, persist);
    try {
      const cloud = await scenario(remote(w.url, 'tenant-a'));
      const dataDir = mkdtempSync(join(tmpdir(), 'cell-store-sqlite-'));
      dirs.push(dataDir);
      // Loaded here, not at the top: better-sqlite3 lives in the hub's tree.
      const { openSqliteProjectStore } = await import(
        '../hub/src/project-transactions/store-sqlite.mjs'
      );
      const local = openSqliteProjectStore(dataDir);
      try {
        const self = await scenario(local);
        assert.deepEqual(cloud, self, 'both homes end at the same revision and history length');
      } finally {
        local.close();
      }
    } finally {
      w.child.send('stop');
      await once(w.child, 'exit');
    }
  });

  test('acknowledged commits survive SIGKILL of the runtime; cells are isolated', {
    timeout: 90_000,
  }, async () => {
    const script = bundle();
    const persist = mkdtempSync(join(tmpdir(), 'cell-store-persist-'));
    dirs.push(persist);
    let w = await startWorkerd(script, persist);
    const epoch = { epoch: 0 };
    const doc = 'ws/p1/main/ui-durable';
    let acknowledged = 0;
    try {
      const store = remote(w.url, 'tenant-a');
      epoch.epoch = (await store.setMode({ mode: 'transactions', expectEpoch: 0 })).epoch;
      const kernel = createKernel({ store, projectId: 'p1' });
      assert.equal(
        (
          await propose(kernel, epoch, 'a', [
            { op: 'doc.create', doc, path: 'ui/durable.tsx', lanes: { html: src('v0') } },
          ])
        ).status,
        200
      );
      acknowledged = (await store.state()).revision;
      let prev = src('v0');
      for (let i = 1; i <= 20; i++) {
        const next = src(`v${i}`);
        const r = await propose(kernel, epoch, 'a', [
          { op: 'lane.replace', doc, lane: 'html', base: laneHash(prev), content: next },
        ]);
        assert.equal(r.status, 200);
        acknowledged = r.body.revision;
        prev = next;
      }
      // Fire one more and kill the runtime while it is in flight.
      void propose(kernel, epoch, 'a', [
        { op: 'lane.replace', doc, lane: 'html', base: laneHash(prev), content: src('in flight') },
      ]).catch(() => {});
      w.child.kill('SIGKILL');
      await once(w.child, 'exit');
    } finally {
      if (w.child.exitCode === null && w.child.signalCode === null) w.child.kill('SIGKILL');
    }
    w = await startWorkerd(script, persist);
    try {
      const store = remote(w.url, 'tenant-a');
      const state = await store.state();
      assert.ok(
        state.revision >= acknowledged,
        `revision ${state.revision} ≥ acknowledged ${acknowledged}`
      );
      const head = (await store.manifest()).docs.find((d) => d.doc === doc).lanes.html.hash;
      const body = await store.blob(head);
      assert.ok(
        body === src('v20') || body === src('in flight'),
        'head is the last acknowledged or the in-flight one, never older'
      );
      // Exactly one action per revision — no torn commit.
      const revisions = await store.revisions({ after: 0, limit: 1000 });
      assert.equal(revisions.length, state.revision);
      // Replacing the CELL (its container class migrated, as v2 did) must
      // not touch the store: it lives in its own class, keyed by tenant.
      // (Covered structurally: the store DO is addressed by tenant name, not
      // by the cell's id — asserted by the isolation check below.)
      // Another cell sees nothing of this one.
      const other = remote(w.url, 'tenant-b');
      const o = await other.state();
      assert.equal(o.revision, 0);
      assert.equal(o.mode, 'legacy');
      assert.deepEqual((await other.manifest()).docs, []);
    } finally {
      w.child.send('stop');
      await once(w.child, 'exit');
    }
  });
});
