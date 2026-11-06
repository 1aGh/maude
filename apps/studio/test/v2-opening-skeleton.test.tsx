// 2.0.7 (B1) — opening a canvas shows every artboard at once as a skeleton at its final place and size, and the
// real canvas replaces them when it reports `canvas-rendered`.
//   1. the geometry IS the frame's: a real DesignCanvas mounted on the same meta + host places its artboards and
//      its boot camera exactly where the skeleton model does (canvas-lib's initialArtboards / getInitial);
//   2. the viewport draws them inside the loading surface and drops them with it on render;
//   3. what cannot be known before the canvas runs (a non-literal size, a dynamic canvas) keeps the card;
//   4. captures: the frame never draws a skeleton (canvas-lib and the shell template carry none), so a capture
//      — a frame with no studio around it — cannot show one;
//   5. reduced motion: no pulse and no fade.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  indexRowOf,
  screenBoards,
  skeletonBoards,
  skeletonCamera,
} from '../client/v2/shell/opening-skeleton.js';

const STUDIO = join(import.meta.dir, '..');
const D = '.design';
const PATH = `${D}/ui/Big.tsx`;
const HOST = { w: 1400, h: 900 };

// seven artboards: four placed by the meta (one with a legacy meta size), three left to the default grid
const JSX_BOARDS = [
  { id: 'a', label: 'A · Inbox', w: 480, h: 320 },
  { id: 'b', label: 'B · Calendar', w: 640, h: 400 },
  { id: 'c', label: 'C · Detail', w: 360, h: 720 },
  { id: 'd', label: 'D · Empty', w: 480, h: 320 },
  { id: 'e', label: 'E', w: 300, h: 200 },
  { id: 'f', label: 'F', w: 300, h: 200 },
  { id: 'g', label: 'G', w: 1024, h: 768 },
];
const META = {
  layout: {
    artboards: [
      { id: 'a', x: 0, y: 0 },
      { id: 'b', x: 560, y: 0 },
      { id: 'c', x: 1280, y: -40, w: 400, h: 760 },
      { id: 'd', x: 40, y: 900 },
    ],
  },
};
const ROW = {
  rel: 'ui/Big.tsx',
  dynamic: false,
  artboardsFrom: 'static',
  artboards: JSX_BOARDS.map((b) => ({ ...b, kind: 'digital' })),
};
const SNAP = { project: { designRel: D }, canvases: [ROW] };

describe('the skeleton model', () => {
  test("the stored viewport is the camera; the index row is found by the canvas's path", () => {
    expect(indexRowOf(SNAP, PATH)).toBe(ROW);
    const boards = skeletonBoards({ row: ROW, meta: META }) ?? [];
    expect(
      skeletonCamera({
        boards,
        width: 800,
        height: 600,
        insets: null,
        viewport: { x: 12, y: -40, zoom: 0.5 },
      })
    ).toEqual({ x: 12, y: -40, zoom: 0.5 });
    // screen px under the camera; a board off the frame is not drawn; a name under 24 screen px collapses
    const shown = screenBoards(boards, { x: 0, y: 0, zoom: 0.05 }, 60, 60);
    expect(shown.map((b) => b.id)).toEqual(['a', 'b', 'd', 'e']);
    expect(shown.find((b) => b.id === 'a')?.named).toBe(true); // 480 * 0.05 = 24
    expect(shown.find((b) => b.id === 'e')?.named).toBe(false); // 300 * 0.05 = 15
  });

  test('what cannot be known before the canvas runs keeps the card', () => {
    const unsized = {
      ...ROW,
      artboards: [...ROW.artboards, { id: 'z', label: 'Z', w: null, h: null }],
    };
    expect(skeletonBoards({ row: unsized, meta: META })).toBeNull(); // the grid cell needs every size
    expect(skeletonBoards({ row: { ...ROW, dynamic: true }, meta: META })).toBeNull();
    expect(
      skeletonBoards({ row: { ...ROW, dynamic: true, artboardsFrom: 'runtime' }, meta: META })
    ).not.toBeNull();
    expect(skeletonBoards({ row: null, meta: META })).toBeNull();
    expect(skeletonBoards({ row: { ...ROW, artboards: [] }, meta: META })).toBeNull();
  });
});

