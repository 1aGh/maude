// S9.10 — V2-1.16 L9: usage and design systems, over the V2-1.17 project index.
//
// A and B both render with the `shared` DS. The A-only usage of `shared` reads 1, never 2
// (U5: aggregates count only what the session sees); counts, stamp and `writer.seq` are
// derived from the visible rows, so an edit on B neither shows nor moves them; ⌘K search
// finds nothing on B or C.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ProjectIndexSnapshot, SearchResult } from '../index/types.ts';
import {
  A_ONLY,
  B,
  bootCanaryCell,
  type Cell,
  canaries,
  get,
  OWNER,
} from './_acl-canvas-fixture.ts';

let cell: Cell;
beforeAll(async () => {
  cell = await bootCanaryCell();
}, 60000);
afterAll(async () => {
  await cell?.stop();
});

const usage = (s: ProjectIndexSnapshot, ds: string) =>
  s.canvases.filter((c) => c.ds === ds && c.kind !== 'specimen').length;

describe('L9 — the project index (usage, ⌘K)', () => {
  test('A-only usage of the shared DS is 1; the owner sees 2', async () => {
    const owner = (await get(cell, '/_api/index', OWNER)).json as ProjectIndexSnapshot;
    expect(usage(owner, 'shared')).toBe(2);
    const r = await get(cell, '/_api/index', A_ONLY);
    expect(r.status).toBe(200);
    expect(canaries(r.text)).toEqual([]);
    const snap = r.json as ProjectIndexSnapshot;
    expect(usage(snap, 'shared')).toBe(1);
    expect(snap.canvases.map((c) => c.rel)).toEqual(['ui/a.tsx']);
    expect(snap.counts.canvases).toBe(1);
    expect(snap.counts.artboards).toBe(snap.canvases[0]?.artboards.length ?? 0);
    expect(snap.stamp.files).toBe(1);
    expect(snap.access.scope).toBe('canvas');
    expect(snap.project.linkedHub).toBeNull();
  });

  test('an edit on B does not move the A-only freshness seq', async () => {
    const before = (await get(cell, '/_api/index', A_ONLY)).json as ProjectIndexSnapshot;
    const ownerBefore = (await get(cell, '/_api/index', OWNER)).json as ProjectIndexSnapshot;
    writeFileSync(
      join(cell.root, B),
      'export default function C() { return <div data-dc-screen="canary-moved">x</div>; }\n'
    );
    let ownerAfter = ownerBefore;
    for (let i = 0; i < 40 && ownerAfter.writer.seq === ownerBefore.writer.seq; i++) {
      await Bun.sleep(100);
      ownerAfter = (await get(cell, '/_api/index', OWNER)).json as ProjectIndexSnapshot;
    }
    expect(ownerAfter.writer.seq).not.toBe(ownerBefore.writer.seq);
    const after = await get(cell, `/_api/index?since=${before.writer.seq}`, A_ONLY);
    expect(after.json).toEqual({ unchanged: true, seq: before.writer.seq });
  });

  test('search: nothing on B or C for A-only; the owner finds them', async () => {
    const owner = (await get(cell, '/_api/index?q=canary', OWNER)).json as SearchResult;
    expect(owner.rows.length).toBeGreaterThan(0);
    const r = await get(cell, '/_api/index?q=canary', A_ONLY);
    expect(r.status).toBe(200);
    const res = r.json as SearchResult;
    expect(res.rows).toEqual([]);
    expect(res.closeOnly).toBe(false);
    expect(canaries(r.text.replace('"q":"canary"', ''))).toEqual([]);
  });
});
