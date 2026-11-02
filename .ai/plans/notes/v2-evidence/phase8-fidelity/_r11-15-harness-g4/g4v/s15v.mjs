// Round 11 (p8-r11-15): 15 Annotations · an-video on REAL footage — the Alligators Recruiting Trailer (30 s, 24 clips, artboard "trailer") in
// Preview, two notes pinned to it (0:12 and 0:21, in their paper) and one timed comment (0:25): the strip under the picture says
// "2 notes · 1 comment" with a bar per note and a face at 0:25, the playhead sits on the first note (its "0:12" chip in full ink,
// the other note dimmed). Run from the g4 lib of _d7-harness-g3 (`node run.mjs <this file> dark,light`), shots land in
// .scr/impl/15-annotations/an-video-<theme>.png like every other 15 frame.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { alli } from '../../_d7-harness-g3/g4/fx3.mjs';
import { REPO } from '../../_d7-harness-g3/g4/lib.mjs';

export const fixture = alli;
const D = '15-annotations';

export async function prepare(project) {
  const dir = join(project, '.design/_comments');
  mkdirSync(dir, { recursive: true });
  const list = [
    {
      id: 'c-tereza', file: '.design/ui/Alligators Recruiting Trailer.tsx', selector: '', dom_path: [], tag: 'div', classes: '', bounds: null, html_excerpt: '',
      text: 'Tady by sedělo víc záběrů z tribuny.', status: 'open', created: new Date(Date.now() - 86400000).toISOString(), resolved_at: null,
      author: 'Tereza', thread: [], mentions: [], artboard: 'trailer', t: 25, world: { x: 200, y: 80 },
    },
  ];
  writeFileSync(join(dir, 'ui-alligators-recruiting-trailer.json'), JSON.stringify(list, null, 2));
}

const annotate = (project, rel, ops, extra = []) => {
  const f = join(project, '.design', `_ops-${Date.now()}.json`);
  writeFileSync(f, JSON.stringify({ ops }));
  const r = spawnSync('node', [join(REPO, 'cli/bin/maude.mjs'), 'design', 'annotate', rel, '--ops', f, '--root', project, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, NO_OPEN: '1' },
  });
  if (r.status !== 0) console.log('annotate failed', r.status, (r.stdout || '').slice(0, 600), (r.stderr || '').slice(0, 600));
  return r;
};

export async function run(h) {
  const { page, sleep } = h;
  await h.open('ui-alligators-recruiting-trailer', 3500);
  await h.click('panel-fold-left').catch(() => {});
  await sleep(600);
  await page.keyboard.press('Meta+0');
  await sleep(1500);
  const f = page.frames().find((x) => x !== page.mainFrame() && /canvas-shell/.test(x.url()));
  const rects = await f.evaluate(() => window.__maudeCanvasRects());
  const vid = rects.artboards.find((a) => a.id === 'trailer') || rects.artboards[0];
  console.log('video rect', JSON.stringify(vid));
  const rf = join(h.project, '.design', '_rects.json');
  writeFileSync(rf, JSON.stringify(rects));
  annotate(
    h.project,
    'ui/Alligators Recruiting Trailer.tsx',
    [
      { op: 'create', type: 'sticky', text: 'Logo naskočí moc brzo', x: Math.round(vid.x + vid.w * 0.58), y: Math.round(vid.y + vid.h * 0.18), w: 190, h: 130, color: '#f2a08c', timeRange: { artboard: 'trailer', start: 12, end: 15 } },
      { op: 'create', type: 'sticky', text: 'Tady hudba vypadne?', x: Math.round(vid.x + vid.w * 0.1), y: Math.round(vid.y + vid.h * 0.52), w: 170, h: 120, color: '#f7e08a', timeRange: { artboard: 'trailer', start: 21, end: 24 } },
    ],
    ['--rects', rf]
  );
  await sleep(2500);
  await h.click('palette-mode-preview').catch(() => {});
  await sleep(1800);
  const first = page.locator('[data-testid^="comment-strip-note-"]').first();
  console.log('strip', await page.locator('[data-testid="comment-strip"]').count(), (await page.locator('[data-testid="comment-strip-count"]').allInnerTexts().catch(() => [])).join('|'));
  if (await first.count()) { await first.click().catch(() => {}); await sleep(1500); }
  await h.step('an-video', D, 'Preview of the trailer: two notes pinned (0:12, 0:21) and a comment (0:25); the strip marks them, the playhead sits on the first note', async () => {}, { reach: 'full' });
  await h.esc(3);
}
