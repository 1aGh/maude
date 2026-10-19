// S2.14 (artboard ed-pen) — the canvas half of the Pen: the drawing arithmetic (click = sharp, drag = smooth, ⇧ 45°,
// close on the first point, ↵ / esc), what a finished path asks for (ONE edit-op), hit-testing and the live model of
// point editing, Combine's measuring, the toolbar and registry rows. The writers are test/edit-ops-pen.test.ts.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import {
  ALL_CAPS,
  MODE_TOOLS,
  pendingSlots,
  toolKeyAction,
  visibleSlots,
} from '../bridge/canvas-modes.ts';
import { parsePathD, pointType, serializePath } from '../edit-ops/path-model.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { selectionKind } from '../editing/crumbs.ts';
import { drawToolOfAction } from '../editing/draw-geometry.ts';
import { EDITING_ACTIONS } from '../editing/index.tsx';
import { COMBINE_ACTIONS, planCombine, radiusPx, runCombine } from '../editing/pen/combine-run.ts';
import { finishPen, NEEDS_TWO, planPen, targetOf } from '../editing/pen/draw.tsx';
import {
  addedAt,
  CLOSE_RADIUS,
  dragged,
  emptyDraft,
  type Frame,
  fromScreen,
  hitTest,
  isPenTool,
  landing,
  overFirst,
  penChip,
  press,
  pull,
  removed,
  toggled,
  toScreen,
  typeChip,
  undoPoint,
} from '../editing/pen/pen-geometry.ts';
import { editAsk, modelOfSvg, svgOrigin } from '../editing/pen/points.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => GlobalRegistrator.unregister());

// a canvas zoomed to 2×, its container's content corner at (100, 50) on screen
const F: Frame = { origin: { x: 100, y: 50 }, k: 2 };
const at = (x: number, y: number) => toScreen(F, { x, y });

describe('drawing: click = sharp, drag = smooth', () => {
  test('a click adds a sharp point in the container’s own px', () => {
    let d = emptyDraft();
    d = press(d, F, at(10, 20), false);
    d = { ...d, press: null };
    d = press(d, F, at(60, 20), false);
    expect(d.points).toEqual([
      { x: 10, y: 20 },
      { x: 60, y: 20 },
    ]);
  });

  test('a press that drags past the threshold pulls handles: out follows the pointer, in mirrors it', () => {
    let d = press(emptyDraft(), F, at(10, 20), false);
    d = { ...d, press: null };
    d = press(d, F, at(60, 20), false);
    d = pull(d, F, at(80, 40));
    const p = d.points[1];
    expect(p?.out).toEqual({ x: 80, y: 40 });
    expect(p?.in).toEqual({ x: 40, y: 0 });
    expect(d.press?.pulled).toBe(true);
    // under the threshold nothing is pulled
    const still = pull(press(emptyDraft(), F, at(5, 5), false), F, {
      x: at(5, 5).x + 2,
      y: at(5, 5).y,
    });
    expect(still.points[0]?.out).toBeUndefined();
  });

  test('the first point has an out handle only (an open path’s start has nothing coming in)', () => {
    const d = pull(press(emptyDraft(), F, at(10, 20), false), F, at(40, 20));
    expect(d.points[0]?.out).toEqual({ x: 40, y: 20 });
    expect(d.points[0]?.in).toBeUndefined();
  });

  test('⇧ keeps the next point to a 45° step from the last, at the same length', () => {
    const d = { ...press(emptyDraft(), F, at(0, 0), false), press: null };
    const p = landing(d, { x: 100, y: 30 }, true);
    expect(p.y).toBeCloseTo(0, 5);
    expect(p.x).toBeCloseTo(Math.hypot(100, 30), 5);
    expect(landing(d, { x: 100, y: 30 }, false)).toEqual({ x: 100, y: 30 });
    const next = press(d, F, at(100, 30), true);
    expect(next.points[1]?.y).toBeCloseTo(0, 5);
  });

  test('a press on the first point of a path of two or more closes it; before that it adds a point', () => {
    let d = { ...press(emptyDraft(), F, at(0, 0), false), press: null };
    expect(overFirst(d, F, at(0, 0))).toBe(false); // one point: nothing to close
    d = { ...press(d, F, at(50, 0), false), press: null };
    expect(overFirst(d, F, { x: at(0, 0).x + CLOSE_RADIUS, y: at(0, 0).y })).toBe(true);
    expect(overFirst(d, F, { x: at(0, 0).x + CLOSE_RADIUS + 1, y: at(0, 0).y })).toBe(false);
    const closing = press(d, F, at(1, 1), false);
    expect(closing.press?.closing).toBe(true);
    expect(closing.points).toHaveLength(2); // no third point
  });

  test('⌫ takes the last point back', () => {
    let d = { ...press(emptyDraft(), F, at(0, 0), false), press: null };
    d = { ...press(d, F, at(5, 5), false), press: null };
    expect(undoPoint(d).points).toHaveLength(1);
  });

  test('pan and zoom move nothing: the same container px at another frame', () => {
    const d = press(emptyDraft(), F, at(30, 40), false);
    const moved: Frame = { origin: { x: -20, y: 400 }, k: 0.5 };
    expect(fromScreen(moved, toScreen(moved, d.points[0] as { x: number; y: number }))).toEqual({
      x: 30,
      y: 40,
    });
  });
});

