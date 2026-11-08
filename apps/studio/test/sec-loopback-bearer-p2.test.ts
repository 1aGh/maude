// Phase 2 of the loopback API key (contract client/v2/contracts/sec-loopback-bearer.md §7): a server
// the desktop app starts requires its per-spawn key from EVERY caller on the main origin. Before,
// a local process that forged `Origin`/`Sec-Fetch-Site` (or sent neither, on a non-credential route)
// read and wrote everything the studio page can.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';

import {
  API_KEY_ENV,
  API_KEY_HEADER,
  LAUNCH_PARAM,
  mainOriginKeyRefusal,
  mintLaunchToken,
  SESSION_PATH,
  sessionCookie,
} from '../shell/api-key.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const KEY = 'c3'.repeat(32);
const BASE = 'http://127.0.0.1:4400';

function req(path: string, headers: Record<string, string> = {}, method = 'GET'): Request {
  return new Request(`${BASE}${path}`, { method, headers: { host: '127.0.0.1:4400', ...headers } });
}

describe('mainOriginKeyRefusal (pure, required mode)', () => {
  const used = new Set<string>();
  const opts = { key: KEY, required: true, workspace: false, usedNonces: used };
  const gate = (r: Request, now?: number) => mainOriginKeyRefusal(r, { ...opts, now });
  const cookie = sessionCookie(KEY);

  test('no key on an ordinary route, a write and a socket → 401 api-key-required', async () => {
    for (const r of [
      req('/_config'),
      req('/_api/edit-css', {}, 'POST'),
      req('/_ws'),
      req('/_ws/acp'),
      req('/_api/comments'),
    ]) {
      const res = gate(r);
      if (!res) throw new Error(`expected a refusal for ${r.url}`);
      expect(res.status).toBe(401);
      expect(((await res.json()) as { error: string }).error).toBe('api-key-required');
    }
  });

  test('forged browser headers without the key are refused', () => {
    expect(gate(req('/_config', { origin: BASE, 'sec-fetch-site': 'same-origin' }))?.status).toBe(
      401
    );
    expect(gate(req('/_api/edit-css', { origin: BASE }, 'POST'))?.status).toBe(401);
  });

  test('the key as a header or a bearer passes; a wrong key is api-key-invalid', async () => {
    expect(gate(req('/_config', { [API_KEY_HEADER]: KEY }))).toBeNull();
    expect(gate(req('/_config', { authorization: `Bearer ${KEY}` }))).toBeNull();
    const bad = gate(req('/_config', { [API_KEY_HEADER]: 'd4'.repeat(32) }));
    expect(bad?.status).toBe(401);
    if (!bad) throw new Error('expected a refusal');
    expect(((await bad.json()) as { error: string }).error).toBe('api-key-invalid');
  });

  test('the session cookie passes same-origin, never same-site (the canvas origin)', () => {
    const c = `${cookie.name}=${cookie.value}`;
    expect(gate(req('/_config', { cookie: c }))).toBeNull();
    expect(gate(req('/_config', { cookie: c, 'sec-fetch-site': 'same-origin' }))).toBeNull();
    expect(gate(req('/_config', { cookie: c, 'sec-fetch-site': 'same-site' }))?.status).toBe(401);
    expect(gate(req('/_config', { cookie: `${cookie.name}=${'0'.repeat(64)}` }))?.status).toBe(401);
  });

  test('the exempt bootstrap answers without a key; nothing else does', () => {
    for (const p of [
      '/_health',
      '/',
      '/index.html',
      '/_client/client.bundle.js',
      '/_client/fonts/inter.woff2',
      '/_canvas-runtime/react.js',
      '/_canvas-shell.html',
      '/_api/shell/status',
      '/_api/shell/attest?n=00',
    ])
      expect(gate(req(p))).toBeNull();
    expect(gate(req('/', {}, 'POST'))?.status).toBe(401);
    expect(gate(req('/_client/x', {}, 'POST'))?.status).toBe(401);
    expect(gate(req('/_api/shell/statusx'))?.status).toBe(401);
  });

  test('outside required mode, and in a cell, the gate stands aside', () => {
    expect(mainOriginKeyRefusal(req('/_config'), { ...opts, required: false })).toBeNull();
    expect(mainOriginKeyRefusal(req('/_config'), { ...opts, workspace: true })).toBeNull();
  });

  test('POST /_api/shell/session exchanges the key for the session cookie', () => {
    const ok = gate(req(SESSION_PATH, { [API_KEY_HEADER]: KEY }, 'POST'));
    expect(ok?.status).toBe(204);
    const set = ok?.headers.get('set-cookie') ?? '';
    expect(set).toContain(`${cookie.name}=${cookie.value}`);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Strict');
    // a cookie alone, or no credential, never mints a session
    expect(
      gate(req(SESSION_PATH, { cookie: `${cookie.name}=${cookie.value}` }, 'POST'))?.status
    ).toBe(401);
    expect(gate(req(SESSION_PATH, {}, 'POST'))?.status).toBe(401);
  });

  test('a launch token works once and only once, within 300 s', () => {
    const now = 1_800_000_000;
    const tok = mintLaunchToken(KEY, now);
    const first = gate(req(`/?open=a.tsx&${LAUNCH_PARAM}=${tok}`), now + 5);
    expect(first?.status).toBe(303);
    expect(first?.headers.get('location')).toBe('/?open=a.tsx');
    expect(first?.headers.get('set-cookie') ?? '').toContain(`${cookie.name}=${cookie.value}`);
    expect(gate(req(`/?${LAUNCH_PARAM}=${tok}`), now + 6)?.status).toBe(401);
    expect(gate(req(`/?${LAUNCH_PARAM}=${mintLaunchToken(KEY, now)}`), now + 301)?.status).toBe(
      401
    );
    expect(
      gate(req(`/?${LAUNCH_PARAM}=${mintLaunchToken('e5'.repeat(32), now)}`), now)?.status
    ).toBe(401);
    expect(gate(req(`/?${LAUNCH_PARAM}=garbage`), now)?.status).toBe(401);
  });
});

