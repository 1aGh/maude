await prev();
await sleep(2000);
const out = {};
await page.keyboard.press('Shift+Meta+m');
await sleep(1200);
out.panel = await tids(/comment/);
out.panelText = await page.evaluate(() => (document.querySelector('[data-testid="comments-panel"], [data-testid="comment-panel"], [data-testid^="comments-"]')?.innerText || '').slice(0, 200));
await shot('vs1-comments');
// stickies still visible?
out.stickiesVisible = await frame().evaluate(() => document.querySelectorAll('[data-testid^="annot-sticky"], .dc-annot-sticky').length);
// toolbar hotkeys: C comment, N sticky, E stickers
const keys = {};
for (const k of ['c', 'n', 'e']) { await page.keyboard.press(k); await sleep(500); keys[k] = await frame().evaluate(() => [...document.querySelectorAll('[data-testid^="toolbar-slot-"]')].filter(e => e.getAttribute('aria-pressed') === 'true').map(e => e.getAttribute('data-testid'))); await page.keyboard.press('Escape'); await sleep(300); }
out.keys = keys;
return out;