describe('planPen — what a finished path asks for', () => {
  const two = (() => {
    let d = { ...press(emptyDraft(), F, at(10, 10), false), press: null };
    d = { ...press(d, F, at(90, 10), false), press: null };
    return d;
  })();

  test('one object.insert-path with the model in container px; a static frame is pinned relative', () => {
    const plan = planPen(two, false, {
      artboard: 'desktop',
      frameRef: null,
      relativeParent: false,
    });
    expect(plan).toMatchObject({ type: 'op', label: 'Draw path' });
    if (plan.type !== 'op') throw new Error('op');
    expect(plan.ask.op).toBe('object.insert-path');
    expect(plan.ask.targets).toEqual([]);
    expect(serializePath((plan.ask.params as { path: never }).path)).toBe('M10 10L90 10');
    const closed = planPen(two, true, {
      artboard: 'desktop',
      frameRef: { artboard: 'desktop', element: 'hero' },
      relativeParent: true,
    });
    if (closed.type !== 'op') throw new Error('op');
    expect(closed.ask.targets).toEqual([{ artboard: 'desktop', element: 'hero' }]);
    expect(closed.ask.params).toMatchObject({ relativeParent: true });
    expect(serializePath((closed.ask.params as { path: never }).path)).toBe('M10 10L90 10Z');
  });

  test('one point is not a path: nothing is asked, and the line says what to do', () => {
    const one = { ...press(emptyDraft(), F, at(10, 10), false), press: null };
    expect(planPen(one, false, { artboard: 'a', frameRef: null, relativeParent: false })).toEqual({
      type: 'none',
      why: NEEDS_TWO,
    });
  });

  test('targetOf names the frame and whether it must be pinned relative', () => {
    const frame = document.createElement('div');
    frame.setAttribute('data-cd-id', 'hero');
    frame.style.position = 'static';
    const board = document.createElement('div');
    board.setAttribute('data-dc-screen', 'desktop');
    const body = document.createElement('div');
    body.className = 'dc-artboard-body';
    board.append(body);
    body.append(frame);
    document.body.append(board);
    expect(targetOf({ el: frame, artboard: 'desktop', frame: true })).toEqual({
      artboard: 'desktop',
      frameRef: { artboard: 'desktop', element: 'hero' },
      relativeParent: true,
    });
    expect(targetOf({ el: body, artboard: 'desktop', frame: false })).toEqual({
      artboard: 'desktop',
      frameRef: null,
      relativeParent: false,
    });
    board.remove();
  });
});

describe('finishPen — one write, one undo step', () => {
  const ok = (over: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
    ok: true,
    actionId: null,
    writeId: 'w1',
    rev: 'r',
    refs: [],
    created: [{ artboard: 'desktop', element: 'path' }],
    ...over,
  });
  const target = { artboard: 'desktop', frameRef: null, relativeParent: false };
  const two = (() => {
    let d = { ...press(emptyDraft(), F, at(0, 0), false), press: null };
    d = { ...press(d, F, at(50, 50), false), press: null };
    return d;
  })();

  test('runs exactly one op, records one undo step and selects what it made', async () => {
    const asks: unknown[] = [];
    const records: unknown[] = [];
    const picked: unknown[] = [];
    const made = await finishPen(two, false, target, {
      run: async (a) => {
        asks.push(a);
        return ok();
      },
      record: (r) => records.push(r),
      select: (c) => picked.push(c),
    });
    expect(made).toBe(true);
    expect(asks).toHaveLength(1);
    expect(records).toEqual([{ kind: 'edit-op', label: 'Draw path', payload: { writeId: 'w1' } }]);
    expect(picked).toEqual([[{ artboard: 'desktop', element: 'path' }]]);
  });

  test('a refusal is said in the op’s words and records nothing', async () => {
    const toasts: string[] = [];
    const records: unknown[] = [];
    const made = await finishPen(two, false, target, {
      run: async () => ({ ok: false, code: 'locked', message: 'hero is locked · ⇧⌘L unlocks' }),
      toast: (m) => toasts.push(m),
      record: (r) => records.push(r),
    });
    expect(made).toBe(false);
    expect(toasts).toEqual(['hero is locked · ⇧⌘L unlocks']);
    expect(records).toEqual([]);
  });

  test('a path of one point never reaches the writer', async () => {
    let called = 0;
    const toasts: string[] = [];
    const one = { ...press(emptyDraft(), F, at(0, 0), false), press: null };
    const made = await finishPen(one, false, target, {
      run: async () => {
        called++;
        return ok();
      },
      toast: (m) => toasts.push(m),
    });
    expect(made).toBe(false);
    expect(called).toBe(0);
    expect(toasts).toEqual([NEEDS_TWO]);
  });
});

