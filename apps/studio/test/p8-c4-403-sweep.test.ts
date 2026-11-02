// p8-c4 — the 403-only sweep (security follow-up to C4). Every route of every studio table
// (test/_acl-gate.ts `routeInventory`: http.ts's legacy literal, routes/index.ts `allSpecs`, the
// fall-through branches, the canvas origin's map) is asked by every caller that must be REFUSED,
// and the refusal must be the plain 403 — never a 404 that tells a refused caller whether the
// route or the thing exists, never a handler's own answer the gate let it reach, never a 5xx:
//
//   1. a project role without the write's capability (`writeCapability` × the role matrix):
//      Can view (observer), Can comment (viewer), Can edit (member) — every write it lacks;
//   2. a canvas-scoped grant (A only), on the main origin: every `project`-class route (U3,
//      test/_acl-route-classes.ts), read or write, and every `canvas`-class write naming B or a
//      missing canvas (U1: the same 403);
//   3. the canvas origin, from inside A's frame (the widest that origin is ever opened with):
//      every main-origin-only route, read or write (DDR-054/088 — the two allowlists).
//
// Both fixtures: a cell (the proxy's vouched claim per request) and a hub-linked desktop (the
// stored claim, re-read per request), because each serves routes the other has not.
//
// Two answers are the same for EVERY caller, the owner included, and so carry nothing about the
// caller's access — they are checked to be exactly that (asked again as the owner), not 403:
//   - a cell's contained routes (`isForbiddenRoute`, DDR-193 §2): 404 to everyone — "a cell
//     looks like it never had the feature";
//   - a read (GET) of a route that takes only writes: 405 to everyone, before any access check.
//
// Writes a caller HOLDS are not sent (the sweep must not change the fixture through a lane it
// may use); reads a caller holds answer per their handler and are the canary sweep's business.
// Egress is dead in both fixtures (a proxy on a closed port), so a write the gate wrongly let
// through could not leave the machine.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { writeCapability } from '../access/request.ts';
import { type Capability, can, type ProjectRole } from '../access/roles.ts';
import type { AccessClaim } from '../access/scope.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { isForbiddenRoute } from '../workspace-mode.ts';
import {
  A_ONLY_CLAIM,
  A_REL,
  A_USER,
  B_REL,
  bootGateCell,
  D,
  frameIn,
  type GateCell,
  type Headers_,
  M_REL,
  roleSession,
  routeInventory,
  UNSENT_WRITES,
} from './_acl-gate.ts';
import { ROUTE_CLASSES } from './_acl-route-classes.ts';
import { stubDeps } from './_route-stubs.ts';

type Mode = 'cell' | 'desktop';
type Who = 'observer' | 'viewer' | 'member' | 'A-only' | 'A-frame';
type Method = 'GET' | 'POST' | 'PATCH';

interface Ask {
  who: Who;
  origin: 'main' | 'canvas';
  method: Method;
  url: string;
  path: string;
  body?: Record<string, string>;
}

const DEAD_EGRESS = {
  HTTP_PROXY: 'http://127.0.0.1:9',
  HTTPS_PROXY: 'http://127.0.0.1:9',
  ALL_PROXY: 'http://127.0.0.1:9',
  NO_PROXY: 'localhost,127.0.0.1,::1',
  MAUDE_NO_EGRESS: '1',
};

const fill = (path: string) => path.replace(/:([A-Za-z_]+)/g, (_m, n: string) => `probe-${n}`);

const tableSession = (() => {
  const r = mountRoutes(allSpecs(stubDeps())).readOnlyAllowed;
  return { exact: new Set(r.exact), patterns: r.patterns };
})();

/** The methods a row is asked with: its declared one, or GET + POST where the handler decides. */
function methodsOf(row: ReturnType<typeof routeInventory>[number]): Method[] {
  if (row.method) return [row.method];
  return row.source === 'fallthrough' ? ['GET'] : ['GET', 'POST'];
}

