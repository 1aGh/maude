// S4.18 (an-follow) — an artboard move and the stickies riding with it are ONE ⌘Z (contract
// S2-S4-artboard-motion-ids §2, V2-1.5 / S4 Q3). The rider records both lanes as one action
// (`proposeLanes`); the live collab room then projects the same board a beat later, with the board
// the disk still held as its base. That projection used to record a catch-up `outside` plus a second
// "Edit annotations" of the same stickies — so the first ⌘Z took back only the stickies and the
// artboard stayed moved. A stroke that leaves the store's head as it is is no action, whatever base
// it names.
//
// A real in-process local kernel over `bun:sqlite` in a temp project (local-kernel-studio-lanes'
// recipe).

import { afterAll, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const BOARD_REL = `${SLUG}.annotations.json`;
const META_REL = 'ui/k.meta.json';
const canvas = `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <DCArtboard id="p" width={100} height={100}>
      <h1>P</h1>
    </DCArtboard>
  );
}
`;
const meta = (x: number) =>
  `${JSON.stringify({ layout: { artboards: [{ id: 'p', x, y: 0 }] } }, null, 2)}\n`;
const board = (x: number) =>
  serializeBoard([
    {
      id: 's1',
      type: 'sticky',
      index: 'a0',
      x,
      y: 10,
      w: 200,
      h: 120,
      text: 's1',
      parentArtboard: 'p',
    },
  ] as never);

test('a moved artboard and its riding sticky come back with one ⌘Z, even after the room repeats the board', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-s4-18-rider-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = (rel: string) => path.join(designRoot, rel);
  const read = (rel: string) => (existsSync(file(rel)) ? readFileSync(file(rel), 'utf8') : null);
  writeFileSync(file(REL), canvas);
  writeFileSync(file(META_REL), meta(0));
  writeFileSync(file(BOARD_REL), board(10));

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
  // Put the board on the record first (a stroke), so the move has a known base.
  h.runtime.proposeLane?.(SLUG, 'annotations', board(10), { baseText: board(10) });
  await h.flush();

  // The rider (api.ts moveArtboardsWithRider, local home): meta lands on disk, the room holds the board
  // (applyAnnotationOpsLive — nothing written to the board file yet), then ONE two-lane proposal.
  writeFileSync(file(META_REL), meta(240));
  const moved = await h.runtime.proposeLanes(
    SLUG,
    [
      { lane: 'meta', text: meta(240), baseText: meta(0) },
      { lane: 'annotations', text: board(250), baseText: board(10) },
    ],
    { kind: 'edit', label: 'move 1 artboard' }
  );
  expect(moved.status).toBe('accepted');
  // The room's projection a beat later: same board, base = what the disk still holds (the old board).
  h.runtime.proposeLane?.(SLUG, 'annotations', board(250), { baseText: read(BOARD_REL) as string });
  writeFileSync(file(BOARD_REL), board(250));
  await h.flush();

  const rows = await h.runtime.acceptedHistory({ path: `.design/${REL}`, limit: 50, mine: true });
  const top = rows[0];
  expect(top.label).toBe('move 1 artboard');
  const u = await h.runtime.acceptedUndo(top.actionId, false, { via: 'keys' });
  expect(u.status).toBe('accepted');
  expect(JSON.parse(read(META_REL) as string).layout.artboards[0].x).toBe(0);
  expect(read(BOARD_REL)).toBe(board(10));
});