describe('editing: hit-test, drag, add, flip, remove', () => {
  // a smooth bump: three anchors, the middle one smooth
  const model = parsePathD('M0 100C20 100 40 0 50 0C60 0 80 100 100 100');
  const sel = { sub: 0, i: 1 };

  test('the selected point’s handles win over anchors; anchors over the path; the path over nothing', () => {
    const f: Frame = { origin: { x: 0, y: 0 }, k: 1 };
    expect(hitTest(model, f, { x: 60, y: 0 }, sel)).toMatchObject({ kind: 'handle', which: 'out' });
    // the same press with no selected point lands on the path (a point there would be added)
    expect(hitTest(model, f, { x: 60, y: 0 }, null)?.kind).not.toBe('handle');
    expect(hitTest(model, f, { x: 50, y: 0 }, null)).toMatchObject({ kind: 'anchor', i: 1 });
    expect(hitTest(model, f, { x: 0, y: 100 }, null)).toMatchObject({ kind: 'anchor', i: 0 });
    expect(hitTest(model, f, { x: 300, y: 300 }, null)).toBeNull();
    const onCurve = hitTest(model, f, { x: 25, y: 62 }, null);
    expect(onCurve?.kind === 'segment' || onCurve?.kind === 'anchor').toBe(true);
  });

  test('dragging an anchor moves it with its handles; a handle bends and the other turns; ⌥ breaks', () => {
    const moved = dragged(
      model,
      { kind: 'anchor', sub: 0, i: 1 },
      { x: 55, y: 10 },
      { alt: false, shift: false }
    );
    expect(moved.subs[0]?.points[1]).toMatchObject({
      x: 55,
      y: 10,
      in: { x: 45, y: 10 },
      out: { x: 65, y: 10 },
    });
    const bent = dragged(
      model,
      { kind: 'handle', sub: 0, i: 1, which: 'out' },
      { x: 60, y: 30 },
      { alt: false, shift: false }
    );
    expect(pointType(bent.subs[0] as never, 1)).toBe('smooth');
    expect(bent.subs[0]?.points[1]?.out).toEqual({ x: 60, y: 30 });
    const broken = dragged(
      model,
      { kind: 'handle', sub: 0, i: 1, which: 'out' },
      { x: 60, y: 30 },
      { alt: true, shift: false }
    );
    expect(pointType(broken.subs[0] as never, 1)).toBe('sharp');
    expect(broken.subs[0]?.points[1]?.in).toEqual({ x: 40, y: 0 });
  });

  test('point-type toggle: Smooth → Sharp → Smooth, and the chip says which', () => {
    expect(typeChip(model, sel)).toBe('Smooth');
    const sharp = toggled(model, sel);
    expect(typeChip(sharp, sel)).toBe('Sharp');
    expect(serializePath(sharp)).not.toBe(serializePath(model));
    expect(typeChip(toggled(sharp, sel), sel)).toBe('Smooth');
  });

  test('a click on a segment adds a point there and selects it; ⌫ takes a point away (never below two)', () => {
    const line = parsePathD('M0 0L100 0L100 100');
    const added = addedAt(line, { kind: 'segment', sub: 0, seg: 0, t: 0.5 });
    expect(added.point).toEqual({ sub: 0, i: 1 });
    expect(serializePath(added.model)).toBe('M0 0L50 0L100 0L100 100');
    const gone = removed(added.model, added.point);
    expect(serializePath(gone as never)).toBe('M0 0L100 0L100 100');
    expect(removed(parsePathD('M0 0L10 10'), { sub: 0, i: 0 })).toBeNull();
  });

  test('the chip beside a Pen path in the inspector counts points', () => {
    expect(penChip(4)).toBe('Pen · 4 points');
    expect(penChip(1)).toBe('Pen · 1 point');
  });
});

