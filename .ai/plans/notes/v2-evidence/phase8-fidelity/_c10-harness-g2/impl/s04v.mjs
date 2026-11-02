// FINAL (D2): try md-present-video on the base fixture's VideoEdit canvas (a video artboard with a clip)
import { base } from './fx.mjs';
export const fixture = base;
export const page = { w: 1440, h: 900, channel: true };
const D = '04-modes';
export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-videoedit', 4500);
  await page.mouse.click(720, 379);
  await sleep(1200);
  await page.keyboard.press('Alt+Meta+Enter');
  await sleep(2500);
  await h.step(`${D}/md-present-video`, 'Present a video artboard', 'select the Reel artboard, ⌥⌘↵', async () => {});
  await page.mouse.click(386, 855);
  await sleep(1500);
  await h.step(`${D}/md-present-video-play`, 'Present a video artboard, playing', 'Space', async () => {});
}