function plan(): Ask[] {
  const rows = routeInventory();
  const canvasPaths = new Set(rows.filter((r) => r.origin === 'canvas').map((r) => r.path));
  const main = rows.filter((r) => r.origin === 'main');
  const asks: Ask[] = [];
  const seen = new Set<string>();
  const push = (a: Ask) => {
    const k = `${a.who} ${a.origin} ${a.method} ${a.url} ${JSON.stringify(a.body ?? null)}`;
    if (seen.has(k)) return;
    seen.add(k);
    asks.push(a);
  };
  const ask = (who: Who, origin: Ask['origin'], method: Method, path: string, body?: Ask['body']) =>
    push({
      who,
      origin,
      method,
      path,
      url: fill(path),
      ...(method !== 'GET' ? { body: body ?? {} } : {}),
    });
  // 1. project roles × the writes they lack.
  for (const role of ['observer', 'viewer', 'member'] as const)
    for (const row of main)
      for (const method of methodsOf(row)) {
        if (method === 'GET' || UNSENT_WRITES.has(row.path)) continue;
        const cap: Capability = writeCapability(row.path, tableSession);
        if (!can(role as ProjectRole, cap)) ask(role, 'main', method, row.path);
      }
  // 2. the A-only grant on the main origin.
  for (const row of main)
    for (const method of methodsOf(row)) {
      if (method !== 'GET' && UNSENT_WRITES.has(row.path)) continue;
      const cls = ROUTE_CLASSES[row.path];
      if (cls === 'project') ask('A-only', 'main', method, row.path);
      if (cls === 'canvas' && method !== 'GET')
        for (const rel of [B_REL, M_REL])
          ask('A-only', 'main', method, row.path, { file: `${D}/${rel}` });
    }
  // 3. the canvas origin, inside A's frame: every main-only route.
  for (const row of main) {
    if (canvasPaths.has(row.path)) continue;
    for (const method of methodsOf(row)) {
      if (method !== 'GET' && UNSENT_WRITES.has(row.path)) continue;
      ask('A-frame', 'canvas', method, row.path);
    }
  }
  return asks;
}