describe('the skeletons are the frame’s boxes', () => {
  let canvasLib: typeof import('../canvas-lib.tsx');
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    const sized = (el: Element) =>
      el.classList?.contains('dc-canvas') || el.classList?.contains('sh-opening-skel');
    Object.defineProperty(window.HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return sized(this) ? HOST.w : 0;
      },
    });
    Object.defineProperty(window.HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return sized(this) ? HOST.h : 0;
      },
    });
    canvasLib = await import('../canvas-lib.tsx');
  });
  afterAll(() => GlobalRegistrator.unregister());

  test('a real DesignCanvas on the same meta places every artboard and its boot camera where the skeletons are', async () => {
    const { DesignCanvas, DCArtboard, getLiveViewport } = canvasLib;
    (window as unknown as { __canvas_meta__: unknown }).__canvas_meta__ = META;
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    await act(async () => {
      root.render(
        <DesignCanvas>
          {JSX_BOARDS.map((b) => (
            <DCArtboard key={b.id} id={b.id} label={b.label} width={b.w} height={b.h}>
              <div>{b.label}</div>
            </DCArtboard>
          ))}
        </DesignCanvas>
      );
    });
    const boards = skeletonBoards({ row: ROW, meta: META });
    expect(boards).not.toBeNull();
    for (const b of boards ?? []) {
      const el = mount.querySelector(`article[data-dc-screen="${b.id}"]`) as HTMLElement;
      expect(el).not.toBeNull();
      expect([
        b.id,
        parseFloat(el.style.left),
        parseFloat(el.style.top),
        parseFloat(el.style.width),
      ]).toEqual([b.id, b.x, b.y, b.w]);
    }
    // the meta's legacy size wins over the JSX one, as in the frame
    expect(boards?.find((b) => b.id === 'c')).toMatchObject({ w: 400, h: 760 });
    const cam = skeletonCamera({
      boards: boards ?? [],
      width: HOST.w,
      height: HOST.h,
      insets: null,
      viewport: undefined,
    });
    const live = getLiveViewport();
    expect(live?.zoom).toBeCloseTo(cam.zoom, 9);
    expect(live?.x).toBeCloseTo(cam.x, 9);
    expect(live?.y).toBeCloseTo(cam.y, 9);
    // and canvas-lib's own fit inside panel insets agrees with the model's
    const insets = { top: 56, right: 320, bottom: 0, left: 280 };
    const fit = canvasLib.computeFit(
      (boards ?? []).map(({ id, x, y, w, h }) => ({ id, x, y, w, h })) as never,
      { clientWidth: HOST.w, clientHeight: HOST.h } as HTMLElement,
      24,
      insets
    );
    expect(skeletonCamera({ boards: boards ?? [], width: HOST.w, height: HOST.h, insets })).toEqual(
      fit
    );
    await act(async () => root.unmount());
    mount.remove();
  });

  test('the viewport draws them while the canvas opens and drops them when it renders', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) =>
      ({
        ok: true,
        status: 200,
        json: async () =>
          String(url).startsWith('/_api/canvas-meta')
            ? META
            : { canvas: { path: 'ui/Big.tsx', state: 'present' } },
      }) as Response) as unknown as typeof fetch;
    const { publishIndexSnapshot } = await import('../client/v2/canvases/use-canvas-index.js');
    publishIndexSnapshot(SNAP);
    try {
      const { Viewport } = await import('../client/shell/viewport.jsx');
      const host = document.createElement('div');
      document.body.append(host);
      const root = createRoot(host);
      const render = (props: Record<string, unknown>) =>
        act(async () => {
          root.render(
            <Viewport
              tabs={[{ path: PATH }]}
              activePath={PATH}
              registerIframe={() => {}}
              cfg={{ designRel: D }}
              canvasReloadNonce={0}
              renderSignal={{}}
              {...props}
            />
          );
        });
      await render({ loadingPath: PATH });
      await act(async () => new Promise((r) => setTimeout(r, 30)));
      const loading = host.querySelector('[data-testid="canvas-loading"]') as HTMLElement;
      expect(loading).not.toBeNull();
      const skel = loading.querySelector('[data-testid="canvas-skeleton"]') as HTMLElement;
      expect(skel?.getAttribute('data-ready')).toBe('true');
      const drawn = [
        ...skel.querySelectorAll('[data-testid="skeleton-artboard"]'),
      ] as HTMLElement[];
      const boards = skeletonBoards({ row: ROW, meta: META }) ?? [];
      const cam = skeletonCamera({ boards, width: HOST.w, height: HOST.h, insets: null });
      expect(drawn.length).toBe(JSX_BOARDS.length);
      const a = drawn.find((el) => el.textContent === 'A · Inbox') as HTMLElement;
      expect(parseFloat(a.style.left)).toBeCloseTo(cam.x, 6);
      expect(parseFloat(a.style.width)).toBeCloseTo(480 * cam.zoom, 6);
      // no card while the skeletons stand in for it
      expect(loading.querySelector('.sh-skel-card')).toBeNull();
      // canvas-rendered clears loadingPath (use-canvas-bridge) → the skeletons go with the loading surface
      await render({ loadingPath: null, loadedPath: PATH });
      expect(host.querySelector('[data-testid="skeleton-artboard"]')).toBeNull();
      expect(host.querySelector('[data-testid="canvas-loading"]')).toBeNull();
      await act(async () => root.unmount());
    } finally {
      globalThis.fetch = realFetch;
      publishIndexSnapshot(null);
    }
  });

  test('captures: the frame draws no skeleton, even mid-render', async () => {
    const { DesignCanvas, DCArtboard } = canvasLib;
    const mount = document.createElement('div');
    document.body.append(mount);
    const root = createRoot(mount);
    await act(async () => {
      root.render(
        <DesignCanvas>
          <DCArtboard id="x" label="X" width={200} height={100}>
            <div>x</div>
          </DCArtboard>
        </DesignCanvas>
      );
    });
    expect(
      mount.querySelector('.es-skab, [data-testid="skeleton-artboard"], .sh-opening-skel')
    ).toBeNull();
    await act(async () => root.unmount());
    // and the code a capture runs carries none to draw
    const frameCode = [
      readFileSync(join(STUDIO, 'canvas-lib.tsx'), 'utf8'),
      readFileSync(join(STUDIO, 'artboard-live-gate.tsx'), 'utf8'),
      readFileSync(
        join(STUDIO, '..', '..', 'plugins', 'design', 'templates', '_shell.html'),
        'utf8'
      ),
    ].join('\n');
    expect(frameCode).not.toMatch(/es-skab|skeleton-artboard|sh-opening-skel|opening-skeleton/);
  });
});

describe('reduced motion', () => {
  test('the skeletons neither pulse nor fade in under reduced motion', () => {
    const css = readFileSync(join(STUDIO, 'client', 'v2', 'shell', 'floating-panels.css'), 'utf8');
    const empty = readFileSync(join(STUDIO, 'client', 'v2', 'empty', 'empty.css'), 'utf8');
    // the fade: collapsed under prefers-reduced-motion
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.sh-opening-skel\[data-ready="true"\] \{\s*animation-duration: 1ms;/
    );
    // the pulse the boards wear (es-pulse): off under the media query and under the studio's own switch
    expect(empty).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{(?:\s*[^{}]+\{[^{}]*\})*?\s*\.es-pulse \{\s*animation: none;/
    );
    expect(empty).toMatch(/\[data-reduced-motion="true"\] \.es-pulse \{\s*animation: none;/);
    const jsx = readFileSync(join(STUDIO, 'client', 'v2', 'empty', 'skeleton.jsx'), 'utf8');
    expect(jsx).toContain('es-skab-page es-pulse');
  });
});
