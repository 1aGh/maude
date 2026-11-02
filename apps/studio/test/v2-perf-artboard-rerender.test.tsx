// V2-8.8 — a pan/zoom gesture re-renders no artboard (the fit-all raster cost, decision
// v2-2.20-fit-all-raster-cost).
//
// Measured on the Alligators-scale fixture (21 and 64 boards, fit-all, Chromium studio shell): one
// 100-frame gesture rendered DCArtboard 1,785 / 5,440 times in v2 against 966 / 2,944 before it, with
// the median frame twice as slow on the 64-board canvas. A burst's start and end flip `isInteracting`
// and publish the viewport; DCArtboard was subscribed to the WHOLE viewport controller
// (`useViewportControllerContext()`, its value unused), so every flip re-rendered every board. The
// canvas's own invariant — "a gesture is render-free for the artboards" — is the thing pinned here,
// through the page-owned counter (`window.__dcPerf`) the perf tool reads.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

describe('DCArtboard under a viewport gesture', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('wheel burst (start → settle → publish) renders each artboard at most once more, not per flip', async () => {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const BOARDS = 12;
    const counters = { artboardRenders: 0, annotationRenders: 0 };
    (window as unknown as { __dcPerf: typeof counters }).__dcPerf = counters;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCSection id="s" title="S">
            {Array.from({ length: BOARDS }, (_, i) => (
              <DCArtboard key={`a${i}`} id={`a${i}`} label={`A${i}`} width={200} height={150}>
                <div>board {i}</div>
              </DCArtboard>
            ))}
          </DCSection>
        </DesignCanvas>
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    const canvas = document.querySelector('.dc-canvas');
    expect(canvas).not.toBeNull();
    const before = counters.artboardRenders;
    expect(before).toBeGreaterThan(0); // the counter is wired: the boards rendered at least once

    // three separate bursts — each one flips isInteracting on, then (after the 220 ms quiet) off and
    // publishes the viewport; that was 3 × (flip + flip + publish) re-renders of every board
    for (let burst = 0; burst < 3; burst++) {
      await act(async () => {
        for (let i = 0; i < 6; i++) {
          canvas?.dispatchEvent(
            new window.WheelEvent('wheel', {
              deltaX: 0,
              deltaY: 20,
              ctrlKey: true,
              clientX: 100,
              clientY: 100,
              bubbles: true,
              cancelable: true,
            })
          );
        }
      });
      await act(async () => {
        await new Promise((r) => setTimeout(r, 320));
      });
    }
    const delta = counters.artboardRenders - before;
    await act(async () => root.unmount());
    // The boards may re-render for a real reason (a settled viewport changes LOD) — but not once per
    // interaction flip: well under 3 bursts × 3 flips × BOARDS.
    expect(delta).toBeLessThanOrEqual(BOARDS * 3);
  });
});
