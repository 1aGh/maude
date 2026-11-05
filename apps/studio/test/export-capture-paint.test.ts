// fix/204-capture-parity — a raster capture shoots only a frame painted AFTER its last layout change.
//
// The PNG shim resizes the viewport to the artboard (or region) and moves the world plane, then took
// the screenshot at once. Headless Chromium can hand back the compositor's previous surface for that
// shot: stale raster tiles of the 1440×900 page, repeated across the small viewport (seen on the Mac
// mini in ~half of the `acl-l21-capture` parity runs, on 2.0.3 and 2.0.4 alike — a mean pixel diff of
// 67). The shim now waits for two animation frames after every resize/move (`afterPaint`), the same
// wait `_ds-prove-playwright.mjs` already does.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterPaint } from '../bin/_pw-launch.mjs';

const BIN = join(import.meta.dir, '..', 'bin');

describe('afterPaint — a capture waits for a painted frame', () => {
  test('resolves only after two animation frames ran in the page', async () => {
    const queue: Array<() => void> = [];
    const fakeWindow = { requestAnimationFrame: (cb: () => void) => queue.push(cb) };
    let settled = false;
    const page = {
      // Playwright serialises the function into the page; here it runs against the fake window.
      evaluate: (fn: () => Promise<void>) => {
        const g = globalThis as unknown as { requestAnimationFrame?: unknown };
        const prev = g.requestAnimationFrame;
        g.requestAnimationFrame = fakeWindow.requestAnimationFrame;
        try {
          return fn();
        } finally {
          g.requestAnimationFrame = prev;
        }
      },
    };
    const done = afterPaint(page).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(queue.length).toBe(1);
    const g = globalThis as unknown as { requestAnimationFrame?: unknown };
    const prev = g.requestAnimationFrame;
    g.requestAnimationFrame = fakeWindow.requestAnimationFrame;
    try {
      queue.shift()?.(); // frame 1: layout committed, nothing painted yet
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(queue.length).toBe(1);
      queue.shift()?.(); // frame 2: the first frame after the change has been produced
    } finally {
      g.requestAnimationFrame = prev;
    }
    await done;
    expect(settled).toBe(true);
  });
});

describe('the PNG shim never shoots a frame older than its last layout change', () => {
  const src = readFileSync(join(BIN, '_png-playwright.mjs'), 'utf8');

  test('every screenshot follows an afterPaint that follows the last resize / world move', () => {
    const shots = [...src.matchAll(/page\.screenshot\(/g)].map((m) => m.index ?? 0);
    expect(shots.length).toBeGreaterThanOrEqual(2); // the region path and the per-artboard path
    for (const at of shots) {
      const before = src.slice(0, at);
      const lastChange = Math.max(
        before.lastIndexOf('setViewportSize('),
        before.lastIndexOf('layoutRegion('),
        before.lastIndexOf('ab.style.left')
      );
      const lastPaint = before.lastIndexOf('await afterPaint(page)');
      expect(lastChange).toBeGreaterThan(-1);
      expect(lastPaint).toBeGreaterThan(lastChange);
    }
  });
});
