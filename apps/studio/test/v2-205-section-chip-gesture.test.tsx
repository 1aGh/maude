// 2.0.5 W2 — a section's title chip holds its screen size through CSS, not through React.
//
// The chip is counter-scaled chrome: it must stay a constant number of screen px while the world zooms.
// It took the live zoom from `useLiveViewport()`, so every one of a board's sections re-rendered at the
// ~20 Hz ticker through every pan/zoom gesture (52 chips on the spike's 714-element board). It is now drawn
// once at its screen size and scaled by `scale(calc(1 / var(--dc-zoom)))`; the viewport controller feeds
// `--dc-zoom` straight onto each chip on every camera write, so the chip still reads the live zoom where the
// annotation scene stops the world's `--dc-zoom` from reaching its ~2,400 elements (W1). A gesture renders
// no chip.
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

describe('section chips under a gesture', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');
  let sceneMod: typeof import('../annotations/ui/scene.tsx');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    canvasLib = await import('../canvas-lib.tsx');
    sceneMod = await import('../annotations/ui/scene.tsx');
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test('a zoom + pan burst renders no chip; the chip scales by the live --dc-zoom fed onto it', async () => {
    const { DesignCanvas, DCSection, DCArtboard } = canvasLib;
    const { AnnotationScene } = sceneMod;
    const SECTIONS = 6;
    const counters: Record<string, number> = { artboardRenders: 0, annotationRenders: 0 };
    (window as unknown as { __dcPerf: typeof counters }).__dcPerf = counters;
    const items = Array.from({ length: SECTIONS }, (_, i) => ({
      el: {
        id: `sec${i}`,
        type: 'section',
        index: `a${i}`,
        label: `Section ${i}`,
        color: '#a9dbdb',
        x: i * 500,
        y: 0,
        w: 400,
        h: 300,
      },
    }));
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
    const chips = [...el.querySelectorAll<HTMLElement>('[data-section-chip]')];
    expect(chips).toHaveLength(SECTIONS);
    const before = counters.sectionChipRenders ?? 0;
    expect(before).toBeGreaterThanOrEqual(SECTIONS); // the counter is wired

    // a gesture over ~10 ticker frames: zoom in, pan, zoom out
    for (let i = 0; i < 10; i++) {
      await act(async () => {
        wheel(
          canvas,
          i % 3 === 1 ? { deltaX: 10, deltaY: 6 } : { deltaY: i < 5 ? -20 : 15, ctrlKey: true }
        );
        await new Promise((r) => setTimeout(r, 30));
      });
    }
    expect((counters.sectionChipRenders ?? 0) - before).toBe(0);

    // the chip is screen-sized by CSS, from the live zoom written onto the chip itself
    const zoomNow = world.style.getPropertyValue('--dc-zoom');
    expect(zoomNow).not.toBe('');
    for (const chip of chips) {
      expect(chip.style.transform).toBe('scale(calc(1 / var(--dc-zoom, 1)))');
      expect(chip.style.getPropertyValue('--dc-zoom')).toBe(zoomNow);
    }

    await sleep(320);
    // the settle publishes the viewport; a chip has nothing to re-render for
    expect((counters.sectionChipRenders ?? 0) - before).toBe(0);
    for (const chip of chips)
      expect(chip.style.getPropertyValue('--dc-zoom')).toBe(
        world.style.getPropertyValue('--dc-zoom')
      );
    await act(async () => root.unmount());
  });
});
