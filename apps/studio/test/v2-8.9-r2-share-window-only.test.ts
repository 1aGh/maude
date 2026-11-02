// V2-8.9 round 2 R2-M2 — the desktop's /_api/share/* writes run with THIS Mac's hub credential
// (invite someone, make an anyone-link, approve a request). They are the person's act in the Maude
// window, like Connect (routes/sync.ts link confirm): every non-GET share route answers 403
// `window-only` unless the request is the browser's own same-origin fetch (`Sec-Fetch-Site`), before
// the hub hears anything. A loopback helper (`curl-local --method POST …/_api/share/invites`) is also
// refused by the AI session's bash guard (cli/lib/bash-guard.mjs HUMAN_ONLY_ROUTES).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { resolveAccess } from '../access/scope.ts';
import { createShareRoutes } from '../routes/share.ts';
import { matchRoute, type RouteSpec } from '../routes/table.ts';

const hits: string[] = [];
let server: ReturnType<typeof Bun.serve> | null = null;
let hubUrl = '';
beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      hits.push(`${req.method} ${new URL(req.url).pathname}`);
      return Response.json({ ok: true });
    },
  });
  hubUrl = `http://127.0.0.1:${server.port}`;
});
afterAll(() => server?.stop(true));

const table = (): RouteSpec[] =>
  createShareRoutes({
    hub: () => ({ url: hubUrl, token: 'mh_t' }),
    access: () => resolveAccess({ v: 1, role: 'owner' }),
  });

async function call(method: string, path: string, headers: Record<string, string> = {}) {
  const url = `http://127.0.0.1:4399${path}`;
  const m = matchRoute(table(), method, new URL(url).pathname);
  if (!m) throw new Error(`no route ${method} ${path}`);
  const res = await m.spec.handle(
    new Request(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(method === 'GET'
        ? {}
        : { body: JSON.stringify({ email: 'x@evil.test', role: 'member' }) }),
    }),
    m.params
  );
  return { status: res.status, body: (await res.json().catch(() => null)) as { reason?: string } };
}

const WRITES: Array<[string, string]> = [
  ['POST', '/_api/share/invites'],
  ['POST', '/_api/share/invites/i1/resend'],
  ['POST', '/_api/share/invites/i1/revoke'],
  ['PATCH', '/_api/share/people/p1'],
  ['POST', '/_api/share/people/p1/remove'],
  ['POST', '/_api/share/links'],
  ['PATCH', '/_api/share/links/l1'],
  ['POST', '/_api/share/requests'],
  ['POST', '/_api/share/requests/r1/approve'],
];

describe('desktop share writes are window-only', () => {
  for (const [method, path] of WRITES) {
    test(`${method} ${path} without Sec-Fetch-Site → 403 window-only, the hub hears nothing`, async () => {
      hits.length = 0;
      for (const h of [{}, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' }]) {
        const r = await call(method, path, h);
        expect(r.status).toBe(403);
        expect(r.body?.reason).toBe('window-only');
      }
      expect(hits).toEqual([]);
    });
  }
  test('the window’s own same-origin fetch still reaches the hub', async () => {
    hits.length = 0;
    const r = await call('POST', '/_api/share/invites', { 'sec-fetch-site': 'same-origin' });
    expect(r.status).toBe(200);
    expect(hits).toEqual(['POST /api/access/invites']);
  });
  test('reads stay open to the loopback helper', async () => {
    hits.length = 0;
    expect((await call('GET', '/_api/share/me')).status).toBe(200);
  });
});
