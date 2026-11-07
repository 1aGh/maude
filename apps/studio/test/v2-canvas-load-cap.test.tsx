// 2.0.7 (#2) — the studio's loading cap waits for a build that is still running, and the card that
// shows when a load did stop says which wait ran out.
//
// design.studyfi.com, 2.0.6: the first open of the studyfi-v3 Design system canvas after a hub restart
// ended on "design-system can't be drawn right now" with "No details were reported" — the cap had
// fired (or the frame had given up) while the board's cold build was still running; Reload drew it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const BOARD = '.design/system/studyfi-v3/design-system.tsx';

/** canvas-errors answers `errors` JSON; the origin probe answers opaque (the listener is up). */
const route = (body: unknown) =>
  (async (url: string, init?: RequestInit) => {
    if (url.startsWith('/_api/canvas-errors'))
      return new Response(JSON.stringify(body), { status: 200 });
    if (init?.mode === 'no-cors') return { type: 'opaque', ok: false } as unknown as Response;
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;

describe('loadCapVerdict', () => {
  test('a canvas still being built keeps the loading screen', async () => {
    const { loadCapVerdict } = await import('../client/hooks/canvas-origin-probe.js');
    const seen: string[] = [];
    const f = (async (url: string, init?: RequestInit) => {
      seen.push(url);
      return route({ canvas: BOARD, errors: [], building: true })(url, init);
    }) as unknown as typeof fetch;
    expect(
      await loadCapVerdict({ path: BOARD, canvasOrigin: 'http://127.0.0.1:9', fetchImpl: f })
    ).toBe('building');
    expect(seen[0]).toBe(`/_api/canvas-errors?canvas=${encodeURIComponent(BOARD)}`);
  });

  test('not building: the origin probe decides, as before', async () => {
    const { loadCapVerdict } = await import('../client/hooks/canvas-origin-probe.js');
    const f = route({ canvas: BOARD, errors: [] });
    expect(await loadCapVerdict({ path: BOARD, canvasOrigin: 'http://x', fetchImpl: f })).toBe(
      'compile'
    );
    const dead = (async () => {
      throw new TypeError('down');
    }) as unknown as typeof fetch;
    expect(await loadCapVerdict({ path: BOARD, canvasOrigin: 'http://x', fetchImpl: dead })).toBe(
      'server'
    );
  });

  test('a code error on record is not "building"', async () => {
    const { loadCapVerdict } = await import('../client/hooks/canvas-origin-probe.js');
    const f = route({ canvas: BOARD, errors: [{ message: 'x' }], building: true });
    expect(await loadCapVerdict({ path: BOARD, canvasOrigin: 'http://x', fetchImpl: f })).toBe(
      'compile'
    );
  });

  test('which wait ran out', async () => {
    const { capReason } = await import('../client/hooks/canvas-origin-probe.js');
    expect(capReason(true)).toBe('slow');
    expect(capReason(false)).toBe('no-shell');
  });
});

describe('the card names the reason', () => {
  const roots: Root[] = [];
  let CanvasLoadFailure: typeof import('../client/v2/code/canvas-error-card.jsx').CanvasLoadFailure;
  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ CanvasLoadFailure } = await import('../client/v2/code/canvas-error-card.jsx'));
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(el));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
  const openFold = async () => {
    const t = document.querySelector<HTMLElement>(
      '[data-testid="canvas-error-card"] button[aria-expanded]'
    );
    expect(t).not.toBeNull();
    await act(async () => t?.click());
  };

  for (const [reason, words] of [
    ['slow', "It didn't finish opening within a minute"],
    ['no-shell', "Its frame didn't start within 15 seconds"],
    ['frame', 'It stopped loading before it was drawn'],
  ] as const) {
    test(`${reason}: the reason and Reload canvas, never "No details were reported"`, async () => {
      let reloads = 0;
      await mount(
        <CanvasLoadFailure
          canvas={BOARD}
          loadReason={reason}
          onReload={() => reloads++}
          fetchImpl={route({ canvas: BOARD, errors: [] })}
        />
      );
      expect(q('canvas-error-title')?.textContent).toBe("design-system can't be drawn right now.");
      await openFold();
      expect(q('canvas-error-load-reason')?.textContent).toBe(words);
      expect(q('canvas-error-none')).toBeNull();
      await act(async () => q('canvas-load-retry')?.click());
      expect(reloads).toBe(1);
    });
  }

  test('a reason the server recorded wins over the studio’s own', async () => {
    await mount(
      <CanvasLoadFailure
        canvas={BOARD}
        loadReason="slow"
        fetchImpl={route({ canvas: BOARD, errors: [], buildFailure: { class: 'timed-out' } })}
      />
    );
    await openFold();
    expect(q('canvas-error-build-reason')?.textContent).toBe('The build timed out');
    expect(q('canvas-error-load-reason')).toBeNull();
  });
});
