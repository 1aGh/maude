// #167 T5.3 item 2 — Sync details › a file the hub holds back › "Adopt as code".
//
// The studio half: `POST /_api/sync/adopt-held { path }` carries the owner's answer to the hub's
// `POST /api/journal/adopt` (apps/hub journal.mjs — its own owner gate decides, and it journals the
// bytes on its own disk). Window-only, Can edit, never canvas-safe; the hub's 403 reads as
// "only the owner", and a 200 starts a pass so the file arrives at once.

import { describe, expect, test } from 'bun:test';

import { legacyClaim, resolveAccess } from '../access/scope.ts';
import { guardTableRoute } from '../http.ts';
import { createSyncRoutes } from '../routes/sync.ts';
import type { RouteSpec } from '../routes/table.ts';
import { ADOPT_NOT_HELD, ADOPT_NOT_OWNER, createAdoptHeld } from '../sync/adopt-held.ts';

const HUB = 'https://hub.test';
const ROUTE = '/_api/sync/adopt-held';
const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

function hub(status: number) {
  const calls: { url: string; body: unknown; auth: string | null }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init.body)),
      auth: new Headers(init.headers).get('authorization'),
    });
    return new Response(JSON.stringify({}), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function harness(status: number, o: { role?: string; runtime?: boolean } = {}) {
  const h = hub(status);
  let passes = 0;
  const control = createAdoptHeld({
    hubUrl: `${HUB}/`,
    token: () => 'owner-tok',
    fetchImpl: h.fetchImpl,
    runPass: () => {
      passes += 1;
    },
  });
  const specs = createSyncRoutes({
    control: () => ({
      restart: async () => ({ syncing: false }),
      current: () => (o.runtime === false ? null : { adoptHeld: () => control }),
    }),
    trace: { begin() {}, view: () => null } as never,
    warn: () => {},
    access: () => resolveAccess(legacyClaim(o.role ?? 'owner')),
  }).map(guardTableRoute);
  const spec = specs.find((x) => x.method === 'POST' && x.path === ROUTE) as RouteSpec;
  const post = (body: unknown, headers: Record<string, string> = FROM_WINDOW) =>
    spec.handle(
      new Request(`http://127.0.0.1:4399${ROUTE}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
  return { ...h, post, passes: () => passes, spec };
}

describe('POST /_api/sync/adopt-held', () => {
  test('is a main-origin route, refused read-only', () => {
    const { spec } = harness(200);
    expect(spec).toBeDefined();
    expect(spec.origin).toBe('main');
    expect(spec.readOnly).toBe('refused');
  });

  test('the owner’s answer reaches the hub’s adopt door with the path and starts a pass', async () => {
    const h = harness(200);
    const r = await h.post({ path: 'brand/x.tsx' });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(h.calls).toEqual([
      { url: `${HUB}/api/journal/adopt`, body: { path: 'brand/x.tsx' }, auth: 'Bearer owner-tok' },
    ]);
    expect(h.passes()).toBe(1);
  });

  test('the hub’s 403 is "only the owner", its 404 is "not held"; neither starts a pass', async () => {
    const no = harness(403);
    const r = await no.post({ path: 'brand/x.tsx' });
    expect(r.status).toBe(403);
    expect((await r.json()).detail).toBe(ADOPT_NOT_OWNER);
    const gone = harness(404);
    const g = await gone.post({ path: 'brand/x.tsx' });
    expect(g.status).toBe(409);
    expect((await g.json()).detail).toBe(ADOPT_NOT_HELD);
    expect(no.passes() + gone.passes()).toBe(0);
  });

  test('not from the window, read-only, or a bad path: refused before the hub is asked', async () => {
    const h = harness(200);
    expect((await h.post({ path: 'brand/x.tsx' }, { 'sec-fetch-site': 'cross-site' })).status).toBe(
      403
    );
    expect((await h.post({ path: '../etc/passwd' })).status).toBe(400);
    expect((await h.post({})).status).toBe(400);
    const viewer = harness(200, { role: 'viewer' });
    expect((await viewer.post({ path: 'brand/x.tsx' })).status).toBe(403);
    expect(h.calls.length + viewer.calls.length).toBe(0);
  });

  test('no linked hub: 409 not-linked', async () => {
    const r = await harness(200, { runtime: false }).post({ path: 'brand/x.tsx' });
    expect(r.status).toBe(409);
    expect((await r.json()).reason).toBe('not-linked');
  });
});
