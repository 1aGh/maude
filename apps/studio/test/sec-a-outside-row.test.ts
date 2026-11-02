// sec-a L1 (wave-A defender) — the S4.18 "same state is no action" rule could erase a passing outside
// board write from history: a write the store never saw, overwritten by a stale room PUT that lands
// back on the head, left no row. Now the catch-up `outside` row is kept (and the return to the head is
// `outside` too, never the person's edit), while the S4.18 replay — whose base the store already
// holds — stays no action (test/s4-18-move-rider-one-undo.test.ts keeps the one-⌘Z rule).

import { afterAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { serializeBoard } from '../annotations/schema.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const REL = 'ui/k.tsx';
const SLUG = 'ui-k';
const board = (text: string) =>
  serializeBoard([
    { id: 's1', type: 'sticky', index: 'a0', x: 0, y: 10, w: 200, h: 120, text },
  ] as never);

test('a passing outside board write overwritten by a stale PUT keeps its outside row', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-sec-a-l1-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  writeFileSync(
    path.join(designRoot, REL),
    `import { DCArtboard } from '@maude/canvas-lib';\nexport default () => <DCArtboard id="p" width={100} height={100} />;\n`
  );
  writeFileSync(path.join(designRoot, `${SLUG}.annotations.json`), board('mine'));
  const h = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_mac_one', name: 'Mac one' },
    bootId: 'boot-1',
    lockRetryMs: 0,
    settleMs: 5,
    aiSettleMs: 0,
    log: { warn() {}, error() {} },
  });
  homes.push(h);
  await h.ready();
  h.runtime.proposeLane?.(SLUG, 'annotations', board('mine'), { baseText: board('mine') });
  await h.flush();
  const q = { path: `.design/${REL}`, limit: 50 };
  const outsideBefore = (await h.runtime.acceptedHistory({ ...q, kind: 'outside' })).length;
  const mineBefore = (await h.runtime.acceptedHistory({ ...q, mine: true, kind: 'edit' })).length;

  // An outside write the store never saw (a planted / synced board), then a stale room PUT that puts
  // the head's board back with the outside write as its base.
  const planted = board('planted by someone else');
  h.runtime.proposeLane?.(SLUG, 'annotations', board('mine'), { baseText: planted });
  await h.flush();

  const outside = await h.runtime.acceptedHistory({ ...q, kind: 'outside' });
  expect(outside.length).toBeGreaterThan(outsideBefore);
  const versions = await Promise.all(
    outside.map((r) => h.runtime.acceptedVersion(`.design/${REL}`, r.revision, 'annotations'))
  );
  expect(versions.some((v) => v === planted)).toBe(true);
  // never the person's edit: their ⌘Z stack is what it was
  expect((await h.runtime.acceptedHistory({ ...q, mine: true, kind: 'edit' })).length).toBe(
    mineBefore
  );
});
