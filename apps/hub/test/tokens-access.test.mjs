// Peer tokens carry the access claim — V2-1.7 §5.4 (S9.2).
//
// A canvas-only or granted session's claim is stored at mint in the `access`
// column (JSON), and NULL means `legacyClaim(role)` — every token minted before
// this shipped. Rotation replaces a secret, never a capability: dropping the
// claim on rotate would turn a one-canvas guest into a role-less row, and a
// role-less row would read as whatever the next door defaults to.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { addToken, rotateToken, tokensDbPath, verifyToken } from '../src/tokens.mjs';

const require = createRequire(import.meta.url);

function withDir(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-tokens-access-'));
  try {
    return fn(dataDir);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
}

const CLAIM = {
  v: 1,
  role: null,
  grants: [
    { c: 'ui/a.tsx', r: 'viewer' },
    { c: 'ui/b.tsx', r: 'member' },
  ],
};

test('the access claim is written at mint and read back by verify', () =>
  withDir((dataDir) => {
    const minted = addToken(dataDir, { label: 'guest', scope: '*', role: null, access: CLAIM });
    assert.deepEqual(minted.access, CLAIM);
    const match = verifyToken(dataDir, minted.value, '');
    assert.deepEqual(match.access, CLAIM);
    // `read_only` stays the projection "no edit on any canvas" only where the
    // claim says so — the caller decides it; the store keeps both.
    assert.equal(match.role, undefined);
  }));

test('rotateToken preserves the access claim', () =>
  withDir((dataDir) => {
    addToken(dataDir, { label: 'guest', scope: '*', access: CLAIM, readOnly: false });
    const rotated = rotateToken(dataDir, 'guest');
    assert.deepEqual(rotated.access, CLAIM);
    assert.deepEqual(verifyToken(dataDir, rotated.value, '').access, CLAIM);
  }));

test('a token without a claim has no access field (NULL = legacyClaim(role))', () =>
  withDir((dataDir) => {
    const minted = addToken(dataDir, { label: 'm', scope: '*', role: 'member' });
    assert.equal(minted.access, undefined);
    const match = verifyToken(dataDir, minted.value, '');
    assert.equal(match.access, undefined);
    assert.equal(match.role, 'member');
  }));

test('a claim that is not an object is refused at mint, not stored', () =>
  withDir((dataDir) => {
    assert.throws(() => addToken(dataDir, { label: 'x', scope: '*', access: 'owner' }), /access/);
    assert.throws(() => addToken(dataDir, { label: 'x', scope: '*', access: { v: 2 } }), /access/);
  }));

test('an unreadable stored claim holds nothing rather than falling back to the role', () =>
  withDir((dataDir) => {
    const minted = addToken(dataDir, { label: 'g', scope: '*', role: 'member', access: CLAIM });
    // Corrupt the column behind the store's back.
    const Database = require('better-sqlite3');
    const raw = new Database(tokensDbPath(dataDir));
    raw.prepare("UPDATE tokens SET access = '{not json' WHERE label = 'g'").run();
    raw.close();
    const match = verifyToken(dataDir, minted.value, '');
    assert.deepEqual(match.access, { v: 1, role: null });
  }));
