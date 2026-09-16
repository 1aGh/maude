// tokens.mjs unit tests — SQLite HMAC-SHA256 store (Phase 9 Task 6).
// Covers: store init, addToken idempotence-on-label, verifyToken HMAC match +
// HUB_SECRET fallback, hash-at-rest (no raw value on disk), legacy migration.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { addToken, generateToken, readTokens, tokensDbPath, verifyToken } from '../src/tokens.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');

function withDataDir(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-tokens-'));
  try {
    return fn(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test('readTokens returns empty list on a fresh data dir', () => {
  withDataDir((dir) => {
    assert.deepEqual(readTokens(dir), { tokens: [] });
  });
});

test('generateToken produces a mau_<32hex> string by default', () => {
  const t = generateToken();
  assert.match(t, /^mau_[0-9a-f]{32}$/);
});

test('generateToken with dev=true uses the mau_dev_ prefix', () => {
  const t = generateToken({ dev: true });
  assert.match(t, /^mau_dev_[0-9a-f]{32}$/);
});

test('addToken creates a record and persists to the store', () => {
  withDataDir((dir) => {
    const rec = addToken(dir, { label: 'alice' });
    assert.equal(rec.label, 'alice');
    assert.match(rec.value, /^mau_[0-9a-f]{32}$/);
    assert.equal(typeof rec.createdAt, 'number');

    const listed = readTokens(dir).tokens;
    assert.equal(listed.length, 1);
    assert.equal(listed[0].label, 'alice');
  });
});

test('the raw token value is NEVER written to disk (hash-at-rest)', () => {
  withDataDir((dir) => {
    const rec = addToken(dir, { label: 'alice' });
    // Read the SQLite store directly and confirm the raw value is absent.
    const handle = new Database(tokensDbPath(dir), { readonly: true });
    try {
      const row = handle.prepare('SELECT label, hash FROM tokens WHERE label = ?').get('alice');
      assert.equal(row.label, 'alice');
      assert.notEqual(row.hash, rec.value, 'hash column must not equal the raw token');
      assert.match(row.hash, /^[0-9a-f]{64}$/, 'hash is a 64-hex HMAC-SHA256 digest');
      // No column anywhere holds the raw value.
      const all = handle.prepare('SELECT * FROM tokens').all();
      for (const r of all) {
        for (const v of Object.values(r)) {
          assert.notEqual(v, rec.value);
        }
      }
    } finally {
      handle.close();
    }
  });
});

test('addToken with an existing label overwrites in place (rotation shape)', () => {
  withDataDir((dir) => {
    const first = addToken(dir, { label: 'alice' });
    const second = addToken(dir, { label: 'alice' });
    assert.notEqual(first.value, second.value);

    const listed = readTokens(dir).tokens;
    assert.equal(listed.length, 1);
    // Old value no longer verifies; new value does.
    assert.equal(verifyToken(dir, first.value, ''), null);
    assert.ok(verifyToken(dir, second.value, ''));
  });
});

test('addToken rejects empty / non-string labels', () => {
  withDataDir((dir) => {
    assert.throws(() => addToken(dir, { label: '' }), /label must be a non-empty string/);
    assert.throws(() => addToken(dir, {}), /label must be a non-empty string/);
  });
});

test('verifyToken returns the matched record from the store', () => {
  withDataDir((dir) => {
    const rec = addToken(dir, { label: 'alice' });
    const hit = verifyToken(dir, rec.value, '');
    assert.ok(hit, 'expected a match');
    assert.equal(hit.label, 'alice');
    assert.equal(hit.source, 'file');
  });
});

test('verifyToken accepts HUB_SECRET fallback when no store match', () => {
  withDataDir((dir) => {
    const hit = verifyToken(dir, 'secret-shared', 'secret-shared');
    assert.ok(hit, 'expected env-secret match');
    assert.equal(hit.source, 'env');
    assert.equal(hit.label, 'env-secret');
  });
});

test('verifyToken returns null for unknown tokens', () => {
  withDataDir((dir) => {
    addToken(dir, { label: 'alice' });
    assert.equal(verifyToken(dir, 'mau_does_not_exist', 'other-secret'), null);
    assert.equal(verifyToken(dir, '', ''), null);
  });
});

test('a pre-Task-6 tokens.json is migrated into the store on first open', () => {
  withDataDir((dir) => {
    // Seed a legacy plaintext tokens.json (raw values, one with scope).
    writeFileSync(
      join(dir, 'tokens.json'),
      JSON.stringify({
        tokens: [
          { label: 'legacy', value: 'mau_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', createdAt: 1 },
          {
            label: 'scoped',
            value: 'mau_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            createdAt: 2,
            scope: 'scoped/x',
          },
        ],
      }),
      'utf8'
    );

    // First verifyToken triggers migration; the raw legacy value now matches.
    const hit = verifyToken(dir, 'mau_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', '');
    assert.ok(hit, 'legacy token should verify after migration');
    assert.equal(hit.label, 'legacy');
    assert.equal(hit.scope, '*', 'a legacy token with no scope is wildcard');

    const scopedHit = verifyToken(dir, 'mau_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', '');
    assert.ok(scopedHit);
    assert.equal(scopedHit.scope, 'scoped/x');

    // Legacy file renamed aside so it is not re-imported.
    assert.equal(readTokens(dir).tokens.length, 2);
  });
});

test('an expired credential is refused exactly like an unknown one (plan T22)', () => {
  // The last unpinned hop of the sign-in-expiry path. The rest is already
  // held: the hub words an invalid-token refusal so the peer classifies it as
  // permanent (auth-reasons.test.mjs), the peer routes that to "sign in
  // again" (sync/index.ts), and the shell shows it (team-project.e2e.ts step
  // 8). What nothing said was that a credential whose LIFETIME ran out takes
  // that path at all rather than some softer one of its own.
  const dir = mkdtempSync(join(tmpdir(), 'maude-tokens-expiry-'));
  try {
    const live = addToken(dir, { label: 'still-good', expiresAt: Date.now() + 60_000 });
    const dead = addToken(dir, { label: 'ran-out', expiresAt: Date.now() - 1_000 });
    assert.ok(verifyToken(dir, live.value, ''), 'a credential inside its lifetime still works');
    assert.equal(verifyToken(dir, dead.value, ''), null, 'an expired one is refused');
    // Indistinguishable from never having existed — same answer, and the dead
    // row is gone rather than accumulating.
    assert.equal(verifyToken(dir, generateToken(), ''), null);
    assert.ok(
      !readTokens(dir).tokens.some((t) => t.label === 'ran-out'),
      'the expired row is removed, not merely refused'
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
