// S6.6 — Home's "Connect to your own hub" (contract S6-slices row S6.6): Test connection probes
// `/health` only (tokenless, no body, no redirect followed); https unless loopback, checked before
// any byte leaves. Issue #204 K2: Home owns no team-server password — Sign in (and an invite) opens
// the hub's own page in the browser, the hub sends a one-time code back to Home's loopback return,
// and only the exchanged token is kept, in THAT profile's hubs.json.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHomeHub, hubAddress } from '../home/hub.ts';
import { HOST, homeFetch, homeReq } from './_home-fixtures.ts';

const PASSWORD = 'pw-S6.6-never-stored-7f3a';

interface Seen {
  method: string;
  path: string;
  auth: string | null;
  cookie: string | null;
  body: string;
}

function fakeHub(
  opts: {
    health?: 'ok' | 'other' | 'down' | 'redirect';
    /** #204: advertises `desktop-signin-v1` (a 2.0.4 hub) */
    desktop?: boolean;
  } = {}
) {
  const seen: Seen[] = [];
  const code = 'home-one-time-code';
  let challenge = '';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const body = await req.text();
      seen.push({
        method: req.method,
        path: url.pathname,
        auth: req.headers.get('authorization'),
        cookie: req.headers.get('cookie'),
        body,
      });
      if (url.pathname === '/health') {
        if (opts.health === 'down') return new Response('no', { status: 500 });
        if (opts.health === 'other') return Response.json({ status: 'fine' });
        if (opts.health === 'redirect')
          return new Response(null, { status: 302, headers: { location: '/auth/login' } });
        return Response.json({
          ok: true,
          version: opts.desktop ? '2.0.4' : '1.4.0',
          capabilities: opts.desktop ? ['ledger', 'desktop-signin-v1'] : ['ledger'],
        });
      }
      if (url.pathname === '/auth/desktop/exchange' && req.method === 'POST') {
        const b = JSON.parse(body || '{}') as { code?: string; code_verifier?: string };
        const s256 = createHash('sha256')
          .update(b.code_verifier ?? '')
          .digest('base64url');
        if (b.code !== code || s256 !== challenge)
          return Response.json({ error: 'invalid' }, { status: 400 });
        return Response.json({
          token: 'peer-home-token',
          expiresAt: Date.now() + 3_600_000,
          user: { email: 'ana@example.test', role: 'member' },
        });
      }
      if (url.pathname === '/api/projects/current/v1/bootstrap')
        return Response.json({ projectId: 'team-a', canvasGroups: ['ui'] });
      return new Response('nope', { status: 404 });
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    seen,
    code,
    /** What the hub keeps from the page URL the app opened (the S256 challenge). */
    remember: (signInUrl: string) => {
      challenge = new URL(signInUrl).searchParams.get('code_challenge') ?? '';
    },
    stop: () => server.stop(true),
  };
}

/** Every file under `dir`, recursively — to prove the password landed in none of them. */
function filesUnder(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p));
    else out.push(p);
  }
  return out;
}

