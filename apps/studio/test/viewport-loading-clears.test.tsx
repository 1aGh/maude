// The "Opening <name>…" card leaves when the canvas has drawn (fix-opening-hang).
//
// Regression: S6.12 (75e465ffb) added `<RenderErrorHost key={canvasTab}>` as a sibling of
// `<CanvasLoading key={loadingPath}>` in the viewport. Both keys are the open canvas's path, so the
// viewport's children carried a DUPLICATE KEY while a canvas was opening. React's reconciler loses track of
// one of two same-keyed siblings: every re-render during the open mounted a fresh loading card and never
// removed the old one, so when `canvas-rendered` cleared `loadingPath` the orphaned cards stayed — the
// canvas drew underneath a card that never went away (headless repro: test/e2e/opening-card-clears.mjs).
//
// Pinned here: (1) re-rendering while loading, then clearing `loadingPath`, leaves no loading card;
// (2) the viewport's keyed children never collide, with every keyed surface shown at once.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const D = '.design';
const PATH = `${D}/ui/Smoke.tsx`;
let realFetch: typeof fetch;
let realError: typeof console.error;
let errors: string[] = [];

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  realFetch = globalThis.fetch;
  // The viewport asks whether the canvas is on this Mac before it frames it — answer "present".
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ canvas: { path: 'ui/Smoke.tsx', state: 'present' } }),
    }) as Response) as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  if (realError) console.error = realError;
  errors = [];
});

const cards = (host: HTMLElement) => host.querySelectorAll('[data-testid="canvas-loading"]').length;

async function mountViewport() {
  const { Viewport } = await import('../client/shell/viewport.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
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
  return { host, render };
}

describe('the viewport loading card', () => {
  test('re-renders while opening, then canvas-rendered clears loadingPath → no card left', async () => {
    const { host, render } = await mountViewport();
    await render({ loadingPath: PATH });
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    // The shell re-renders many times while a canvas opens (loaded, peers, zoom, artboards, …).
    for (let i = 0; i < 5; i++)
      await render({ loadingPath: PATH, loadedPath: i > 1 ? PATH : null });
    expect(cards(host)).toBe(1);
    await render({ loadingPath: null, loadedPath: PATH });
    expect(cards(host)).toBe(0);
  });

  test('no two keyed children of the viewport share a key (loading + error + code view at once)', async () => {
    realError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    const { render } = await mountViewport();
    await render({
      loadingPath: PATH,
      canvasError: { path: PATH, kind: 'compile' },
    });
    await act(async () => new Promise((r) => setTimeout(r, 20)));
    await render({
      loadingPath: PATH,
      canvasError: { path: PATH, kind: 'compile' },
      loadedPath: PATH,
    });
    console.error = realError;
    expect(errors.filter((e) => /same key/i.test(e))).toEqual([]);
  });
});
