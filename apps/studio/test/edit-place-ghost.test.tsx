// S2.16 — the canvas half of ⇧I: where a click lands (snap onto the centre guide, into an auto-layout
// frame, else free), the edit-op ask it makes, ↵ into the selection, and ONE placement = one ask, one
// undo record, the new instance selected. The writer's golden is test/edit-ops-component.test.ts.
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

import type { EditOpResult } from '../edit-ops/types.ts';
import type { EditOpAsk } from '../editing/edit-op.ts';
import {
  askForDrop,
  askForSelection,
  dropAt,
  NEEDS_FRAME_LINE,
  ONE_FRAME_LINE,
  type PlaceRequest,
  requestFrom,
  runPlace,
  SNAP_PX,
  snapX,
} from '../editing/place-ghost.tsx';

const REQ: PlaceRequest = {
  component: 'Button',
  label: 'Tlačítko · Plné',
  variant: 'primary',
  glyph: null,
  mode: 'ghost',
};

describe('snapX — the centre guide', () => {
  test('within SNAP_PX screen px of the middle it snaps, whatever the zoom', () => {
    expect(snapX(540, 1080, 0.36)).toBe('centre');
    expect(snapX(540 + 20, 1080, 0.36)).toBe('centre'); // 20 world = 7.2 screen px
    expect(snapX(540 + 23, 1080, 0.36)).toBe(563); // 8.3 screen px
    expect(snapX(300, 800, 1)).toBe(300);
    expect(snapX(400 + SNAP_PX, 800, 1)).toBe('centre');
    expect(snapX(400 + SNAP_PX + 1, 800, 1)).toBe(409);
  });
});

describe('requestFrom — the accepted message’s fields', () => {
  test('a clean place-component becomes a request; anything else is null', () => {
    expect(requestFrom({ dgn: 'place-component', component: 'Chip', mode: 'selection' })).toEqual({
      component: 'Chip',
      label: 'Chip',
      variant: null,
      glyph: null,
      mode: 'selection',
    });
    expect(requestFrom({ dgn: 'place-component', component: 7, mode: 'ghost' })).toBeNull();
    expect(requestFrom({ dgn: 'place-component', component: 'Chip', mode: 'x' })).toBeNull();
    expect(requestFrom(null)).toBeNull();
  });
});

describe('askForSelection — ↵ into the selected frame', () => {
  const sel = (o: Record<string, unknown>) => ({ selector: 's', ...o }) as never;
  test('one selected object: it is the container', () => {
    const r = askForSelection(REQ, [sel({ id: 'hero', artboardId: 'desktop' })]);
    expect(r).toEqual({
      ask: {
        op: 'component.insert',
        targets: [{ artboard: 'desktop', element: 'hero' }],
        params: { component: 'Button', variant: 'primary' },
      },
    });
  });
  test('a selected artboard is the container too', () => {
    const r = askForSelection(REQ, [sel({ artboardId: 'desktop' })]);
    expect(r).toMatchObject({ ask: { targets: [], params: { artboard: 'desktop' } } });
  });
  test('nothing or several: a plain line, no ask', () => {
    expect(askForSelection(REQ, [])).toEqual({ line: NEEDS_FRAME_LINE });
    expect(
      askForSelection(REQ, [sel({ id: 'a', artboardId: 'x' }), sel({ id: 'b', artboardId: 'x' })])
    ).toEqual({ line: ONE_FRAME_LINE });
  });
});

function fakeBody(
  width: number,
  drawn: { left: number; top: number; width: number; height: number }
) {
  const body = document.createElement('div');
  body.className = 'dc-artboard-body';
  Object.defineProperty(body, 'offsetWidth', { value: width });
  body.getBoundingClientRect = () =>
    ({
      ...drawn,
      right: drawn.left + drawn.width,
      bottom: drawn.top + drawn.height,
      x: drawn.left,
      y: drawn.top,
      toJSON() {},
    }) as DOMRect;
  const art = document.createElement('article');
  art.setAttribute('data-dc-screen', 'story');
  art.appendChild(body);
  document.body.appendChild(art);
  return { body, art };
}

