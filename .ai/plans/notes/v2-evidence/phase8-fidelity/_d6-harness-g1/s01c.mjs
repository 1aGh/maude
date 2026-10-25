import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { big } from './fx.mjs';
export const fixture = big;
const D = '01';
// c7: this Mac has been in the project before - its last canvas is Combine campaign (Wide), and three others were opened earlier
export async function prepare(project) {
  const dir = join(project, '.design/_canvas-state');
  mkdirSync(dir, { recursive: true });
  const now = Date.now();
  writeFileSync(join(dir, '_recent.json'), JSON.stringify({ v: 1, opened: {
    'ui/Wide.tsx': now - 60_000,
    'ui/campaign/Campaign01.tsx': now - 3_600_000,
    'ui/brand/Brand03.tsx': now - 7_200_000,
    'ui/web/Web05.tsx': now - 2 * 86_400_000,
  } }));
}
export async function run(h) {
  const { page, sleep } = h;
  // c7: the stray "What's new" toast the server still remembers is not part of the board's frame
  for (const n of await page.locator('.maude-notice', { hasText: 'new' }).all()) await n.locator('.maude-notice-close').first().click({ timeout: 1500 }).catch(() => {});
  await sleep(400);
  const folder = () => page.getByText('campaign', { exact: true }).first().click().catch(() => {});
  await h.step(`${D}/cf-big-tree`, '93 canvases in folders — the Canvases panel', 'big fixture, one folder expanded', async () => {
    await folder();
    await sleep(600);
  });
  await folder();
  await h.step(`${D}/cf-panel-search`, 'Search inside the panel: "campaign"', 'type into canvas-search', async () => {
    await h.tid('canvas-search').click();
    await page.keyboard.type('campaign');
    await sleep(600);
  });
  await page.keyboard.press('Escape');
  await h.tid('canvas-search').locator('input').first().fill('').catch(() => {});
  await h.step(`${D}/cf-search-k`, '⌘K — canvases first, then tools', 'press Meta+k, type "camp"', async () => {
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('camp');
    await sleep(600);
  });
  await h.esc(2);
  await h.open('ui-wide', 2500);
  await h.step(`${D}/cf-open-big`, '21 artboards, fit to view', 'open the 21-artboard canvas, ⌘0 fits', async () => {
    // c7: ⌘0 is the canvas's own key - a person has the canvas under the pointer, so focus it first (empty canvas, not a board)
    await page.mouse.click(450, 520);
    await sleep(300);
    await page.keyboard.press('Meta+0');
    await sleep(900);
    // c7: the board's frame is also ⌘\ — the panels fold into their icons and the toast says how to bring them back
    await page.keyboard.press('Meta+\\');
    await sleep(900);
  });
  // cf-render-error is shot by s01d (a throwing component)
}
