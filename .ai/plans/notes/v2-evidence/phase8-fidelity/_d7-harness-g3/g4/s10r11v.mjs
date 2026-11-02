import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alli } from './fx3.mjs';
export const fixture = alli;
const D = '10-share-and-collaboration';

const mk = (id, author, t, text, replies = []) => ({
  id, file: '.design/ui/Matchday.tsx', selector: '', dom_path: [], tag: 'div', classes: '', bounds: null, html_excerpt: '',
  text, status: 'open', created: new Date(Date.now() - 86400000).toISOString(), resolved_at: null, author,
  thread: replies, mentions: [], artboard: 'hype', t, world: { x: 200, y: 80 },
});

// round 7c: co-comment-video — two timed threads on the trailer (Tereza at 0:06, Jonas at 0:11) and the timeline under it
export async function prepare(project) {
  // round 11: ONE existing thread (Jonas at 0:21); the other is made through the product at the playhead, so the strip counts "2 comments on this video" like the board
  const dir = join(project, '.design/_comments');
  mkdirSync(dir, { recursive: true });
  const list = [mk('c-jonas', 'Jonas', 11, 'Tady by sedělo víc záběrů z tribuny.')];
  for (const n of ['ui-matchday']) writeFileSync(join(dir, `${n}.json`), JSON.stringify(list, null, 2));
}

export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-matchday', 3500);
  await h.click('panel-fold-left').catch(() => {});
  await sleep(600);
  await page.keyboard.press('Meta+0');
  await sleep(1500);
  const frame = page.frameLocator('[data-testid="canvas-frame"]');
  const b = await frame.locator('[data-dc-screen="hype"]').first().boundingBox().catch(() => null);
  console.log('hype box', JSON.stringify(b));
  if (b) await page.mouse.click(b.x + 40, b.y - 12);
  await sleep(1800);
  // seek to Tereza's moment (0:06): the strip's marker is at the playhead
  const tl = await page.locator('[data-testid="timeline-track"]').first().boundingBox().catch(() => null);
  console.log('track box', JSON.stringify(tl));
  if (tl) { await page.mouse.click(tl.x + 210 - 164 + (546 - 210) + 0, tl.y + 36); await sleep(900); }
  // round 10: the board's frame is the comment state ON the video: Preview, the Comment tool armed, a pin on the
  // picture and its thread card open beside it. Made through the product (a pin needs a real world point): click the
  // picture with the Comment tool, send, then open the pin.
  await h.click('palette-mode-preview').catch(() => {});
  await sleep(1500);
  await page.keyboard.press('c');
  await sleep(900);
  const hb = await frame.locator('[data-dc-screen="hype"]').first().boundingBox().catch(() => null);
  console.log('hype box (preview)', JSON.stringify(hb));
  if (hb) await page.mouse.click(hb.x + hb.width - 50, hb.y + 40);
  await sleep(1200);
  await page.keyboard.type('Logo tu naskočí moc brzo — dej ho až po touchdownu.');
  await sleep(500);
  await page.keyboard.press('Meta+Enter');
  await sleep(1800);
  const pins = frame.locator('.cm-pin');
  console.log('pins', await pins.count());
  const pb = await pins.last().boundingBox().catch(() => null);
  console.log('pin box', JSON.stringify(pb));
  if (pb) await page.mouse.click(pb.x + pb.width / 2, pb.y + pb.height / 2);
  await sleep(1500);
  console.log('strip', await page.locator('[data-testid="comment-strip"]').count(), (await page.locator('[data-testid="comment-strip-count"]').allInnerTexts().catch(() => [])).join('|'));
  await h.step('co-comment-video', D, 'Preview, Comment tool armed, a pin on the trailer and its thread card open, the comment strip under the picture (round 11)', async () => {}, { reach: 'full' });
  await h.esc(3);
}
