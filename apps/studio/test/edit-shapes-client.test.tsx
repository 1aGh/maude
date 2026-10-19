// S2.13 (artboard ed-shape) — the canvas half of shapes: the drag arithmetic, what a finished drag asks for
// (one edit-op, or the Export sheet and NO write), the container a press lands in, the corner dots' math, the
// toolbar's More, F and R as tools, the shape kind chip and the registry rows. The writers are
// test/edit-ops-shapes.test.ts.

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
import { exportRegionOf } from '../client/export-region.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import {
  cornerTarget,
  dotAt,
  maxRadius,
  radiusAsk,
  radiusFromPointer,
  radiusPx,
  roundable,
  snapRadius,
} from '../editing/corner-dots.tsx';
import { selectionKind } from '../editing/crumbs.ts';
import {
  CLICK_SIZE,
  clickBox,
  DRAG_THRESHOLD,
  dragBox,
  drawToolOfAction,
  isClick,
  isDrawTool,
  KIND_OF_TOOL,
  lineEnd,
  liveTag,
  toLocal,
  toWorld,
} from '../editing/draw-geometry.ts';
import {
  beginLive,
  containerAt,
  finishDraw,
  type Live,
  NOT_ON_ARTBOARD,
  planDraw,
} from '../editing/draw-tools.tsx';
import { EDITING_ACTIONS } from '../editing/index.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => GlobalRegistrator.unregister());

const VP = { x: 100, y: 50, zoom: 0.5 };

describe('the drag', () => {
  test('a box between two points; ⇧ square; ⌥ from the centre', () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 110, y: 60 }, { shift: false, alt: false })).toEqual({
      x: 10,
      y: 10,
      w: 100,
      h: 50,
    });
    expect(dragBox({ x: 110, y: 60 }, { x: 10, y: 10 }, { shift: false, alt: false })).toEqual({
      x: 10,
      y: 10,
      w: 100,
      h: 50,
    });
    expect(dragBox({ x: 10, y: 10 }, { x: 110, y: 60 }, { shift: true, alt: false })).toEqual({
      x: 10,
      y: 10,
      w: 100,
      h: 100,
    });
    expect(dragBox({ x: 100, y: 100 }, { x: 140, y: 120 }, { shift: false, alt: true })).toEqual({
      x: 60,
      y: 80,
      w: 80,
      h: 40,
    });
  });

  test('a Line with ⇧ lands on a 45° step at the same length', () => {
    const end = lineEnd({ x: 0, y: 0 }, { x: 100, y: 10 }, { shift: true });
    expect(Math.round(end.y)).toBe(0);
    expect(Math.round(end.x)).toBe(Math.round(Math.hypot(100, 10)));
    const diag = lineEnd({ x: 0, y: 0 }, { x: 60, y: 50 }, { shift: true });
    expect(Math.round(diag.x)).toBe(Math.round(diag.y));
    expect(lineEnd({ x: 0, y: 0 }, { x: 7, y: 3 }, { shift: false })).toEqual({ x: 7, y: 3 });
  });

  test('a press that stays put is a click and draws the default box', () => {
    expect(isClick({ x: 5, y: 5 }, { x: 5 + DRAG_THRESHOLD - 1, y: 5 })).toBe(true);
    expect(isClick({ x: 5, y: 5 }, { x: 5 + DRAG_THRESHOLD, y: 5 })).toBe(false);
    expect(clickBox({ x: 3, y: 4 })).toEqual({ x: 3, y: 4, w: CLICK_SIZE, h: CLICK_SIZE });
  });

  test('the live tag says what and how big', () => {
    expect(liveTag('rectangle', { x: 0, y: 0, w: 216, h: 215.6 })).toBe('Rectangle · 216 × 216');
    expect(liveTag('frame', { x: 0, y: 0, w: 40, h: 20 })).toBe('Frame · 40 × 20');
    expect(liveTag('area', { x: 0, y: 0, w: 640, h: 360 })).toBe('Export area · 640 × 360');
    expect(
      liveTag('line', { x: 0, y: 0, w: 0, h: 0 }, { from: { x: 0, y: 0 }, to: { x: 30, y: 40 } })
    ).toBe('Line · 50 px');
  });

  test('screen → container px and → world px', () => {
    expect(toLocal({ x: 120, y: 80, w: 100, h: 50 }, { x: 20, y: 30 }, 0.5)).toEqual({
      x: 200,
      y: 100,
      w: 200,
      h: 100,
    });
    expect(toWorld({ x: 100, y: 50 }, VP)).toEqual({ x: 0, y: 0 });
    expect(toWorld({ x: 200, y: 150 }, VP)).toEqual({ x: 200, y: 200 });
  });

  test('the tools: six drag tools, each with one kind; actions arm them', () => {
    expect(KIND_OF_TOOL).toEqual({
      frame: 'frame',
      'el-shape': 'rectangle',
      ellipse: 'ellipse',
      line: 'line',
      polygon: 'polygon',
      slice: 'area',
    });
    expect(isDrawTool('line')).toBe(true);
    expect(isDrawTool('move')).toBe(false);
    expect(drawToolOfAction('tool.line')).toBe('line');
    expect(drawToolOfAction('tool.el-shape')).toBe('el-shape');
    expect(drawToolOfAction('tool.select')).toBeNull();
    expect(drawToolOfAction('edit.undo')).toBeNull();
  });
});

