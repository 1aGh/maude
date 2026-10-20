// S7.20 — the canvas half of the F size picker: where an artboard of a preset would land (never on top of another,
// inside the view when there is room, beside the row when there is not), what F asks of the shell, and that ONE pick is
// ONE `artboard.insert-preset` ask, one undo record, the new artboard selected, then `size-place` to the shell.
// The writer's golden is test/insert-preset.test.ts; the shell half is test/size-picker.test.tsx.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { ACTIONS_BY_ID } from '../actions/index.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import type { EditOpAsk } from '../editing/edit-op.ts';
import { EDITING_ACTIONS } from '../editing/index.tsx';
import {
  boardsInWorld,
  GHOST_GAP,
  INSERT_PRESET_ACTION,
  place,
  placeGhost,
  sizeOfRequest,
  sizesPanelRequest,
  viewInWorld,
  type WorldRect,
} from '../editing/size-ghost.tsx';

const overlap = (a: WorldRect, b: WorldRect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('placeGhost', () => {
  test('an empty canvas: centred in what the person sees', () => {
    expect(placeGhost({ w: 400, h: 200 }, [], { x: 0, y: 0, w: 1000, h: 600 })).toEqual({
      x: 300,
      y: 200,
    });
    expect(placeGhost({ w: 400, h: 200 }, [], null)).toEqual({ x: 0, y: 0 });
  });

  test('never on top of an artboard, and a gap away from each', () => {
    const boards: WorldRect[] = [
      { x: 0, y: 0, w: 400, h: 300 },
      { x: 450, y: 0, w: 400, h: 300 },
    ];
    const view = { x: -100, y: -100, w: 2000, h: 1000 };
    const at = placeGhost({ w: 300, h: 200 }, boards, view);
    const r = { ...at, w: 300, h: 200 };
    for (const b of boards) expect(overlap(r, b)).toBe(false);
    // inside the view
    expect(at.x).toBeGreaterThanOrEqual(view.x);
    expect(at.x + 300).toBeLessThanOrEqual(view.x + view.w);
    expect(at.y).toBeGreaterThanOrEqual(view.y);
    expect(at.y + 200).toBeLessThanOrEqual(view.y + view.h);
  });

  test('no room in view (zoomed in, or bigger than the window): beside the first row, one gap-and-a-half past it', () => {
    const boards: WorldRect[] = [
      { x: 100, y: 50, w: 400, h: 300 },
      { x: 560, y: 50, w: 400, h: 300 },
    ];
    // the view is entirely covered by the two boards
    const view = { x: 120, y: 60, w: 300, h: 200 };
    expect(placeGhost({ w: 1920, h: 1005 }, boards, view)).toEqual({
      x: 960 + GHOST_GAP * 2,
      y: 50,
    });
    // a canvas the camera knows nothing about
    expect(placeGhost({ w: 100, h: 100 }, boards, null)).toEqual({ x: 960 + GHOST_GAP * 2, y: 50 });
  });

  test('whole pixels', () => {
    const at = placeGhost({ w: 333, h: 111 }, [], { x: 0.4, y: 0.4, w: 1001, h: 603 });
    expect(Number.isInteger(at.x) && Number.isInteger(at.y)).toBe(true);
  });
});

describe('the camera → world (the same math as canvas-lib)', () => {
  function canvasDom() {
    document.body.innerHTML = `
      <div class="dc-canvas">
        <article data-dc-screen="a"><div class="dc-artboard-body"></div></article>
        <article data-dc-screen="b"><div class="dc-artboard-body"></div></article>
      </div>`;
    const rect = (l: number, t: number, w: number, h: number) =>
      ({
        left: l,
        top: t,
        width: w,
        height: h,
        right: l + w,
        bottom: t + h,
        x: l,
        y: t,
      }) as DOMRect;
    (document.querySelector('.dc-canvas') as HTMLElement).getBoundingClientRect = () =>
      rect(0, 0, 1000, 600);
    const bodies = document.querySelectorAll('.dc-artboard-body');
    // pan (100, 50), zoom 0.5: world (0,0) 400×300 → screen (100,50) 200×150; world (500,0) → screen (350,50)
    (bodies[0] as HTMLElement).getBoundingClientRect = () => rect(100, 50, 200, 150);
    (bodies[1] as HTMLElement).getBoundingClientRect = () => rect(350, 50, 200, 150);
  }
  const VP = { x: 100, y: 50, zoom: 0.5 };

  test('boards are read by their design surface, in world px', () => {
    canvasDom();
    expect(boardsInWorld(document, VP)).toEqual([
      { x: 0, y: 0, w: 400, h: 300 },
      { x: 500, y: 0, w: 400, h: 300 },
    ]);
  });

  test('the view is the host box over the zoom', () => {
    canvasDom();
    expect(viewInWorld(document, VP)).toEqual({ x: -200, y: -100, w: 2000, h: 1200 });
    document.body.innerHTML = '';
    expect(viewInWorld(document, VP)).toBeNull();
    expect(boardsInWorld(document, VP)).toEqual([]);
  });
});

describe('what F asks of the shell', () => {
  test('no artboard selected → the size picker above the toolbar', () => {
    expect(sizesPanelRequest({ hasArtboardSelection: false, readOnly: false })).toEqual({
      dgn: 'tool-panel-open',
      panel: 'sizes',
      anchor: null,
    });
  });

  test('an artboard selected (F draws a frame inside it), a read-only canvas, or no shell → nothing', () => {
    expect(sizesPanelRequest({ hasArtboardSelection: true, readOnly: false })).toBeNull();
    expect(sizesPanelRequest({ hasArtboardSelection: false, readOnly: true })).toBeNull();
    expect(
      sizesPanelRequest({ hasArtboardSelection: false, readOnly: false, framed: false })
    ).toBeNull();
  });
});

describe('sizeOfRequest — the catalogue is the only source of a size', () => {
  test('a preset id → its px; a custom size → trim + bleed; anything else → null', () => {
    expect(sizeOfRequest('social-fb-event', undefined)).toEqual({ w: 1920, h: 1005 });
    expect(sizeOfRequest('print-a6', undefined)).toEqual({ w: 419, h: 581 });
    expect(sizeOfRequest('print-custom', { widthMm: 99, heightMm: 210, bleedMm: 3 })).toEqual({
      w: 396,
      h: 816,
    });
    expect(sizeOfRequest('print-custom', { widthMm: 5, heightMm: 210 })).toBeNull();
    expect(sizeOfRequest('nope', undefined)).toBeNull();
    expect(sizeOfRequest(7, undefined)).toBeNull();
  });
});

describe('the registry', () => {
  test('artboard.insert-preset runs in the canvas, for an editor, and is listed in the editing actions', () => {
    const a = ACTIONS_BY_ID.get(INSERT_PRESET_ACTION);
    expect(a?.exec).toBe('canvas');
    expect(a?.enabled?.minRole).toBe('edit');
    expect((EDITING_ACTIONS as readonly string[]).includes(INSERT_PRESET_ACTION)).toBe(true);
  });
});

describe('place — ONE pick is ONE ask', () => {
  const OK: EditOpResult = {
    ok: true,
    actionId: null,
    writeId: 'w_0123456789abcdef',
    rev: '0123456789abcdef',
    refs: [],
    created: [{ artboard: 'fb-event-cover', element: 'fb-event-cover' }],
    detail: { label: 'FB event cover' },
  };

  function harness(result: EditOpResult) {
    const asks: EditOpAsk[] = [];
    const log = {
      toasts: [] as string[],
      records: [] as unknown[],
      selected: [] as string[][],
      posts: [] as unknown[],
      done: 0,
    };
    const deps = {
      run: async (ask: EditOpAsk) => {
        asks.push(ask);
        return result;
      },
      toast: (m: string) => log.toasts.push(m),
      record: (r: unknown) => log.records.push(r),
      select: (ids: string[]) => log.selected.push(ids),
      done: () => {
        log.done += 1;
      },
      post: (m: Record<string, unknown>) => log.posts.push(m),
    };
    return { asks, log, deps };
  }

  test('the ask, the undo record, the selection, the tool, and size-place — in that order of consequence', async () => {
    const h = harness(OK);
    const ok = await place('social-fb-event', undefined, { x: 1000, y: 150 }, h.deps);
    expect(ok).toBe(true);
    expect(h.asks).toEqual([
      {
        op: 'artboard.insert-preset',
        targets: [],
        params: { presetId: 'social-fb-event', at: { x: 1000, y: 150 } },
      },
    ]);
    expect(h.log.records).toHaveLength(1);
    expect(h.log.records[0]).toMatchObject({ label: 'Added FB event cover' });
    expect(h.log.selected).toEqual([['fb-event-cover']]);
    expect(h.log.done).toBe(1);
    expect(h.log.posts).toEqual([
      { dgn: 'size-place', presetId: 'social-fb-event', world: { x: 1000, y: 150 } },
    ]);
    expect(h.log.toasts).toEqual([]);
  });

  test('a custom size travels as mm in params', async () => {
    const h = harness(OK);
    await place('print-custom', { widthMm: 99, heightMm: 210, bleedMm: 3 }, { x: 0, y: 0 }, h.deps);
    expect(h.asks[0]?.params).toEqual({
      presetId: 'print-custom',
      at: { x: 0, y: 0 },
      custom: { widthMm: 99, heightMm: 210, bleedMm: 3 },
    });
  });

  test('on an op-log home the kernel action is the undo step: no legacy record', async () => {
    const h = harness({ ...OK, actionId: 'a_1' } as EditOpResult);
    await place('app-mobile', undefined, { x: 0, y: 0 }, h.deps);
    expect(h.log.records).toEqual([]);
    expect(h.log.selected).toHaveLength(1);
  });

  test('a refusal says why, selects nothing, records nothing and does not tell the shell', async () => {
    const h = harness({
      ok: false,
      code: 'invalid',
      message: 'That size is not one of the presets.',
    });
    const ok = await place('app-mobile', undefined, { x: 0, y: 0 }, h.deps);
    expect(ok).toBe(false);
    expect(h.log.toasts).toEqual(['That size is not one of the presets.']);
    expect(h.log.records).toEqual([]);
    expect(h.log.selected).toEqual([]);
    expect(h.log.posts).toEqual([]);
    expect(h.log.done).toBe(0);
  });
});
