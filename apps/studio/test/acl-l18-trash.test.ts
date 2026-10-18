// V2-1.16 L18 — the shared Trash (S1.7, routes/trash.ts), judged on the SERVER.
//
//   - an editor's clear-out → 403 `forbidden`, and the home is never asked (hidden ≠ refused);
//   - a canvas-only session sees only its granted canvases' items; B trashed by the owner never
//     appears for A-only; restore of B reads `not-in-scope` (U1), clear-out is `not-in-scope`;
//   - a Can view grant sees A's item but may not restore it (`trash` is an edit capability);
//   - a cell session with no vouched claim holds nothing; a desktop ignores a forged claim;
//   - cleared items stay gone (restore → 409 `cleared`);
//   - none of the three routes is canvas-safe.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { AccessClaim } from '../access/scope.ts';
import { type TrashListing, type TrashRuntime, trashAccess } from '../history/trash.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createTrashRoutes } from '../routes/trash.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const T = Date.now();
const LISTING: TrashListing = {
  canvases: [
    {
      id: 'canvas:n_a',
      entry: 'n_a',
      doc: 'ui-a',
      path: 'ui/a.tsx',
      rev: 5,
      actionId: 'a5',
      actor: 'owner@x',
      at: T,
    },
    {
      id: 'canvas:n_b',
      entry: 'n_b',
      doc: 'ui-b',
      path: 'ui/b.tsx',
      rev: 4,
      actionId: 'a4',
      actor: 'owner@x',
      at: T - 1,
    },
  ],
  artboards: [
    {
      id: 'artboard:a3/Hero',
      entry: 'n_c',
      doc: 'ui-c',
      artboard: 'Hero',
      label: 'Hero',
      rev: 3,
      actionId: 'a3',
      actor: 'owner@x',
      at: T - 2,
    },
  ],
  live: { n_c: { doc: 'ui-c', path: 'ui/c.tsx' } },
};

function fakeRuntime() {
  const calls: string[] = [];
  const runtime: TrashRuntime = {
    acceptedTrash: async () => structuredClone(LISTING),
    acceptedTrashRestore: async (entry) => {
      calls.push(`restore:${entry}`);
      return { status: 'accepted', actionId: 'a9', path: `ui/${entry.slice(2)}.tsx` };
    },
    acceptedTrashClear: async (items) => {
      calls.push(`clear:${items?.join(',') ?? '*'}`);
      return {
        status: 'accepted',
        cleared: items ?? ['canvas:n_a', 'canvas:n_b', 'artboard:a3/Hero'],
      };
    },
  };
  return { runtime, calls };
}

const claim = (c: AccessClaim) => Buffer.from(JSON.stringify(c)).toString('base64url');
const OWNER = claim({ v: 1, role: 'owner' });
const EDITOR = claim({ v: 1, role: 'member' });
const A_ONLY = claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] });
const A_VIEW = claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'observer' }] });

/** The route set as a cell serves it: the access is the vouched `x-maude-access`. */
function cellRoutes(runtime: TrashRuntime, emitted: unknown[] = []) {
  return createTrashRoutes({
    control: () => runtime,
    access: (req) =>
      trashAccess({ workspace: true, header: req.headers.get('x-maude-access'), localRole: null }),
    readSource: () => null,
    emit: (e, p) => emitted.push([e, p]),
  });
}

