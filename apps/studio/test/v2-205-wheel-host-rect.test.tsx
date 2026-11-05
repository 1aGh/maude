// 2.0.5 W2 — the wheel handler reads no layout.
//
// `onWheel` read `host.getBoundingClientRect()` (and `clientWidth`/`clientHeight`) on every wheel event. The
// frame before had just written a new camera, so each read forced a synchronous style + layout of the whole
// world inside the input handler. The host's box is now cached — measured at mount, refreshed by a
// ResizeObserver (and on a window resize/scroll, which move it without resizing it) — and the handler only
// reads the cache. The zoom still anchors on the pointer, through the cached box.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

const wheel = (target: Element, init: WheelEventInit & { clientX?: number; clientY?: number }) => {
  const e = new window.WheelEvent('wheel', { bubbles: true, cancelable: true, ...init });
  const extra = {
    clientX: 100,
    clientY: 100,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...init,
  };
  for (const k of ['clientX', 'clientY', 'ctrlKey', 'metaKey', 'shiftKey'] as const)
    Object.defineProperty(e, k, { value: extra[k] });
  return target.dispatchEvent(e);
};
const sleep = (ms: number) => act(async () => await new Promise((r) => setTimeout(r, ms)));

describe('the wheel handler and the host box', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');
  const fires: { target: Element; fire: () => void }[] = [];

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Object.defineProperty(window.navigator, 'vendor', {
      configurable: true,
      get: () => 'Google Inc.',
    });
    class FakeRO {
      cb: (entries: unknown[]) => void;
      constructor(cb: FakeRO['cb']) {
        this.cb = cb;
      }
      observe(target: Element) {
        fires.push({ target, fire: () => this.cb([{ target }]) });
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

  test('no layout read inside a wheel burst; the zoom anchors on the pointer through the cached box', async () => {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const box = { left: 0, top: 0, width: 300, height: 200 };
    const reads = { rect: 0, size: 0 };
    // every host box read is counted — on the prototype, so the host React creates is covered from mount
    const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
    const isHost = (el: Element) => el.classList?.contains('dc-canvas');
    const origRect = window.HTMLElement.prototype.getBoundingClientRect;
    proto.getBoundingClientRect = function (this: HTMLElement) {
      if (!isHost(this)) return origRect.call(this);
      reads.rect++;
      return {
        ...box,
        x: box.left,
        y: box.top,
        right: box.left + box.width,
        bottom: box.top + box.height,
        toJSON() {},
      } as DOMRect;
    };
    for (const k of ['clientWidth', 'clientHeight'] as const)
      Object.defineProperty(window.HTMLElement.prototype, k, {
        configurable: true,
        get(this: HTMLElement) {
          if (!isHost(this)) return 0;
          reads.size++;
          return k === 'clientWidth' ? box.width : box.height;
        },
      });

    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCSection id="s" title="S">
            <DCArtboard id="a" label="A" width={200} height={150}>
              <div>board</div>
            </DCArtboard>
          </DCSection>
        </DesignCanvas>
      );
    });
    await sleep(50);
    const canvas = el.querySelector('.dc-canvas') as HTMLElement;
    const world = el.querySelector('.dc-world') as HTMLElement;

    // the host moves (a panel opened beside it): the observer delivers the new box
    box.left = 40;
    box.top = 30;
    await act(async () => {
      for (const f of fires) if (f.target === canvas) f.fire();
    });
    const vp0 = canvasLib.getLiveViewport?.() ?? null;
    expect(vp0).not.toBeNull();
    const { x: x0, y: y0, zoom: z0 } = vp0 as { x: number; y: number; zoom: number };

    reads.rect = 0;
    reads.size = 0;
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        wheel(canvas, { deltaY: -20, ctrlKey: true, clientX: 140, clientY: 130 });
        wheel(canvas, { deltaX: 3, deltaY: 2, deltaMode: 1 }); // line-mode pan reads the host size
      }
    });
    expect(reads).toEqual({ rect: 0, size: 0 });

    // pans first, then zooms about the pointer (140,130) in the page = (100,100) in the host's cached box:
    // replay the burst on the camera math and compare with where the world went
    const vp1 = canvasLib.getLiveViewport?.() as { x: number; y: number; zoom: number };
    expect(vp1.zoom).toBeGreaterThan(z0);
    let x = x0;
    let y = y0;
    let z = z0;
    const K = vp1.zoom; // the final zoom is exact; replay positions with the same factors
    const f = Math.exp((Math.log(K) - Math.log(z0)) / 5);
    for (let i = 0; i < 5; i++) {
      const nz = z * f;
      x = 100 - ((100 - x) / z) * nz;
      y = 100 - ((100 - y) / z) * nz;
      z = nz;
      // line-mode pan: 3 lines × 16 px … whatever wheelDeltaToPixels says, both axes move the same way each step
      const px = canvasLib.wheelDeltaToPixels(3, 1, box.width);
      const py = canvasLib.wheelDeltaToPixels(2, 1, box.height);
      x -= px;
      y -= py;
    }
    expect(vp1.x).toBeCloseTo(x, 3);
    expect(vp1.y).toBeCloseTo(y, 3);
    expect(world.style.transform).toContain('scale(');

    await sleep(320);
    proto.getBoundingClientRect = origRect;
    await act(async () => root.unmount());
  });
});