let xdg: string;
let prevXdg: string | undefined;
let prevHubs: string | undefined;
const logged: string[] = [];
const origLog = console.log;
const origErr = console.error;
const origWarn = console.warn;
beforeEach(() => {
  prevXdg = process.env.XDG_CONFIG_HOME;
  prevHubs = process.env.HUBS_CONFIG_PATH;
  xdg = mkdtempSync(join(tmpdir(), 'maude-home-hub-'));
  process.env.XDG_CONFIG_HOME = xdg;
  delete process.env.HUBS_CONFIG_PATH;
  logged.length = 0;
  const grab = (...a: unknown[]) => logged.push(a.map(String).join(' '));
  console.log = grab;
  console.error = grab;
  console.warn = grab;
});
afterEach(() => {
  console.log = origLog;
  console.error = origErr;
  console.warn = origWarn;
  if (prevXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = prevXdg;
  if (prevHubs !== undefined) process.env.HUBS_CONFIG_PATH = prevHubs;
});

describe('hubAddress — https unless loopback', () => {
  test('loopback http and any https pass; other http, userinfo and junk do not', () => {
    for (const ok of [
      'https://hub.example.com',
      'https://hub.example.com/',
      'http://127.0.0.1:4500',
      'http://localhost:8080',
      'http://[::1]:9000',
    ])
      expect([ok, hubAddress(ok).ok]).toEqual([ok, true]);
    for (const bad of [
      'http://hub.example.com',
      'http://192.168.1.10:4500',
      'https://ana:secret@hub.example.com',
      'ftp://hub.example.com',
      'file:///etc/passwd',
      'not a url',
      '',
      42,
      null,
      `https://${'a'.repeat(3000)}.com`,
    ])
      expect([bad, hubAddress(bad).ok]).toEqual([bad, false]);
  });
});

describe('Test connection probes /health only', () => {
  test('a Maude hub → reachable, with its version; one tokenless GET /health, no body', async () => {
    const hub = fakeHub();
    try {
      const r = await createHomeHub().test({ url: hub.url });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ ok: true, reachable: true, url: hub.url, version: '1.4.0' });
      expect(hub.seen).toHaveLength(1);
      expect(hub.seen[0]).toEqual({
        method: 'GET',
        path: '/health',
        auth: null,
        cookie: null,
        body: '',
      });
    } finally {
      hub.stop();
    }
  });

  test('the probe ignores any email/password in the body — nothing but /health is sent', async () => {
    const hub = fakeHub();
    try {
      await createHomeHub().test({ url: hub.url, email: 'a@b.c', password: PASSWORD });
      expect(hub.seen.map((s) => s.path)).toEqual(['/health']);
      expect(JSON.stringify(hub.seen)).not.toContain(PASSWORD);
    } finally {
      hub.stop();
    }
  });

  test('something that is not a Maude hub, or is down → not reachable as a hub', async () => {
    for (const health of ['other', 'down'] as const) {
      const hub = fakeHub({ health });
      try {
        const r = await createHomeHub().test({ url: hub.url });
        expect(r.status).toBe(502);
        expect((r.body as { ok: boolean }).ok).toBe(false);
      } finally {
        hub.stop();
      }
    }
  });

  test('a redirect from /health is not followed', async () => {
    const hub = fakeHub({ health: 'redirect' });
    try {
      const r = await createHomeHub().test({ url: hub.url });
      expect((r.body as { ok: boolean }).ok).toBe(false);
      expect(hub.seen.map((s) => s.path)).toEqual(['/health']);
    } finally {
      hub.stop();
    }
  });

  test('a plain-http remote address is refused before any request is made', async () => {
    const calls: string[] = [];
    const hub = createHomeHub({
      fetchImpl: (async (u: string) => {
        calls.push(String(u));
        return new Response('{}');
      }) as unknown as typeof fetch,
    });
    const r = await hub.test({ url: 'http://hub.example.com' });
    expect(r.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('#204 K2 — Home owns no team-server password', () => {
  test('Connect with an email or password is refused before any request; /_home/hub/join is gone', async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      calls.push(String(u));
      return new Response('{}');
    }) as unknown as typeof fetch;
    try {
      for (const body of [
        { profile: 'work', url: 'https://hub.example.com', email: 'a@b.c', password: PASSWORD },
        { profile: 'work', url: 'https://hub.example.com', password: PASSWORD },
        { profile: 'work', url: 'https://hub.example.com', email: 'a@b.c' },
      ]) {
        const r = await createHomeHub().prepare(body);
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body)).not.toContain(PASSWORD);
      }
      expect(calls).toEqual([]);
      expect('join' in createHomeHub()).toBe(false);
      const gone = await homeFetch()(
        homeReq('/_home/hub/join', {
          method: 'POST',
          body: JSON.stringify({ profile: 'work', url: 'https://hub.example.com' }),
        })
      );
      expect(gone.status).toBe(404);
    } finally {
      globalThis.fetch = real;
    }
  });

  test('no sign-in yet: a known hub this profile has no credential for → sign in first', async () => {
    const r = await createHomeHub().prepare({ profile: 'work', url: 'https://hub.example.com' });
    expect(r.status).toBe(401);
  });
});

