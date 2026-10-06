// The legacy documents' write-behind (docs-tail.mjs, followup-multiplayer-
// hardening G3b): a document written after the last backup generation must
// survive a HARD kill — the wake restores the generation, then replays the
// tail over it.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import * as Y from 'yjs';
import { fileTarget } from '../src/backup.mjs';
import { createDocsTail, parseDocsTailKey, replayDocsTail } from '../src/docs-tail.mjs';
import { isTombstoned } from '../src/tombstones.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const dirs = [];
const fresh = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const quiet = { log() {}, error() {} };

const docWith = (text) => {
  const d = new Y.Doc();
  d.getText('html').insert(0, text);
  return d;
};
const textOf = (bytes) => {
  const d = new Y.Doc();
  Y.applyUpdate(d, new Uint8Array(bytes));
  return d.getText('html').toString();
};
/** A hub.db as the Hocuspocus SQLite extension writes it. */
function hubDb(dir) {
  const db = new Database(join(dir, 'hub.db'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS "documents" ("name" varchar(255) NOT NULL, "data" blob NOT NULL, UNIQUE(name))'
  );
  return db;
}

test('a document written after the generation is back after a wake', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const tail = createDocsTail({ target, log: quiet });
  // The generation holds v1 of one canvas…
  const dataDir = fresh('docs-tail-data-');
  const db = hubDb(dataDir);
  const live = docWith('v1');
  db.prepare('INSERT INTO documents VALUES (?, ?)').run(
    'ws/l/main/ui-a',
    Buffer.from(Y.encodeStateAsUpdate(live))
  );
  // …then v2 is written, and a canvas the generation never saw.
  live.getText('html').insert(2, ' and v2');
  tail.store('ws/l/main/ui-a', live);
  tail.store('ws/l/main/ui-new', docWith('born after the generation'));
  await tail.flush();

  const res = await replayDocsTail({ target, db, dataDir, log: quiet });
  assert.equal(res.merged, 2);
  const row = (n) => db.prepare('SELECT data FROM documents WHERE name = ?').get(n)?.data;
  assert.equal(
    textOf(row('ws/l/main/ui-a')),
    'v1 and v2',
    'merged over the generation — not duplicated'
  );
  assert.equal(textOf(row('ws/l/main/ui-new')), 'born after the generation');
  db.close();
});

test('a document deleted after the generation stays deleted, and a recreated one comes back', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const tail = createDocsTail({ target, log: quiet });
  const dataDir = fresh('docs-tail-data-');
  const db = hubDb(dataDir);
  db.prepare('INSERT INTO documents VALUES (?, ?)').run(
    'ws/l/main/ui-gone',
    Buffer.from(Y.encodeStateAsUpdate(docWith('x')))
  );
  tail.remove('ws/l/main/ui-gone');
  await tail.flush();
  // A deletion then a newer state of the same name, in a later sequence.
  const covered = await tail.beginGeneration();
  assert.equal(typeof covered, 'number');
  tail.store('ws/l/main/ui-back', docWith('back'));
  tail.remove('ws/l/main/ui-back');
  await tail.flush();
  tail.store('ws/l/main/ui-back', docWith('back again'));
  await tail.flush();

  await replayDocsTail({ target, db, dataDir, log: quiet });
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM documents WHERE name = ?').get('ws/l/main/ui-gone').n,
    0
  );
  assert.equal(isTombstoned(dataDir, 'ws/l/main/ui-gone'), true);
  const back = db.prepare('SELECT data FROM documents WHERE name = ?').get('ws/l/main/ui-back');
  assert.equal(textOf(back.data), 'back again');
  assert.equal(isTombstoned(dataDir, 'ws/l/main/ui-back'), false);
  db.close();
});

