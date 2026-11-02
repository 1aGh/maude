// S5.2 — the proposal `fence` (V2-1.15 §5.3, L4) and the cloud path (R3).
//
// A real kernel over a real store core. L4: a publish that carries fence
// tokens is accepted iff every token equals its artboard's current fence;
// expiry alone never fences. The oracle is the store: the accepted head and
// the logged action.
//
// The cloud path runs the SAME store core behind the Durable Object host
// (`apps/cells/project-store.mjs`) and the hub's remote client
// (`store-remote.mjs`) — in process, over a better-sqlite3 stand-in for the
// DO's storage. It proves the wire (methods, the refusal data, the
// `lease-fenced` keys); it does NOT prove workerd's own SQLite or RPC, which
// needs Miniflare (not installed here — `apps/cells/project-store.test.mjs`).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';

import { createProjectStoreHost, STORE_METHODS } from '../../cells/project-store.mjs';
import { createKernel } from '../src/project-transactions/kernel.mjs';
import { laneHash } from '../src/project-transactions/lanes.mjs';
import { createStoreCore, StoreConflict } from '../src/project-transactions/store-core.mjs';
import {
  openRemoteProjectStore,
  METHODS as REMOTE_METHODS,
} from '../src/project-transactions/store-remote.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');

let tx = 0;
function rig({ remote = false } = {}) {
  const clock = { t: 5_000_000 };
  const db = new Database(':memory:');
  let store;
  let core;
  const calls = new Map();
  if (remote) {
    const adapter = betterSqliteAdapter(db);
    const storage = {
      sql: { exec: (q, ...p) => ({ toArray: () => adapter.exec(q, ...p) }) },
      transactionSync: (fn) => adapter.transaction(fn),
    };
    const host = createProjectStoreHost(storage, { now: () => clock.t });
    store = openRemoteProjectStore({
      url: 'http://project-store.internal',
      fetchImpl: async (url, init) => {
        const method = url.split('/').pop();
        calls.set(method, (calls.get(method) ?? 0) + 1);
        // A real network hop: the answer arrives on a later turn.
        await new Promise((r) => setImmediate(r));
        return Response.json(host(method, JSON.parse(init.body).args));
      },
    });
    host('state', []);
    core = createStoreCore(adapter, { now: () => clock.t });
  } else {
    core = createStoreCore(betterSqliteAdapter(db), { now: () => clock.t });
    core.migrate();
    store = {};
    for (const [name, fn] of Object.entries(core)) {
      store[name] = async (...a) => {
        calls.set(name, (calls.get(name) ?? 0) + 1);
        return fn(...a);
      };
    }
  }
  return { store, core, clock, calls, db };
}

async function kernelOn(store) {
  await store.setMode({ mode: 'transactions' });
  await store.markImported();
  const kernel = createKernel({ store, projectId: 'p1', log: { error() {} } });
  async function propose(actor, operations, extra = {}) {
    const { epoch } = await kernel.state();
    const bytes = JSON.stringify({
      protocol: 1,
      projectId: 'p1',
      epoch,
      transactionId: `tx-${String(++tx).padStart(8, '0')}`,
      action: { kind: 'edit', label: 'AI edit', operations },
      ...extra,
    });
    return { bytes, answer: await kernel.submit(bytes, { actor }) };
  }
  async function head(doc) {
    const h = (await store.heads([doc]))[doc];
    const hash = h?.lanes?.html?.hash ?? null;
    return hash ? store.blob(hash) : '';
  }
  async function create(doc) {
    const r = await propose('michal', [
      { op: 'doc.create', doc, path: `ui/${doc.slice(3)}.tsx`, lanes: { html: tsx('v0') } },
    ]);
    assert.equal(r.answer.status, 200, JSON.stringify(r.answer.body));
  }
  const replace = async (actor, doc, content, extra) =>
    propose(
      actor,
      [{ op: 'lane.replace', doc, lane: 'html', content, base: laneHash(await head(doc)) }],
      extra
    );
  return { kernel, propose, head, create, replace };
}

const P = { canvas: 'e-post', artboard: 'post-1-1' };
/** A canvas body the source gate accepts. */
function tsx(text) {
  return `export default () => <p>${text}</p>;\n`;
}
const fenceOf = (runId, granted) => ({
  runId,
  leases: granted.map((g) => ({ entry: g.canvas, artboard: g.artboard, token: g.token })),
});
const begin = (store, actor, wants, runId, device = `${actor}-mac`) =>
  store.runsBegin({
    runId,
    askId: `a_${runId.slice(2)}`,
    actor,
    device,
    origin: 'maude-chat',
    label: 'x',
    wants,
    enqueue: true,
  });

