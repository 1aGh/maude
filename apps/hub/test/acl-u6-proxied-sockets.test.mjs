// S9.12b — V2-1.16 U6, the cell half: a socket opened under a wider claim is closed.
//
// The studio proxy splices the studio's own live sockets (inspector, collab, canvas HMR)
// as raw byte pipes, so the hub's Hocuspocus kick (`kickSessionsForLabel`) never reached
// them: a person removed from the project kept hearing every frame on a socket opened
// before the removal. The proxy now tracks each upgrade by who opened it and destroys it
//   - by e-mail (both doors) when `endSessions` runs — the graced `narrowed` / `ended`
//     `maude.access` notice (S9.6, `POST /internal/access-changed` included);
//   - by token label (the shell door) on every `kickLabel` — sign-out, token rotate /
//     delete, the revocation sweep;
// and only those: another person's sockets, and a `raised` notice, close nothing.

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { createAccessService } from '../src/routes-v2/access.mjs';
import { browserSession } from '../src/server.mjs';
import { createStudioProxy } from '../src/studio-proxy.mjs';
import { addToken } from '../src/tokens.mjs';

const SHELL = 'https://alligators.cloud.maude.sh';

function fakeSocket() {
  const s = new EventEmitter();
  s.destroyed = false;
  s.written = [];
  s.write = (x) => s.written.push(String(x));
  s.destroy = () => {
    if (s.destroyed) return;
    s.destroyed = true;
    s.emit('close');
  };
  return s;
}

function makeProxy() {
  const forwarded = [];
  const proxy = createStudioProxy({
    upstream: () => ({ ok: true, port: 4399 }),
    canvasUpstream: () => ({ ok: true, port: 4400 }),
    publicUrl: SHELL,
    forwardUpgrade: (args) => forwarded.push(args),
  });
  return { proxy, forwarded };
}

const verifyToken = (t) =>
  t === 'max-cap'
    ? { ok: true, subject: 'max@x.test', role: 'member' }
    : t === 'olga-cap'
      ? { ok: true, subject: 'olga@x.test', role: 'owner' }
      : { ok: false };

function shellUpgrade(proxy, session, url = '/_ws') {
  const socket = fakeSocket();
  proxy.handleUpgrade({
    request: { headers: { upgrade: 'websocket', origin: SHELL }, url },
    socket,
    head: null,
    session,
  });
  return socket;
}

function canvasUpgrade(proxy, token, url = '/_ws/collab/ui-a') {
  const socket = fakeSocket();
  proxy.handleCanvasUpgrade({
    request: { headers: { upgrade: 'websocket' }, url: `${url}?t=${token}` },
    socket,
    head: null,
    verifyToken,
  });
  return socket;
}

const MAX = { email: 'max@x.test', role: 'member', sessionKey: 'k1', label: 'browser-max' };
const OLGA = { email: 'olga@x.test', role: 'owner', sessionKey: 'k2', label: 'browser-olga' };

test('the proxy closes the upgrades a person opened, on both doors, and nobody else’s', () => {
  const { proxy, forwarded } = makeProxy();
  const maxInspector = shellUpgrade(proxy, MAX);
  const maxCollab = shellUpgrade(proxy, MAX, '/_ws/collab/ui-a');
  const maxHmr = canvasUpgrade(proxy, 'max-cap', '/_ws');
  const olgaInspector = shellUpgrade(proxy, OLGA);
  const olgaCollab = canvasUpgrade(proxy, 'olga-cap');
  assert.equal(forwarded.length, 5, 'every upgrade was spliced');

  assert.equal(proxy.closeUpgrades({ email: 'MAX@x.test' }), 3);
  assert.deepEqual(
    [maxInspector, maxCollab, maxHmr].map((s) => s.destroyed),
    [true, true, true]
  );
  assert.deepEqual(
    [olgaInspector, olgaCollab].map((s) => s.destroyed),
    [false, false]
  );
  // A closed socket is no longer tracked.
  assert.equal(proxy.closeUpgrades({ email: 'max@x.test' }), 0);
});

test('a token label closes the shell-door sockets that session opened', () => {
  const { proxy } = makeProxy();
  const a = shellUpgrade(proxy, MAX);
  const b = shellUpgrade(proxy, { ...MAX, label: 'browser-max-other-tab' });
  assert.equal(proxy.closeUpgrades({ label: 'browser-max' }), 1);
  assert.equal(a.destroyed, true);
  assert.equal(b.destroyed, false);
  assert.equal(proxy.closeUpgrades({}), 0, 'naming nobody closes nothing');
  // A socket that went away by itself drops out of the registry.
  b.destroy();
  assert.equal(proxy.closeUpgrades({ label: 'browser-max-other-tab' }), 0);
});

test('a refused upgrade is never tracked', () => {
  const { proxy } = makeProxy();
  const s = fakeSocket();
  proxy.handleUpgrade({
    request: { headers: { upgrade: 'websocket', origin: 'https://evil.test' }, url: '/_ws' },
    socket: s,
    head: null,
    session: MAX,
  });
  assert.match(s.written.join(''), /403/);
  assert.equal(proxy.closeUpgrades({ email: MAX.email }), 0);
});

test('endSessions — the graced narrowed / ended notice — closes the proxied sockets', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-u6-proxied-'));
  try {
    addToken(dataDir, { label: 'browser-max', owner: 'max@x.test', role: 'member' });
    const { proxy } = makeProxy();
    const kicked = [];
    const svc = createAccessService({
      dataDir,
      graceMs: 20,
      connections: () => [],
      kickLabel: (label) => {
        kicked.push(label);
        return proxy.closeUpgrades({ label });
      },
      kickEmail: (email) => proxy.closeUpgrades({ email }),
    });
    const inspector = shellUpgrade(proxy, MAX);
    const hmr = canvasUpgrade(proxy, 'max-cap', '/_ws');
    const olga = shellUpgrade(proxy, OLGA);

    // Raised: nothing closes.
    await svc.notices.accessChanged({ email: 'max@x.test', change: 'raised' }).ended;
    assert.deepEqual([inspector.destroyed, hmr.destroyed], [false, false]);

    const { ended } = svc.notices.accessChanged({ email: 'max@x.test', change: 'narrowed' });
    assert.equal(inspector.destroyed, false, 'the kick waits the grace');
    await ended;
    assert.deepEqual([inspector.destroyed, hmr.destroyed, olga.destroyed], [true, true, false]);
    assert.deepEqual(kicked, ['browser-max'], 'his token labels were kicked too');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('the browser session names its token label (what kickLabel closes)', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'maude-u6-label-'));
  try {
    const rec = addToken(dataDir, { label: 'browser-max-1', owner: 'max@x.test', role: 'member' });
    const s = browserSession(dataDir, '', {
      headers: { cookie: `maude_studio=${encodeURIComponent(rec.value)}` },
    });
    assert.equal(s?.email, 'max@x.test');
    assert.equal(s?.label, 'browser-max-1');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
