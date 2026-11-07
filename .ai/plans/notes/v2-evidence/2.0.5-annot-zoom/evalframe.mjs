// node evalframe.mjs <worktree> <port> <js-expression-file>
import { readFileSync } from 'node:fs';
const [wt, port, file] = process.argv.slice(2);
const { launchChromium } = await import(`${wt}/apps/studio/bin/_pw-launch.mjs`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`http://localhost:${port}/?open=ui/AI-StudyMate/ux/retention-ladder.tsx`, { waitUntil: 'domcontentloaded' });
let frame = null;
for (let i = 0; i < 60 && !frame; i++) {
  frame = page.frames().find((f) => /_canvas-shell/.test(f.url())) || null;
  if (!frame) await sleep(500);
}
for (let i = 0; i < 60; i++) {
  const n = await frame.evaluate(() => document.querySelectorAll('.dc-annot-scene > *').length).catch(() => 0);
  if (n > 500) break;
  await sleep(500);
}
await sleep(1500);
const out = await frame.evaluate(readFileSync(file, 'utf8'));
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
await browser.close();
