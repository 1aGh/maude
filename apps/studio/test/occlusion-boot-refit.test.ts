// V2-1.2 §5.6 I2 — boot re-fit, once only (V2-4.1 lead patch). The shell's first `occluded-insets`
// usually lands after the canvas's boot fit; the canvas re-fits once if the camera is still exactly the
// boot fit, and never again on a later inset change (I1).
import { describe, expect, test } from 'bun:test';
import {
  type CanvasModeSnapshot,
  type CanvasModeStore,
  onFirstInsets,
  shouldBootRefit,
} from '../bridge/canvas-mode-store.ts';
import { ZERO_INSETS } from '../bridge/occlusion.ts';

function fakeStore(initial: CanvasModeSnapshot) {
  let snap = initial;
  const subs = new Set<(s: CanvasModeSnapshot) => void>();
  const store: CanvasModeStore = {
    get: () => snap,
    subscribe(fn) {
      subs.add(fn);
      return () => {
        subs.delete(fn);
      };
    },
  };
  const push = (s: CanvasModeSnapshot) => {
    snap = s;
    for (const fn of [...subs]) fn(s);
  };
  return { store, push, subs };
}

const LEFT = { top: 0, right: 0, bottom: 0, left: 280 };
const BOOT = { x: 12, y: 40, zoom: 0.5 };

describe('onFirstInsets', () => {
  test('fires once, on the first applied insets, then unsubscribes', () => {
    const { store, push, subs } = fakeStore({ insets: ZERO_INSETS, insetsSeq: -1 });
    const seen: number[] = [];
    onFirstInsets(store, (s) => seen.push(s.insetsSeq));
    expect(seen).toEqual([]);
    push({ insets: LEFT, insetsSeq: 0 });
    push({ insets: LEFT, insetsSeq: 1 });
    expect(seen).toEqual([0]);
    expect(subs.size).toBe(0);
  });

  test('fires immediately when the insets arrived before the subscription', () => {
    const { store } = fakeStore({ insets: LEFT, insetsSeq: 3 });
    const seen: number[] = [];
    onFirstInsets(store, (s) => seen.push(s.insetsSeq));
    expect(seen).toEqual([3]);
  });
});

describe('shouldBootRefit', () => {
  test('re-fits while the camera is still the boot fit', () => {
    expect(shouldBootRefit(BOOT, { ...BOOT }, false, LEFT)).toBe(true);
  });
  test('never after a gesture moved the camera, or during one', () => {
    expect(shouldBootRefit(BOOT, { ...BOOT, x: 13 }, false, LEFT)).toBe(false);
    expect(shouldBootRefit(BOOT, { ...BOOT }, true, LEFT)).toBe(false);
  });
  test('never for a persisted / resumed camera (no boot fit) or all-zero insets', () => {
    expect(shouldBootRefit(null, { ...BOOT }, false, LEFT)).toBe(false);
    expect(shouldBootRefit(BOOT, { ...BOOT }, false, ZERO_INSETS)).toBe(false);
  });
});
