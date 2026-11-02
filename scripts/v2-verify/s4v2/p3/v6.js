await prev();
await sleep(2500);
const out = {};
// vote may have expired by now: start a fresh one if no bar
if (!(await page.locator('[data-testid="vote-bar"]').count())) {
  await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('Start a vote'); await sleep(500); await page.keyboard.press('Enter'); await sleep(900);
  await page.fill('[data-testid="vote-sheet-title"]', 'Helmy'); await page.click('[data-testid="vote-sheet-start"]'); await sleep(3500);
  out.afterStartBar = await page.locator('[data-testid="vote-bar"]').count();
  if (!out.afterStartBar) { await prev(); await sleep(2500); out.afterReload = await page.locator('[data-testid="vote-bar"]').count(); }
}
out.bar0 = await page.evaluate(() => document.querySelector('[data-testid="vote-bar"]')?.innerText);
out.dots = await ftids(/vote|dot/);
await page.mouse.click(856, 88);
await sleep(1500);
await page.mouse.click(1484, 88);
await sleep(1500);
out.bar1 = await page.evaluate(() => document.querySelector('[data-testid="vote-bar"]')?.innerText);
out.mine = await page.evaluate(async () => (await (await fetch('/_api/votes?file=ui/Site.tsx')).json()).mine);
await shot('v6-cast');
return out;
