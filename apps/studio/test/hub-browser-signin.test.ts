// Issue #204 — the desktop signs in to a team server on the hub's own page and comes back with a
// one-time code (sync/hub-browser-signin.ts, routes/hub-signin.ts; the hub half is
// apps/hub/src/desktop-signin.mjs). A fake hub stands in for the network here; the real round
// trip against a booted hub is the hands-on in the hand-back.

import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { guardTableRoute } from '../http.ts';
import { createHubSigninRoutes } from '../routes/hub-signin.ts';
import {
  createHubBrowserSignIn,
  DESKTOP_SIGNIN_CAPABILITY,
  HUB_SIGNIN_RETURN_PATH,
  HUB_SIGNIN_WORDS,
  returnUriFor,
  teamServerAddress,
} from '../sync/hub-browser-signin.ts';

const HUB = 'https://design.team.example';
const SELF = 'http://127.0.0.1:4399';

/** A fake team server: /health + /auth/desktop/exchange, one code it will redeem. */
function fakeHub(opts: { capabilities?: string[]; exchangeStatus?: number } = {}) {
  const calls: { url: string; body?: unknown }[] = [];
  let challenge = '';
  const code = 'one-time-code-abc';
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url === `${HUB}/health`) {
      return Response.json({
        ok: true,
        capabilities: opts.capabilities ?? ['ledger', DESKTOP_SIGNIN_CAPABILITY],
      });
    }
    if (url === `${HUB}/auth/desktop/exchange`) {
      const b = body as { code: string; code_verifier: string };
      const s256 = createHash('sha256').update(b.code_verifier).digest('base64url');
      if (opts.exchangeStatus)
        return Response.json({ error: 'no' }, { status: opts.exchangeStatus });
      if (b.code !== code || s256 !== challenge)
        return Response.json({ error: 'invalid' }, { status: 400 });
      return Response.json({
        token: 'peer-token-xyz',
        expiresAt: 1_900_000_000_000,
        user: { email: 'michal@team.example', role: 'member' },
      });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return {
    fetchImpl,
    calls,
    code,
    /** What the hub would keep from the page URL the app opened. */
    rememberChallenge(signInUrl: string) {
      challenge = new URL(signInUrl).searchParams.get('code_challenge') ?? '';
    },
  };
}

function setup(hubOpts?: Parameters<typeof fakeHub>[0]) {
  const hub = fakeHub(hubOpts);
  const saved: unknown[][] = [];
  const signedIn: string[] = [];
  const flow = createHubBrowserSignIn({
    fetchImpl: hub.fetchImpl,
    save: (...args) => saved.push(args),
    onSignedIn: (url) => {
      signedIn.push(url);
    },
  });
  return { hub, flow, saved, signedIn };
}

const back = (params: Record<string, string>) => new URLSearchParams(params);

describe('addresses', () => {
  test('https, or http on loopback only', () => {
    expect(teamServerAddress('https://design.team.example/').ok).toBe(true);
    expect(teamServerAddress('http://127.0.0.1:8787').ok).toBe(true);
    expect(teamServerAddress('http://design.team.example')).toEqual({
      ok: false,
      error: HUB_SIGNIN_WORDS.notHttps,
    });
    expect(teamServerAddress('https://u:p@design.team.example').ok).toBe(false);
    expect(teamServerAddress('').ok).toBe(false);
  });

  test('the return target is this loopback server, one path', () => {
    expect(returnUriFor(SELF)).toBe(`${SELF}${HUB_SIGNIN_RETURN_PATH}`);
    expect(returnUriFor('https://evil.example')).toBeNull();
    expect(returnUriFor('http://127.0.0.1')).toBeNull();
  });
});

