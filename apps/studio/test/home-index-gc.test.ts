// p8-port-gc — index GC (V2-1.17 §5.6, Michal 2026-10-29).
//
// `projects/<pid>/` goes when the pid is NOT in the app registry and either was not opened for 30 days or its
// project root is gone. A registered pid is never deleted — a registered gone root keeps its snapshot so Home can
// say "isn't where it was". Only `<index>/projects/<pid>/` directories are ever removed: never a symlink, never a
// path outside the index. The registry comes from Rust over the internal bearer route, never from a page.
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  applyIndexGc,
  GC_MAX_AGE_MS,
  indexGcRequest,
  planIndexGc,
  runIndexGc,
} from '../home/index-gc.ts';
import { homeRouteTable } from '../home/routes.ts';
import { homeDeps } from './_home-fixtures.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
let tmp: string;
let index: string;
let liveRoot: string;

const pid = (n: number) => `l${n.toString(16).padStart(16, '0')}`;

/** Seed `projects/<pid>/` with an index.json naming `root`, every file and the dir aged to `ageMs`. */
function seed(p: string, root: string | null, ageMs: number) {
  const dir = path.join(index, 'projects', p);
  mkdirSync(dir, { recursive: true });
  const at = NOW - ageMs;
  const snap = root === null ? null : { pid: p, project: { root }, writer: { at } };
  if (snap) writeFileSync(path.join(dir, 'index.json'), JSON.stringify(snap));
  writeFileSync(path.join(dir, 'frame-cap.key'), 'k');
  for (const f of ['index.json', 'frame-cap.key'])
    if (existsSync(path.join(dir, f))) utimesSync(path.join(dir, f), at / 1000, at / 1000);
  utimesSync(dir, at / 1000, at / 1000);
  return dir;
}

const reg = (pids: string[] = [], roots: string[] = []) => ({
  pids: new Set(pids),
  roots: new Set(roots),
});

