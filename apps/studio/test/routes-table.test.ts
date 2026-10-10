// The lane route-table shape (routes/table.ts) — what the lead mounts into
// http.ts until V2-2.5's shared table lands: exact paths for the `routes`
// map, `:param` paths for the fall-through, 405 on a wrong method, and the
// read-only allowlist the specs declare.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { READ_ONLY_ALLOWED_WRITE_PATTERNS, READ_ONLY_ALLOWED_WRITES } from '../http.ts';
import { allSpecs } from '../routes/index.ts';
import { checkRouteTable, matchRoute, mountRoutes, type RouteSpec } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const echo = (tag: string) => (_req: Request, params: Record<string, string>) =>
  Response.json({ tag, params });
const SPECS: RouteSpec[] = [
  { method: 'GET', path: '/_api/x', origin: 'main', readOnly: 'allowed', handle: echo('list') },
  { method: 'POST', path: '/_api/x', origin: 'main', readOnly: 'refused', handle: echo('make') },
  { method: 'GET', path: '/_api/x/:id', origin: 'main', readOnly: 'allowed', handle: echo('one') },
  {
    method: 'POST',
    path: '/_api/x/:id/cancel',
    origin: 'main',
    readOnly: 'allowed',
    handle: echo('cancel'),
  },
];

const req = (method: string, p: string) => new Request(`http://localhost${p}`, { method });

