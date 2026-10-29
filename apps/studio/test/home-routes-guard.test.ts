// V2-3.3 — the Home server's guards (V2-1.1 §5.3 "Guards", §5.8 items 1 and 2). In-process: the
// Home fetch is a pure function of the request, so every refusal is checked without a boot.

import { beforeAll, describe, expect, test } from 'bun:test';

import { homeRouteTable } from '../home/routes.ts';
import {
  freshIndexDir,
  HOST,
  homeDeps,
  homeFetch,
  homeReq,
  PAGE_SECRET,
  rustReq,
  TOKEN,
} from './_home-fixtures.ts';

beforeAll(() => {
  freshIndexDir();
});

const fetchHome = homeFetch();
const CORS = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
];

/** Every non-static row of the §5.3 table, as one GET/POST sample each. */
const SAMPLES: Array<{ method: 'GET' | 'POST'; path: string }> = homeRouteTable(homeDeps()).map(
  (r) => ({
    method: r.method,
    path: r.prefix ? `${r.path}l0000000000000000/${'a'.repeat(64)}.jpg` : r.path,
  })
);
const PAGE = SAMPLES.filter((s) => !s.path.startsWith('/_home/internal/'));
const INTERNAL = SAMPLES.filter((s) => s.path.startsWith('/_home/internal/'));

