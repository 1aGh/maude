// S10.3 (S10 Q15, V2-1.6 §5.12, rule 12): the design-system routes judge every session on the
// server. Can view gets 403 on every write; the whole-project writes refuse a canvas-scoped edit
// grant; clearing a token out of the trash is the owner's; a canvas-only session that can't see a
// system (or a canvas) is answered byte for byte like one that does not exist.
import { afterAll, describe, expect, test } from 'bun:test';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import { createDsRoutes } from '../routes/ds.ts';
import type { RouteSpec } from '../routes/table.ts';
import { ACCENT, cleanup, DS, DS_PATH, makeProject, type Project } from './_ds-engine-fixture.ts';

afterAll(cleanup);

const DS_CANVAS = `${DS_PATH}/design-system.tsx`;
const claims: Record<string, AccessClaim> = {
  view: { v: 1, role: 'observer' },
  comment: { v: 1, role: 'viewer' },
  edit: { v: 1, role: 'member' },
  owner: { v: 1, role: 'owner' },
  // a canvas-scoped edit grant on the DS canvas (and nothing else)
  dsCanvasEditor: { v: 1, role: null, grants: [{ c: DS_CANVAS, r: 'member' }] },
  // a canvas-scoped editor of one canvas, who can't see the system
  homeOnly: { v: 1, role: null, grants: [{ c: 'ui/Home.tsx', r: 'member' }] },
};

function routes(p: Project, who: keyof typeof claims): RouteSpec[] {
  return createDsRoutes({
    engine: () => p.engine,
    access: () => resolveAccess(claims[who]),
    person: async () => ({ name: 'Michal' }),
  });
}

async function call(
  specs: RouteSpec[],
  method: 'GET' | 'POST',
  route: string,
  body?: Record<string, unknown>
): Promise<{ status: number; text: string; json: Record<string, unknown> }> {
  const [pathname, query] = route.split('?');
  const spec = specs.find((s) => s.method === method && s.path === pathname);
  if (!spec) throw new Error(`no ${method} ${pathname}`);
  const url = `http://localhost${pathname}${query ? `?${query}` : ''}`;
  const req =
    method === 'GET'
      ? new Request(url)
      : new Request(url, {
          method,
          body: JSON.stringify(body ?? {}),
          headers: { 'content-type': 'application/json' },
        });
  const res = await spec.handle(req, {});
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text);
  } catch {
    /* raw */
  }
  return { status: res.status, text, json };
}

/** Every write route with a body that names the converted system. */
const WRITES: Array<[string, Record<string, unknown>]> = [
  ['/_api/ds/publish', { ds: DS, expectHead: null }],
  ['/_api/ds/pending', { ds: DS, tokens: ACCENT('oklch(0.5 0.19 255)', 'oklch(0.6 0.175 255)') }],
  ['/_api/ds/outside', { ds: DS, action: 'keep' }],
  ['/_api/ds/pick', { ds: DS, css: '--accent', use: 'file' }],
  ['/_api/ds/canvas', { canvas: 'ui/Home.tsx', action: 'leave' }],
  ['/_api/ds/trash', { ds: DS, css: '--accent', replacement: '--fg-0' }],
  ['/_api/ds/restore', { ds: DS, css: '--accent' }],
  ['/_api/ds/clear', { ds: DS, css: '--accent' }],
  ['/_api/ds/make', { ds: 'forge', action: 'make', label: 'Forge' }],
  // S10.13 — the project's default system (config.json)
  ['/_api/ds/default', { ds: DS }],
  // S10.14 — move canvases to another system (Can edit on the whole project)
  ['/_api/ds/switch', { to: DS, all: true }],
  // S10.12 — convert system folders (the dry run is refused too: it lists every system)
  ['/_api/ds/convert', { systems: [DS], dryRun: true }],
  // S10.17 — Lighten to 4.5:1 / Add it to the system (waiting edits: Can edit on the DS canvas)
  ['/_api/ds/fix-contrast', { ds: DS, css: '--fg-0' }],
  ['/_api/ds/add-colour', { ds: DS, value: '#3b6fe0', label: 'Badge blue' }],
  // S10.15a — Bring it up to the schema (even the read-only analyse lists every canvas)
  ['/_api/ds/upgrade', { ds: DS, step: 'analyse' }],
];

