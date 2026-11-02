// SPEC capture: every artboard of the group's canvases, 1:1, both app themes, from the scratch copy of .design.
import { boot, playwright, sleep } from './lib.mjs';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const OUT = resolve(import.meta.dirname, 'spec');
const only = process.argv[2]; // optional canvas number filter e.g. 14
const CANVASES = [
  ['13', '13-design-system', 'ui/v2/13 Design System.tsx'],
  ['14', '14-editing', 'ui/v2/14 Editing.tsx'],
  ['15', '15-annotations', 'ui/v2/15 Annotations.tsx'],
];
const scratch = mkdtempSync(join(tmpdir(), 'maude-g5-'));
const project = resolve(import.meta.dirname, 'spec-root');
const s = await boot(project, scratch, {}, { theme: 'light' });
const browser = await playwright.chromium.launch();
const sizes = {};
try {
  for (const [num, dir, rel] of CANVASES) {
    if (only && only !== num) continue;
    mkdirSync(join(OUT, dir), { recursive: true });
    for (const theme of ['light', 'dark']) {
      const ctx = await browser.newContext({ viewport: { width: 2600, height: 2400 } });
      const page = await ctx.newPage();
      const errs = [];
      page.on('pageerror', (e) => errs.push(e.message));
      await page.goto(`${s.url}/_canvas-shell.html?canvas=${encodeURIComponent(rel)}`);
      await page.waitForSelector('[data-dc-screen]', { timeout: 30000 });
      await sleep(5000);
      if (theme === 'light') {
        await page.evaluate(() => { document.documentElement.dataset.maudeTheme = 'light'; });
        await sleep(2500);
      }
      const ids = await page.evaluate(() => [...document.querySelectorAll('[data-dc-screen]')].map((e) => e.getAttribute('data-dc-screen')));
      await page.evaluate(() => { window.__g5orig = document.querySelector('.dc-world').style.cssText; });
      for (const id of ids) {
        await page.evaluate((id) => {
          const art = document.querySelector(`[data-dc-screen="${id}"]`);
          const world = document.querySelector('.dc-world');
          const z = parseFloat(world.style.zoom) || 1;
          const vp = window.__maudeViewport();
          const r = art.getBoundingClientRect();
          const wx = (r.x - vp.x) / z, wy = (r.y - vp.y) / z;
          world.style.zoom = '1';
          world.style.setProperty('--dc-zoom', '1');
          world.style.transform = `translate(${40 - wx}px, ${40 - wy}px)`;
        }, id);
        await sleep(700);
        const bg0 = await page.evaluate((id) => { const m = document.querySelector(`[data-dc-screen="${id}"] .maude-v2`); return m ? getComputedStyle(m).getPropertyValue('--bg-0') : 'none'; }, id);
        if ((theme === 'dark') !== /^oklch\(\.[12]/.test(bg0) && bg0 !== 'none') console.log('THEME MISMATCH', id, theme, bg0);
        const body = page.locator(`[data-dc-screen="${id}"] .dc-artboard-body`).first();
        const box = await body.boundingBox();
        await body.screenshot({ path: join(OUT, dir, `${id}-${theme}.png`) });
        sizes[`${dir}/${id}-${theme}`] = [Math.round(box.width), Math.round(box.height)];
        await page.evaluate(() => { const w = document.querySelector('.dc-world'); w.style.cssText = window.__g5orig; });
      }
      console.log(dir, theme, ids.length, 'artboards', errs.length ? 'pageerrors: ' + errs.slice(0, 3).join('|') : '');
      await ctx.close();
    }
  }
} finally {
  writeFileSync(join(OUT, 'sizes.json'), JSON.stringify(sizes, null, 1));
  await browser.close();
  s.stop();
}
process.exit(0);
