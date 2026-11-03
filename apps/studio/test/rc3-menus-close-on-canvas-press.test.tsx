// rc3 r4-12 (walk of the packaged rc.2 app) — a left-panel menu stayed open on a click into the canvas, because the
// only door for that click was the shell window's blur, and the packaged app's WebKit gives none: it does not move
// focus into the canvas iframe on a press that lands on nothing focusable (reproduced in a real WKWebView). The
// canvas now tells the shell about every press over the dgn bridge (`canvas-pointerdown`), and the menus close on
// it. The click itself must still reach its target, and the focus must stay where the click put it.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());

const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

async function mount(node: unknown) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node as never));
  return host;
}

const anchor = { left: 10, top: 10, bottom: 30 };
const rowMenu = () => document.querySelector('[data-testid="canvas-row-menu"]');

/** The canvas row menu as the panel holds it: open until `onClose`, which records whether focus goes back. */
async function rowMenuHarness() {
  const React = await import('react');
  const { CanvasRowMenu } = await import('../client/v2/canvases/row-menu.jsx');
  const calls: unknown[] = [];
  let targetClicks = 0;
  function Harness() {
    const [state, setState] = React.useState<unknown>({
      anchor,
      view: 'root',
      row: { path: 'ui/a.tsx', name: 'a' },
    });
    return React.createElement(
      'div',
      null,
      React.createElement(
        'button',
        { type: 'button', 'data-testid': 'outside', onClick: () => targetClicks++ },
        'Outside'
      ),
      React.createElement(CanvasRowMenu, {
        state,
        items: [{ id: 'open', label: 'Open' }],
        targets: [],
        onSelect() {},
        onPick() {},
        onView() {},
        onClose: (restoreFocus?: boolean) => {
          calls.push(restoreFocus);
          setState(null);
        },
      })
    );
  }
  await mount(React.createElement(Harness));
  return { calls, clicks: () => targetClicks };
}

describe('a left-panel menu closes on a press in the canvas (no window blur needed)', () => {
  test('the canvas row menu closes on the canvas press notice alone, focus left where the click put it', async () => {
    const { announceCanvasPointer } = await import('../client/v2/shell/canvas-pointer.js');
    const h = await rowMenuHarness();
    expect(rowMenu()).not.toBeNull();
    await act(async () => announceCanvasPointer());
    expect(rowMenu()).toBeNull();
    // an outside dismissal never hands the focus back to ⋯ (that would pull it out of the canvas)
    expect(h.calls).toEqual([false]);
  });

  test('an outside click in the shell closes it AND still reaches its target', async () => {
    const h = await rowMenuHarness();
    const outside = document.querySelector('[data-testid="outside"]') as HTMLButtonElement;
    await act(async () => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      outside.click();
    });
    expect(rowMenu()).toBeNull();
    expect(h.clicks()).toBe(1);
    expect(h.calls).toEqual([false]);
  });

  test('esc still gives the focus back to ⋯', async () => {
    const h = await rowMenuHarness();
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(rowMenu()).toBeNull();
    expect(h.calls).toEqual([undefined]);
  });

  test('the asset tile menu and the kind filter close on it too', async () => {
    const React = await import('react');
    const { announceCanvasPointer } = await import('../client/v2/shell/canvas-pointer.js');
    const { AssetTileMenu } = await import('../client/v2/assets/tile-menu.jsx');
    let closed = 0;
    await mount(
      React.createElement(AssetTileMenu, {
        state: { anchor, asset: { name: 'a.png', path: 'a.png', kind: 'image' } },
        items: [{ id: 'details', label: 'Show details' }],
        onSelect() {},
        onClose: () => closed++,
      })
    );
    await act(async () => announceCanvasPointer());
    expect(closed).toBe(1);

    const { KindsChip } = await import('../client/v2/assets/kinds-chip.jsx');
    const host = await mount(React.createElement(KindsChip, { value: 'all', onChange() {} }));
    await act(async () => (host.querySelector('button') as HTMLElement).click());
    expect(host.querySelector('[role="menuitemradio"]')).not.toBeNull();
    await act(async () => announceCanvasPointer());
    expect(host.querySelector('[role="menuitemradio"]')).toBeNull();
  });

  test('the Canvases Sort menu listens for the canvas press', async () => {
    const src = await Bun.file(
      new URL('../client/v2/canvases/canvases-panel.jsx', import.meta.url).pathname
    ).text();
    expect(src).toContain('const offCanvas = onCanvasPointer(away);');
  });
});

