// usage: node spec.mjs "<canvas file base e.g. 01 Create Flow>" <outdir> [theme=light|dark] [id,id,...]
// Board as designed. dark = the studio host's injected app-theme tokens on [data-dc-screen] [data-theme] (the default of the
// capture origin; .k-fixed pictures keep their own light palette). light = that host rule removed, the board's own
// data-theme="light" scopes apply (what the board source says).
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
const R = '/Users/iagh/git/personal/maude/.claude/worktrees/agent-a81ec5fb665864bd9';
const require = createRequire(join(R, 'apps/studio/package.json'));
const { chromium } = require('playwright');
const [base, outdir, theme = 'light', only] = process.argv.slice(2);
mkdirSync(outdir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1560, height: 1250 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const url = `http://localhost:4777/_canvas-shell.html?canvas=${encodeURIComponent(`ui/v2/${base}.tsx`)}`;
await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForSelector('[data-dc-screen]', { timeout: 30000 });
await sleep(2500);
const ids = await page.$$eval('[data-dc-screen]', (els) => els.map((e) => e.getAttribute('data-dc-screen')));
console.log('artboards', ids.length);
if (theme === 'light') {
  const n = await page.evaluate(() => {
    let k = 0;
    document.querySelectorAll('style').forEach((s) => {
      if (s.textContent.includes('[data-dc-screen] [data-theme]') && !s.textContent.includes('k-fixed[data-theme="light"]')) { s.remove(); k++; }
    });
    return k;
  });
  console.log('removed host dark-token styles', n);
  await sleep(500);
}
await page.mouse.move(800, 600);
await page.keyboard.press('Shift+0');
await sleep(800);
for (const id of ids) {
  if (only && !only.split(',').includes(id)) continue;
  const loc = page.locator(`[data-dc-screen="${id}"]`).first();
  let bb = await loc.boundingBox();
  for (let i = 0; i < 6 && bb; i++) {
    const dx = bb.x - 20, dy = bb.y - 20;
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) break;
    await page.mouse.wheel(dx, dy);
    await sleep(350);
    bb = await loc.boundingBox();
  }
  await sleep(300);
  await loc.screenshot({ path: join(outdir, `${id}-${theme}.png`) });
  console.log(id, bb ? `${Math.round(bb.width)}x${Math.round(bb.height)}@${Math.round(bb.x)},${Math.round(bb.y)}` : 'nobox');
}
await browser.close();
