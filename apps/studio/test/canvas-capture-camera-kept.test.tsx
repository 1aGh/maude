// r2-export-size-race — a camera the capture placed is the capture's.
//
// Every export shim (bin/_png-playwright.mjs, _svg/_pdf/_thumbs/_ds-prove) zeroes `.dc-world`'s zoom and
// transform straight in the DOM, then shrinks the viewport to the artboard it captures. The runtime's
// boot-fit-follows-the-host re-fit (p8-edit-multi-flake) still believed the camera was its own boot fit and
// answered that resize by re-fitting the whole canvas into the artboard-sized viewport: the PNG showed the
// canvas shrunk into the artboard's box (always), and on a loaded machine the clip was measured after the
// re-fit too, so the file came out a fraction of the artboard (107×81 for 402×302 on the mini). A world
// style the runtime did not write is never re-fitted.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

type Fire = () => void;

describe('a capture keeps the camera it placed', () => {
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

  test('a world reset to zoom 1 outside the runtime survives a host resize', async () => {
    const { DesignCanvas, DCArtboard } = canvasLib;
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCArtboard id="fixed" label="FIXED" width={480} height={320} fixed>
            <div>body</div>
          </DCArtboard>
        </DesignCanvas>
      );
    });
    const host = mount.querySelector('.dc-canvas') as HTMLElement;
    const world = mount.querySelector('.dc-world') as HTMLElement;
    expect(host).not.toBeNull();
    expect(world).not.toBeNull();
    // the boot fit of 480 x 320 into the 300 x 150 host is the runtime's own camera
    expect(world.style.zoom || world.style.transform).not.toBe('');

    // what the capture shim does: zoom 1, no pan, written into the DOM …
    world.style.zoom = '1';
    world.style.transform = 'none';
    // … then the viewport shrinks to the artboard (480 x 320 + the 1 px frame)
    size.w = 482;
    size.h = 322;
    await act(async () => {
      for (const f of fires) if (f.target === host) f.fire();
    });
    expect({ zoom: world.style.zoom, transform: world.style.transform }).toEqual({
      zoom: '1',
      transform: 'none',
    });

    await act(async () => root.unmount());
  });
});
