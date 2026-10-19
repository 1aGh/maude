await prev(0.45, 280, 90);
await sleep(1000);
await pan(1500, 0);
await sleep(800);
await shot('pl2-kanban');
const out = {};
out.cards = await frame().evaluate(() => [...document.querySelectorAll('[data-testid^="annot-"]')].map(e => e.getAttribute('data-testid')).slice(0, 30));
return out;
