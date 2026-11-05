// 2.0.5 W2 — on WebKit (Safari, the WKWebView desktop app) the section title chip keeps its old path.
//
// On Blink the chip is drawn once at screen size and counter-scaled by CSS with a per-frame `--dc-zoom`
// (v2-205-section-chip-gesture). On WebKit that per-frame transform was not shown to be free — the WebKit
// A/B under load did not separate it from the old React-sized chip, and the chip-layer variant did not help —
// and the desktop app is WebKit, so WebKit stays exactly as it was: the chip is sized from the live zoom
// (font size, height and offset divided by the zoom), with no CSS counter-scale.
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

describe('the section chip on WebKit', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');
  let sceneMod: typeof import('../annotations/ui/scene.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    Object.defineProperty(window.navigator, 'vendor', {
      configurable: true,
      get: () => 'Apple Computer, Inc.',
    });
    canvasLib = await import('../canvas-lib.tsx');
    sceneMod = await import('../annotations/ui/scene.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('sized from the live zoom, no CSS counter-scale', async () => {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const { AnnotationScene } = sceneMod;
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    const items = [
      {
        el: {
          id: 'sec',
          type: 'section',
          index: 'a0',
          label: 'Feedback',
          color: '#a9dbdb',
          x: 0,
          y: 0,
          w: 400,
          h: 300,
        },
      },
    ];
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCSection id="s" title="S">
            <DCArtboard id="a" label="A" width={200} height={150}>
              <div>board</div>
            </DCArtboard>
          </DCSection>
          <AnnotationScene
            items={items as never}
            interactive
            quiet={false}
            editingId={null}
            edit={null}
            pending={null}
            resolveAsset={(h: string) => h}
          />
        </DesignCanvas>
      );
    });
    await sleep(50);
    const canvas = el.querySelector('.dc-canvas') as HTMLElement;
    const world = el.querySelector('.dc-world') as HTMLElement;
    for (let i = 0; i < 4; i++) {
      await act(async () => {
        wheel(canvas, { deltaY: -20, ctrlKey: true });
        await new Promise((r) => setTimeout(r, 30));
      });
    }
    await sleep(320);
    const zoom = Number(world.style.getPropertyValue('--dc-zoom'));
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).not.toBe(1);
    const chip = el.querySelector('[data-section-chip]') as HTMLElement;
    expect(chip.style.transform).toBe('');
    expect(chip.style.getPropertyValue('--dc-zoom')).toBe('');
    const title = chip.querySelector('.dc-annot-text') as HTMLElement;
    expect(Number.parseFloat(title.style.fontSize)).toBeCloseTo(12 / zoom, 6);
    expect(Number.parseFloat(chip.style.height)).toBeCloseTo(20 / zoom, 6);
    await act(async () => root.unmount());
  });
});
