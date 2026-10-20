// S6.6 — Home's "Connect to your own hub" (contract S6-slices row S6.6): Test connection probes
// `/health` only (tokenless, no body, no redirect followed); https unless loopback, checked before
// any byte leaves; Connect posts the password ONCE to `/auth/login`, stores only the minted token in
// THAT profile's hubs.json, and Home never stores, echoes or logs the password.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createHomeHub, hubAddress } from '../home/hub.ts';
import { homeFetch, homeReq } from './_home-fixtures.ts';

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
    join?: 'ok' | 'gone' | 'redirect' | 'junk' | 'phish';
  } = {}
) {
  const seen: Seen[] = [];
  const access: (string | null)[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      seen.push({
        method: req.method,
        path: url.pathname,
        auth: req.headers.get('authorization'),
        cookie: req.headers.get('cookie'),
        body: await req.text(),
      });
      if (url.pathname === '/health') {
        if (opts.health === 'down') return new Response('no', { status: 500 });
        if (opts.health === 'other') return Response.json({ status: 'fine' });
        if (opts.health === 'redirect')
          return new Response(null, { status: 302, headers: { location: '/auth/login' } });
        return Response.json({ ok: true, version: '1.4.0' });
      }
      if (url.pathname === '/auth/login')
        return Response.json({
          token: 'hub-token-abc',
          expiresAt: Date.now() + 3_600_000,
          user: { email: 'ana@example.test', role: 'member' },
        });
      if (url.pathname === '/join' && req.method === 'POST') {
        access.push(req.headers.get('x-maude-access'));
        if (opts.join === 'gone')
          return Response.json(
            {
              ok: false,
              reason: 'expired',
              error: 'This invitation has expired. Ask whoever invited you for a new link.',
            },
            { status: 410 }
          );
        if (opts.join === 'phish')
          return Response.json(
            {
              ok: false,
              reason: 'unknown',
              error: 'Your Maude licence lapsed. Call support at +1 555 0100 to restore it.',
            },
            { status: 403 }
          );
        if (opts.join === 'redirect')
          return new Response(null, { status: 307, headers: { location: 'https://evil.test/' } });
        if (opts.join === 'junk') return new Response('<html>', { status: 201 });
        return Response.json(
          {
            ok: true,
            token: 'hub-invite-session-xyz',
            label: 'api-1',
            expiresAt: Date.now() + 3_600_000,
            user: { email: 'ana@example.test', role: 'member' },
          },
          { status: 201 }
        );
      }
      if (url.pathname === '/api/projects/current/v1/bootstrap')
        return Response.json({ projectId: 'team-a', canvasGroups: ['ui'] });
      return new Response('nope', { status: 404 });
    },
  });
  return { url: `http://127.0.0.1:${server.port}`, seen, access, stop: () => server.stop(true) };
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

