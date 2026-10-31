// p8-p84-reds (V2-8.9 final attacker I3) — a camera the PERSON placed never re-fits on a host resize.
//
// p8-edit-multi-flake made the runtime's own boot fit follow the host until the camera moves; the record was
// dropped only lazily, on the next resize that found the camera somewhere else. A person who moved the
// camera and then pressed Fit (⌘0) put it back on exactly the boot fit's camera, so the record survived, and
// the next host resize re-fitted a camera the person had chosen. Any camera move the person makes (a
// gesture, Fit, Actual size, zoom, a jump) drops the record at once.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

type Fire = () => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("a person's own Fit is theirs: the host's size never moves it", () => {
  let canvasLib: typeof import('../canvas-lib.tsx');
  const fires: { target: Element; fire: Fire }[] = [];
  const size = { w: 1280, h: 762 };

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

  test('pan, then ⌘0 back onto the boot fit, then a resize: the camera stays where the person put it', async () => {
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
    const boot = getLiveViewport();
    expect(boot?.zoom).toBe(1);

    // a person pans (no resize happens meanwhile) …
    await act(async () => {
      host.dispatchEvent(
        new window.WheelEvent('wheel', { deltaX: 40, deltaY: 30, bubbles: true, cancelable: true })
      );
    });
    expect(getLiveViewport()).not.toEqual(boot);
    // … and presses Fit: the eased move lands exactly on the boot fit's camera
    await act(async () => {
      document.body.dispatchEvent(
        new window.KeyboardEvent('keydown', {
          key: '0',
          code: 'Digit0',
          metaKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await sleep(450);
    });
    const fitted = getLiveViewport();
    expect(fitted).toEqual(boot);

    // the window resizes: a camera the person chose does not follow it
    size.w = 900;
    size.h = 600;
    await act(async () => {
      for (const f of fires) if (f.target === host) f.fire();
    });
    expect(getLiveViewport()).toEqual(fitted);

    await act(async () => root.unmount());
  });
});