const spec = (specs: RouteSpec[], method: string, p: string) => {
  const s = specs.find((x) => x.method === method && x.path === p);
  if (!s) throw new Error(`no ${method} ${p}`);
  return s;
};
const call = async (
  specs: RouteSpec[],
  method: 'GET' | 'POST',
  p: string,
  access?: string,
  body?: unknown
) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (access) headers['x-maude-access'] = access;
  const res = await spec(specs, method, p).handle(
    new Request(`http://localhost${p}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    {}
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
};

describe('L18 — clear-out is the owner’s, on the server', () => {
  test('an editor’s clear-out → 403 forbidden, and the home is never asked', async () => {
    const { runtime, calls } = fakeRuntime();
    const specs = cellRoutes(runtime);
    const list = await call(specs, 'GET', '/_api/trash', EDITOR);
    expect(list.body.canClear).toBe(false);
    // hidden ≠ refused: the client drew no button, the server refuses the request anyway
    const r = await call(specs, 'POST', '/_api/trash/clear', EDITOR, {});
    expect(r).toMatchObject({ status: 403, body: { ok: false, reason: 'forbidden' } });
    const some = await call(specs, 'POST', '/_api/trash/clear', EDITOR, { items: ['canvas:n_a'] });
    expect(some.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test('the owner clears out; the bus hears trash:changed', async () => {
    const { runtime, calls } = fakeRuntime();
    const emitted: unknown[] = [];
    const specs = cellRoutes(runtime, emitted);
    expect((await call(specs, 'GET', '/_api/trash', OWNER)).body.canClear).toBe(true);
    const r = await call(specs, 'POST', '/_api/trash/clear', OWNER, { items: ['canvas:n_a'] });
    expect(r).toMatchObject({ status: 200, body: { ok: true, cleared: ['canvas:n_a'] } });
    expect(calls).toEqual(['clear:canvas:n_a']);
    expect(emitted).toEqual([['trash:changed', { seq: 1 }]]);
    const bad = await call(specs, 'POST', '/_api/trash/clear', OWNER, {
      items: ['canvas:n_a', 'canvas:n_a'],
    });
    expect(bad.status).toBe(400);
  });
});

describe('L18 — a canvas-only session sees only its canvases', () => {
  test('A-only sees A’s item, never B’s or C’s; restore of B is not-in-scope; clear-out is not-in-scope', async () => {
    const { runtime, calls } = fakeRuntime();
    const specs = cellRoutes(runtime);
    const list = await call(specs, 'GET', '/_api/trash', A_ONLY);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual(['canvas:n_a']);
    expect(list.body.canClear).toBe(false);
    for (const id of ['canvas:n_b', 'artboard:a3/Hero', 'canvas:n_unknown']) {
      const r = await call(specs, 'POST', '/_api/trash/restore', A_ONLY, { id });
      expect(r).toMatchObject({ status: 403, body: { reason: 'not-in-scope' } });
    }
    const clear = await call(specs, 'POST', '/_api/trash/clear', A_ONLY, {});
    expect(clear).toMatchObject({ status: 403, body: { reason: 'not-in-scope' } });
    expect(calls).toEqual([]);
    const mine = await call(specs, 'POST', '/_api/trash/restore', A_ONLY, { id: 'canvas:n_a' });
    expect(mine).toMatchObject({
      status: 200,
      body: { ok: true, path: 'ui/a.tsx', renamed: false },
    });
    expect(calls).toEqual(['restore:n_a']);
  });

  test('a Can view grant sees its trashed canvas but may not restore it', async () => {
    const { runtime, calls } = fakeRuntime();
    const specs = cellRoutes(runtime);
    const list = await call(specs, 'GET', '/_api/trash', A_VIEW);
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual(['canvas:n_a']);
    const r = await call(specs, 'POST', '/_api/trash/restore', A_VIEW, { id: 'canvas:n_a' });
    expect(r).toMatchObject({ status: 403, body: { reason: 'forbidden' } });
    expect(calls).toEqual([]);
  });

  test('a cell session with no vouched claim holds nothing', async () => {
    const { runtime, calls } = fakeRuntime();
    const specs = cellRoutes(runtime);
    expect((await call(specs, 'GET', '/_api/trash')).body.items).toEqual([]);
    expect((await call(specs, 'GET', '/_api/trash', 'not-base64-json')).body.items).toEqual([]);
    expect(
      (await call(specs, 'POST', '/_api/trash/restore', undefined, { id: 'canvas:n_a' })).status
    ).toBe(403);
    expect((await call(specs, 'POST', '/_api/trash/clear', undefined, {})).status).toBe(403);
    expect(calls).toEqual([]);
  });

  test('a desktop ignores a forged claim: the local user is the session', async () => {
    const { runtime } = fakeRuntime();
    const member = createTrashRoutes({
      control: () => runtime,
      access: (req) =>
        trashAccess({
          workspace: false,
          header: req.headers.get('x-maude-access'),
          localRole: 'member',
        }),
      readSource: () => null,
    });
    // a forged owner claim does not make a linked member an owner
    expect((await call(member, 'POST', '/_api/trash/clear', OWNER, {})).status).toBe(403);
    // nor does a forged canvas-only claim narrow what the person at the keyboard sees
    expect((await call(member, 'GET', '/_api/trash', A_ONLY)).body.items).toHaveLength(3);
  });
});

describe('L18 — restore answers', () => {
  test('an artboard restore waits for S1.13 (501 not-yet), through the seam when it lands', async () => {
    const { runtime } = fakeRuntime();
    const specs = cellRoutes(runtime);
    const r = await call(specs, 'POST', '/_api/trash/restore', OWNER, { id: 'artboard:a3/Hero' });
    expect(r).toMatchObject({ status: 501, body: { reason: 'not-yet' } });
    const seen: string[] = [];
    const withSplice = createTrashRoutes({
      control: () => runtime,
      access: () => trashAccess({ workspace: false, header: null, localRole: 'owner' }),
      readSource: () => null,
      restoreArtboard: async (item) => {
        seen.push(item.id);
        return { status: 'accepted', actionId: 'a10' };
      },
    });
    const ok = await call(withSplice, 'POST', '/_api/trash/restore', undefined, {
      id: 'artboard:a3/Hero',
    });
    expect(ok).toMatchObject({ status: 200, body: { ok: true, path: 'ui/c.tsx' } });
    expect(seen).toEqual(['artboard:a3/Hero']);
  });

  test('an older hub: the list falls back (legacy), the writes read needs-hub-update', async () => {
    const legacy = createTrashRoutes({
      control: () => ({}),
      access: () => trashAccess({ workspace: false, header: null, localRole: 'owner' }),
      readSource: () => null,
    });
    expect((await call(legacy, 'GET', '/_api/trash')).body).toMatchObject({
      ok: true,
      legacy: true,
      items: [],
    });
    const old = createTrashRoutes({
      control: () => ({
        acceptedTrash: async () => structuredClone(LISTING),
        acceptedTrashClear: async () => ({ status: 'rejected', code: 'invalid' }),
      }),
      access: () => trashAccess({ workspace: false, header: null, localRole: 'owner' }),
      readSource: () => null,
    });
    expect(await call(old, 'POST', '/_api/trash/clear', undefined, {})).toMatchObject({
      status: 409,
      body: { reason: 'needs-hub-update' },
    });
  });

  test('cleared items stay gone: a local home refuses the restore with 409 cleared', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maude-acl-l18-'));
    dirs.push(root);
    const designRoot = path.join(root, '.design');
    mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
    writeFileSync(path.join(designRoot, 'ui', 'b.tsx'), 'export default () => <p>b</p>;\n');
    const home = openLocalHome({
      designRoot,
      designRel: '.design',
      canvasGroups: () => [{ path: 'ui' }],
      machine: { id: 'm_l18', name: 'Mac' },
      bootId: 'boot-l18',
      lockRetryMs: 0,
      settleMs: 5,
      log: { warn() {}, error() {} },
    });
    homes.push(home);
    await home.ready();
    unlinkSync(path.join(designRoot, 'ui', 'b.tsx'));
    home.observe('ui/b.tsx');
    await home.flush();
    const specs = createTrashRoutes({
      control: () => home.runtime,
      access: () => trashAccess({ workspace: false, header: null, localRole: 'owner' }),
      readSource: () => null,
    });
    const list = await call(specs, 'GET', '/_api/trash');
    expect(list.body.items).toHaveLength(1);
    const id = list.body.items[0].id as string;
    expect(await call(specs, 'POST', '/_api/trash/clear', undefined, {})).toMatchObject({
      status: 200,
      body: { cleared: [id] },
    });
    expect((await call(specs, 'GET', '/_api/trash')).body.items).toEqual([]);
    expect(await call(specs, 'POST', '/_api/trash/restore', undefined, { id })).toMatchObject({
      status: 409,
      body: { reason: 'cleared' },
    });
  });

  test('none of the three routes is canvas-safe', () => {
    const { runtime } = fakeRuntime();
    const specs = cellRoutes(runtime);
    expect(specs.map((s) => `${s.method} ${s.path} ${s.origin}`)).toEqual([
      'GET /_api/trash main',
      'POST /_api/trash/restore main',
      'POST /_api/trash/clear main',
    ]);
    expect(specs.filter((s) => s.method === 'POST').every((s) => s.readOnly === 'refused')).toBe(
      true
    );
  });
});
