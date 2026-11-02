// c7: 13 · ds-multi-panel — two systems in use ("Design systems · 2 in use"), the older one made before the schema (amber dot),
// the open canvas follows it: the inspector names it ("Uses <system>"). Fixture: makeSite 'old' + the maude core colours removed.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kit } from './g5.mjs';
import { makeSite } from './fx5.mjs';
export const fixture = async () => makeSite({ key: 'old', systems: ['maude-v2', 'maude'], canvases: ['Homepage', 'Landing', 'Pricing'] });
export const keepState = true;
export const page = { w: 1440, h: 900 };
const D = '13-design-system';
export async function prepare(project) {
  const f = join(project, '.design/system/maude/colors_and_type.css');
  const css = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*--(bg-0|bg-1|fg-0|accent):/.test(l)).join('\n');
  writeFileSync(f, css);
  for (const [n, ds] of [['Homepage', 'maude'], ['Landing', 'maude-v2'], ['Pricing', 'maude-v2']]) {
    const m = join(project, '.design/ui', `${n}.meta.json`);
    const j = existsSync(m) ? JSON.parse(readFileSync(m, 'utf8')) : {};
    writeFileSync(m, JSON.stringify({ ...j, designSystem: ds }, null, 2));
  }
}
export async function run(h) {
  const { page, sleep } = h;
  const k = kit(h);
  await page.locator('[data-testid="canvas-row-ui-homepage"]').first().waitFor({ timeout: 25000 }).catch(() => {});
  await h.open('ui-homepage', 4000);
  await k.deep('[data-dc-screen="desktop"] [data-cd-id="book"]', 3).catch(() => {});
  await k.inspector(true);
  if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
  await sleep(4000);
  await page.getByText(/^Uses /).first().scrollIntoViewIfNeeded().catch(() => {}); await sleep(600);
  await h.step(`${D}/ds-multi-panel`, 'Two systems in use, pinned together', 'Canvases panel, pinned strip; select a button', async () => {});
}