describe('dropAt / askForDrop', () => {
  test('a click on bare artboard is placed freely, snapped to the centre; position is world px', () => {
    const { body, art } = fakeBody(1080, { left: 100, top: 50, width: 389, height: 691 }); // zoom 0.36
    const inner = document.createElement('p');
    body.appendChild(inner);
    const doc = { elementsFromPoint: () => [inner, body, art] } as unknown as Document;
    const drop = dropAt(doc, 295, 300);
    expect(drop).toMatchObject({ artboard: 'story', frame: null });
    // (295 - 100) / 0.36 = 541 → within 8 screen px of the middle (540)
    const ask = askForDrop(REQ, drop as never, { x: 295, y: 300 }) as EditOpAsk;
    expect(ask.params).toMatchObject({
      component: 'Button',
      variant: 'primary',
      artboard: 'story',
    });
    const at = ask.params?.at as { x: unknown; y: number };
    expect(at.x).toBe('centre');
    expect(at.y).toBe(Math.round((300 - 50) / (389 / 1080)));
    expect(ask.targets).toEqual([]);
    art.remove();
  });

  test('away from the middle it is a plain x', () => {
    const { body, art } = fakeBody(800, { left: 0, top: 0, width: 800, height: 500 });
    const doc = { elementsFromPoint: () => [body] } as unknown as Document;
    const ask = askForDrop(REQ, dropAt(doc, 120, 40) as never, { x: 120, y: 40 }) as EditOpAsk;
    expect(ask.params?.at).toEqual({ x: 120, y: 40 });
    art.remove();
  });

  test('over an auto-layout frame the drop goes INTO it, in the flow (no position)', () => {
    const { body, art } = fakeBody(800, { left: 0, top: 0, width: 800, height: 500 });
    const frame = document.createElement('section');
    frame.setAttribute('data-cd-id', 'hero');
    frame.style.display = 'flex';
    body.appendChild(frame);
    const kid = document.createElement('b');
    frame.appendChild(kid);
    const doc = { elementsFromPoint: () => [kid, frame, body] } as unknown as Document;
    const win = {
      getComputedStyle: (el: Element) => ({
        display: (el as HTMLElement).style.display || 'block',
      }),
    } as unknown as Window;
    const drop = dropAt(doc, 10, 10, win);
    expect(drop?.frame).toBe(frame);
    const ask = askForDrop(REQ, drop as never, { x: 10, y: 10 }) as EditOpAsk;
    expect(ask.targets).toEqual([{ artboard: 'story', element: 'hero' }]);
    expect(ask.params).not.toHaveProperty('at');
    art.remove();
  });

  test('a click outside every artboard is no drop', () => {
    const doc = { elementsFromPoint: () => [document.body] } as unknown as Document;
    expect(dropAt(doc, 1, 1)).toBeNull();
  });
});

describe('runPlace — one placement, one undo step', () => {
  const ok = (over: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
    ok: true,
    actionId: null,
    writeId: 'w_1',
    rev: 'r',
    refs: [],
    created: [{ artboard: 'story', element: 'button' }],
    ...over,
  });
  const ask: EditOpAsk = {
    op: 'component.insert',
    targets: [],
    params: { component: 'Button', artboard: 'story' },
  };

  test('one ask, one record, the new instance selected', async () => {
    const asked: EditOpAsk[] = [];
    const records: unknown[] = [];
    const selected: unknown[] = [];
    await runPlace(REQ, ask, {
      run: async (a) => {
        asked.push(a);
        return ok();
      },
      record: (r) => records.push(r),
      select: (r) => selected.push(r),
    });
    expect(asked).toEqual([ask]);
    expect(records).toEqual([
      { kind: 'edit-op', label: 'Place Tlačítko · Plné', payload: { writeId: 'w_1' } },
    ]);
    expect(selected).toEqual([[{ artboard: 'story', element: 'button' }]]);
  });

  test('on the op log the kernel action owns the undo: no iframe record', async () => {
    const records: unknown[] = [];
    await runPlace(REQ, ask, {
      run: async () => ok({ actionId: 'act_9' }),
      record: (r) => records.push(r),
    });
    expect(records).toEqual([]);
  });

  test('a refusal says its line once and records nothing', async () => {
    const toasts: string[] = [];
    const records: unknown[] = [];
    const r = await runPlace(REQ, ask, {
      run: async () => ({
        ok: false,
        code: 'invalid',
        message: 'That object cannot hold anything; select a frame.',
      }),
      toast: (m) => toasts.push(m),
      record: (x) => records.push(x),
    });
    expect(r.ok).toBe(false);
    expect(toasts).toEqual(['That object cannot hold anything; select a frame.']);
    expect(records).toEqual([]);
  });
});