describe('planDraw — what a finished drag asks for', () => {
  const target = {
    artboard: 'desktop',
    frameRef: null,
    origin: { x: 100, y: 50 },
    k: 0.5,
    relativeParent: false,
  };
  const live = (over: Partial<Live>): Live => ({
    kind: 'rectangle',
    from: { x: 120, y: 70 },
    to: { x: 228, y: 178 },
    alt: false,
    shift: false,
    target,
    ...over,
  });

  test('a rectangle in an artboard: container px, whole numbers', () => {
    const p = planDraw(live({}), VP);
    expect(p).toEqual({
      type: 'op',
      ask: {
        op: 'object.insert-shape',
        targets: [],
        params: { kind: 'rectangle', artboard: 'desktop', rect: { x: 40, y: 40, w: 216, h: 216 } },
      },
      label: 'Draw rectangle',
      select: 'element',
    });
  });

  test('into a frame: the frame is the target; a static one is pinned relative', () => {
    const frameRef = { artboard: 'desktop', element: 'hero' };
    const p = planDraw(
      live({ kind: 'ellipse', target: { ...target, frameRef, relativeParent: true } }),
      VP
    );
    expect(p.type === 'op' && p.ask.targets).toEqual([frameRef]);
    expect(p.type === 'op' && p.ask.params?.relativeParent).toBe(true);
    expect(p.type === 'op' && p.ask.params?.kind).toBe('ellipse');
  });

  test('a click draws 100 × 100 at the press', () => {
    const p = planDraw(live({ to: { x: 121, y: 70 } }), VP);
    expect(p.type === 'op' && p.ask.params?.rect).toEqual({ x: 40, y: 40, w: 100, h: 100 });
  });

  test('a Line sends its two points; a click on a line draws nothing', () => {
    const p = planDraw(live({ kind: 'line', from: { x: 100, y: 50 }, to: { x: 100, y: 150 } }), VP);
    expect(p.type === 'op' && p.ask.params?.line).toEqual({ x1: 0, y1: 0, x2: 0, y2: 200 });
    expect(planDraw(live({ kind: 'line', to: { x: 120, y: 70 } }), VP)).toEqual({ type: 'none' });
  });

  test('⇧ squares a rectangle', () => {
    const p = planDraw(live({ shift: true, to: { x: 220, y: 100 } }), VP);
    expect(p.type === 'op' && p.ask.params?.rect).toEqual({ x: 40, y: 40, w: 200, h: 200 });
  });

  test('F on empty canvas is a Fixed size artboard in world px', () => {
    const p = planDraw(
      live({ kind: 'frame', target: null, from: { x: 300, y: 250 }, to: { x: 700, y: 650 } }),
      VP
    );
    expect(p).toEqual({
      type: 'op',
      ask: {
        op: 'artboard.draw',
        targets: [],
        params: { rect: { x: 400, y: 400, w: 800, h: 800 } },
      },
      label: 'Draw an artboard',
      select: 'artboard',
    });
  });

  test('R on empty canvas draws nothing and says why', () => {
    expect(planDraw(live({ target: null }), VP)).toEqual({ type: 'none', why: NOT_ON_ARTBOARD });
  });

  test('Export area asks for the sheet with a world rectangle — and for no write', () => {
    const p = planDraw(
      live({ kind: 'area', target: null, from: { x: 100, y: 50 }, to: { x: 420, y: 230 } }),
      VP
    );
    expect(p).toEqual({
      type: 'export',
      detail: {
        scope: 'selection-bounds',
        region: { rect: { x: 0, y: 0, w: 640, h: 360 } },
        unit: 'one',
      },
    });
    expect(planDraw(live({ kind: 'area', target: null, to: { x: 121, y: 70 } }), VP)).toEqual({
      type: 'none',
    });
  });
});

