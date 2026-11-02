// p8-e2e-fix-r12 §1 — the local home's superseded write notes record only a chain that ends on the disk.
//
// Two studio writes said before one watcher read are two `edit`s (p8-e2e-fix-r12-photo-undo.test.ts). A write's note
// that the watcher simply never consumed — an outside write landed on top of it before the read — must not come back
// as an edit when a later studio write supersedes it (r12 pass f1, edit-components: ⌘Z after a variant swap put back
// the bytes of an earlier write instead of the file as it was). A superseded write counts only when its bytes are
// exactly what the next write replaced (`base`), back to what the store holds.

import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const REL = 'ui/k.tsx';
const REPO_REL = `.design/${REL}`;
const canvas = (title: string) => `import { DCArtboard } from '@maude/canvas-lib';

export default function K() {
  return (
    <DCArtboard id="p" width={100} height={100}>
      <h1>${title}</h1>
    </DCArtboard>
  );
}
`;

async function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-r12-notes-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const abs = path.join(designRoot, REL);
  writeFileSync(abs, canvas('Original'));
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
  const read = () => (existsSync(abs) ? readFileSync(abs, 'utf8') : '');
  /** what routes/edit.ts does: say the write (with the bytes it replaces), then land it — no watcher read */
  const studio = (text: string, label: string) => {
    h.noteWritten(REL, text, label, { early: true, base: read() });
    writeFileSync(abs, text);
  };
  const outside = (text: string) => writeFileSync(abs, text);
  const read1 = async () => {
    h.observe(REL);
    await h.flush();
  };
  const edits = async () =>
    (await h.runtime.acceptedHistory({ path: REPO_REL, limit: 50, mine: true })).filter(
      (r: { kind: string }) => r.kind === 'edit'
    ) as { actionId: string; label: string }[];
  return { h, read, studio, outside, read1, edits };
}

describe('superseded studio writes', () => {
  test('a write and the one that takes it back, in one read: two edits, ⌘Z steps through both', async () => {
    const t = await setup();
    t.studio(canvas('Mono'), 'Look');
    t.studio(canvas('Original'), 'Reset');
    await t.read1();
    const rows = await t.edits();
    expect(rows.map((r) => r.label)).toEqual(['Reset', 'Look']);
    expect((await t.h.runtime.acceptedUndo(rows[0].actionId, false, { via: 'keys' })).status).toBe(
      'accepted'
    );
    expect(t.read()).toBe(canvas('Mono'));
  });

  test('a note an outside write landed on (read as outside), then a studio write: one edit, and ⌘Z gives the outside bytes back', async () => {
    const t = await setup();
    t.studio(canvas('Earlier'), 'Earlier edit');
    t.outside(canvas('Fixture'));
    await t.read1(); // the watcher reads the fixture (an outside row); the earlier note is never consumed
    t.studio(canvas('Swap'), 'Swap');
    await t.read1();
    const rows = await t.edits();
    expect(rows.map((r) => r.label)).toEqual(['Swap']);
    expect((await t.h.runtime.acceptedUndo(rows[0].actionId, false, { via: 'keys' })).status).toBe(
      'accepted'
    );
    expect(t.read()).toBe(canvas('Fixture'));
  });

  test('a superseded write said without its base is not replayed (the old one-slot behaviour)', async () => {
    const t = await setup();
    t.h.noteWritten(REL, canvas('A'), 'A'); // api.ts's source-written carries no base
    t.outside(canvas('A'));
    t.studio(canvas('B'), 'B');
    await t.read1();
    expect((await t.edits()).map((r) => r.label)).toEqual(['B']);
  });
});