describe('route tables', () => {
  test('exact paths dispatch by method, 405 otherwise', async () => {
    const m = mountRoutes(SPECS);
    expect(Object.keys(m.exact)).toEqual(['/_api/x']);
    expect(
      await (
        await (m.exact['/_api/x'] as (r: Request) => Promise<Response>)(req('POST', '/_api/x'))
      ).json()
    ).toMatchObject({ tag: 'make' });
    expect(
      (await (m.exact['/_api/x'] as (r: Request) => Promise<Response>)(req('DELETE', '/_api/x')))
        .status
    ).toBe(405);
  });

  test('param paths go through the fall-through; unknown paths are not ours', async () => {
    const m = mountRoutes(SPECS);
    expect(
      await (await (m.dynamic(req('GET', '/_api/x/i_1')) as Promise<Response>)).json()
    ).toEqual({
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

// ---------------------------------------------------------------------------
// V2-2.5 — the ONE table. http.ts mounts `allSpecs` (routes/index.ts) beside
// its legacy `routes` literal; `checkRouteTable` is what makes the merge
// provable. http.ts runs the same check at construction and refuses to boot
// on a problem (like assertContainment), so these tests and the server never
// disagree about what is wrong.

/** The legacy `routes` literal's keys, read out of source (the same 4-space shape the hub's
 *  manifest test scrapes), bounded to the literal so another object's keys never count. */
function legacyRouteKeys(): string[] {
  const src = readFileSync(join(import.meta.dir, '..', 'http.ts'), 'utf8');
  const start = src.indexOf('  const legacyRoutes = {');
  const end = src.indexOf('} satisfies Record<string, (req: Request) =>', start);
  if (start === -1 || end === -1) return [];
  return [...src.slice(start, end).matchAll(/^ {4}'(\/[^']*)':/gm)].map((m) => m[1] as string);
}

const REAL = () => ({
  specs: allSpecs(stubDeps()),
  legacyKeys: legacyRouteKeys(),
  readOnlyAllowedWrites: READ_ONLY_ALLOWED_WRITES as ReadonlySet<string>,
  readOnlyAllowedPatterns: READ_ONLY_ALLOWED_WRITE_PATTERNS,
});
const plant = (over: Partial<RouteSpec> & Pick<RouteSpec, 'path'>): RouteSpec => ({
  method: 'POST',
  origin: 'main',
  readOnly: 'refused',
  handle: echo('plant'),
  ...over,
});

describe('the one route table (V2-2.5)', () => {
  test('the legacy scrape sees the routes literal', () => {
    const keys = legacyRouteKeys();
    expect(keys.length).toBeGreaterThan(80);
    expect(keys).toContain('/_health');
    expect(keys).toContain('/_config');
  });

  test('the real table is clean: no duplicate, no shadow, readOnly agrees, nothing lost', () => {
    const t = REAL();
    expect(checkRouteTable(t)).toEqual([]);
    // Nothing lost: the merged map holds every table exact path AND every legacy key.
    const exact = Object.keys(mountRoutes(t.specs).exact);
    const merged = new Set([...exact, ...t.legacyKeys]);
    expect(merged.size).toBe(exact.length + new Set(t.legacyKeys).size);
    for (const p of ['/_api/outbox', '/_api/project/format', '/_api/project/migrate'])
      expect(exact).toContain(p);
  });

  test('a duplicate path+method in the table is caught', () => {
    const t = REAL();
    const twice = plant({ path: '/_api/planted' });
    expect(checkRouteTable({ ...t, specs: [...t.specs, twice, { ...twice }] })).toEqual([
      'POST /_api/planted: declared twice in the table',
    ]);
  });

  test('a table path that is also a legacy key is caught (the spread would drop one)', () => {
    const t = REAL();
    expect(checkRouteTable({ ...t, specs: [...t.specs, plant({ path: '/_api/index' })] })).toEqual([
      '/_api/index: in the table AND the legacy routes literal (the merge keeps only one)',
    ]);
  });

  test('readOnly that disagrees with the read-only allowlists is caught', () => {
    const t = REAL();
    const listed = new Set([...READ_ONLY_ALLOWED_WRITES, '/_api/plant-listed']);
    const planted = [
      plant({ path: '/_api/plant-listed', readOnly: 'refused' }),
      plant({ path: '/_api/plant-listed-too', readOnly: 'allowed' }),
      plant({ path: '/_api/plant-read', method: 'GET', readOnly: 'refused' }),
    ];
    const listedToo = new Set([...listed, '/_api/plant-listed-too']);
    expect(
      checkRouteTable({ ...t, readOnlyAllowedWrites: listedToo, specs: [...t.specs, ...planted] })
    ).toEqual([
      "POST /_api/plant-listed: readOnly 'refused' but READ_ONLY_ALLOWED_WRITES allows it",
      "POST /_api/plant-listed-too: readOnly 'allowed' is declared twice (spec + READ_ONLY_ALLOWED_WRITES) — keep the spec",
      "GET /_api/plant-read: a read is never refused — declare readOnly 'allowed'",
    ]);
  });

  test('a :param spec never shadows an exact route or a path the fall-through owns', () => {
    const t = REAL();
    const planted = [
      plant({ path: '/_api/:any' }),
      plant({ path: '/_api/thumb/:key', method: 'GET', readOnly: 'allowed' }),
      plant({ path: '/_api/comments/:id/reply', readOnly: 'allowed' }),
      plant({ path: '/:page' }),
    ];
    const problems = checkRouteTable({ ...t, specs: [...t.specs, ...planted] });
    expect(problems).toContain('POST /_api/:any: a :param route lives under /_api/<literal>/');
    expect(problems).toContain('POST /:page: a :param route lives under /_api/<literal>/');
    expect(problems).toContain(
      'GET /_api/thumb/:key: matches /_api/thumb/key1, which the fall-through owns'
    );
    expect(problems).toContain(
      'POST /_api/comments/:id/reply: matches /_api/comments/id1/reply, which the fall-through owns'
    );
    // …and an exact route it would answer — e.g. a param under an exact legacy path's parent.
    const shadow = plant({ path: '/_api/diagnostics/:part' }); // `/_api/diagnostics/report` is exact
    expect(checkRouteTable({ ...t, specs: [...t.specs, shadow] })).toEqual([
      'POST /_api/diagnostics/:part: matches the exact route /_api/diagnostics/report',
    ]);
  });
});
