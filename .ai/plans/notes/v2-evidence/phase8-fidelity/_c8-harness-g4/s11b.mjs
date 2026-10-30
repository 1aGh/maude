import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { base } from './fx.mjs';
import { prepare as prep } from './s11.mjs';
export const fixture = base;
export const prepare = prep;
const D = '11-projects-and-navigation';
export async function run(h) {
  const { page, sleep, project } = h;
  await sleep(1500);
  await h.open('ui-uniformy-2027', 3000);
  const f = join(project, '.design/ui/Uniformy-2027.tsx');
  for (const t of ['Kalhoty doma', 'Kalhoty doma v2', 'Kalhoty doma v3']) {
    writeFileSync(f, readFileSync(f, 'utf8').replace(/Kalhoty doma( v\d)?/g, t));
    await sleep(2500);
  }
  await page.keyboard.press('Alt+Meta+h');
  await sleep(1500);
  console.log('TIDS', await page.evaluate(() => [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')).filter((t) => /histor|version|compare|restore/.test(t)).join(',')));
  const rows = page.locator('[data-testid^="vh-row-"]');
  console.log('rows', await rows.count());
  await rows.nth(1).click().catch((e) => console.log('click err', String(e).slice(0, 80)));
  await sleep(6000);
  await h.step('pn-history', D, 'edit the canvas file 3×, ⌥⌘H, click the second version (view read-only)', async () => {});
  const cmp = page.locator('[data-testid="vh-compare"]').first();
  console.log('compare', await cmp.count());
  await cmp.click({ timeout: 4000 }).catch((e) => console.log('cmp err', String(e).slice(0, 80)));
  await sleep(6000);
  await h.step('pn-compare', D, '… then Compare', async () => {});
}