test('a written generation removes exactly the sequences it covers', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const tail = createDocsTail({ target, log: quiet });
  tail.store('ws/l/main/ui-a', docWith('before the generation'));
  await tail.flush();
  const covered = await tail.beginGeneration();
  tail.store('ws/l/main/ui-b', docWith('during the snapshot'));
  await tail.flush();
  await tail.endGeneration(covered);
  const left = (await target.list('docs/')).map((o) => parseDocsTailKey(o.key));
  assert.deepEqual(
    left.map((k) => k.name),
    ['ws/l/main/ui-b'],
    'only what the generation may not hold'
  );
  // A new process continues AFTER the highest sequence left.
  const next = createDocsTail({ target, log: quiet });
  next.store('ws/l/main/ui-c', docWith('c'));
  await next.flush();
  const seqs = (await target.list('docs/')).map((o) => parseDocsTailKey(o.key).seq);
  assert.ok(Math.max(...seqs) > left[0].seq, 'a restarted hub never writes into an older sequence');
});

test('nothing is written in accepted mode, and the control document never', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  let legacy = false;
  const tail = createDocsTail({ target, writing: () => legacy, log: quiet });
  tail.store('ws/l/main/ui-a', docWith('accepted replica'));
  await tail.flush();
  assert.deepEqual(await target.list('docs/'), []);
  legacy = true;
  tail.store('maude.files', docWith('ctl'));
  tail.store('ws/l/main/ui-a', docWith('legacy'));
  await tail.flush();
  assert.deepEqual(
    (await target.list('docs/')).map((o) => parseDocsTailKey(o.key).name),
    ['ws/l/main/ui-a']
  );
});

test('a save still pending when its document was deleted never brings it back (security review M2)', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const gone = new Set();
  const tail = createDocsTail({ target, isGone: (n) => gone.has(n), log: quiet });
  tail.remove('ws/l/main/ui-x');
  gone.add('ws/l/main/ui-x');
  await tail.flush();
  // Hocuspocus stores on the last disconnect — after the deletion.
  tail.store('ws/l/main/ui-x', docWith('stale'));
  await tail.flush();
  assert.deepEqual(
    (await target.list('docs/')).map((o) => parseDocsTailKey(o.key).kind),
    ['gone']
  );
});

test('a state and a marker left in one sequence replay as deleted', async () => {
  // A crash between writing one kind and removing the other.
  const bucket = fresh('docs-tail-bucket-');
  const target = fileTarget(`file://${bucket}`);
  await target.put('docs/local/0000000001/ws%2Fl%2Fmain%2Fui-y.gone', new Uint8Array());
  await target.put(
    'docs/local/0000000001/ws%2Fl%2Fmain%2Fui-y.ystate',
    Y.encodeStateAsUpdate(docWith('superseded'))
  );
  const dataDir = fresh('docs-tail-data-');
  const db = hubDb(dataDir);
  await replayDocsTail({ target, db, dataDir, log: quiet });
  assert.equal(
    db.prepare('SELECT count(*) AS n FROM documents WHERE name = ?').get('ws/l/main/ui-y').n,
    0
  );
  assert.equal(isTombstoned(dataDir, 'ws/l/main/ui-y'), true);
  db.close();
});

test('an async target is resolved for every write', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  let resolved = 0;
  const tail = createDocsTail({
    target: async () => {
      resolved += 1;
      return target;
    },
    log: quiet,
  });
  tail.store('ws/l/main/ui-a', docWith('a'));
  await tail.flush();
  tail.store('ws/l/main/ui-b', docWith('b'));
  await tail.flush();
  assert.ok(resolved >= 3, 'the startup listing and each write');
  assert.equal((await target.list('docs/')).length, 2);
});

