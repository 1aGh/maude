// S3.2b (md-present-canvas) — the pill's zoom: the canvas posts `viewport-zoom` while Present the canvas
// runs, once per whole percent; the shell keeps the last one and forgets it when Present ends.
import { describe, expect, test } from 'bun:test';

import { presentZoomStore } from '../client/v2/present/present-zoom-store.js';
import { createZoomReporter } from '../present/present-zoom.ts';

function fakeWin() {
  const sent: unknown[] = [];
  const parent = { postMessage: (m: unknown) => sent.push(m) };
  const win = { parent } as unknown as Window;
  return { win, sent };
}

describe('createZoomReporter', () => {
  test('nothing goes out while Present is not running', () => {
    const { win, sent } = fakeWin();
    const r = createZoomReporter(win);
    expect(r.report(0.21, false)).toBe(false);
    expect(sent).toEqual([]);
  });

  test('one message per whole percent, not per pixel of a pinch', () => {
    const { win, sent } = fakeWin();
    const r = createZoomReporter(win);
    expect(r.report(0.21, true)).toBe(true);
    expect(r.report(0.2104, true)).toBe(false); // still 21 %
    expect(r.report(0.2149, true)).toBe(false); // still 21 %
    expect(r.report(0.22, true)).toBe(true);
    expect(sent).toEqual([
      { dgn: 'viewport-zoom', zoom: 0.21 },
      { dgn: 'viewport-zoom', zoom: 0.22 },
    ]);
  });

  test('the next Present reports afresh, even at the same zoom', () => {
    const { win, sent } = fakeWin();
    const r = createZoomReporter(win);
    r.report(0.21, true);
    r.report(0.21, false); // Present ended
    r.report(0.21, true);
    expect(sent.length).toBe(2);
  });

  test('a bad zoom is never sent; a top-level window has no one to tell', () => {
    const { win, sent } = fakeWin();
    const r = createZoomReporter(win);
    for (const z of [0, -1, Number.NaN, Number.POSITIVE_INFINITY])
      expect(r.report(z, true)).toBe(false);
    expect(sent).toEqual([]);
    const top = {} as { parent?: unknown };
    top.parent = top;
    expect(createZoomReporter(top as unknown as Window).report(0.5, true)).toBe(false);
  });
});

describe('presentZoomStore', () => {
  test('keeps a finite zoom > 0, ignores anything else, notifies on change only', () => {
    let n = 0;
    const off = presentZoomStore.subscribe(() => {
      n += 1;
    });
    presentZoomStore.set(0.5);
    presentZoomStore.set(0.5);
    expect(presentZoomStore.get()).toBe(0.5);
    expect(n).toBe(1);
    presentZoomStore.set(Number.NaN);
    expect(presentZoomStore.get()).toBeNull();
    presentZoomStore.set(null);
    expect(n).toBe(2);
    off();
  });
});
