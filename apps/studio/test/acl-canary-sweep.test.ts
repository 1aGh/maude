// S9.12 — the studio canary sweep (V2-1.16 §7, the browser door + the canvas origin).
//
// One A-only session walks EVERY row of the studio's route tables (test/_acl-gate.ts reads
// them from http.ts, routes/index.ts and routes/canvas-origin.ts) on both origins, with
// every target spelling a handler reads, and hears every socket frame while the owner works
// on B. Nothing it receives may carry the canary; every B-targeted request answers exactly
// like the same request for a missing canvas (U1).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listen, until } from './_acl-cell.ts';
import {
  A_ONLY,
  A_ONLY_CLAIM,
  B_REL,
  badProbeUrls,
  bootGateCell,
  buildProbes,
  captureProbes,
  D,
  type GateCell,
  markers,
  OWNER,
  OWNER_SESSION,
  sweep,
} from './_acl-gate.ts';
import { ROUTE_CLASSES } from './_acl-route-classes.ts';

/**
 * Rows the sweep finds and S9.12 did NOT close, by name — the gate is not ready for the
 * `roles-v2` flip (Q13) until this is empty. A new finding is never added here silently.
 */
const KNOWN_OPEN: Record<string, string> = {};

let cell: GateCell;
beforeAll(async () => {
  cell = await bootGateCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

describe('the studio canary sweep — an A-only session', () => {
  test('the S9.12b plants exist: a trashed copy of B, another member’s export job of B', () => {
    expect(readdirSync(join(cell.designRoot, '_trash')).some((d) => /canary-b-copy/.test(d))).toBe(
      true
    );
    expect(cell.bJobId).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('every probe is built from real params (no /undefined, no :param)', () => {
    const probes = buildProbes(cell);
    expect(probes.length).toBeGreaterThan(1000);
    expect(badProbeUrls(probes)).toEqual([]);
  });

  test('no route on either origin answers B, and B answers like a missing canvas (U1)', async () => {
    const r = await sweep(cell, A_ONLY);
    if (process.env.MAUDE_ACL_SWEEP_DUMP)
      writeFileSync(
        process.env.MAUDE_ACL_SWEEP_DUMP,
        JSON.stringify({ leaks: r.leaks, oracles: r.oracles, statuses: r.statuses }, null, 1)
      );
    // U3 has teeth: a `project` route never answers a canvas-only session with a 2xx.
    const projectOk = Object.entries(r.statuses)
      .filter(([route]) => ROUTE_CLASSES[route.split(' ')[1] as string] === 'project')
      .filter(([, seen]) => seen.some((s) => s >= 200 && s < 300))
      .map(([route]) => route);
    expect(projectOk).toEqual([]);
    const open = Object.keys(r.oracles).filter((k) => !(k in KNOWN_OPEN));
    expect({ leaks: r.leaks, oracles: open }).toEqual({ leaks: {}, oracles: [] });
    // Every known-open row must still be open: fixing one removes it from KNOWN_OPEN.
    expect(Object.keys(KNOWN_OPEN).filter((k) => !(k in r.oracles))).toEqual([]);
  }, 600000);

  test('not vacuous: the owner reads the canary on the rows the filters narrow', async () => {
    const reads = buildProbes(cell).filter((p) => p.method === 'GET');
    const r = await sweep(cell, OWNER, reads);
    const routes = new Set(Object.keys(r.leaks).map((k) => k.split(/[ ?]/)[1]));
    for (const route of [
      '/_index-data',
      '/_comments-all',
      '/_config',
      '/_api/git/status',
      '/_api/git/branches',
      '/_api/git/log',
      '/_api/ai/runs',
      '/_api/sync/trash',
    ])
      expect({ route, owner: routes.has(route) }).toEqual({ route, owner: true });
    // The export job is listed to the session that started it (the A-only sweep has another).
    const jobs = buildProbes(cell).filter(
      (p) => p.method === 'GET' && p.route === 'main /_api/export-jobs' && !p.pair
    );
    const mine = await sweep(cell, OWNER_SESSION, jobs);
    expect(Object.keys(mine.leaks).length).toBeGreaterThan(0);
  }, 600000);

  test('the sockets carry nothing of B while the owner works on it', async () => {
    const ws = cell.base.replace(/^http/, 'ws');
    const wsCanvas = cell.canvasBase.replace(/^http/, 'ws');
    const shell = await listen(`${ws}/_ws`, A_ONLY);
    const hmr = await listen(`${wsCanvas}/_ws`, A_ONLY);
    const owner = await listen(`${ws}/_ws`, OWNER);
    if ('refused' in shell || 'refused' in hmr || 'refused' in owner)
      throw new Error('a socket was refused');
    try {
      // The owner's activity on B: an edit, a comment, a selection, an AI run.
      const { writeFileSync: write } = await import('node:fs');
      write(`${cell.designRoot}/${B_REL}`, '// canary socket edit\nexport default () => null;\n');
      await fetch(`${cell.base}/_comments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: cell.base, ...OWNER },
        body: JSON.stringify({
          file: `${D}/${B_REL}`,
          text: 'canary socket comment',
          selector: 'div',
        }),
      });
      await fetch(`${cell.base}/_api/ai/start`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: cell.base, ...OWNER },
        body: JSON.stringify({ file: `${D}/${B_REL}`, author: 'Claude' }),
      });
      owner.ws.send(JSON.stringify({ type: 'active', file: `${D}/${B_REL}` }));
      // Not vacuous: the owner hears B.
      expect(await until(() => owner.frames.some((f) => /canary/i.test(f)), 8000)).toBe(true);
      await Bun.sleep(500);
      const heard = [...shell.frames, ...hmr.frames].flatMap((f) => markers(f, cell));
      expect(heard).toEqual([]);
    } finally {
      shell.close();
      hmr.close();
      owner.close();
    }
  }, 30000);
});

// S9.12b — the capture origin exists only on a desktop (a cell has no capture listener), so it
// gets its own fixture: a hub-linked desktop whose stored claim (hubs.json, re-read per
// request) is the owner's while the not-vacuous pass runs, then A-only for the sweep.
describe('the capture origin (desktop fixture)', () => {
  let desk: GateCell;
  beforeAll(async () => {
    desk = await bootGateCell({ desktop: true });
  }, 60000);
  afterAll(async () => {
    await desk?.stop();
  });

  test('not vacuous: the owner’s capture origin serves B', async () => {
    expect(desk.captureBase).toMatch(/^http:\/\/localhost:\d+$/);
    desk.setDesktopClaim?.({ v: 1, role: 'owner' });
    const r = await sweep(desk, {}, captureProbes(desk));
    expect(Object.keys(r.leaks).length).toBeGreaterThan(0);
  }, 600000);

  test('as A-only, no capture-origin route answers B, and B answers like a missing canvas', async () => {
    desk.setDesktopClaim?.(A_ONLY_CLAIM);
    const r = await sweep(desk, {}, captureProbes(desk));
    expect({ leaks: r.leaks, oracles: Object.keys(r.oracles) }).toEqual({ leaks: {}, oracles: [] });
  }, 600000);
});
