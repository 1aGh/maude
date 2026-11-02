await openSite('ui/Site.tsx');
await sleep(1500);
await page.click('[data-testid="palette-mode-preview"]');
await sleep(1500);
const out = {};
out.dom = await frame().evaluate(() => {
  const els = [...document.querySelectorAll('.dc-annot-el')].filter(e => /Logo comes|Music drops/.test(e.textContent));
  return els.map(e => ({ cls: String(e.className).slice(0, 60), attrs: [...e.attributes].map(a => a.name + '=' + a.value.slice(0, 20)).join(' '), html: e.outerHTML.slice(0, 300) }));
});
out.hasCss = await frame().evaluate(() => [...document.querySelectorAll('style')].some(s => /dc-annot-pintag/.test(s.textContent)));
out.playhead = await frame().evaluate(() => typeof window.__maudePlayhead);
return out;
