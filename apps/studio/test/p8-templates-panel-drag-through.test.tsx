// P8 bug sweep B2 — the Templates panel says "or drag on the canvas for a blank one", but its full-window scrim
// swallowed that drag (it closed the panel and drew nothing), and the panel never took the keyboard it
// documents (arrows / ↵ went to the canvas). Pinned to the toolbar it now lets the pointer through, takes the
// focus on open, and closes on a press outside or when the focus leaves for the canvas — the F size picker's
// rules (client/v2/kinds/SizePicker.jsx). The centred dialog keeps its scrim.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

let registeredHere = false;
beforeAll(async () => {
  if (typeof document === 'undefined') {
    if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
    GlobalRegistrator.register();
    registeredHere = true;
  }
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (registeredHere && GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import TemplatesPanel from '../client/v2/annotations/templates-panel.jsx';

const ANCHOR = { placement: 'above', left: 100, width: 640, bottom: 80, maxHeight: 500 };

async function mount(anchor: unknown) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let closed = 0;
  await act(async () => {
    root.render(<TemplatesPanel onClose={() => closed++} anchor={anchor as never} />);
  });
  return {
    host,
    closed: () => closed,
    done: async () => {
      await act(async () => root.unmount());
      host.remove();
    },
  };
}

describe('Templates panel pinned to the toolbar', () => {
  test('the scrim is the see-through kind, and the first tile holds the focus', async () => {
    const { host, done } = await mount(ANCHOR);
    expect(host.querySelector('.st-scrim')?.classList.contains('tp-scrim')).toBe(true);
    expect(document.activeElement?.getAttribute('data-testid')).toBe('templates-tile-kanban');
    await done();
  });

  test('a press outside the panel closes it; a press inside does not', async () => {
    const { host, closed, done } = await mount(ANCHOR);
    const dialog = host.querySelector('[role="dialog"]') as HTMLElement;
    await act(async () => {
      dialog.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(closed()).toBe(0);
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    });
    expect(closed()).toBe(1);
    await done();
  });

  test('the focus leaving the window (into the canvas iframe) closes it', async () => {
    const { closed, done } = await mount(ANCHOR);
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
    });
    expect(closed()).toBe(1);
    await done();
  });

  test('the centred dialog keeps its scrim and ignores the outside press listeners', async () => {
    const { host, closed, done } = await mount(null);
    expect(host.querySelector('.st-scrim')?.classList.contains('tp-scrim')).toBe(false);
    await act(async () => {
      document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      window.dispatchEvent(new Event('blur'));
    });
    expect(closed()).toBe(0);
    await done();
  });

  test('the CSS lets the pointer through the scrim and keeps it on the panel', async () => {
    const css = await Bun.file(
      new URL('../client/v2/annotations/templates-panel.css', import.meta.url)
    ).text();
    expect(css).toMatch(/\.st-scrim\.tp-scrim\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/\.tp-scrim\s*>\s*\.st-sticker-picker\.tp\s*\{[^}]*pointer-events:\s*auto/);
  });
});
