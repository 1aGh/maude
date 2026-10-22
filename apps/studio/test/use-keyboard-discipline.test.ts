// use-keyboard-discipline — T29 (Wave 3). Pure nudge-delta fixture.

import { describe, expect, test } from 'bun:test';

import { nudgeDelta, selectsArtboardLevel } from '../use-keyboard-discipline.tsx';

describe('nudgeDelta', () => {
  test('non-arrow key → null', () => {
    expect(nudgeDelta({ key: 'a', shift: false })).toBeNull();
    expect(nudgeDelta({ key: 'Tab', shift: false })).toBeNull();
    expect(nudgeDelta({ key: 'Enter', shift: true })).toBeNull();
  });

  test('arrow without shift → 1 px step', () => {
    expect(nudgeDelta({ key: 'ArrowLeft', shift: false })).toEqual({ dx: -1, dy: 0 });
    expect(nudgeDelta({ key: 'ArrowRight', shift: false })).toEqual({ dx: 1, dy: 0 });
    expect(nudgeDelta({ key: 'ArrowUp', shift: false })).toEqual({ dx: 0, dy: -1 });
    expect(nudgeDelta({ key: 'ArrowDown', shift: false })).toEqual({ dx: 0, dy: 1 });
  });

  test('arrow with shift → 10 px step', () => {
    expect(nudgeDelta({ key: 'ArrowLeft', shift: true })).toEqual({ dx: -10, dy: 0 });
    expect(nudgeDelta({ key: 'ArrowRight', shift: true })).toEqual({ dx: 10, dy: 0 });
    expect(nudgeDelta({ key: 'ArrowUp', shift: true })).toEqual({ dx: 0, dy: -10 });
    expect(nudgeDelta({ key: 'ArrowDown', shift: true })).toEqual({ dx: 0, dy: 10 });
  });
});

// V2-8.5 C2 (08 · ak-mixed-select) — ⌘A is "everything at this level"
describe('selectsArtboardLevel', () => {
  test('nothing selected, or only whole artboards, is the canvas level: ⌘A takes every artboard', () => {
    expect(selectsArtboardLevel([])).toBe(true);
    expect(selectsArtboardLevel([{ artboardId: 'ig' }])).toBe(true);
    expect(selectsArtboardLevel([{ artboardId: 'ig' }, { artboardId: 'karta1' }])).toBe(true);
  });
  test('an object selected is the artboard level: ⌘A takes that artboard’s objects', () => {
    expect(selectsArtboardLevel([{ id: 'hero', artboardId: 'ig' }])).toBe(false);
    expect(selectsArtboardLevel([{ artboardId: 'ig' }, { id: 'hero', artboardId: 'ig' }])).toBe(
      false
    );
  });
});
