import { $, browser } from '@wdio/globals';

type Pt = { x: number; y: number };

/**
 * Select a video artboard by its name strip until the timeline island comes out.
 *
 * One click on a box measured once misses under load: the fitted camera can still be moving, or a module
 * hot-swap swallows the click (2026-10-27 V2-8.3 record, video-formats). So measure again and click again until
 * the island exists. The caller's own `waitForExist` after this still names a miss.
 */
export async function selectUntilIsland(
  box: () => Promise<Pt | null>,
  click: (x: number, y: number) => Promise<unknown>,
  { timeout = 15_000, island = '[data-testid="timeline-island"]' } = {}
): Promise<void> {
  await browser
    .waitUntil(
      async () => {
        if (await $(island).isExisting()) return true;
        const b = await box();
        if (b) await click(b.x + 12, b.y - 10);
        return $(island)
          .waitForExist({ timeout: 2_500 })
          .then(
            () => true,
            () => false
          );
      },
      { timeout, interval: 250 }
    )
    .catch(() => undefined);
}
