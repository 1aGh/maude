// r4 #12 — a menu in the left panel closes when the person clicks anywhere else, including into the canvas.
// The canvas is an iframe on another origin (DDR-054): a click there never reaches this document, it only moves
// focus into the iframe and so blurs the shell window. Esc was the only way out.

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

describe('left-panel menus close on an outside click', () => {
  test('the asset tile menu: a click into the canvas (window blur) and a click outside both close it', async () => {
    const React = await import('react');
    const { AssetTileMenu } = await import('../client/v2/assets/tile-menu.jsx');
    let closed = 0;
    const el = React.createElement(AssetTileMenu, {
      state: { anchor, asset: { name: 'a.png', path: 'a.png', kind: 'image' } },
      items: [{ id: 'details', label: 'Show details' }],
      onSelect() {},
      onClose: () => closed++,
    });
    await mount(el);
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(closed).toBe(1);
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(closed).toBe(2);
    // a press INSIDE the menu is not a dismissal
    const item = document.querySelector('[data-testid="assets-tile-menu"] button') as HTMLElement;
    await act(async () => {
      item.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(closed).toBe(2);
  });

  test('the canvas row menu closes on a window blur', async () => {
    const React = await import('react');
    const { CanvasRowMenu } = await import('../client/v2/canvases/row-menu.jsx');
    let closed = 0;
    await mount(
      React.createElement(CanvasRowMenu, {
        state: { anchor, view: 'root', row: { path: 'a.tsx' } },
        items: [{ id: 'open', label: 'Open' }],
        targets: [],
        onSelect() {},
        onPick() {},
        onClose: () => closed++,
        onView() {},
      })
    );
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(closed).toBe(1);
  });

  test('the kind filter and the Sort menu close on a window blur too', async () => {
    const React = await import('react');
    const { KindsChip } = await import('../client/v2/assets/kinds-chip.jsx');
    const host = await mount(React.createElement(KindsChip, { value: 'all', onChange() {} }));
    const chip = host.querySelector('button') as HTMLElement;
    await act(async () => chip.click());
    expect(host.querySelector('[role="menuitemradio"]')).not.toBeNull();
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(host.querySelector('[role="menuitemradio"]')).toBeNull();

    const src = await Bun.file(
      new URL('../client/v2/canvases/canvases-panel.jsx', import.meta.url).pathname
    ).text();
    expect(src).toContain("window.addEventListener('blur', away)");
  });
});
