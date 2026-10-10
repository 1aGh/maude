// V2-2.5 — the two canvas-origin allowlists, held to each other.
//
// A route the untrusted canvas iframe may reach lives in TWO lists (CLAUDE.md,
// DDR-054/088): `CANVAS_SAFE_API` (http.ts — opens the `fetch` fall-through)
// and the canvas server's `routes` map (routes/canvas-origin.ts — Bun matches
// `routes` before `fetch`). A one-list entry is the Phase-23 bug: listed only in
// CANVAS_SAFE_API it 404s from the canvas; listed only in the map it is served
// with no `isCanvasSafeRoute` review at all. Nothing compared the two before
// this file. Table routes (`origin: 'canvas'` specs) are derived into both.

import { describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CANVAS_SAFE_API, CANVAS_SAFE_DYNAMIC, type Http } from '../http.ts';
import { canvasOriginRoutes } from '../routes/canvas-origin.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes, type RouteSpec } from '../routes/table.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';
import { stubDeps } from './_route-stubs.ts';

const SPECS = allSpecs(stubDeps());
const TABLE = mountRoutes(SPECS);

/** A fake `http` whose every handler names where the canvas map took it from. */
const tagged = (source: string) =>
  new Proxy(
    {},
    {
      get: (_t, key) =>
        Object.assign(() => new Response(null), { from: `${source} ${String(key)}` }),
    }
  ) as Record<string, (req: Request) => Response>;

function canvasMap(tableCanvasPaths: readonly string[] = TABLE.canvasPaths) {
  const http = {
    routes: tagged('routes'),
    canvasRoutes: tagged('canvasRoutes'),
    tableCanvasPaths,
  } as unknown as Pick<Http, 'routes' | 'canvasRoutes' | 'tableCanvasPaths'>;
  return canvasOriginRoutes(http) as Record<string, { from?: string }>;
}

/** What the canvas fall-through allows by exact path: the listed set plus the table's. */
const canvasSafe = (tableCanvasPaths: readonly string[] = TABLE.canvasPaths) =>
  new Set([...CANVAS_SAFE_API, ...tableCanvasPaths]);

/** Every way the two lists can disagree. */
function parityProblems(safe: ReadonlySet<string>, mapKeys: readonly string[]): string[] {
  const keys = new Set(mapKeys);
  const out: string[] = [];
  for (const p of safe) if (!keys.has(p)) out.push(`${p}: in CANVAS_SAFE_API only (404s)`);
  for (const k of keys)
    if (k !== '/_health' && !safe.has(k)) out.push(`${k}: in the canvas map only (unreviewed)`);
  return out;
}

const PRIVILEGED = ['/_api/export', '/_config', '/_api/thumbs/want', '/_api/index'];

describe('CANVAS_SAFE_API ↔ the canvas server routes map (V2-2.5)', () => {
  test('every canvas-safe path has a canvas-map handler; every map key is canvas-safe or /_health', () => {
    expect(parityProblems(canvasSafe(), Object.keys(canvasMap()))).toEqual([]);
  });

  test('a one-list entry is caught, either way round', () => {
    const keys = Object.keys(canvasMap());
    expect(parityProblems(new Set([...canvasSafe(), '/_api/planted']), keys)).toEqual([
      '/_api/planted: in CANVAS_SAFE_API only (404s)',
    ]);
    expect(parityProblems(canvasSafe(), [...keys, '/_api/planted'])).toEqual([
      '/_api/planted: in the canvas map only (unreviewed)',
    ]);
  });

  test('each map entry is the handler for its own path; git-committers is the canvasRoutes projection', () => {
    for (const [path, handler] of Object.entries(canvasMap())) {
      const source = path === '/_api/git-committers' ? 'canvasRoutes' : 'routes';
      expect(`${path} ← ${handler.from}`).toBe(`${path} ← ${source} ${path}`);
    }
  });

  test('the comments reply is the one dynamic fall-through exception', () => {
    expect(CANVAS_SAFE_DYNAMIC.map(String)).toEqual([
      String(/^\/_api\/comments\/[A-Za-z0-9_]+\/reply$/),
    ]);
    const re = CANVAS_SAFE_DYNAMIC[0] as RegExp;
    expect(re.test('/_api/comments/c_1a/reply')).toBe(true);
    expect(re.test('/_api/comments/c_1a/delete')).toBe(false);
    expect(Object.keys(canvasMap()).some((k) => k.startsWith('/_api/comments/'))).toBe(false);
  });

  test('privileged routes and every main-origin table route are in neither list', () => {
    const main = SPECS.filter((s) => s.origin === 'main').map((s) => s.path);
    expect(main.length).toBeGreaterThan(0);
    const keys = new Set(Object.keys(canvasMap()));
    for (const p of [...PRIVILEGED, ...main]) {
      expect(`${p} safe=${canvasSafe().has(p)} map=${keys.has(p)}`).toBe(
        `${p} safe=false map=false`
      );
    }
  });

  test("a table spec with origin 'canvas' lands in both lists — and only exact paths may", () => {
    const plant: RouteSpec = {
      method: 'GET',
      path: '/_api/planted-canvas',
      origin: 'canvas',
      readOnly: 'allowed',
      handle: () => new Response(null),
    };
    const paths = mountRoutes([...SPECS, plant]).canvasPaths;
    expect(paths).toContain('/_api/planted-canvas');
    expect(canvasMap(paths)['/_api/planted-canvas']?.from).toBe('routes /_api/planted-canvas');
    expect(parityProblems(canvasSafe(paths), Object.keys(canvasMap(paths)))).toEqual([]);
    expect(() => mountRoutes([{ ...plant, path: '/_api/planted-canvas/:id' }])).toThrow(
      /exact paths only/
    );
  });
});

describe('the canvas-safe set on the live origins (V2-2.5)', () => {
  test('the capture origin answers every write on every canvas-safe route 405; the canvas origin reaches every map route', async () => {
    const { root, designRoot } = makeSandbox();
    writeFileSync(join(designRoot, 'ui', 'Parity.tsx'), 'export default () => <main/>;\n');
    const port = nextPort();
    const proc = await bootServer(root, port, { MAUDE_NO_AUTOBUILD: '1' });
    try {
      const r = await fetch(`http://localhost:${port}/_canvas-shell.html?canvas=ui/Parity.tsx`, {
        redirect: 'manual',
      });
      expect(r.status).toBe(307);
      const capture = new URL(r.headers.get('location') ?? '').origin;
      const routes = [...new Set([...canvasSafe(), ...Object.keys(canvasMap())])].sort();
      for (const route of routes) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const res = await fetch(`${capture}${route}`, {
            method,
            body: '{}',
            signal: AbortSignal.timeout(5000),
          });
          expect(`${method} ${route} ${res.status}`).toBe(`${method} ${route} 405`);
        }
      }
      // The interactive canvas origin REACHES every map route: Bun answers it from the routes
      // map, so it is neither the gate's 403 nor the file fall-through's 404.
      const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8'));
      const canvas = String(info.canvasOrigin);
      for (const route of Object.keys(canvasMap()).sort()) {
        const res = await fetch(`${canvas}${route}`, { signal: AbortSignal.timeout(5000) });
        expect(`GET ${route} ${[403, 404].includes(res.status) ? res.status : 'reached'}`).toBe(
          `GET ${route} reached`
        );
      }
    } finally {
      await killProc(proc);
    }
  }, 60_000);
});