describe('#204 K2 — Sign in on the team server’s own page, from Home', () => {
  const KEY = `inv_${'5e'.repeat(24)}`;
  const RETURN = `http://${HOST}/_api/hub-signin/return`;
  type Fetch = ReturnType<typeof homeFetch>;
  type Started = { ok: boolean; id: string; signInUrl: string };
  const nav = (query: string, headers: Record<string, string> = {}) =>
    new Request(`http://${HOST}/_api/hub-signin/return?${query}`, {
      headers: {
        host: HOST,
        'sec-fetch-mode': 'navigate',
        'sec-fetch-dest': 'document',
        'sec-fetch-site': 'cross-site',
        ...headers,
      },
    });
  const start = (f: Fetch, body: Record<string, unknown>) =>
    f(homeReq('/_home/hub/signin/start', { method: 'POST', body: JSON.stringify(body) }));
  const started = async (f: Fetch, body: Record<string, unknown>) =>
    (await (await start(f, body)).json()) as Started;
  const poll = async (f: Fetch, id: string) =>
    (await (
      await f(homeReq('/_home/hub/signin/poll', { method: 'POST', body: JSON.stringify({ id }) }))
    ).json()) as Record<string, unknown>;
  const stateOf = (a: Started) => new URL(a.signInUrl).searchParams.get('state') ?? '';

  test('start → the hub’s page back to HOME’s origin; the return stores the session in THIS profile; prepare opens it', async () => {
    const hub = fakeHub({ desktop: true });
    const state = mkdtempSync(join(tmpdir(), 'maude-home-hub-state-'));
    try {
      const f = homeFetch({ stateDir: state });
      const r = await start(f, { profile: 'work', url: hub.url });
      expect(r.status).toBe(200);
      const a = (await r.json()) as Started;
      const u = new URL(a.signInUrl);
      expect(`${u.origin}${u.pathname}`).toBe(`${hub.url}/studio/signin`);
      expect(u.searchParams.get('redirect_uri')).toBe(RETURN);
      expect(u.searchParams.get('client')).toBe('desktop');
      expect(u.searchParams.get('code_challenge_method')).toBe('S256');
      expect([...u.searchParams.keys()].sort()).toEqual(
        ['client', 'code_challenge', 'code_challenge_method', 'redirect_uri', 'state'].sort()
      );
      hub.remember(a.signInUrl);
      expect(await poll(f, a.id)).toEqual({ ok: true, pending: true });

      const back = await f(nav(`code=${hub.code}&state=${stateOf(a)}`));
      expect(back.status).toBe(200);
      expect(back.headers.get('content-security-policy')).toContain("default-src 'none'");
      expect(await back.text()).not.toContain('peer-home-token');
      expect(await poll(f, a.id)).toMatchObject({ ok: true, url: hub.url });
      // the exchange: ONE POST, code + verifier only
      const ex = hub.seen.filter((s) => s.path === '/auth/desktop/exchange');
      expect(ex).toHaveLength(1);
      expect(Object.keys(JSON.parse(ex[0]?.body ?? '{}')).sort()).toEqual([
        'code',
        'code_verifier',
      ]);
      const workHubs = join(xdg, 'maude', 'profiles', 'work', 'hubs.json');
      expect(JSON.parse(readFileSync(workHubs, 'utf8')).hubs[hub.url].token).toBe(
        'peer-home-token'
      );
      expect(existsSync(join(xdg, 'maude', 'hubs.json'))).toBe(false);
      // … and the project opens the way a known server's does
      const prep = await f(
        homeReq('/_home/hub/prepare', {
          method: 'POST',
          body: JSON.stringify({ profile: 'work', url: hub.url }),
        })
      );
      expect(prep.status).toBe(200);
      expect(await prep.json()).toMatchObject({ ok: true, profile: 'work', projectId: 'team-a' });
      expect(logged.join('\n')).not.toContain('peer-home-token');
    } finally {
      hub.stop();
    }
  });

  test('an invite opens the hub’s own invite page with the same request; the key reaches no request, file or log', async () => {
    const hub = fakeHub({ desktop: true });
    try {
      const f = homeFetch();
      for (const invite of [KEY, `${hub.url}/join/${KEY}`]) {
        const r = await start(f, { profile: 'work', url: hub.url, invite });
        expect(r.status).toBe(200);
        const a = (await r.json()) as Started;
        const u = new URL(a.signInUrl);
        expect(`${u.origin}${u.pathname}`).toBe(`${hub.url}/join/${KEY}`);
        expect(u.searchParams.get('redirect_uri')).toBe(RETURN);
        expect(u.searchParams.has('invite')).toBe(false);
        hub.remember(a.signInUrl);
        expect((await f(nav(`code=${hub.code}&state=${stateOf(a)}`))).status).toBe(200);
        expect(await poll(f, a.id)).toMatchObject({ ok: true, url: hub.url });
      }
      // the key went to the hub only inside the page the browser opens — never a request Home made
      expect(hub.seen.some((s) => s.path.includes(KEY) || s.body.includes(KEY))).toBe(false);
      for (const file of filesUnder(xdg)) expect(readFileSync(file, 'utf8')).not.toContain(KEY);
      expect(logged.join('\n')).not.toContain(KEY);
      // a link to another hub is refused before anything is sent
      const before = hub.seen.length;
      const other = await start(f, {
        profile: 'work',
        url: hub.url,
        invite: `https://other-hub.example/join/${KEY}`,
      });
      expect(other.status).toBe(400);
      expect(((await other.json()) as { error: string }).error).toBe(
        'That invite is for a different hub address.'
      );
      expect(hub.seen.length).toBe(before);
    } finally {
      hub.stop();
    }
  });

  test('an unrequested, replayed or cancelled callback changes nothing', async () => {
    const hub = fakeHub({ desktop: true });
    try {
      const f = homeFetch();
      // never started here
      expect((await f(nav(`code=${hub.code}&state=${'ab'.repeat(16)}`))).status).toBe(400);
      // used once, then replayed
      const a = await started(f, { profile: 'work', url: hub.url });
      hub.remember(a.signInUrl);
      expect((await f(nav(`code=${hub.code}&state=${stateOf(a)}`))).status).toBe(200);
      expect((await f(nav(`code=${hub.code}&state=${stateOf(a)}`))).status).toBe(400);
      // cancelled before the browser came back
      const c = await started(f, { profile: 'work', url: hub.url });
      await f(
        homeReq('/_home/hub/signin/cancel', { method: 'POST', body: JSON.stringify({ id: c.id }) })
      );
      expect((await f(nav(`code=${hub.code}&state=${stateOf(c)}`))).status).toBe(400);
      expect(hub.seen.filter((s) => s.path === '/auth/desktop/exchange')).toHaveLength(1);
    } finally {
      hub.stop();
    }
  });

  test('the return answers a top-level navigation only — a fetch, a frame, a POST or a foreign Host change nothing', async () => {
    const hub = fakeHub({ desktop: true });
    try {
      const f = homeFetch();
      const a = await started(f, { profile: 'work', url: hub.url });
      hub.remember(a.signInUrl);
      const q = `code=${hub.code}&state=${stateOf(a)}`;
      for (const headers of [
        { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' },
        { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'iframe' },
        { 'sec-fetch-mode': 'no-cors', 'sec-fetch-dest': 'image' },
        { host: 'evil.example:4500' },
      ])
        expect([headers, (await f(nav(q, headers))).status]).toEqual([headers, 403]);
      const noMeta = new Request(`http://${HOST}/_api/hub-signin/return?${q}`, {
        headers: { host: HOST },
      });
      expect((await f(noMeta)).status).toBe(403);
      const post = new Request(`http://${HOST}/_api/hub-signin/return?${q}`, {
        method: 'POST',
        headers: { host: HOST, 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' },
      });
      expect((await f(post)).status).toBe(405);
      expect(hub.seen.some((s) => s.path === '/auth/desktop/exchange')).toBe(false);
      // still waiting: the real navigation completes it
      expect((await f(nav(q))).status).toBe(200);
    } finally {
      hub.stop();
    }
  });

  test('a team server older than 2.0.4 is told to update, with its version; nothing opens', async () => {
    const hub = fakeHub();
    try {
      const r = await start(homeFetch(), { profile: 'work', url: hub.url });
      expect(r.status).toBe(409);
      const b = (await r.json()) as { ok: boolean; reason: string; error: string };
      expect(b).toMatchObject({ ok: false, reason: 'needs-update' });
      expect(b.error).toContain('1.4.0');
      expect(b.error).toContain('2.0.4');
      expect(b.error).not.toMatch(/\b(we|I|Maude)\b/);
      expect('signInUrl' in b).toBe(false);
    } finally {
      hub.stop();
    }
  });

  test('a bad profile, address or invite → 400 before any request', async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      calls.push(String(u));
      return new Response('{}');
    }) as unknown as typeof fetch;
    try {
      const f = homeFetch();
      for (const body of [
        { profile: '../x', url: 'https://hub.example.com' },
        { profile: 'work', url: 'http://hub.example.com' },
        { profile: 'work', url: 'https://hub.example.com', invite: 'not-a-key' },
        { profile: 'work', url: 'https://hub.example.com', invite: 7 },
      ])
        expect([body, (await start(f, body)).status]).toEqual([body, 400]);
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });
});

describe('the routes', () => {
  test('/_home/hub/test answers through the Home table', async () => {
    const hub = fakeHub();
    try {
      const r = await homeFetch()(
        homeReq('/_home/hub/test', { method: 'POST', body: JSON.stringify({ url: hub.url }) })
      );
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, reachable: true, version: '1.4.0' });
    } finally {
      hub.stop();
    }
  });
});
