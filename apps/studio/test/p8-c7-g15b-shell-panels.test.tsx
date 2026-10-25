// P8 c7 g15b - the dock presses the panel-only slot whose shell panel is open (15 an-stk-gallery: E lit under the
// Stickers gallery; 04 md-edit-image: Image lit beside the Assets panel). The shell says which panel is up with the
// parent-gated `shell-panels` dgn message; the canvas keeps it in toolbars/shell-panels.ts and the palette follows.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { ToolPalette } from '../tool-palette.tsx';
import {
  getShellPanelOpen,
  isShellPanelOpen,
  setShellPanelOpen,
} from '../toolbars/shell-panels.ts';
import { ToolProvider, useToolMode } from '../use-tool-mode.tsx';

let ctx: ReturnType<typeof useToolMode> | null = null;
function Capture() {
  ctx = useToolMode();
  return null;
}
let root: Root | null = null;
let host: HTMLElement | null = null;
function mount(ui: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(ui);
  });
}
afterEach(() => {
  act(() => {
    root?.unmount();
  });
  host?.remove();
  root = host = null;
  ctx = null;
  setShellPanelOpen(null);
});
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const mountBar = () =>
  mount(
    <ToolProvider>
      <Capture />
      <ToolPalette />
    </ToolProvider>
  );

describe('shell-panels store', () => {
  test('holds the last answer; a repeat is a no-op', () => {
    let n = 0;
    const { subscribeShellPanel } = require('../toolbars/shell-panels.ts');
    const off = subscribeShellPanel(() => n++);
    setShellPanelOpen('stickers');
    setShellPanelOpen('stickers');
    expect(getShellPanelOpen()).toBe('stickers');
    expect(n).toBe(1);
    setShellPanelOpen(null);
    expect(n).toBe(2);
    off();
  });

  test('a slot is lit only by its own panel', () => {
    expect(isShellPanelOpen('stickers', 'stickers')).toBe(true);
    expect(isShellPanelOpen('assets', 'stickers')).toBe(false);
    expect(isShellPanelOpen('stickers', null)).toBe(false);
    expect(isShellPanelOpen(undefined, 'assets')).toBe(false);
  });
});

describe('the dock follows the shell panel', () => {
  test('Preview: Stickers (E) is pressed while the gallery is open, and only then', () => {
    mountBar();
    act(() => ctx?.setMode('preview'));
    expect(q('toolbar-slot-stickers')?.hasAttribute('aria-pressed')).toBe(false);
    act(() => setShellPanelOpen('stickers'));
    expect(q('toolbar-slot-stickers')?.getAttribute('aria-pressed')).toBe('true');
    act(() => setShellPanelOpen(null));
    expect(q('toolbar-slot-stickers')?.hasAttribute('aria-pressed')).toBe(false);
  });

  test('Edit: Image (I) is pressed while the Assets panel is open; the Stickers panel does not press it', () => {
    mountBar();
    act(() => ctx?.setMode('edit'));
    act(() => setShellPanelOpen('stickers'));
    expect(q('toolbar-slot-image')?.hasAttribute('aria-pressed')).toBe(false);
    act(() => setShellPanelOpen('assets'));
    expect(q('toolbar-slot-image')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('the canvas-shell handler is parent-gated and writes the store', async () => {
    const src = await Bun.file(`${import.meta.dir}/../canvas-shell.tsx`).text();
    expect(src).toContain("m.dgn === 'shell-panels'");
    expect(src).toMatch(/shell-panels'\) \{\s*if \(e\.source !== window\.parent\) return;/);
    expect(src).toContain('setShellPanelOpen(');
    void canvasModeStore;
  });
});
