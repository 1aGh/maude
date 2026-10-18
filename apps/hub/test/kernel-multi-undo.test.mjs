// S5.1a — the V2-1.5 §5.2 kernel extension, at the kernel layer (matrix rows
// U6, U7, U9 + the origin keys, the actionIds validation and the v1 envelope).
//
// A real kernel over a real store core (better-sqlite3 in memory). The oracle
// is the store — the accepted head and the logged action — never the kernel's
// own return value alone. Runs against both blob codecs (V2-1.9 §5.3 C4).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, test } from 'node:test';
import { gunzipSync, gzipSync } from 'node:zlib';

import { createKernel } from '../src/project-transactions/kernel.mjs';
import { laneHash } from '../src/project-transactions/lanes.mjs';
import { createStoreCore } from '../src/project-transactions/store-core.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');

const GZIP = {
  encode: (text) => gzipSync(Buffer.from(text, 'utf8')),
  decode: (stored) =>
    typeof stored === 'string' ? stored : gunzipSync(Buffer.from(stored)).toString('utf8'),
};

/** One file, artboards P and S, a shared component K — spacer lines keep edits disjoint. */
const canvas = ({ pt = 'T0', p = 'P0', s = 'S0', s2 = 'X0', k = 'K0' } = {}) =>
  [
    'export default () => (',
    '  <div>',
    `    <h2 title="${pt}">P title</h2>`,
    '    <i>a</i>',
    `    <p>${p}</p>`,
    '    <i>b</i>',
    `    <p>${s}</p>`,
    '    <i>c</i>',
    `    <p>${s2}</p>`,
    '    <i>d</i>',
    `    <b>${k}</b>`,
    '  </div>',
    ');',
    '',
  ].join('\n');

let tx = 0;
function rig(codec) {
  const db = new Database(':memory:');
  const core = createStoreCore(betterSqliteAdapter(db), codec ? { codec } : {});
  core.migrate();
  core.setMode({ mode: 'transactions' });
  core.markImported();
  const store = {};
  for (const [name, fn] of Object.entries(core)) store[name] = async (...a) => fn(...a);
  const kernel = createKernel({ store, projectId: 'p1', log: { error() {} } });
  async function propose(actor, operations, { kind = 'edit', label = null, origin } = {}) {
    const { epoch } = await kernel.state();
    const bytes = JSON.stringify({
      protocol: 1,
      projectId: 'p1',
      epoch,
      transactionId: `tx-${String(++tx).padStart(8, '0')}`,
      action: { kind, label, operations },
      ...(origin ? { origin } : {}),
    });
    return kernel.submit(bytes, { actor });
  }
  async function head(doc, lane = 'html') {
    const h = (await store.heads([doc]))[doc];
    const hash = h?.lanes?.[lane]?.hash ?? null;
    return hash ? store.blob(hash) : '';
  }
  /** Replace a lane from its current head (an edit made on the newest content). */
  async function edit(actor, doc, content, opts) {
    const base = laneHash(await head(doc));
    const r = await propose(
      actor,
      [{ op: 'lane.replace', doc, lane: 'html', content, base }],
      opts
    );
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.actionId;
  }
  async function create(actor, doc, path, content) {
    const r = await propose(actor, [{ op: 'doc.create', doc, path, lanes: { html: content } }]);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.actionId;
  }
  return { db, core, kernel, store, propose, head, edit, create };
}

const ai = (runId, chatId) => ({
  kind: 'ai',
  label: `run ${runId}`,
  origin: { runId, chatId, madeAt: 1_760_000_000_000 },
});

const F = 'ws/local/main/ui-combine';

