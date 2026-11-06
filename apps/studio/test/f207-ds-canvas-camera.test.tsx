// 2.0.7 fix #6 — the camera half. Michal's StudyFi Design system canvas opened on an empty spot:
//   · with no stored camera, the boot fit framed a 43 000 px wide canvas at 2 % (unreadable);
//   · with a stored camera (`_canvas-state/<slug>.view.json`) from an older layout, it was restored
//     as-is and showed no artboard at all.
// Mounted DesignCanvas, real boot path (getInitial → controller → the deferred stored-camera check).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { cameraShowsContent, READABLE_ZOOM, STORED_CAMERA_CHECK_MS } from '../canvas-camera.ts';
import { SECTIONS } from '../ds/board/types.ts';

const HOST = { w: 1440, h: 900 };

/** The StudyFi meta: seven sections + one row per section (29 component pages in one row). */
function studyfiLayout() {
  const out = SECTIONS.map((s) => ({ id: s.id as string, x: s.x, y: s.y, w: s.w, h: s.h }));
  [2, 8, 1, 5, 2, 29, 11].forEach((n, r) => {
    for (let c = 0; c < n; c++)
      out.push({ id: `ds-own-${r}-${c}`, x: c * 1488, y: 1860 + r * 980, w: 1440, h: 900 });
  });
  return out;
}

describe('a canvas opens on its content', () => {
  type Lib = typeof import('../canvas-lib.tsx');
  // canvas-lib parks the live camera at module scope (RC3, survives a remount): one fresh instance per case.
  let n = 0;
  const freshLib = async (): Promise<Lib> => {
    const spec = `../canvas-lib.tsx?case=${++n}`;
    return (await import(spec)) as Lib;
  };
  let canvasLib: Lib;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    class FakeRO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    const isHost = (el: Element) => el.classList?.contains('dc-canvas');
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return isHost(this) ? HOST.w : 0;
      },
    });
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return isHost(this) ? HOST.h : 0;
      },
    });
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  async function mount(meta: Record<string, unknown>) {
    canvasLib = await freshLib();
    const { DesignCanvas, DCArtboard } = canvasLib;
    (window as unknown as { __canvas_meta__?: unknown }).__canvas_meta__ = meta;
    const layout = studyfiLayout();
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => {
      root.render(
        <DesignCanvas>
          {layout.map((r) => (
            <DCArtboard key={r.id} id={r.id} label={r.id} width={r.w} height={r.h}>
              <div>{r.id}</div>
            </DCArtboard>
          ))}
        </DesignCanvas>
      );
    });
    return { root, layout };
  }

  test('no stored camera: the boot camera is readable and shows artboards', async () => {
    const { root, layout } = await mount({ layout: { artboards: studyfiLayout() } });
    const cam = canvasLib.getLiveViewport();
    expect(cam).not.toBeNull();
    expect(cam?.zoom ?? 0).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(cameraShowsContent(cam as never, HOST.w, HOST.h, layout)).toBe(true);
    await act(async () => root.unmount());
  });

  test('a stored camera that shows nothing is replaced by the default camera', async () => {
    const empty = { x: -4011.93, y: -41325.57, zoom: 0.5991 };
    const { root, layout } = await mount({
      layout: { artboards: studyfiLayout() },
      viewport: empty,
    });
    expect(canvasLib.getLiveViewport()).toEqual(empty); // restored first, as stored
    await act(async () => {
      await new Promise((r) => setTimeout(r, STORED_CAMERA_CHECK_MS + 100));
    });
    const cam = canvasLib.getLiveViewport();
    expect(cam?.zoom ?? 0).toBeGreaterThanOrEqual(READABLE_ZOOM);
    expect(cameraShowsContent(cam as never, HOST.w, HOST.h, layout)).toBe(true);
    await act(async () => root.unmount());
  });

  test('a stored camera that shows an artboard is kept', async () => {
    const onBrand = { x: 100, y: 80, zoom: 0.8 };
    const { root } = await mount({ layout: { artboards: studyfiLayout() }, viewport: onBrand });
    await act(async () => {
      await new Promise((r) => setTimeout(r, STORED_CAMERA_CHECK_MS + 100));
    });
    expect(canvasLib.getLiveViewport()).toEqual(onBrand);
    await act(async () => root.unmount());
  });
});
