// S11.6 — GET /_api/canvas-source + GET /_api/canvas-errors (routes/canvas-source.ts; contract
// S11-slices §2 Q8, decision v2-S11-canvas-source-route).
//   - in process: the role matrix (Can view refused, Can comment and up served), a canvas-only
//     session (its grants only; outside them and missing answer the same body), `?sha=`, the listing
//     filter;
//   - the allowlists: in neither canvas list (the canvas origin 404s);
//   - real servers: a local studio (source, artboard lines, errors, the canvas origin's 404) and a
//     cell child behind per-request access claims (observer 403, viewer 200, a canvas-only claim).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import type { AccessClaim } from '../access/scope.ts';
import { resolveAccess } from '../access/scope.ts';
import { CANVAS_SAFE_API, type Http } from '../http.ts';
import { canvasOriginRoutes } from '../routes/canvas-origin.ts';
import { createCanvasSourceRoutes } from '../routes/canvas-source.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes, type RouteSpec } from '../routes/table.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { ROLE_REFUSALS } from './_role-refusals.ts';
import { stubDeps } from './_route-stubs.ts';

const SOURCE = `import { DCArtboard, DCSection, DesignCanvas } from '@maude/canvas-lib';
export default function Pricing() {
  return (
    <DesignCanvas>
      <DCSection id="plans">
        <DCArtboard id="free" label="Free" width={400} height={300}>
          <main />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}
`;
const BROKEN = SOURCE.replace('<main />', '<p>{price)</p>');
const ROUTES = ['/_api/canvas-source', '/_api/canvas-errors'] as const;

// ---------------------------------------------------------------------------
// In process.

const tmp = mkdtempSync(join(tmpdir(), 'canvas-source-route-'));
const designRoot = join(tmp, '.design');
mkdirSync(join(designRoot, 'ui'), { recursive: true });
mkdirSync(join(designRoot, '_draw'), { recursive: true });
writeFileSync(join(designRoot, 'ui', 'a.tsx'), SOURCE);
writeFileSync(join(designRoot, 'ui', 'b.tsx'), BROKEN);
writeFileSync(join(designRoot, '_draw', 'x.tsx'), SOURCE);
writeFileSync(join(tmp, 'outside.tsx'), SOURCE);
symlinkSync(join(tmp, 'outside.tsx'), join(designRoot, 'ui', 'link.tsx'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function routesFor(claim: AccessClaim, history: Record<string, string> = {}) {
  const access = resolveAccess(claim);
  const specs = createCanvasSourceRoutes({
    designRoot,
    designRel: '.design',
    access: () => access,
    historicalSource: async (repoRel, ref) => history[`${repoRel}@${ref}`] ?? null,
  });
  const get = async (path: string) => {
    const u = new URL(`http://localhost${path}`);
    const spec = specs.find((s) => s.path === u.pathname) as RouteSpec;
    const res = await spec.handle(new Request(u), {});
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text);
    } catch {
      /* not JSON */
    }
    return { status: res.status, body, line: `${res.status} ${body.error ?? ''}`.trim(), text };
  };
  return { get };
}

const role = (r: AccessClaim['role']): AccessClaim => ({ v: 1, role: r });