describe('Home route guards (§5.8 item 1)', () => {
  test('the table covers every §5.3 row but the static lane', () => {
    const paths = new Set(SAMPLES.map((s) => s.path.replace(/l0{16}\/a{64}\.jpg$/, '')));
    for (const p of [
      '/_health',
      '/_config',
      '/_home/index',
      '/_home/thumb/',
      '/_home/search',
      '/_home/recent-searches',
      '/_home/pins',
      '/_home/projects/create-local',
      '/_home/cloud',
      '/_home/cloud/prepare',
      '/_home/internal/search',
      '/_home/internal/thumbs',
      // S6.5 — sign-in + invite proxy, and the profile Rust names for the next sign-in
      '/_home/cloud/signin/start',
      '/_home/cloud/signin/poll',
      '/_home/cloud/signin/cancel',
      '/_home/invite/peek',
      '/_home/invite/accept',
      '/_home/internal/signin/profile',
      // S6.6 — hub, AI, CLI, What's New
      '/_home/hub/test',
      '/_home/hub/prepare',
      // S6.11b — the hub sheet's "Invite link or key"
      '/_home/hub/join',
      '/_home/ai/status',
      '/_home/ai/connect',
      '/_home/cli/status',
      '/_home/cli/install',
      '/_home/whats-new',
      // S6.10 — Rust's GitHub clone (bearer only)
      '/_home/internal/github/clone',
      // p8-port-gc — the index GC, with the registry Rust sends (bearer only)
      '/_home/internal/index-gc',
    ])
      expect([p, paths.has(p)]).toEqual([p, true]);
  });

  test("S6.6: the hub / AI / CLI / What's New rows are page routes (page secret)", () => {
    const kinds = new Map(homeRouteTable(homeDeps()).map((r) => [`${r.method} ${r.path}`, r.kind]));
    for (const row of [
      'POST /_home/hub/test',
      'POST /_home/hub/prepare',
      'POST /_home/hub/join',
      'GET /_home/ai/status',
      'POST /_home/ai/connect',
      'GET /_home/cli/status',
      'POST /_home/cli/install',
      'GET /_home/whats-new',
      'POST /_home/whats-new',
    ])
      expect([row, kinds.get(row)]).toEqual([row, 'home']);
  });

  test('every page row is reached only through the page secret — none is internal or open', () => {
    // a new row lands in SAMPLES automatically; this pins that it is one of the two guarded kinds
    for (const r of homeRouteTable(homeDeps()))
      expect([r.path, r.kind === 'home' || r.kind === 'internal']).toEqual([r.path, true]);
    expect(PAGE.length + INTERNAL.length).toBe(SAMPLES.length);
  });

  test('S6.5: the sign-in and invite rows are page routes, the profile row is internal', () => {
    const kinds = new Map(homeRouteTable(homeDeps()).map((r) => [`${r.method} ${r.path}`, r.kind]));
    for (const row of [
      'POST /_home/cloud/signin/start',
      'POST /_home/cloud/signin/poll',
      'POST /_home/cloud/signin/cancel',
      'POST /_home/invite/peek',
      'POST /_home/invite/accept',
    ])
      expect([row, kinds.get(row)]).toEqual([row, 'home']);
    expect(kinds.get('POST /_home/internal/signin/profile')).toBe('internal');
  });

  test('a request the Home page would send passes', async () => {
    const r = await fetchHome(homeReq('/_health'));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, mode: 'home' });
    expect(r.headers.get('cache-control')).toBe('no-store');
  });

  test('/_config is Home-shaped: no project fields', async () => {
    const r = await fetchHome(homeReq('/_config'));
    const body = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'cloudOrigin',
      'formatSupported',
      'mode',
      'shell',
      'version',
    ]);
    expect(body).toMatchObject({ mode: 'home', shell: 'home' });
  });

  test('missing x-maude-home → 403 on every route', async () => {
    for (const s of SAMPLES) {
      const req = new Request(`http://${HOST}${s.path}`, {
        method: s.method,
        headers: { host: HOST, 'sec-fetch-site': 'same-origin', authorization: `Bearer ${TOKEN}` },
        ...(s.method === 'POST' ? { body: '{}' } : {}),
      });
      expect([s.path, (await fetchHome(req)).status]).toEqual([s.path, 403]);
    }
  });

  test('Sec-Fetch-Site: same-site (a project page on another port) → 403', async () => {
    for (const s of PAGE) {
      const r = await fetchHome(
        homeReq(s.path, {
          method: s.method,
          headers: { 'sec-fetch-site': 'same-site' },
          ...(s.method === 'POST' ? { body: '{}' } : {}),
        })
      );
      expect([s.path, r.status]).toEqual([s.path, 403]);
    }
    for (const site of ['cross-site', 'same-site'])
      expect(
        (await fetchHome(homeReq('/_config', { headers: { 'sec-fetch-site': site } }))).status
      ).toBe(403);
  });

  test('a foreign Host (DNS rebinding) → 403, static lane included', async () => {
    for (const path of ['/_health', '/_home/index', '/'])
      expect(
        (await fetchHome(homeReq(path, { headers: { host: 'evil.example:4500' } }))).status
      ).toBe(403);
  });

  test('a POST whose Origin is another host → 403', async () => {
    const r = await fetchHome(
      homeReq('/_home/recent-searches', {
        method: 'POST',
        headers: { origin: 'http://127.0.0.1:4401' },
        body: JSON.stringify({ q: 'x' }),
      })
    );
    expect(r.status).toBe(403);
  });

  test('OPTIONS → 405 with no CORS headers, on every path', async () => {
    for (const path of ['/', '/_health', '/_home/pins', '/_home/internal/search', '/nope']) {
      const r = await fetchHome(
        homeReq(path, {
          method: 'OPTIONS',
          headers: { origin: 'http://127.0.0.1:4401', 'access-control-request-method': 'POST' },
        })
      );
      expect(r.status).toBe(405);
      for (const h of CORS) expect(r.headers.get(h)).toBeNull();
    }
  });

  test('no answer ever carries a CORS header', async () => {
    for (const s of SAMPLES) {
      const r = await fetchHome(
        homeReq(s.path, { method: s.method, ...(s.method === 'POST' ? { body: '{}' } : {}) })
      );
      for (const h of CORS) expect(r.headers.get(h)).toBeNull();
    }
  });

  test('a JSON body over 64 KB is refused', async () => {
    const big = JSON.stringify({ q: 'x'.repeat(70 * 1024) });
    const r = await fetchHome(homeReq('/_home/recent-searches', { method: 'POST', body: big }));
    expect(r.status).toBe(413);
    // and a body that lies about its length is counted, not believed
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode(big));
        c.close();
      },
    });
    const r2 = await fetchHome(
      homeReq('/_home/recent-searches', {
        method: 'POST',
        body: stream,
        headers: { 'content-length': '10' },
      })
    );
    expect(r2.status).toBe(413);
  });
});

