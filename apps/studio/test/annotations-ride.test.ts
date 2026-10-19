// S4.10 — annotations ride with their artboard (S4 Q3; contract
// client/v2/contracts/S2-S4-artboard-motion-ids.md §2). An artboard move and the moves of its
// members are ONE commit: the bus mints one undoGroup, the layer's rider returns ONE op batch
// (members' x/y — a marker's points — and the bound arrows' cached ends + host box), and the
// legacy ⌘Z inverts the whole batch with the layout. A locked member follows; a section carries
// its items whatever their own parentArtboard says ("section wins"); a loose note stays. The
// batch passes the server's move-delta rule as is, and a v1 reader sees the members at their new
// WORLD positions.

import { describe, expect, test } from 'bun:test';

import { applyOps } from '../annotations/ops.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  hostBoxesAfter,
  membershipFor,
  riderOps,
  rideSetFor,
  withMembership,
} from '../annotations/ui/ride.ts';
import { elementsToStrokes } from '../annotations/v1-adapter.ts';
import {
  type CommitRiderPayload,
  canvasMetaBody,
  createDragBusCore,
  type LayoutRect,
} from '../drag-bus.ts';
import { positionsOf, riderRefusal } from '../routes/canvas-meta-rider.ts';

const LAYOUT: LayoutRect[] = [
  { id: 'desktop', x: 0, y: 0, w: 1440, h: 900 },
  { id: 'mobile', x: 1600, y: 0, w: 390, h: 844 },
];

const el = (o: Record<string, unknown>): AnnotationElement =>
  ({ index: 'a0', ...o }) as AnnotationElement;

const BOARD: AnnotationElement[] = [
  // Members of Desktop.
  el({ id: 'sun', type: 'sticky', x: 300, y: 20, w: 160, h: 160, parentArtboard: 'desktop' }),
  el({
    id: 'pin',
    type: 'sticky',
    x: 500,
    y: 40,
    w: 160,
    h: 160,
    parentArtboard: 'desktop',
    locked: true,
  }),
  el({
    id: 'loop',
    type: 'pen',
    points: [100, 100, 140, 120, 120, 160],
    parentArtboard: 'desktop',
  }),
  // A section on Desktop and an item inside it that claims Mobile: the section wins.
  el({ id: 'sec', type: 'section', x: 700, y: 300, w: 400, h: 300, parentArtboard: 'desktop' }),
  el({
    id: 'inner',
    type: 'sticky',
    parent: 'sec',
    x: 20,
    y: 40,
    w: 160,
    h: 160,
    parentArtboard: 'mobile',
  }),
  // A loose note on the empty canvas.
  el({ id: 'note', type: 'sticky', x: 40, y: 1200, w: 200, h: 120 }),
  // Tereza's arrow: from the loose note to Desktop's button (a canvas host).
  el({
    id: 'arw',
    type: 'arrow',
    start: { x: 140, y: 1200 },
    end: { x: 640, y: 812 },
    endHost: {
      ref: 'el:desktop/cta',
      label: 'See the work',
      box: { x: 600, y: 760, w: 120, h: 40 },
    },
    line: 'elbow',
  }),
];

const MOVE = [{ id: 'desktop', x: 2200, y: 300, dx: 2200, dy: 300 }];

function harness(board: AnnotationElement[] = BOARD) {
  const commits: Array<{ after: LayoutRect[]; before: LayoutRect[]; rider?: CommitRiderPayload }> =
    [];
  const groups: string[] = [];
  const bus = createDragBusCore({
    layout: () => LAYOUT,
    commit: (after, before, opts) => void commits.push({ after, before, ...opts }),
    warn: () => {},
  });
  bus.onCommit((moved, undoGroup) => {
    groups.push(undoGroup);
    return riderOps(board, moved, hostBoxesAfter(LAYOUT, moved));
  });
  return { bus, commits, groups };
}

const opFor = (ops: readonly { id?: string }[] | undefined, id: string) =>
  ops?.find((o) => o.id === id) as
    | { set: Record<string, unknown>; expect: Record<string, unknown> }
    | undefined;

