// 2.0.4 task P — end to end on a workspace cell: a canvas whose build outlives the request.
//
// The studio boots in workspace mode with the REAL build worker behind a 3 s delay (the worker dir
// seam, MAUDE_CANVAS_WORKERS) and a 1 s request wait. Before the fix the request's wait WAS the
// build's life: the module answered a timeout every time and nothing was cached. Now:
//   1. the first open answers 503 "still being built" (Retry-After) while the build goes on;
//   2. `/_api/canvas-errors` says `building` meanwhile (the card's "Building …");
//   3. the build finishes on its own and is cached: the next open is 200, a cache hit.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { DEV_SERVER_ROOT } from '../paths.ts';
import { asUser, frameCap, get, OWNER, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const CANVAS = 'ui/slow.tsx';
const SRC = `import { DesignCanvas, DCArtboard } from '@maude/canvas-lib';
export default function Slow() {
  return <DesignCanvas><DCArtboard id="a" width={100} height={100}><p>slow</p></DCArtboard></DesignCanvas>;
}
`;
const DELAY_MS = 3000;
/** A canvas whose build never fits the 5 s ceiling (the worker sleeps longer for it). */
const STUCK = 'ui/very-slow.tsx';
const STUCK_DELAY_MS = 8000;

let proc: Subprocess;
let base: string;
let canvasBase: string;
let workers: string;
const OWNER_O = asUser(OWNER, 'owner@example.com');

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, CANVAS), SRC);
  writeFileSync(join(designRoot, STUCK), SRC.replace('slow', 'very slow'));
  workers = mkdtempSync(join(tmpdir(), 'slow-workers-'));
  writeFileSync(
    join(workers, 'canvas-build-worker.ts'),
    `await Bun.sleep(String(process.argv[3]).endsWith('very-slow.tsx') ? ${STUCK_DELAY_MS} : ${DELAY_MS});\nawait import(${JSON.stringify(join(DEV_SERVER_ROOT, 'canvas-build-worker.ts'))});\n`
  );
  const port = nextPort();
  const home = mkdtempSync(join(tmpdir(), 'slow-home-'));
  proc = await bootServer(root, port, {
    HOME: home,
    XDG_CONFIG_HOME: join(home, '.config'),
    MAUDE_WORKSPACE_MODE: '1',
    MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
    HUB_DASHBOARD_URL: 'https://design.example.com',
    MAUDE_PROJECT_NAME: 'Slow',
    MAUDE_CANVAS_WORKERS: workers,
    MAUDE_CANVAS_BUILD_WAIT_MS: '1000',
    MAUDE_CANVAS_BUILD_TIMEOUT_MS: '5000',
  });
  base = `http://localhost:${port}`;
  const info = JSON.parse(readFileSync(join(designRoot, '_server.json'), 'utf8')) as {
    canvasPort?: number;
  };
  canvasBase = `http://localhost:${info.canvasPort}`;
}, 60_000);

afterAll(async () => {
  if (proc) await killProc(proc);
  rmSync(workers, { recursive: true, force: true });
});

const health = async () =>
  ((await (await fetch(`${base}/_health`)).json()) as { render?: Record<string, number> }).render ??
  {};

describe('a build that outlives its request on a workspace cell', () => {
  test('first open: 503 still being built; canvas-errors says building; then a cache hit', async () => {
    const t0 = Date.now();
    const first = await fetch(`${base}/.design/${CANVAS}`, { headers: OWNER_O });
    const firstMs = Date.now() - t0;
    expect(first.status).toBe(503);
    expect(first.headers.get('retry-after')).toBe('5');
    expect(await first.text()).toBe('This canvas is still being built.');
    expect(firstMs).toBeLessThan(DELAY_MS);

    const errs = await get(`${base}/_api/canvas-errors?canvas=.design/${CANVAS}`, OWNER_O);
    expect(errs.status).toBe(200);
    expect(JSON.parse(errs.text)).toMatchObject({ errors: [], building: true });

    // the build goes on by itself; poll canvas-errors the way the card does
    const until = Date.now() + 30_000;
    let building = true;
    while (building && Date.now() < until) {
      await Bun.sleep(250);
      const r = await get(`${base}/_api/canvas-errors?canvas=.design/${CANVAS}`, OWNER_O);
      building = JSON.parse(r.text).building === true;
    }
    expect(building).toBe(false);

    const t1 = Date.now();
    const next = await fetch(`${base}/.design/${CANVAS}`, { headers: OWNER_O });
    const nextMs = Date.now() - t1;
    expect(next.status).toBe(200);
    expect(await next.text()).toContain('slow');
    expect(nextMs).toBeLessThan(DELAY_MS);
    const render = await health();
    expect(render.cacheHits).toBeGreaterThanOrEqual(1);
    expect(render.stillBuilding).toBe(1);
    expect(render.timeouts).toBe(0);
    console.log(
      `[task P] first open ${firstMs} ms → 503 building; after the build: ${nextMs} ms → 200 (cacheHits ${render.cacheHits}, builds ${render.builds}, timeouts ${render.timeouts})`
    );
  }, 60_000);
});

describe('a frame whose build runs out of time is told "not now", never "not yours"', () => {
  // design.studyfi.com, v2.0.3: the board's frame got 403 not-in-scope for its own module — a
  // timed-out build answered a frame like a refusal (gate-b-c4m), so devtools showed "Forbidden" on
  // `/.design/system/studyfi-v3/…` and the card said nothing. The request now stops waiting before
  // the ceiling, so the frame hears 503 "still being built"; the timeout itself reaches the shell
  // through canvas-errors (`timed-out`), never as a refusal.
  test('still building → 503; past the ceiling → canvas-errors timed-out; the frame never gets 403', async () => {
    const fc = (await frameCap({ base }, OWNER_O, STUCK)) as string;
    const first = await fetch(canvasBase + withFc(`/.design/${STUCK}`, fc), { headers: OWNER_O });
    expect(first.status).toBe(503);
    const until = Date.now() + 30_000;
    let body: Record<string, unknown> = {};
    do {
      await Bun.sleep(250);
      body = JSON.parse(
        (await get(`${base}/_api/canvas-errors?canvas=.design/${STUCK}`, OWNER_O)).text
      );
    } while (body.building === true && Date.now() < until);
    expect(body.buildFailure).toEqual({ class: 'timed-out' });
    // the next opens start the build again (a timed-out build is not kept) and say so
    const statuses: number[] = [];
    for (let i = 0; i < 2; i++) {
      const r = await fetch(canvasBase + withFc(`/.design/${STUCK}`, fc), { headers: OWNER_O });
      statuses.push(r.status);
      expect(await r.text()).not.toContain('not-in-scope');
    }
    expect(statuses.every((s) => s === 503)).toBe(true);
  }, 60_000);
});
