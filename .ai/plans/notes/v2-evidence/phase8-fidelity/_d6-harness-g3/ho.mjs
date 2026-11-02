import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { alli } from './fx3.mjs';
export const fixture = alli;
export const page = { w: 1440, h: 900 };
const D = '09';
// round 7: the last review of Matchday is planted as the critic's own hand-off file (no blockers), so the sheet reads "Last review: no blockers"
export async function prepare(project) {
  const dir = join(project, '.design/_runs/s1/handoff');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'design-critic-1.in.json'), JSON.stringify({ role: 'in', scope: { canvas: '.design/ui/Matchday.tsx' } }));
}
export async function run(h) {
  const { page, sleep } = h;
  await page.evaluate(() => localStorage.setItem('maude-handoff-last-target', 'web'));
  await h.open('ui-matchday', 3500);
  const closePanel = async () => {
    if (await page.locator('[data-testid^="canvas-row-"]').first().isVisible().catch(() => false)) {
      await page.locator('[data-testid="panel-fold-left"]').first().click().catch(() => {});
      await sleep(500);
    }
  };
  await closePanel();
  await sleep(600);
  await page.keyboard.press('Meta+0');
  await sleep(1200);
  await page.keyboard.press('Shift+Meta+h');
  await sleep(1500);
  if (!(await page.getByText(/to production/i).count())) {
    await h.esc(2);
    await page.keyboard.press('Meta+k');
    await sleep(500);
    await page.keyboard.type('hand off');
    await sleep(800);
    await page.locator('[data-testid="palette-row-action:handoff.open"]').first().click({ timeout: 3000 }).catch(() => {});
    await sleep(1500);
  }
  await page.locator('.ho-targets').first().waitFor({ timeout: 15000 }).catch(() => console.log('NO handoff targets'));
  await sleep(600);
  await h.step(`${D}/ex-handoff`, '⇧⌘H — pick where the code goes', '⇧⌘H', async () => {});
  await h.step(`${D}/ex-handoff-edges`, 'Handoff without AI', 'click Hand off signed out', async () => {
    await page.getByRole('button', { name: /^hand off/i }).last().click({ timeout: 2500 }).catch(() => {});
    await sleep(2500);
    console.log(await page.evaluate(() => document.querySelector('[data-testid="export-sheet"]')?.outerHTML.slice(0, 1800)));
  });
}
