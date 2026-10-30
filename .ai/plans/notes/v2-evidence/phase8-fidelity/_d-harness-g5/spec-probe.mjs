import { boot, playwright, sleep } from './lib.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const scratch = mkdtempSync(join(tmpdir(), 'maude-g5-'));
const project = resolve(import.meta.dirname, 'spec-root');
const s = await boot(project, scratch, {}, { theme: 'light' });
console.log('url', s.url);
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`${s.url}/_canvas-shell.html?canvas=${encodeURIComponent('ui/v2/14 Editing.tsx')}`);
await sleep(6000);
console.log(page.url());
const info = await page.evaluate(() =>
  [...document.querySelectorAll('[data-dc-screen]')].slice(0, 4).map((e) => {
    const r = e.getBoundingClientRect();
    return [e.getAttribute('data-dc-screen'), r.width, r.height, r.x, r.y];
  })
);
console.log(JSON.stringify(info), await page.evaluate(() => document.documentElement.dataset.maudeTheme));
await page.screenshot({ path: resolve(import.meta.dirname, 'shots/probe.png') });
await browser.close();
s.stop();
process.exit(0);
