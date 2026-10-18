// S5.2 — the runs routes on a real hub (V2-1.15 §5.3): R2 (the HTTP race,
// two bearers), S2 (awareness `holding`), S3 (roles), S4 (canvas scope), the
// `runs-v1` capability, the `{t:'runs'}` poke, and the S5.1a history filters.
//
// Plus the v1-client compatibility pin: a desktop that predates every one of
// these (no fence, no runs, no filters) reads and writes exactly as before.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';
import { parsePoke } from '../src/files-ctl.mjs';
import { createAcceptedRevisions } from '../src/project-transactions/hub-integration.mjs';
import { createStoreCore } from '../src/project-transactions/store-core.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';
import { createRunsPoke, RUNS_CAPABILITY, sanitizeHoldingAwareness } from '../src/runs-routes.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const dirs = [];
const tmp = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function startHub() {
  const dataDir = tmp('maude-runs-hub-');
  const tok = (label, extra) => addToken(dataDir, { label, ...extra }).value;
  const michal = tok('michal', { scope: '*', role: 'member', owner: 'michal@x.test' });
  const tereza = tok('tereza', { scope: '*', role: 'member', owner: 'tereza@x.test' });
  const viewer = tok('viewer', { scope: '*', readOnly: true });
  const scoped = tok('post-only', { scope: 'post', role: 'member', owner: 'ondra@x.test' });
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  const http = built.server.httpURL.replace('0.0.0.0', '127.0.0.1');
  const call = (token) => async (method, path, body) => {
    const res = await fetch(`${http}/api/projects/current/v1/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return {
    built,
    http,
    michal: call(michal),
    tereza: call(tereza),
    viewer: call(viewer),
    scoped: call(scoped),
    stop: () => built.server.destroy?.() ?? built.server.close?.(),
  };
}

const P = { canvas: 'path:.design/post.tsx', artboard: 'post-1-1' };
const ask = (runId, wants, extra = {}) => ({
  runId,
  askId: `a_${runId.slice(2)}`,
  chatId: 'c1',
  origin: 'maude-chat',
  label: 'Make it greener',
  device: 'mac-1',
  wants,
  enqueue: true,
  ...extra,
});

describe('the runs routes on a real hub', () => {
  test('R2: 300 rounds of two bearers racing POST runs for a new artboard — 0 double grants, FIFO exact', {
    timeout: 120000,
  }, async () => {
    const hub = await startHub();
    try {
      let double = 0;
      let single = 0;
      for (let i = 0; i < 300; i++) {
        const key = { canvas: 'path:.design/race.tsx', artboard: `ab-${i}` };
        const id = String(i).padStart(6, '0');
        const [a, b] = await Promise.all([
          hub.michal('POST', 'runs', ask(`r_m${id}`, [key])),
          hub.tereza('POST', 'runs', ask(`r_t${id}`, [key])),
        ]);
        assert.equal(a.status, 200, JSON.stringify(a.body));
        assert.equal(b.status, 200, JSON.stringify(b.body));
        const grants = a.body.granted.length + b.body.granted.length;
        if (grants === 1) single += 1;
        else double += 1;
        const waiter = a.body.granted.length ? b.body : a.body;
        const holder = a.body.granted.length ? a.body : b.body;
        assert.equal(waiter.busy[0].position, 1);
        assert.equal(waiter.busy[0].heldBy.runId, holder.run.runId);
        await hub.michal('POST', `runs/r_m${id}/end`, { outcome: 'done' });
        await hub.tereza('POST', `runs/r_t${id}/end`, { outcome: 'done' });
      }
      assert.equal(double, 0);
      assert.equal(single, 300);
      const list = await hub.michal('GET', 'runs');
      assert.deepEqual(list.body.runs, []);
    } finally {
      await hub.stop();
    }
  });

  test('begin → claim → renew → end, the handoff, and GET runs?after=', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      const a = await hub.michal('POST', 'runs', ask('r_michal01', [P]));
      assert.deepEqual(a.body.granted, [{ ...P, token: 1 }]);
      assert.equal(a.body.run.actor, 'michal@x.test', 'the bearer is the actor, never the body');
      const b = await hub.tereza('POST', 'runs', ask('r_tereza01', [P], { device: 'mac-2' }));
      assert.equal(b.body.busy[0].heldBy.label, 'Make it greener');
      const c = await hub.michal('POST', 'runs/r_michal01/claim', {
        keys: [{ canvas: P.canvas, artboard: 'square' }],
      });
      assert.deepEqual(c.body.granted, [{ canvas: P.canvas, artboard: 'square', token: 1 }]);
      const r = await hub.michal('POST', 'runs/renew', {
        device: 'mac-1',
        runs: [{ runId: 'r_michal01', state: 'needs-you' }, { runId: 'r_tereza01' }],
      });
      assert.equal(r.body.runs[0].run.state, 'needs-you');
      assert.deepEqual(r.body.runs[1], { runId: 'r_tereza01', ended: 'unknown' }, 'not yours');
      const seq = (await hub.michal('GET', 'runs')).body.seq;
      assert.deepEqual((await hub.michal('GET', `runs?after=${seq}`)).body, {
        seq,
        unchanged: true,
      });
      const e = await hub.michal('POST', 'runs/r_michal01/end', { outcome: 'done' });
      assert.deepEqual(e.body.granted, [{ runId: 'r_tereza01', ...P, token: 2 }]);
      const ended = await hub.michal('POST', 'runs/r_michal01/claim', { keys: [P] });
      assert.equal(ended.status, 409);
      assert.deepEqual(ended.body, { code: 'ended', outcome: 'done' });
      const forbidden = await hub.michal('POST', 'runs/r_tereza01/end', { outcome: 'done' });
      assert.equal(forbidden.status, 403);
      const bad = await hub.michal('POST', 'runs', { runId: 'x' });
      assert.equal(bad.status, 400);
      assert.equal((await hub.michal('GET', 'runs/r_tereza01/end')).status, 405);
    } finally {
      await hub.stop();
    }
  });

  test('S7: the 21st live run of one person is 429 capacity', { timeout: 60000 }, async () => {
    const hub = await startHub();
    try {
      for (let i = 0; i < 20; i++) {
        const r = await hub.michal('POST', 'runs', ask(`r_cap${String(i).padStart(4, '0')}`, []));
        assert.equal(r.status, 200);
      }
      const over = await hub.michal('POST', 'runs', ask('r_cap0020', []));
      assert.equal(over.status, 429);
      assert.equal(over.body.code, 'capacity');
    } finally {
      await hub.stop();
    }
  });

  test('S3: a read-only bearer is refused every write and may read', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      await hub.michal('POST', 'runs', ask('r_michal02', [P]));
      for (const [path, body] of [
        ['runs', ask('r_viewer01', [P])],
        ['runs/r_michal02/claim', { keys: [P] }],
        ['runs/renew', { device: 'mac-1', runs: [{ runId: 'r_michal02' }] }],
        ['runs/r_michal02/end', { outcome: 'done' }],
      ]) {
        const r = await hub.viewer('POST', path, body);
        assert.equal(r.status, 403, path);
        // The hub's own read-only door answers first; the runs gate behind it
        // is pinned at the coordinator level below.
        assert.equal(r.body.reason, 'read-only', JSON.stringify(r.body));
      }
      const list = await hub.viewer('GET', 'runs');
      assert.equal(list.status, 200);
      assert.equal(list.body.runs.length, 1, 'View only: they see the run');
      assert.equal(JSON.stringify(list.body).includes('prompt'), false);
    } finally {
      await hub.stop();
    }
  });

  test('S3/S4: a canvas-scoped member can lease only their canvas, and GET shows only runs on it', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      const other = { canvas: 'path:.design/other.tsx', artboard: 'hero' };
      const out = await hub.scoped('POST', 'runs', ask('r_ondra001', [other]));
      assert.equal(out.status, 403);
      const mixed = await hub.scoped('POST', 'runs', ask('r_ondra002', [P, other]));
      assert.equal(mixed.status, 403, 'one key outside is a refusal, not a partial grant');
      const unknown = await hub.scoped(
        'POST',
        'runs',
        ask('r_ondra003', [{ canvas: 'e-unknown', artboard: 'x' }])
      );
      assert.equal(unknown.status, 403, 'an entry that names no document fails closed');
      const ok = await hub.scoped('POST', 'runs', ask('r_ondra004', [P]));
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
      await hub.michal('POST', 'runs', ask('r_michal03', [other]));
      await hub.michal('POST', 'runs', ask('r_michal04', [P, { ...other, artboard: 'footer' }]));
      const mine = await hub.scoped('GET', 'runs');
      const ids = mine.body.runs.map((r) => r.runId).sort();
      assert.deepEqual(ids, ['r_michal04', 'r_ondra004']);
      const both = mine.body.runs.find((r) => r.runId === 'r_michal04');
      assert.deepEqual(
        [...both.artboards, ...both.waitingFor].map((k) => k.canvas),
        [P.canvas, P.canvas].slice(0, both.artboards.length + both.waitingFor.length),
        'nothing on the other canvas'
      );
      const all = await hub.michal('GET', 'runs');
      assert.equal(all.body.runs.length, 3);
    } finally {
      await hub.stop();
    }
  });

  test('capabilities: /health says runs-v1; bootstrap says runs + undoTargets; nothing taken away', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      const health = await (await fetch(`${hub.http}/health`)).json();
      assert.ok(health.capabilities.includes(RUNS_CAPABILITY));
      assert.ok(health.capabilities.includes('format-v2'));
      assert.ok(health.capabilities.includes('annotations-v2'));
      const boot = await hub.michal('GET', 'bootstrap');
      assert.equal(boot.status, 200);
      assert.equal(boot.body.capabilities.runs, 'runs-v1');
      assert.equal(boot.body.capabilities.undoTargets, 50);
      assert.ok(boot.body.capabilities.operations.includes('history.undo'));
      assert.deepEqual(boot.body.capabilities.lanes, [
        'html',
        'css',
        'meta',
        'annotations',
        'comments',
      ]);
    } finally {
      await hub.stop();
    }
  });

  test('S2: the hub stamps `holding.actor` and drops holds from read-only connections (the real hook)', {
    timeout: 60000,
  }, async () => {
    const hub = await startHub();
    try {
      const run = async (user) => {
        const states = new Map([
          [
            1,
            {
              user: { name: 'x' },
              holding: { artboard: 'p', element: 'headline', at: 1, actor: 'spoof@x' },
              editing: { a: 1 },
            },
          ],
          [2, { user: { name: 'y' } }],
        ]);
        await hub.built.server.hocuspocus.hooks('beforeHandleAwareness', {
          document: { name: 'post' },
          documentName: 'post',
          states,
          context: { user },
          connection: {},
        });
        return states;
      };
      const editor = await run({ name: 'michal', email: 'michal@x.test', readOnly: false });
      assert.equal(editor.get(1).holding.actor, 'michal@x.test');
      assert.deepEqual(editor.get(1).editing, { a: 1 });
      assert.deepEqual(editor.get(2), { user: { name: 'y' } });
      const viewer = await run({ name: 'viewer', readOnly: true });
      assert.equal('holding' in viewer.get(1), false);
      assert.equal('editing' in viewer.get(1), false);
    } finally {
      await hub.stop();
    }
  });
});

describe('sanitizeHoldingAwareness (unit)', () => {
  test('no user on a client connection → stripped; server-side state → untouched; a non-object hold → dropped', () => {
    const s1 = new Map([[1, { holding: { artboard: 'p', element: 'e', at: 1 } }]]);
    sanitizeHoldingAwareness({ context: undefined, connection: {}, states: s1 });
    assert.equal('holding' in s1.get(1), false);
    const s2 = new Map([[1, { holding: { artboard: 'p', element: 'e', at: 1 } }]]);
    sanitizeHoldingAwareness({ context: undefined, connection: undefined, states: s2 });
    assert.ok(s2.get(1).holding);
    const s3 = new Map([
      [1, { holding: 'everything' }],
      [2, { holding: null }],
    ]);
    sanitizeHoldingAwareness({ context: { user: { name: 'm' } }, connection: {}, states: s3 });
    assert.equal('holding' in s3.get(1), false);
    assert.equal(s3.get(2).holding, null, 'null = not holding, kept');
  });

  test('S2.18: a hold is rebuilt from its known keys; an oversized or odd-shaped one is dropped', () => {
    const user = { context: { user: { email: 'tereza@x.test' } }, connection: {} };
    const ok = new Map([
      [1, { holding: { artboard: 'p', element: 'cta', at: 5, actor: 'boss@x', lease: 'all' } }],
    ]);
    sanitizeHoldingAwareness({ ...user, states: ok });
    assert.deepEqual(ok.get(1).holding, {
      artboard: 'p',
      element: 'cta',
      at: 5,
      actor: 'tereza@x.test',
    });
    const big = new Map([
      [1, { holding: { artboard: 'p', element: 'cta', at: 5, print: 'x'.repeat(100_000) } }],
      [2, { holding: { artboard: 'p'.repeat(500), element: 'cta', at: 5 } }],
      [3, { holding: { artboard: 'p', element: 'cta', at: 'soon' } }],
      [4, { holding: [1, 2] }],
    ]);
    sanitizeHoldingAwareness({ ...user, states: big });
    for (const id of [1, 2, 3, 4]) assert.equal('holding' in big.get(id), false, `state ${id}`);
  });
});

describe('the runs poke and the history filters (coordinator level)', () => {
  function coordinator() {
    const db = new Database(':memory:');
    const core = createStoreCore(betterSqliteAdapter(db));
    core.migrate();
    core.setMode({ mode: 'transactions' });
    core.markImported();
    const store = {};
    for (const [name, fn] of Object.entries(core)) store[name] = async (...a) => fn(...a);
    const frames = [];
    const documents = new Map([
      ['maude.files', { broadcastStateless: (p) => frames.push(p), getConnections: () => [] }],
    ]);
    const poke = createRunsPoke({
      instance: { documents },
      setTimeoutImpl: (fn) => {
        fn();
        return null;
      },
    });
    const acc = createAcceptedRevisions({
      server: { hocuspocus: { documents } },
      store,
      projectId: 'local',
      canvasGroups: () => [{ label: 'UI', path: 'ui' }],
      designRel: '.design',
      deleteDocument: () => {},
      reviveDocument: () => {},
      storeDurable: true,
      switchGraceMs: 0,
      runsPoke: poke,
      log: { warn() {}, error() {}, log() {} },
    });
    const route = async (
      method,
      path,
      body,
      who = { actor: 'michal', readOnly: false, scope: '*' }
    ) => {
      let answered = null;
      const payload = body === undefined ? '' : JSON.stringify(body);
      await acc.handleRoutes({
        path: `/api/projects/local/v1/${path.split('?')[0]}`,
        method,
        query: Object.fromEntries(new URLSearchParams(path.split('?')[1] ?? '')),
        request: {
          headers: {},
          async *[Symbol.asyncIterator]() {
            if (payload) yield Buffer.from(payload);
          },
        },
        auth: () => who,
        respondJson: (status, b) => {
          answered = { status, body: b };
        },
      });
      return answered;
    };
    return { acc, store, frames, route };
  }

  test('a change sends {t:"runs", seq}; a v1 peer’s parsePoke ignores it', async () => {
    const { frames, route } = coordinator();
    const r = await route('POST', 'runs', ask('r_poke0001', [P]));
    assert.equal(r.status, 200);
    assert.equal(frames.length, 1);
    const frame = JSON.parse(frames[0]);
    assert.deepEqual(frame, { t: 'runs', seq: r.body.seq });
    assert.equal(parsePoke(frames[0]), null, 'v1 studios drop an unknown t');
    await route('GET', 'runs');
    assert.equal(frames.length, 1, 'a read pokes nobody');
  });

  test('the runs gate itself refuses a read-only caller every write (behind the hub door)', async () => {
    const { route } = coordinator();
    const viewer = { actor: 'v', readOnly: true, scope: '*' };
    for (const path of ['runs', 'runs/r_poke0001/claim', 'runs/renew', 'runs/r_poke0001/end']) {
      const r = await route('POST', path, { runId: 'r_view0001' }, viewer);
      assert.equal(r.status, 403, path);
      assert.equal(r.body.code, 'forbidden');
    }
    assert.equal((await route('GET', 'runs', undefined, viewer)).status, 200);
  });

  test('GET history forwards chat / run / actor / kind (S5.1a)', async () => {
    const { acc, route } = coordinator();
    const submit = (actor, op, origin) =>
      acc.kernel.submit(
        JSON.stringify({
          protocol: 1,
          projectId: 'local',
          epoch: 1,
          transactionId: `tx-hist-${Math.random().toString(36).slice(2, 12)}`,
          action: { kind: 'edit', label: 'x', operations: [op] },
          ...(origin ? { origin } : {}),
        }),
        { actor }
      );
    const a = await submit(
      'michal',
      { op: 'dir.create', path: 'ui/A' },
      { chatId: 'c1', runId: 'r_hist0001' }
    );
    assert.equal(a.status, 200, JSON.stringify(a.body));
    await submit('michal', { op: 'dir.create', path: 'ui/B' }, { chatId: 'c2' });
    await submit('tereza', { op: 'dir.create', path: 'ui/C' }, { chatId: 'c1' });
    const byChat = await route('GET', 'history?chat=c1&actor=michal');
    assert.deepEqual(
      byChat.body.history.map((h) => h.actionId),
      [a.body.actionId]
    );
    assert.equal((await route('GET', 'history?run=r_hist0001')).body.history.length, 1);
    assert.equal((await route('GET', 'history')).body.history.length, 3, 'unfiltered as in v1');
  });

  test('v1 client compatibility: bootstrap, a fence-less proposal, revisions and history answer as before', async () => {
    const { acc, route } = coordinator();
    const boot = await route('GET', 'bootstrap');
    for (const k of [
      'protocol',
      'projectId',
      'capabilities',
      'limits',
      'you',
      'formatVersion',
      'docs',
      'dirs',
    ])
      assert.ok(k in boot.body, `bootstrap.${k}`);
    // A v1 desktop sends the v1 envelope, with a lease held by somebody else's AI.
    await route(
      'POST',
      'runs',
      ask('r_other001', [{ canvas: 'path:.design/ui/a.tsx', artboard: 'x' }]),
      {
        actor: 'tereza',
        readOnly: false,
        scope: '*',
      }
    );
    const v1 = await acc.kernel.submit(
      JSON.stringify({
        protocol: 1,
        projectId: 'local',
        epoch: boot.body.epoch,
        transactionId: 'tx-v1-desktop-1',
        origin: { deviceId: 'old-mac', sessionId: 's', client: 'maude/1.9.1' },
        action: { kind: 'edit', label: 'v1', operations: [{ op: 'dir.create', path: 'ui/V1' }] },
      }),
      { actor: 'michal' }
    );
    assert.equal(v1.status, 200, JSON.stringify(v1.body));
    assert.equal('undoes' in v1.body, false);
    const revs = await route('GET', 'revisions?after=0');
    assert.equal(revs.status, 200);
    assert.equal(revs.body.revisions.length, 1);
    const hist = await route('GET', 'history');
    assert.equal(hist.body.history[0].undoes, null);
    // The runs ride `/v1/runs*` only; a v1 desktop never names them, and the
    // general route shape still 404s nothing it used to answer.
    assert.equal((await route('GET', 'mode')).status, 200);
  });
});
