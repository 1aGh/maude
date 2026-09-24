// A graceful stop takes the last backup generation — F3 S17 on the cloud cell
// (2026-09-24).
//
// A cell's disk goes with its container, and every wake restores the newest
// generation. With backups only on the interval, a platform stop or a sleep
// after inactivity came back from the PREVIOUS generation: a legacy-mode
// document written in between was simply gone (measured: 5 s and 70 s before
// a restart, both lost). The shutdown path now writes every document the store
// still has pending and takes one more generation — so the oracle here is a
// document written moments before the stop, well inside the store's debounce,
// read back from a restored generation.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { HocuspocusProvider } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { fileTarget, restoreLatest } from '../src/backup.mjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const dirs = [];
const fresh = (p) => {
  const d = mkdtempSync(join(tmpdir(), p));
  dirs.push(d);
  return d;
};
const saved = {
  MAUDE_BACKUP_TARGET: process.env.MAUDE_BACKUP_TARGET,
  MAUDE_BACKUP_INTERVAL_MS: process.env.MAUDE_BACKUP_INTERVAL_MS,
};
after(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function until(fn, ms, what) {
  const end = Date.now() + ms;
  while (!(await fn())) {
    if (Date.now() >= end) throw new Error(`${what} not reached before deadline`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('a document written just before a graceful stop is in the generation the next wake restores', {
  timeout: 60000,
}, async () => {
  const bucket = fresh('maude-shutdown-bucket-');
  const dataDir = fresh('maude-shutdown-data-');
  process.env.MAUDE_BACKUP_TARGET = `file://${bucket}`;
  // An interval that never fires inside the test: only the shutdown writes.
  process.env.MAUDE_BACKUP_INTERVAL_MS = String(3_600_000);
  const alice = addToken(dataDir, {
    label: 'alice',
    scope: '*',
    role: 'member',
    owner: 'a@x.test',
  }).value;
  const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
  await built.server.listen();
  await built.acceptedReady;
  const name = 'ws/local/main/ui-late';
  const doc = new Y.Doc();
  const provider = new HocuspocusProvider({
    url: built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1'),
    name,
    token: alice,
    document: doc,
  });
  try {
    await until(() => provider.isSynced, 30000, 'writer synced');
    doc.transact(() => doc.getText('html').insert(0, 'written moments before the stop'));
    // Reached the hub's document, but well inside the store's debounce.
    await until(
      () =>
        built.server.hocuspocus.documents.get(name)?.getText('html').toString() ===
        'written moments before the stop',
      10000,
      'the write on the hub'
    );
    const generation = await built.finalBackup();
    assert.ok(generation?.prefix, 'the shutdown took a generation');
  } finally {
    provider.destroy();
    doc.destroy();
    built.stopBackgroundWork();
    await built.server.destroy();
    built.projectStore?.close?.();
  }

  const dest = fresh('maude-shutdown-restore-');
  await restoreLatest({ target: fileTarget(`file://${bucket}`), destDir: dest });
  const db = new Database(join(dest, 'hub.db'), { readonly: true });
  const row = db.prepare('SELECT data FROM documents WHERE name = ?').get(name);
  db.close();
  assert.ok(row, 'the document is in the restored generation');
  const restored = new Y.Doc();
  Y.applyUpdate(restored, new Uint8Array(row.data));
  assert.equal(restored.getText('html').toString(), 'written moments before the stop');
});

test('the SIGTERM path takes the final generation after the commit and the journal tail', () => {
  // A source pin: the order is the argument (the generation carries both).
  const src = readFileSync(new URL('../src/server.mjs', import.meta.url), 'utf8');
  const at = src.indexOf('const shutdown = (signal) =>');
  assert.ok(at > 0, 'the shutdown handler moved — re-point this pin');
  const body = src.slice(at, at + 2500);
  const order = ['stopWorkspaceAgent()', 'stopJournal()', 'finalBackup()', 'server.destroy()'].map(
    (s) => body.indexOf(s)
  );
  assert.ok(
    order.every((i) => i > 0),
    `every step is in the handler: ${order}`
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'commit, tail, final backup, then close'
  );
});
