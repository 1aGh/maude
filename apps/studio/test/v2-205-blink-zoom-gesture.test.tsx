// 2.0.5 W2 — on Blink a ZOOM gesture scales the world's composited layer; CSS `zoom` comes back on settle.
//
// Measured on a 714-element annotations board (spike 2.0.5-annot-zoom, Chromium studio lane): CSS `zoom`
// re-lays-out the whole world on every zoom frame (~2,400 dirty layout objects a frame), so zoom p95 sat at
// 33 ms — every other frame dropped. A `transform: scale()` on the already-promoted `.dc-world` layer
// re-lays-out nothing; CSS `zoom` is written back once the gesture settles so text re-rasters crisp and every
// reader of the settled camera (the export shims, `screenshot.sh`, `__maudeCanvasRects`) sees exactly the
// camera it saw before. `data-dc-scale` says which path the world is on at every moment (it was stale: it
// read 'zoom' while the world carried a transform scale). A pure pan never leaves CSS `zoom`.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

// happy-dom's WheelEvent drops the MouseEvent half of its init (ctrlKey, clientX…), so set them on the event
const wheel = (target: Element, init: WheelEventInit) => {
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

describe('the Blink zoom gesture', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    // Blink: no Apple vendor, no GestureEvent (canvas-lib picks its engine branch once, at import)
    Object.defineProperty(window.navigator, 'vendor', {
      configurable: true,
      get: () => 'Google Inc.',
    });
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  async function mount() {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
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
    return { root, canvas, world };
  }

  test('mid-zoom: no CSS zoom, a transform scale; settled: CSS zoom back, the scale gone', async () => {
    const { root, canvas, world } = await mount();
    expect(world.style.zoom).not.toBe('');
    expect(world.getAttribute('data-dc-scale')).toBe('zoom');

    await act(async () => {
      for (let i = 0; i < 4; i++) wheel(canvas, { deltaY: -20, ctrlKey: true });
    });
    // mid-gesture (inside the 220 ms quiet): the layer is scaled, nothing re-lays-out
    expect(world.style.zoom).toBe('');
    expect(world.style.transform).toMatch(/translate\([^)]*\) scale\([\d.]+\)/);
    expect(world.style.transformOrigin).toBe('0 0');
    expect(world.getAttribute('data-dc-scale')).toBe('transform');
    const midZoom = Number(/scale\(([\d.]+)\)/.exec(world.style.transform)?.[1]);
    expect(midZoom).toBeGreaterThan(0);
    expect(world.style.getPropertyValue('--dc-zoom')).toBe(String(midZoom));

    await sleep(320);
    // settled: CSS zoom carries the scale again, the transform is a bare pan
    expect(world.style.zoom).toBe(String(midZoom));
    expect(world.style.transform).not.toContain('scale');
    expect(world.style.transform).toMatch(/^translate\(/);
    expect(world.style.transformOrigin).toBe('');
    expect(world.getAttribute('data-dc-scale')).toBe('zoom');
    // the runtime still owns this camera (a capture shim's own write would read false)
    expect(canvasLib.worldPlacedByRuntime(world)).toBe(true);

    await act(async () => root.unmount());
  });

  test('a pure pan never leaves CSS zoom', async () => {
    const { root, canvas, world } = await mount();
    const zoomBefore = world.style.zoom;
    expect(zoomBefore).not.toBe('');
    await act(async () => {
      for (let i = 0; i < 4; i++) wheel(canvas, { deltaX: 15, deltaY: 25 });
    });
    expect(world.style.zoom).toBe(zoomBefore);
    expect(world.style.transform).not.toContain('scale');
    expect(world.getAttribute('data-dc-scale')).toBe('zoom');
    await sleep(320);
    expect(world.style.zoom).toBe(zoomBefore);
    await act(async () => root.unmount());
  });
});
