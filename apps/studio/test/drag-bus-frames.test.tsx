// S2.9b — live drag frames on the DragStateBus (contract client/v2/contracts/S2-S4-artboard-motion-ids.md
// §1): `start → move* → end` per gesture, at most one frame per animation frame, emitted BEFORE the
// React update, `cancel` on esc (nothing committed), `alt` on ⌥-drag, and a subscriber is called
// outside React — it never re-renders per frame.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { createDragBusCore, type DragBusCore, type DragFrame } from '../drag-bus.ts';
import { type DragState, useArtboardDrag } from '../use-artboard-drag.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const RECTS = [
  { id: 'desktop', x: 0, y: 0, w: 640, h: 480 },
  { id: 'mobile', x: 2000, y: 2000, w: 390, h: 844 },
];
const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

interface Harness {
  bus: DragBusCore;
  frames: DragFrame[];
  /** The hook's React state at the moment each frame arrived (frame-before-render). */
  stateAtFrame: DragState['kind'][];
  commits: Array<{ moved: { id: string; x: number; y: number }[]; alt: boolean }>;
  subscriberRenders: { n: number };
  handle: () => HTMLElement;
}

async function mount(): Promise<Harness> {
  const bus = createDragBusCore({ layout: () => RECTS, commit: () => {} });
  const h: Harness = {
    bus,
    frames: [],
    stateAtFrame: [],
    commits: [],
    subscriberRenders: { n: 0 },
    handle: () => document.querySelector('[data-testid="handle"]') as HTMLElement,
  };
  function Board() {
    const kind = useRef<DragState['kind']>('idle');
    const drag = useArtboardDrag({
      artboardId: 'desktop',
      selected: [],
      rectFor: (id) => RECTS.find((r) => r.id === id) ?? null,
      allRects: RECTS,
      viewport: { zoom: 1 },
      enabled: true,
      gridSize: 1,
      tolerance: 0,
      onFrame: (f) => {
        h.stateAtFrame.push(kind.current);
        bus.emitFrame(f);
      },
      onCommit: (moved, info) => void h.commits.push({ moved, alt: info.alt }),
    });
    kind.current = drag.dragState.kind;
    return <div data-testid="handle" style={{ width: 100, height: 20 }} {...drag.bindHandle()} />;
  }
  function Subscriber() {
    h.subscriberRenders.n++;
    useEffect(() => bus.subscribeFrames((f) => void h.frames.push(f)), []);
    return null;
  }
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      <>
        <Board />
        <Subscriber />
      </>
    )
  );
  return h;
}

const pointer = (type: string, x: number, y: number, extra: Record<string, unknown> = {}) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...extra,
  });

async function down(h: Harness, x = 10, y = 10) {
  await act(async () => void h.handle().dispatchEvent(pointer('pointerdown', x, y)));
}
async function moves(points: Array<[number, number]>, extra: Record<string, unknown> = {}) {
  await act(async () => {
    for (const [x, y] of points) window.dispatchEvent(pointer('pointermove', x, y, extra));
    await frame();
    await frame();
  });
}

describe('DragStateBus frames', () => {
  test('start → move* → end, one frame per animation frame, emitted before React renders it', async () => {
    const h = await mount();
    await down(h);
    // Several pointer moves inside one animation frame → ONE frame (the start).
    await moves([
      [20, 10],
      [40, 10],
      [60, 10],
    ]);
    expect(h.frames.map((f) => f.phase)).toEqual(['start']);
    expect(h.frames[0]?.moved).toEqual([{ id: 'desktop', dx: 50, dy: 0 }]);
    await moves([
      [80, 30],
      [110, 40],
    ]);
    expect(h.frames.map((f) => f.phase)).toEqual(['start', 'move']);
    expect(h.frames[1]?.moved).toEqual([{ id: 'desktop', dx: 100, dy: 30 }]);
    // The frame arrives while React still shows the previous state (the ghost renders after).
    expect(h.stateAtFrame).toEqual(['pending', 'dragging']);
    // One start-rect object for the whole gesture.
    expect(h.frames[1]?.startRects).toBe(h.frames[0]?.startRects);
    expect(h.frames[0]?.startRects).toEqual({ desktop: { x: 0, y: 0, w: 640, h: 480 } });

    await act(async () => void window.dispatchEvent(pointer('pointerup', 110, 40)));
    expect(h.frames.map((f) => f.phase)).toEqual(['start', 'move', 'end']);
    expect(h.commits).toEqual([{ moved: [{ id: 'desktop', x: 100, y: 30 }], alt: false }]);
    // The subscriber was called three times and rendered once.
    expect(h.subscriberRenders.n).toBe(1);
  });

  test('esc cancels: a cancel frame, the artboard snaps back, nothing is committed', async () => {
    const h = await mount();
    await down(h);
    await moves([[90, 60]]);
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(h.frames.map((f) => f.phase)).toEqual(['start', 'cancel']);
    expect(h.frames[1]?.moved).toEqual([{ id: 'desktop', dx: 0, dy: 0 }]);
    await act(async () => void window.dispatchEvent(pointer('pointerup', 90, 60)));
    expect(h.commits).toEqual([]);
    expect(h.frames.length).toBe(2);
  });

  test('a lost pointer cancels too; a click under the threshold sends no frame at all', async () => {
    const h = await mount();
    await down(h);
    await moves([[12, 11]]); // under the 4 px threshold
    await act(async () => void window.dispatchEvent(pointer('pointerup', 12, 11)));
    expect(h.frames).toEqual([]);
    await down(h);
    await moves([[70, 10]]);
    await act(async () => void window.dispatchEvent(pointer('pointercancel', 70, 10)));
    expect(h.frames.map((f) => f.phase)).toEqual(['start', 'cancel']);
    expect(h.commits).toEqual([]);
  });

  test('⌥-drag sets `alt` on every frame and on the commit', async () => {
    const h = await mount();
    await down(h);
    await moves([[60, 10]], { altKey: true });
    await act(async () => void window.dispatchEvent(pointer('pointerup', 60, 10)));
    expect(h.frames.map((f) => [f.phase, f.alt])).toEqual([
      ['start', true],
      ['end', true],
    ]);
    expect(h.commits[0]?.alt).toBe(true);
  });
});