describe('finishDraw — one write, one undo step', () => {
  const ok = (over: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
    ok: true,
    actionId: null,
    writeId: 'w1',
    rev: 'r',
    refs: [],
    created: [{ artboard: 'desktop', element: 'rectangle' }],
    ...over,
  });
  const target = {
    artboard: 'desktop',
    frameRef: null,
    origin: { x: 0, y: 0 },
    k: 1,
    relativeParent: false,
  };
  const rect: Live = {
    kind: 'rectangle',
    from: { x: 0, y: 0 },
    to: { x: 80, y: 60 },
    alt: false,
    shift: false,
    target,
  };

  test('runs exactly one op, records one undo step and selects what it made', async () => {
    const asks: unknown[] = [];
    const records: unknown[] = [];
    const picked: unknown[] = [];
    const made = await finishDraw(rect, {
      run: async (a) => {
        asks.push(a);
        return ok();
      },
      record: (r) => records.push(r),
      select: (what, created) => picked.push([what, created]),
      viewport: () => VP,
    });
    expect(made).toBe(true);
    expect(asks).toHaveLength(1);
    expect(records).toEqual([
      { kind: 'edit-op', label: 'Draw rectangle', payload: { writeId: 'w1' } },
    ]);
    expect(picked).toEqual([['element', [{ artboard: 'desktop', element: 'rectangle' }]]]);
  });

  test('a refusal is said in the op’s words and records nothing', async () => {
    const toasts: string[] = [];
    const records: unknown[] = [];
    const made = await finishDraw(rect, {
      run: async () => ({ ok: false, code: 'locked', message: 'hero is locked · ⇧⌘L unlocks' }),
      toast: (m) => toasts.push(m),
      record: (r) => records.push(r),
      viewport: () => VP,
    });
    expect(made).toBe(false);
    expect(toasts).toEqual(['hero is locked · ⇧⌘L unlocks']);
    expect(records).toEqual([]);
  });

  test('Export area opens the sheet and never calls the writer', async () => {
    let writes = 0;
    const opened: Array<Record<string, unknown>> = [];
    const made = await finishDraw(
      { ...rect, kind: 'area', target: null, from: { x: 100, y: 50 }, to: { x: 420, y: 230 } },
      {
        run: async () => {
          writes += 1;
          return ok();
        },
        openExport: (d) => opened.push(d),
        viewport: () => VP,
      }
    );
    expect(made).toBe(true);
    expect(writes).toBe(0);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.region).toEqual({ rect: { x: 0, y: 0, w: 640, h: 360 } });
  });

  test('a shape tool pressed off every artboard toasts and writes nothing', async () => {
    const toasts: string[] = [];
    let writes = 0;
    await finishDraw(
      { ...rect, target: null },
      { run: async () => (writes++, ok()), toast: (m) => toasts.push(m), viewport: () => VP }
    );
    expect(writes).toBe(0);
    expect(toasts).toEqual([NOT_ON_ARTBOARD]);
  });
});