for (const [codecName, codec] of [
  ['identity', null],
  ['gzip', GZIP],
]) {
  describe(`kernel multi-target undo (${codecName} codec)`, () => {
    test('U6 — Undo this chat: c1 runs 1 + 2 undone as ONE action; title and c2 kept; redo re-applies both', async () => {
      const r = rig(codec);
      await r.create('you', F, 'ui/combine.tsx', canvas());
      const run1 = await r.edit('you', F, canvas({ p: 'P1' }), ai('r1', 'c1'));
      const run2 = await r.edit('you', F, canvas({ p: 'P1', s: 'S1' }), ai('r2', 'c1'));
      await r.edit('you', F, canvas({ pt: 'T1', p: 'P1', s: 'S1' }));
      await r.edit('you', F, canvas({ pt: 'T1', p: 'P1', s: 'S1', s2: 'X2' }), ai('r3', 'c2'));
      const before = (await r.kernel.state()).revision;

      const u = await r.propose('you', [{ op: 'history.undo', actionIds: [run1, run2] }]);
      assert.equal(u.status, 200, JSON.stringify(u.body));
      assert.equal(u.body.kind, 'undo');
      assert.equal(await r.head(F), canvas({ pt: 'T1', s2: 'X2' }), 'as if c1 never ran');
      assert.equal((await r.kernel.state()).revision, before + 1, 'ONE new version');
      const [row] = await r.kernel.history({ limit: 1 });
      assert.equal(row.actionId, u.body.actionId);
      assert.deepEqual(row.undoes, [run1, run2], 'stored undoes = both');

      const redo = await r.propose('you', [{ op: 'history.redo', actionId: u.body.actionId }]);
      assert.equal(redo.status, 200, JSON.stringify(redo.body));
      assert.equal(redo.body.kind, 'redo');
      assert.equal(await r.head(F), canvas({ pt: 'T1', p: 'P1', s: 'S1', s2: 'X2' }));
    });

    test('U7 — c2 changed what c1 run 2 changed: run 1 undone, run 2 lane skipped and named', async () => {
      const r = rig(codec);
      const A = 'ws/local/main/ui-post';
      const B = 'ws/local/main/ui-story';
      await r.create('you', A, 'ui/post.tsx', canvas());
      await r.create('you', B, 'ui/story.tsx', canvas());
      const run1 = await r.edit('you', A, canvas({ p: 'P1' }), ai('r1', 'c1'));
      const run2 = await r.edit('you', B, canvas({ s: 'S1' }), ai('r2', 'c1'));
      const c2 = await r.edit('you', B, canvas({ s: 'S2' }), ai('r3', 'c2'));

      const u = await r.propose('you', [{ op: 'history.undo', actionIds: [run2, run1] }]);
      assert.equal(u.status, 200, JSON.stringify(u.body));
      assert.equal(await r.head(A), canvas(), 'run 1 undone');
      assert.equal(await r.head(B), canvas({ s: 'S2' }), 'c2 kept');
      assert.equal(u.body.skipped?.length, 1, JSON.stringify(u.body));
      assert.equal(u.body.skipped[0].doc, B);
      assert.equal(u.body.skipped[0].lane, 'html');
      assert.equal(u.body.skipped[0].conflictWith, c2);
      const [row] = await r.kernel.history({ limit: 1 });
      assert.deepEqual(row.undoes, [run2, run1]);
    });

    test('nothing applies → undo-conflict', async () => {
      const r = rig(codec);
      await r.create('you', F, 'ui/combine.tsx', canvas());
      const run1 = await r.edit('you', F, canvas({ s: 'S1' }), ai('r1', 'c1'));
      await r.edit('you', F, canvas({ s: 'S2' }), ai('r2', 'c2'));
      const u = await r.propose('you', [{ op: 'history.undo', actionIds: [run1] }]);
      assert.equal(u.status, 409);
      assert.equal(u.body.code, 'undo-conflict');
    });

    test('a doc a target created is deleted; redo brings it back with its content', async () => {
      const r = rig(codec);
      const D = 'ws/local/main/ui-new';
      const made = await r.propose(
        'you',
        [{ op: 'doc.create', doc: D, path: 'ui/new.tsx', lanes: { html: canvas() } }],
        ai('r1', 'c1')
      );
      const run2 = await r.edit('you', D, canvas({ k: 'K1' }), ai('r2', 'c1'));
      const u = await r.propose('you', [
        { op: 'history.undo', actionIds: [made.body.actionId, run2] },
      ]);
      assert.equal(u.status, 200, JSON.stringify(u.body));
      assert.equal((await r.store.heads([D]))[D].retired, true);
      const redo = await r.propose('you', [{ op: 'history.redo', actionId: u.body.actionId }]);
      assert.equal(redo.status, 200, JSON.stringify(redo.body));
      assert.equal((await r.store.heads([D]))[D].retired, false);
      assert.equal(await r.head(D), canvas({ k: 'K1' }));
    });

    test('a chat that edited then deleted a canvas: it comes back, as it was before the chat', async () => {
      const r = rig(codec);
      const D = 'ws/local/main/ui-gone';
      await r.create('you', D, 'ui/gone.tsx', canvas());
      const run1 = await r.edit('you', D, canvas({ k: 'K1' }), ai('r1', 'c1'));
      const del = await r.propose('you', [{ op: 'doc.delete', doc: D }], ai('r2', 'c1'));
      assert.equal(del.status, 200, JSON.stringify(del.body));
      const u = await r.propose('you', [
        { op: 'history.undo', actionIds: [run1, del.body.actionId] },
      ]);
      assert.equal(u.status, 200, JSON.stringify(u.body));
      assert.equal(u.body.skipped, undefined, JSON.stringify(u.body));
      assert.equal((await r.store.heads([D]))[D].retired, false);
      assert.equal(await r.head(D), canvas());
    });

    test('U17 — the chat still undoes after the canvas moved', async () => {
      const r = rig(codec);
      await r.create('you', F, 'ui/combine.tsx', canvas());
      const run1 = await r.edit('you', F, canvas({ p: 'P1' }), ai('r1', 'c1'));
      const run2 = await r.edit('you', F, canvas({ p: 'P1', k: 'K1' }), ai('r2', 'c1'));
      const mv = await r.propose('you', [
        { op: 'doc.move', doc: F, to: { path: 'ui/Folder/combine.tsx' } },
      ]);
      assert.equal(mv.status, 200, JSON.stringify(mv.body));
      const live = (await r.store.manifest()).docs.find((d) => !d.retired).doc;
      const u = await r.propose('you', [{ op: 'history.undo', actionIds: [run1, run2] }]);
      assert.equal(u.status, 200, JSON.stringify(u.body));
      assert.equal(await r.head(live), canvas());
    });
  });
}