// V2-3.6 H1 — `x-maude-home: 1` was the whole gate on a page route, and any local process can send
// a header (the agent's auto-allowed `maude design curl-local` sends no Fetch Metadata and no
// Origin, exactly the shape the old guard let through). The page route now needs the per-spawn
// Home PAGE secret, which only the Home window can obtain (`home_session()`, Rust-gated).
describe('the Home page secret (V2-3.6 H1)', () => {
  /** What a local process sends: no Sec-Fetch-Site, no Origin, a chosen `x-maude-home`. */
  const local = (s: { method: string; path: string }, home?: string) =>
    new Request(`http://${HOST}${s.path}`, {
      method: s.method,
      headers: { host: HOST, ...(home === undefined ? {} : { 'x-maude-home': home }) },
      ...(s.method === 'POST' ? { body: '{}' } : {}),
    });

  test('no secret, `1`, or a wrong secret → 403 on every page route', async () => {
    for (const s of PAGE)
      for (const home of [undefined, '1', 'cd'.repeat(32), `${PAGE_SECRET}x`, ''])
        expect([s.path, home, (await fetchHome(local(s, home))).status]).toEqual([
          s.path,
          home,
          403,
        ]);
  });

  test('the internal bearer used as the page secret → 403', async () => {
    for (const s of PAGE)
      expect([s.path, (await fetchHome(local(s, TOKEN))).status]).toEqual([s.path, 403]);
  });

  test('the correct secret → 200', async () => {
    for (const path of ['/_health', '/_config', '/_home/recent-searches', '/_home/index?pids='])
      expect([path, (await fetchHome(local({ method: 'GET', path }, PAGE_SECRET))).status]).toEqual(
        [path, 200]
      );
  });

  test('a page secret equal to the internal bearer is never accepted (fail closed)', async () => {
    const f = homeFetch({ pageSecret: TOKEN });
    expect((await f(local({ method: 'GET', path: '/_config' }, TOKEN))).status).toBe(403);
  });

  test('with no page secret configured, no page route answers', async () => {
    const f = homeFetch({ pageSecret: null });
    for (const home of ['1', PAGE_SECRET, ''])
      expect((await f(local({ method: 'GET', path: '/_config' }, home))).status).toBe(403);
  });
});

describe('internal routes (§5.8 item 2)', () => {
  test('Rust with the token gets in', async () => {
    for (const s of INTERNAL) {
      const r = await fetchHome(
        s.method === 'POST'
          ? new Request(`http://${HOST}${s.path}`, {
              method: 'POST',
              headers: rustReq(s.path).headers,
              body: JSON.stringify({ profile: 'default', invite: null }),
            })
          : rustReq(`${s.path}?q=x&pids=&pid=l0000000000000000`)
      );
      // S6.10: the clone row got in and then refused this body (no owner/repo/folder) — its own
      // validation, past the guard (home-github-clone.test.ts drives it with a real body)
      // p8-port-gc: the index-gc row refuses a body without a pid list — it never reads "no pids" as "none registered"
      const want =
        s.path === '/_home/internal/github/clone' || s.path === '/_home/internal/index-gc'
          ? 400
          : 200;
      expect([s.path, r.status]).toEqual([s.path, want]);
    }
  });

  test('a request carrying Origin or Sec-Fetch-Site is refused even with the token', async () => {
    for (const s of INTERNAL) {
      for (const h of [
        { origin: `http://${HOST}` },
        { 'sec-fetch-site': 'same-origin' },
        { 'sec-fetch-site': 'none' },
      ])
        expect((await fetchHome(rustReq(`${s.path}?pid=l0000000000000000`, h))).status).toBe(403);
    }
  });

  test('a wrong, missing or malformed bearer is refused', async () => {
    for (const auth of [
      `Bearer ${'cd'.repeat(32)}`,
      `Bearer ${TOKEN}x`,
      `bearer ${TOKEN}`,
      TOKEN,
      '',
    ])
      expect(
        (await fetchHome(rustReq('/_home/internal/search?q=x', { authorization: auth }))).status
      ).toBe(403);
  });

  test('with no MAUDE_HOME_TOKEN configured, nothing gets in', async () => {
    const f = homeFetch({ token: null });
    expect((await f(rustReq('/_home/internal/search?q=x'))).status).toBe(403);
  });
});