describe('the round trip', () => {
  test('start → the hub page URL with state + S256 challenge; no secret in it', async () => {
    const { flow } = setup();
    const r = await flow.start(HUB, SELF);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = new URL(r.signInUrl);
    expect(`${u.origin}${u.pathname}`).toBe(`${HUB}/studio/signin`);
    expect(u.searchParams.get('client')).toBe('desktop');
    expect(u.searchParams.get('state')).toBe(r.id);
    expect(u.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(`${SELF}${HUB_SIGNIN_RETURN_PATH}`);
    expect(r.signInUrl).not.toContain('verifier');
  });

  test('the return exchanges code + verifier, stores the token through the one path, once', async () => {
    const { hub, flow, saved, signedIn } = setup();
    const r = await flow.start(HUB, SELF);
    if (!r.ok) throw new Error('start failed');
    hub.rememberChallenge(r.signInUrl);
    expect(flow.poll(r.id)).toEqual({ ok: true, pending: true });

    const done = await flow.onReturn(back({ state: r.id, code: hub.code }));
    expect(done.ok).toBe(true);
    expect(saved).toEqual([
      [HUB, 'peer-token-xyz', 'member', 1_900_000_000_000, 'michal@team.example'],
    ]);
    expect(signedIn).toEqual([HUB]);
    expect(flow.poll(r.id)).toEqual({
      ok: true,
      url: HUB,
      user: { email: 'michal@team.example', role: 'member' },
    });
    // A replayed callback changes nothing: no second exchange, no second save.
    const exchanges = hub.calls.filter((c) => c.url.endsWith('/auth/desktop/exchange')).length;
    const replay = await flow.onReturn(back({ state: r.id, code: hub.code }));
    expect(replay).toEqual({ ok: false, message: HUB_SIGNIN_WORDS.unknown });
    expect(hub.calls.filter((c) => c.url.endsWith('/auth/desktop/exchange')).length).toBe(
      exchanges
    );
    expect(saved.length).toBe(1);
  });

  test('an unrequested callback (a state this server never minted) is refused, no network', async () => {
    const { hub, flow, saved } = setup();
    const r = await flow.onReturn(back({ state: 'a'.repeat(32), code: 'x' }));
    expect(r).toEqual({ ok: false, message: HUB_SIGNIN_WORDS.unknown });
    expect(hub.calls.length).toBe(0);
    expect(saved.length).toBe(0);
  });

  test('a second callback for a live attempt after a refused exchange is refused too', async () => {
    const { hub, flow, saved } = setup();
    const r = await flow.start(HUB, SELF);
    if (!r.ok) throw new Error('start failed');
    hub.rememberChallenge(r.signInUrl);
    expect((await flow.onReturn(back({ state: r.id, code: 'forged' }))).ok).toBe(false);
    expect((await flow.onReturn(back({ state: r.id, code: hub.code }))).ok).toBe(false);
    expect(saved.length).toBe(0);
    expect(flow.poll(r.id)).toEqual({ ok: false, error: HUB_SIGNIN_WORDS.refused });
  });

  test('the hub said the person waits for approval → plain words, nothing stored', async () => {
    const { flow, saved } = setup();
    const r = await flow.start(HUB, SELF);
    if (!r.ok) throw new Error('start failed');
    await flow.onReturn(back({ state: r.id, error: 'pending' }));
    expect(flow.poll(r.id)).toEqual({ ok: false, error: HUB_SIGNIN_WORDS.pending });
    expect(saved.length).toBe(0);
  });

  test('Can view (409) and a newer-client claim (426) say why', async () => {
    for (const [status, words] of [
      [409, HUB_SIGNIN_WORDS.browserOnly],
      [426, HUB_SIGNIN_WORDS.update],
    ] as const) {
      const { hub, flow } = setup({ exchangeStatus: status });
      const r = await flow.start(HUB, SELF);
      if (!r.ok) throw new Error('start failed');
      await flow.onReturn(back({ state: r.id, code: hub.code }));
      expect(flow.poll(r.id)).toEqual({ ok: false, error: words });
    }
  });

  test('a team server without the capability is told to update; nothing opens', async () => {
    const { flow } = setup({ capabilities: ['ledger'] });
    expect(await flow.start(HUB, SELF)).toEqual({
      ok: false,
      error: HUB_SIGNIN_WORDS.needsUpdate(null),
      status: 409,
      reason: 'needs-update',
    });
    expect(flow.size()).toBe(0);
  });

  test('cancel forgets the attempt: its return changes nothing', async () => {
    const { hub, flow, saved } = setup();
    const r = await flow.start(HUB, SELF);
    if (!r.ok) throw new Error('start failed');
    hub.rememberChallenge(r.signInUrl);
    flow.cancel(r.id);
    expect((await flow.onReturn(back({ state: r.id, code: hub.code }))).ok).toBe(false);
    expect(saved.length).toBe(0);
  });
});

describe('the return route is the one table spec a cross-site navigation may reach', () => {
  const specs = createHubSigninRoutes({});
  const ret = specs.find((s) => s.path === HUB_SIGNIN_RETURN_PATH);
  if (!ret) throw new Error('no return route');
  const guarded = guardTableRoute(ret);
  const url = `${SELF}${HUB_SIGNIN_RETURN_PATH}?state=${'b'.repeat(32)}&code=x`;

  test('a top-level navigation from the hub reaches the handler (which refuses the unknown state)', async () => {
    const r = await guarded.handle(
      new Request(url, {
        headers: {
          host: '127.0.0.1:4399',
          'sec-fetch-site': 'cross-site',
          'sec-fetch-mode': 'navigate',
          'sec-fetch-dest': 'document',
        },
      }),
      {}
    );
    expect(r.status).toBe(400);
    expect(await r.text()).toContain(HUB_SIGNIN_WORDS.unknown.replace(/'/g, '&#39;'));
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  test('a cross-site fetch, image or frame is still refused at the gate', async () => {
    for (const [mode, dest] of [
      ['no-cors', 'image'],
      ['cors', 'empty'],
      ['navigate', 'iframe'],
    ]) {
      const r = await guarded.handle(
        new Request(url, {
          headers: {
            host: '127.0.0.1:4399',
            'sec-fetch-site': 'cross-site',
            'sec-fetch-mode': mode as string,
            'sec-fetch-dest': dest as string,
          },
        }),
        {}
      );
      expect(r.status).toBe(403);
    }
  });

  test('every other hub-signin spec refuses a cross-site browser', async () => {
    for (const spec of specs.filter((s) => s !== ret)) {
      const r = await guardTableRoute(spec).handle(
        new Request(`${SELF}${spec.path}`, {
          method: 'POST',
          headers: { origin: 'https://design.team.example', 'content-type': 'text/plain' },
          body: '{}',
        }),
        {}
      );
      expect(r.status).toBe(403);
    }
  });
});