describe('point editing reads and writes the file’s own path', () => {
  const svg = () => {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    el.setAttribute('data-cd-id', 'path');
    el.setAttribute('data-shape', 'path');
    (el as unknown as HTMLElement).style.left = '100px';
    (el as unknown as HTMLElement).style.top = '60px';
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M0 80L100 0C140 -20 180 20 200 80');
    el.append(p);
    return el;
  };

  test('the svg’s d is the model in the svg’s own px; its left / top put it back in the container', () => {
    const el = svg();
    const m = modelOfSvg(el);
    expect(m && serializePath(m)).toBe('M0 80L100 0C140 -20 180 20 200 80');
    expect(svgOrigin(el)).toEqual({ x: 100, y: 60 });
  });

  test('a path with an arc cannot be point-edited (null, not a throw)', () => {
    const el = svg();
    el.querySelector('path')?.setAttribute('d', 'M0 0A10 10 0 0 1 20 20');
    expect(modelOfSvg(el)).toBeNull();
  });

  test('one committed edit = one path.edit ask, the model in container px', () => {
    const el = svg();
    const m = toggled(modelOfSvg(el) as never, { sub: 0, i: 1 });
    const ask = editAsk({ artboard: 'desktop', element: 'path' }, m, el);
    expect(ask.op).toBe('path.edit');
    expect(ask.targets).toEqual([{ artboard: 'desktop', element: 'path' }]);
    const sent = (
      ask.params as { path: { subs: Array<{ points: Array<{ x: number; y: number }> }> } }
    ).path;
    expect(sent.subs[0]?.points[0]).toMatchObject({ x: 100, y: 140 }); // (0, 80) + (100, 60)
  });
});

describe('Combine — measured by the canvas, written by one op', () => {
  const shape = (id: string, parent: HTMLElement, rect: Partial<DOMRect>, radius = '0px') => {
    const el = document.createElement('div');
    el.setAttribute('data-cd-id', id);
    el.setAttribute('data-shape', 'rectangle');
    el.style.borderTopLeftRadius = radius;
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect;
    parent.append(el);
    return { ref: { artboard: 'desktop', element: id }, el };
  };
  const frame = (rect: Partial<DOMRect> = {}) => {
    const el = document.createElement('div');
    el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0, ...rect }) as DOMRect;
    return el;
  };

  test('radius: px, a percent of the shorter side, the first value of an elliptical pair, nonsense = 0', () => {
    expect(radiusPx('12px', 100, 40)).toBe(12);
    expect(radiusPx('50%', 100, 40)).toBe(20);
    expect(radiusPx('8px 4px', 100, 40)).toBe(8);
    expect(radiusPx('', 100, 40)).toBe(0);
    expect(radiusPx('auto', 100, 40)).toBe(0);
  });

  test('fewer than two, or shapes in different frames, say why and ask nothing', () => {
    const a = frame();
    const b = frame();
    const x = shape('a', a, {});
    const y = shape('b', b, {});
    expect(planCombine('union', [x])).toEqual({ why: 'Combine needs two or more shapes.' });
    expect(planCombine('union', [x, y])).toEqual({
      why: 'Combine works on shapes that sit in the same frame.',
    });
  });

  test('operands are measured in the parent’s px and carry their resolved radii', () => {
    const parent = frame({ left: 100, top: 50 });
    const x = shape('a', parent, { left: 120, top: 70, width: 100, height: 60 }, '12px');
    const y = shape('b', parent, { left: 160, top: 90, width: 80, height: 80 });
    // happy-dom resolves no inherited / shorthand radius: read the longhand the element set
    const real = window.getComputedStyle;
    window.getComputedStyle = ((e: Element) => ({
      borderTopLeftRadius: (e as HTMLElement).style.borderTopLeftRadius,
      borderTopRightRadius: '0px',
      borderBottomRightRadius: '0px',
      borderBottomLeftRadius: '0px',
    })) as never;
    const plan = planCombine('subtract', [x, y]);
    window.getComputedStyle = real;
    if ('why' in plan) throw new Error(plan.why);
    expect(plan.ask.op).toBe('shape.combine.subtract');
    expect(plan.ask.targets).toEqual([x.ref, y.ref]);
    expect(plan.ask.params).toEqual({
      operands: [
        { x: 20, y: 20, w: 100, h: 60, radii: [12, 0, 0, 0] },
        { x: 60, y: 40, w: 80, h: 80, radii: [0, 0, 0, 0] },
      ],
    });
  });

  test('runCombine: ONE op, one undo step, selects the result; a refusal toasts and records nothing', async () => {
    const parent = frame();
    document.body.append(parent);
    const board = document.createElement('div');
    board.setAttribute('data-dc-screen', 'desktop');
    board.append(parent);
    document.body.append(board);
    shape('a', parent, { width: 10, height: 10 });
    shape('b', parent, { width: 10, height: 10 });
    const sel = ['a', 'b'].map((id) => ({
      id,
      artboardId: 'desktop',
      selector: `[data-cd-id="${id}"]`,
    })) as never;
    const asks: unknown[] = [];
    const records: unknown[] = [];
    const picked: unknown[] = [];
    const made = await runCombine('shape.combine.union', sel, {
      run: async (a) => {
        asks.push(a);
        return {
          ok: true,
          actionId: null,
          writeId: 'w2',
          rev: 'r',
          refs: [],
          created: [{ artboard: 'desktop', element: 'union' }],
        };
      },
      record: (r) => records.push(r),
      select: (c) => picked.push(c),
    });
    expect(made).toBe(true);
    expect(asks).toHaveLength(1);
    expect(records).toEqual([
      { kind: 'edit-op', label: 'Combine · union', payload: { writeId: 'w2' } },
    ]);
    expect(picked).toEqual([[{ artboard: 'desktop', element: 'union' }]]);

    const toasts: string[] = [];
    const recs2: unknown[] = [];
    const no = await runCombine('shape.combine.union', sel, {
      run: async () => ({ ok: false, code: 'invalid', message: 'A line has no area to combine.' }),
      toast: (m) => toasts.push(m),
      record: (r) => recs2.push(r),
    });
    expect(no).toBe(false);
    expect(toasts).toEqual(['A line has no area to combine.']);
    expect(recs2).toEqual([]);
    board.remove();
  });
});

