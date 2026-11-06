// 2.0.7 mascot WebKit — a slow frame does not end the gesture.
//
// A canvas gesture ends when no wheel/pinch came for 220 ms (markInteracting's quiet timer); the end is the
// settle: the published viewport (every artboard re-renders), WebKit's crisp re-raster (the world drops its
// compositor layer and the next wheel builds it again), the ring's releases and the crowded-layer toggle. On
// the mascot canvas at 10 % a WebKit frame takes 200-450 ms, so the 220 ms timer came due DURING the gesture,
// before the wheel queued behind that frame was handled (a due timer runs before the queued input). Measured
// in Safari (perf --engine safari --studio, 28 artboards on screen): 352-1,584 artboard renders per pan+zoom —
// 4 to 18 settles inside one gesture — where Chromium, whose frames stay under 17 ms, counts 88 (one).
//
// The fix: the quiet timer only ends the gesture once a frame and a task have passed with no new input, so the
// input that waited behind a long frame is handled first and keeps the gesture going.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('the gesture quiet timer and a slow frame', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    // frames as a browser paces them: the next one is a vsync away, never sooner than input already queued
    const raf = (cb: FrameRequestCallback) =>
      setTimeout(() => cb(performance.now()), 16) as unknown as number;
    (globalThis as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = raf;
    (window as unknown as { requestAnimationFrame: unknown }).requestAnimationFrame = raf;
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('a wheel that waited behind a long frame keeps the gesture; it settles once, at the end', async () => {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const counters = { artboardRenders: 0, annotationRenders: 0 };
    (window as unknown as { __dcPerf: typeof counters }).__dcPerf = counters;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCSection id="s" title="S">
            {['a0', 'a1', 'a2'].map((id, i) => (
              <DCArtboard key={id} id={id} label={`A${i}`} width={400} height={300} fixed>
                <div>board {i}</div>
              </DCArtboard>
            ))}
          </DCSection>
        </DesignCanvas>
      );
    });
    await act(async () => {
      await sleep(400);
    });
    const canvas = document.querySelector('.dc-canvas') as HTMLElement;
    expect(canvas).toBeTruthy();
    const target = (canvas.querySelector('.dc-world') as HTMLElement) || canvas;
    const wheel = () =>
      target.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: 12,
          deltaY: 9,
          bubbles: true,
          cancelable: true,
        })
      );
    const before = counters.artboardRenders;
    const world = canvas.querySelector('.dc-world') as HTMLElement;
    const t0 = world.style.transform;

    // Six wheels, each handled just after the 220 ms quiet timer came due — what a 230 ms WebKit frame does:
    // the timer task runs first, the wheel that queued behind the frame right after it.
    await act(async () => {
      for (let i = 0; i < 6; i++) {
        await new Promise<void>((resolve) => {
          wheel();
          setTimeout(() => resolve(), 221);
        });
      }
      wheel();
    });
    expect(world.style.transform).not.toBe(t0); // the wheels landed
    // still one gesture: nothing published, no board re-rendered
    expect(counters.artboardRenders - before).toBe(0);

    // now it is really quiet: one settle
    await act(async () => {
      await sleep(600);
    });
    const settled = counters.artboardRenders - before;
    expect(settled).toBeGreaterThan(0);
    expect(settled).toBeLessThanOrEqual(3);
    await act(async () => root.unmount());
  });
});
