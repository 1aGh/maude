// S3.5 — PATCH /_api/present-meta (routes/present.ts; contract S3-present-session §7, decision
// maude/v2-S3-present-meta-own-route). Real server boots:
//   - a local studio: the write itself, what it keeps, its refusals (400 / 404 / 409 / 422), the
//     canvas origin's 404, and the `/_api/canvas-meta` pin (it keeps ignoring `present` and
//     `artboardMeta`, and its v1 layout write keeps them);
//   - a cell (workspace mode, the proxy's per-request role headers): every role below `edit` gets
//     the read-only 403 — the rows of test/_role-refusals.ts for this route.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { CANVAS_SAFE_API, type Http } from '../http.ts';
import { canvasOriginRoutes } from '../routes/canvas-origin.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { ROLE_REFUSALS } from './_role-refusals.ts';
import { stubDeps } from './_route-stubs.ts';

const ROUTE = '/_api/present-meta';
const FILE = '.design/ui/Deck.tsx';
const SOURCE = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Deck() {
  return (
    <DesignCanvas>
      <DCArtboard id="a" label="One" width={400} height={300}><main /></DCArtboard>
      <DCArtboard id="b" label="Two" width={400} height={300}><main /></DCArtboard>
      <DCArtboard id="c" label="Three" width={400} height={300}><main /></DCArtboard>
    </DesignCanvas>
  );
}
`;
const META = {
  title: 'Deck',
  layout: { artboards: [{ id: 'a', x: 0, y: 0 }] },
  critic: { score: 4, notes: ['kept'] },
  artboardMeta: { a: { poster: 3 } },
};

function seed() {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'Deck.tsx'), SOURCE);
  writeFileSync(join(designRoot, 'ui', 'Deck.meta.json'), `${JSON.stringify(META, null, 2)}\n`);
  return { root, designRoot, metaAbs: join(designRoot, 'ui', 'Deck.meta.json') };
}

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function readCanvasOrigin(designRoot: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    try {
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

const patch = (base: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}${ROUTE}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

describe('the route is in neither canvas allowlist', () => {
  test('absent from CANVAS_SAFE_API and from the canvas server routes map', () => {
    const table = mountRoutes(allSpecs(stubDeps()));
    const spec = allSpecs(stubDeps()).find((s) => s.path === ROUTE);
    expect(spec).toMatchObject({ method: 'PATCH', origin: 'main', readOnly: 'refused' });
    expect(CANVAS_SAFE_API.has(ROUTE)).toBe(false);
    expect(table.canvasPaths).not.toContain(ROUTE);
    const http = {
      routes: {},
      canvasRoutes: {},
      tableCanvasPaths: table.canvasPaths,
    } as unknown as Pick<Http, 'routes' | 'canvasRoutes' | 'tableCanvasPaths'>;
    expect(Object.keys(canvasOriginRoutes(http))).not.toContain(ROUTE);
  });
});

describe('PATCH /_api/present-meta on a local studio', () => {
  let base = '';
  let designRoot = '';
  let metaAbs = '';
  beforeAll(async () => {
    const s = seed();
    designRoot = s.designRoot;
    metaAbs = s.metaAbs;
    const port = nextPort();
    procs.push(await bootServer(s.root, port, { MAUDE_NO_AUTOBUILD: '1' }));
    base = `http://localhost:${port}`;
  });
  const onDisk = () => JSON.parse(readFileSync(metaAbs, 'utf8')) as Record<string, unknown>;

  test('a body without changes writes nothing and answers the state with its ETag', async () => {
    const before = readFileSync(metaAbs, 'utf8');
    const res = await patch(base, { file: FILE });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { etag: string; present: unknown; notes: unknown };
    expect(body).toMatchObject({ ok: true, present: null, notes: {} });
    expect(body.etag).toMatch(/^m-[0-9a-f]{20}$/);
    expect(readFileSync(metaAbs, 'utf8')).toBe(before);
  });

  test('order, skip and notes are written; every other key is kept; nothing is stamped', async () => {
    const { etag } = (await (await patch(base, { file: FILE })).json()) as { etag: string };
    const res = await patch(base, {
      file: FILE,
      present: { order: ['c', 'a', 'b'], skip: ['b'] },
      notes: { a: 'Opening line', c: 'Then the poster' },
      expected: etag,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      ok: true,
      present: { order: ['c', 'a', 'b'], skip: ['b'] },
      notes: { a: 'Opening line', c: 'Then the poster' },
    });
    expect(body.etag).not.toBe(etag);
    const m = onDisk();
    expect(Object.keys(m)).toEqual(['title', 'layout', 'critic', 'artboardMeta', 'present']);
    expect(m.title).toBe(META.title);
    expect(m.layout).toEqual(META.layout);
    expect(m.critic).toEqual(META.critic);
    expect(m.artboardMeta).toEqual({
      a: { poster: 3, notes: 'Opening line' },
      c: { notes: 'Then the poster' },
    });
    expect('last_modified' in m).toBe(false);
  });

  test('a stale ETag is a 409 with the current one, and nothing is written', async () => {
    const before = readFileSync(metaAbs, 'utf8');
    const res = await patch(base, {
      file: FILE,
      present: null,
      expected: 'm-00000000000000000000',
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('stale');
    expect(readFileSync(metaAbs, 'utf8')).toBe(before);
  });

  test('an unknown key is a 400; an unknown or duplicate id a 422; nothing is written', async () => {
    const before = readFileSync(metaAbs, 'utf8');
    const r400 = await patch(base, { file: FILE, layout: { artboards: [] } });
    expect(r400.status).toBe(400);
    expect(await r400.json()).toEqual({ error: 'unknown-key', field: 'layout' });
    expect((await patch(base, '{nope')).status).toBe(400);
    const r422 = await patch(base, { file: FILE, present: { order: ['a', 'ghost'] } });
    expect(r422.status).toBe(422);
    expect(await r422.json()).toEqual({ error: 'unknown-artboard', ids: ['ghost'] });
    const dup = await patch(base, { file: FILE, present: { skip: ['a', 'a'] } });
    expect(dup.status).toBe(422);
    expect(((await dup.json()) as { error: string }).error).toBe('duplicate');
    expect(readFileSync(metaAbs, 'utf8')).toBe(before);
  });

  test('a canvas that is not there, or not a canvas, is a 404', async () => {
    for (const file of [
      '.design/ui/Nope.tsx',
      '.design/ui/fixture.html',
      '.design/_draw/x.tsx',
      '../outside.tsx',
      '.design/../package.tsx',
    ])
      expect(`${file} ${(await patch(base, { file, present: null })).status}`).toBe(`${file} 404`);
  });

  test('an unreadable sidecar is never overwritten', async () => {
    const good = readFileSync(metaAbs, 'utf8');
    writeFileSync(metaAbs, '{ broken');
    try {
      const res = await patch(base, { file: FILE, present: { order: ['a'] } });
      expect(res.status).toBe(422);
      expect(readFileSync(metaAbs, 'utf8')).toBe('{ broken');
    } finally {
      writeFileSync(metaAbs, good);
    }
  });

  test('/_api/canvas-meta ignores present + artboardMeta, and its layout write keeps them (v1 peer)', async () => {
    const before = onDisk();
    const res = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: FILE,
        patch: { present: { order: ['b'] }, artboardMeta: { b: { notes: 'planted' } } },
      }),
    });
    expect(res.status).toBe(200);
    expect(onDisk()).toEqual(before);
    // the v1 writer: a layout drag rewrites the file and keeps the v2 top-level keys
    const drag = await fetch(`${base}/_api/canvas-meta`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: FILE,
        patch: { layout: { artboards: [{ id: 'a', x: 40, y: 0 }] } },
      }),
    });
    expect(drag.status).toBe(200);
    const m = onDisk();
    expect(m.present).toEqual(before.present);
    expect(m.artboardMeta).toEqual(before.artboardMeta);
    expect(m.critic).toEqual(META.critic);
  });

  // The contract says "404"; the canvas origin's fall-through answers every route outside its
  // allowlists with the privileged-route 403 (test/canvas-origin-gate.test.ts), and that is the pin.
  test('the canvas origin refuses it like every privileged route, and the capture origin writes nothing', async () => {
    const before = readFileSync(metaAbs, 'utf8');
    const canvas = await readCanvasOrigin(designRoot);
    const res = await fetch(`${canvas}${ROUTE}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: FILE, present: null }),
    });
    expect(res.status).toBe(403);
    const shell = await fetch(`${base}/_canvas-shell.html?canvas=ui/Deck.tsx`, {
      redirect: 'manual',
    });
    expect(shell.status).toBe(307);
    const capture = new URL(shell.headers.get('location') ?? '').origin;
    const cap = await fetch(`${capture}${ROUTE}`, {
      method: 'PATCH',
      body: JSON.stringify({ file: FILE, present: null }),
    });
    expect([404, 405]).toContain(cap.status);
    expect(readFileSync(metaAbs, 'utf8')).toBe(before);
  });
});

describe('PATCH /_api/present-meta in a cell — every role below edit is refused', () => {
  // The cell proxy's per-request vouch (Cloud Phase 27 A3/A4): an edit role is `x-maude-readonly: 0`.
  const HEADERS: Record<string, Record<string, string>> = {
    view: { 'x-maude-role': 'observer', 'x-maude-readonly': '1' },
    comment: { 'x-maude-role': 'viewer', 'x-maude-readonly': '1' },
    edit: { 'x-maude-role': 'member', 'x-maude-readonly': '0' },
  };
  let base = '';
  let metaAbs = '';
  beforeAll(async () => {
    const s = seed();
    metaAbs = s.metaAbs;
    const port = nextPort();
    procs.push(
      await bootServer(s.root, port, {
        MAUDE_NO_AUTOBUILD: '1',
        MAUDE_WORKSPACE_MODE: '1',
        MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
        HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
        MAUDE_PROJECT_NAME: 'Deck',
      })
    );
    base = `http://localhost:${port}`;
  });

  const rows = ROLE_REFUSALS.filter((r) => r.route === ROUTE);
  test('the refusal table has this route', () => {
    expect(rows.map((r) => `${r.method} ${r.refused.join(',')}`)).toEqual(['PATCH view,comment']);
  });
  for (const row of rows)
    for (const role of row.refused)
      test(`${role} → 403 read-only, nothing written`, async () => {
        const before = readFileSync(metaAbs, 'utf8');
        const res = await patch(base, { file: FILE, present: { order: ['b'] } }, HEADERS[role]);
        expect(res.status).toBe(403);
        expect(((await res.json()) as { reason?: string }).reason).toBe('read-only');
        expect(readFileSync(metaAbs, 'utf8')).toBe(before);
      });

  test('no vouch at all is read-only too; an edit role writes', async () => {
    expect((await patch(base, { file: FILE, present: { order: ['b'] } })).status).toBe(403);
    const ok = await patch(base, { file: FILE, present: { order: ['b'] } }, HEADERS.edit);
    expect(ok.status).toBe(200);
    expect(JSON.parse(readFileSync(metaAbs, 'utf8')).present).toEqual({ order: ['b'] });
  });
});
