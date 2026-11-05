// 2.0.5 W2 — the Blink zoom-gesture transform must not change the WebKit path (Safari + the WKWebView
// desktop shell). WebKit was always `transform: translate() scale()` with no CSS `zoom`: mid-gesture the
// layer stays promoted (`will-change: transform`), settled it is released (`auto`) so text re-rasters crisp,
// and the world says `data-dc-scale="transform"` the whole time.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

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

describe('the WebKit zoom gesture is unchanged', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Object.defineProperty(window.navigator, 'vendor', {
      configurable: true,
      get: () => 'Apple Computer, Inc.',
    });
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('transform scale throughout, never CSS zoom; will-change transform mid-gesture, auto settled', async () => {
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
    expect(world.style.zoom).toBe('');
    expect(world.getAttribute('data-dc-scale')).toBe('transform');

    await act(async () => {
      for (let i = 0; i < 4; i++) wheel(canvas, { deltaY: -20, ctrlKey: true });
    });
    expect(world.style.zoom).toBe('');
    expect(world.style.transformOrigin).toBe('0 0');
    expect(world.style.transform).toMatch(/translate\([^)]*\) scale\([\d.]+\)/);
    expect(world.style.willChange).toBe('transform');
    expect(world.getAttribute('data-dc-scale')).toBe('transform');
    const midZoom = /scale\(([\d.]+)\)/.exec(world.style.transform)?.[1];

    await sleep(320);
    expect(world.style.zoom).toBe('');
    expect(world.style.transformOrigin).toBe('0 0');
    expect(world.style.transform).toContain(`scale(${midZoom})`);
    expect(world.style.willChange).toBe('auto');
    expect(world.getAttribute('data-dc-scale')).toBe('transform');
    await act(async () => root.unmount());
  });
});
