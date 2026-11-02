import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { REPO } from './lib.mjs';
// A copy of this repo's .design (real design system + ~20 v2 boards): the panel with the pinned Design system row.
export const fixture = async () => join(REPO, '.scr/design-copy');
export async function prepare(project) { rmSync(join(project, '.design/_canvas-state'), { recursive: true, force: true }); }
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep } = h;
  await page.locator("[data-testid=canvases-pinned]").first().waitFor({ timeout: 90000 }).catch(() => {}); await page.getByText("Loading canvases").first().waitFor({ state: "detached", timeout: 120000 }).catch(() => {});
  await sleep(6000);
  await h.step('pn-ds', D, 'project WITH a design system (copy of this repo’s .design): Canvases panel, pinned Design system row', async () => {});
  await page.keyboard.press('Meta+k');
  await sleep(600);
  await page.keyboard.type('design');
  await sleep(1500);
  await h.step('pn-ds-search', D, '⌘K "design"', async () => {});
}
