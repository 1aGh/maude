// A lane larger than one store row (security review A1): a Durable Object's
// SQLite refuses any value over 2 MB, a lane may be 4 MB, and the refused
// commit was an import that could never finish. The store keeps such a body in
// parts and reads it back whole.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

import {
  BLOB_PART_UNITS,
  blobParts,
  createStoreCore,
} from '../src/project-transactions/store-core.mjs';
import { betterSqliteAdapter } from '../src/project-transactions/store-sqlite.mjs';

const Database = createRequire(import.meta.url)('better-sqlite3');
const ROW_LIMIT = 2 * 1024 * 1024;

/** better-sqlite3 that refuses what a Durable Object would. */
function doLikeCore() {
  const inner = betterSqliteAdapter(new Database(':memory:'));
  const core = createStoreCore({
    exec(query, ...params) {
      for (const p of params) {
        if (typeof p === 'string' && Buffer.byteLength(p, 'utf8') > ROW_LIMIT) {
          throw new Error('SQLITE_TOOBIG: string or blob too big');
        }
      }
      return inner.exec(query, ...params);
    },
    transaction: (fn) => inner.transaction(fn),
  });
  core.migrate();
  return core;
}

let txn = 0;
const commitBody = (core, hash, body, parentRevision = 0) =>
  core.commit({
    epoch: 0,
    parentRevision,
    actor: 'a',
    tx: `tx-${++txn}`,
    actionId: `act-${txn}`,
    kind: 'lane.replace',
    proposalHash: 'p',
    blobs: [{ hash, body, size: Buffer.byteLength(body, 'utf8') }],
    result: { status: 'accepted' },
  });

test('a 4 MB lane is kept and read back whole', () => {
  const core = doLikeCore();
  // Three-byte characters: 1.4 M units is ~4.2 MB of UTF-8, twice the row limit.
  const body = '€'.repeat(1_400_000);
  commitBody(core, 'big', body);
  assert.equal(core.blob('big'), body);
});

test('a part boundary never cuts a surrogate pair', () => {
  const body = `${'a'.repeat(BLOB_PART_UNITS - 1)}😀${'b'.repeat(10)}`;
  const parts = blobParts(body);
  assert.equal(parts.join(''), body);
  for (const p of parts) assert.doesNotMatch(p, /^[\udc00-\udfff]|[\ud800-\udbff]$/);
  const core = doLikeCore();
  commitBody(core, 'pair', body);
  assert.equal(core.blob('pair'), body);
});

test('small and empty bodies stay in one row, and a blob is written once', () => {
  const core = doLikeCore();
  commitBody(core, 'small', 'hello');
  commitBody(core, 'empty', '', 1);
  commitBody(core, 'small', 'hello', 2);
  assert.equal(core.blob('small'), 'hello');
  assert.equal(core.blob('empty'), '');
  assert.equal(core.blob('absent'), null);
});
