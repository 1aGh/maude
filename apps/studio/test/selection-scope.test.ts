// V2-2.8 P2 — after a canvas switch, Export must not target the previous canvas's artboard.
import { describe, expect, test } from 'bun:test';

import {
  exportSelectionFor,
  isOwnSelectEcho,
  localSelectRecord,
} from '../client/selection-scope.js';

const A = { file: '.design/ui/a.tsx', artboardId: 'a-hero', selector: '[data-x]' };
const B = { file: '.design/ui/b.tsx', artboardId: 'b-card', selector: '[data-y]' };

describe('select echo', () => {
  const localA = localSelectRecord(A, '.design/ui/a.tsx', 1000);
  test('our own select echoed back for the same canvas is dropped', () => {
    expect(isOwnSelectEcho(A, localA, 1500)).toBe(true);
  });
  test('anything about the same canvas inside the window is dropped, as in v1', () => {
    // an older select's echo (or a parked restore) must not overwrite a newer drill
    expect(isOwnSelectEcho({ ...A, selector: '[data-older]' }, localA, 1500)).toBe(true);
    // after our clear on canvas a, a selection for canvas a is still ours to ignore
    expect(isOwnSelectEcho(A, localSelectRecord(null, '.design/ui/a.tsx', 1000), 1500)).toBe(true);
    // the echo of our own clear
    expect(isOwnSelectEcho(null, localSelectRecord(null, '.design/ui/a.tsx', 1000), 1500)).toBe(
      true
    );
  });
  test('the restore for the canvas we switched to applies, and so does its "none"', () => {
    expect(isOwnSelectEcho(B, localA, 1500)).toBe(false);
    expect(isOwnSelectEcho(null, localA, 1500)).toBe(false);
  });
  test('past the window, or before any local select, nothing is an echo', () => {
    expect(isOwnSelectEcho(A, localA, 3500)).toBe(false);
    expect(isOwnSelectEcho(A, { at: 0, sel: null, file: null }, 1500)).toBe(false);
  });
});

describe('export scope', () => {
  test('a selection on the active canvas scopes the dialog', () => {
    expect(exportSelectionFor(A, A.file, null)).toEqual({
      activeArtboardId: 'a-hero',
      selection: { selector: '[data-x]', file: A.file },
    });
  });
  test('a selection left over from the previous canvas does not', () => {
    expect(exportSelectionFor(A, B.file, 'b-viewport')).toEqual({
      activeArtboardId: 'b-viewport',
      selection: null,
    });
  });
});