async function send(
  cell: GateCell,
  a: Pick<Ask, 'origin' | 'method' | 'url' | 'body'>,
  headers: Headers_,
  fc?: string
): Promise<number> {
  const base = a.origin === 'main' ? cell.base : cell.canvasBase;
  const url = fc ? `${a.url}${a.url.includes('?') ? '&' : '?'}fc=${encodeURIComponent(fc)}` : a.url;
  try {
    const r = await fetch(base + url, {
      method: a.method,
      redirect: 'manual',
      headers: {
        origin: base,
        ...(a.method !== 'GET' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: a.method !== 'GET' ? JSON.stringify(a.body ?? {}) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    await r.body?.cancel().catch(() => {});
    return r.status;
  } catch {
    return -1;
  }
}

async function sendAll(
  cell: GateCell,
  asks: readonly Ask[],
  headers: Headers_,
  fc?: string
): Promise<number[]> {
  const out: number[] = [];
  for (let i = 0; i < asks.length; i += 12)
    out.push(...(await Promise.all(asks.slice(i, i + 12).map((a) => send(cell, a, headers, fc)))));
  return out;
}

const label = (a: Ask) =>
  `${a.who} ${a.method} ${a.origin === 'canvas' ? '[canvas] ' : ''}${a.url}${a.body && Object.keys(a.body).length ? ` ${JSON.stringify(a.body)}` : ''}`;

interface LaneResult {
  asked: number;
  wrong: string[];
  /** answers equal to the owner's for the same request (contained route / write-only route) */
  uniform: string[];
}

/** One fixture: every ask, its caller set up the fixture's way, judged as the header says. */
async function runMode(
  mode: Mode,
  cell: GateCell,
  setup: (who: Who | 'owner') => Promise<{ headers: Headers_; fc?: string }>
): Promise<LaneResult> {
  const asks = plan();
  const status = new Map<Ask, number>();
  for (const who of ['observer', 'viewer', 'member', 'A-only', 'A-frame'] as const) {
    const mine = asks.filter((a) => a.who === who);
    const { headers, fc } = await setup(who);
    const got = await sendAll(cell, mine, headers, who === 'A-frame' ? fc : undefined);
    for (const [i, a] of mine.entries()) status.set(a, got[i] as number);
  }
  // The owner's answers, for the two everyone-alike cases only (never an unsafe owner write).
  const contained = (a: Ask) => mode === 'cell' && isForbiddenRoute(a.path);
  const owner = await setup('owner');
  const recheck = asks.filter((a) => {
    const s = status.get(a);
    if (s === 403) return false;
    return (contained(a) && s === 404) || (a.method === 'GET' && s === 405);
  });
  const ownerGot = await sendAll(cell, recheck, owner.headers);
  const ownerOf = new Map(recheck.map((a, i) => [a, ownerGot[i] as number]));
  const wrong: string[] = [];
  const uniform: string[] = [];
  for (const a of asks) {
    const s = status.get(a) as number;
    if (s === 403) continue;
    if (ownerOf.get(a) === s) uniform.push(`${label(a)} → ${s} (owner ${s})`);
    else wrong.push(`${label(a)} → ${s}${ownerOf.has(a) ? ` (owner ${ownerOf.get(a)})` : ''}`);
  }
  return { asked: asks.length, wrong, uniform };
}

const dump: Record<string, unknown> = {};

afterAll(() => {
  if (process.env.MAUDE_403_SWEEP_DUMP)
    writeFileSync(process.env.MAUDE_403_SWEEP_DUMP, JSON.stringify(dump, null, 1));
});

describe('the 403-only sweep — every refused caller hears a plain 403', () => {
  test('not vacuous: every lane of the plan has rows', () => {
    const asks = plan();
    for (const who of ['observer', 'viewer', 'member', 'A-only', 'A-frame'])
      expect({ who, rows: asks.some((a) => a.who === who) }).toEqual({ who, rows: true });
    // the canvas-origin wrapper rows are in the inventory (canvas-meta is canvas-safe)
    expect(
      routeInventory().some((r) => r.origin === 'canvas' && r.path === '/_api/canvas-meta')
    ).toBe(true);
  });

  describe('a cell (the proxy vouches the claim per request)', () => {
    let cell: GateCell;
    beforeAll(async () => {
      cell = await bootGateCell({ env: DEAD_EGRESS });
    }, 60000);
    afterAll(async () => {
      await cell?.stop();
    });

    test('route table × roles: a refusal is 403, or what the owner hears too', async () => {
      const fcA = await frameIn(cell, A_USER, A_REL);
      const r = await runMode('cell', cell, async (who) => {
        if (who === 'owner') return { headers: roleSession('owner') };
        if (who === 'A-only' || who === 'A-frame') return { headers: A_USER, fc: fcA };
        return { headers: roleSession(who) };
      });
      dump.cell = r;
      expect(r.wrong).toEqual([]);
    }, 600000);

    test('not vacuous: the owner’s session write passes the gate', async () => {
      const r = await fetch(`${cell.base}/_api/ui-prefs`, {
        method: 'POST',
        headers: { origin: cell.base, 'content-type': 'application/json', ...roleSession('owner') },
        body: JSON.stringify({}),
      });
      expect(r.status).not.toBe(403);
    });
  });

  describe('a hub-linked desktop (the stored claim, re-read per request)', () => {
    let desk: GateCell;
    beforeAll(async () => {
      desk = await bootGateCell({ desktop: true, env: DEAD_EGRESS });
    }, 60000);
    afterAll(async () => {
      await desk?.stop();
    });

    test('route table × roles: a refusal is 403, or what the owner hears too', async () => {
      const claimFor = (who: Who | 'owner'): AccessClaim =>
        who === 'A-only' || who === 'A-frame' ? A_ONLY_CLAIM : ({ v: 1, role: who } as AccessClaim);
      let fcA: string | undefined;
      const r = await runMode('desktop', desk, async (who) => {
        desk.setDesktopClaim?.(claimFor(who));
        if (who === 'A-frame') fcA ??= await frameIn(desk, {}, A_REL);
        return { headers: {}, ...(who === 'A-frame' ? { fc: fcA } : {}) };
      });
      dump.desktop = r;
      expect(r.wrong).toEqual([]);
    }, 600000);
  });
});
