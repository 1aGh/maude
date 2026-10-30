// p8-edit-multi-flake — the boot fit follows the host until the camera is moved.
//
// A canvas frame can lay out at an iframe's 300 x 150 default before the shell gives it its real size (the
// V2-8.3 default lane, cd452f4f3: `edit-multi` and `edit-shapes` opened Smoke at zoom 0.31875 — exactly the
// fit of one 480 x 320 artboard into 300 x 150 — and the camera stayed there on the full-window frame, so the
// objects were thumbnail-small under the board's section label and three ⇧-clicks selected nothing). The
// runtime re-fitted only a host that had NO size at mount. Now a camera the runtime placed itself (boot fit,
// boot re-fit, this re-fit) re-fits when the host's size changes, and never once the camera has moved.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

type Fire = () => void;

describe('the boot fit follows the canvas host until the camera moves', () => {
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
    // the canvas host (`.dc-canvas`) measures `size`; nothing else has a box
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

  test('a host that grows from the 300 x 150 placeholder re-fits; a moved camera never does', async () => {
    const { DesignCanvas, DCArtboard, getLiveViewport } = canvasLib;
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
    const resize = async (w: number, h: number) => {
      size.w = w;
      size.h = h;
      await act(async () => {
        for (const f of fires) if (f.target === host) f.fire();
      });
    };

    // the boot fit of 480 x 320 into the placeholder: the zoom the lane recorded
    expect(getLiveViewport()?.zoom).toBeCloseTo(0.31875, 5);

    // the frame gets its real size: the untouched camera follows it (1232 / 480 and 714 / 320 both cap at 1)
    await resize(1280, 762);
    const fitted = getLiveViewport();
    expect(fitted?.zoom).toBe(1);
    expect(fitted?.x).toBe((1280 - 480) / 2);
    expect(fitted?.y).toBe((762 - 320) / 2);

    // a person pans: from now on the host's size never moves the camera
    await act(async () => {
      host.dispatchEvent(
        new window.WheelEvent('wheel', { deltaX: 40, deltaY: 30, bubbles: true, cancelable: true })
      );
    });
    const moved = getLiveViewport();
    expect(moved).not.toEqual(fitted);
    await resize(900, 600);
    expect(getLiveViewport()).toEqual(moved);

    await act(async () => root.unmount());
  });
});
