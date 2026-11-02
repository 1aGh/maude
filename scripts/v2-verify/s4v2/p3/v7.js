await prev();
await sleep(2500);
const out = {};
// end any open vote
if (await page.locator('[data-testid="vote-bar-end"]').count()) { await page.click('[data-testid="vote-bar-end"]'); await sleep(2500); }
await page.keyboard.press('Meta+k'); await sleep(500); await page.keyboard.type('Start a vote'); await sleep(500); await page.keyboard.press('Enter'); await sleep(900);
await page.fill('[data-testid="vote-sheet-title"]', 'Helmy');
await page.selectOption('[data-testid="vote-sheet-duration"]', { index: 3 }).catch(e => out.selErr = String(e).slice(0, 100));
await page.click('[data-testid="vote-sheet-start"]'); await sleep(3000);
await prev(); await sleep(2500);
out.bar0 = await page.evaluate(() => document.querySelector('[data-testid="vote-bar"]')?.innerText);
await frame().locator('[data-testid="vote-add-home"]').click();
await sleep(2000);
out.bar1 = await page.evaluate(() => document.querySelector('[data-testid="vote-bar"]')?.innerText);
out.mine = await page.evaluate(async () => (await (await fetch('/_api/votes?file=ui/Site.tsx')).json()).mine);
out.dots = await ftids(/vote/);
await shot('v7-cast');
return out;
