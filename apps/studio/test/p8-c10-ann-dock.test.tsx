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