describe('the canvas → shell door (dgn `canvas-pointerdown`)', () => {
  test('the canvas posts one notice per press, in the capture phase, and never blocks the press', async () => {
    const { installCanvasPointerNotice } = await import('../editing/canvas-pointer.ts');
    const posted: unknown[] = [];
    const win = new EventTarget() as EventTarget & { parent: unknown };
    const regs: unknown[] = [];
    const add = win.addEventListener.bind(win);
    win.addEventListener = ((t: string, fn: EventListener, opts: unknown) => {
      regs.push([t, opts]);
      add(t, fn, opts as AddEventListenerOptions);
    }) as typeof win.addEventListener;
    win.parent = { postMessage: (m: unknown, o: string) => posted.push([m, o]) };
    const off = installCanvasPointerNotice(win as unknown as Window);
    expect(regs).toEqual([['pointerdown', { capture: true, passive: true }]]);
    const ev = new Event('pointerdown', { cancelable: true });
    win.dispatchEvent(ev);
    expect(posted).toEqual([[{ dgn: 'canvas-pointerdown' }, '*']]);
    expect(ev.defaultPrevented).toBe(false);
    off();
    win.dispatchEvent(new Event('pointerdown'));
    expect(posted.length).toBe(1);
  });

  test('a top-level document (a capture, no shell) sends nothing', async () => {
    const { installCanvasPointerNotice } = await import('../editing/canvas-pointer.ts');
    const win = new EventTarget() as EventTarget & { parent: unknown };
    let posts = 0;
    (win as unknown as { postMessage: () => void }).postMessage = () => posts++;
    win.parent = win;
    installCanvasPointerNotice(win as unknown as Window)();
    win.dispatchEvent(new Event('pointerdown'));
    expect(posts).toBe(0);
  });

  test('the shell accepts it from the active canvas only', async () => {
    const { acceptFromCanvas, C2S_ACTIVE } = await import('../bridge/dgn-protocol.ts');
    expect(C2S_ACTIVE.has('canvas-pointerdown')).toBe(true);
    const active = {} as Window;
    const other = {} as Window;
    const msg = (source: Window, origin = 'http://canvas') =>
      ({ data: { dgn: 'canvas-pointerdown' }, source, origin }) as unknown as MessageEvent;
    const ctx = { canvasOrigin: 'http://canvas', active };
    expect(acceptFromCanvas(msg(active), ctx)).toEqual({ dgn: 'canvas-pointerdown' } as never);
    expect(acceptFromCanvas(msg(other), ctx)).toBeNull();
    expect(acceptFromCanvas(msg(active, 'http://evil'), ctx)).toBeNull();
  });

  test('the shell bridge turns it into the window event the menus listen for', async () => {
    const src = await Bun.file(
      new URL('../client/hooks/use-canvas-bridge.jsx', import.meta.url).pathname
    ).text();
    const at = src.indexOf("if (m.dgn === 'canvas-pointerdown')");
    expect(at).toBeGreaterThan(src.indexOf('if (C2S_ACTIVE.has(m.dgn))'));
    expect(src.slice(at, at + 120)).toContain('announceCanvasPointer()');
    const canvasLib = await Bun.file(new URL('../canvas-lib.tsx', import.meta.url).pathname).text();
    expect(canvasLib).toContain('installCanvasPointerNotice(window)');
  });
});
