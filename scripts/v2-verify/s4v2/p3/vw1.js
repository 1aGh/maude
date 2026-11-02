await page.route('**/_config', async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  await route.fulfill({ response: res, json: { ...j, readOnly: true, cloud: { ...(j.cloud || {}), role: 'commenter' } } });
});
await openSite('ui/Site.tsx');
await sleep(2500);
const out = {};
out.mode = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="palette-mode"]')].map(e => e.getAttribute('data-testid') + ':' + e.getAttribute('aria-pressed')));
out.slots = await frame().evaluate(() => [...document.querySelectorAll('[data-testid^="toolbar-slot-"]')].map(e => e.getAttribute('data-testid')));
await view(0.45, 280, 90).catch(() => {});
await shot('vw1-viewer');
for (const k of ['n', 'm', 'a', 'e']) {
  await page.keyboard.press(k); await sleep(600);
  out['key_' + k] = { deny: await page.evaluate(() => (document.querySelector('.an-deny, [data-testid*="deny"], [data-testid*="ask-to-edit"]')?.innerText) || null), toast: await page.evaluate(() => (document.querySelector('[role="status"], [data-testid*="toast"]')?.innerText || '').slice(0, 120)), fdeny: await frame().evaluate(() => (document.querySelector('[data-testid*="deny"], [data-testid*="ask-to-edit"], .dc-annot-deny')?.innerText || '').slice(0, 120)) };
  if (k === 'n') await shot('vw1-deny');
  await page.keyboard.press('Escape'); await sleep(300);
}
out.tids = await tids(/deny|ask-to-edit|viewer|access/);
out.ftids = await ftids(/deny|ask|viewer/);
return out;