describe('a desktop-started server requires the key from every caller', () => {
  let proc: Subprocess;
  let base: string;
  beforeAll(async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    base = `http://127.0.0.1:${port}`;
    proc = await bootServer(root, port, { [API_KEY_ENV]: KEY });
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  test('no key → 401 on a read, a write and a socket path; /_health and / still answer', async () => {
    expect((await fetch(`${base}/_config`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/_api/edit-css`, {
          method: 'POST',
          headers: { origin: base, 'content-type': 'application/json' },
          body: '{}',
        })
      ).status
    ).toBe(401);
    expect((await fetch(`${base}/_ws`)).status).toBe(401);
    expect((await fetch(`${base}/_health`)).status).toBe(200);
    expect((await fetch(`${base}/`)).status).toBe(200);
  });

  test('forged browser headers without the key → 401', async () => {
    const r = await fetch(`${base}/_config`, {
      headers: { origin: base, 'sec-fetch-site': 'same-origin', referer: `${base}/` },
    });
    expect(r.status).toBe(401);
  });

  test('the key, or the session cookie it mints, opens the server', async () => {
    expect((await fetch(`${base}/_config`, { headers: { [API_KEY_HEADER]: KEY } })).status).toBe(
      200
    );
    const s = await fetch(`${base}${SESSION_PATH}`, {
      method: 'POST',
      headers: { [API_KEY_HEADER]: KEY, origin: base },
    });
    expect(s.status).toBe(204);
    const c = (s.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await fetch(`${base}/_config`, { headers: { cookie: c } })).status).toBe(200);
  });

  test('a socket opens with the key and not without it', async () => {
    const ws = base.replace('http', 'ws');
    const open = (headers: Record<string, string>) =>
      new Promise<boolean>((done) => {
        // Bun's WebSocket takes request headers
        const s = new WebSocket(`${ws}/_ws`, { headers } as unknown as string[]);
        s.onopen = () => {
          s.close();
          done(true);
        };
        s.onerror = () => done(false);
      });
    expect(await open({})).toBe(false);
    expect(await open({ [API_KEY_HEADER]: KEY })).toBe(true);
  });

  test('a launch token opens the page once and only once', async () => {
    const tok = mintLaunchToken(KEY);
    const first = await fetch(`${base}/?${LAUNCH_PARAM}=${tok}`, { redirect: 'manual' });
    expect(first.status).toBe(303);
    const c = (first.headers.get('set-cookie') ?? '').split(';')[0];
    expect((await fetch(`${base}/_config`, { headers: { cookie: c } })).status).toBe(200);
    expect((await fetch(`${base}/?${LAUNCH_PARAM}=${tok}`, { redirect: 'manual' })).status).toBe(
      401
    );
  });
});

describe('a server started without a key keeps phase 1', () => {
  let proc: Subprocess;
  let base: string;
  beforeAll(async () => {
    const { root } = makeSandbox();
    const port = nextPort();
    base = `http://127.0.0.1:${port}`;
    proc = await bootServer(root, port);
  }, 60_000);
  afterAll(async () => {
    if (proc) await killProc(proc);
  });

  test('/_config answers a key-less caller', async () => {
    expect((await fetch(`${base}/_config`)).status).toBe(200);
  });
});
