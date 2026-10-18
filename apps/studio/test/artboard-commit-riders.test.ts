// S2.9b — commit riders on the DragStateBus (contract client/v2/contracts/S2-S4-artboard-motion-ids.md
// §2): every artboard-position commit from the canvas — drag, nudge, align, distribute, Tidy — goes
// through `commitPositions`, which mints ONE undoGroup, asks every rider synchronously, and turns the
// layout + the riders' ops into ONE `PATCH /_api/canvas-meta` carrying `annotations`. The DDR-050
// record keeps the inverse ops, so a legacy link's ⌘Z puts the sticky back with the artboard.
// Resize and the ⌥-drag duplicate carry no riders; a click without movement asks nobody.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Op } from '../annotations/ops.ts';
import { buildMoveArtboardsRecord, type LayoutRider } from '../commands/move-artboards-command.ts';
import {
  type CommitRiderPayload,
  canvasMetaBody,
  createDragBusCore,
  invertRiderOp,
  type LayoutRect,
  type MovedArtboard,
} from '../drag-bus.ts';
import { arrangeArtboards, tidyBoards } from '../editing/arrange.ts';
import { rebuildCommand } from '../undo-stack.ts';

const ROOT = join(import.meta.dir, '..');
const LAYOUT: LayoutRect[] = [
  { id: 'desktop', x: 0, y: 0, w: 640, h: 480 },
  { id: 'tablet', x: 900, y: 60, w: 768, h: 1024 },
  { id: 'mobile', x: 2000, y: 0, w: 390, h: 844 },
];
const STICKY = { id: 's_hero', parentArtboard: 'desktop', x: 100, y: 120 };

/** S4.10's rider, reduced to one member: move the sticky with its artboard. */
const stickyRider = (moved: MovedArtboard[]): Op[] | null => {
  const m = moved.find((a) => a.id === STICKY.parentArtboard);
  return m
    ? [
        {
          op: 'patch',
          id: STICKY.id,
          set: { x: STICKY.x + m.dx, y: STICKY.y + m.dy },
          expect: { x: STICKY.x, y: STICKY.y },
        },
      ]
    : null;
};

function harness() {
  const calls: Array<{ moved: MovedArtboard[]; undoGroup: string }> = [];
  const commits: Array<{
    after: LayoutRect[];
    before: LayoutRect[];
    label?: string;
    rider?: CommitRiderPayload;
  }> = [];
  const bus = createDragBusCore({
    layout: () => LAYOUT,
    commit: (after, before, opts) => void commits.push({ after, before, ...opts }),
    warn: () => {},
  });
  bus.onCommit((moved, undoGroup) => {
    calls.push({ moved, undoGroup });
    return stickyRider(moved);
  });
  return { bus, calls, commits };
}

