// Credential routes need the per-spawn API key from a caller that is not a browser
// (contract client/v2/contracts/sec-loopback-bearer.md). Before the gate, a request with no
// Origin and a loopback Host passed every check on /_api/github/* and used the person's token.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Subprocess } from 'bun';

import {
  API_KEY_ENV,
  API_KEY_HEADER,
  credentialRouteRefusal,
  isCredentialRoute,
  sessionCookie,
  takeApiKey,
} from '../shell/api-key.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const KEY = 'a1'.repeat(32);
const URL_BASE = 'http://127.0.0.1:4400';

function req(path: string, headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request(`${URL_BASE}${path}`, {
    method,
    headers: { host: '127.0.0.1:4400', ...headers },
  });
}

describe('credentialRouteRefusal (pure)', () => {
  const gate = (r: Request) => credentialRouteRefusal(r, { key: KEY, workspace: false });

  test('the GitHub routes are credential routes; a canvas route is not', () => {
    for (const p of ['identity', 'repos', 'create-repo', 'invite', 'clone', 'create-project'])
      expect(isCredentialRoute(`/_api/github/${p}`)).toBe(true);
    expect(isCredentialRoute('/_api/asset')).toBe(false);
    expect(isCredentialRoute('/_api/githubx')).toBe(false);
  });

  test('no Origin, no Sec-Fetch-Site, no key → 401', async () => {
    const r = gate(req('/_api/github/invite'));
    if (!r) throw new Error('expected a refusal');
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe('api-key-required');
    expect(gate(req('/_api/github/identity', {}, 'GET'))?.status).toBe(401);
  });

  test('the right key passes, as a header or a bearer; a wrong one is 401', () => {
    expect(gate(req('/_api/github/invite', { [API_KEY_HEADER]: KEY }))).toBeNull();
    expect(gate(req('/_api/github/invite', { authorization: `Bearer ${KEY}` }))).toBeNull();
    expect(gate(req('/_api/github/invite', { [API_KEY_HEADER]: 'b2'.repeat(32) }))?.status).toBe(
      401
    );
  });

  test('a same-origin browser request still passes; a cross-origin one is 403', () => {
    expect(gate(req('/_api/github/invite', { origin: URL_BASE }))).toBeNull();
    expect(
      gate(req('/_api/github/identity', { 'sec-fetch-site': 'same-origin' }, 'GET'))
    ).toBeNull();
    expect(gate(req('/_api/github/invite', { origin: 'https://evil.example' }))?.status).toBe(403);
    expect(gate(req('/_api/github/repos', { 'sec-fetch-site': 'cross-site' }, 'GET'))?.status).toBe(
      403
    );
  });

  test('non-credential routes and a cell are untouched', () => {
    expect(gate(req('/_api/edit-css'))).toBeNull();
    expect(credentialRouteRefusal(req('/_api/github/invite'), { key: KEY, workspace: true })).toBe(
      null
    );
  });

  test('the env key is taken once and deleted; a malformed one reads as none', () => {
    const env: Record<string, string | undefined> = { [API_KEY_ENV]: KEY };
    expect(takeApiKey(env)).toBe(KEY);
    expect(API_KEY_ENV in env).toBe(false);
    expect(takeApiKey({ [API_KEY_ENV]: 'short' })).toBeNull();
  });
});

describe('a booted server refuses a header-less caller on /_api/github/*', () => {
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

  const invite = (headers: Record<string, string>) =>
    fetch(`${base}/_api/github/invite`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ username: 'octocat' }),
    });

  test('no Origin, no key → 401 on invite and identity', async () => {
    const r = await invite({});
    expect(r.status).toBe(401);
    expect(((await r.json()) as { error: string }).error).toBe('api-key-required');
    expect((await fetch(`${base}/_api/github/identity`)).status).toBe(401);
  });

  test('with the key the route runs (the sandbox has no GitHub remote → 409)', async () => {
    expect((await invite({ [API_KEY_HEADER]: KEY })).status).toBe(409);
  });

  // §7: a server started with a key is in required mode — a browser needs the session cookie too,
  // and the phase-1 Origin check still runs behind it.
  test('a same-origin browser request runs the route; a cross-origin one is refused', async () => {
    expect((await invite({ origin: base })).status).toBe(401);
    const c = sessionCookie(KEY);
    const cookie = `${c.name}=${c.value}`;
    expect((await invite({ origin: base, cookie })).status).toBe(409);
    expect((await invite({ origin: 'https://evil.example', cookie })).status).toBe(403);
  });
});