describe('the commit is one op batch in the same undo group', () => {
  test('one commit, one rider batch, carried under the bus undoGroup', () => {
    const { bus, commits, groups } = harness();
    bus.commitPositions([{ id: 'desktop', x: 2200, y: 300 }], { undoGroup: 'ab-move-test123456' });
    expect(commits).toHaveLength(1);
    expect(groups).toEqual(['ab-move-test123456']);
    const rider = commits[0]?.rider as CommitRiderPayload;
    expect(rider.undoGroup).toBe('ab-move-test123456');
    expect(rider.ops.map((o) => (o as { id: string }).id).sort()).toEqual(
      ['arw', 'loop', 'pin', 'sec', 'sun'].sort()
    );
    // The wire body: ONE PATCH carrying the batch under the same action id.
    const body = canvasMetaBody(
      'ui/x.tsx',
      { layout: { artboards: [] } },
      {
        ops: rider.ops,
        actionId: rider.undoGroup,
      }
    ) as { annotations: { ops: unknown[]; actionId: string } };
    expect(body.annotations.actionId).toBe('ab-move-test123456');
    expect(body.annotations.ops).toHaveLength(5);
  });

  test('members shift by exactly the delta; every field carries expect', () => {
    const ops = riderOps(BOARD, MOVE, hostBoxesAfter(LAYOUT, MOVE)) ?? [];
    expect(opFor(ops, 'sun')).toMatchObject({
      set: { x: 2500, y: 320 },
      expect: { x: 300, y: 20 },
    });
    expect(opFor(ops, 'loop')?.set.points).toEqual([2300, 400, 2340, 420, 2320, 460]);
    expect(opFor(ops, 'loop')?.expect.points).toEqual([100, 100, 140, 120, 120, 160]);
    // The bound arrow: only its host end + cached box; its loose start stays.
    const arw = opFor(ops, 'arw');
    expect(Object.keys(arw?.set ?? {}).sort()).toEqual(['end', 'endHost']);
    const host = arw?.set.endHost as { box: unknown; label: string } | undefined;
    expect(host?.box).toEqual({ x: 2800, y: 1060, w: 120, h: 40 });
    expect(host?.label).toBe('See the work');
  });

  test('the legacy ⌘Z inverse restores artboard members exactly', () => {
    const { bus, commits } = harness();
    bus.commitPositions([{ id: 'desktop', x: 2200, y: 300 }]);
    const rider = commits[0]?.rider as CommitRiderPayload;
    const start = new Map(BOARD.map((e) => [e.id, e]));
    const moved = applyOps(start, rider.ops);
    expect(moved.rejected).toHaveLength(0);
    const back = applyOps(moved.state, rider.inverse);
    expect(back.rejected).toHaveLength(0);
    for (const e of BOARD) expect(back.state.get(e.id)).toEqual(e);
    // …and the layout's undo is the same record (before/after on one commit).
    expect(commits[0]?.before.find((r) => r.id === 'desktop')).toMatchObject({ x: 0, y: 0 });
  });

  test('the server move-delta rule accepts the batch as is (marker points included)', () => {
    const ops = riderOps(BOARD, MOVE, hostBoxesAfter(LAYOUT, MOVE)) ?? [];
    const before = positionsOf({ artboards: LAYOUT });
    const after = positionsOf({
      artboards: LAYOUT.map((r) => (r.id === 'desktop' ? { ...r, x: 2200, y: 300 } : r)),
    });
    expect(riderRefusal(BOARD, ops, before, after)).toBeNull();
    // A marker shifted by a different delta is still refused.
    const bent = ops.map((o) =>
      (o as { id: string }).id === 'loop' ? { ...o, set: { points: [0, 0, 1, 1, 2, 2] } } : o
    );
    expect(riderRefusal(BOARD, bent as typeof ops, before, after)?.status).toBe(403);
  });
});