describe('the press: which container', () => {
  const build = () => {
    document.body.innerHTML = `
      <article data-dc-screen="desktop"><div class="dc-artboard-body">
        <section data-cd-id="hero"><p data-cd-id="copy">Hi</p></section>
        <section data-cd-id="locked" data-cd-locked="true"><div data-cd-id="inner"></div></section>
      </div></article>`;
    const q = (s: string) => document.querySelector(s) as HTMLElement;
    return {
      body: q('.dc-artboard-body'),
      hero: q('[data-cd-id="hero"]'),
      copy: q('[data-cd-id="copy"]'),
      inner: q('[data-cd-id="inner"]'),
      locked: q('[data-cd-id="locked"]'),
    };
  };
  const stack = (els: Element[]) => {
    (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => els;
  };

  test('the deepest frame that can hold a child — not the text run in it', () => {
    const d = build();
    stack([d.copy, d.hero, d.body]);
    const c = containerAt(document, 10, 10);
    expect(c?.el).toBe(d.hero);
    expect(c).toMatchObject({ artboard: 'desktop', frame: true });
  });

  test('bare artboard: the body itself', () => {
    const d = build();
    stack([d.body]);
    expect(containerAt(document, 10, 10)).toMatchObject({ frame: false, artboard: 'desktop' });
    expect(containerAt(document, 10, 10)?.el).toBe(d.body);
  });

  test('a locked frame is skipped: the draw goes to the artboard', () => {
    const d = build();
    stack([d.inner, d.locked, d.body]);
    // inner sits inside a locked frame; the inner div itself is not locked, so it is the container
    expect(containerAt(document, 1, 1)?.el).toBe(d.inner);
    stack([d.locked, d.body]);
    expect(containerAt(document, 1, 1)?.frame).toBe(false);
  });

  test('chrome the press may land on first is looked through; off every artboard is null', () => {
    const d = build();
    const chrome = document.createElement('div');
    chrome.className = 'ed-draw-input';
    document.body.appendChild(chrome);
    stack([chrome, d.hero, d.body]);
    expect(containerAt(document, 1, 1)?.el).toBe(d.hero);
    stack([chrome, document.body]);
    expect(containerAt(document, 1, 1)).toBeNull();
  });

  test('beginLive: R off an artboard is refused, F off an artboard is a new artboard, the area needs none', () => {
    build();
    stack([document.body]);
    const mods = { altKey: false, shiftKey: false };
    expect(beginLive(document, 'rectangle', { x: 1, y: 1 }, mods)).toBe('off-artboard');
    expect((beginLive(document, 'frame', { x: 1, y: 1 }, mods) as Live).target).toBeNull();
    expect((beginLive(document, 'area', { x: 1, y: 1 }, mods) as Live).target).toBeNull();
  });

  test('beginLive inside a static frame pins it relative and names it', () => {
    const d = build();
    stack([d.copy, d.hero, d.body]);
    const l = beginLive(
      document,
      'rectangle',
      { x: 1, y: 1 },
      { altKey: false, shiftKey: false }
    ) as Live;
    expect(l.target).toMatchObject({
      artboard: 'desktop',
      frameRef: { artboard: 'desktop', element: 'hero' },
    });
  });
});

describe('the corner dots', () => {
  const rect = { left: 100, top: 100, width: 200, height: 100 };

  test('a square corner’s dot sits near the corner; a rounder one further in; never past the middle', () => {
    expect(dotAt('tl', rect, 0, 1)).toEqual({ x: 114, y: 114 });
    expect(dotAt('tl', rect, 20, 1)).toEqual({ x: 134, y: 134 });
    expect(dotAt('br', rect, 0, 1)).toEqual({ x: 286, y: 186 });
    expect(dotAt('tr', rect, 0, 1)).toEqual({ x: 286, y: 114 });
    expect(dotAt('bl', rect, 0, 1)).toEqual({ x: 114, y: 186 });
    expect(dotAt('tl', rect, 500, 1)).toEqual({ x: 150, y: 150 });
  });

  test('the pointer’s distance in along the diagonal is the radius, clamped to half the short side', () => {
    expect(radiusFromPointer('tl', { x: 134, y: 134 }, rect, 1, 50)).toBe(20);
    expect(radiusFromPointer('tl', { x: 100, y: 100 }, rect, 1, 50)).toBe(0);
    expect(radiusFromPointer('tl', { x: 400, y: 400 }, rect, 1, 50)).toBe(50);
    expect(radiusFromPointer('br', { x: 266, y: 166 }, rect, 1, 50)).toBe(20);
    expect(radiusFromPointer('tl', { x: 134, y: 134 }, rect, 2, 50)).toBe(10); // 2x zoom: half the element px
    expect(maxRadius(200, 100)).toBe(50);
  });

  test('it clicks onto the system’s stops; ⌘ takes any number', () => {
    expect(snapRadius(9, [4, 8, 16], false)).toBe(8);
    expect(snapRadius(2.1, [4, 8, 16], false)).toBe(4);
    expect(snapRadius(1, [4, 8, 16], false)).toBe(0);
    expect(snapRadius(9.4, [4, 8, 16], true)).toBe(9);
    expect(snapRadius(9.4, [], false)).toBe(9);
  });

  test('linked corners round together; unlinked (or ⌥) only the dragged one', () => {
    const linked = { tl: 8, tr: 8, br: 8, bl: 8 };
    expect(cornerTarget(linked, 'bl', false)).toBe('all');
    expect(cornerTarget(linked, 'bl', true)).toBe('bl');
    expect(cornerTarget({ ...linked, bl: 2 }, 'bl', false)).toBe('bl');
  });

  test('the ask: a token when the radius lands on a stop, the number otherwise', () => {
    const stops = [{ name: '--radius-md', px: 8 }];
    expect(radiusAsk('tl', 8, stops).params).toEqual({
      corner: 'tl',
      radius: { token: '--radius-md' },
    });
    expect(radiusAsk('all', 9, stops).params).toEqual({ corner: 'all', radius: { px: 9 } });
    expect(radiusAsk('all', 0, stops).params).toEqual({ corner: 'all', radius: { px: 0 } });
  });

  test('computed radii read in element px; only frames and shapes (not lines, text, images) show dots', () => {
    expect(radiusPx('8px', 100, 100)).toBe(8);
    expect(radiusPx('50%', 200, 100)).toBe(50);
    expect(radiusPx('', 100, 100)).toBe(0);
    document.body.innerHTML =
      '<div id="a" data-shape="rectangle"></div><div id="b" data-shape="line"></div><div id="c"></div><img id="d"><p id="e">x</p>';
    const el = (id: string) => document.getElementById(id) as Element;
    expect(roundable(el('a'))).toBe(true);
    expect(roundable(el('b'))).toBe(false);
    expect(roundable(el('c'))).toBe(true);
    expect(roundable(el('d'))).toBe(false);
    expect(roundable(el('e'))).toBe(false);
  });
});

describe('the toolbar and the registry', () => {
  test('F and R are tools and no longer pending; Ellipse is reachable only through More', () => {
    const edit = MODE_TOOLS.edit.slots;
    const f = edit.find((s) => s.label === 'Frame');
    expect(f?.insert).toBeUndefined();
    expect(f?.pending).toBeUndefined();
    expect(edit.find((s) => s.label === 'Shape')?.pending).toBeUndefined();
    expect(edit.some((s) => s.tool === 'ellipse')).toBe(false);
    const more = edit.find((s) => s.popover === 'more');
    expect(more?.more?.map((c) => [c.label, !!c.pending])).toEqual([
      ['Line', false],
      ['Ellipse', false],
      ['Polygon', false],
      ['Crop', false],
      ['Export area', false],
    ]);
    // what stays pending: Pen (its slice). Component went live in S2.16 (panel-only slot,
    // decision v2-S2.16 tool.components), Crop in S2.15.
    expect(
      pendingSlots()
        .map((p) => p.slot.label)
        .sort()
    ).toEqual(['Pen']);
  });

  test('visible: More shows for an editor while a child is live', () => {
    const slots = visibleSlots('edit', 'edit', () => true);
    expect(slots.map((s) => s.label)).toContain('More');
    expect(slots.map((s) => s.label)).toContain('Shape');
  });

  test('keys: F and R arm their tools in Edit; ellipse has no key', () => {
    expect(toolKeyAction('edit', 'F', ALL_CAPS)).toMatchObject({ kind: 'arm', tool: 'frame' });
    expect(toolKeyAction('edit', 'R', ALL_CAPS)).toMatchObject({ kind: 'arm', tool: 'el-shape' });
    expect(toolKeyAction('edit', 'O', ALL_CAPS)).toBeNull();
  });

  test('registry: every drag tool has an action and an agent path; the ops are registered once', () => {
    for (const id of [
      'tool.frame',
      'tool.el-shape',
      'tool.line',
      'tool.ellipse',
      'tool.polygon',
      'tool.slice',
      'object.insert-shape',
      'artboard.draw',
      'object.set-corner-radius',
    ])
      expect(ACTIONS_BY_ID.has(id), id).toBe(true);
    // R in Edit is the design Shape; Preview keeps its own R (Shape) — one binding per (key, mode)
    expect(ACTIONS_BY_ID.get('tool.el-shape')?.keys.length).toBeGreaterThan(0);
    expect(ACTIONS_BY_ID.get('tool.line')?.keys.length).toBe(0);
  });

  test('the editing layer lists no tool action (a tool is armed, not run)', () => {
    expect(EDITING_ACTIONS.some((a) => a.startsWith('tool.'))).toBe(false);
  });
});

describe('the Shape kind', () => {
  test('selection: an element carrying data-shape is a Shape (a bare div stays a Frame)', () => {
    expect(selectionKind(1, { tag: 'DIV', elements: 0, hasText: false, shape: true })).toBe(
      'shape'
    );
    expect(selectionKind(1, { tag: 'DIV', elements: 0, hasText: false })).toBe('frame');
    expect(selectionKind(1, { tag: 'DIV', elements: 2, hasText: false, shape: false })).toBe(
      'frame'
    );
  });
});

describe('Export area crossing the iframe boundary', () => {
  test('the shell takes four sane numbers from the canvas and nothing else', () => {
    expect(exportRegionOf({ region: { rect: { x: 1.4, y: -20, w: 640.2, h: 360 } } })).toEqual({
      rect: { x: 1, y: -20, w: 640, h: 360 },
    });
    expect(exportRegionOf(undefined)).toBeUndefined();
    expect(exportRegionOf({ region: { rect: { x: 0, y: 0, w: 0, h: 5 } } })).toBeUndefined();
    expect(exportRegionOf({ region: { rect: { x: '0', y: 0, w: 5, h: 5 } } })).toBeUndefined();
    expect(
      exportRegionOf({ region: { rect: { x: 0, y: 0, w: 5, h: Number.POSITIVE_INFINITY } } })
    ).toBeUndefined();
    expect(exportRegionOf({ region: { rect: { x: 1e9, y: 0, w: 5, h: 5 } } })).toBeUndefined();
  });
});
