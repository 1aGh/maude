// S10.18b (V2-1.6 §5.12, §5.14): a linked library is VIEW ONLY here. The studio refuses publish, pending, Keep
// and pick for it (409 `ds-library`), an outside edit to its working files offers only Undo, and every
// `/_api/ds/library` action needs Can edit on the whole project (403 otherwise — hidden ≠ refused).
import { afterAll, describe, expect, test } from 'bun:test';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { createDsRoutes } from '../routes/ds.ts';
import type { RouteSpec } from '../routes/table.ts';
import { cleanup } from './_ds-engine-fixture.ts';
import {
  GRANT,
  gatorCss,
  LIB,
  type Linking,
  linked,
  linkingProject,
  URL_,
  V1,
} from './_ds-library-hub.ts';

afterAll(cleanup);

const claims: Record<string, AccessClaim> = {
  view: { v: 1, role: 'observer' },
  edit: { v: 1, role: 'member' },
  owner: { v: 1, role: 'owner' },
  canvasEditor: {
    v: 1,
    role: null,
    grants: [{ c: `system/${LIB}/design-system.tsx`, r: 'member' }],
  },
};

function routes(L: Linking, who: keyof typeof claims): RouteSpec[] {
  return createDsRoutes({
    engine: () => L.p.engine,
    access: () => resolveAccess(claims[who]),
    person: async () => ({ name: 'Michal' }),
    library: () => L.lib,
  });
}

async function post(specs: RouteSpec[], route: string, body: Record<string, unknown>) {
  const spec = specs.find((s) => s.method === 'POST' && s.path === route);
  if (!spec) throw new Error(`no POST ${route}`);
  const res = await spec.handle(
    new Request(`http://localhost${route}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    {}
  );
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

describe('ds library: view only', () => {
  test('publish, pending, Keep and pick refuse a linked system (409 ds-library)', async () => {
    const L = await linked();
    const owner = routes(L, 'owner');
    const tries: [string, Record<string, unknown>][] = [
      ['/_api/ds/publish', { ds: LIB, expectHead: V1.id }],
      [
        '/_api/ds/pending',
        { ds: LIB, tokens: { '--accent': { light: '#ff0000', dark: '#ff8888' } } },
      ],
      ['/_api/ds/outside', { ds: LIB, action: 'keep' }],
      ['/_api/ds/pick', { ds: LIB, css: '--accent', use: 'file' }],
    ];
    L.p.write(`system/${LIB}/colors_and_type.css`, gatorCss('#ff0000', '#ff8888'));
    for (const [route, body] of tries) {
      const r = await post(owner, route, body);
      expect([route, r.status, r.json.code]).toEqual([route, 409, 'ds-library']);
    }
    // nothing waits on the linked system's canvas
    expect(L.p.meta(`system/${LIB}/design-system.tsx`).dsPending).toBeUndefined();
  });

  test('an outside edit offers only Undo: the library’s values come back', async () => {
    const L = await linked();
    L.p.write(`system/${LIB}/colors_and_type.css`, gatorCss('#ff0000', '#ff8888'));
    const r = await post(routes(L, 'edit'), '/_api/ds/outside', { ds: LIB, action: 'undo' });
    expect(r.status).toBe(200);
    expect(L.p.read(`system/${LIB}/colors_and_type.css`)).toBe(gatorCss('#0a7d3b', '#3fbf6f'));
  });

  test('every library action needs Can edit on the whole project', async () => {
    const L = await linkingProject();
    for (const who of ['view', 'canvasEditor'] as const)
      for (const body of [
        { action: 'link', url: URL_, grant: GRANT },
        { action: 'check', ds: LIB },
        { action: 'update', ds: LIB, dryRun: true },
        { action: 'unlink', ds: LIB },
      ]) {
        const r = await post(routes(L, who), '/_api/ds/library', body);
        expect([who, body.action, r.status, r.json.code]).toEqual([
          who,
          body.action,
          403,
          'forbidden',
        ]);
      }
    expect(L.hub.calls).toEqual([]); // a refused session reaches no hub
    const ok = await post(routes(L, 'edit'), '/_api/ds/library', {
      action: 'link',
      url: URL_,
      grant: GRANT,
    });
    expect(ok.status).toBe(200);
    expect(ok.json).toMatchObject({
      format: 'maude.ds-library',
      v: 1,
      action: 'link',
      system: LIB,
    });
    expect((ok.json.library as Record<string, unknown>).upstreamHead).toBe(V1.id);
    expect(JSON.stringify(ok.json)).not.toContain(GRANT);
  });
});