describe('the commit fence (L4)', () => {
  test('a run’s publish passes with its tokens; after a newer grant it is lease-fenced, names the keys, and stays refused', async () => {
    const { store, clock } = rig();
    const k = await kernelOn(store);
    await k.create('ui-post');
    const a = await begin(store, 'michal', [P], 'r_michal01');
    const ok = await k.replace('michal', 'ui-post', tsx('mine'), {
      fence: fenceOf('r_michal01', a.granted),
      origin: { runId: 'r_michal01', chatId: 'c1' },
    });
    assert.equal(ok.answer.status, 200, JSON.stringify(ok.answer.body));

    // Michal's Mac sleeps 40 s while Tereza waits and renews — she is granted.
    await begin(store, 'tereza', [P], 'r_tereza01');
    for (let i = 0; i < 4; i++) {
      clock.t += 10_000;
      await store.runsRenew({
        actor: 'tereza',
        device: 'tereza-mac',
        runs: [{ runId: 'r_tereza01' }],
      });
    }
    const late = await k.replace('michal', 'ui-post', tsx('late'), {
      fence: fenceOf('r_michal01', a.granted),
    });
    assert.equal(late.answer.status, 409);
    assert.equal(late.answer.body.code, 'lease-fenced');
    assert.deepEqual(late.answer.body.keys, [
      { entry: 'e-post', artboard: 'post-1-1', token: 1, fence: 2 },
    ]);
    assert.equal(
      await k.head('ui-post'),
      tsx('mine'),
      'nothing of the fenced publish is in the head'
    );
    // Terminal for these exact bytes: an identical retry gets the same answer.
    const again = await k.kernel.submit(late.bytes, { actor: 'michal' });
    assert.equal(again.body.code, 'lease-fenced');
  });

  test('expiry alone never fences: 5 minutes offline, nobody asked → the late publish is accepted (R5)', async () => {
    const { store, clock } = rig();
    const k = await kernelOn(store);
    await k.create('ui-post');
    const a = await begin(store, 'michal', [P], 'r_michal02');
    clock.t += 5 * 60_000;
    assert.equal((await store.runsList({})).runs.length, 0, 'the run lapsed');
    const late = await k.replace('michal', 'ui-post', tsx('back online'), {
      fence: fenceOf('r_michal02', a.granted),
    });
    assert.equal(late.answer.status, 200, JSON.stringify(late.answer.body));
    assert.equal(await k.head('ui-post'), tsx('back online'));
  });

  test('a lapsed holder with a waiter: the commit’s own sweep hands the artboard over first, then fences', async () => {
    const { store, clock } = rig();
    const k = await kernelOn(store);
    await k.create('ui-post');
    const a = await begin(store, 'michal', [P], 'r_michal03');
    await begin(store, 'tereza', [P], 'r_tereza03');
    // Only 31 s and no runs call in between: the publish itself must see the handoff.
    clock.t += 20_000;
    await store.runsRenew({
      actor: 'tereza',
      device: 'tereza-mac',
      runs: [{ runId: 'r_tereza03' }],
    });
    clock.t += 11_000;
    const late = await k.replace('michal', 'ui-post', tsx('late'), {
      fence: fenceOf('r_michal03', a.granted),
    });
    assert.equal(late.answer.body.code, 'lease-fenced');
  });

  test('the v1 envelope (no fence) is untouched; a malformed fence is invalid, never taken as none', async () => {
    const { store } = rig();
    const k = await kernelOn(store);
    await k.create('ui-post');
    await begin(store, 'tereza', [P], 'r_tereza04');
    const v1 = await k.replace('michal', 'ui-post', tsx('v1 edit'));
    assert.equal(v1.answer.status, 200, 'a v1 desktop writes as before, leases or not');
    for (const fence of [
      'x',
      { runId: 'nope', leases: [] },
      { runId: 'r_michal04', leases: [{ entry: 'e', artboard: 'a', token: 0 }] },
      {
        runId: 'r_michal04',
        leases: Array.from({ length: 201 }, () => ({ entry: 'e', artboard: 'a', token: 1 })),
      },
    ]) {
      const r = await k.replace('michal', 'ui-post', tsx('y'), { fence });
      assert.equal(r.answer.body.code, 'invalid', JSON.stringify(fence).slice(0, 60));
    }
  });
});

