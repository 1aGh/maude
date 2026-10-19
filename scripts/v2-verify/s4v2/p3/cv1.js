await prev(0.45, 280, 90);
await sleep(1000);
const out = {};
const p = S(800, 520);
await page.mouse.click(p.x, p.y, { button: 'right' });
await sleep(800);
out.menu = await frame().evaluate(() => [...document.querySelectorAll('[role="menuitem"], .dc-annot-menu button, [data-testid^="annot-ctx-"]')].map(e => e.textContent.trim().slice(0, 40)).slice(0, 14));
out.menuPage = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(e => e.textContent.trim().slice(0, 40)).slice(0, 14));
await shot('cv1-menu');
const item = page.getByText('Turn into a comment').first();
await item.click({ timeout: 3000 }).catch(async () => { await frame().getByText('Turn into a comment').first().click({ timeout: 3000 }).catch(e => out.err = String(e).slice(0, 100)); });
await sleep(2500);
await shot('cv1-converted');
out.toast = await page.evaluate(() => (document.querySelector('[role="status"], [data-testid*="toast"]')?.innerText || '').slice(0, 120));
// open the pin / thread
const pins = await ftids(/comment|pin/);
out.pins = pins.slice(0, 10);
return out;