test('two hubs on one bucket root never replay or rotate each other (security review A4)', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const a = createDocsTail({ target, workspaceId: 'wsa', shared: true, log: quiet });
  const b = createDocsTail({ target, workspaceId: 'wsb', shared: true, log: quiet });
  a.store('home', docWith('from A'));
  b.remove('home');
  await Promise.all([a.flush(), b.flush()]);
  // B's wake: its own deletion, never A's state.
  const dataDir = fresh('docs-tail-data-');
  const db = hubDb(dataDir);
  const res = await replayDocsTail({
    target,
    db,
    dataDir,
    workspaceId: 'wsb',
    shared: true,
    log: quiet,
  });
  assert.equal(res.merged, 0);
  assert.equal(res.deleted, 1);
  // B's rotation leaves A's entry alone.
  await b.endGeneration(await b.beginGeneration());
  assert.deepEqual(
    (await target.list('docs/')).map((o) => parseDocsTailKey(o.key).ws),
    ['wsa']
  );
  // A hub that lost its identity replays nothing at a shared root.
  const none = await replayDocsTail({
    target,
    db,
    dataDir,
    workspaceId: null,
    shared: true,
    log: quiet,
  });
  assert.deepEqual(none, { state: 'empty' });
  db.close();
});

test('a deletion in accepted mode purges the legacy-era state (security review A3)', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  let legacy = true;
  const tail = createDocsTail({ target, writing: () => legacy, log: quiet });
  tail.store('ws/l/main/ui-a', docWith('legacy era'));
  tail.store('ws/l/main/ui-b', docWith('kept'));
  await tail.flush();
  legacy = false;
  tail.remove('ws/l/main/ui-a');
  await tail.flush();
  assert.deepEqual(
    (await target.list('docs/')).map((o) => parseDocsTailKey(o.key).name),
    ['ws/l/main/ui-b'],
    'no marker (the store decides), and no state to bring it back'
  );
});

test('a state still in flight when its document is deleted cannot erase the marker (security review A2)', async () => {
  const inner = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const log = [];
  let releaseState = () => {};
  const slow = {
    ...inner,
    list: (p) => inner.list(p),
    get: (k) => inner.get(k),
    async put(key, bytes) {
      log.push(`put ${key.split('.').pop()}`);
      if (key.endsWith('.ystate')) await new Promise((r) => (releaseState = r));
      return inner.put(key, bytes);
    },
    async remove(key) {
      log.push(`remove ${key.split('.').pop()}`);
      return inner.remove(key);
    },
  };
  const tail = createDocsTail({ target: slow, log: quiet });
  await tail.ready();
  tail.store('ws/l/main/ui-z', docWith('racing'));
  await new Promise((r) => setTimeout(r, 10));
  tail.remove('ws/l/main/ui-z');
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(log, ['put ystate'], 'the marker waits for the state');
  releaseState();
  await tail.flush();
  assert.deepEqual(log, ['put ystate', 'put gone', 'remove ystate']);
  assert.deepEqual(
    (await inner.list('docs/')).map((o) => parseDocsTailKey(o.key).kind),
    ['gone']
  );
});

test('a plain save issues no delete, and a flush that cannot drain gives up', async () => {
  const inner = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  let removes = 0;
  let hang = false;
  const counted = {
    ...inner,
    list: (p) => inner.list(p),
    put: (k, b) => (hang ? new Promise(() => {}) : inner.put(k, b)),
    remove: (k) => {
      removes += 1;
      return inner.remove(k);
    },
  };
  const tail = createDocsTail({ target: counted, log: quiet });
  tail.store('ws/l/main/ui-a', docWith('1'));
  await tail.flush();
  tail.store('ws/l/main/ui-a', docWith('2'));
  await tail.flush();
  assert.equal(removes, 0);
  hang = true;
  tail.store('ws/l/main/ui-a', docWith('3'));
  // flush()'s give-up timer is unref'd (it must never hold shutdown) and the
  // hung put holds nothing, so without a ref'd handle Node ends the loop first.
  const keepAlive = setTimeout(() => {}, 1_000);
  try {
    assert.equal(await tail.flush({ timeoutMs: 50 }), false);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('a wake with no tail leaves the generation as it is', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const dataDir = fresh('docs-tail-data-');
  const db = hubDb(dataDir);
  assert.deepEqual(await replayDocsTail({ target, db, dataDir, log: quiet }), { state: 'empty' });
  db.close();
});