describe('ds routes — roles (Q15)', () => {
  test('main origin only, never canvas-safe; every §5.12 + S10.3 route is declared once', async () => {
    const p = await makeProject();
    const specs = routes(p, 'owner');
    expect(specs.every((s) => s.origin === 'main')).toBe(true);
    expect(specs.map((s) => `${s.method} ${s.path}`).sort()).toEqual(
      [
        'GET /_api/ds/board',
        'GET /_api/ds/make-state',
        'GET /_api/ds/nearest',
        'GET /_api/ds/off-system',
        'GET /_api/ds/revision',
        'GET /_api/ds/revisions',
        'GET /_api/ds/state',
        'GET /_api/ds/usage',
        ...WRITES.map(([r]) => `POST ${r}`),
      ].sort()
    );
  });

  test('Can view and Can comment get 403 on every write; the reads answer', async () => {
    const p = await makeProject();
    for (const who of ['view', 'comment'] as const) {
      const specs = routes(p, who);
      for (const [route, body] of WRITES) {
        const r = await call(specs, 'POST', route, body);
        expect({ who, route, status: r.status, code: r.json.code }).toEqual({
          who,
          route,
          status: 403,
          code: 'forbidden',
        });
      }
      const st = await call(specs, 'GET', `/_api/ds/state?ds=${DS}`);
      expect(st.status).toBe(200);
      expect((st.json.systems as { name: string }[]).map((s) => s.name)).toEqual([DS]);
    }
    // nothing moved
    expect(p.head().head).toBe(p.R0);
    expect(p.meta(DS_CANVAS).dsPending).toBeUndefined();
  });

  test('Can edit passes the role gate on every write but clear; the owner clears', async () => {
    const p = await makeProject();
    const member = routes(p, 'edit');
    for (const [route, body] of WRITES) {
      const r = await call(member, 'POST', route, body);
      if (route === '/_api/ds/clear') expect(r.status).toBe(403);
      else expect({ route, forbidden: r.status === 403 }).toEqual({ route, forbidden: false });
    }
    // the owner is past the gate: the engine answers (nothing in the trash)
    const owner = await call(routes(p, 'owner'), 'POST', '/_api/ds/clear', {
      ds: DS,
      css: '--accent',
    });
    expect(owner.status).not.toBe(403);
    expect(String(owner.json.code)).toMatch(/^ds-/);
  });

  test('a canvas-scoped edit grant on the DS canvas may propose, never publish', async () => {
    const p = await makeProject();
    const specs = routes(p, 'dsCanvasEditor');
    const pend = await call(specs, 'POST', '/_api/ds/pending', WRITES[1][1]);
    expect(pend.status).toBe(200);
    expect(pend.json).toMatchObject({ format: 'maude.ds-result', v: 1 });
    // S10.17: "Add it to the system" is a waiting edit too
    const add = await call(specs, 'POST', '/_api/ds/add-colour', {
      ds: DS,
      value: '#3b6fe0',
      label: 'Badge blue',
    });
    expect(add.status).toBe(200);
    expect(add.json).toMatchObject({ format: 'maude.ds-edge', edge: 'add-colour' });
    for (const route of [
      '/_api/ds/publish',
      '/_api/ds/outside',
      '/_api/ds/pick',
      '/_api/ds/trash',
      '/_api/ds/convert',
    ]) {
      const body = WRITES.find(([r]) => r === route)?.[1];
      const r = await call(specs, 'POST', route, body);
      expect({ route, status: r.status }).toEqual({ route, status: 403 });
    }
    expect(p.head().head).toBe(p.R0);
  });

  test('canvas-only, system unseen: every answer equals the answer for a missing system', async () => {
    const p = await makeProject();
    const specs = routes(p, 'homeOnly');
    const list = await call(specs, 'GET', '/_api/ds/state');
    expect(list.json.systems).toEqual([]);
    for (const route of ['/_api/ds/state', '/_api/ds/revisions', '/_api/ds/usage']) {
      const seen = await call(specs, 'GET', `${route}?ds=${DS}`);
      const missing = await call(specs, 'GET', `${route}?ds=${DS}`.replace(DS, 'nope'));
      expect({ route, status: seen.status }).toEqual({ route, status: 404 });
      expect(seen.text.replace(DS, 'X')).toBe(missing.text.replace('nope', 'X'));
    }
    const rev = await call(specs, 'GET', `/_api/ds/revision?ds=${DS}&rev=${p.R0}`);
    const revMissing = await call(specs, 'GET', `/_api/ds/revision?ds=nope&rev=${p.R0}`);
    expect(rev.status).toBe(404);
    expect(rev.text.replace(DS, 'X')).toBe(revMissing.text.replace('nope', 'X'));
    for (const [route, body] of WRITES.filter(([r]) => r !== '/_api/ds/canvas')) {
      const seen = await call(specs, 'POST', route, body);
      const missing = await call(specs, 'POST', route, {
        ...body,
        ds: 'nope',
        ...('to' in body ? { to: 'nope' } : {}), // /_api/ds/switch names its system `to`
      });
      expect({ route, status: seen.status }).toEqual({ route, status: missing.status });
      expect(seen.text.replace(DS, 'X')).toBe(missing.text.replace('nope', 'X'));
    }
    // a canvas outside the grants answers like a canvas that does not exist
    const other = await call(specs, 'POST', '/_api/ds/canvas', {
      canvas: 'ui/Landing.tsx',
      action: 'leave',
    });
    const none = await call(specs, 'POST', '/_api/ds/canvas', {
      canvas: 'ui/Nope.tsx',
      action: 'leave',
    });
    expect(other.status).toBe(none.status);
    expect(other.text).toBe(none.text);
  });

  test('the local gate judges `pending` and `canvas` on the route’s own target, never a body key', async () => {
    const p = await makeProject();
    const specs = routes(p, 'owner');
    const target = async (route: string, body: Record<string, unknown>) => {
      const spec = specs.find((s) => s.path === route);
      if (!spec?.target) throw new Error(`${route} has no target`);
      return spec.target(
        new Request(`http://localhost${route}`, {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        })
      );
    };
    expect(await target('/_api/ds/pending', { ds: DS })).toBe(DS_CANVAS);
    expect(await target('/_api/ds/canvas', { canvas: '.design/ui/Home.tsx' })).toBe('ui/Home.tsx');
    // a granted canvas named in the body cannot unlock a project-level write
    expect(await target('/_api/ds/publish', { ds: DS, canvas: 'ui/Home.tsx' })).toBeUndefined();
  });
});