describe('commit riders', () => {
  test('a drag commit asks every rider once, with the final positions + deltas and one undoGroup', () => {
    const { bus, calls, commits } = harness();
    const second: string[] = [];
    bus.onCommit((_m, g) => {
      second.push(g);
      return null;
    });
    bus.commitPositions([{ id: 'desktop', x: 300, y: 40 }]);
    expect(calls).toEqual([
      {
        moved: [{ id: 'desktop', x: 300, y: 40, dx: 300, dy: 40 }],
        undoGroup: calls[0]?.undoGroup as string,
      },
    ]);
    expect(calls[0]?.undoGroup).toMatch(/^ab-move-[a-z0-9]{10}$/);
    expect(second).toEqual([calls[0]?.undoGroup as string]);
    expect(commits.length).toBe(1);
    expect(commits[0]?.rider?.undoGroup).toBe(calls[0]?.undoGroup as string);
    expect(commits[0]?.rider?.ops).toEqual(
      stickyRider([{ id: 'desktop', x: 300, y: 40, dx: 300, dy: 40 }]) as Op[]
    );
    expect(commits[0]?.rider?.inverse).toEqual([
      {
        op: 'patch',
        id: 's_hero',
        set: { x: 100, y: 120 },
        expect: { x: 400, y: 160 },
        strict: true,
      },
    ]);
  });

  test('a caller’s undoGroup is kept; a malformed one is replaced', () => {
    const { bus, calls } = harness();
    bus.commitPositions([{ id: 'desktop', x: 1, y: 0 }], { undoGroup: 'tidy-42' });
    bus.commitPositions([{ id: 'desktop', x: 2, y: 0 }], { undoGroup: 'not ok!' });
    expect(calls.map((c) => c.undoGroup)).toEqual(['tidy-42', expect.stringMatching(/^ab-move-/)]);
  });

  test('align, distribute and Tidy go through the same door (riders run, one commit each)', () => {
    const { bus, calls, commits } = harness();
    expect(arrangeArtboards('align.top', LAYOUT, bus)).toBe(true);
    expect(arrangeArtboards('distribute.h', LAYOUT, bus)).toBe(true);
    expect(tidyBoards(LAYOUT, bus)).toBe(true);
    expect(calls.length).toBe(3);
    expect(commits.length).toBe(3);
    expect(commits.every((c) => typeof c.label === 'string')).toBe(true);
  });

  test('the keyboard nudge and the drag drop name the door; resize and ⌥-drag skip the riders', () => {
    const nudge = readFileSync(join(ROOT, 'use-keyboard-discipline.tsx'), 'utf8');
    expect(nudge).toContain('dragBus.commitPositions(moved);');
    const lib = readFileSync(join(ROOT, 'canvas-lib.tsx'), 'utf8');
    // S2.10 — the drop goes through routeDrop (editing/duplicate-rhythm.ts): ⌥ commits the moved
    // boards without riders (the copy is placed, not moved), a plain drop commits with them.
    expect(lib).toContain('routeDrop(alt, moved, window, (m, o) => dragBus.commitPositions(m, o))');
    const rhythm = readFileSync(join(ROOT, 'editing', 'duplicate-rhythm.ts'), 'utf8');
    expect(rhythm).toContain('commit(moved, { riders: false });');
    expect(rhythm).toContain('commit(moved);');
    const resize = readFileSync(join(ROOT, 'editing', 'artboard-handles.tsx'), 'utf8');
    expect(resize).toContain("{ label: 'resize artboard', riders: false }");
    // Nothing else in the canvas runtime writes the layout lane on its own.
    expect(lib.match(/fetch\('\/_api\/canvas-meta'/g)?.length).toBe(1);

    const { bus, calls, commits } = harness();
    bus.commitPositions([{ id: 'desktop', x: 10, y: 0 }], { riders: false });
    expect(calls).toEqual([]);
    expect(commits[0]?.rider).toBeUndefined();
  });

  test('a click without movement commits nothing and asks no rider', () => {
    const { bus, calls, commits } = harness();
    bus.commitPositions([{ id: 'desktop', x: 0, y: 0 }]);
    expect(calls).toEqual([]);
    expect(commits).toEqual([]);
  });

  test('a rider whose ops cannot ride (no expect, a put) is dropped; a throwing rider does not stop the commit', () => {
    const { bus, commits } = harness();
    bus.onCommit(() => [{ op: 'patch', id: 'x', set: { x: 1 } }]);
    bus.onCommit(() => {
      throw new Error('boom');
    });
    bus.commitPositions([{ id: 'desktop', x: 300, y: 40 }]);
    expect(commits[0]?.rider?.ops.map((o) => ('id' in o ? o.id : null))).toEqual(['s_hero']);
    expect(invertRiderOp({ op: 'put', el: { id: 'n', type: 'sticky' } as never })).toBeNull();
  });

  test('the commit is ONE PATCH carrying annotations; ⌘Z replays the inverse under a fresh id', async () => {
    const { bus, commits } = harness();
    bus.commitPositions([{ id: 'desktop', x: 300, y: 40 }], { label: 'move 1 artboard' });
    const c = commits[0] as (typeof commits)[number];
    const record = buildMoveArtboardsRecord({
      before: c.before,
      after: c.after,
      label: c.label,
      rider: c.rider,
    });
    const writes: Array<{ layout: { id: string; x: number; y: number }[]; rider?: LayoutRider }> =
      [];
    const cmd = rebuildCommand(record, {
      layoutPatchFn: (layout: { id: string; x: number; y: number }[], rider?: LayoutRider) =>
        void writes.push({ layout, ...(rider ? { rider } : {}) }),
    });
    await cmd?.do();
    expect(writes.length).toBe(1);
    expect(writes[0]?.rider).toEqual({
      ops: c.rider?.ops as Op[],
      actionId: c.rider?.undoGroup as string,
      label: 'move 1 artboard',
    });
    const body = canvasMetaBody(
      '.design/ui/card.tsx',
      { layout: { artboards: writes[0]?.layout } },
      writes[0]?.rider
    );
    expect(body).toMatchObject({
      file: '.design/ui/card.tsx',
      patch: { layout: { artboards: expect.any(Array) } },
      annotations: { ops: c.rider?.ops, actionId: c.rider?.undoGroup, label: 'move 1 artboard' },
    });
    await cmd?.undo();
    expect(writes[1]?.layout.find((r) => r.id === 'desktop')).toMatchObject({ x: 0, y: 0 });
    expect(writes[1]?.rider?.ops).toEqual(c.rider?.inverse as Op[]);
    expect(writes[1]?.rider?.actionId).not.toBe(c.rider?.undoGroup);
    // A layout with no riders sends no annotations key at all (a v1 server sees today's body).
    expect(canvasMetaBody('f', { layout: {} })).toEqual({ file: 'f', patch: { layout: {} } });
  });
});