describe('who rides', () => {
  test('a locked member follows', () => {
    const ops = riderOps(BOARD, MOVE, hostBoxesAfter(LAYOUT, MOVE)) ?? [];
    expect(opFor(ops, 'pin')).toMatchObject({ set: { x: 2700, y: 340 } });
    expect(rideSetFor(BOARD, MOVE).rigid.get('pin')).toEqual({ dx: 2200, dy: 300 });
  });

  test('section wins: its items go with it, whatever their own parentArtboard says', () => {
    const ops = riderOps(BOARD, MOVE, hostBoxesAfter(LAYOUT, MOVE)) ?? [];
    expect(opFor(ops, 'sec')).toMatchObject({ set: { x: 2900, y: 600 } });
    // The item is section-relative: it moves with its section and is never patched itself…
    expect(opFor(ops, 'inner')).toBeUndefined();
    expect(rideSetFor(BOARD, MOVE).rigid.get('inner')).toEqual({ dx: 2200, dy: 300 });
    // …and moving the artboard it names does not move it out of its section.
    const mob = [{ id: 'mobile', x: 1700, y: 0, dx: 100, dy: 0 }];
    expect(opFor(riderOps(BOARD, mob, hostBoxesAfter(LAYOUT, mob)) ?? [], 'inner')).toBeUndefined();
    expect(rideSetFor(BOARD, mob).rigid.has('inner')).toBe(false);
  });

  test('a loose note stays; the arrow from it re-routes live', () => {
    const ops = riderOps(BOARD, MOVE, hostBoxesAfter(LAYOUT, MOVE)) ?? [];
    expect(opFor(ops, 'note')).toBeUndefined();
    const set = rideSetFor(BOARD, MOVE);
    expect(set.rigid.has('note')).toBe(false);
    expect(set.live).toEqual(['arw']);
  });

  test('nothing rides when no member moved', () => {
    const mob = [{ id: 'mobile', x: 1700, y: 0, dx: 100, dy: 0 }];
    const board = BOARD.filter((e) => e.id !== 'inner');
    expect(riderOps(board, mob, hostBoxesAfter(LAYOUT, mob))).toBeNull();
  });
});

describe('a v1 peer sees members at their new world positions', () => {
  test('x/y stay WORLD: the v1 projection of the moved board shows the sticky on the moved artboard', () => {
    const ops = riderOps(BOARD, MOVE, hostBoxesAfter(LAYOUT, MOVE)) ?? [];
    const after = applyOps(new Map(BOARD.map((e) => [e.id, e])), ops).state;
    const strokes = elementsToStrokes(after.values());
    const sun = strokes.find((s) => s.id === 'sun') as { x: number; y: number };
    expect(sun).toMatchObject({ x: 2500, y: 320 });
    const inner = strokes.find((s) => s.id === 'inner') as { x: number; y: number };
    expect(inner).toMatchObject({ x: 2900 + 20, y: 600 + 40 });
    const loop = strokes.find((s) => s.id === 'loop') as { points: number[][] };
    expect(loop.points[0]).toEqual([2300, 400]);
  });
});

describe('membership on create / drop (marker strokes belong to the artboard under them)', () => {
  test('a new marker over Desktop joins it; one on the empty canvas joins nothing', () => {
    const next = new Map(BOARD.map((e) => [e.id, e]));
    next.set('mk', el({ id: 'mk', type: 'pen', points: [1700, 100, 1760, 140] }));
    next.set('free', el({ id: 'free', type: 'pen', points: [100, 1500, 160, 1540] }));
    const prev = new Map(BOARD.map((e) => [e.id, e]));
    const out = withMembership(prev, next, LAYOUT);
    expect(out.get('mk')?.parentArtboard).toBe('mobile');
    expect(out.get('free')?.parentArtboard).toBeUndefined();
    // An unchanged element keeps what it had (the inner item's own claim is untouched).
    expect(out.get('inner')?.parentArtboard).toBe('mobile');
  });

  test('dropping a member on the empty canvas lets it go; nested items take none', () => {
    const prev = new Map(BOARD.map((e) => [e.id, e]));
    const next = new Map(prev);
    next.set('sun', { ...(prev.get('sun') as AnnotationElement), x: 300, y: 1400 });
    const out = withMembership(prev, next, LAYOUT);
    expect(out.get('sun')?.parentArtboard).toBeUndefined();
    expect(membershipFor(next, ['inner'], LAYOUT).has('inner')).toBe(false);
  });
});
