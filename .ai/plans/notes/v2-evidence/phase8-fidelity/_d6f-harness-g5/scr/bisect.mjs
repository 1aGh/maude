import { boot, playwright, scratchProject, sleep, REPO } from './lib.mjs';
import { join } from 'node:path';
import { readdirSync, rmSync } from 'node:fs';
const all = readdirSync(join(REPO, '.scr/fx-cache/ds-converted/.design/system/maude-v2/preview')).filter((f) => f.endsWith('.tsx'));
const browser = await playwright.chromium.launch();
async function bad(keep) {
  const { scratch, project } = scratchProject(join(REPO, '.scr/fx-cache/ds-converted'), true);
  const dir = join(project, '.design/system/maude-v2/preview');
  for (const f of all) if (!keep.includes(f)) rmSync(join(dir, f));
  const s = await boot(project, scratch, {}, { theme: 'light' });
  const page = await (await browser.newContext()).newPage();
  let is403 = false;
  page.on('response', (r) => { if (r.status() === 403 && /design-system\.tsx/.test(r.url())) is403 = true; });
  await page.goto(`${s.url}/_canvas-shell.html?canvas=${encodeURIComponent('system/maude-v2/design-system.tsx')}`);
  await sleep(6000);
  s.stop();
  return is403;
}
let pool = all.filter((f) => f !== 'ui_kits-desktop-showcase.tsx');
const culprits = ['ui_kits-desktop-showcase.tsx'];
for (let round = 0; round < 6; round++) {
  if (!(await bad(pool))) { console.log('CLEAN with', culprits.length, 'removed'); break; }
  let cand = pool;
  while (cand.length > 1) {
    const half = cand.slice(0, Math.ceil(cand.length / 2));
    const rest = cand.slice(half.length);
    if (await bad(half)) cand = half; else if (await bad(rest)) cand = rest; else break;
  }
  console.log('CULPRIT', cand.join(','));
  culprits.push(cand[0]);
  pool = pool.filter((f) => f !== cand[0]);
}
console.log('ALL', culprits.join(','));
await browser.close();
process.exit(0);
