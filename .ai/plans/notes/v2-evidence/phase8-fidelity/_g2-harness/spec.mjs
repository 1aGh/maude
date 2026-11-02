// usage: node spec.mjs "<canvas file stem>" <outdir> [ids,comma]
// SPEC render: the board in the studio host's two themes (the host re-themes every un-pinned artboard through
// [data-maude-theme] on <html>); camera forced to 1:1 per artboard.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
const require = createRequire('/Users/iagh/git/personal/maude/.claude/worktrees/agent-a45b4750975bd8337/apps/studio/package.json');
const { chromium } = require('playwright');
const [stem, out, only] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1800, height: 1200 }, deviceScaleFactor: 1 });
const p = await ctx.newPage();
await p.goto('http://localhost:4711/_canvas-shell.html?canvas=' + encodeURIComponent(`ui/v2/${stem}.tsx`), { waitUntil: 'load' });
await p.waitForSelector('[data-dc-screen]', { timeout: 60000 });
await p.waitForTimeout(5000);
let ids = await p.evaluate(() => [...document.querySelectorAll('[data-dc-screen]')].map((e) => e.getAttribute('data-dc-screen')));
if (only) ids = ids.filter((i) => only.split(',').includes(i));
const meta = {};
for (const theme of ['dark', 'light']) {
  if (theme === 'light') await p.evaluate((t) => document.documentElement.setAttribute('data-maude-theme', t), theme);
  await p.waitForTimeout(700);
  for (const id of ids) {
    const sel = `[data-dc-screen="${id}"]`;
    const r = await p.evaluate(async (s) => {
      const w = document.querySelector('.dc-world');
      const a = document.querySelector(s);
      w.style.zoom = '1'; w.style.setProperty('--dc-zoom', '1'); w.style.transform = 'none';
      await new Promise((r) => setTimeout(r, 60));
      const r0 = a.getBoundingClientRect();
      w.style.transform = `translate(${20 - r0.left}px, ${20 - r0.top}px)`;
      await new Promise((r) => setTimeout(r, 250));
      const r1 = a.getBoundingClientRect();
      const stage = a.querySelector('.maude-v2:not(.k-fixed)');
      const themes = [...new Set([...a.querySelectorAll('[data-theme]')].filter((e) => !e.closest('.k-fixed')).map((e) => e.getAttribute('data-theme')))];
      return { w: Math.round(r1.width), h: Math.round(r1.height), declared: themes, bg: stage ? getComputedStyle(stage).getPropertyValue('--bg-0').trim() : null };
    }, sel);
    meta[`${id}-${theme}`] = r;
    await p.waitForTimeout(250);
    await p.locator(sel).first().screenshot({ path: `${out}/${id}-${theme}.png`, timeout: 40000 });
    console.log(theme, id, JSON.stringify(r));
  }
}
writeFileSync(`${out}/meta.json`, JSON.stringify(meta, null, 1));
await b.close();
