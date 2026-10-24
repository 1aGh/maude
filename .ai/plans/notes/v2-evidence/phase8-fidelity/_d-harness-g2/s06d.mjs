// Stage D: ad-timeline became reachable (the timeline's Advanced fold exists now, S7.18). Base fixture, VideoEdit canvas.
import { base } from './fx.mjs';
export const fixture = base;
export const page = { w: 1440, h: 900, channel: true };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-videoedit', 4500);
  await page.mouse.click(720, 379);
  await sleep(1500);
  await h.step(`${D}/ad-timeline`, 'Timeline > Advanced open (video artboard selected)', 'open VideoEdit, click the Reel artboard label, click Expand on the timeline, click its Advanced row', async () => {
    await page.locator('text="Expand" >> visible=true').first().click({ timeout: 4000 }); await sleep(1200);
    await h.click('timeline-advanced-toggle');
    await sleep(1200);
  });
}
