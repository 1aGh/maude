import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alli } from '../g3/fx3.mjs';
export const fixture = alli;
const D = '10-share-and-collaboration';

const mk = (id, author, t, text, replies = []) => ({
  id, file: 'ui/Matchday.tsx', selector: '', dom_path: [], tag: 'div', classes: '', bounds: null, html_excerpt: '',
  text, status: 'open', created: new Date(Date.now() - 86400000).toISOString(), resolved_at: null, author,
  thread: replies, mentions: [], artboard: 'hype', t, world: { x: 200, y: 80 },
});

// round 7c: co-comment-video — two timed threads on the trailer (Tereza at 0:06, Jonas at 0:11) and the timeline under it
export async function prepare(project) {
  const dir = join(project, '.design/_comments');
  mkdirSync(dir, { recursive: true });
  const list = [
    mk('c-tereza', 'Tereza', 6, 'Logo tu naskočí moc brzo — dej ho až po touchdownu.', [
      { id: 'r1', author: 'Jonas', text: 'Souhlas. A hudba ať tam na vteřinu ztichne.', created: new Date(Date.now() - 3 * 3600000).toISOString() },
    ]),
    mk('c-jonas', 'Jonas', 11, 'Tady by sedělo víc záběrů z tribuny.'),
  ];
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
  await h.step('co-comment-video', D, 'Edit, the trailer selected, playhead at 0:06: the two timed threads are markers on the timeline strip (the timeline is an Edit surface; Preview shows none)', async () => {}, { reach: 'partial', note: 'the Comment tool and the thread card are Preview; the timeline strip is Edit: shown in Edit' });
  const n = await page.locator('[data-testid="timeline-comments-count"]').count();
  console.log('timeline-comments-count', n);
  await h.esc(3);
}
