// #206 T6.3a (contract 206-cli-reuses-desktop.md §3, DDR-250 decision 2) — `GET /_api/shell/attest`.
//
// A terminal verb believes a desktop sidecar's port only after the server there answers a fresh
// nonce with HMAC-SHA256(attestKey, "maude-attest/1\n" + n + "\n" + rootId + "\n" + port), the key
// being the per-spawn MAUDE_SHELL_ATTEST_KEY the app also wrote to its own registry. Gates, in
// order: no key → 404 (a terminal server is never attestable) · a browser → 403 · `n` not exactly
// 32 hex → 400. Main origin only. The MAC binds the port the server BOUND, never the Host header.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createHash, createHmac } from 'node:crypto';
import { realpathSync, rmSync } from 'node:fs';
import type { Subprocess } from 'bun';

import { CANVAS_SAFE_API, guardTableRoute } from '../http.ts';
import { createShellRoutes, type ShellRouteDeps } from '../routes/shell.ts';
import { mountRoutes } from '../routes/table.ts';
import { ATTEST_ENV, takeAttestKey } from '../shell/attest.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const KEY = `${'c0ffee'.repeat(10).slice(0, 60)}beef`;
const N = '0123456789abcdef0123456789abcdef';
const ROOT_ID = 'aabbccddeeff';
const PORT = 46399;

const expected = (key: string, n: string, rootId: string, port: number) =>
  createHmac('sha256', key).update(`maude-attest/1\n${n}\n${rootId}\n${port}`).digest('hex');

function deps(over: Partial<ShellRouteDeps> = {}): ShellRouteDeps {
  return {
    token: () => 't'.repeat(64),
    attest: () => ({ key: KEY, rootId: ROOT_ID, port: PORT }),
    outbox: {
      content: () => ({ pending: 0 }),
      store: { list: () => [] },
    } as unknown as ShellRouteDeps['outbox'],
    exportJobs: { list: () => [] },
    generateJobs: { list: () => [] },
    ...over,
  };
}

function attestSpec(d: ShellRouteDeps) {
  const spec = createShellRoutes(d)
    .map(guardTableRoute)
    .find((s) => s.path === '/_api/shell/attest');
  if (!spec) throw new Error('no /_api/shell/attest spec');
  return spec;
}

function call(d: ShellRouteDeps, query: string, headers: Record<string, string> = {}) {
  return attestSpec(d).handle(
    new Request(`http://127.0.0.1:4999/_api/shell/attest${query}`, {
      headers: { host: '127.0.0.1:4999', ...headers },
    }),
    {}
  );
}

describe('GET /_api/shell/attest — gates', () => {
  test('the right nonce answers 200 with the MAC over nonce, rootId and the BOUND port', async () => {
    const r = await call(deps(), `?n=${N}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const body = await r.json();
    expect(body).toEqual({ mac: expected(KEY, N, ROOT_ID, PORT) });
    // not the request's port (4999), not another key
    expect(body.mac).not.toBe(expected(KEY, N, ROOT_ID, 4999));
    expect(body.mac).not.toBe(expected('0'.repeat(64), N, ROOT_ID, PORT));
  });

  test('a fresh nonce gives a fresh MAC (no replay of an earlier answer)', async () => {
    const other = 'f'.repeat(32);
    const a = (await (await call(deps(), `?n=${N}`)).json()).mac;
    const b = (await (await call(deps(), `?n=${other}`)).json()).mac;
    expect(a).not.toBe(b);
    expect(b).toBe(expected(KEY, other, ROOT_ID, PORT));
  });

  test('n missing, short, long, not hex, or given twice → 400', async () => {
    for (const q of [
      '',
      '?n=',
      `?n=${N.slice(1)}`,
      `?n=${N}0`,
      `?n=${'g'.repeat(32)}`,
      `?n=${N}&n=${N}`,
      `?n=${encodeURIComponent(`${N}\n`)}`,
    ]) {
      const r = await call(deps(), q);
      expect({ q, status: r.status }).toEqual({ q, status: 400 });
    }
  });

  test('no attest key in this process: the route does not exist (404), whatever n says', async () => {
    expect((await call(deps({ attest: () => null }), `?n=${N}`)).status).toBe(404);
    expect((await call(deps({ attest: () => null }), '?n=bad')).status).toBe(404);
  });

  test('a browser never gets an answer: Origin or Sec-Fetch-Site → 403', async () => {
    expect((await call(deps(), `?n=${N}`, { origin: 'http://127.0.0.1:4999' })).status).toBe(403);
    for (const site of ['same-origin', 'none', 'cross-site'])
      expect((await call(deps(), `?n=${N}`, { 'sec-fetch-site': site })).status).toBe(403);
  });

  test('a foreign Host (DNS rebinding) is refused before anything is signed', async () => {
    const r = await attestSpec(deps()).handle(
      new Request(`http://127.0.0.1:4999/_api/shell/attest?n=${N}`, {
        headers: { host: 'evil.example:4999' },
      }),
      {}
    );
    expect(r.status).toBe(403);
  });

  test('main origin only, GET only: in neither canvas list', () => {
    const specs = createShellRoutes(deps()).filter((s) => s.path === '/_api/shell/attest');
    expect(specs.map((s) => [s.method, s.origin])).toEqual([['GET', 'main']]);
    expect(mountRoutes(specs).canvasPaths).toEqual([]);
    expect(CANVAS_SAFE_API.has('/_api/shell/attest')).toBe(false);
  });
});