describe('Connect: the password is posted once and never stored by Home', () => {
  test('one POST /auth/login; token in THIS profile’s hubs.json; the password nowhere', async () => {
    const hub = fakeHub();
    const state = mkdtempSync(join(tmpdir(), 'maude-home-hub-state-'));
    try {
      const f = homeFetch({ stateDir: state });
      const r = await f(
        homeReq('/_home/hub/prepare', {
          method: 'POST',
          body: JSON.stringify({
            profile: 'work',
            url: hub.url,
            email: 'ana@example.test',
            password: PASSWORD,
          }),
        })
      );
      const text = await r.text();
      expect(r.status).toBe(200);
      expect(JSON.parse(text)).toMatchObject({
        ok: true,
        profile: 'work',
        serverUrl: hub.url,
        projectId: 'team-a',
        role: 'member',
      });
      // the answer never echoes the password
      expect(text).not.toContain(PASSWORD);
      // the password reached the hub exactly once, at /auth/login, after the tokenless probe
      const logins = hub.seen.filter((s) => s.path === '/auth/login');
      expect(logins).toHaveLength(1);
      expect(JSON.parse(logins[0]?.body ?? '{}').password).toBe(PASSWORD);
      expect(hub.seen[0]?.path).toBe('/health');
      expect(hub.seen.filter((s) => s.body.includes(PASSWORD))).toHaveLength(1);
      // the minted token lands in the named profile's hubs.json — never the default one
      const workHubs = join(xdg, 'maude', 'profiles', 'work', 'hubs.json');
      expect(JSON.parse(readFileSync(workHubs, 'utf8')).hubs[hub.url].token).toBe('hub-token-abc');
      expect(existsSync(join(xdg, 'maude', 'hubs.json'))).toBe(false);
      // no file Home or the credential store wrote holds the password
      for (const file of [...filesUnder(xdg), ...filesUnder(state)])
        expect([file, readFileSync(file, 'utf8').includes(PASSWORD)]).toEqual([file, false]);
      expect(logged.join('\n')).not.toContain(PASSWORD);
    } finally {
      hub.stop();
    }
  });

  test('a hub that fails the probe never receives the password', async () => {
    for (const health of ['down', 'other', 'redirect'] as const) {
      const hub = fakeHub({ health });
      try {
        const r = await createHomeHub().prepare({
          profile: 'default',
          url: hub.url,
          email: 'ana@example.test',
          password: PASSWORD,
        });
        expect(r.status).not.toBe(200);
        expect(hub.seen.filter((s) => s.path === '/auth/login')).toHaveLength(0);
        expect(JSON.stringify(r.body)).not.toContain(PASSWORD);
      } finally {
        hub.stop();
      }
    }
  });

  test('plain-http remote, userinfo, or a bad profile → refused before any request', async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      calls.push(String(u));
      return new Response('{}');
    }) as unknown as typeof fetch;
    try {
      const hub = createHomeHub();
      for (const body of [
        { profile: 'default', url: 'http://hub.example.com', email: 'a@b.c', password: PASSWORD },
        {
          profile: 'default',
          url: 'https://a:b@hub.example.com',
          email: 'a@b.c',
          password: PASSWORD,
        },
        { profile: '../x', url: 'https://hub.example.com', email: 'a@b.c', password: PASSWORD },
        { profile: 'default', url: 'https://hub.example.com', email: 'a@b.c', password: 7 },
      ]) {
        const r = await hub.prepare(body);
        expect(r.status).toBe(400);
        expect(JSON.stringify(r.body)).not.toContain(PASSWORD);
      }
      expect(calls).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });

  test('no password: a known hub this profile has no credential for → sign in first', async () => {
    const r = await createHomeHub().prepare({ profile: 'work', url: 'https://hub.example.com' });
    expect(r.status).toBe(401);
  });
});

