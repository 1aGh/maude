// Round 7b (p8-c7-g0607b): 07 ve-captions and ve-music on a project that HAS its media - the interview's footage
// (assets/aaaa1111.mp4, its transcript sidecar is already there) and the song (assets/song.mp3, beats sidecar there).
// The earlier shots ran on the e2e fixture, whose footage and song files are absent, so no Transcript, no beat ticks.
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
export async function prepare(project) {
  const a = join(project, '.design/assets');
  copyFileSync(join(a, 'reel-c.mp4'), join(a, 'aaaa1111.mp4'));
  copyFileSync(join(a, 'music.mp3'), join(a, 'song.mp3'));
}
const D = '07';
export async function run(h) {
  const { page, sleep } = h;
  const tid = (id) => page.locator(`[data-testid="${id}"]`).first();
  const island = page.locator('[data-testid="timeline-island"]').first();
  const sel = async () => {
    for (let a = 0; a < 3; a++) {
      const box = await page.frameLocator('[data-testid="canvas-frame"]').locator('[data-dc-screen]').first().boundingBox({ timeout: 3000 }).catch(() => null);
      if (box) await h.board(box.x + 14, box.y + 14);
      else await h.board(720, 450);
      if (await island.count()) return;
      await page.keyboard.press('Meta+0');
      await sleep(900);
    }
  };
  const closePanel = async () => {
    if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
      await tid('panel-fold-left').click().catch(() => {});
      await sleep(500);
    }
  };
  const openC = async (slug, ms = 3000) => { await h.open(slug, ms); await closePanel(); await sleep(900); await page.keyboard.press('Meta+0'); await sleep(1200); };

  await openC('ui-videotranscript', 4000);
  await h.step(`${D}/ve-captions`, 'Edit the talk as text; style the captions', 'select the interview video, Captions from speech (the Transcript opens)', async () => {
    await sel();
    await page.locator('[aria-label="Captions from speech"]').first().click({ timeout: 5000 }).catch((e) => console.log('captions', e.message.split('\n')[0]));
    await sleep(2500);
    // the caption chips are a text clip: select one so the inspector reads Captions
    await h.click('timeline-caption-w0').catch(() => {});
    await sleep(900);
  });
  await h.esc(2);
  await openC('ui-videomusic', 4000);
  await h.step(`${D}/ve-music`, 'A music bed: beats, lower under speech, volume', 'open VideoMusic (song + beats present), select, click the bed', async () => {
    await sel();
    await h.click('timeline-audio-0').catch(() => {});
    await sleep(1200);
  });
}
