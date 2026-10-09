// The lane route-table shape (routes/table.ts) — what the lead mounts into
// http.ts until V2-2.5's shared table lands: exact paths for the `routes`
// map, `:param` paths for the fall-through, 405 on a wrong method, and the
// read-only allowlist the specs declare.

import { describe, expect, test } from 'bun:test';

import { matchRoute, mountRoutes, type RouteSpec } from '../routes/table.ts';

const echo = (tag: string) => (_req: Request, params: Record<string, string>) =>
  Response.json({ tag, params });
const SPECS: RouteSpec[] = [
  { method: 'GET', path: '/_api/x', origin: 'main', readOnly: 'allowed', handle: echo('list') },
  { method: 'POST', path: '/_api/x', origin: 'main', readOnly: 'refused', handle: echo('make') },
  { method: 'GET', path: '/_api/x/:id', origin: 'main', readOnly: 'allowed', handle: echo('one') },
  { method: 'POST', path: '/_api/x/:id/cancel', origin: 'main', readOnly: 'allowed', handle: echo('cancel') },
];

const req = (method: string, p: string) => new Request(`http://localhost${p}`, { method });

describe('route tables', () => {
  test('exact paths dispatch by method, 405 otherwise', async () => {
    const m = mountRoutes(SPECS);
    expect(Object.keys(m.exact)).toEqual(['/_api/x']);
    expect(await (await (m.exact['/_api/x'] as (r: Request) => Promise<Response>)(req('POST', '/_api/x'))).json()).toMatchObject({ tag: 'make' });
    expect((await (m.exact['/_api/x'] as (r: Request) => Promise<Response>)(req('DELETE', '/_api/x'))).status).toBe(405);
  });

  test('param paths go through the fall-through; unknown paths are not ours', async () => {
    const m = mountRoutes(SPECS);
    expect(await (await (m.dynamic(req('GET', '/_api/x/i_1')) as Promise<Response>)).json()).toEqual({
      tag: 'one',
      params: { id: 'i_1' },
    });
    expect((await (m.dynamic(req('PUT', '/_api/x/i_1')) as Promise<Response>)).status).toBe(405);
    expect(m.dynamic(req('GET', '/_api/y/1'))).toBe(null);
    expect(matchRoute(SPECS, 'GET', '/_api/x/%E0%A4%A')).toBe(null); // a malformed escape
  });

  test('the read-only allowlist is what the specs declare', () => {
    const { readOnlyAllowed } = mountRoutes(SPECS);
    expect(readOnlyAllowed.exact).toEqual([]);
    expect(readOnlyAllowed.patterns.map((r) => r.test('/_api/x/i_1/cancel'))).toEqual([true]);
    expect(readOnlyAllowed.patterns.some((r) => r.test('/_api/x/i_1/retry'))).toBe(false);
  });
});
