// r1 #11 (Michal, rc.1: "the Frame menu closes as soon as I move the mouse into it") — the shell's tool panels (the F
// size picker, Stickers, Assets, the Component picker) are drawn OVER the canvas and close on the shell window's blur,
// their only way to hear a click inside the iframe. The canvas took the keyboard whenever the pointer merely ENTERED
// it (canvas-lib "auto-focus on pointer enter"), so the pointer travelling from the toolbar up into the panel blurred
// the shell and the panel closed under it. Once the canvas asks for a panel, hover keeps out until the next press in
// the canvas. (The real-Chromium half — pointer travel, the picker staying up, a canvas click still closing it — is
// test/e2e/canvas-tools.e2e.mjs.)
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

describe('r1 #11 — hover never blurs a shell panel shut', () => {
  let panel: typeof import('../toolbars/tool-panel.ts');

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    class FakeRO {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeRO;
    panel = await import('../toolbars/tool-panel.ts');
  });
  afterAll(() => GlobalRegistrator.unregister());

  test('the hold: set by asking for a panel, released by the next press in the canvas', () => {
    panel.resetHoverFocusHold();
    expect(panel.hoverFocusHeld()).toBe(false);
    panel.holdHoverFocus();
    expect(panel.hoverFocusHeld()).toBe(true);
    document.dispatchEvent(new window.PointerEvent('pointerdown', { bubbles: true }));
    expect(panel.hoverFocusHeld()).toBe(false);
  });

  test('canvas-lib’s pointer-enter auto-focus steps aside while the hold is on', async () => {
    const lib = await Bun.file(new URL('../canvas-lib.tsx', import.meta.url)).text();
    const enter = lib.slice(lib.indexOf('const onPointerEnter = () => {'));
    const guard = enter.indexOf('if (hoverFocusHeld()) return;');
    expect(guard).toBeGreaterThan(0);
    // before the focus call, inside the same handler
    expect(guard).toBeLessThan(enter.indexOf('host.focus({ preventScroll: true })'));
  });

  test('every way the canvas asks for a panel puts hover on hold', async () => {
    const src = (f: string) => Bun.file(new URL(`../${f}`, import.meta.url)).text();
    // openToolPanel (the dock's Stickers / Image / Component slots) holds before it posts
    panel.resetHoverFocusHold();
    const parent = { postMessage: () => {} };
    const realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, value: parent });
    try {
      panel.openToolPanel('stickers', null);
    } finally {
      if (realParent) Object.defineProperty(window, 'parent', realParent);
    }
    expect(panel.hoverFocusHeld()).toBe(true);
    // …and the other three send sites call it next to their `tool-panel-open`
    for (const f of [
      'input-router.tsx',
      'editing/size-ghost.tsx',
      'annotations-context-toolbar.tsx',
    ]) {
      expect(await src(f)).toMatch(/holdHoverFocus\(\);[^\n]*\n[^\n]*(postMessage|postToShell)/);
    }
  });
});