describe('S6.11b — "Invite link or key": redeem through the hub’s POST /join', () => {
  const KEY = `inv_${'5e'.repeat(24)}`;
  const joinBody = (url: string, token: string = KEY) => ({
    profile: 'work',
    url,
    token,
    email: 'ana@example.test',
    password: PASSWORD,
  });

  test('probe, ONE POST /join (JSON, access declared), session in THIS profile’s hubs.json, prepare-shaped answer, no secret anywhere', async () => {
    const hub = fakeHub();
    const state = mkdtempSync(join(tmpdir(), 'maude-home-hub-state-'));
    try {
      const r = await homeFetch({ stateDir: state })(
        homeReq('/_home/hub/join', { method: 'POST', body: JSON.stringify(joinBody(hub.url)) })
      );
      const text = await r.text();
      expect(r.status).toBe(200);
      expect(JSON.parse(text)).toMatchObject({
        ok: true,
        profile: 'work',
        serverUrl: hub.url,
        projectId: 'team-a',
        role: 'member',
        canvasGroups: ['ui'],
      });
      for (const s of [KEY, PASSWORD, 'hub-invite-session-xyz']) expect(text).not.toContain(s);
      // the tokenless probe first; the invite key and password reach the hub once, in the /join body
      expect(hub.seen[0]).toMatchObject({ method: 'GET', path: '/health', auth: null, body: '' });
      const joins = hub.seen.filter((s) => s.path === '/join');
      expect(joins).toHaveLength(1);
      expect(JSON.parse(joins[0]?.body ?? '{}')).toEqual({
        token: KEY,
        email: 'ana@example.test',
        password: PASSWORD,
      });
      expect(hub.access).toEqual(['2']);
      for (const s of [KEY, PASSWORD]) {
        expect(hub.seen.filter((x) => x.body.includes(s))).toHaveLength(1);
        // never in a URL
        expect(hub.seen.some((x) => x.path.includes(s))).toBe(false);
      }
      // the project is read with the minted session
      expect(hub.seen.find((s) => s.path.endsWith('/bootstrap'))?.auth).toBe(
        'Bearer hub-invite-session-xyz'
      );
      const workHubs = join(xdg, 'maude', 'profiles', 'work', 'hubs.json');
      expect(JSON.parse(readFileSync(workHubs, 'utf8')).hubs[hub.url]).toMatchObject({
        token: 'hub-invite-session-xyz',
      });
      expect(existsSync(join(xdg, 'maude', 'hubs.json'))).toBe(false);
      for (const file of [...filesUnder(xdg), ...filesUnder(state)])
        for (const s of [KEY, PASSWORD])
          expect([file, s, readFileSync(file, 'utf8').includes(s)]).toEqual([file, s, false]);
      for (const s of [KEY, PASSWORD]) expect(logged.join('\n')).not.toContain(s);
    } finally {
      hub.stop();
    }
  });

  test('the hub’s own invite link for THIS hub works; a link to another hub is refused before any request', async () => {
    const hub = fakeHub();
    try {
      const ok = await createHomeHub().join(joinBody(hub.url, `${hub.url}/join/${KEY}`));
      expect(ok.status).toBe(200);
      expect(JSON.parse(hub.seen.find((s) => s.path === '/join')?.body ?? '{}').token).toBe(KEY);
      const before = hub.seen.length;
      const other = await createHomeHub().join(
        joinBody(hub.url, `https://other-hub.example/join/${KEY}`)
      );
      expect(other.status).toBe(400);
      expect((other.body as { error: string }).error).toBe(
        'That invite is for a different hub address.'
      );
      expect(hub.seen.length).toBe(before);
    } finally {
      hub.stop();
    }
  });

  test('a dead invite answers in words; nothing is stored; a redirect is never followed', async () => {
    for (const mode of ['gone', 'redirect', 'junk', 'phish'] as const) {
      const hub = fakeHub({ join: mode });
      try {
        const r = await createHomeHub().join(joinBody(hub.url));
        expect([mode, r.status === 200]).toEqual([mode, false]);
        const b = r.body as { ok: boolean; error: string };
        expect(b.ok).toBe(false);
        if (mode === 'gone') {
          expect(r.status).toBe(410);
          // our words, never the hub's own sentence (gate-b-sec1)
          expect(b.error).toBe(
            "This invite doesn't work any more. Ask whoever invited you for a new one."
          );
        }
        if (mode === 'phish') {
          expect(r.status).toBe(403);
          expect(b.error).toBe('The hub refused the invite.');
          expect(JSON.stringify(r.body)).not.toContain('555');
        }
        for (const s of [KEY, PASSWORD]) expect(JSON.stringify(r.body)).not.toContain(s);
        expect(hub.seen.filter((s) => s.path === '/join')).toHaveLength(1);
        expect(hub.seen.some((s) => s.path.endsWith('/bootstrap'))).toBe(false);
        expect(existsSync(join(xdg, 'maude', 'profiles', 'work', 'hubs.json'))).toBe(false);
      } finally {
        hub.stop();
      }
    }
  });

  test('a hub that fails the probe never receives the key or the password', async () => {
    for (const health of ['down', 'other', 'redirect'] as const) {
      const hub = fakeHub({ health });
      try {
        const r = await createHomeHub().join(joinBody(hub.url));
        expect(r.status).not.toBe(200);
        expect(hub.seen.map((s) => s.path)).toEqual(['/health']);
      } finally {
        hub.stop();
      }
    }
  });

  test('junk key, plain-http remote, bad profile, missing email or password → 400 before any request', async () => {
    const calls: string[] = [];
    const real = globalThis.fetch;
    globalThis.fetch = (async (u: string) => {
      calls.push(String(u));
      return new Response('{}');
    }) as unknown as typeof fetch;
    try {
      const hub = createHomeHub();
      const base = joinBody('https://hub.example.com');
      for (const body of [
        { ...base, token: 'not-a-key' },
        { ...base, token: `https://hub.example.com/join/${KEY}?x=1` },
        { ...base, token: 7 },
        { ...base, url: 'http://hub.example.com' },
        { ...base, profile: '../x' },
        { ...base, email: '' },
        { ...base, password: '' },
      ]) {
        const r = await hub.join(body);
        expect([body, r.status]).toEqual([body, 400]);
        for (const s of [KEY, PASSWORD]) expect(JSON.stringify(r.body)).not.toContain(s);
      }
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
