// 2.1.1 T5 — "Link your server" checks the address as it is typed. A project tab asks its own
// server (`POST /_api/hub-signin/check`), which makes ONE tokenless GET <server>/health — the same
// probe Home's `/_home/hub/test` makes (home/hub.ts). The page never fetches the remote itself.
// Also: an invite link rides `/_api/hub-signin/start` in a project tab, as it does on Home.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { guardTableRoute } from '../http.ts';
import { createHubSigninRoutes } from '../routes/hub-signin.ts';
import { createHubBrowserSignIn, DESKTOP_SIGNIN_CAPABILITY } from '../sync/hub-browser-signin.ts';

const HUB = 'https://design.team.example';
const SELF = 'http://127.0.0.1:4399';
const KEY = `inv_${'k'.repeat(24)}`;

type Call = { url: string; init?: RequestInit };

function fakeFetch(answer: (url: string) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return answer(String(input));
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const maudeHealth = () =>
  Response.json({
    ok: true,
    version: '2.1.0',
    capabilities: [DESKTOP_SIGNIN_CAPABILITY],
    token: 'never-echo-this',
  });

function checkRoute(fetchImpl: typeof fetch) {
  const spec = createHubSigninRoutes({ fetchImpl }).find(
    (s) => s.path === '/_api/hub-signin/check'
  );
  if (!spec) throw new Error('no /_api/hub-signin/check route');
  return guardTableRoute(spec);
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`${SELF}${path}`, {
    method: 'POST',
    headers: {
      host: '127.0.0.1:4399',
      origin: SELF,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });

let logs: ReturnType<typeof spyOn>[] = [];
beforeEach(() => {
  logs = (['log', 'warn', 'error', 'info'] as const).map((k) =>
    spyOn(console, k).mockImplementation(() => {})
  );
});
afterEach(() => {
  for (const s of logs) s.mockRestore();
});
const logged = () => logs.flatMap((s) => s.mock.calls.map((c) => c.join(' '))).join('\n');

describe('POST /_api/hub-signin/check', () => {
  test('a Maude server answers with its version — one tokenless GET of /health, no token back', async () => {
    const f = fakeFetch(() => maudeHealth());
    const r = await checkRoute(f.fetchImpl).handle(
      post('/_api/hub-signin/check', { url: HUB }),
      {}
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toEqual({ ok: true, reachable: true, url: HUB, version: '2.1.0' });
    expect(JSON.stringify(j)).not.toContain('never-echo-this');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]?.url).toBe(`${HUB}/health`);
    const init = f.calls[0]?.init ?? {};
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
    expect(JSON.stringify(init.headers ?? {}).toLowerCase()).not.toContain('authorization');
    expect(logged()).not.toContain('never-echo-this');
  });

  test('a server that does not answer, and one that is not Maude, are told apart', async () => {
    const down = fakeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const a = await checkRoute(down.fetchImpl).handle(
      post('/_api/hub-signin/check', { url: HUB }),
      {}
    );
    expect(a.status).toBe(502);
    expect((await a.json()).reason).toBe('unreachable');
    const other = fakeFetch(() => new Response('<html>hello</html>', { status: 200 }));
    const b = await checkRoute(other.fetchImpl).handle(
      post('/_api/hub-signin/check', { url: HUB }),
      {}
    );
    expect(b.status).toBe(502);
    expect((await b.json()).reason).toBe('not-a-maude-workspace');
  });

  test('refuses a non-http(s) address, http off loopback, and userinfo — nothing leaves', async () => {
    const f = fakeFetch(() => maudeHealth());
    for (const url of [
      'file:///etc/passwd',
      'ftp://design.team.example',
      'javascript:alert(1)',
      'http://design.team.example',
      'https://me:secret@design.team.example',
      'https://design.team.example/?token=x',
    ]) {
      const r = await checkRoute(f.fetchImpl).handle(post('/_api/hub-signin/check', { url }), {});
      expect(r.status, url).toBe(400);
      expect((await r.json()).reason, url).toBe('bad-address');
    }
    expect(f.calls).toHaveLength(0);
  });

  test('a cross-origin page and a foreign Host are refused at the gate', async () => {
    const f = fakeFetch(() => maudeHealth());
    const route = checkRoute(f.fetchImpl);
    const xo = await route.handle(
      post(
        '/_api/hub-signin/check',
        { url: HUB },
        { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }
      ),
      {}
    );
    expect(xo.status).toBe(403);
    const rebind = await route.handle(
      post('/_api/hub-signin/check', { url: HUB }, { host: 'evil.example:4399' }),
      {}
    );
    expect(rebind.status).toBe(403);
    expect(f.calls).toHaveLength(0);
  });
});

describe('POST /_api/hub-signin/start with an invite (project tab)', () => {
  const hubFetch = (async (input: string | URL | Request) =>
    String(input) === `${HUB}/health`
      ? Response.json({ ok: true, capabilities: [DESKTOP_SIGNIN_CAPABILITY] })
      : new Response('nope', { status: 404 })) as typeof fetch;
  const start = () => {
    const spec = createHubSigninRoutes({
      signIn: createHubBrowserSignIn({ fetchImpl: hubFetch, save: () => {} }),
    }).find((s) => s.path === '/_api/hub-signin/start');
    if (!spec) throw new Error('no start route');
    return guardTableRoute(spec);
  };

  test("the server's own invite link opens its invite page, never a URL the page built", async () => {
    const r = await start().handle(
      post('/_api/hub-signin/start', { url: HUB, invite: `${HUB}/join/${KEY}` }),
      {}
    );
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(new URL(j.signInUrl).origin).toBe(HUB);
    expect(new URL(j.signInUrl).pathname).toBe(`/join/${KEY}`);
  });

  test('an invite link for another server is refused and nothing starts', async () => {
    const r = await start().handle(
      post('/_api/hub-signin/start', { url: HUB, invite: `https://other.example/join/${KEY}` }),
      {}
    );
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe('That invite is for a different hub address.');
  });
});
