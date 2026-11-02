// P8 c10 ann - 15 an-stk-drop: after a sticker drop the placed sticker is selected and the dock keeps Stickers (E)
// pressed (the board's PvChrome tool="stamp"), not Hand. The annotation layer reports "a gallery sticker is selected"
// into toolbars/shell-panels.ts; the palette presses the Stickers slot on it, like it does while the gallery is up.
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
import { postPanelOpen } from '../input-router.tsx';
import { ToolPalette } from '../tool-palette.tsx';
import { setShellPanelOpen, setStickerSelected } from '../toolbars/shell-panels.ts';
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
  setStickerSelected(false);
});
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const bar = () =>
  mount(
    <ToolProvider>
      <Capture />
      <ToolPalette />
    </ToolProvider>
  );

describe('15 an-stk-drop: Stickers stays pressed while the dropped sticker is selected', () => {
  test('Preview: a selected gallery sticker presses E and lets Hand go; deselecting restores Hand', () => {
    bar();
    act(() => ctx?.setMode('preview'));
    expect(q('toolbar-slot-browse')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('toolbar-slot-stickers')?.hasAttribute('aria-pressed')).toBe(false);
    act(() => setStickerSelected(true));
    expect(q('toolbar-slot-stickers')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('toolbar-slot-browse')?.getAttribute('aria-pressed')).toBe('false');
    act(() => setStickerSelected(false));
    expect(q('toolbar-slot-browse')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('toolbar-slot-stickers')?.hasAttribute('aria-pressed')).toBe(false);
  });

  test('a selected sticker does not press the Image slot (only Stickers)', () => {
    bar();
    act(() => ctx?.setMode('edit'));
    act(() => setStickerSelected(true));
    expect(q('toolbar-slot-image')?.hasAttribute('aria-pressed')).toBe(false);
  });

  test('the annotation layer reports the selected sticker', async () => {
    const src = await Bun.file(`${import.meta.dir}/../annotations-layer.tsx`).text();
    expect(src).toContain('setStickerSelected(');
  });
});

describe('15 an-stamps: E opens the gallery anchored to the Stickers slot', () => {
  test('the key path carries the slot box (no slot drawn = no anchor)', () => {
    const sent: unknown[] = [];
    const real = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', {
      value: { postMessage: (m: unknown) => sent.push(m) },
      configurable: true,
    });
    try {
      postPanelOpen('stickers');
      expect(sent[0]).toEqual({ dgn: 'tool-panel-open', panel: 'stickers', anchor: null });
      const slot = document.createElement('button');
      slot.setAttribute('data-testid', 'toolbar-slot-stickers');
      slot.getBoundingClientRect = () =>
        ({ left: 882, top: 830, width: 40, height: 40, right: 922, bottom: 870 }) as DOMRect;
      document.body.append(slot);
      postPanelOpen('stickers');
      expect(sent[1]).toMatchObject({
        panel: 'stickers',
        anchor: { x: 882, y: 830, w: 40, h: 40 },
      });
      slot.remove();
    } finally {
      if (real) Object.defineProperty(window, 'parent', real);
    }
  });
});