describe('who may read the source (in process)', () => {
  test('Can view is refused both routes, before the canvas is looked at', async () => {
    const { get } = routesFor(role('observer'));
    for (const p of [
      '/_api/canvas-source?canvas=ui/a.tsx',
      '/_api/canvas-source',
      '/_api/canvas-errors?canvas=ui/a.tsx',
      '/_api/canvas-errors',
      '/_api/canvas-source?canvas=ui/a.tsx&sha=abc1234',
    ])
      expect(`${p} ${(await get(p)).line}`).toBe(`${p} 403 read-only`);
  });

  test('Can comment, Can edit and the owner get the source, its artboard lines and no error', async () => {
    for (const r of ['viewer', 'member', 'owner'] as const) {
      const { status, body } = await routesFor(role(r)).get(
        '/_api/canvas-source?canvas=.design/ui/a.tsx'
      );
      expect(`${r} ${status}`).toBe(`${r} 200`);
      expect(body).toEqual({
        ok: true,
        canvas: '.design/ui/a.tsx',
        file: 'ui/a.tsx',
        sha: null,
        source: SOURCE,
        lines: 12,
        parsed: true,
        artboards: { free: { startLine: 6, endLine: 8 } },
        error: null,
      });
    }
  });

  test("DDR-148's `?file=` (the Timeline's read, a slug or a path) is the same parameter", async () => {
    const { get } = routesFor(role('viewer'));
    for (const f of ['ui/a', '.design/ui/a.tsx', 'ui/a.tsx']) {
      const r = await get(`/_api/canvas-source?file=${encodeURIComponent(f)}`);
      expect(`${f} ${r.status} ${r.body.ok} ${r.body.source === SOURCE}`).toBe(
        `${f} 200 true true`
      );
    }
    expect((await routesFor(role('observer')).get('/_api/canvas-source?file=ui/a')).line).toBe(
      '403 read-only'
    );
  });

  test('a broken canvas: the source still comes, with the error; canvas-errors answers the same', async () => {
    const { get } = routesFor(role('viewer'));
    const src = await get('/_api/canvas-source?canvas=ui/b.tsx');
    expect(src.status).toBe(200);
    expect(src.body.parsed).toBe(false);
    const err = {
      kind: 'syntax',
      message: 'Expected "}" but found ")"',
      file: 'ui/b.tsx',
      line: 7,
      column: 20,
      lineText: '          <p>{price)</p>',
    };
    expect(src.body.error).toEqual(err);
    expect((await get('/_api/canvas-errors?canvas=ui/b.tsx')).body).toEqual({
      canvas: '.design/ui/b.tsx',
      errors: [err],
    });
    expect((await get('/_api/canvas-errors?canvas=ui/a.tsx')).body).toEqual({
      canvas: '.design/ui/a.tsx',
      errors: [],
    });
    // The listing: only canvases with an error; runtime folders are never canvases.
    expect((await get('/_api/canvas-errors')).body).toEqual({
      canvases: [{ canvas: '.design/ui/b.tsx', errors: [err] }],
    });
  });

  test('not a canvas, outside the design root, a runtime folder, a symlink out: no source', async () => {
    const { get } = routesFor(role('owner'));
    for (const c of ['../outside.tsx', '.design/../outside.tsx', 'ui/a.css', '_draw/x.tsx', ''])
      expect(
        `${c} ${(await get(`/_api/canvas-source?canvas=${encodeURIComponent(c)}`)).status}`
      ).toBe(`${c} 400`);
    expect((await get('/_api/canvas-source')).status).toBe(400);
    expect((await get('/_api/canvas-source?canvas=ui/link.tsx')).status).toBe(404);
    expect((await get('/_api/canvas-source?canvas=ui/nope.tsx')).status).toBe(404);
  });

  test('a canvas-only session: its grant only — outside it and missing answer the same body', async () => {
    const claim: AccessClaim = {
      v: 1,
      role: null,
      grants: [
        { c: 'ui/a.tsx', r: 'viewer' },
        { c: 'ui/gone.tsx', r: 'viewer' },
      ],
    };
    const { get } = routesFor(claim);
    expect((await get('/_api/canvas-source?canvas=ui/a.tsx')).status).toBe(200);
    const outside = await get('/_api/canvas-source?canvas=ui/b.tsx');
    const missing = await get('/_api/canvas-source?canvas=ui/nope.tsx');
    const grantedButGone = await get('/_api/canvas-source?canvas=ui/gone.tsx');
    const notACanvas = await get('/_api/canvas-source?canvas=../outside.tsx');
    expect(outside.line).toBe('403 not-in-scope');
    for (const r of [missing, grantedButGone, notACanvas]) expect(r.text).toBe(outside.text);
    expect((await get('/_api/canvas-errors?canvas=ui/b.tsx')).text).toBe(outside.text);
    // The listing holds its grants only (b.tsx is broken, and not theirs).
    expect((await get('/_api/canvas-errors')).body).toEqual({ canvases: [] });
  });

  test('a grant that does not include the download (Can view on that canvas) is refused', async () => {
    const { get } = routesFor({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'observer' }] });
    expect((await get('/_api/canvas-source?canvas=ui/a.tsx')).line).toBe('403 read-only');
  });

  test('?sha= reads the past version with the same rules; a bad ref is a 400, an unknown one a 404', async () => {
    const past = SOURCE.replace('Free', 'Gratis');
    const history = { '.design/ui/a.tsx@abc1234': past, '.design/ui/gone.tsx@r7': past };
    const { get } = routesFor(role('viewer'), history);
    const r = await get('/_api/canvas-source?canvas=ui/a.tsx&sha=abc1234');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      sha: 'abc1234',
      source: past,
      artboards: { free: { startLine: 6, endLine: 8 } },
    });
    // A deleted canvas's past version is still readable by a project role.
    expect((await get('/_api/canvas-source?canvas=ui/gone.tsx&sha=r7')).status).toBe(200);
    for (const bad of ['HEAD', 'main', '--output=x', 'abc', 'r', '../x'])
      expect(
        `${bad} ${(await get(`/_api/canvas-source?canvas=ui/a.tsx&sha=${encodeURIComponent(bad)}`)).status}`
      ).toBe(`${bad} 400`);
    expect((await get('/_api/canvas-source?canvas=ui/a.tsx&sha=fffffff')).status).toBe(404);
    // A canvas-only session reads its grant's history, never another canvas's.
    const only = routesFor({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'viewer' }] }, history);
    expect((await only.get('/_api/canvas-source?canvas=ui/a.tsx&sha=abc1234')).status).toBe(200);
    expect((await only.get('/_api/canvas-source?canvas=ui/gone.tsx&sha=r7')).line).toBe(
      '403 not-in-scope'
    );
  });
});

