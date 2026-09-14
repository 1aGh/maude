// Phase 9 Task 6 — auth + transport hardening.
//   - WSS boot guard: refuse plaintext HTTP to a non-loopback host.
//   - Per-token connection rate limit (100 auths / 60s window).

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { CONN_RATE_LIMIT_MAX, checkConnRateLimit, createHub } from '../src/server.mjs';

async function withDataDir(fn) {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-hub-authh-'));
  try {
    return await fn(dataDir);
  } finally {
    // Hocuspocus initializes SQLite in an asynchronous onConfigure hook.
    // Let it finish before removing the fixture directory.
    await new Promise((resolve) => setImmediate(resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
}

// ----------------------------------------------------------- WSS boot guard

test('createHub refuses plaintext HTTP to a non-loopback public host', async () => {
  await withDataDir((dataDir) => {
    assert.throws(
      () => createHub({ port: 0, dataDir, publicUrl: 'http://maude-hub.example.com' }),
      /refusing to serve a public hub over plaintext HTTP/
    );
  });
});

test('createHub allows plaintext HTTP to localhost (local dev)', async () => {
  await withDataDir((dataDir) => {
    assert.doesNotThrow(() => createHub({ port: 0, dataDir, publicUrl: 'http://localhost:1234' }));
    assert.doesNotThrow(() => createHub({ port: 0, dataDir, publicUrl: 'http://127.0.0.1:1234' }));
  });
});

test('createHub allows plaintext HTTP to a public host when insecureHttp=true', async () => {
  await withDataDir((dataDir) => {
    assert.doesNotThrow(() =>
      createHub({
        port: 0,
        dataDir,
        publicUrl: 'http://maude-hub.example.com',
        insecureHttp: true,
      })
    );
  });
});

test('createHub allows https:// to a public host', async () => {
  await withDataDir((dataDir) => {
    assert.doesNotThrow(() =>
      createHub({ port: 0, dataDir, publicUrl: 'https://maude-hub.example.com' })
    );
  });
});

// --------------------------------------------------- per-token rate limit

test('checkConnRateLimit permits up to CONN_RATE_LIMIT_MAX then rejects', () => {
  const buckets = new Map();
  for (let i = 0; i < CONN_RATE_LIMIT_MAX; i++) {
    assert.equal(checkConnRateLimit(buckets, 'alice'), true, `auth #${i + 1} should pass`);
  }
  // The (MAX + 1)th auth within the window is rejected.
  assert.equal(checkConnRateLimit(buckets, 'alice'), false);
});

test('checkConnRateLimit buckets are per-token (one token does not throttle another)', () => {
  const buckets = new Map();
  for (let i = 0; i < CONN_RATE_LIMIT_MAX + 5; i++) checkConnRateLimit(buckets, 'alice');
  // bob has its own fresh budget.
  assert.equal(checkConnRateLimit(buckets, 'bob'), true);
});

test('checkConnRateLimit resets after the window elapses', () => {
  const buckets = new Map();
  for (let i = 0; i < CONN_RATE_LIMIT_MAX + 1; i++) checkConnRateLimit(buckets, 'alice');
  assert.equal(checkConnRateLimit(buckets, 'alice'), false);
  // Force the window to look expired (61s ago) and confirm the budget resets.
  buckets.get('alice').windowStart = Date.now() - 61_000;
  assert.equal(checkConnRateLimit(buckets, 'alice'), true);
});
