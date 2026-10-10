// V2-2.8 P2 — after a canvas switch, Export must not target the previous canvas's artboard.
import { describe, expect, test } from 'bun:test';

import { exportSelectionFor, isOwnSelectEcho } from '../client/selection-scope.js';

const A = { file: '.design/ui/a.tsx', artboardId: 'a-hero', selector: '[data-x]' };
const B = { file: '.design/ui/b.tsx', artboardId: 'b-card', selector: '[data-y]' };

describe('select echo', () => {
  test('our own select echoed back for the same canvas is dropped', () => {
    expect(isOwnSelectEcho(A, A, 1000, 1500)).toBe(true);
  });
  test('a restore for another canvas, or none, is never an echo', () => {
    expect(isOwnSelectEcho(B, A, 1000, 1500)).toBe(false);
    expect(isOwnSelectEcho(null, A, 1000, 1500)).toBe(false);
  });
  test('past the window nothing is an echo', () => {
    expect(isOwnSelectEcho(A, A, 1000, 3500)).toBe(false);
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
