// Edit ⇄ Preview on the canvas (04 md-motion).
//   · the hook marks the document (`html[data-maude-preview]`) while the shell's mode is Preview and never
//     moves the camera (TD1d; the S3.9 ease engine was removed in #170 D3)
//   · a web artboard scrolls inside itself in Preview, and a wheel that cannot scroll there still pans
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof window === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { canvasModeStore } from '../bridge/canvas-mode-store.ts';
import { usePreviewMark } from '../preview/preview-camera.tsx';
import { previewWheelPassthrough, scrollsInside } from '../preview/wheel-scroll.ts';

describe('usePreviewMark: the document knows when it is Preview', () => {
  let root: Root | null = null;
  let realParent: PropertyDescriptor | undefined;
  const fakeParent = { postMessage: () => {} };

  function Probe() {
    usePreviewMark();
    return null;
  }

  const setMode = (mode: string, present: unknown = null) =>
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: fakeParent as unknown as Window,
          data: {
            dgn: 'set-mode',
            v: 2,
            seq: canvasModeStore(window).get().modeSeq + 1,
            mode,
            present,
            caps: { edit: true, annotate: true, comment: true },
          },
        })
      );
    });
  const marked = () => document.documentElement.hasAttribute('data-maude-preview');

  beforeAll(() => {
    realParent = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { configurable: true, get: () => fakeParent });
  });
  afterAll(() => {
    act(() => root?.unmount());
    if (realParent) Object.defineProperty(window, 'parent', realParent);
    else Reflect.deleteProperty(window, 'parent');
  });

  test('boot: the first set-mode (Edit) leaves the document unmarked', () => {
    root = createRoot(document.createElement('div'));
    act(() => root?.render(createElement(Probe)));
    setMode('edit');
    expect(marked()).toBe(false);
  });

  test('Preview marks the document and the Preview styles are in; Edit and Present clear it', () => {
    setMode('preview');
    expect(marked()).toBe(true);
    expect(document.getElementById('maude-preview-style')).not.toBeNull();
    setMode('present', { kind: 'artboards', from: 'start' });
    expect(marked()).toBe(false);
    setMode('preview');
    expect(marked()).toBe(true);
    setMode('edit');
    expect(marked()).toBe(false);
  });

  test('unmounting clears the mark', () => {
    setMode('preview');
    expect(marked()).toBe(true);
    act(() => root?.unmount());
    root = null;
    expect(marked()).toBe(false);
  });
});

// ── a web artboard scrolls inside itself ────────────────────────────────────────────────────────

describe('scrollsInside / previewWheelPassthrough', () => {
  function scroller(over: { top?: number; sh?: number; ch?: number; overflowY?: string }) {
    const board = document.createElement('div');
    board.className = 'dc-artboard-body';
    const el = document.createElement('div');
    el.style.overflowY = over.overflowY ?? 'auto';
    Object.defineProperty(el, 'scrollHeight', { value: over.sh ?? 3000 });
    Object.defineProperty(el, 'clientHeight', { value: over.ch ?? 900 });
    el.scrollTop = over.top ?? 0;
    const leaf = document.createElement('p');
    el.appendChild(leaf);
    board.appendChild(el);
    document.body.appendChild(board);
    return { board, el, leaf };
  }
  afterEach(() => {
    for (const b of document.querySelectorAll('.dc-artboard-body')) b.remove();
  });

  test('wheel down inside a scroller with room below: the design scrolls', () => {
    const { board, leaf } = scroller({ top: 0 });
    expect(scrollsInside(leaf, board, 0, 120)).toBe(true);
  });

  test('at the bottom, a wheel down pans the canvas; wheel up still scrolls', () => {
    const { board, leaf } = scroller({ top: 2100 }); // 2100 + 900 = 3000
    expect(scrollsInside(leaf, board, 0, 120)).toBe(false);
    expect(scrollsInside(leaf, board, 0, -120)).toBe(true);
  });

  test('a surface that cannot scroll never takes the wheel', () => {
    const fits = scroller({ sh: 900, ch: 900 });
    expect(scrollsInside(fits.leaf, fits.board, 0, 120)).toBe(false);
    const hidden = scroller({ overflowY: 'hidden' });
    expect(scrollsInside(hidden.leaf, hidden.board, 0, 120)).toBe(false);
  });

  test('previewWheelPassthrough: Preview only, and a zoom or shift wheel is the canvas’s', () => {
    const { board, leaf } = scroller({ top: 0 });
    // a plain event shape: happy-dom's WheelEvent drops the modifier flags
    const wheel = (init: Partial<WheelEvent>) =>
      ({ deltaX: 0, deltaY: 120, target: leaf, ...init }) as unknown as WheelEvent;
    expect(previewWheelPassthrough(wheel({}), 'edit')).toBe(false);
    expect(previewWheelPassthrough(wheel({}), 'present')).toBe(false);
    expect(previewWheelPassthrough(wheel({}), 'preview')).toBe(true);
    expect(previewWheelPassthrough(wheel({ ctrlKey: true }), 'preview')).toBe(false);
    expect(previewWheelPassthrough(wheel({ metaKey: true }), 'preview')).toBe(false);
    expect(previewWheelPassthrough(wheel({ shiftKey: true }), 'preview')).toBe(false);
    // outside any artboard body there is nothing to scroll
    expect(previewWheelPassthrough(wheel({ target: document.body }), 'preview')).toBe(false);
    expect(board.isConnected).toBe(true);
  });
});
