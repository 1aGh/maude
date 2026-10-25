import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { REPO } from './lib.mjs';
// A copy of this repo's v2 design system + boards, ONE system (the board's project has one): the panel's pinned "Design system" card.
export const fixture = async () => join(REPO, '.scr/design-copy1');
export async function prepare(project) { rmSync(join(project, '.design/_canvas-state'), { recursive: true, force: true }); }
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  await page.locator('[data-testid=canvases-pinned]').first().waitFor({ timeout: 90000 }).catch(() => {});
  await page.getByText('Loading canvases').first().waitFor({ state: 'detached', timeout: 120000 }).catch(() => {});
  await sleep(5000);
  // open the system: the pinned row is then the current one (the board's tinted card)
  await page.locator('[data-testid="canvases-ds-row"]').first().click({ timeout: 8000 }).catch((e) => console.log('ds row click', String(e).slice(0, 80)));
  await sleep(6000);
  if (!(await page.locator('[data-testid="canvases-ds-row"]').count())) { await h.click('panel-icon-left').catch(() => {}); await sleep(1500); }
  await h.step('pn-ds', D, 'project WITH one design system (copy of this repo’s v2 system + boards): Canvases panel, the pinned Design system card, the system open', async () => {});
  await page.keyboard.press('Meta+k');
  await sleep(600);
  await page.keyboard.type('design');
  await sleep(1500);
  await h.step('pn-ds-search', D, '⌘K "design"', async () => {});
}
