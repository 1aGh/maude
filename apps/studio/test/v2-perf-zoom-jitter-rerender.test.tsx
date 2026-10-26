// V2-8.8 — sub-pixel ResizeObserver noise during a pinch re-renders no artboard.
//
// Under Blink's CSS `zoom` (the canvas's Chromium scale path) the frame's ResizeObserver fires on every zoom
// frame with layout noise — a 1280 x 800 board reads 1279.875 x 799.89, then 1279.92 x 799.98 … (measured in
// the studio, 37 callbacks / 17 distinct sizes over a 40-frame zoom). `useArtboardBounds` stored a fresh
// object each time, so every board re-rendered about twice per pinch frame: 1,554 artboard renders in one
// 40-frame zoom on the 21-board fixture, the bulk of v2's 1.8x render count against pre-v2.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

type Fire = (w: number, h: number) => void;

describe('DCArtboard under sub-pixel resize noise', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');
  const fires: { target: Element; fire: Fire }[] = [];

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    // a ResizeObserver the test drives by hand
    class FakeRO {
      cb: (entries: { contentRect: { width: number; height: number } }[]) => void;
      constructor(cb: FakeRO['cb']) {
        this.cb = cb;
      }
      observe(target: Element) {
        fires.push({
          target,
          fire: (width, height) => this.cb([{ contentRect: { width, height } }]),
        });
      }
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('a pinch of sub-pixel noise renders no board; a real size change still does', async () => {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const BOARDS = 6;
    const counters = { artboardRenders: 0, annotationRenders: 0 };
    (window as unknown as { __dcPerf: typeof counters }).__dcPerf = counters;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCSection id="s" title="S">
            {['a0', 'a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => (
              <DCArtboard key={id} id={id} label={`A${i}`} width={1280} height={800} fixed>
                <div>board {i}</div>
              </DCArtboard>
            ))}
          </DCSection>
        </DesignCanvas>
      );
    });
    const boards = () => fires.filter((f) => f.target.matches?.('article.dc-artboard'));
    expect(boards().length).toBe(BOARDS);
    // the first real measure
    await act(async () => {
      for (const b of boards()) b.fire(1280, 800);
    });
    const before = counters.artboardRenders;

    // 40 pinch frames of layout noise, as Blink reports them
    await act(async () => {
      for (let f = 0; f < 40; f++) {
        const n = (f % 7) * 0.02;
        for (const b of boards()) b.fire(1279.875 + n, 799.89 + n);
      }
    });
    expect(counters.artboardRenders - before).toBe(0);

    // the board really grew: it re-measures
    await act(async () => {
      boards()[0]?.fire(1280, 900);
    });
    expect(counters.artboardRenders - before).toBeGreaterThan(0);
    await act(async () => root.unmount());
  });
});
