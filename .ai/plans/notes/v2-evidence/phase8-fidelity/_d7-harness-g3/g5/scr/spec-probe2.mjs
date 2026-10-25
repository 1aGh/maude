import { boot, playwright, sleep } from './lib.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const scratch = mkdtempSync(join(tmpdir(), 'maude-g5-'));
const project = resolve(import.meta.dirname, 'spec-root');
const s = await boot(project, scratch, {}, { theme: 'light' });
const browser = await playwright.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
await page.goto(`${s.url}/_canvas-shell.html?canvas=${encodeURIComponent('ui/v2/14 Editing.tsx')}`);
await sleep(6000);
const probe = () =>
  page.evaluate(() => {
    const m = document.querySelector('[data-dc-screen="ed-ab-select"] .maude-v2');
    const cs = getComputedStyle(m);
    const styles = [...document.querySelectorAll('style')].filter((x) => /data-dc-screen/.test(x.textContent) && /maude-v2/.test(x.textContent)).map((x) => x.id + ':' + x.textContent.length);
    return { mt: document.documentElement.dataset.maudeTheme, dt: m.getAttribute('data-theme'), cls: m.className.slice(0, 50), bg0: cs.getPropertyValue('--bg-0'), styles };
  });
console.log('initial', JSON.stringify(await probe()));
await page.evaluate(() => (document.documentElement.dataset.maudeTheme = 'light'));
await sleep(2500);
console.log('light', JSON.stringify(await probe()));
await page.evaluate(() => (document.documentElement.dataset.maudeTheme = 'dark'));
await sleep(2500);
console.log('dark', JSON.stringify(await probe()));
await browser.close();
s.stop();
process.exit(0);
