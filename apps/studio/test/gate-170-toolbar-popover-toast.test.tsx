// #170 (burndown T2.4b) — a toolbar popover inside the canvas sat UNDER a shell toast: the toast pill lives in the
// dock (bottom-centre, above the canvas toolbar) and the popovers open upward into exactly that slot. The canvas
// now tells the shell "a toolbar popover is open / closed" (`toolbar-popover`, one boolean, active-gated), and the
// shell moves its toast stack to the top while one is open — the same rule as the video timeline (decision
// v2-p8-c4-toast-dock-or-top). The message carries no rect and no text: nothing the shell renders.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 400));
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { acceptFromCanvas, C2S_ACTIVE, c2sSpec } from '../bridge/dgn-protocol.ts';
import { _resetReadOnlyCache } from '../read-only-mode.ts';
import { ToolPalette } from '../tool-palette.tsx';
import { ToolProvider } from '../use-tool-mode.tsx';

const ORIGIN = 'http://canvas.test';
const active = { name: 'active' } as unknown as Window;
const background = { name: 'background' } as unknown as Window;
const ev = (data: unknown, source: unknown, origin = ORIGIN) =>
  ({ data, source, origin }) as unknown as MessageEvent;
const ctx = { canvasOrigin: ORIGIN, active, frames: () => [active, background] };

describe('the toolbar-popover row (bridge/dgn-protocol.ts)', () => {
  test('is a canvas→shell row gated to the active canvas', () => {
    expect(c2sSpec('toolbar-popover')?.gate).toBe('active');
    expect(C2S_ACTIVE.has('toolbar-popover')).toBe(true);
  });

  test('carries one boolean; extra keys are stripped, anything else is refused', () => {
    expect(
      acceptFromCanvas(ev({ dgn: 'toolbar-popover', open: true, rect: { x: 1 } }, active), ctx)
    ).toEqual({ dgn: 'toolbar-popover', open: true });
    expect(acceptFromCanvas(ev({ dgn: 'toolbar-popover', open: false }, active), ctx)).toEqual({
      dgn: 'toolbar-popover',
      open: false,
    });
    expect(acceptFromCanvas(ev({ dgn: 'toolbar-popover', open: 'yes' }, active), ctx)).toBeNull();
    expect(acceptFromCanvas(ev({ dgn: 'toolbar-popover' }, active), ctx)).toBeNull();
  });

  test('a background canvas, a null source or another origin is not heard', () => {
    const m = { dgn: 'toolbar-popover', open: true };
    expect(acceptFromCanvas(ev(m, background), ctx)).toBeNull();
    expect(acceptFromCanvas(ev(m, null), { ...ctx, active: null })).toBeNull();
    expect(acceptFromCanvas(ev(m, active, 'http://evil.example'), ctx)).toBeNull();
  });
});

describe('the shell bridge (client/hooks/use-canvas-bridge.jsx)', () => {
  test('hears it only after the active-frame check, parses it, and hands the store only the boolean', () => {
    const bridge = readFileSync(
      join(import.meta.dir, '..', 'client/hooks/use-canvas-bridge.jsx'),
      'utf8'
    );
    const i = bridge.indexOf("m.dgn === 'toolbar-popover'");
    expect(i).toBeGreaterThan(bridge.indexOf('if (C2S_ACTIVE.has(m.dgn))'));
    const branch = bridge.slice(i, i + 400);
    expect(branch).toContain('acceptFromCanvas(e,');
    expect(branch).toContain('setCanvasPopoverOpen(msg.open)');
    expect(branch).not.toContain('m.open');
    // a tab switch puts the toasts back (the popover belonged to the canvas that said it)
    expect(bridge).toContain('useEffect(() => () => setCanvasPopoverOpen(false), [activePath]);');
  });
});

// ── the shell: notifications.tsx ──────────────────────────────────────────────────────────────────

describe('the shell moves its toast stack while a canvas popover is open', () => {
  let root: Root | null = null;
  afterEach(async () => {
    const n = await import('../notifications.tsx');
    await act(async () => {
      n.setCanvasPopoverOpen(false);
      n.dismissNotice('pop-1');
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 350));
    });
    await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = '';
  });
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
  const yOf = (id: string) =>
    document
      .querySelector(`[data-testid="notice-${id}"]`)
      ?.closest('[data-sonner-toast]')
      ?.getAttribute('data-y-position');

  test('noticePlacement: dock by default, top while a popover is open, an app state stays top', async () => {
    const { noticePlacement, setCanvasPopoverOpen } = await import('../notifications.tsx');
    expect(noticePlacement({ id: 'a', title: 't' })).toBe('bottom');
    setCanvasPopoverOpen(true);
    expect(noticePlacement({ id: 'a', title: 't' })).toBe('top');
    expect(noticePlacement({ id: 'a', title: 't', placement: 'bottom' })).toBe('top');
    expect(noticePlacement({ id: 'a', title: 't', placement: 'top' })).toBe('top');
    setCanvasPopoverOpen(false);
    expect(noticePlacement({ id: 'a', title: 't' })).toBe('bottom');
  });

  test('a toast already in the dock moves to the top when the popover opens, and back when it closes', async () => {
    const { NotificationHost, notify, setCanvasPopoverOpen } = await import('../notifications.tsx');
    const host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root?.render(<NotificationHost />));
    await act(async () => {
      notify({ id: 'pop-1', title: 'Duplicated at Laptop — 1280 wide.', kind: 'undo' });
    });
    await settle();
    expect(yOf('pop-1')).toBe('bottom');
    await act(async () => setCanvasPopoverOpen(true));
    await settle();
    expect(yOf('pop-1')).toBe('top');
    await act(async () => setCanvasPopoverOpen(false));
    await settle();
    expect(yOf('pop-1')).toBe('bottom');
  });
});

// ── the canvas: tool-palette.tsx tells the shell ──────────────────────────────────────────────────

describe('the toolbar says when one of its popovers opens and closes', () => {
  const posts: Array<Record<string, unknown>> = [];
  const fakeParent = { postMessage: (m: Record<string, unknown>) => posts.push(m) };
  let realParent: PropertyDescriptor | undefined;
  let root: Root | null = null;
  let host: HTMLElement | null = null;
  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
  });
  afterAll(() => {
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    else Reflect.deleteProperty(window, 'parent');
  });
  afterEach(() => {
    act(() => root?.unmount());
    host?.remove();
    root = host = null;
    posts.length = 0;
    _resetReadOnlyCache();
  });
  const said = () => posts.filter((m) => m.dgn === 'toolbar-popover').map((m) => m.open);
  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

  test('More opens → open: true; Escape closes it → open: false; nothing when nothing changed', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ToolProvider>
          <ToolPalette />
        </ToolProvider>
      );
    });
    expect(said()).toEqual([]); // a closed toolbar says nothing on mount
    act(() => q('toolbar-slot-more')?.click());
    expect(q('toolbar-popover-more')).not.toBeNull();
    expect(said()).toEqual([true]);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('toolbar-popover-more')).toBeNull();
    expect(said()).toEqual([true, false]);
  });

  test('a toolbar unmounted with a popover open says closed', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ToolProvider>
          <ToolPalette />
        </ToolProvider>
      );
    });
    act(() => q('toolbar-slot-more')?.click());
    act(() => root?.unmount());
    root = null;
    expect(said()).toEqual([true, false]);
  });
});