describe('actionIds validation', () => {
  test('U9 — a foreign id (Tereza’s run) is forbidden, alone or mixed with your own', async () => {
    const r = rig();
    await r.create('you', F, 'ui/combine.tsx', canvas());
    const mine = await r.edit('you', F, canvas({ p: 'P1' }), ai('r1', 'c1'));
    const hers = await r.edit('tereza', F, canvas({ p: 'P1', s: 'S1' }), ai('t1', 'ct'));
    const rev = (await r.kernel.state()).revision;
    for (const ids of [[hers], [mine, hers]]) {
      const u = await r.propose('you', [{ op: 'history.undo', actionIds: ids }]);
      assert.equal(u.status, 403, JSON.stringify(u.body));
      assert.equal(u.body.code, 'forbidden');
    }
    assert.equal((await r.kernel.state()).revision, rev, 'nothing applied');
    assert.equal(await r.head(F), canvas({ p: 'P1', s: 'S1' }));
  });

  test('malformed lists are invalid: empty, 51, duplicates, non-strings, both actionId and actionIds', async () => {
    const r = rig();
    await r.create('you', F, 'ui/combine.tsx', canvas());
    const a = await r.edit('you', F, canvas({ p: 'P1' }));
    const many = Array.from({ length: 51 }, (_, i) => `a_${i}`);
    for (const op of [
      { op: 'history.undo', actionIds: [] },
      { op: 'history.undo', actionIds: many },
      { op: 'history.undo', actionIds: [a, a] },
      { op: 'history.undo', actionIds: [a, 7] },
      { op: 'history.undo', actionIds: 'a' },
      { op: 'history.undo', actionId: a, actionIds: [a] },
      { op: 'history.redo', actionIds: [] },
    ]) {
      const u = await r.propose('you', [op]);
      assert.equal(u.status, 400, `${JSON.stringify(op)} → ${JSON.stringify(u.body)}`);
      assert.equal(u.body.code, 'invalid');
    }
    const ok = Array.from({ length: 50 }, (_, i) => `a_missing_${i}`);
    const u = await r.propose('you', [{ op: 'history.undo', actionIds: ok }]);
    assert.equal(
      u.body.code,
      'dependency-missing',
      '50 ids pass validation; unknown ids are missing'
    );
  });
});

