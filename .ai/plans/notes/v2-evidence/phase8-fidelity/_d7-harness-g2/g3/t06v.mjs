// Round 9 (p8-c9-video): 06 ad-timeline on a keyframed title (NaborKeyframes) - diamonds on the clip lanes and the Keyframe card's
// easing / y / frames readout, instead of the empty "Pick a keyframe on a clip" state.
import { vid } from './fxv.mjs';
export const fixture = vid;
export const page = { w: 1440, h: 900 };
const D = '06-advanced';
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const full = async () => {
    for (let a = 0; a < 2; a++) {
      if ((await tid('timeline-panel').getAttribute('data-size').catch(() => null)) === 'full') return;
      await tid('timeline-size').click().catch(() => {});
      await sleep(900);
    }
  };
  await h.open('ui-naborkeyframes', 5000);
  if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) await tid('panel-fold-left').click().catch(() => {});
  await sleep(900);
  await page.keyboard.press('Meta+0');
  await sleep(1200);
  await h.step(`${D}/ad-timeline`, 'Timeline > Advanced open (a keyframed title picked)', 'open NaborKeyframes, click the video, Expand, Advanced, pick the first keyframe', async () => {
    const box = await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen]').first().boundingBox({ timeout: 3000 }).catch(() => null);
    if (box) await h.board(box.x + 14, box.y + 14);
    else await h.board(720, 450);
    await full();
    await tid('timeline-advanced-toggle').click().catch(() => {});
    await sleep(2200);
    await page.locator('[data-testid^="timeline-kf-"]').first().click({ timeout: 4000 }).catch((e) => console.log('kf', e.message.split('\n')[0]));
    await sleep(1200);
  });
}
