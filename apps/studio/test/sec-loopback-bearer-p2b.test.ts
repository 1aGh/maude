// Phase 2b of the loopback API key (contract client/v2/contracts/sec-loopback-bearer.md §7.5): a
// server started from a terminal (role `cli`) mints its own key, requires it from every main-origin
// caller, and writes it to a 0600 file in a 0700 per-user state dir outside the project — the one
// place the CLI reads it from. Before, such a server answered every local caller without a key.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { rootIdentity } from '../http.ts';
import {
  API_KEY_HEADER,
  LAUNCH_PARAM,
  mainOriginKeyRefusal,
  mintLaunchToken,
  sessionCookie,
} from '../shell/api-key.ts';
import { removeServerKeyFile, serverKeyDir, writeServerKeyFile } from '../shell/key-file.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

describe('the key file (pure)', () => {
  test('lives under XDG_STATE_HOME (else ~/.local/state), 0700 dir, 0600 file', () => {
    const { root } = makeSandbox();
    const state = join(root, 'state');
    const env = { XDG_STATE_HOME: state, HOME: join(root, 'home') };
    expect(serverKeyDir(env)).toBe(join(state, 'maude', 'servers'));
    expect(serverKeyDir({ HOME: '/h' })).toBe('/h/.local/state/maude/servers');
    expect(serverKeyDir({ XDG_STATE_HOME: 'relative', HOME: '/h' })).toBe(
      '/h/.local/state/maude/servers'
    );
    const p = writeServerKeyFile(
      { port: 4400, pid: 4242, rootId: 'abcdef012345', apiKey: 'e5'.repeat(32) },
      env
    );
    expect(p).toBe(join(state, 'maude', 'servers', 'abcdef012345.json'));
    if (!p) throw new Error('expected a path');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(statSync(join(state, 'maude', 'servers')).mode & 0o777).toBe(0o700);
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual({
      v: 1,
      port: 4400,
      pid: 4242,
      rootId: 'abcdef012345',
      apiKey: 'e5'.repeat(32),
    });
    removeServerKeyFile(p, 1); // not ours: kept
    expect(existsSync(p)).toBe(true);
    removeServerKeyFile(p, 4242);
    expect(existsSync(p)).toBe(false);
  });

  test('a malformed root id is never a file name', () => {
    const { root } = makeSandbox();
    const env = { XDG_STATE_HOME: join(root, 'state') };
    expect(
      writeServerKeyFile({ port: 1, pid: 1, rootId: '../../x', apiKey: 'e5'.repeat(32) }, env)
    ).toBeNull();
  });
});

describe('a launch link opened twice (a reload, a helper navigating again)', () => {
  const KEY = 'b7'.repeat(32);
  test('with the session cookie: 303 without the parameter, the token left unspent', () => {
    const used = new Set<string>();
    const tok = mintLaunchToken(KEY);
    const c = sessionCookie(KEY);
    const r = (cookie?: string) =>
      new Request(`http://127.0.0.1:4400/?canvas=a.tsx&${LAUNCH_PARAM}=${tok}`, {
        headers: { host: '127.0.0.1:4400', ...(cookie ? { cookie } : {}) },
      });
    const opts = { key: KEY, required: true, workspace: false, usedNonces: used };
    const again = mainOriginKeyRefusal(r(`${c.name}=${c.value}`), opts);
    expect(again?.status).toBe(303);
    expect(again?.headers.get('location')).toBe('/?canvas=a.tsx');
    expect(again?.headers.get('set-cookie')).toBeNull();
    expect(used.size).toBe(0);
    // a wrong cookie is no session: the token is checked (and spent) as before
    expect(mainOriginKeyRefusal(r(`${c.name}=${'0'.repeat(64)}`), opts)?.status).toBe(303);
    expect(used.size).toBe(1);
    expect(mainOriginKeyRefusal(r(), opts)?.status).toBe(401);
  });
});

describe('a terminal-started server requires its own key', () => {
  let proc: Subprocess;
  let base: string;
  let root: string;
  let state: string;
  beforeAll(async () => {
    ({ root } = makeSandbox());
    state = join(root, '..', `state-${Date.now()}`);
    mkdirSync(state, { recursive: true });
    const port = nextPort();
    base = `http://127.0.0.1:${port}`;
    proc = await bootServer(root, port, {
      MAUDE_SERVER_ROLE: 'cli',
      XDG_STATE_HOME: state,
      // never the real app registry
      MAUDE_APP_REGISTRY_FILE: join(state, 'no-app', 'servers.json'),
    });
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  const keyFile = () => join(state, 'maude', 'servers', `${rootIdentity(root)}.json`);

  test('no key → 401; /_health and / still answer', async () => {
    expect((await fetch(`${base}/_config`)).status).toBe(401);
    expect((await fetch(`${base}/_index-data`)).status).toBe(401);
    expect((await fetch(`${base}/_health`)).status).toBe(200);
  });

  test('writes the key to the per-user state dir, never into the project', async () => {
    const rec = JSON.parse(readFileSync(keyFile(), 'utf8'));
    expect(rec.v).toBe(1);
    expect(rec.pid).toBe(proc.pid);
    expect(`http://127.0.0.1:${rec.port}`).toBe(base);
    expect(rec.apiKey).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(keyFile()).mode & 0o777).toBe(0o600);
    const designFiles = readdirSync(join(root, '.design'), { recursive: true }).map(String);
    for (const f of designFiles) {
      const p = join(root, '.design', f);
      if (statSync(p).isFile()) expect(readFileSync(p, 'utf8')).not.toContain(rec.apiKey);
    }
    expect(
      (await fetch(`${base}/_config`, { headers: { [API_KEY_HEADER]: rec.apiKey } })).status
    ).toBe(200);
  });

  test('a launch token minted with that key opens the page once', async () => {
    const { apiKey } = JSON.parse(readFileSync(keyFile(), 'utf8'));
    const tok = mintLaunchToken(apiKey);
    const first = await fetch(`${base}/?${LAUNCH_PARAM}=${tok}`, { redirect: 'manual' });
    expect(first.status).toBe(303);
    const c = (first.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await fetch(`${base}/_config`, { headers: { cookie: c } })).status).toBe(200);
  });

  test('the file goes away with the server', async () => {
    await killProc(proc);
    expect(existsSync(keyFile())).toBe(false);
  });
});