beforeEach(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'maude-index-gc-'));
  index = path.join(tmp, 'index');
  liveRoot = path.join(tmp, 'live-project');
  mkdirSync(liveRoot, { recursive: true });
  mkdirSync(path.join(index, 'projects'), { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe('planIndexGc — the §5.6 rule', () => {
  test('an unregistered pid not opened for 30 days is deleted', () => {
    const dir = seed(pid(1), liveRoot, GC_MAX_AGE_MS + DAY);
    const plan = planIndexGc(index, reg(), NOW);
    expect(plan.candidates.map((c) => [c.pid, c.reason])).toEqual([[pid(1), 'stale']]);
    expect(runIndexGc(index, reg(), NOW).removed).toBe(1);
    expect(existsSync(dir)).toBe(false);
  });

  test('an unregistered pid whose root is gone is deleted, however recent', () => {
    const dir = seed(pid(2), path.join(tmp, 'moved-away'), DAY);
    const plan = planIndexGc(index, reg(), NOW);
    expect(plan.candidates.map((c) => [c.pid, c.reason])).toEqual([[pid(2), 'gone']]);
    runIndexGc(index, reg(), NOW);
    expect(existsSync(dir)).toBe(false);
  });

  test('a registered pid is never deleted — not when old, not when its root is gone', () => {
    const old = seed(pid(3), liveRoot, 400 * DAY);
    const gone = seed(pid(4), path.join(tmp, 'gone'), 400 * DAY);
    const r = runIndexGc(index, reg([pid(3), pid(4)]), NOW);
    expect(r.removed).toBe(0);
    expect(existsSync(old) && existsSync(gone)).toBe(true);
  });

  test('a snapshot naming a registered root is kept even under another pid', () => {
    const dir = seed(pid(5), liveRoot, 400 * DAY);
    expect(runIndexGc(index, reg([], [liveRoot]), NOW).removed).toBe(0);
    expect(existsSync(dir)).toBe(true);
  });

  test('a recently opened unregistered pid (within 30 days) is kept', () => {
    const dir = seed(pid(6), liveRoot, GC_MAX_AGE_MS - DAY);
    expect(planIndexGc(index, reg(), NOW).candidates).toEqual([]);
    runIndexGc(index, reg(), NOW);
    expect(existsSync(dir)).toBe(true);
  });

  test('a fresh file inside an old dir counts as opened', () => {
    const dir = seed(pid(7), liveRoot, 400 * DAY);
    writeFileSync(path.join(dir, 'history-refs.json'), '{}'); // written now
    expect(planIndexGc(index, reg(), NOW).candidates).toEqual([]);
  });

  test('a snapshot-less dir follows the 30-day rule alone', () => {
    seed(pid(8), null, 400 * DAY);
    seed(pid(9), null, DAY);
    expect(planIndexGc(index, reg(), NOW).candidates.map((c) => [c.pid, c.reason])).toEqual([
      [pid(8), 'stale'],
    ]);
  });

  test('a symlink, a non-pid name and a stray file are never candidates', () => {
    const outside = path.join(tmp, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'keep.txt'), 'x');
    symlinkSync(outside, path.join(index, 'projects', pid(10)));
    mkdirSync(path.join(index, 'projects', 'not-a-pid'));
    writeFileSync(path.join(index, 'projects', pid(11)), 'file');
    const r = runIndexGc(index, reg(), NOW + 400 * DAY);
    expect(r.removed).toBe(0);
    expect(existsSync(path.join(outside, 'keep.txt'))).toBe(true);
    expect(existsSync(path.join(index, 'projects', 'not-a-pid'))).toBe(true);
  });
});

describe('applyIndexGc — refuses anything but <index>/projects/<pid>/', () => {
  test('a path outside the index is refused, and nothing is deleted', () => {
    const outside = path.join(tmp, 'outside', pid(12));
    mkdirSync(outside, { recursive: true });
    const inside = seed(pid(13), liveRoot, 400 * DAY);
    for (const dir of [
      outside,
      path.join(index, 'projects', '..', pid(12)),
      path.join(index, 'projects'),
    ])
      expect(() =>
        applyIndexGc(
          index,
          [
            { pid: pid(13), dir: inside, reason: 'stale' },
            { pid: pid(12), dir, reason: 'stale' },
          ],
          reg()
        )
      ).toThrow(/refusing/);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(inside)).toBe(true);
  });

  test('a registered pid handed to apply is refused', () => {
    const dir = seed(pid(14), liveRoot, 400 * DAY);
    expect(() =>
      applyIndexGc(index, [{ pid: pid(14), dir, reason: 'stale' }], reg([pid(14)]))
    ).toThrow(/refusing/);
    expect(existsSync(dir)).toBe(true);
  });

  test('a projects/ dir that is itself a symlink is refused', () => {
    const real = path.join(tmp, 'elsewhere');
    mkdirSync(path.join(real, pid(15)), { recursive: true });
    const index2 = path.join(tmp, 'index2');
    mkdirSync(index2);
    symlinkSync(real, path.join(index2, 'projects'));
    expect(() => runIndexGc(index2, reg(), NOW + 400 * DAY)).toThrow(/refusing/);
    expect(existsSync(path.join(real, pid(15)))).toBe(true);
  });
});

describe('POST /_home/internal/index-gc — the registry comes from Rust', () => {
  test('is an internal (bearer) row, never a page row', () => {
    const row = homeRouteTable(homeDeps()).find((r) => r.path === '/_home/internal/index-gc');
    expect(row?.method).toBe('POST');
    expect(row?.kind).toBe('internal');
  });

  test('a body without a pid list runs nothing (400); a bad pid is refused', async () => {
    const row = homeRouteTable(homeDeps()).find((r) => r.path === '/_home/internal/index-gc');
    if (!row) throw new Error('no index-gc row');
    const call = (body: unknown) =>
      row.handle(
        new Request('http://127.0.0.1/_home/internal/index-gc', {
          method: 'POST',
          body: JSON.stringify(body),
        }),
        new URL('http://127.0.0.1/_home/internal/index-gc')
      );
    expect((await call({})).status).toBe(400);
    expect((await call({ pids: 'l0' })).status).toBe(400);
    expect((await call({ pids: ['../etc'] })).status).toBe(400);
    expect((await call({ pids: [pid(1)], roots: ['relative/root'] })).status).toBe(400);
  });

  test('a valid body runs the GC with exactly the pids and roots Rust sent', () => {
    const kept = seed(pid(20), liveRoot, 400 * DAY);
    const goes = seed(pid(21), liveRoot, 400 * DAY);
    const r = indexGcRequest({ pids: [pid(20)], roots: [] }, index);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ removed: 1, byReason: { stale: 1, gone: 0 } });
    expect([existsSync(kept), existsSync(goes)]).toEqual([true, false]);
  });
});
