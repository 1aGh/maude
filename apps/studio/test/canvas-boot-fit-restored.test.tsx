// V2-8.9 final defender I4 — the two guards of the boot fit's resize re-fit that nothing pinned:
//   · a camera RESTORED from the canvas's own view state (`__canvas_meta__.viewport`) is never re-fitted —
//     the runtime did not place it, so a host resize leaves it where the person left it;
//   · a resize that lands while a gesture runs never re-fits (`shouldResizeRefit`'s `interacting`).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { shouldResizeRefit } from '../bridge/canvas-mode-store.ts';

type Fire = () => void;

describe('the boot-fit resize re-fit: a restored camera and a running gesture keep still', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');
  const fires: { target: Element; fire: Fire }[] = [];
  const size = { w: 300, h: 150 };

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
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
    const isHost = (el: Element) => el.classList?.contains('dc-canvas');
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return isHost(this) ? size.w : 0;
      },
    });
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isHost(this) ? size.h : 0;
      },
    });
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('a restored camera stays put when the host grows from the 300 x 150 placeholder', async () => {
    const { DesignCanvas, DCArtboard, getLiveViewport } = canvasLib;
    const restored = { x: 37, y: -12, zoom: 0.5 };
    (window as unknown as { __canvas_meta__?: unknown }).__canvas_meta__ = { viewport: restored };
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCArtboard id="smoke" label="SMOKE" width={480} height={320}>
            <div>body</div>
          </DCArtboard>
        </DesignCanvas>
      );
    });
    const host = mount.querySelector('.dc-canvas') as HTMLElement;
    expect(host).not.toBeNull();
    expect(getLiveViewport()).toEqual(restored);
    size.w = 1280;
    size.h = 762;
    await act(async () => {
      for (const f of fires) if (f.target === host) f.fire();
    });
    expect(getLiveViewport()).toEqual(restored);
    await act(async () => root.unmount());
  });

  test('shouldResizeRefit: never while a gesture runs, even on the exact boot camera', () => {
    const camera = { x: 0, y: 0, zoom: 0.31875 };
    const auto = { camera, w: 300, h: 150 };
    expect(shouldResizeRefit(auto, { ...camera }, false, 1280, 762)).toBe(true);
    expect(shouldResizeRefit(auto, { ...camera }, true, 1280, 762)).toBe(false);
    // and never once the camera is somewhere else, or when the size did not change
    expect(shouldResizeRefit(auto, { ...camera, x: 1 }, false, 1280, 762)).toBe(false);
    expect(shouldResizeRefit(auto, { ...camera }, false, 300, 150)).toBe(false);
  });
});
