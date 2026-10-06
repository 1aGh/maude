// #131 — a canvas stuttered in Safari while panning with something selected.
//
// `detectDsThemeSupport` probes the DS theme blocks by appending elements to
// <body> and reading getComputedStyle for every candidate class — a style
// recalc of the whole document. It cached only a POSITIVE answer, so on a
// canvas whose DS has a single theme it re-probed on every call, and the
// element toolbar's menu asks on every render: every frame of a pan with a
// selection. On a 160-board canvas in real Safari that held pan at 13 frames
// per 10 s; caching the negative answer brought it to ~500.
//
// The negative answer holds until a stylesheet is added to (or finishes
// loading in) the document — the reason it was never cached: a DS stylesheet
// that parses after first paint.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

describe('DS theme support probe', () => {
  test('a single-theme DS is probed once, not on every call', async () => {
    const { detectDsThemeSupport, __resetDsThemeProbeForTests } = await import(
      '../canvas-shell.tsx'
    );
    // An earlier file in the same `bun test` process may have imported the
    // shell and already cached an answer.
    __resetDsThemeProbeForTests();
    let reads = 0;
    const real = window.getComputedStyle.bind(window);
    window.getComputedStyle = ((el: Element, p?: string | null) => {
      reads += 1;
      return real(el, p);
    }) as typeof window.getComputedStyle;
    try {
      expect(detectDsThemeSupport().supported).toBe(false);
      const afterFirst = reads;
      expect(afterFirst).toBeGreaterThan(0);
      for (let i = 0; i < 60; i++) detectDsThemeSupport(); // a second of a pan
      expect(reads).toBe(afterFirst);

      // A stylesheet arrives (the DS CSS parsed after first paint): probe again.
      const style = document.createElement('style');
      style.textContent = '.ds[data-theme="light"]{--bg-0:#fff}.ds[data-theme="dark"]{--bg-0:#000}';
      document.head.appendChild(style);
      await new Promise((r) => setTimeout(r, 0)); // MutationObserver delivery
      detectDsThemeSupport();
      expect(reads).toBeGreaterThan(afterFirst);
    } finally {
      window.getComputedStyle = real;
    }
  });
});
