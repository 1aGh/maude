await openSite('ui/Site.tsx');
await sleep(1500);
await page.click('[data-testid="palette-mode-preview"]');
await sleep(1500);
const out = {};
out.dom = await frame().evaluate(() => {
  const e = [...document.querySelectorAll('.dc-annot-el')].find(x => /Logo comes/.test(x.textContent));
  const k = Object.keys(e).find(k => k.startsWith('__reactFiber'));
  let f = e[k], hops = 0, found = null;
  while (f && hops < 12) { const p = f.memoizedProps; if (p && p.el) { found = { type: typeof f.type === 'function' ? f.type.name : String(f.type), keys: Object.keys(p.el), tr: JSON.stringify(p.el.timeRange) }; break; } f = f.return; hops++; }
  return found;
});
return out;
