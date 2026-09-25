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

test('a wake with no tail leaves the generation as it is', async () => {
  const target = fileTarget(`file://${fresh('docs-tail-bucket-')}`);
  const dataDir = fresh('docs-tail-data-');
  const db = hubDb(dataDir);
  assert.deepEqual(await replayDocsTail({ target, db, dataDir, log: quiet }), { state: 'empty' });
  db.close();
});
