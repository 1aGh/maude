// V2-8.14 (p8-perf-814): asset tiles took 52 s for 194 pictures (budget 30 s / 250) on the
// e308179d0 freeze. The tile was encoded with `canvas.toBlob`, which Chromium runs as an IDLE task
// with a 1 s fallback: when the renderer's main thread gets no idle period (it had served canvas
// pages in the bench), a tile's encode waited out that fallback — the bench measured the encode
// at p50 1004 ms, and 10 ms with the synchronous `toDataURL`. The page below has no idle time
// (every frame overruns), so the old encode takes ≥ 1 s here every time.

import { afterAll, describe, expect, test } from 'bun:test';

import { drawTile } from '../bin/_tile-draw.mjs';

type Page = {
  setContent(html: string): Promise<void>;
  evaluate<R, A>(fn: (a: A) => R | Promise<R>, arg: A): Promise<R>;
};
type Browser = { newPage(): Promise<Page>; close(): Promise<void> };

const PNG = `data:image/png;base64,${Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
).toString('base64')}`;

// every frame busy-waits past its deadline: the main thread never reaches an idle period
const NO_IDLE = `<!doctype html><body><script>
  (function frame() {
    const until = performance.now() + 40;
    while (performance.now() < until) {}
    requestAnimationFrame(frame);
  })();
</script></body>`;

let browser: Browser | null = null;
afterAll(async () => {
  await browser?.close();
});

describe('asset tile encode (V2-8.14 p8-perf-814)', () => {
  test('a tile is encoded at once on a page with no idle time, not after the 1 s idle fallback', async () => {
    const { launchChromium } = (await import('../bin/_pw-launch.mjs')) as {
      launchChromium: (o: { headless: boolean }) => Promise<Browser>;
    };
    browser = await launchChromium({ headless: true });
    const page = await browser.newPage();
    await page.setContent(NO_IDLE);
    const took: number[] = [];
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      const box = (await page.evaluate(drawTile, [PNG, 480, false] as [
        string,
        number,
        boolean,
      ])) as {
        w: number;
        h: number;
        jpeg?: string;
      } | null;
      took.push(performance.now() - t0);
      expect(box?.w).toBe(1);
      expect(box?.h).toBe(1);
      // a real JPEG (SOI marker), base64 without the data: prefix
      expect(Buffer.from(box?.jpeg ?? '', 'base64').subarray(0, 2)).toEqual(
        Buffer.from([0xff, 0xd8])
      );
    }
    console.error('tile draw ms', took.map(Math.round).join(','));
    expect(Math.max(...took)).toBeLessThan(700);
  }, 60_000);
});