describe('takeAttestKey', () => {
  test('reads the key once and deletes it from the env', () => {
    const env: Record<string, string | undefined> = { [ATTEST_ENV]: KEY, PATH: '/usr/bin' };
    expect(takeAttestKey(env)).toBe(KEY);
    expect(ATTEST_ENV in env).toBe(false);
    expect(takeAttestKey(env)).toBeNull();
  });

  test('a malformed key is no key (and is still deleted)', () => {
    for (const bad of ['', 'abc', KEY.slice(1), `${KEY}0`, 'z'.repeat(64)]) {
      const env: Record<string, string | undefined> = { [ATTEST_ENV]: bad };
      expect(takeAttestKey(env)).toBeNull();
      expect(ATTEST_ENV in env).toBe(false);
    }
  });
});

// ── a real boot: the server binds its own rootId + port ─────────────────────────────────────

describe('a sidecar spawned with an attest key', () => {
  let proc: Subprocess | null = null;
  let plain: Subprocess | null = null;
  let root = '';
  let plainRoot = '';
  let port = 0;
  let plainPort = 0;

  beforeAll(async () => {
    root = makeSandbox().root;
    plainRoot = makeSandbox().root;
    port = nextPort();
    proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1', [ATTEST_ENV]: KEY });
    plainPort = nextPort();
    plain = await bootServer(plainRoot, plainPort, { MAUDE_NO_AUTOBUILD: '1' });
  });

  afterAll(async () => {
    if (proc) await killProc(proc);
    if (plain) await killProc(plain);
    rmSync(root, { recursive: true, force: true });
    rmSync(plainRoot, { recursive: true, force: true });
  });

  test('answers with the MAC over its own rootId and bound port', async () => {
    const rootId = createHash('sha256').update(realpathSync(root)).digest('hex').slice(0, 12);
    const r = await fetch(`http://127.0.0.1:${port}/_api/shell/attest?n=${N}`);
    expect(r.status).toBe(200);
    expect((await r.json()).mac).toBe(expected(KEY, N, rootId, port));
  });

  test('a server with no key (a terminal server) is not attestable: 404', async () => {
    const r = await fetch(`http://127.0.0.1:${plainPort}/_api/shell/attest?n=${N}`);
    expect(r.status).toBe(404);
  });

  test('the canvas origin never serves it', async () => {
    const cfg = await (await fetch(`http://127.0.0.1:${port}/_config`)).json();
    const canvasOrigin = cfg.canvasOrigin as string | undefined;
    expect(canvasOrigin).toBeTruthy();
    const r = await fetch(`${canvasOrigin}/_api/shell/attest?n=${N}`);
    expect([403, 404]).toContain(r.status);
    expect(await r.text()).not.toContain('"mac"');
  });
});
