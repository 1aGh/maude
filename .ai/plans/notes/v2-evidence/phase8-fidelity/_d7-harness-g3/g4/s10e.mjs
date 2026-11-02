import { base } from './fx.mjs';
import { fakeShare, fakeSync } from './s10.mjs';
export const fixture = base;
const D = '10-share-and-collaboration';
// co-share-advanced on a taller window (1440x1040) so the whole sheet incl. "Where it syncs" is in the frame.
export async function run(h) {
  const { page, sleep } = h;
  await fakeShare(page);
  await fakeSync(page, { pending: 0 });
  await page.setViewportSize({ width: 1440, height: 1200 });
  await page.reload();
  await sleep(3000);
  await h.open('ui-print', 1500);
  await h.click('panel-fold-left').catch(() => {});
  await h.step('co-share-advanced-tall', D, 'FAKED share API: Advanced fold open, 1040 px window', async () => {
    await h.click('share-cluster-share');
    await sleep(500);
    await h.click('share-other-ways-toggle').catch(() => {});
    await sleep(600);
  });
}