describe('the routes are in neither canvas allowlist, and refuse Can view in the role table', () => {
  test('main origin only', () => {
    const specs = allSpecs(stubDeps());
    const table = mountRoutes(specs);
    const http = {
      routes: {},
      canvasRoutes: {},
      tableCanvasPaths: table.canvasPaths,
    } as unknown as Pick<Http, 'routes' | 'canvasRoutes' | 'tableCanvasPaths'>;
    for (const p of ROUTES) {
      expect(specs.find((s) => s.path === p)).toMatchObject({ method: 'GET', origin: 'main' });
      expect(CANVAS_SAFE_API.has(p)).toBe(false);
      expect(table.canvasPaths).not.toContain(p);
      expect(Object.keys(canvasOriginRoutes(http))).not.toContain(p);
    }
  });

  test('test/_role-refusals.ts names both GETs, refused for Can view', () => {
    for (const p of ROUTES)
      expect(ROLE_REFUSALS.find((r) => r.route === p)).toMatchObject({
        method: 'GET',
        refused: ['view'],
      });
  });
});

// ---------------------------------------------------------------------------
// Real servers.

const procs: Subprocess[] = [];
afterAll(async () => {
  for (const p of procs) await killProc(p);
});

async function canvasOriginOf(root: string): Promise<string> {
  for (let i = 0; i < 80; i++) {
    try {
      const info = JSON.parse(readFileSync(join(root, '.design', '_server.json'), 'utf8'));
      if (info.canvasOrigin) return info.canvasOrigin as string;
    } catch {
      /* not yet */
    }
    await Bun.sleep(50);
  }
  throw new Error('canvasOrigin never appeared in _server.json');
}