describe('the cloud path (R3, store-remote ↔ the cell host)', () => {
  test('every remote home lists the runs methods and the batch read', () => {
    for (const m of ['runsBegin', 'runsClaim', 'runsRenew', 'runsEnd', 'runsList', 'actions']) {
      assert.ok(REMOTE_METHODS.includes(m), `store-remote ${m}`);
      assert.ok(STORE_METHODS.includes(m), `cells ${m}`);
    }
  });

  test('300 rounds of two concurrent begins for a new artboard through the remote client: 0 double grants', async () => {
    const { store, core } = rig({ remote: true });
    let single = 0;
    for (let i = 0; i < 300; i++) {
      const key = { canvas: 'e-race', artboard: `ab-${i}` };
      const [x, y] = await Promise.all([
        begin(store, 'michal', [key], `r_m${String(i).padStart(6, '0')}`),
        begin(store, 'tereza', [key], `r_t${String(i).padStart(6, '0')}`),
      ]);
      const grants = x.granted.length + y.granted.length;
      assert.equal(grants, 1, `round ${i}: ${grants} grants`);
      const waiter = x.granted.length ? y : x;
      assert.equal(waiter.busy[0].position, 1);
      single += 1;
      await store.runsEnd({ runId: x.run.runId, actor: 'michal', outcome: 'done' });
      await store.runsEnd({ runId: y.run.runId, actor: 'tereza', outcome: 'done' });
    }
    assert.equal(single, 300);
    assert.equal(core.runsList({}).runs.length, 0);
  });

  test('lease-fenced crosses the wire as a StoreConflict with its keys', async () => {
    const { store, clock } = rig({ remote: true });
    const k = await kernelOn(store);
    await k.create('ui-post');
    const a = await begin(store, 'michal', [P], 'r_michal05');
    await begin(store, 'tereza', [P], 'r_tereza05');
    await store.runsEnd({ runId: 'r_michal05', actor: 'michal', outcome: 'stopped' });
    clock.t += 1;
    const late = await k.replace('michal', 'ui-post', tsx('z'), {
      fence: fenceOf('r_michal05', a.granted),
    });
    assert.equal(late.answer.body.code, 'lease-fenced');
    assert.deepEqual(late.answer.body.keys, [
      { entry: 'e-post', artboard: 'post-1-1', token: 1, fence: 2 },
    ]);
    // And at the store level the class is rebuilt with the keys.
    await assert.rejects(
      store.commit({
        epoch: (await store.state()).epoch,
        parentRevision: (await store.state()).revision,
        tx: 'tx-direct-1',
        actor: 'michal',
        proposalHash: 'h',
        actionId: 'a_direct',
        kind: 'edit',
        result: {},
        fence: fenceOf('r_michal05', a.granted),
      }),
      (e) => e instanceof StoreConflict && e.code === 'lease-fenced' && e.keys?.[0]?.fence === 2
    );
  });

  test('a multi-target undo reads its targets in ONE store call on a cell', async () => {
    const { store, calls } = rig({ remote: true });
    const k = await kernelOn(store);
    await k.create('ui-post');
    const ids = [];
    for (const v of [tsx('a'), tsx('b'), tsx('c')]) {
      const r = await k.replace('michal', 'ui-post', v, { origin: { chatId: 'c1' } });
      ids.push(r.answer.body.actionId);
    }
    calls.clear();
    const u = await k.propose('michal', [{ op: 'history.undo', actionIds: ids }]);
    assert.equal(u.answer.status, 200, JSON.stringify(u.answer.body));
    assert.equal(calls.get('actions'), 1);
    assert.equal(calls.get('action') ?? 0, 0, 'no per-target round trips');
    assert.equal(await k.head('ui-post'), tsx('v0'));
  });

  test('a store without `actions` (an older cell during a rollout) is asked one id at a time', async () => {
    const { store, calls } = rig();
    const k = await kernelOn(store);
    await k.create('ui-post');
    const ids = [];
    for (const v of [tsx('a'), tsx('b')])
      ids.push((await k.replace('michal', 'ui-post', v)).answer.body.actionId);
    store.actions = async () => {
      throw new Error('project store: no such store method');
    };
    calls.clear();
    const u = await k.propose('michal', [{ op: 'history.undo', actionIds: ids }]);
    assert.equal(u.answer.status, 200, JSON.stringify(u.answer.body));
    assert.equal(calls.get('action'), 2);
  });
});