describe('origin keys', () => {
  test('runId, chatId and madeAt round-trip through the result, the log and the run/chat columns', async () => {
    const r = rig();
    await r.create('you', F, 'ui/combine.tsx', canvas());
    const origin = {
      deviceId: 'mac-1',
      sessionId: 's1',
      client: 'studio/2.0',
      runId: 'run_A-1',
      chatId: 'chat_9',
      madeAt: 1_760_000_123_456,
    };
    const res = await r.propose(
      'you',
      [
        {
          op: 'lane.replace',
          doc: F,
          lane: 'html',
          content: canvas({ p: 'P1' }),
          base: laneHash(canvas()),
        },
      ],
      { kind: 'ai', label: 'Restyle P', origin }
    );
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.origin, origin);
    const [row] = await r.kernel.history({ limit: 1 });
    assert.deepEqual(row.origin, origin);
    assert.equal(row.kind, 'ai');

    await r.edit('you', F, canvas({ p: 'P1', s: 'S1' }), ai('run_B', 'chat_9'));
    await r.edit('tereza', F, canvas({ p: 'P1', s: 'S1', k: 'K1' }), ai('run_T', 'chat_9'));
    const chat = await r.kernel.history({ chat: 'chat_9', actor: 'you' });
    assert.deepEqual(
      chat.map((h) => h.origin.runId),
      ['run_B', 'run_A-1'],
      'this person’s actions of chat X, newest first'
    );
    assert.equal((await r.kernel.history({ chat: 'chat_9' })).length, 3);
    assert.deepEqual(
      (await r.kernel.history({ run: 'run_A-1' })).map((h) => h.label),
      ['Restyle P']
    );
    assert.equal((await r.kernel.history({ kind: 'ai', actor: 'tereza' })).length, 1);
    const cols = r.db.prepare(`SELECT run_id, chat_id FROM actions ORDER BY rev`).all();
    assert.deepEqual(cols.at(-3), { run_id: 'run_A-1', chat_id: 'chat_9' });
    assert.deepEqual(cols[0], { run_id: null, chat_id: null });
  });

  test('malformed run/chat/madeAt values are dropped, not refused', async () => {
    const r = rig();
    await r.create('you', F, 'ui/combine.tsx', canvas());
    for (const bad of [
      { runId: 'has space', chatId: 'x'.repeat(65), madeAt: 1.5 },
      { runId: 7, chatId: '', madeAt: -1 },
      { runId: 'ok/no', chatId: null, madeAt: '1760000000000' },
    ]) {
      const cur = await r.head(F);
      const res = await r.propose(
        'you',
        [
          {
            op: 'lane.replace',
            doc: F,
            lane: 'html',
            content: `${cur}// ${tx}\n`,
            base: laneHash(cur),
          },
        ],
        { origin: { deviceId: 'mac-1', ...bad } }
      );
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.deepEqual(res.body.origin, { deviceId: 'mac-1' });
    }
  });
});

