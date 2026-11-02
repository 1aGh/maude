// 13 · ds-multi-schema — a system made before the schema: the amber dot on its row and "Bring <system> up to the schema?".
// Not AI-driven until the person presses "Bring it up": the sheet is the server's `upgrade status`. Fixture: the converted
// project with the `maude` system's core colours removed (so its check says level 11, "Made before the schema").
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { REPO } from './lib.mjs';
import { stubClaudeEnv } from '../scripts/lib/stub-claude.mjs';
import { kit } from './g5.mjs';
import { makeSite } from './fx5.mjs';
export const fixture = async () => makeSite({ key: 'old', systems: ['maude-v2', 'maude'], canvases: ['Homepage', 'Landing'] });
export const keepState = true;
export const page = { w: 1440, h: 900 };
const D = '13-design-system';
export async function prepare(project) {
  const f = join(project, '.design/system/maude/colors_and_type.css');
  const css = readFileSync(f, 'utf8').split('\n').filter((l) => !/^\s*--(bg-0|bg-1|fg-0|accent):/.test(l)).join('\n');
  writeFileSync(f, css);
}
export async function run(h) {
  const { page, sleep, project, scratch } = h;
  const k = kit(h);
  const home = join(scratch, 'home');
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), NO_OPEN: '1', MAUDE_NO_AUTOBUILD: '1', ...stubClaudeEnv(home) };
  await h.open('ui-homepage', 4000);
  const r = spawnSync('bun', [join(REPO, 'apps/studio/bin/_ds.mjs'), 'status', 'maude', '--root', project], { env, encoding: 'utf8' });
  console.log('ds status maude →', (r.stdout || '').replace(/\s+/g, ' ').slice(0, 700));
  await k.inspector(true);
  if (!(await page.locator('[data-testid="canvases-pinned"]').first().isVisible().catch(() => false))) { await page.locator('[data-testid="panel-icon-left"]').first().click().catch(() => {}); await sleep(900); }
  await sleep(2500);
  await h.step(`${D}/ds-multi-schema.row`, 'The amber dot on the old system’s row (context)', 'Canvases panel, pinned strip', async () => {});
  await h.step(`${D}/ds-multi-schema`, 'Bring it up to the schema?', 'row ⋯ › Bring it up to the schema…', async () => {
    await page.evaluate(() => document.querySelector('[data-testid="canvases-ds-row-menu"]')?.click()); await sleep(900);
    await page.getByRole('menuitem', { name: /Bring it up to the schema/ }).first().click().catch(() => console.log('no upgrade item'));
    await page.locator('[data-testid="ds-upgrade"]').first().waitFor({ timeout: 15000 }).catch(() => console.log('no upgrade sheet'));
    await sleep(2500);
  });
}