describe('the toolbar and the registry', () => {
  test('Pen is a tool, no longer pending; P arms it in Edit; only Crop stays pending', () => {
    const pen = MODE_TOOLS.edit.slots.find((s) => s.label === 'Pen');
    expect(pen?.tool).toBe('el-pen');
    expect(pen?.pending).toBeUndefined();
    expect(pendingSlots().map((p) => p.slot.label)).toEqual(['Crop']);
    expect(toolKeyAction('edit', 'P', ALL_CAPS)).toMatchObject({ kind: 'arm', tool: 'el-pen' });
    expect(visibleSlots('edit', 'edit', () => true).map((s) => s.label)).toContain('Pen');
    expect(isPenTool('el-pen')).toBe(true);
    expect(isPenTool('pen')).toBe(false); // the Marker (M) is not the Pen
  });

  test('registry: the Pen tool, its two ops and four Combine actions exist once with an agent path', () => {
    for (const id of [
      'tool.el-pen',
      'object.insert-path',
      'path.edit',
      'shape.combine.union',
      'shape.combine.subtract',
      'shape.combine.intersect',
      'shape.combine.exclude',
    ])
      expect(ACTIONS_BY_ID.has(id), id).toBe(true);
    expect(ACTIONS_BY_ID.get('tool.el-pen')?.keys.length).toBeGreaterThan(0);
    expect(drawToolOfAction('tool.el-pen')).toBe('el-pen');
  });

  test('the canvas runs the Combine actions; the Pen tool is armed, not run', () => {
    for (const id of COMBINE_ACTIONS)
      expect((EDITING_ACTIONS as readonly string[]).includes(id)).toBe(true);
    expect(EDITING_ACTIONS.some((a) => a.startsWith('tool.'))).toBe(false);
  });

  test('selection: a Pen path is a Path, a drawn shape stays a Shape, a bare svg of one element is a Path too', () => {
    const facts = { tag: 'svg', elements: 1, hasText: false };
    expect(selectionKind(1, { ...facts, path: true })).toBe('path');
    expect(selectionKind(1, { ...facts, shape: true })).toBe('shape');
    expect(selectionKind(1, { tag: 'div', elements: 0, hasText: false, shape: true })).toBe(
      'shape'
    );
  });
});
