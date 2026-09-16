// A rate-limited designer must not keep their own bucket full forever.
//
// Found by the first complete surface certification run (2026-09-16): a
// fresh copy of a heavily edited project, sharing its token label with an
// already-synced copy of the same designer (the realistic shape — one person,
// a laptop and a desktop), stayed at "0/123 synced" for fifteen minutes while
// the hub logged 525,514 refused authentications for that label, the bucket
// pegged at ~1000/600. A fixed 60 s window cannot stay full on its own; only a
// client re-authenticating far faster than once a window can keep it there.
//
// This measures the real thing — the real Hocuspocus provider multiplexed on
// one socket, the way the studio does it — against a hub whose per-label
// ceiling is small enough to hit, and counts what the hub was asked.

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, test } from 'node:test';

import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import * as Y from 'yjs';
import { createHub } from '../src/server.mjs';
import { addToken } from '../src/tokens.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('rate-limited authentication', () => {
  test('a refused burst does not turn into a storm that pins the bucket', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-storm-'));
    dirs.push(dataDir);
    const token = addToken(dataDir, { label: 'designer', scope: '*' }).value;
    const LIMIT = 10;
    const DOCS = 40;

    // Count every authentication the hub is asked for, refused or not.
    let refused = 0;
    const origWarn = console.warn;
    console.warn = (...args) => {
      if (String(args[0]).includes('rate limit exceeded for token')) refused += 1;
    };

    const built = createHub({
      port: 0,
      dataDir,
      secret: 'test-secret',
      verbose: true,
      connRateLimit: LIMIT,
    });
    await built.server.listen();
    await built.acceptedReady;
    const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');

    const socket = new HocuspocusProviderWebsocket({ url: ws });
    const providers = [];
    try {
      for (let i = 0; i < DOCS; i++) {
        const provider = new HocuspocusProvider({
          websocketProvider: socket,
          name: `ws/local/main/ui-storm-${i}`,
          token,
          document: new Y.Doc(),
        });
        // With an injected socket the provider does not attach itself — the
        // studio does exactly this (sync/index.ts, createDefaultProviderFactory).
        // Without it nothing authenticates and this test measures nothing,
        // which is how its first version passed.
        provider.attach();
        providers.push(provider);
      }
      // Well inside ONE 60 s window. A well-behaved client asks about DOCS
      // times here — the burst — and then waits for the window it was told to
      // wait for. A storm asks thousands of times.
      await new Promise((r) => setTimeout(r, 5000));
    } finally {
      for (const p of providers) p.destroy();
      socket.destroy();
      console.warn = origWarn;
      await built.server.destroy();
    }

    const expectedRefusals = DOCS - LIMIT;
    console.log(`[storm] ${refused} refusals in 5 s (expected about ${expectedRefusals})`);
    // Not vacuous: the limit has to actually be hit for this to mean anything.
    assert.ok(
      refused >= expectedRefusals,
      `the burst never reached the limit (${refused} refusals)`
    );
    assert.ok(
      refused <= expectedRefusals * 3,
      `the hub refused ${refused} authentications in 5 s for ${DOCS} documents under a limit of ${LIMIT} — ` +
        `a paced client is refused about ${expectedRefusals} times, then waits out the window`
    );
  });

  // THE ACTUAL STORM (same run, found in the hub log once the refusals were
  // set aside): 4 618 × "too many pending unauthenticated documents
  // (maxPendingDocuments 100)". Hocuspocus closes a socket that has more than
  // 100 documents mid-authentication, and the studio multiplexes a whole
  // project on one socket — so a 123-canvas copy opens, is cut off, reconnects,
  // re-authenticates all 123, is cut off again. Each lap spends 100+ of the
  // label's allowance, which is where the pegged bucket came from.
  test('a project larger than 100 documents authenticates on one socket', {
    timeout: 60000,
  }, async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'maude-storm-'));
    dirs.push(dataDir);
    const token = addToken(dataDir, { label: 'designer', scope: '*' }).value;
    const DOCS = 150;

    const closes = [];
    const origWarn = console.warn;
    console.warn = (...args) => {
      if (String(args[0]).includes('closing connection')) closes.push(String(args[0]));
    };

    const built = createHub({ port: 0, dataDir, secret: 'test-secret', verbose: false });
    await built.server.listen();
    await built.acceptedReady;
    const ws = built.server.webSocketURL.replace('0.0.0.0', '127.0.0.1');

    const socket = new HocuspocusProviderWebsocket({ url: ws });
    const providers = [];
    let opened = 0;
    socket.on('open', () => {
      opened += 1;
    });
    try {
      const authed = [];
      for (let i = 0; i < DOCS; i++) {
        const provider = new HocuspocusProvider({
          websocketProvider: socket,
          name: `ws/local/main/ui-big-${i}`,
          token,
          document: new Y.Doc(),
        });
        authed.push(new Promise((resolve) => provider.on('authenticated', resolve)));
        provider.attach();
        providers.push(provider);
      }
      const all = Promise.all(authed).then(() => true);
      const settled = await Promise.race([
        all,
        new Promise((r) => setTimeout(() => r(false), 15000)),
      ]);
      assert.deepEqual(closes, [], 'the hub closed the project socket');
      assert.equal(settled, true, 'not every document authenticated');
      assert.equal(opened, 1, `the socket opened ${opened} times`);
    } finally {
      for (const p of providers) p.destroy();
      socket.destroy();
      console.warn = origWarn;
      await built.server.destroy();
    }
  });
});
