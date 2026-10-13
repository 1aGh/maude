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
    ])
      expect(paths.has(p)).toBe(true);
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

describe('internal routes (§5.8 item 2)', () => {
  test('Rust with the token gets in', async () => {
    for (const s of INTERNAL) {
      const r = await fetchHome(rustReq(`${s.path}?q=x&pids=&pid=l0000000000000000`));
      expect([s.path, r.status]).toEqual([s.path, 200]);
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
