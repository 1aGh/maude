// V2-3.11 — the canvas viewport's zoom keys (canvas-lib › useViewportController's keydown) resolve
// through the registry. ⌘1…⌘9 are the desktop's native tab accelerators (Safari / Chrome / Arc), so
// the canvas must leave them alone — a page that prevents ⌘1 keeps it from the AppKit menu.
import { describe, expect, test } from 'bun:test';

import { canvasKeyIndex, resolveCanvasKey } from '../actions/canvas-keys.ts';
import type { KeyEventLike } from '../actions/keys.ts';

const ZOOM = canvasKeyIndex(['view.zoom-in', 'view.zoom-out', 'view.zoom-fit', 'view.zoom-actual']);
const run = (e: KeyEventLike, typing = false) => resolveCanvasKey(ZOOM, e, typing);

describe('canvas zoom keys', () => {
  test('⌘0 fits, ⌘= / ⌘+ zoom in, ⌘− zooms out', () => {
    expect(run({ key: '0', code: 'Digit0', metaKey: true })).toBe('view.zoom-fit');
    expect(run({ key: '=', code: 'Equal', metaKey: true })).toBe('view.zoom-in');
    expect(run({ key: '+', code: 'Equal', metaKey: true, shiftKey: true })).toBe('view.zoom-in');
    expect(run({ key: '-', code: 'Minus', metaKey: true })).toBe('view.zoom-out');
  });
  test('⌘1…⌘9 are not canvas keys any more (the native tab accelerators own them)', () => {
    for (let n = 1; n <= 9; n++)
      expect(run({ key: String(n), code: `Digit${n}`, metaKey: true })).toBeNull();
    // Czech QWERTZ types ⌘1 as ⌘⇧ + the "+" key.
    expect(run({ key: '1', code: 'Digit1', metaKey: true, shiftKey: true })).toBeNull();
  });
  test('⇧0 is Actual size on US (")") and Czech QWERTZ ("0"), never while typing', () => {
    const us = { key: ')', code: 'Digit0', shiftKey: true };
    const cz = { key: '0', code: 'Digit0', shiftKey: true };
    expect(run(us)).toBe('view.zoom-actual');
    expect(run(cz)).toBe('view.zoom-actual');
    expect(run(us, true)).toBeNull();
    expect(run(cz, true)).toBeNull();
  });
  test('a bare 0 is not Actual size', () => {
    expect(run({ key: '0', code: 'Digit0' })).toBeNull();
  });
});