describe('a local studio', () => {
  let base = '';
  let root = '';
  beforeAll(async () => {
    const s = makeSandbox();
    root = s.root;
    writeFileSync(join(s.designRoot, 'ui', 'Pricing.tsx'), SOURCE);
    writeFileSync(join(s.designRoot, 'ui', 'Broken.tsx'), BROKEN);
    const port = nextPort();
    procs.push(await bootServer(s.root, port, { MAUDE_NO_AUTOBUILD: '1' }));
    base = `http://localhost:${port}`;
  });

  test('the owner reads the source, its artboard lines and the errors', async () => {
    const r = await fetch(`${base}/_api/canvas-source?canvas=.design/ui/Pricing.tsx`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(await r.json()).toMatchObject({
      source: SOURCE,
      artboards: { free: { startLine: 6, endLine: 8 } },
      error: null,
    });
    const e = (await (await fetch(`${base}/_api/canvas-errors`)).json()) as {
      canvases: Array<{ canvas: string; errors: Array<{ line: number; column: number }> }>;
    };
    expect(
      e.canvases.map((c) => `${c.canvas}:${c.errors[0]?.line}:${c.errors[0]?.column}`)
    ).toEqual(['.design/ui/Broken.tsx:7:20']);
  });

  test("a live build's own error (an import) is reported until the canvas builds again", async () => {
    const designRoot = join(root, '.design');
    const src = `import { DCArtboard } from '@maude/canvas-lib';\nimport Card from './nope-card';\nexport default () => <DCArtboard id="a"><Card /></DCArtboard>;\n`;
    writeFileSync(join(designRoot, 'ui', 'Missing.tsx'), src);
    const q = `${base}/_api/canvas-errors?canvas=ui/Missing.tsx`;
    // Not built yet: it parses, so nothing is known against it.
    expect(((await (await fetch(q)).json()) as { errors: unknown[] }).errors).toEqual([]);
    const built = await fetch(`${base}/.design/ui/Missing.tsx`);
    expect(built.status).toBe(500);
    const after = (await (await fetch(q)).json()) as { errors: Array<Record<string, unknown>> };
    expect(after.errors).toHaveLength(1);
    expect(after.errors[0]).toMatchObject({
      kind: 'resolve',
      file: 'ui/Missing.tsx',
      line: 2,
      column: 18,
    });
    expect(JSON.stringify(after)).not.toContain(root);
    writeFileSync(join(designRoot, 'ui', 'nope-card.tsx'), 'export default () => <b>card</b>;\n');
    expect((await fetch(`${base}/.design/ui/Missing.tsx`)).status).toBe(200);
    expect(((await (await fetch(q)).json()) as { errors: unknown[] }).errors).toEqual([]);
  }, 30000);

  test('the canvas origin refuses both at its gate, and no source crosses', async () => {
    // A main-only route is unreachable there: the canvas server's fall-through gate answers
    // before any handler (403 — test/canvas-origin-gate.test.ts pins the same for the others).
    const origin = await canvasOriginOf(root);
    for (const p of ROUTES)
      for (const q of ['canvas=ui/Pricing.tsx', 'file=ui/Pricing']) {
        const r = await fetch(`${origin}${p}?${q}`);
        const text = await r.text();
        expect(`${p}?${q} ${r.status} ${text.includes('DCArtboard')}`).toBe(`${p}?${q} 403 false`);
      }
  });
});

describe('a cell child (per-request access claims)', () => {
  let cell = '';
  beforeAll(async () => {
    const s = makeSandbox();
    writeFileSync(join(s.designRoot, 'ui', 'a.tsx'), SOURCE);
    writeFileSync(join(s.designRoot, 'ui', 'b.tsx'), BROKEN);
    const port = nextPort();
    procs.push(
      await bootServer(s.root, port, {
        MAUDE_WORKSPACE_MODE: '1',
        MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
        HUB_DASHBOARD_URL: 'https://cloud.maude.sh',
        MAUDE_PROJECT_NAME: 'Alligators',
      })
    );
    cell = `http://localhost:${port}`;
  });

  const as = (claim: AccessClaim) => ({
    'x-maude-access': Buffer.from(JSON.stringify(claim)).toString('base64url'),
    'x-maude-readonly': claim.role === 'member' || claim.role === 'owner' ? '0' : '1',
  });
  const get = async (path: string, claim: AccessClaim) => {
    const r = await fetch(`${cell}${path}`, { headers: as(claim) });
    const text = await r.text();
    let error = '';
    try {
      error = (JSON.parse(text) as { error?: string }).error ?? '';
    } catch {
      /* not JSON */
    }
    return { line: `${r.status} ${error}`.trim(), text };
  };

  test('Can view 403, Can comment 200', async () => {
    for (const p of ROUTES) {
      expect((await get(`${p}?canvas=ui/a.tsx`, role('observer'))).line).toBe('403 read-only');
      expect((await get(`${p}?canvas=ui/a.tsx`, role('viewer'))).line).toBe('200');
    }
  });

  test('a canvas-only claim: its grant 200; another canvas and a missing one the same 403', async () => {
    const claim: AccessClaim = { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] };
    expect((await get('/_api/canvas-source?canvas=ui/a.tsx', claim)).line).toBe('200');
    const other = await get('/_api/canvas-source?canvas=ui/b.tsx', claim);
    const missing = await get('/_api/canvas-source?canvas=ui/nope.tsx', claim);
    expect(other.line).toBe('403 not-in-scope');
    expect(missing.text).toBe(other.text);
    expect((await get('/_api/canvas-errors', claim)).text).toBe('{"canvases":[]}');
  });
});