describe('v1 compatibility', () => {
  test('a v1 envelope and a single-target undo are stored and answered exactly as before', async () => {
    const r = rig();
    await r.create('you', F, 'ui/combine.tsx', canvas());
    const a = await r.edit('you', F, canvas({ p: 'P1' }), {
      origin: { deviceId: 'mac-1', sessionId: 's1', client: 'studio/1.9' },
    });
    const u = await r.propose('you', [{ op: 'history.undo', actionId: a }], {
      origin: { deviceId: 'mac-1', sessionId: 's1', client: 'studio/1.9' },
    });
    assert.equal(u.status, 200, JSON.stringify(u.body));
    assert.deepEqual(Object.keys(u.body).sort(), [
      'actionId',
      'actorId',
      'committedAt',
      'effects',
      'epoch',
      'kind',
      'label',
      'merged',
      'origin',
      'parentRevision',
      'projectId',
      'proposalHash',
      'protocol',
      'revision',
      'status',
      'transactionId',
    ]);
    assert.deepEqual(u.body.origin, { deviceId: 'mac-1', sessionId: 's1', client: 'studio/1.9' });
    assert.equal(await r.head(F), canvas());
    const [row] = await r.kernel.history({ limit: 1 });
    assert.equal(row.undoes, a, 'a single-target undo keeps the plain string');
    const raw = r.db.prepare(`SELECT undoes FROM actions ORDER BY rev DESC LIMIT 1`).get();
    assert.equal(raw.undoes, a);
  });

  test('a store an old hub created gains the run/chat columns on migrate and keeps its rows', () => {
    const db = new Database(':memory:');
    // The v1 actions table exactly as v1.9 created it.
    db.exec(`CREATE TABLE store_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    db.exec(`CREATE TABLE actions (
     rev INTEGER PRIMARY KEY, tx TEXT NOT NULL, actor TEXT NOT NULL, action_id TEXT NOT NULL,
     kind TEXT NOT NULL, label TEXT, origin TEXT, committed_at INTEGER NOT NULL,
     undoes TEXT)`);
    db.exec(
      `INSERT INTO store_meta (k, v) VALUES ('schema','1'),('mode','transactions'),('epoch','1'),('revision','1')`
    );
    db.exec(
      `INSERT INTO actions VALUES (1, 'tx-00000001', 'you', 'a_old', 'edit', 'old', '{"deviceId":"m"}', 5, NULL)`
    );
    const core = createStoreCore(betterSqliteAdapter(db));
    core.migrate();
    core.migrate(); // idempotent
    const cols = db
      .prepare(`SELECT name FROM pragma_table_info('actions')`)
      .all()
      .map((c) => c.name);
    assert.ok(cols.includes('run_id') && cols.includes('chat_id'), cols.join(','));
    const [row] = core.history({});
    assert.equal(row.actionId, 'a_old');
    assert.deepEqual(row.origin, { deviceId: 'm' });
    assert.equal(row.undoes, null);
  });
});

describe('blob codec', () => {
  test('gzip stores encoded bodies (raw hash + size), reads back text, and still reads pre-codec rows', () => {
    const db = new Database(':memory:');
    const plain = createStoreCore(betterSqliteAdapter(db));
    plain.migrate();
    const commit = (core, rev, hash, body) =>
      core.commit({
        epoch: 0,
        parentRevision: rev,
        actor: 'a',
        tx: `tx-codec-${hash}`,
        actionId: `a_${hash}`,
        kind: 'edit',
        proposalHash: 'p',
        blobs: [{ hash, body, size: Buffer.byteLength(body, 'utf8') }],
        result: { status: 'accepted' },
      });
    commit(plain, 0, 'h-old', 'written before the codec');
    const gz = createStoreCore(betterSqliteAdapter(db), { codec: GZIP });
    gz.migrate();
    const body = 'é'.repeat(5000);
    commit(gz, 1, 'h-new', body);
    assert.equal(gz.blob('h-new'), body);
    assert.equal(gz.blob('h-old'), 'written before the codec');
    const row = db.prepare(`SELECT body, size FROM blobs WHERE hash = 'h-new'`).get();
    assert.ok(Buffer.isBuffer(row.body), 'stored encoded');
    assert.ok(row.body.length < 1000, `gzip shrank it (${row.body.length})`);
    assert.equal(row.size, Buffer.byteLength(body, 'utf8'), 'size is the raw text');
  });
});
